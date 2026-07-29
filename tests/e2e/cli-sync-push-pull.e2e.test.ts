/**
 * E2E tests for `deepl sync push` / `deepl sync pull` dispatch.
 *
 * Exercises the register-sync-push / register-sync-pull dispatch path against
 * the actual CLI binary, a real HTTP TMS server, and the --format json
 * contract. Unit tests cover TmsClient in isolation but not the CLI wiring.
 *
 * Uses a dedicated mock TMS server (tests/e2e/mock-tms-push-pull.cjs) run
 * as a child process so the CLI subprocess can reach it over TCP. The mock
 * implements only the push/pull REST contract; a tiny control plane lets
 * the driving test clear state and set canned pull responses between runs.
 */

import { spawn, ChildProcess, spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import nock from 'nock';

import { createTestConfigDir, createTestDir, assertErrorEnvelope } from '../helpers';
import { buildSyncConfigYaml } from '../helpers/sync-harness';

const CLI_PATH = path.join(process.cwd(), 'dist/cli/index.js');
const MOCK_SERVER_SCRIPT = path.join(__dirname, 'mock-tms-push-pull.cjs');
const PROJECT_ID = 'push-pull-proj';

interface CapturedRequest {
  method: string;
  url: string;
  projectId: string;
  authHeader: string | null;
  body: string | null;
}

interface MockServerState {
  requests: CapturedRequest[];
  pushed: Record<string, Record<string, string>>;
  pullResponses: Record<string, Record<string, string>>;
}

describe('CLI sync push/pull dispatch E2E', () => {
  const testConfig = createTestConfigDir('e2e-sync-push-pull');
  const testFiles = createTestDir('e2e-sync-push-pull-files');
  let mockServerProcess: ChildProcess;
  let baseUrl: string;

  function startMockServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [MOCK_SERVER_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      mockServerProcess = child;
      let output = '';

      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        const match = output.match(/PORT=(\d+)/);
        if (match) {
          resolve(parseInt(match[1]!, 10));
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (!msg.includes('ExperimentalWarning') && !msg.includes('--experimental')) {
          process.stderr.write(`[mock-tms stderr] ${msg}`);
        }
      });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`Mock TMS server exited with code ${code}`));
        }
      });

      setTimeout(() => reject(new Error('Mock TMS server did not start within 15s')), 15000);
    });
  }

  async function resetMockServer(): Promise<void> {
    await fetch(`${baseUrl}/__reset`, { method: 'POST' });
  }

  async function configureMockServer(cfg: {
    pullResponses?: Record<string, Record<string, string>>;
  }): Promise<void> {
    await fetch(`${baseUrl}/__configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  }

  async function inspectMockServer(): Promise<MockServerState> {
    const res = await fetch(`${baseUrl}/__inspect`);
    return (await res.json()) as MockServerState;
  }

  function writeDeeplConfig(): void {
    const config = {
      auth: { apiKey: 'mock-api-key-for-testing:fx' },
      api: { baseUrl: 'http://127.0.0.1:1/', usePro: false },
      defaults: { targetLangs: [], formality: 'default', preserveFormatting: true },
      cache: { enabled: false, maxSize: 1048576, ttl: 2592000 },
      output: { format: 'text', verbose: false, color: false },
      watch: { debounceMs: 500, autoCommit: false, pattern: '*.md' },
    };
    fs.writeFileSync(
      path.join(testConfig.path, 'config.json'),
      JSON.stringify(config, null, 2),
    );
  }

  function writeSyncYaml(opts: {
    targetLocales?: string[];
    includeTmsBlock?: boolean;
  } = {}): void {
    const tms = opts.includeTmsBlock
      ? { enabled: true, server: baseUrl, project_id: PROJECT_ID }
      : undefined;
    const yaml = buildSyncConfigYaml({
      targetLocales: opts.targetLocales ?? ['de'],
      buckets: { json: { include: ['locales/en.json'] } },
      ...(tms && { tms }),
    });
    fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.yaml'), yaml);
  }

  function writeSource(keys: Record<string, string> = { greeting: 'Hello', farewell: 'Goodbye' }): void {
    const dir = path.join(testFiles.path, 'locales');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(keys, null, 2) + '\n');
  }

  function writeTarget(locale: string, keys: Record<string, string>): void {
    const dir = path.join(testFiles.path, 'locales');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${locale}.json`), JSON.stringify(keys, null, 2) + '\n');
  }

  function buildEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      DEEPL_CONFIG_DIR: testConfig.path,
      NO_COLOR: '1',
      ...extra,
    };
  }

  interface Run {
    status: number;
    stdout: string;
    stderr: string;
  }

  function runCli(args: string[], extraEnv: Record<string, string> = {}): Run {
    const result: SpawnSyncReturns<string> = spawnSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      cwd: testFiles.path,
      env: buildEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return {
      status: result.status ?? (result.signal ? 128 : 1),
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  beforeAll(async () => {
    // setup.ts runs nock.disableNetConnect() globally; re-enable 127.0.0.1 so
    // the in-process fetch() control-plane calls can reach the mock. The CLI
    // subprocess bypasses nock naturally.
    nock.enableNetConnect('127.0.0.1');
    const port = await startMockServer();
    baseUrl = `http://127.0.0.1:${port}`;
    writeDeeplConfig();
  }, 30000);

  beforeEach(async () => {
    nock.enableNetConnect('127.0.0.1');
    await resetMockServer();
    const localesDir = path.join(testFiles.path, 'locales');
    if (fs.existsSync(localesDir)) fs.rmSync(localesDir, { recursive: true, force: true });
    for (const name of ['.deepl-sync.yaml', '.deepl-sync.lock']) {
      const p = path.join(testFiles.path, name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  afterAll(() => {
    if (mockServerProcess) mockServerProcess.kill('SIGTERM');
    testConfig.cleanup();
    testFiles.cleanup();
  });

  describe('success path with local mock TMS server', () => {
    it('push: exits 0, emits count, issues PUTs with ApiKey auth', async () => {
      writeSyncYaml({ includeTmsBlock: true });
      writeSource({ greeting: 'Hello', farewell: 'Goodbye' });
      writeTarget('de', { greeting: 'Hallo', farewell: 'Auf Wiedersehen' });

      const run = runCli(['sync', 'push'], { TMS_API_KEY: 'push-pull-key' });

      expect(run.status).toBe(0);
      const combined = run.stdout + run.stderr;
      expect(combined).toMatch(/Pushed \d+ translations to TMS/);

      const state = await inspectMockServer();
      expect(state.requests.length).toBeGreaterThan(0);
      for (const req of state.requests) {
        expect(req.method).toBe('PUT');
        expect(req.authHeader).toBe('ApiKey push-pull-key');
        expect(req.url).toMatch(new RegExp(`^/api/projects/${PROJECT_ID}/keys/`));
      }
      expect(Object.keys(state.pushed['de'] ?? {}).sort()).toEqual(['farewell', 'greeting']);
      expect(state.pushed['de']!['greeting']).toBe('Hallo');
      expect(state.pushed['de']!['farewell']).toBe('Auf Wiedersehen');
    });

    it('pull: exits 0, writes target file on disk from TMS response', async () => {
      await configureMockServer({
        pullResponses: {
          de: { greeting: 'Hallo (approved)', farewell: 'Tschuess (approved)' },
        },
      });

      writeSyncYaml({ includeTmsBlock: true });
      writeSource({ greeting: 'Hello', farewell: 'Goodbye' });

      const run = runCli(['sync', 'pull'], { TMS_API_KEY: 'push-pull-key' });

      expect(run.status).toBe(0);
      const combined = run.stdout + run.stderr;
      expect(combined).toMatch(/Pulled \d+ translations from TMS/);

      const targetFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf-8')) as Record<string, string>;
      expect(parsed['greeting']).toBe('Hallo (approved)');
      expect(parsed['farewell']).toBe('Tschuess (approved)');

      const state = await inspectMockServer();
      const pullReqs = state.requests.filter(
        (r) => r.method === 'GET' && r.url.includes('/keys/export') && r.url.includes('locale=de'),
      );
      expect(pullReqs.length).toBeGreaterThan(0);
      expect(pullReqs[0]!.authHeader).toBe('ApiKey push-pull-key');
    });
  });

  describe('ConfigError when tms block absent', () => {
    it('push with no tms block: exits 7 with ConfigError, actionable remediation on stderr', () => {
      writeSyncYaml({ includeTmsBlock: false });
      writeSource();

      const run = runCli(['sync', 'push']);

      expect(run.status).toBe(7);
      const combined = run.stdout + run.stderr;
      expect(combined).toMatch(/TMS integration not configured/);
      expect(combined).toMatch(/tms:/);
    });

    it('pull with no tms block: exits 7 with ConfigError', () => {
      writeSyncYaml({ includeTmsBlock: false });
      writeSource();

      const run = runCli(['sync', 'pull']);

      expect(run.status).toBe(7);
      const combined = run.stdout + run.stderr;
      expect(combined).toMatch(/TMS integration not configured/);
    });
  });

  describe('--locale filter', () => {
    // --locale on push/pull must narrow the fan-out, not just ensure the
    // named locale is among the fetched set. The subcommand's --locale is
    // preferred; when absent, fall back to the parent's --locale.
    it('pull --locale fr on multi-locale config: only fr is fetched, de is not', async () => {
      await configureMockServer({
        pullResponses: {
          fr: { greeting: 'Bonjour', farewell: 'Au revoir' },
          de: { greeting: 'Hallo', farewell: 'Auf Wiedersehen' },
        },
      });

      writeSyncYaml({ includeTmsBlock: true, targetLocales: ['de', 'fr'] });
      writeSource({ greeting: 'Hello', farewell: 'Goodbye' });

      const run = runCli(['sync', 'pull', '--locale', 'fr'], { TMS_API_KEY: 'push-pull-key' });

      expect(run.status).toBe(0);

      const frFile = path.join(testFiles.path, 'locales', 'fr.json');
      expect(fs.existsSync(frFile)).toBe(true);
      const frParsed = JSON.parse(fs.readFileSync(frFile, 'utf-8')) as Record<string, string>;
      expect(frParsed['greeting']).toBe('Bonjour');

      const deFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(deFile)).toBe(false);

      const state = await inspectMockServer();
      const pullReqs = state.requests.filter(
        (r) => r.method === 'GET' && r.url.includes('/keys/export'),
      );
      expect(pullReqs.length).toBeGreaterThan(0);
      expect(pullReqs.some((r) => r.url.includes('locale=fr'))).toBe(true);
      expect(pullReqs.some((r) => r.url.includes('locale=de'))).toBe(false);
    });

    it('push --locale de on multi-locale config: only de is pushed, fr is not', async () => {
      writeSyncYaml({ includeTmsBlock: true, targetLocales: ['de', 'fr'] });
      writeSource({ greeting: 'Hello' });
      writeTarget('de', { greeting: 'Hallo' });
      writeTarget('fr', { greeting: 'Bonjour' });

      const run = runCli(['sync', 'push', '--locale', 'de'], { TMS_API_KEY: 'push-pull-key' });

      expect(run.status).toBe(0);

      const state = await inspectMockServer();
      expect(Object.keys(state.pushed['de'] ?? {}).sort()).toEqual(['greeting']);
      expect(state.pushed['fr']).toBeUndefined();
    });

    it('pull with parent-position --locale (deepl sync --locale fr pull): also narrows to fr', async () => {
      await configureMockServer({
        pullResponses: {
          fr: { greeting: 'Bonjour' },
          de: { greeting: 'Hallo' },
        },
      });

      writeSyncYaml({ includeTmsBlock: true, targetLocales: ['de', 'fr'] });
      writeSource({ greeting: 'Hello' });

      const run = runCli(['sync', '--locale', 'fr', 'pull'], {
        TMS_API_KEY: 'push-pull-key',
      });

      expect(run.status).toBe(0);

      const state = await inspectMockServer();
      const pullReqs = state.requests.filter(
        (r) => r.method === 'GET' && r.url.includes('/keys/export'),
      );
      expect(pullReqs.some((r) => r.url.includes('locale=fr'))).toBe(true);
      expect(pullReqs.some((r) => r.url.includes('locale=de'))).toBe(false);
    });
  });

  describe('--format json envelopes', () => {
    // push/pull currently emit their text success line under --format json as
    // well — the canonical JSON error envelope only covers the failure path.
    // These tests pin that behavior so a future contract change cannot silently
    // break script consumers parsing stderr.
    it('push --format json on success: exits 0, emits JSON success envelope on stdout', () => {
      writeSyncYaml({ includeTmsBlock: true });
      writeSource({ greeting: 'Hello' });
      writeTarget('de', { greeting: 'Hallo' });

      const run = runCli(['sync', 'push', '--format', 'json'], {
        TMS_API_KEY: 'push-pull-key',
      });

      expect(run.status).toBe(0);
      const envelope = JSON.parse(run.stdout) as { ok: boolean; pushed: number; skipped: unknown[] };
      expect(envelope.ok).toBe(true);
      expect(typeof envelope.pushed).toBe('number');
      expect(Array.isArray(envelope.skipped)).toBe(true);
    });

    it('pull --format json on success: exits 0, emits JSON success envelope on stdout', async () => {
      await configureMockServer({
        pullResponses: { de: { greeting: 'Hallo (approved)' } },
      });

      writeSyncYaml({ includeTmsBlock: true });
      writeSource({ greeting: 'Hello' });

      const run = runCli(['sync', 'pull', '--format', 'json'], {
        TMS_API_KEY: 'push-pull-key',
      });

      expect(run.status).toBe(0);
      const envelope = JSON.parse(run.stdout) as { ok: boolean; pulled: number; skipped: unknown[] };
      expect(envelope.ok).toBe(true);
      expect(typeof envelope.pulled).toBe('number');
      expect(Array.isArray(envelope.skipped)).toBe(true);
    });

    it('push --format json with missing tms block: emits canonical error envelope on stderr, exit 7', () => {
      writeSyncYaml({ includeTmsBlock: false });
      writeSource();

      const run = runCli(['sync', 'push', '--format', 'json']);

      expect(run.status).toBe(7);
      const envelope = assertErrorEnvelope(run.stderr, 'ConfigError', 7);
      expect(envelope.error.message).toMatch(/TMS integration not configured/);
      expect(envelope.error.suggestion).toMatch(/tms:/);
    });

    it('pull --format json with missing tms block: emits canonical error envelope on stderr, exit 7', () => {
      writeSyncYaml({ includeTmsBlock: false });
      writeSource();

      const run = runCli(['sync', 'pull', '--format', 'json']);

      expect(run.status).toBe(7);
      assertErrorEnvelope(run.stderr, 'ConfigError', 7);
    });
  });
});

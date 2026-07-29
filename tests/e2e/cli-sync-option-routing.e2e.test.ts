/**
 * E2E tests for --locale / --sync-config routing across `deepl sync` and its
 * subcommands.
 *
 * Commander binds an invocation-line flag to the nearest command that declares
 * it, and the parent `sync` command is reached first even when the flag trails
 * the subcommand name. Both flags are declared on the parent and on the
 * subcommands, so a subcommand that reads only its own option store sees
 * `undefined`. These tests drive the real CLI so the parent/child binding is
 * exercised — asserting on the handlers directly would pass either way.
 *
 * Also covers the ConfigError documented at docs/API.md for a --locale value
 * that is not in `target_locales`.
 */

import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createTestConfigDir, createTestDir } from '../helpers';

const CLI_PATH = path.join(process.cwd(), 'dist/cli/index.js');

describe('CLI sync option routing E2E', () => {
  const testConfig = createTestConfigDir('e2e-sync-routing');
  const testFiles = createTestDir('e2e-sync-routing-files');

  function writeConfig(configDir: string): void {
    const config = {
      auth: { apiKey: 'mock-api-key-for-testing:fx' },
      api: { baseUrl: 'http://127.0.0.1:1/', usePro: false },
      defaults: { targetLangs: [], formality: 'default', preserveFormatting: true },
      cache: { enabled: false, maxSize: 1048576, ttl: 2592000 },
      output: { format: 'text', verbose: false, color: false },
      watch: { debounceMs: 500, autoCommit: false, pattern: '*.md' },
    };
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2));
  }

  function writeSyncConfig(projectDir: string, locales: string[] = ['de', 'fr']): string {
    const yaml = [
      'version: 1',
      'source_locale: en',
      'target_locales:',
      ...locales.map((l) => `  - ${l}`),
      'buckets:',
      '  json:',
      '    include:',
      '      - "locales/en.json"',
    ].join('\n') + '\n';
    const configPath = path.join(projectDir, '.deepl-sync.yaml');
    fs.writeFileSync(configPath, yaml);
    return configPath;
  }

  function writeSourceFile(projectDir: string): void {
    const dir = path.join(projectDir, 'locales');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'en.json'),
      JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye' }, null, 2) + '\n',
    );
  }

  interface Run {
    status: number;
    stdout: string;
    stderr: string;
    output: string;
  }

  function runCli(args: string[], cwd: string = testFiles.path): Run {
    const result: SpawnSyncReturns<string> = spawnSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      cwd,
      env: {
        ...process.env,
        DEEPL_CONFIG_DIR: testConfig.path,
        DEEPL_API_KEY: 'mock-api-key-for-testing:fx',
        NO_COLOR: '1',
        CI: undefined,
        // Ambient NODE_OPTIONS can make node print warnings to stderr, which
        // the JSON-envelope assertions parse.
        NODE_OPTIONS: undefined,
        NODE_NO_WARNINGS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    return { status: result.status ?? 1, stdout, stderr, output: stdout + stderr };
  }

  beforeAll(() => {
    writeConfig(testConfig.path);
  });

  beforeEach(() => {
    for (const entry of fs.readdirSync(testFiles.path)) {
      fs.rmSync(path.join(testFiles.path, entry), { recursive: true, force: true });
    }
  });

  afterAll(() => {
    testConfig.cleanup();
    testFiles.cleanup();
  });

  describe('--locale reaches the subcommand handler', () => {
    it('narrows `sync status` output to the requested locale', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', 'status', '--locale', 'de']);

      expect(run.status).toBe(0);
      expect(run.output).toMatch(/\bde\b/);
      expect(run.output).not.toMatch(/^\s+fr\s/m);
    });

    it('narrows `sync export` XLIFF output to the requested locale', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', 'export', '--locale', 'de']);

      expect(run.status).toBe(0);
      expect(run.stdout).toContain('target-language="de"');
      expect(run.stdout).not.toContain('target-language="fr"');
    });
  });

  describe('--sync-config reaches the subcommand handler', () => {
    for (const sub of ['status', 'validate', 'export', 'audit', 'resolve', 'push', 'pull']) {
      it(`\`sync ${sub} --sync-config <missing>\` fails with ConfigError (exit 7)`, () => {
        writeSyncConfig(testFiles.path, ['de', 'fr']);
        writeSourceFile(testFiles.path);

        const missing = path.join(testFiles.path, 'nope', 'absent.yaml');
        const run = runCli(['sync', sub, '--sync-config', missing]);

        expect(run.status).toBe(7);
        expect(run.output).toContain(missing);
      });
    }

    it('honors --sync-config pointing at a config outside the auto-detected one', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const altRoot = path.join(testFiles.path, 'alt');
      fs.mkdirSync(altRoot, { recursive: true });
      writeSyncConfig(altRoot, ['it']);
      writeSourceFile(altRoot);
      const altConfig = path.join(altRoot, '.deepl-sync.yaml');

      const run = runCli(['sync', 'status', '--sync-config', altConfig]);

      expect(run.status).toBe(0);
      expect(run.output).toMatch(/\bit\b/);
      expect(run.output).not.toMatch(/^\s+de\s/m);
    });
  });

  describe('--locale must name a configured target locale', () => {
    it('exits 7 on `sync --locale <unconfigured>` naming the offending and configured locales', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', '--locale', 'es', '--dry-run']);

      expect(run.status).toBe(7);
      expect(run.output).toContain('es');
      expect(run.output).toContain('de, fr');
      expect(run.output).not.toContain('Sync complete');
    });

    it('exits 7 on `sync status --locale <unconfigured>`', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', 'status', '--locale', 'es']);

      expect(run.status).toBe(7);
      expect(run.output).toContain('es');
      expect(run.output).toContain('de, fr');
    });

    it('exits 7 on `sync validate --locale <unconfigured>` instead of reporting all-passed', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', 'validate', '--locale', 'zz']);

      expect(run.status).toBe(7);
      expect(run.output.toLowerCase()).not.toContain('passed validation');
    });

    it('exits 7 on `sync export --locale <unconfigured>` instead of exporting every locale', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', 'export', '--locale', 'zz']);

      expect(run.status).toBe(7);
      expect(run.stdout).not.toContain('<xliff');
    });

    it('emits a ConfigError envelope with --format json', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', 'status', '--locale', 'es', '--format', 'json']);

      expect(run.status).toBe(7);
      const envelope = JSON.parse(run.stderr.trim()) as {
        ok: boolean;
        error: { code: string };
        exitCode: number;
      };
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe('ConfigError');
      expect(envelope.exitCode).toBe(7);
    });

    it('still accepts a configured locale on the root command', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', '--locale', 'de', '--dry-run']);

      expect(run.status).toBe(0);
      expect(run.output).toContain('dry-run');
    });

    it('still accepts a configured locale on a subcommand', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const run = runCli(['sync', 'status', '--locale', 'de,fr']);

      expect(run.status).toBe(0);
      expect(run.output).toMatch(/\bde\b/);
      expect(run.output).toMatch(/\bfr\b/);
    });
  });

  describe('sync init --sync-config', () => {
    it('writes the config at the requested path', () => {
      const altRoot = path.join(testFiles.path, 'alt');
      fs.mkdirSync(altRoot, { recursive: true });
      writeSourceFile(altRoot);

      const target = path.join(altRoot, 'custom-sync.yaml');
      const run = runCli([
        'sync', 'init',
        '--sync-config', target,
        '--source-locale', 'en',
        '--target-locales', 'de',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ]);

      expect(run.status).toBe(0);
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.existsSync(path.join(testFiles.path, '.deepl-sync.yaml'))).toBe(false);
      expect(fs.readFileSync(target, 'utf-8')).toContain('source_locale: en');
    });

    it('does not treat an unrelated cwd config as the already-exists case', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      const altRoot = path.join(testFiles.path, 'alt');
      fs.mkdirSync(altRoot, { recursive: true });
      writeSourceFile(altRoot);

      const target = path.join(altRoot, '.deepl-sync.yaml');
      const run = runCli([
        'sync', 'init',
        '--sync-config', target,
        '--source-locale', 'en',
        '--target-locales', 'it',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ]);

      expect(run.status).toBe(0);
      expect(run.output).not.toContain('already exists');
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, 'utf-8')).toContain('it');
    });

    it('reports the already-exists case against the --sync-config path', () => {
      const altRoot = path.join(testFiles.path, 'alt');
      fs.mkdirSync(altRoot, { recursive: true });
      writeSourceFile(altRoot);
      const target = writeSyncConfig(altRoot, ['de']);

      const run = runCli([
        'sync', 'init',
        '--sync-config', target,
        '--source-locale', 'en',
        '--target-locales', 'it',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ]);

      expect(run.output).toContain('already exists');
      expect(fs.readFileSync(target, 'utf-8')).not.toContain('it');
    });
  });
});

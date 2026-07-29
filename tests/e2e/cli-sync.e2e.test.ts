/**
 * E2E Tests for CLI Sync Command
 * Uses a mock HTTP server (running in a separate process) to simulate
 * the DeepL API so we can test sync workflows without a real API key.
 */

import { spawn, spawnSync, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import nock from 'nock';
import { assertErrorEnvelope, createTestConfigDir, createTestDir } from '../helpers';

const CLI_PATH = path.join(process.cwd(), 'dist/cli/index.js');

describe('CLI Sync E2E', () => {
  const testConfig = createTestConfigDir('e2e-sync');
  const testFiles = createTestDir('e2e-sync-files');
  let mockServerProcess: ChildProcess;
  let baseUrl: string;

  function startMockServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const serverScript = path.join(__dirname, 'mock-deepl-server.cjs');
      const child = spawn('node', [serverScript], {
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
          process.stderr.write(`[mock-server stderr] ${msg}`);
        }
      });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`Mock server exited with code ${code}`));
        }
      });

      setTimeout(() => reject(new Error('Mock server did not start within 15s')), 15000);
    });
  }

  function writeConfig(configDir: string, apiUrl: string): void {
    const config = {
      auth: { apiKey: 'mock-api-key-for-testing:fx' },
      api: { baseUrl: apiUrl, usePro: false },
      defaults: {
        targetLangs: [],
        formality: 'default',
        preserveFormatting: true,
      },
      cache: { enabled: false, maxSize: 1048576, ttl: 2592000 },
      output: { format: 'text', verbose: false, color: false },
      watch: { debounceMs: 500, autoCommit: false, pattern: '*.md' },
    };
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2));
  }

  function writeSyncConfig(projectDir: string, locales: string[] = ['de']): void {
    const yaml = [
      'version: 1',
      'source_locale: en',
      'target_locales:',
      ...locales.map(l => `  - ${l}`),
      'buckets:',
      '  json:',
      '    include:',
      '      - "locales/en.json"',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(projectDir, '.deepl-sync.yaml'), yaml);
  }

  function writeSourceFile(projectDir: string): void {
    const dir = path.join(projectDir, 'locales');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({
      greeting: 'Hello',
      farewell: 'Goodbye',
    }, null, 2) + '\n');
  }

  function buildEnv(): Record<string, string | undefined> {
    // Strip CI so the --force billing guard (register-sync-root.ts) does not
    // fire its CI-without-yes branch when these tests run under GitHub Actions
    // / GitLab CI. Individual tests that exercise CI semantics set CI=true
    // explicitly.
    const { CI: _ci, ...rest } = process.env;
    return {
      ...rest,
      DEEPL_CONFIG_DIR: testConfig.path,
      NO_COLOR: '1',
    };
  }

  // Note: execSync is used here intentionally for E2E CLI testing -- the input
  // is fully controlled test data with no user-supplied values.
  function runSync(args: string = ''): string {
    return execSync(`node ${CLI_PATH} sync ${args}`, {
      encoding: 'utf-8',
      cwd: testFiles.path,
      env: buildEnv(),
      timeout: 15000,
    });
  }

  function runSyncAll(args: string = ''): string {
    return execSync(`node ${CLI_PATH} sync ${args} 2>&1`, {
      encoding: 'utf-8',
      shell: '/bin/sh',
      cwd: testFiles.path,
      env: buildEnv(),
      timeout: 15000,
    });
  }

  function runSyncExpectError(args: string = ''): { status: number; output: string } {
    try {
      const output = execSync(`node ${CLI_PATH} sync ${args} 2>&1`, {
        encoding: 'utf-8',
        shell: '/bin/sh',
        cwd: testFiles.path,
        env: buildEnv(),
        timeout: 15000,
      });
      return { status: 0, output };
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: string; stdout?: string };
      return {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional: empty stderr should fall through to stdout
        status: err.status ?? 1, output: err.stderr?.toString() || err.stdout?.toString() || '',
      };
    }
  }

  beforeAll(async () => {
    // tests/setup.ts blocks outbound net connections; re-enable localhost
    // so the --dry-run test (and any future in-process fetch) can query
    // the mock server's /__inspect endpoint.
    nock.enableNetConnect('127.0.0.1');
    const port = await startMockServer();
    baseUrl = `http://127.0.0.1:${port}`;
    writeConfig(testConfig.path, baseUrl);
  }, 30000);

  beforeEach(() => {
    // setup.ts's afterEach calls nock.cleanAll() which clears the
    // enableNetConnect allowance; re-enable before each test.
    nock.enableNetConnect('127.0.0.1');
    const localesDir = path.join(testFiles.path, 'locales');
    if (fs.existsSync(localesDir)) {
      fs.rmSync(localesDir, { recursive: true, force: true });
    }
    const lockFile = path.join(testFiles.path, '.deepl-sync.lock');
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    const syncConfig = path.join(testFiles.path, '.deepl-sync.yaml');
    if (fs.existsSync(syncConfig)) fs.unlinkSync(syncConfig);
  });

  afterAll(() => {
    if (mockServerProcess) {
      mockServerProcess.kill('SIGTERM');
    }
    testConfig.cleanup();
    testFiles.cleanup();
  });

  describe('help', () => {
    it('should display help text with all flags', () => {
      const output = runSync('--help');
      expect(output).toContain('--frozen');
      expect(output).toContain('--dry-run');
      expect(output).toContain('--force');
      expect(output).toContain('--locale');
    });
  });

  describe('sync workflow', () => {
    it('should translate and create target files', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      runSyncAll();

      const targetFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const content = fs.readFileSync(targetFile, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      const parsed = JSON.parse(content) as Record<string, string>;
      expect(parsed['greeting']).toBeDefined();
      expect(parsed['farewell']).toBeDefined();
    });

    it('should show dry-run preview without creating files', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const output = runSyncAll('--dry-run');

      expect(output.toLowerCase()).toContain('dry-run');
      const targetFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(false);
    });
  });

  describe('frozen mode', () => {
    it('should exit 10 on frozen with drift', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const result = runSyncExpectError('--frozen');
      expect(result.status).toBe(10);
    });

    it('should exit 0 on frozen when current', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      runSyncAll();

      const result = runSyncExpectError('--frozen');
      expect(result.status).toBe(0);
    });
  });

  describe('output format', () => {
    it('should output valid JSON with --format json', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const output = runSyncAll('--format json');
      // Extract the final pretty-printed JSON result (identified by the stable "ok" field)
      const resultMatch = output.match(/\{[^{}]*"ok"[\s\S]*\}(?![\s\S]*\{[^{}]*"ok")/);
      expect(resultMatch).not.toBeNull();
      const parsed = JSON.parse(resultMatch![0]) as Record<string, unknown>;
      expect(parsed).toHaveProperty('ok');
      expect(parsed).toHaveProperty('totalKeys');
      expect(parsed).toHaveProperty('dryRun');
      expect(parsed).toHaveProperty('rateAssumption');
    });
  });

  describe('error handling', () => {
    it('should fail without config file', () => {
      const result = runSyncExpectError();
      expect(result.status).toBeGreaterThan(0);
      expect(result.output.toLowerCase()).toMatch(/config|\.deepl-sync\.yaml|init/);
    });

    it('emits a parseable JSON error envelope to stderr when --format json and config is missing', () => {
      const result = runSyncExpectError('--format json');

      expect(result.status).toBe(7);
      const envelope = assertErrorEnvelope(result.output, 'ConfigError', 7);
      expect(typeof envelope.error.message).toBe('string');
      expect(envelope.error.message.length).toBeGreaterThan(0);
    });
  });

  describe('locale filter', () => {
    it('should respect --locale filter', () => {
      writeSyncConfig(testFiles.path, ['de', 'fr']);
      writeSourceFile(testFiles.path);

      runSyncAll('--locale de');

      const deFile = path.join(testFiles.path, 'locales', 'de.json');
      const frFile = path.join(testFiles.path, 'locales', 'fr.json');
      expect(fs.existsSync(deFile)).toBe(true);
      expect(fs.existsSync(frFile)).toBe(false);
    });
  });

  describe('force mode', () => {
    it('should retranslate with --force', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      runSyncAll();
      const targetFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);

      const output = runSyncAll('--force');
      expect(output).toBeDefined();
      expect(fs.existsSync(targetFile)).toBe(true);
    });
  });

  describe('subcommand: status', () => {
    it('should output locale status for a synced project', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);
      runSyncAll();

      const output = runSyncAll('status');
      expect(output).toContain('en');
      expect(output).toContain('de');
    });

    it('should output status with locale coverage info', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);
      runSyncAll();

      const output = runSyncAll('status');
      expect(output).toContain('en');
      expect(output).toContain('de');
      expect(output).toMatch(/\d+\s*keys/);
    });
  });

  describe('subcommand: validate', () => {
    it('should run validation and report results', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);
      runSyncAll();

      const output = runSyncAll('validate');
      expect(output.toLowerCase()).toMatch(/checked|translation|validation|passed/);
    });
  });

  describe('sync init (non-interactive)', () => {
    it('should generate working config for JSON format', () => {
      writeSourceFile(testFiles.path);

      runSyncAll('init --source-locale en --target-locales de --file-format json --path "locales/en.json"');

      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(true);
      const config = fs.readFileSync(configPath, 'utf-8');
      expect(config).toContain('locales/en.json');
      expect(config).not.toContain('{locale}');

      const output = runSyncAll('--dry-run');
      expect(output.toLowerCase()).toMatch(/dry.?run|would|keys?/);
    });

    it('exits 6 with a clear message when stdin is not a TTY and only partial flags are supplied', () => {
      writeSourceFile(testFiles.path);

      const result = spawnSync(
        'node',
        [CLI_PATH, 'sync', 'init', '--source-locale', 'en'],
        {
          cwd: testFiles.path,
          env: buildEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 10000,
        },
      );

      expect(result.status).toBe(6);
      const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(combined).toMatch(/All four flags/);
      expect(combined).toContain('--source-locale');
      expect(combined).toContain('--target-locales');
      expect(combined).toContain('--file-format');
      expect(combined).toContain('--path');

      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('succeeds when all four flags are supplied even when stdin is not a TTY', () => {
      writeSourceFile(testFiles.path);

      const result = spawnSync(
        'node',
        [
          CLI_PATH,
          'sync',
          'init',
          '--source-locale', 'en',
          '--target-locales', 'de',
          '--file-format', 'json',
          '--path', 'locales/en.json',
        ],
        {
          cwd: testFiles.path,
          env: buildEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 10000,
        },
      );

      expect(result.status).toBe(0);
      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    function runInitFlags(args: string[]): { status: number | null; output: string } {
      const result = spawnSync(
        'node',
        [CLI_PATH, 'sync', 'init', ...args],
        {
          cwd: testFiles.path,
          env: buildEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 10000,
        },
      );
      return {
        status: result.status,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      };
    }

    it('rejects source locale appearing in --target-locales with exit 6', () => {
      writeSourceFile(testFiles.path);

      const result = runInitFlags([
        '--source-locale', 'en',
        '--target-locales', 'de,en,fr',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ]);

      expect(result.status).toBe(6);
      expect(result.output.toLowerCase()).toMatch(/source|--target-locales/);
      expect(result.output).toMatch(/en/);
      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('rejects duplicate --target-locales with exit 6', () => {
      writeSourceFile(testFiles.path);

      const result = runInitFlags([
        '--source-locale', 'en',
        '--target-locales', 'de,fr,DE',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ]);

      expect(result.status).toBe(6);
      expect(result.output.toLowerCase()).toContain('duplicate');
      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('rejects malformed target-locale code with exit 6', () => {
      writeSourceFile(testFiles.path);

      const result = runInitFlags([
        '--source-locale', 'en',
        '--target-locales', 'de,xx_YY',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ]);

      expect(result.status).toBe(6);
      expect(result.output.toLowerCase()).toMatch(/locale|code|malformed|invalid/);
      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('rejects --path containing .. (traversal) with exit 6', () => {
      writeSourceFile(testFiles.path);

      const result = runInitFlags([
        '--source-locale', 'en',
        '--target-locales', 'de',
        '--file-format', 'json',
        '--path', '../etc/en.json',
      ]);

      expect(result.status).toBe(6);
      expect(result.output.toLowerCase()).toMatch(/traversal|\.\./);
      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('warns (but succeeds) when --path does not yet exist', () => {
      const result = runInitFlags([
        '--source-locale', 'en',
        '--target-locales', 'de',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ]);

      expect(result.status).toBe(0);
      expect(result.output.toLowerCase()).toMatch(/does not exist|not yet/);
      const configPath = path.join(testFiles.path, '.deepl-sync.yaml');
      expect(fs.existsSync(configPath)).toBe(true);
    });
  });

  describe('target_path_pattern support', () => {
    it('should translate Android XML files using target_path_pattern', () => {
      const resDir = path.join(testFiles.path, 'res', 'values');
      fs.mkdirSync(resDir, { recursive: true });
      fs.writeFileSync(path.join(resDir, 'strings.xml'),
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="greeting">Hello</string>\n</resources>\n');

      const yaml = [
        'version: 1',
        'source_locale: en',
        'target_locales:',
        '  - de',
        'buckets:',
        '  android_xml:',
        '    include:',
        '      - "res/values/strings.xml"',
        '    target_path_pattern: "res/values-{locale}/strings.xml"',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.yaml'), yaml);

      runSyncAll();

      const targetFile = path.join(testFiles.path, 'res', 'values-de', 'strings.xml');
      expect(fs.existsSync(targetFile)).toBe(true);
      const content = fs.readFileSync(targetFile, 'utf-8');
      expect(content).toContain('greeting');
    });

    it('should translate XLIFF files using target_path_pattern', () => {
      const localeDir = path.join(testFiles.path, 'src', 'locale');
      fs.mkdirSync(localeDir, { recursive: true });
      fs.writeFileSync(path.join(localeDir, 'messages.xlf'), [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
        '  <file source-language="en" target-language="" datatype="plaintext">',
        '    <body>',
        '      <trans-unit id="greeting">',
        '        <source>Hello</source>',
        '      </trans-unit>',
        '    </body>',
        '  </file>',
        '</xliff>',
      ].join('\n') + '\n');

      const yaml = [
        'version: 1',
        'source_locale: en',
        'target_locales:',
        '  - de',
        'buckets:',
        '  xliff:',
        '    include:',
        '      - "src/locale/messages.xlf"',
        '    target_path_pattern: "src/locale/messages.{locale}.xlf"',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.yaml'), yaml);

      runSyncAll();

      const targetFile = path.join(testFiles.path, 'src', 'locale', 'messages.de.xlf');
      expect(fs.existsSync(targetFile)).toBe(true);
      const content = fs.readFileSync(targetFile, 'utf-8');
      expect(content).toContain('greeting');
    });
  });

  describe('batch mode flags', () => {
    it('should sync successfully with --batch and --no-batch flags', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      runSyncAll('--batch');

      const targetFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf-8')) as Record<string, string>;
      expect(parsed['greeting']).toBeDefined();
      expect(parsed['farewell']).toBeDefined();

      // Clean slate for --no-batch run
      fs.unlinkSync(path.join(testFiles.path, '.deepl-sync.lock'));
      fs.rmSync(path.join(testFiles.path, 'locales', 'de.json'));

      runSyncAll('--no-batch');

      expect(fs.existsSync(targetFile)).toBe(true);
      const parsed2 = JSON.parse(fs.readFileSync(targetFile, 'utf-8')) as Record<string, string>;
      expect(parsed2['greeting']).toBeDefined();
      expect(parsed2['farewell']).toBeDefined();
    });
  });

  describe('ICU MessageFormat preservation', () => {
    it('should preserve ICU plural structure through sync', () => {
      writeSyncConfig(testFiles.path, ['de']);
      const dir = path.join(testFiles.path, 'locales');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({
        itemCount: '{count, plural, one {# item} other {# items}}',
        greeting: 'Hello',
      }, null, 2) + '\n');

      runSyncAll();

      const targetFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf-8')) as Record<string, string>;

      // ICU structure preserved: variable name, keyword, and branch selectors intact
      expect(parsed['itemCount']).toContain('{count, plural,');
      expect(parsed['itemCount']).toContain('one {');
      expect(parsed['itemCount']).toContain('other {');
      expect(parsed['greeting']).toBeDefined();
      expect(parsed['greeting']).not.toBe('Hello');
    });
  });

  describe('new locale addition', () => {
    it('should create files for newly added locale on re-sync', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      runSyncAll();

      const deFile = path.join(testFiles.path, 'locales', 'de.json');
      expect(fs.existsSync(deFile)).toBe(true);
      const deContentBefore = fs.readFileSync(deFile, 'utf-8');

      writeSyncConfig(testFiles.path, ['de', 'fr']);

      runSyncAll();

      expect(fs.existsSync(deFile)).toBe(true);
      const deContentAfter = fs.readFileSync(deFile, 'utf-8');
      expect(deContentAfter).toBe(deContentBefore);

      const frFile = path.join(testFiles.path, 'locales', 'fr.json');
      expect(fs.existsSync(frFile)).toBe(true);
      const frParsed = JSON.parse(fs.readFileSync(frFile, 'utf-8')) as Record<string, string>;
      expect(frParsed['greeting']).toBeDefined();
      expect(frParsed['farewell']).toBeDefined();

      // Verify lock file has translations for both locales
      const lockContent = JSON.parse(fs.readFileSync(
        path.join(testFiles.path, '.deepl-sync.lock'), 'utf-8',
      )) as Record<string, unknown>;
      const entries = lockContent['entries'] as Record<string, Record<string, unknown>>;
      const bucket = entries['locales/en.json'] as Record<string, Record<string, unknown>>;
      // Lock entries are keyed by i18n key, each with a translations object per locale
      const firstKey = Object.keys(bucket)[0]!;
      const keyEntry = bucket[firstKey] as Record<string, unknown>;
      const translations = keyEntry['translations'] as Record<string, unknown>;
      expect(translations['de']).toBeDefined();
      expect(translations['fr']).toBeDefined();
    });
  });

  describe('validate exit code contract', () => {
    it('exits with CheckFailed (8) when a placeholder is missing from the translation', () => {
      writeSyncConfig(testFiles.path, ['de']);
      const dir = path.join(testFiles.path, 'locales');
      fs.mkdirSync(dir, { recursive: true });
      // Source has a placeholder; hand-written target drops it
      fs.writeFileSync(
        path.join(dir, 'en.json'),
        JSON.stringify({ welcome: 'Hello {name}' }, null, 2) + '\n',
      );
      fs.writeFileSync(
        path.join(dir, 'de.json'),
        JSON.stringify({ welcome: 'Hallo' }, null, 2) + '\n',
      );

      const result = runSyncExpectError('validate');
      expect(result.status).toBe(8);
      expect(result.output.toLowerCase()).toMatch(/placeholder|welcome/);
    });
  });

  describe('flag combination rejection', () => {
    it('rejects --frozen and --force together with a non-zero exit and actionable message', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const result = runSyncExpectError('--frozen --force');
      expect(result.status).toBeGreaterThan(0);
      expect(result.output).toMatch(/Cannot use --frozen and --force together/);
    });

    it('rejects --frozen and --watch together with ValidationError exit code 6', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const result = runSyncExpectError('--frozen --watch');
      expect(result.status).toBe(6);
      expect(result.output).toMatch(/Cannot use --frozen and --watch together/);
    });
  });

  describe('--dry-run makes zero translate API calls', () => {
    it('records zero /v2/translate calls on the mock server when invoked with --dry-run', async () => {
      // Reset the mock server's translateCalls counter for this test
      await fetch(`${baseUrl}/__reset`, { method: 'POST' });

      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      runSyncAll('--dry-run');

      const res = await fetch(`${baseUrl}/__inspect`);
      const state = (await res.json()) as { translateCalls: number };
      expect(state.translateCalls).toBe(0);
    });
  });

  describe('sync resolve on conflict-marked lockfile', () => {
    it('rewrites a lockfile that contains git conflict markers as valid JSON and exits 0', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      // Build a synthetic lockfile with real <<<<<<< / ======= / >>>>>>> markers
      const validEntry = {
        hash: 'abc123',
        translated_at: '2026-04-18T12:00:00Z',
        status: 'translated',
      };
      const conflictedLock = [
        '{',
        '  "_comment": "Auto-generated",',
        '  "version": 1,',
        '  "generated_at": "2026-04-18T12:00:00Z",',
        '  "source_locale": "en",',
        '  "entries": {',
        '    "locales/en.json": {',
        '      "greeting": {',
        '        "source_hash": "src1",',
        '        "source_text": "Hello",',
        '        "translations": {',
        '<<<<<<< HEAD',
        `          "de": ${JSON.stringify(validEntry)}`,
        '=======',
        `          "de": ${JSON.stringify({ ...validEntry, hash: 'xyz789' })}`,
        '>>>>>>> feature/other',
        '        }',
        '      }',
        '    }',
        '  },',
        '  "stats": { "total_keys": 1, "total_translations": 1, "last_sync": "2026-04-18T12:00:00Z" }',
        '}',
      ].join('\n');
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.lock'), conflictedLock);

      const output = runSyncAll('resolve');
      expect(output.toLowerCase()).toMatch(/resolv/);

      const after = fs.readFileSync(path.join(testFiles.path, '.deepl-sync.lock'), 'utf-8');
      expect(() => JSON.parse(after)).not.toThrow();
      expect(after).not.toContain('<<<<<<<');
      expect(after).not.toContain('=======');
      expect(after).not.toContain('>>>>>>>');
    });

    it('prints a per-entry decision report with summary line', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const ourEntry = { hash: 'a', translated_at: '2026-04-20T09:33:15Z', status: 'translated' };
      const theirEntry = { hash: 'b', translated_at: '2026-04-20T08:12:03Z', status: 'translated' };
      const conflictedLock = [
        '{',
        '  "version": 1,',
        '  "generated_at": "2026-04-20T12:00:00Z",',
        '  "source_locale": "en",',
        '  "entries": {',
        '    "locales/en.json": {',
        '<<<<<<< HEAD',
        `      "greeting": { "source_hash": "src1", "source_text": "Hello", "translations": { "de": ${JSON.stringify(ourEntry)} } }`,
        '=======',
        `      "greeting": { "source_hash": "src1", "source_text": "Hello", "translations": { "de": ${JSON.stringify(theirEntry)} } }`,
        '>>>>>>> feature/other',
        '    }',
        '  },',
        '  "stats": { "total_keys": 1, "total_translations": 1, "last_sync": "2026-04-20T12:00:00Z" }',
        '}',
      ].join('\n');
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.lock'), conflictedLock);

      const output = runSyncAll('resolve');
      expect(output).toMatch(/Resolved\s+.+:greeting/);
      expect(output).toMatch(/kept ours|kept theirs/);
      expect(output).toMatch(/Resolved \d+ conflicts?/);
    });

    it('prints the parse-error fallback warning exactly once per region', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      // Both halves end with a trailing comma, so the per-region JSON.parse
      // fails and the length heuristic kicks in; the following non-conflicted
      // entry keeps the merged document valid.
      const ourEntry = { hash: 'a', translated_at: '2026-04-20T09:33:15Z', status: 'translated' };
      const theirEntry = { hash: 'b', translated_at: '2026-04-20T08:12:03Z', status: 'translated' };
      const conflictedLock = [
        '{',
        '  "version": 1,',
        '  "generated_at": "2026-04-20T12:00:00Z",',
        '  "source_locale": "en",',
        '  "entries": {',
        '    "locales/en.json": {',
        '<<<<<<< HEAD',
        `      "greeting": { "source_hash": "src1", "source_text": "Hello", "translations": { "de": ${JSON.stringify(ourEntry)} } },`,
        '=======',
        `      "greeting": { "source_hash": "src2", "source_text": "Hello", "translations": { "de": ${JSON.stringify(theirEntry)} } },`,
        '>>>>>>> feature/other',
        '      "farewell": { "source_hash": "src3", "source_text": "Bye", "translations": {} }',
        '    }',
        '  },',
        '  "stats": { "total_keys": 2, "total_translations": 1, "last_sync": "2026-04-20T12:00:00Z" }',
        '}',
      ].join('\n');
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.lock'), conflictedLock);

      const output = runSyncAll('resolve');

      const warnCount = (output.match(/parse-error fallback/g) ?? []).length;
      expect(warnCount).toBe(1);
    });

    it('exits 11 (SyncConflict) when auto-resolution cannot produce valid JSON', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      // Both conflict halves fail JSON.parse because the ours side leaves a
      // string literal open. The length-heuristic fallback then drops an
      // unbalanced raw fragment into the output, so the post-merge JSON.parse
      // in resolveLockFile rejects the result and it returns resolved:false.
      const conflictedLock = [
        '{',
        '  "version": 1,',
        '  "generated_at": "2026-04-20T12:00:00Z",',
        '  "source_locale": "en",',
        '  "entries": {',
        '    "locales/en.json": {',
        '<<<<<<< HEAD',
        '      "greeting": { "source_hash": "abc", "source_text": "Hello',
        '=======',
        '      "greeting": { "source_hash": "def", "source_text": "Hi",',
        '>>>>>>> feature/other',
        '    }',
        '  },',
        '  "stats": { "total_keys": 1, "total_translations": 1, "last_sync": "2026-04-20T12:00:00Z" }',
        '}',
      ].join('\n');
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.lock'), conflictedLock);

      const result = runSyncExpectError('resolve');
      expect(result.status).toBe(11);
      expect(result.output).toMatch(/conflict markers manually/i);
      expect(result.output).toMatch(/deepl sync/i);
    });

    it('--dry-run prints the report but does not write the lockfile', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const ourEntry = { hash: 'a', translated_at: '2026-04-20T09:33:15Z', status: 'translated' };
      const theirEntry = { hash: 'b', translated_at: '2026-04-20T08:12:03Z', status: 'translated' };
      const conflictedLock = [
        '{',
        '  "version": 1,',
        '  "generated_at": "2026-04-20T12:00:00Z",',
        '  "source_locale": "en",',
        '  "entries": {',
        '    "locales/en.json": {',
        '<<<<<<< HEAD',
        `      "greeting": { "source_hash": "src1", "source_text": "Hello", "translations": { "de": ${JSON.stringify(ourEntry)} } }`,
        '=======',
        `      "greeting": { "source_hash": "src1", "source_text": "Hello", "translations": { "de": ${JSON.stringify(theirEntry)} } }`,
        '>>>>>>> feature/other',
        '    }',
        '  },',
        '  "stats": { "total_keys": 1, "total_translations": 1, "last_sync": "2026-04-20T12:00:00Z" }',
        '}',
      ].join('\n');
      const lockPath = path.join(testFiles.path, '.deepl-sync.lock');
      fs.writeFileSync(lockPath, conflictedLock);
      const before = fs.readFileSync(lockPath, 'utf-8');

      const output = runSyncAll('resolve --dry-run');
      expect(output).toMatch(/dry[- ]run/i);
      expect(output).toMatch(/Resolved\s+.+:greeting/);

      const after = fs.readFileSync(lockPath, 'utf-8');
      expect(after).toBe(before);
      expect(after).toContain('<<<<<<<');
    });
  });

  describe('sync resolve --format json', () => {
    function makeConflictedLock(ourEntry: object, theirEntry: object): string {
      return [
        '{',
        '  "version": 1,',
        '  "generated_at": "2026-04-20T12:00:00Z",',
        '  "source_locale": "en",',
        '  "entries": {',
        '    "locales/en.json": {',
        '<<<<<<< HEAD',
        `      "greeting": { "source_hash": "src1", "source_text": "Hello", "translations": { "de": ${JSON.stringify(ourEntry)} } }`,
        '=======',
        `      "greeting": { "source_hash": "src1", "source_text": "Hello", "translations": { "de": ${JSON.stringify(theirEntry)} } }`,
        '>>>>>>> feature/other',
        '    }',
        '  },',
        '  "stats": { "total_keys": 1, "total_translations": 1, "last_sync": "2026-04-20T12:00:00Z" }',
        '}',
      ].join('\n');
    }

    it('resolve --format json on success with conflicts: emits JSON envelope on stdout', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const ourEntry = { hash: 'a', translated_at: '2026-04-20T09:33:15Z', status: 'translated' };
      const theirEntry = { hash: 'b', translated_at: '2026-04-20T08:12:03Z', status: 'translated' };
      fs.writeFileSync(
        path.join(testFiles.path, '.deepl-sync.lock'),
        makeConflictedLock(ourEntry, theirEntry),
      );

      const result = spawnSync('node', [CLI_PATH, 'sync', 'resolve', '--format', 'json'], {
        encoding: 'utf-8',
        cwd: testFiles.path,
        env: buildEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
      });

      expect(result.status).toBe(0);
      const envelope = JSON.parse(result.stdout) as { ok: boolean; resolved: number; decisions: unknown[] };
      expect(envelope.ok).toBe(true);
      expect(typeof envelope.resolved).toBe('number');
      expect(envelope.resolved).toBeGreaterThan(0);
      expect(Array.isArray(envelope.decisions)).toBe(true);
      expect(envelope.decisions.length).toBeGreaterThan(0);
    });

    it('resolve --format json with no conflicts: emits {ok:true, resolved:0, decisions:[]} on stdout', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);

      const cleanLock = JSON.stringify({
        version: 1,
        generated_at: '2026-04-20T12:00:00Z',
        source_locale: 'en',
        entries: {},
        stats: { total_keys: 0, total_translations: 0, last_sync: '2026-04-20T12:00:00Z' },
      }, null, 2);
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.lock'), cleanLock);

      const result = spawnSync('node', [CLI_PATH, 'sync', 'resolve', '--format', 'json'], {
        encoding: 'utf-8',
        cwd: testFiles.path,
        env: buildEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
      });

      expect(result.status).toBe(0);
      const envelope = JSON.parse(result.stdout) as { ok: boolean; resolved: number; decisions: unknown[] };
      expect(envelope.ok).toBe(true);
      expect(envelope.resolved).toBe(0);
      expect(envelope.decisions).toEqual([]);
    });
  });

  describe('sync status --format json', () => {
    function extractJson(output: string): unknown {
      // Logger.info prints text with no prefix, but progress lines from
      // upstream code can appear before/after. Grab the first JSON object.
      const match = output.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`No JSON object found in output:\n${output}`);
      return JSON.parse(match[0]);
    }

    it('emits a stable camelCase shape on success', () => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);
      runSyncAll(); // seed the lockfile

      // Logger.info routes to stderr, so capture both via runSyncAll.
      const output = runSyncAll('status --format json');
      const parsed = extractJson(output) as Record<string, unknown>;

      expect(typeof parsed['sourceLocale']).toBe('string');
      expect(typeof parsed['totalKeys']).toBe('number');
      expect(Array.isArray(parsed['locales'])).toBe(true);

      const locales = parsed['locales'] as Array<Record<string, unknown>>;
      expect(locales.length).toBeGreaterThan(0);
      const first = locales[0]!;
      expect(typeof first['locale']).toBe('string');
      expect(typeof first['complete']).toBe('number');
      expect(typeof first['missing']).toBe('number');
      expect(typeof first['outdated']).toBe('number');
      expect(typeof first['coverage']).toBe('number');
      expect(first['coverage']).toBeGreaterThanOrEqual(0);
      expect(first['coverage']).toBeLessThanOrEqual(100);
      expect(Number.isInteger(first['coverage'])).toBe(true);
    });

    it('emits a parseable JSON error envelope to stderr when config is missing', () => {
      // No .deepl-sync.yaml in testFiles.path (beforeEach cleans it up).
      const result = runSyncExpectError('status --format json');

      expect(result.status).toBe(7);
      const envelope = assertErrorEnvelope(result.output, 'ConfigError', 7);
      expect(typeof envelope.error.message).toBe('string');
    });
  });

  describe('sync audit surfaces translated text', () => {
    it('emits actual translated strings from target files in --format json output', () => {
      // Two source files, same repeated term "Dashboard". Target files give
      // it two different German translations — a real inconsistency.
      const sourceDir = path.join(testFiles.path, 'locales', 'en');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'common.json'), JSON.stringify({ greeting: 'Dashboard' }, null, 2));
      fs.writeFileSync(path.join(sourceDir, 'admin.json'), JSON.stringify({ header: 'Dashboard' }, null, 2));

      const targetDir = path.join(testFiles.path, 'locales', 'de');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'common.json'), JSON.stringify({ greeting: 'Armaturenbrett' }, null, 2));
      fs.writeFileSync(path.join(targetDir, 'admin.json'), JSON.stringify({ header: 'Dashboard' }, null, 2));

      fs.writeFileSync(
        path.join(testFiles.path, '.deepl-sync.yaml'),
        [
          'version: 1',
          'source_locale: en',
          'target_locales:',
          '  - de',
          'buckets:',
          '  json:',
          '    include:',
          '      - "locales/en/*.json"',
          '',
        ].join('\n'),
      );

      // Pre-seed lockfile with divergent translation hashes (different content hashes
      // => different recorded translations => inconsistency detected).
      const lockContent = {
        _comment: 'test',
        version: 1,
        generated_at: '2026-04-19T00:00:00Z',
        source_locale: 'en',
        entries: {
          'locales/en/common.json': {
            greeting: {
              source_hash: 'sh',
              source_text: 'Dashboard',
              translations: {
                de: { hash: 'de-hash-a', translated_at: '2026-04-19T00:00:00Z', status: 'translated' },
              },
            },
          },
          'locales/en/admin.json': {
            header: {
              source_hash: 'sh',
              source_text: 'Dashboard',
              translations: {
                de: { hash: 'de-hash-b', translated_at: '2026-04-19T00:00:00Z', status: 'translated' },
              },
            },
          },
        },
        stats: { total_keys: 2, total_translations: 2, last_sync: '2026-04-19T00:00:00Z' },
      };
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.lock'), JSON.stringify(lockContent, null, 2));

      const output = runSyncAll('audit --format json');
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      expect(jsonMatch).not.toBeNull();
      const parsed = JSON.parse(jsonMatch![0]) as {
        totalTerms: number;
        inconsistencies: Array<{ sourceText: string; locale: string; translations: string[]; files: string[] }>;
      };

      expect(parsed.totalTerms).toBe(1);
      expect(parsed.inconsistencies).toHaveLength(1);
      const inc = parsed.inconsistencies[0]!;
      expect(inc.sourceText).toBe('Dashboard');
      expect(inc.locale).toBe('de');
      // Critical: must be real translated strings, not SHA hashes.
      expect(inc.translations).toEqual(expect.arrayContaining(['Armaturenbrett', 'Dashboard']));
      expect(inc.translations).not.toContain('de-hash-a');
      expect(inc.translations).not.toContain('de-hash-b');

      // Clean up the nested dirs created above so the next test's beforeEach
      // doesn't inherit them (beforeEach only wipes locales/ at the top).
    });

    it('reports a not-yet-created locale file as missing instead of an inconsistency', () => {
      const sourceDir = path.join(testFiles.path, 'locales', 'en');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'common.json'), JSON.stringify({ greeting: 'Dashboard' }, null, 2));
      fs.writeFileSync(path.join(sourceDir, 'admin.json'), JSON.stringify({ header: 'Dashboard' }, null, 2));

      // Only one of the two German files exists yet.
      const targetDir = path.join(testFiles.path, 'locales', 'de');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'common.json'), JSON.stringify({ greeting: 'Armaturenbrett' }, null, 2));

      fs.writeFileSync(
        path.join(testFiles.path, '.deepl-sync.yaml'),
        [
          'version: 1',
          'source_locale: en',
          'target_locales:',
          '  - de',
          'buckets:',
          '  json:',
          '    include:',
          '      - "locales/en/*.json"',
          '',
        ].join('\n'),
      );

      const lockContent = {
        _comment: 'test',
        version: 1,
        generated_at: '2026-04-19T00:00:00Z',
        source_locale: 'en',
        entries: {
          'locales/en/common.json': {
            greeting: {
              source_hash: 'sh',
              source_text: 'Dashboard',
              translations: {
                de: { hash: 'de-hash-a', translated_at: '2026-04-19T00:00:00Z', status: 'translated' },
              },
            },
          },
          'locales/en/admin.json': {
            header: {
              source_hash: 'sh',
              source_text: 'Dashboard',
              translations: {
                de: { hash: 'de-hash-a', translated_at: '2026-04-19T00:00:00Z', status: 'translated' },
              },
            },
          },
        },
        stats: { total_keys: 2, total_translations: 2, last_sync: '2026-04-19T00:00:00Z' },
      };
      fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.lock'), JSON.stringify(lockContent, null, 2));

      const output = runSyncAll('audit --format json');
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      expect(jsonMatch).not.toBeNull();
      const parsed = JSON.parse(jsonMatch![0]) as {
        inconsistencies: Array<{ translations: string[] }>;
        missingTargets: Array<{ filePath: string; locale: string }>;
      };

      expect(parsed.inconsistencies).toHaveLength(0);
      expect(parsed.missingTargets).toEqual([
        { filePath: 'locales/en/admin.json', locale: 'de' },
      ]);
      expect(output).not.toContain('de-hash-a');
    });
  });

  describe('sync export output safety', () => {
    beforeEach(() => {
      writeSyncConfig(testFiles.path, ['de']);
      writeSourceFile(testFiles.path);
    });

    it('writes XLIFF to stdout by default', () => {
      const output = runSync('export');
      expect(output.startsWith('<?xml')).toBe(true);
      expect(output).toContain('<xliff');
      expect(output).toContain('<trans-unit');
    });

    it('rejects --output paths that escape the project root', () => {
      const result = runSyncExpectError('export --output ../../etc/evil.xlf');
      expect(result.status).not.toBe(0);
      expect(result.output.toLowerCase()).toMatch(/escapes project root|outside/i);
      expect(fs.existsSync(path.join(testFiles.path, '..', '..', 'etc', 'evil.xlf'))).toBe(false);
    });

    it('refuses to overwrite an existing output file without --overwrite', () => {
      const outputPath = path.join(testFiles.path, 'preexisting.xlf');
      fs.writeFileSync(outputPath, 'existing content — do not clobber', 'utf-8');

      const result = runSyncExpectError('export --output preexisting.xlf');
      expect(result.status).not.toBe(0);
      expect(result.output.toLowerCase()).toMatch(/refusing to overwrite|--overwrite/);

      const preserved = fs.readFileSync(outputPath, 'utf-8');
      expect(preserved).toBe('existing content — do not clobber');

      fs.unlinkSync(outputPath);
    });

    it('overwrites an existing output file when --overwrite is passed', () => {
      const outputPath = path.join(testFiles.path, 'preexisting.xlf');
      fs.writeFileSync(outputPath, 'old content', 'utf-8');

      runSync('export --output preexisting.xlf --overwrite');

      const written = fs.readFileSync(outputPath, 'utf-8');
      expect(written.startsWith('<?xml')).toBe(true);
      expect(written).toContain('<xliff');
      expect(written).not.toBe('old content');

      fs.unlinkSync(outputPath);
    });

    it('creates intermediate directories for --output path', () => {
      const nested = path.join('reports', '2026-04-19', 'export.xlf');
      const absNested = path.join(testFiles.path, nested);

      runSync(`export --output ${nested}`);

      expect(fs.existsSync(absNested)).toBe(true);
      const content = fs.readFileSync(absNested, 'utf-8');
      expect(content.startsWith('<?xml')).toBe(true);

      fs.rmSync(path.join(testFiles.path, 'reports'), { recursive: true, force: true });
    });
  });
});

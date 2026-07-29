/**
 * E2E subprocess test for `deepl sync --watch`.
 *
 * Runs the built CLI as a child process so signal handling, chokidar, and
 * the real event loop are all exercised. Everything stays in --dry-run mode
 * so no API calls happen and no external mock server is required.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_PATH = path.join(process.cwd(), 'dist/cli/index.js');

describe('deepl sync --watch (subprocess)', () => {
  let tmpDir: string;
  let configDir: string;
  let child: ChildProcess | null = null;
  let combined = '';

  beforeEach(() => {
    // Own config dir per CLAUDE.md's isolation rule. Without it this
    // subprocess inherits the shared config, and the auth-mutating e2e suites
    // running alongside (cli-auth, cli-batch, cli-workflow, cli-voice,
    // cli-describe all clear or set the key) could remove the stored key
    // mid-test. A stored key takes precedence over DEEPL_API_KEY, so the
    // watch process would then die on an auth error and never reach the
    // graceful SIGTERM path this test asserts.
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-watch-cfg-'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-watch-'));
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });
    fs.writeFileSync(
      path.join(localesDir, 'en.json'),
      JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.deepl-sync.yaml'),
      [
        'version: 1',
        'source_locale: en',
        'target_locales:',
        '  - de',
        'buckets:',
        '  json:',
        '    include:',
        '      - "locales/en.json"',
        '',
      ].join('\n'),
    );
    combined = '';
  });

  afterEach(async () => {
    if (child && !child.killed && child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        if (child?.exitCode === null) {
          child.once('exit', () => resolve());
        } else {
          resolve();
        }
      });
    }
    child = null;
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (fs.existsSync(configDir)) fs.rmSync(configDir, { recursive: true, force: true });
  });

  function waitForMarker(marker: RegExp, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = (): void => {
        if (marker.test(combined)) return resolve(true);
        if (Date.now() - start >= timeoutMs) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    });
  }

  it('picks up a source-file change and emits sync-triggered output, then exits cleanly on SIGTERM', async () => {
    child = spawn(
      'node',
      [CLI_PATH, 'sync', '--watch', '--dry-run', '--debounce', '150'],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          DEEPL_CONFIG_DIR: configDir,
          DEEPL_API_KEY: 'test-key-for-watch:fx',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => { combined += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { combined += chunk.toString(); });

    // Wait for chokidar to warm up and print the "Watching..." banner.
    const watching = await waitForMarker(/Watching .* pattern/i, 5000);
    expect(watching).toBe(true);

    // Modify the source file to trigger a change event.
    fs.writeFileSync(
      path.join(tmpDir, 'locales', 'en.json'),
      JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye' }, null, 2) + '\n',
    );

    // Wait up to 3s for the subprocess to register the change and start a sync cycle.
    // Keep the marker loose — exact log format is not a contract.
    const detected = await waitForMarker(/detected|syncing|change/i, 3000);
    expect(detected).toBe(true);

    const exitPromise = new Promise<number | null>((resolve) => {
      child!.once('exit', (code) => resolve(code));
    });
    child.kill('SIGTERM');
    const code = await Promise.race([
      exitPromise,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(-1), 3000)),
    ]);

    // SIGTERM should lead to a clean exit (code 0, or signal-based null on some platforms).
    expect(code === 0 || code === null).toBe(true);
  }, 15000);
});

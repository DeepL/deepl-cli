/**
 * E2E Tests for degraded cache backend
 * Simulates the storage backend failing to load (e.g. node:sqlite
 * missing on a pre-24 Node runtime) by hijacking module resolution for
 * node:sqlite in the CLI subprocess. The CLI must keep translating/
 * writing with the cache disabled, warn exactly once, and never touch
 * the cache database.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createTestConfigDir, createTestDir, makeNodeRunCLI } from '../helpers';

const BREAK_SQLITE_PRELOAD = `'use strict';
const { registerHooks } = require('node:module');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:sqlite' || specifier === 'sqlite') {
      const err = new Error('No such built-in module: node:sqlite');
      err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
      throw err;
    }
    return nextResolve(specifier, context);
  },
});
`;

describe('CLI with unavailable cache backend E2E', () => {
  const testConfig = createTestConfigDir('e2e-cache-degraded');
  const testFiles = createTestDir('e2e-cache-degraded-files');
  let mockServerProcess: ChildProcess;
  let baseUrl: string;
  let preloadPath: string;
  let cacheDbPath: string;

  let runCLIAll: (command: string, options?: { env?: Record<string, string | undefined> }) => string;
  let runCLIExpectError: (
    command: string,
    options?: { env?: Record<string, string | undefined> },
  ) => { status: number; output: string };

  function brokenEnv(): { env: Record<string, string> } {
    return { env: { NODE_OPTIONS: `--require ${preloadPath}` } };
  }

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

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`Mock server exited with code ${code}`));
        }
      });

      setTimeout(() => reject(new Error('Mock server did not start within 15s')), 15000).unref();
    });
  }

  beforeAll(async () => {
    const helpers = makeNodeRunCLI(testConfig.path, { noColor: true, timeout: 15000 });
    runCLIAll = helpers.runCLIAll;
    runCLIExpectError = helpers.runCLIExpectError;

    preloadPath = path.join(testFiles.path, 'break-node-sqlite.cjs');
    fs.writeFileSync(preloadPath, BREAK_SQLITE_PRELOAD);

    const mockPort = await startMockServer();
    baseUrl = `http://127.0.0.1:${mockPort}`;

    const config = {
      auth: { apiKey: 'mock-api-key-for-testing:fx' },
      api: { baseUrl, usePro: false },
      defaults: { targetLangs: [], formality: 'default', preserveFormatting: true },
      cache: { enabled: true, maxSize: 1048576, ttl: 2592000 },
      output: { format: 'text', verbose: false, color: false },
    };
    fs.writeFileSync(path.join(testConfig.path, 'config.json'), JSON.stringify(config, null, 2));

    // Populate a healthy cache database with a working backend first.
    cacheDbPath = path.join(testConfig.path, 'cache.db');
    runCLIAll('translate "Hello" --to es');
    if (!fs.existsSync(cacheDbPath)) {
      throw new Error(`Seeding run did not create ${cacheDbPath}`);
    }
  }, 30000);

  afterAll(() => {
    if (mockServerProcess) {
      mockServerProcess.kill('SIGTERM');
    }
    testConfig.cleanup();
    testFiles.cleanup();
  });

  function listCorruptFiles(): string[] {
    return fs.readdirSync(testConfig.path).filter((f) => f.includes('.corrupt-'));
  }

  it('translate succeeds with exit code 0 and exactly one warning', () => {
    const before = fs.readFileSync(cacheDbPath);

    const output = runCLIAll('translate "Hello world" --to es', brokenEnv());

    expect(output).toContain('Hola mundo');
    const warnings = output.split('Caching is disabled for this run').length - 1;
    expect(warnings).toBe(1);

    // The healthy database was not quarantined or modified.
    expect(listCorruptFiles()).toEqual([]);
    expect(fs.readFileSync(cacheDbPath).equals(before)).toBe(true);
  });

  it('write succeeds with exit code 0 and a warning', () => {
    const output = runCLIAll('write "helo wrld" --lang en-US', brokenEnv());

    expect(output).toContain('Caching is disabled for this run');
    expect(listCorruptFiles()).toEqual([]);
  });

  it('cache stats fails with a clear, actionable error', () => {
    const result = runCLIExpectError('cache stats', brokenEnv());

    expect(result.status).not.toBe(0);
    expect(result.output.toLowerCase()).toContain('unavailable');
    expect(listCorruptFiles()).toEqual([]);
  });

  it('still uses the cache normally when the backend loads fine', () => {
    const output = runCLIAll('translate "Hello" --to es');

    expect(output).toContain('Hola');
    expect(output).not.toContain('Caching is disabled for this run');
    expect(listCorruptFiles()).toEqual([]);
  });
});

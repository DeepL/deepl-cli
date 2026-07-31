/**
 * E2E Tests for the --timeout / --max-retries global options.
 * Uses a server that accepts requests and never answers, so the client aborts
 * locally — where retrying would re-submit a billable POST.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createTestConfigDir, createTestDir, makeNodeRunCLI } from '../helpers';

describe('CLI HTTP options E2E', () => {
  const testConfig = createTestConfigDir('e2e-http-options');
  const testFiles = createTestDir('e2e-http-options-files');
  let runner: ReturnType<typeof makeNodeRunCLI>;
  let stallServer: ChildProcess;
  let baseUrl: string;
  let countFile: string;

  function startStallServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const serverScript = path.join(__dirname, 'stall-server.cjs');
      const child = spawn('node', [serverScript, countFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      stallServer = child;
      let output = '';

      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        const match = output.match(/PORT=(\d+)/);
        if (match) {
          resolve(parseInt(match[1]!, 10));
        }
      });

      child.on('error', reject);
      setTimeout(() => reject(new Error('Stall server did not start within 15s')), 15000);
    });
  }

  function requestCount(): number {
    return parseInt(fs.readFileSync(countFile, 'utf-8'), 10);
  }

  beforeAll(async () => {
    runner = makeNodeRunCLI(testConfig.path, { apiKey: 'test-api-key' });
    countFile = path.join(testFiles.path, 'requests.txt');
    const port = await startStallServer();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    stallServer.kill();
    testConfig.cleanup();
    testFiles.cleanup();
  });

  it('exits 5 (network error) on a client-side timeout instead of 6', () => {
    const result = runner.runCLIExpectError(
      `--timeout 500 translate "Hello" --to es --api-url ${baseUrl}`,
      { timeout: 30000 },
    );

    expect(result.status).toBe(5);
    expect(result.output).toMatch(/timeout|network/i);
  });

  it('does not re-submit the translate POST after a client-side timeout', () => {
    const before = requestCount();

    runner.runCLIExpectError(
      `--timeout 500 translate "Bonjour" --to es --api-url ${baseUrl}`,
      { timeout: 30000 },
    );

    expect(requestCount() - before).toBe(1);
  });

  it('honours --timeout so the run is bounded well below the 30s default', () => {
    const start = Date.now();
    const result = runner.runCLIExpectError(
      `--timeout 500 --max-retries 0 translate "Guten Tag" --to es --api-url ${baseUrl}`,
      { timeout: 30000 },
    );
    const elapsed = Date.now() - start;

    expect(result.status).toBe(5);
    expect(elapsed).toBeLessThan(20000);
  });

  it('rejects a non-numeric --timeout with exit 6', () => {
    const result = runner.runCLIExpectError('--timeout abc translate "Hello" --to es');

    expect(result.status).toBe(6);
    expect(result.output).toMatch(/--timeout/);
  });

  it('rejects a negative --max-retries with exit 6', () => {
    const result = runner.runCLIExpectError('--max-retries -1 translate "Hello" --to es');

    expect(result.status).toBe(6);
    expect(result.output).toMatch(/--max-retries/);
  });

  it('documents both options in the top-level help', () => {
    const output = runner.runCLIAll('--help');

    expect(output).toContain('--timeout');
    expect(output).toContain('--max-retries');
  });
});

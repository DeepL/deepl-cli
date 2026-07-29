/**
 * Tests for CLI exit code when no arguments provided.
 *
 * Validates that running 'deepl' with no arguments exits with code 0.
 */

import { execSync } from 'child_process';
import * as path from 'path';

describe('CLI no-args exit code', () => {
  // Use the compiled CLI, like every other e2e test: running the TS source
  // through ts-node adds 1.5-2s of cold start per call, which does not fit
  // the 10s execSync timeout under full-suite parallelism.
  const cliPath = path.resolve(__dirname, '../../dist/cli/index.js');

  it('should exit with code 0 when no arguments are provided', () => {
    try {
      const output = execSync(`node "${cliPath}"`, {
        encoding: 'utf-8',
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        timeout: 10000,
      });
      expect(output).toContain('deepl');
    } catch (error: any) {
      fail(`CLI exited with code ${error.status as number}, expected 0. stderr: ${error.stderr as string}`);
    }
  });

  it('should show help text when no arguments are provided', () => {
    try {
      const output = execSync(`node "${cliPath}"`, {
        encoding: 'utf-8',
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        timeout: 10000,
      });
      expect(output).toContain('DeepL CLI');
      expect(output).toContain('translate');
    } catch (error: any) {
      fail(`CLI exited with non-zero code: ${error.status as number}`);
    }
  });
});

/**
 * Tests for did-you-mean suggestion on unknown commands.
 */

import { execSync } from 'child_process';
import * as path from 'path';

describe('CLI did-you-mean suggestions', () => {
  // Use the compiled CLI, like every other e2e test: running the TS source
  // through ts-node adds 1.5-2s of cold start per call, which does not fit
  // the 10s execSync timeout under full-suite parallelism.
  const cliPath = path.resolve(__dirname, '../../dist/cli/index.js');

  function runCLI(args: string): { stdout: string; stderr: string; exitCode: number } {
    try {
      const stdout = execSync(`node "${cliPath}" ${args}`, {
        encoding: 'utf-8',
        env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
        timeout: 10000,
      });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: (error.stdout as string) ?? '',
        stderr: (error.stderr as string) ?? '',
        exitCode: (error.status as number) ?? 1,
      };
    }
  }

  it('should suggest "translate" when user types "transalte"', () => {
    const result = runCLI('transalte');
    expect(result.exitCode).toBeGreaterThan(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Unknown command: transalte');
    expect(combined).toContain('Did you mean: deepl translate?');
  });

  it('should suggest "glossary" when user types "glossry"', () => {
    const result = runCLI('glossry');
    expect(result.exitCode).toBeGreaterThan(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Did you mean: deepl glossary?');
  });

  it('should suggest "config" when user types "conifg"', () => {
    const result = runCLI('conifg');
    expect(result.exitCode).toBeGreaterThan(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Did you mean: deepl config?');
  });

  it('should not suggest for completely unrelated input', () => {
    const result = runCLI('xyzabc123');
    expect(result.exitCode).toBeGreaterThan(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Unknown command: xyzabc123');
    expect(combined).not.toContain('Did you mean');
  });

  it('should show help suggestion for unknown commands', () => {
    const result = runCLI('xyzabc123');
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('deepl --help');
  });

  it('should suggest translate, not an unrelated command, for a prefix of an alias', () => {
    const result = runCLI('tr');
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Did you mean: deepl translate?');
  });

  it.each(['descibe', 'describe'])('should never suggest the hidden _describe command (%s)', (typo) => {
    const result = runCLI(typo);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain('_describe');
  });
});

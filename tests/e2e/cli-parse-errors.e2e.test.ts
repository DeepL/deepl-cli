/**
 * E2E Tests for CLI parse-error exit codes
 * Commander parse errors (unknown command/option, invalid choice, missing
 * argument) must exit with ExitCode.InvalidInput (6) at every command level.
 */

import { createTestConfigDir, makeNodeRunCLI } from '../helpers';

describe('CLI Parse Errors E2E', () => {
  const testConfig = createTestConfigDir('e2e-parse-errors');
  const { runCLIExpectError, runCLI } = makeNodeRunCLI(testConfig.path);

  afterAll(() => {
    testConfig.cleanup();
  });

  describe('subcommand parse errors exit 6', () => {
    it('unknown cache subcommand exits 6', () => {
      const result = runCLIExpectError('cache bogus');

      expect(result.status).toBe(6);
      expect(result.output).toMatch(/unknown command/i);
    });

    it('unknown auth subcommand exits 6', () => {
      const result = runCLIExpectError('auth status');

      expect(result.status).toBe(6);
      expect(result.output).toMatch(/unknown command/i);
    });

    it('invalid option choice exits 6', () => {
      const result = runCLIExpectError(
        "translate 'Hi' --to es --formality bogus",
        { excludeApiKey: true },
      );

      expect(result.status).toBe(6);
      expect(result.output).toMatch(/allowed choices|invalid/i);
    });

    it('unknown option exits 6', () => {
      const result = runCLIExpectError('usage --bogus-flag');

      expect(result.status).toBe(6);
      expect(result.output).toMatch(/unknown option/i);
    });

    it('missing required argument exits 6', () => {
      const result = runCLIExpectError('glossary show');

      expect(result.status).toBe(6);
      expect(result.output).toMatch(/missing required argument/i);
    });
  });

  describe('top-level behavior is unchanged', () => {
    it('unknown top-level command still exits 6', () => {
      const result = runCLIExpectError('transalte');

      expect(result.status).toBe(6);
      expect(result.output).toMatch(/unknown command/i);
    });

    it('--version exits 0', () => {
      const result = runCLIExpectError('--version');

      expect(result.status).toBe(0);
    });

    it('--help exits 0', () => {
      expect(() => runCLI('--help')).not.toThrow();
    });

    it('subcommand --help exits 0', () => {
      expect(() => runCLI('cache --help')).not.toThrow();
    });
  });
});

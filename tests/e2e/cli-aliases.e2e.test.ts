/**
 * E2E Tests for Command Aliases
 * Tests that `deepl t` and `deepl w` dispatch to translate and write
 */

import { createTestConfigDir, makeNodeRunCLI } from '../helpers';

describe('Command Aliases E2E', () => {
  const testConfig = createTestConfigDir('e2e-aliases');
  const { runCLI, runCLIExpectError } = makeNodeRunCLI(testConfig.path);

  afterAll(() => {
    testConfig.cleanup();
  });

  describe('deepl t', () => {
    it('should show translate help under the alias', () => {
      const output = runCLI('t --help');
      expect(output).toContain('translate|t');
      expect(output).toContain('--to <language>');
    });

    it('should dispatch to translate validation logic', () => {
      const result = runCLIExpectError('t "Hello" --to es --tm-threshold abc');
      expect(result.status).toBeGreaterThan(0);
      expect(result.output).toContain('--tm-threshold must be an integer');
    });

    it('should fail identically to translate on an unknown option', () => {
      const viaAlias = runCLIExpectError('t --no-such-flag');
      const viaFull = runCLIExpectError('translate --no-such-flag');
      expect(viaAlias.status).toBe(viaFull.status);
      expect(viaAlias.status).toBeGreaterThan(0);
      expect(viaAlias.output).toContain('unknown option');
    });
  });

  describe('deepl w', () => {
    it('should show write help under the alias', () => {
      const output = runCLI('w --help');
      expect(output).toContain('write|w');
      expect(output).toContain('--style <style>');
    });

    it('should dispatch to write option validation', () => {
      const result = runCLIExpectError('w "Hello" --format bogus');
      expect(result.status).toBeGreaterThan(0);
      expect(result.output).toContain("Allowed choices are text, json");
    });

    it('should fail identically to write on an unknown option', () => {
      const viaAlias = runCLIExpectError('w --no-such-flag');
      const viaFull = runCLIExpectError('write --no-such-flag');
      expect(viaAlias.status).toBe(viaFull.status);
      expect(viaAlias.status).toBeGreaterThan(0);
      expect(viaAlias.output).toContain('unknown option');
    });
  });

  describe('help output', () => {
    it('should list both aliases in top-level help', () => {
      const output = runCLI('--help');
      expect(output).toContain('translate|t');
      expect(output).toContain('write|w');
    });
  });

  describe('shell completion', () => {
    it('should offer t and w in bash completions', () => {
      const output = runCLI('completion bash');
      expect(output).toMatch(/compgen -W "[^"]*\btranslate t\b/);
      expect(output).toMatch(/compgen -W "[^"]*\bwrite w\b/);
    });

    it('should offer t and w in zsh completions', () => {
      const output = runCLI('completion zsh');
      expect(output).toMatch(/'t:.*[Tt]ranslate/);
      expect(output).toMatch(/'w:.*[Ww]rite/);
    });

    it('should offer t and w in fish completions', () => {
      const output = runCLI('completion fish');
      expect(output).toContain("-a 't'");
      expect(output).toContain("-a 'w'");
    });
  });
});

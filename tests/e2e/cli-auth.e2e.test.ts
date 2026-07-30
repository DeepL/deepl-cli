/**
 * E2E Tests for Auth Command
 * Tests the `deepl auth` command end-to-end
 */

import { createTestConfigDir, makeNodeRunCLI } from '../helpers';

describe('Auth Command E2E', () => {
  const testConfig = createTestConfigDir('e2e-auth');
  const { runCLI, runCLIAll, runCLIExpectError } = makeNodeRunCLI(testConfig.path, { excludeApiKey: true });

  afterAll(() => {
    testConfig.cleanup();
  });

  describe('auth --help', () => {
    it('should display help text', () => {
      const output = runCLI('auth --help');

      expect(output).toContain('Usage:');
      expect(output).toContain('auth');
      expect(output).toContain('Options:');
    });

    it('should describe the command', () => {
      const output = runCLI('auth --help');

      expect(output).toMatch(/auth|api key|manage/i);
    });

    it('should list subcommands', () => {
      const output = runCLI('auth --help');

      expect(output).toContain('Commands:');
    });
  });

  describe('auth show', () => {
    it('should show "No API key set" when no key configured', () => {
      expect.assertions(1);
      // Clear any existing key first
      try {
        runCLI('auth clear');
      } catch {
        // Ignore
      }

      const output = runCLI('auth show');
      expect(output).toContain('No API key set');
    });

    it('should exit successfully', () => {
      const result = runCLIExpectError('auth show');
      expect(result.status).toBe(0);
    });
  });

  describe('auth clear', () => {
    it('should clear API key successfully', () => {
      const output = runCLIAll('auth clear');
      expect(output).toMatch(/removed|cleared/i);
    });
  });

  describe('auth set-key', () => {
    it('should reject empty API key', () => {
      const result = runCLIExpectError('auth set-key ""');

      expect(result.status).toBeGreaterThan(0);
      expect(result.output).toMatch(/empty|required/i);
    });
  });

  describe('auth command structure', () => {
    it('should be registered as a command', () => {
      const helpOutput = runCLI('--help');

      expect(helpOutput).toContain('auth');
    });

    it('should show auth in main help with description', () => {
      const helpOutput = runCLI('--help');

      expect(helpOutput).toMatch(/auth/i);
    });
  });
});

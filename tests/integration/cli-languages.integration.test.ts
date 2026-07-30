/**
 * Integration Tests for Languages CLI Command
 * Tests the languages command CLI behavior and output formatting
 */

import { createTestConfigDir, makeRunCLI } from '../helpers';

describe('Languages CLI Integration', () => {
  const testConfig = createTestConfigDir('languages');
  const { runCLI } = makeRunCLI(testConfig.path);

  afterAll(() => {
    testConfig.cleanup();
  });

  describe('deepl languages --help', () => {
    it('should display help for languages command', () => {
      const output = runCLI('deepl languages --help');

      expect(output).toContain('Usage:');
      expect(output).toContain('deepl languages');
      expect(output).toContain('List supported source and target languages');
      expect(output).toContain('--source');
      expect(output).toContain('--target');
    });
  });

  describe('deepl languages without API key (graceful degradation)', () => {
    it('should show registry-only output with warning when no API key', () => {
      expect.assertions(2);
      try {
        runCLI('deepl auth clear');
      } catch {
        // Ignore if already cleared
      }

      const output = runCLI('deepl languages', { apiKey: '' });

      expect(output).toContain('Source Languages:');
      expect(output).toContain('Target Languages:');
    });

    it('should show extended languages without API key', () => {
      const output = runCLI('deepl languages --source', { apiKey: '' });

      expect(output).toContain('Source Languages:');
      expect(output).toContain('Extended Languages');
    });
  });

  describe('deepl languages command structure', () => {
    it('should be available as a command', () => {
      const helpOutput = runCLI('deepl --help');

      // Languages command should be listed in main help
      expect(helpOutput).toContain('languages');
      expect(helpOutput).toContain('List supported source and target languages');
    });

    it('should support --source flag', () => {
      const output = runCLI('deepl languages --help');

      // Should have --source flag
      expect(output).toContain('--source');
      expect(output).toContain('-s');
      expect(output).toContain('Show only source languages');
    });

    it('should support --target flag', () => {
      const output = runCLI('deepl languages --help');

      // Should have --target flag (no -t short flag to avoid conflict with --to)
      expect(output).toContain('--target');
      expect(output).toContain('Show only target languages');
    });

    it('should not require any arguments', () => {
      const output = runCLI('deepl languages --help');

      // Should be simple command with no required parameters
      expect(output).toContain('Usage: deepl languages');
      expect(output).not.toContain('<required');
    });

    it('should accept optional flags', () => {
      const output = runCLI('deepl languages --help');

      // Flags should be marked as optional
      expect(output).toContain('[options]');
    });
  });
});

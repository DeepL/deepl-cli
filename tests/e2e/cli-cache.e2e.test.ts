/**
 * E2E Tests for Cache Command
 * Tests the `deepl cache` command end-to-end
 */

import { createTestConfigDir, makeNodeRunCLI } from '../helpers';

describe('Cache Command E2E', () => {
  const testConfig = createTestConfigDir('e2e-cache');
  const { runCLI, runCLIAll, runCLIExpectError } = makeNodeRunCLI(testConfig.path);

  afterAll(() => {
    testConfig.cleanup();
  });

  // Each assertion below runs in a process separate from the one that
  // toggled the cache, so an in-memory-only toggle cannot satisfy them.
  describe('enable/disable persistence across processes', () => {
    const toggleConfig = createTestConfigDir('e2e-cache-toggle');
    const toggle = makeNodeRunCLI(toggleConfig.path);

    afterAll(() => {
      toggleConfig.cleanup();
    });

    it('should report disabled from a later invocation after cache disable', () => {
      expect(toggle.runCLIAll('cache disable')).toContain('Cache disabled');

      expect(toggle.runCLI('cache stats')).toContain('Cache Status: disabled');
      expect(toggle.runCLI('config get cache.enabled').trim()).toBe('false');
    });

    it('should report enabled from a later invocation after cache enable', () => {
      toggle.runCLIAll('cache disable');
      expect(toggle.runCLIAll('cache enable')).toContain('Cache enabled');

      expect(toggle.runCLI('cache stats')).toContain('Cache Status: enabled');
      expect(toggle.runCLI('config get cache.enabled').trim()).toBe('true');
    });

    it('should report disabled when cache.enabled is set through config directly', () => {
      toggle.runCLIAll('config set cache.enabled false');

      expect(toggle.runCLI('cache stats')).toContain('Cache Status: disabled');
    });

    it('should preserve --max-size while persisting the enabled flag', () => {
      toggle.runCLIAll('cache enable --max-size 100M');

      expect(toggle.runCLI('config get cache.enabled').trim()).toBe('true');
      expect(toggle.runCLI('config get cache.maxSize').trim()).toBe(String(100 * 1024 * 1024));
    });
  });

  describe('table fallback warning', () => {
    it('should prefix the non-TTY table fallback warning with WARN', () => {
      const output = runCLIAll('cache stats --format table');

      expect(output).toContain('WARN  --format table is not supported in non-TTY output; falling back to plain text');
    });
  });

  describe('cache --help', () => {
    it('should display help text', () => {
      const output = runCLI('cache --help');

      expect(output).toContain('Usage:');
      expect(output).toContain('cache');
      expect(output).toContain('Options:');
    });

    it('should describe the command', () => {
      const output = runCLI('cache --help');

      expect(output).toMatch(/cache|manage/i);
    });

    it('should list subcommands', () => {
      const output = runCLI('cache --help');

      expect(output).toContain('Commands:');
    });
  });

  describe('cache stats', () => {
    it('should show cache statistics', () => {
      const output = runCLI('cache stats');

      expect(output).toContain('Cache Status:');
      expect(output).toContain('Entries:');
      expect(output).toContain('Size:');
    });

    it('should exit successfully', () => {
      const result = runCLIExpectError('cache stats');
      expect(result.status).toBe(0);
    });
  });

  describe('cache clear', () => {
    it('should clear cache with --yes flag', () => {
      const output = runCLIAll('cache clear --yes');

      expect(output).toContain('Cache cleared successfully');
    });

    it('should accept -y short flag', () => {
      const output = runCLIAll('cache clear -y');

      expect(output).toContain('Cache cleared successfully');
    });

    it('should abort without --yes in non-TTY mode', () => {
      const output = runCLIAll('cache clear');

      expect(output).toContain('Aborted');
    });
  });

  describe('cache enable/disable', () => {
    it('should enable cache', () => {
      const output = runCLIAll('cache enable');

      expect(output).toContain('Cache enabled');
    });

    it('should disable cache', () => {
      const output = runCLIAll('cache disable');

      expect(output).toContain('Cache disabled');
    });
  });

  describe('cache workflow', () => {
    it('should handle enable -> clear -> stats -> disable', () => {
      const enableOutput = runCLIAll('cache enable');
      expect(enableOutput).toContain('Cache enabled');

      const clearOutput = runCLIAll('cache clear --yes');
      expect(clearOutput).toContain('Cache cleared successfully');

      const statsOutput = runCLI('cache stats');
      expect(statsOutput).toContain('Entries: 0');

      const disableOutput = runCLIAll('cache disable');
      expect(disableOutput).toContain('Cache disabled');
    });
  });

  describe('cache command structure', () => {
    it('should be registered as a command', () => {
      const helpOutput = runCLI('--help');

      expect(helpOutput).toContain('cache');
    });

    it('should show cache in main help with description', () => {
      const helpOutput = runCLI('--help');

      expect(helpOutput).toMatch(/cache/i);
    });
  });
});

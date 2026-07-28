 
import { Command } from 'commander';

jest.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const mockChalk: Record<string, unknown> & { level: number } = {
    level: 3,
    red: passthrough,
    green: passthrough,
    blue: passthrough,
    yellow: passthrough,
    gray: passthrough,
    bold: passthrough,
  };
  return { __esModule: true, default: mockChalk };
});

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    success: jest.fn(),
    output: jest.fn(),
    error: jest.fn(),
  },
}));

const mockCacheCommandInstance = {
  stats: jest.fn(),
  formatStats: jest.fn(),
  formatStatsTable: jest.fn().mockReturnValue('stats-table'),
  clear: jest.fn(),
  enable: jest.fn(),
  disable: jest.fn(),
};

async function withTTY<T>(value: boolean, fn: () => Promise<T> | T): Promise<T> {
  const original = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true, writable: true });
  }
}

jest.mock('../../src/cli/commands/cache', () => ({
  CacheCommand: jest.fn().mockImplementation(() => mockCacheCommandInstance),
}));

const mockConfirm = jest.fn();
jest.mock('../../src/utils/confirm', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

jest.mock('../../src/utils/parse-size', () => ({
  parseSize: jest.fn().mockImplementation((s: string) => {
    if (s === '100M') { return 104857600; }
    if (s === '1G') { return 1073741824; }
    return parseInt(s, 10);
  }),
  formatSize: jest.fn().mockImplementation((n: number) => `${(n / (1024 * 1024)).toFixed(0)} MB`),
}));

import { registerCache } from '../../src/cli/commands/register-cache';
import { Logger } from '../../src/utils/logger';

describe('registerCache', () => {
  let program: Command;
  const handleError = jest.fn() as jest.Mock & ((error: unknown) => never);
  let getCacheService: jest.Mock;
  let getConfigService: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const { CacheCommand } = require('../../src/cli/commands/cache');
    (CacheCommand as jest.Mock).mockImplementation(() => mockCacheCommandInstance);

    program = new Command();
    program.exitOverride();
    getCacheService = jest.fn().mockResolvedValue({});
    getConfigService = jest.fn().mockReturnValue({ getValue: jest.fn() });
    registerCache(program, { getConfigService, getCacheService, handleError });
  });

  describe('cache stats', () => {
    it('should display formatted stats', async () => {
      const stats = { entries: 10, totalSize: 5000, enabled: true };
      mockCacheCommandInstance.stats.mockResolvedValue(stats);
      mockCacheCommandInstance.formatStats.mockReturnValue('formatted stats');
      await program.parseAsync(['node', 'test', 'cache', 'stats']);
      expect(mockCacheCommandInstance.stats).toHaveBeenCalled();
      expect(mockCacheCommandInstance.formatStats).toHaveBeenCalledWith(stats);
      expect(Logger.output).toHaveBeenCalledWith('formatted stats');
    });

    it('should call handleError on failure', async () => {
      mockCacheCommandInstance.stats.mockRejectedValue(new Error('stats failed'));
      await program.parseAsync(['node', 'test', 'cache', 'stats']);
      expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'stats failed' }));
    });

    it('should output JSON with --format json', async () => {
      const stats = { entries: 10, totalSize: 5000, maxSize: 1048576, enabled: true };
      mockCacheCommandInstance.stats.mockResolvedValue(stats);
      await program.parseAsync(['node', 'test', 'cache', 'stats', '--format', 'json']);
      expect(Logger.output).toHaveBeenCalledWith(JSON.stringify(stats, null, 2));
      expect(mockCacheCommandInstance.formatStats).not.toHaveBeenCalled();
    });

    it('should render cli-table3 output when --format table and stdout is a TTY', async () => {
      const stats = { entries: 10, totalSize: 5000, maxSize: 1048576, enabled: true };
      mockCacheCommandInstance.stats.mockResolvedValue(stats);
      mockCacheCommandInstance.formatStatsTable.mockReturnValue('stats-table');

      await withTTY(true, async () => {
        await program.parseAsync(['node', 'test', 'cache', 'stats', '--format', 'table']);
      });

      expect(mockCacheCommandInstance.formatStatsTable).toHaveBeenCalledWith(stats);
      expect(mockCacheCommandInstance.formatStats).not.toHaveBeenCalled();
      expect(Logger.output).toHaveBeenCalledWith('stats-table');
      expect(Logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('non-TTY'));
    });

    it('should fall back to plain text with a warn when --format table in non-TTY', async () => {
      const stats = { entries: 10, totalSize: 5000, maxSize: 1048576, enabled: true };
      mockCacheCommandInstance.stats.mockResolvedValue(stats);
      mockCacheCommandInstance.formatStats.mockReturnValue('plain stats');

      await withTTY(false, async () => {
        await program.parseAsync(['node', 'test', 'cache', 'stats', '--format', 'table']);
      });

      expect(mockCacheCommandInstance.formatStatsTable).not.toHaveBeenCalled();
      expect(mockCacheCommandInstance.formatStats).toHaveBeenCalledWith(stats);
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('non-TTY'));
      expect(Logger.output).toHaveBeenCalledWith('plain stats');
    });
  });

  describe('unavailable cache backend', () => {
    it.each([
      ['stats', ['cache', 'stats']],
      ['clear', ['cache', 'clear', '--yes']],
      ['enable', ['cache', 'enable']],
      ['disable', ['cache', 'disable']],
    ])('cache %s reports a clear error when getCacheService resolves undefined', async (_name, args) => {
      getCacheService.mockResolvedValue(undefined);
      await program.parseAsync(['node', 'test', ...args]);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/cache.*unavailable/i) }),
      );
      const { CacheCommand } = require('../../src/cli/commands/cache');
      expect(CacheCommand as jest.Mock).not.toHaveBeenCalled();
    });
  });

  describe('cache clear', () => {
    it('should clear with --yes flag', async () => {
      mockCacheCommandInstance.clear.mockResolvedValue(undefined);
      await program.parseAsync(['node', 'test', 'cache', 'clear', '--yes']);
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockCacheCommandInstance.clear).toHaveBeenCalled();
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Cache cleared'));
    });

    it('should prompt and clear when confirmed', async () => {
      mockConfirm.mockResolvedValue(true);
      mockCacheCommandInstance.clear.mockResolvedValue(undefined);
      await program.parseAsync(['node', 'test', 'cache', 'clear']);
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockCacheCommandInstance.clear).toHaveBeenCalled();
    });

    it('should abort when not confirmed', async () => {
      mockConfirm.mockResolvedValue(false);
      await program.parseAsync(['node', 'test', 'cache', 'clear']);
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockCacheCommandInstance.clear).not.toHaveBeenCalled();
      expect(Logger.info).toHaveBeenCalledWith('Aborted.');
    });

    it('should show dry-run output', async () => {
      const stats = { entries: 42, totalSize: 1048576, enabled: true };
      mockCacheCommandInstance.stats.mockResolvedValue(stats);
      await program.parseAsync(['node', 'test', 'cache', 'clear', '--dry-run']);
      expect(mockCacheCommandInstance.clear).not.toHaveBeenCalled();
      expect(Logger.output).toHaveBeenCalledWith(expect.stringContaining('dry-run'));
    });

    it('should call handleError on failure', async () => {
      mockCacheCommandInstance.clear.mockRejectedValue(new Error('clear failed'));
      await program.parseAsync(['node', 'test', 'cache', 'clear', '-y']);
      expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'clear failed' }));
    });
  });

  describe('cache enable', () => {
    it('should enable cache without max-size', async () => {
      mockCacheCommandInstance.enable.mockResolvedValue(undefined);
      await program.parseAsync(['node', 'test', 'cache', 'enable']);
      expect(mockCacheCommandInstance.enable).toHaveBeenCalledWith(undefined);
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Cache enabled'));
    });

    it('should enable cache with --max-size', async () => {
      mockCacheCommandInstance.enable.mockResolvedValue(undefined);
      await program.parseAsync(['node', 'test', 'cache', 'enable', '--max-size', '100M']);
      expect(mockCacheCommandInstance.enable).toHaveBeenCalledWith(104857600);
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Cache enabled'));
      expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('Max size'));
    });

    it('should call handleError on failure', async () => {
      mockCacheCommandInstance.enable.mockRejectedValue(new Error('enable failed'));
      await program.parseAsync(['node', 'test', 'cache', 'enable']);
      expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'enable failed' }));
    });
  });

  describe('cache disable', () => {
    it('should disable cache', async () => {
      mockCacheCommandInstance.disable.mockResolvedValue(undefined);
      await program.parseAsync(['node', 'test', 'cache', 'disable']);
      expect(mockCacheCommandInstance.disable).toHaveBeenCalled();
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Cache disabled'));
    });

    it('should call handleError on failure', async () => {
      mockCacheCommandInstance.disable.mockRejectedValue(new Error('disable failed'));
      await program.parseAsync(['node', 'test', 'cache', 'disable']);
      expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disable failed' }));
    });
  });
});

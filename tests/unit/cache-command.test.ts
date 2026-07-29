/**
 * Tests for Cache Command
 */

import { CacheCommand } from '../../src/cli/commands/cache';
import { CacheService } from '../../src/storage/cache';
import { ConfigService } from '../../src/storage/config';
import { createMockCacheService, createMockConfigService } from '../helpers/mock-factories';

// Mock CacheService
jest.mock('../../src/storage/cache');
jest.mock('../../src/storage/config');

describe('CacheCommand', () => {
  let cacheCommand: CacheCommand;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockCacheService = createMockCacheService();

    mockConfigService = createMockConfigService();

    cacheCommand = new CacheCommand(mockCacheService, mockConfigService);
  });

  describe('stats()', () => {
    it('should return cache statistics', async () => {
      mockCacheService.stats.mockReturnValue({
        entries: 10,
        totalSize: 1024 * 50, // 50KB
        maxSize: 1024 * 1024 * 1024, // 1GB
        enabled: true,
      });

      const stats = await cacheCommand.stats();

      expect(stats).toEqual({
        entries: 10,
        totalSize: 1024 * 50,
        maxSize: 1024 * 1024 * 1024,
        enabled: true,
      });
      expect(mockCacheService.stats).toHaveBeenCalledTimes(1);
    });

    it('should return stats when cache is empty', async () => {
      mockCacheService.stats.mockReturnValue({
        entries: 0,
        totalSize: 0,
        maxSize: 1024 * 1024 * 1024,
        enabled: true,
      });

      const stats = await cacheCommand.stats();

      expect(stats.entries).toBe(0);
      expect(stats.totalSize).toBe(0);
    });

    it('should show disabled status', async () => {
      mockCacheService.stats.mockReturnValue({
        entries: 5,
        totalSize: 1024,
        maxSize: 1024 * 1024 * 1024,
        enabled: false,
      });

      const stats = await cacheCommand.stats();

      expect(stats.enabled).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should clear all cache entries', async () => {
      mockCacheService.clear.mockReturnValue(undefined);

      await cacheCommand.clear();

      expect(mockCacheService.clear).toHaveBeenCalledTimes(1);
    });

    it('should not throw error when cache is already empty', async () => {
      mockCacheService.clear.mockReturnValue(undefined);

      await expect(cacheCommand.clear()).resolves.not.toThrow();
    });
  });

  describe('enable()', () => {
    it('should enable cache', async () => {
      mockCacheService.enable.mockReturnValue(undefined);

      await cacheCommand.enable();

      expect(mockCacheService.enable).toHaveBeenCalledTimes(1);
    });

    it('should persist cache.enabled so the next process sees it', async () => {
      mockCacheService.enable.mockReturnValue(undefined);

      await cacheCommand.enable();

      expect(mockConfigService.set).toHaveBeenCalledWith('cache.enabled', true);
    });

    it('should not throw error if cache is already enabled', async () => {
      mockCacheService.enable.mockReturnValue(undefined);

      await expect(cacheCommand.enable()).resolves.not.toThrow();
    });

    it('should set max size when provided', async () => {
      mockCacheService.enable.mockReturnValue(undefined);
      mockCacheService.setMaxSize.mockReturnValue(undefined);
      mockConfigService.set.mockReturnValue(undefined);

      const maxSize = 1024 * 1024 * 500; // 500MB
      await cacheCommand.enable(maxSize);

      expect(mockConfigService.set).toHaveBeenCalledWith('cache.maxSize', maxSize);
      expect(mockCacheService.setMaxSize).toHaveBeenCalledWith(maxSize);
      expect(mockCacheService.enable).toHaveBeenCalledTimes(1);
    });

    it('should not set max size when not provided', async () => {
      mockCacheService.enable.mockReturnValue(undefined);

      await cacheCommand.enable();

      expect(mockConfigService.set).not.toHaveBeenCalledWith('cache.maxSize', expect.anything());
      expect(mockCacheService.setMaxSize).not.toHaveBeenCalled();
      expect(mockCacheService.enable).toHaveBeenCalledTimes(1);
    });

    it('should handle zero as max size', async () => {
      mockCacheService.enable.mockReturnValue(undefined);
      mockCacheService.setMaxSize.mockReturnValue(undefined);
      mockConfigService.set.mockReturnValue(undefined);

      await cacheCommand.enable(0);

      expect(mockConfigService.set).toHaveBeenCalledWith('cache.maxSize', 0);
      expect(mockCacheService.setMaxSize).toHaveBeenCalledWith(0);
    });
  });

  describe('disable()', () => {
    it('should disable cache', async () => {
      mockCacheService.disable.mockReturnValue(undefined);

      await cacheCommand.disable();

      expect(mockCacheService.disable).toHaveBeenCalledTimes(1);
    });

    it('should not throw error if cache is already disabled', async () => {
      mockCacheService.disable.mockReturnValue(undefined);

      await expect(cacheCommand.disable()).resolves.not.toThrow();
    });

    it('should persist cache.enabled so the next process sees it', async () => {
      mockCacheService.disable.mockReturnValue(undefined);

      await cacheCommand.disable();

      expect(mockConfigService.set).toHaveBeenCalledWith('cache.enabled', false);
    });
  });

  describe('formatStats()', () => {
    it('should format cache statistics for display', () => {
      const stats = {
        entries: 10,
        totalSize: 1024 * 1024 * 50, // 50MB
        maxSize: 1024 * 1024 * 1024, // 1GB
        enabled: true,
      };

      const formatted = cacheCommand.formatStats(stats);

      expect(formatted).toContain('10');
      expect(formatted).toContain('50');
      expect(formatted).toContain('1024');
      expect(formatted).toContain('enabled');
    });

    it('should format bytes to MB', () => {
      const stats = {
        entries: 5,
        totalSize: 1024 * 1024 * 100, // 100MB
        maxSize: 1024 * 1024 * 1024, // 1GB
        enabled: true,
      };

      const formatted = cacheCommand.formatStats(stats);

      expect(formatted).toContain('100');
    });

    it('should format bytes to GB', () => {
      const stats = {
        entries: 5,
        totalSize: 1024 * 1024 * 1024 * 0.5, // 0.5GB
        maxSize: 1024 * 1024 * 1024 * 2, // 2GB
        enabled: true,
      };

      const formatted = cacheCommand.formatStats(stats);

      expect(formatted).toContain('512');
      expect(formatted).toContain('2048');
    });

    it('should show disabled status', () => {
      const stats = {
        entries: 5,
        totalSize: 1024,
        maxSize: 1024 * 1024,
        enabled: false,
      };

      const formatted = cacheCommand.formatStats(stats);

      expect(formatted).toContain('disabled');
    });
  });

  describe('edge cases', () => {
    it('should handle cache service errors gracefully', async () => {
      mockCacheService.stats.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(cacheCommand.stats()).rejects.toThrow('Database error');
    });

    it('should handle very large cache sizes', async () => {
      mockCacheService.stats.mockReturnValue({
        entries: 1000000,
        totalSize: 1024 * 1024 * 1024 * 10, // 10GB
        maxSize: 1024 * 1024 * 1024 * 20, // 20GB
        enabled: true,
      });

      const stats = await cacheCommand.stats();

      expect(stats.entries).toBe(1000000);
    });
  });

  describe('formatStatsTable', () => {
    const stats = {
      entries: 142,
      totalSize: 25 * 1024 * 1024,   // 25 MB
      maxSize: 100 * 1024 * 1024,    // 100 MB
      enabled: true,
    };

    it('should render Metric/Value columns with all five rows', () => {
      const result = cacheCommand.formatStatsTable(stats);
      expect(result).toContain('Metric');
      expect(result).toContain('Value');
      expect(result).toContain('Status');
      expect(result).toContain('enabled');
      expect(result).toContain('Entries');
      expect(result).toContain('142');
      expect(result).toContain('Used');
      expect(result).toContain('25.00 MB');
      expect(result).toContain('Limit');
      expect(result).toContain('100.00 MB');
      expect(result).toContain('Usage');
      expect(result).toContain('25.0%');
    });

    it('should report disabled status', () => {
      const result = cacheCommand.formatStatsTable({ ...stats, enabled: false });
      expect(result).toContain('disabled');
    });

    it('should report 0.0% usage when maxSize is zero', () => {
      const result = cacheCommand.formatStatsTable({ ...stats, totalSize: 0, maxSize: 0 });
      expect(result).toContain('0.0%');
    });
  });
});

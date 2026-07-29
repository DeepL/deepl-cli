/**
 * Tests for the lazy cache-service getter used by the CLI entry point.
 * A cache backend that cannot load must degrade to "no cache" with a
 * single warning, not crash the command or retry on every call.
 */

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    output: jest.fn(),
  },
}));

import { createCacheServiceGetter, resolveCacheOptions } from '../../src/cli/cache-loader';
import { Logger } from '../../src/utils/logger';
import type { CacheService } from '../../src/storage/cache';
import type { ConfigService } from '../../src/storage/config';

function fakeConfig(values: Record<string, unknown>): ConfigService {
  return { getValue: (key: string) => values[key] } as unknown as ConfigService;
}

function makeError(message: string, code?: string): Error {
  const error = new Error(message);
  if (code) {
    (error as NodeJS.ErrnoException).code = code;
  }
  return error;
}

describe('resolveCacheOptions', () => {
  it('carries cache.enabled through to the cache service', () => {
    expect(resolveCacheOptions(fakeConfig({ 'cache.enabled': false }), '/tmp/cache.db').enabled).toBe(false);
    expect(resolveCacheOptions(fakeConfig({ 'cache.enabled': true }), '/tmp/cache.db').enabled).toBe(true);
  });

  it('converts the configured TTL from seconds to milliseconds', () => {
    const options = resolveCacheOptions(fakeConfig({ 'cache.ttl': 90 }), '/tmp/cache.db');
    expect(options.ttl).toBe(90_000);
  });

  it('passes the db path and max size through unchanged', () => {
    const options = resolveCacheOptions(fakeConfig({ 'cache.maxSize': 4096 }), '/tmp/cache.db');
    expect(options.dbPath).toBe('/tmp/cache.db');
    expect(options.maxSize).toBe(4096);
  });

  it('leaves unset keys undefined so the service defaults apply', () => {
    const options = resolveCacheOptions(fakeConfig({}), '/tmp/cache.db');
    expect(options.ttl).toBeUndefined();
    expect(options.maxSize).toBeUndefined();
    expect(options.enabled).toBeUndefined();
  });
});

describe('createCacheServiceGetter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when the cache module loads', () => {
    it('returns the singleton constructed with the resolved options', async () => {
      const fakeInstance = { get: jest.fn() } as unknown as CacheService;
      const getInstance = jest.fn().mockReturnValue(fakeInstance);
      const importer = jest.fn().mockResolvedValue({
        CacheService: { getInstance },
      });
      const options = { dbPath: '/tmp/cache.db', ttl: 1000, maxSize: 42 };

      const getCacheService = createCacheServiceGetter(() => options, importer);

      await expect(getCacheService()).resolves.toBe(fakeInstance);
      expect(getInstance).toHaveBeenCalledWith(options);
      expect(Logger.warn).not.toHaveBeenCalled();
    });

    it('reuses the instance instead of re-importing', async () => {
      const fakeInstance = {} as CacheService;
      const importer = jest.fn().mockResolvedValue({
        CacheService: { getInstance: jest.fn().mockReturnValue(fakeInstance) },
      });

      const getCacheService = createCacheServiceGetter(() => ({}), importer);

      await getCacheService();
      await expect(getCacheService()).resolves.toBe(fakeInstance);
      expect(importer).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the dynamic import rejects (e.g. ABI mismatch)', () => {
    const abiError = makeError(
      "The module '/x/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 137.",
      'ERR_DLOPEN_FAILED',
    );

    it('returns undefined instead of throwing', async () => {
      const importer = jest.fn().mockRejectedValue(abiError);
      const getCacheService = createCacheServiceGetter(() => ({}), importer);

      await expect(getCacheService()).resolves.toBeUndefined();
    });

    it('warns exactly once, tells the user what to do, and says caching is off', async () => {
      const importer = jest.fn().mockRejectedValue(abiError);
      const getCacheService = createCacheServiceGetter(() => ({}), importer);

      await getCacheService();
      await getCacheService();
      await getCacheService();

      expect(Logger.warn).toHaveBeenCalledTimes(1);
      const warning = (Logger.warn as jest.Mock).mock.calls[0]![0] as string;
      expect(warning).toContain('Caching is disabled for this run');
      expect(warning).toContain('has not been modified');
      expect(warning).toMatch(/reinstall|Node\.js version/i);
    });

    it('latches: does not retry the import on subsequent calls', async () => {
      const importer = jest.fn().mockRejectedValue(abiError);
      const getCacheService = createCacheServiceGetter(() => ({}), importer);

      await getCacheService();
      await getCacheService();

      expect(importer).toHaveBeenCalledTimes(1);
    });
  });

  describe('when construction fails after a successful import', () => {
    it('degrades to undefined with a single warning', async () => {
      const importer = jest.fn().mockResolvedValue({
        CacheService: {
          getInstance: jest.fn(() => {
            throw makeError('disk I/O error');
          }),
        },
      });
      const getCacheService = createCacheServiceGetter(() => ({}), importer);

      await expect(getCacheService()).resolves.toBeUndefined();
      await expect(getCacheService()).resolves.toBeUndefined();

      expect(Logger.warn).toHaveBeenCalledTimes(1);
      const warning = (Logger.warn as jest.Mock).mock.calls[0]![0] as string;
      expect(warning).toContain('disk I/O error');
      expect(warning).toContain('Caching is disabled for this run');
    });
  });
});

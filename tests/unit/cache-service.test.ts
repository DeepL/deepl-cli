/**
 * Tests for Cache Service
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    output: jest.fn(),
  },
}));

import { Logger } from '../../src/utils/logger';
import { CacheService } from '../../src/storage/cache';

describe('CacheService', () => {
  let cacheService: CacheService;
  let testCacheDir: string;
  let testCachePath: string;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create temporary cache directory
    testCacheDir = path.join(os.tmpdir(), `deepl-cli-test-${Date.now()}`);
    testCachePath = path.join(testCacheDir, 'cache.db');

    // Ensure directory exists before creating cache service
    if (!fs.existsSync(testCacheDir)) {
      fs.mkdirSync(testCacheDir, { recursive: true });
    }

    // Create cache service with test path
    cacheService = new CacheService({ dbPath: testCachePath, maxSize: 1024 * 100 }); // 100KB for tests
  });

  afterEach(() => {
    // Cleanup
    if (cacheService) {
      cacheService.close();
    }
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create a new CacheService instance', () => {
      expect(cacheService).toBeInstanceOf(CacheService);
    });

    it('should create database file', () => {
      expect(fs.existsSync(testCachePath)).toBe(true);
    });

    it('should create cache directory if it does not exist', () => {
      expect(fs.existsSync(testCacheDir)).toBe(true);
    });

    it('should initialize with default settings', () => {
      const stats = cacheService.stats();
      expect(stats.entries).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.enabled).toBe(true);
    });

    it('should use WAL journal mode', () => {
      const db = (cacheService as any).db;
      const result = db.prepare('PRAGMA journal_mode').get();
      expect(result).toEqual({ journal_mode: 'wal' });
    });

    it('should stamp user_version = 1 on a fresh database', () => {
      const db = (cacheService as any).db;
      const result = db.prepare('PRAGMA user_version').get();
      expect(result).toEqual({ user_version: 1 });
    });

    it('should upgrade-stamp a pre-versioned (user_version=0) database in place', () => {
      // Simulate a DB created before schema versioning: stamp 0, close,
      // reopen via a new CacheService, verify it got stamped to 1 and
      // existing data survived.
      const db = (cacheService as any).db;
      db.exec('PRAGMA user_version = 0');
      cacheService.set('preexisting', { text: 'survives' });
      cacheService.close();

      const reopened = new CacheService({ dbPath: testCachePath });
      try {
        const reopenedDb = (reopened as any).db;
        expect(reopenedDb.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
        expect(reopened.get('preexisting')).toEqual({ text: 'survives' });
      } finally {
        reopened.close();
      }
    });

    it('should back up a corrupted database rather than unlinking it', () => {
      // Write a non-SQLite file to the cache path. The constructor's
      // openDatabase catch should rename it aside and recreate.
      cacheService.close();
      fs.rmSync(testCachePath, { force: true });
      fs.writeFileSync(testCachePath, 'not a sqlite database');

      const svc = new CacheService({ dbPath: testCachePath });
      try {
        // Fresh DB opened successfully at the original path.
        expect((svc as any).db).toBeDefined();
        // The corrupted original was renamed, not deleted.
        const backups = fs
          .readdirSync(testCacheDir)
          .filter((f) => f.startsWith(path.basename(testCachePath) + '.corrupt-'));
        expect(backups.length).toBeGreaterThan(0);
      } finally {
        svc.close();
      }
    });
  });

  describe('get()', () => {
    it('should return null for non-existent key', () => {
      const value = cacheService.get('nonexistent');
      expect(value).toBeNull();
    });

    it('should retrieve cached value', () => {
      cacheService.set('test-key', { text: 'Hello' });
      const value = cacheService.get('test-key');
      expect(value).toEqual({ text: 'Hello' });
    });

    it('should return null when cache is disabled', () => {
      cacheService.set('test-key', { text: 'Hello' });
      cacheService.disable();
      const value = cacheService.get('test-key');
      expect(value).toBeNull();
    });

    it('should handle expired entries', () => {
      jest.useFakeTimers();
      const shortTTL = 100; // 100ms
      const service = new CacheService({ dbPath: testCachePath, ttl: shortTTL });

      service.set('test-key', { text: 'Hello' });

      // Advance Date.now() past expiration
      jest.advanceTimersByTime(150);

      const value = service.get('test-key');
      expect(value).toBeNull();

      service.close();
      jest.useRealTimers();
    });
  });

  describe('get() with type guard', () => {
    const isMyType = (data: unknown): data is { text: string } => {
      if (data === null || typeof data !== 'object') {
        return false;
      }
      const record = data as Record<string, unknown>;
      return typeof record['text'] === 'string';
    };

    it('should return typed value when guard passes', () => {
      cacheService.set('test-key', { text: 'Hello' });
      const value = cacheService.get('test-key', isMyType);
      expect(value).toEqual({ text: 'Hello' });
    });

    it('should return null and delete entry when guard fails', () => {
      cacheService.set('test-key', { number: 42 });
      const value = cacheService.get('test-key', isMyType);
      expect(value).toBeNull();

      // Entry should be deleted
      const raw = cacheService.get('test-key');
      expect(raw).toBeNull();
    });

    it('should log warning when guard fails', () => {
      cacheService.set('test-key', { number: 42 });
      cacheService.get('test-key', isMyType);

      expect(Logger.warn).toHaveBeenCalledTimes(1);
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('type mismatch'));
    });

    it('should work without guard (backward compatible)', () => {
      cacheService.set('test-key', { text: 'Hello' });
      const value = cacheService.get('test-key');
      expect(value).toEqual({ text: 'Hello' });
    });
  });

  describe('set()', () => {
    it('should store value in cache', () => {
      cacheService.set('test-key', { text: 'Hello' });
      const value = cacheService.get('test-key');
      expect(value).toEqual({ text: 'Hello' });
    });

    it('should update existing key', () => {
      cacheService.set('test-key', { text: 'Hello' });
      cacheService.set('test-key', { text: 'Updated' });
      const value = cacheService.get('test-key');
      expect(value).toEqual({ text: 'Updated' });
    });

    it('should not store when cache is disabled', () => {
      cacheService.disable();
      cacheService.set('test-key', { text: 'Hello' });
      cacheService.enable();
      const value = cacheService.get('test-key');
      expect(value).toBeNull();
    });

    it('should handle complex objects', () => {
      const complexObj = {
        text: 'Hello',
        meta: { lang: 'es', formality: 'more' },
        translations: ['Hola', 'Buenos días'],
      };
      cacheService.set('complex', complexObj);
      const value = cacheService.get('complex');
      expect(value).toEqual(complexObj);
    });

    it('should track entry size correctly', () => {
      cacheService.set('test', { text: 'Hello' });
      const stats = cacheService.stats();
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe('clear()', () => {
    it('should remove all cached entries', () => {
      cacheService.set('key1', { text: 'Value 1' });
      cacheService.set('key2', { text: 'Value 2' });
      cacheService.clear();

      const value1 = cacheService.get('key1');
      const value2 = cacheService.get('key2');

      expect(value1).toBeNull();
      expect(value2).toBeNull();
    });

    it('should reset stats after clear', () => {
      cacheService.set('key1', { text: 'Value 1' });
      cacheService.clear();

      const stats = cacheService.stats();
      expect(stats.entries).toBe(0);
      expect(stats.totalSize).toBe(0);
    });
  });

  describe('stats()', () => {
    it('should return cache statistics', () => {
      const stats = cacheService.stats();
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('enabled');
    });

    it('should track number of entries', () => {
      cacheService.set('key1', { text: 'Value 1' });
      cacheService.set('key2', { text: 'Value 2' });

      const stats = cacheService.stats();
      expect(stats.entries).toBe(2);
    });

    it('should calculate total size', () => {
      cacheService.set('key1', { text: 'Small' });
      cacheService.set('key2', { text: 'A much longer text value' });

      const stats = cacheService.stats();
      expect(stats.totalSize).toBeGreaterThan(0);
    });

    it('should show maxSize configuration', () => {
      const stats = cacheService.stats();
      expect(stats.maxSize).toBe(1024 * 100); // 100KB from beforeEach
    });
  });

  describe('enabled option', () => {
    it('should default to enabled when the option is omitted', () => {
      expect(cacheService.stats().enabled).toBe(true);
    });

    it('should start disabled when constructed with enabled: false', () => {
      const disabled = new CacheService({ dbPath: path.join(testCacheDir, 'disabled.db'), enabled: false });
      try {
        expect(disabled.stats().enabled).toBe(false);
      } finally {
        disabled.close();
      }
    });

    it('should not read or write entries when constructed disabled', () => {
      const disabled = new CacheService({ dbPath: path.join(testCacheDir, 'disabled-io.db'), enabled: false });
      try {
        disabled.set('test', { text: 'Hello' });
        expect(disabled.get('test')).toBeNull();
        expect(disabled.stats().entries).toBe(0);
      } finally {
        disabled.close();
      }
    });

    it('should allow enable() to override a disabled start', () => {
      const disabled = new CacheService({ dbPath: path.join(testCacheDir, 'reenable.db'), enabled: false });
      try {
        disabled.enable();
        disabled.set('test', { text: 'Hello' });
        expect(disabled.get('test')).toEqual({ text: 'Hello' });
      } finally {
        disabled.close();
      }
    });
  });

  describe('enable() / disable()', () => {
    it('should enable cache', () => {
      cacheService.disable();
      cacheService.enable();
      const stats = cacheService.stats();
      expect(stats.enabled).toBe(true);
    });

    it('should disable cache', () => {
      cacheService.disable();
      const stats = cacheService.stats();
      expect(stats.enabled).toBe(false);
    });

    it('should prevent caching when disabled', () => {
      cacheService.disable();
      cacheService.set('test', { text: 'Hello' });
      cacheService.enable();
      const value = cacheService.get('test');
      expect(value).toBeNull();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when cache is full', () => {
      // Fill cache to capacity
      const largeValue = { text: 'x'.repeat(1000) }; // ~1KB per entry

      // Fill cache completely
      for (let i = 0; i < 150; i++) {
        cacheService.set(`key-${i}`, largeValue);
      }

      const stats = cacheService.stats();

      // Cache should be at or under max size
      expect(stats.totalSize).toBeLessThanOrEqual(stats.maxSize);

      // Some entries should have been evicted (can't fit all 150)
      expect(stats.entries).toBeLessThan(150);

      // Oldest entries should be gone, newest should exist
      const veryOldEntry = cacheService.get('key-0');
      const recentEntry = cacheService.get('key-149');

      expect(veryOldEntry).toBeNull();
      expect(recentEntry).toEqual({ text: 'x'.repeat(1000) });
    });

    it('should maintain cache size under maxSize', () => {
      const largeValue = { text: 'x'.repeat(1000) };

      for (let i = 0; i < 150; i++) {
        cacheService.set(`key-${i}`, largeValue);
      }

      const stats = cacheService.stats();
      expect(stats.totalSize).toBeLessThanOrEqual(stats.maxSize);
    });

    it('should evict multiple entries if needed', () => {
      // Fill cache completely
      for (let i = 0; i < 100; i++) {
        cacheService.set(`key-${i}`, { text: 'x'.repeat(1000) });
      }

      // Add very large entry that should require evicting multiple small ones
      cacheService.set('huge', { text: 'x'.repeat(30000) }); // ~30KB

      const statsAfter = cacheService.stats();

      // Cache should still be under max size
      expect(statsAfter.totalSize).toBeLessThanOrEqual(statsAfter.maxSize);

      // Large entry should exist
      const largeEntry = cacheService.get('huge');
      expect(largeEntry).toHaveProperty('text');

      // At least some old entries should have been evicted
      const oldEntry = cacheService.get('key-0');
      expect(oldEntry).toBeNull();
    });

    it('should evict entries efficiently without loading all into memory (Issue #9)', () => {
      // Create a cache service with small max size for testing
      const smallCache = new CacheService({
        dbPath: testCachePath,
        maxSize: 10 * 1024, // 10KB
      });

      // Fill cache with many small entries (simulate large cache)
      for (let i = 0; i < 50; i++) {
        smallCache.set(`key-${i}`, { text: 'x'.repeat(200) }); // ~200 bytes each
      }

      const statsBefore = smallCache.stats();

      // Cache should be at capacity
      expect(statsBefore.totalSize).toBeLessThanOrEqual(statsBefore.maxSize);

      // Add new entry that requires eviction
      smallCache.set('new-key', { text: 'x'.repeat(1000) }); // ~1KB

      const statsAfter = smallCache.stats();

      // Cache should still be under max size
      expect(statsAfter.totalSize).toBeLessThanOrEqual(statsAfter.maxSize);

      // New entry should exist
      const newEntry = smallCache.get('new-key');
      expect(newEntry).toHaveProperty('text');

      // Oldest entries should be evicted
      const veryOldEntry = smallCache.get('key-0');
      expect(veryOldEntry).toBeNull();

      // Some recent entries should still exist
      const recentEntry = smallCache.get(`key-${49}`);
      expect(recentEntry).toHaveProperty('text');

      smallCache.close();
    });
  });

  describe('TTL (Time To Live)', () => {
    it('should respect TTL setting', () => {
      jest.useFakeTimers();
      const service = new CacheService({
        dbPath: testCachePath,
        ttl: 100, // 100ms
      });

      service.set('test', { text: 'Hello' });

      // Should exist immediately
      let value = service.get('test');
      expect(value).toEqual({ text: 'Hello' });

      // Should expire after TTL
      jest.advanceTimersByTime(150);
      value = service.get('test');
      expect(value).toBeNull();

      service.close();
      jest.useRealTimers();
    });

    it('should not expire entries when TTL is disabled', () => {
      jest.useFakeTimers();
      const service = new CacheService({
        dbPath: testCachePath,
        ttl: 0, // Disabled
      });

      service.set('test', { text: 'Hello' });
      jest.advanceTimersByTime(100);

      const value = service.get('test');
      expect(value).toEqual({ text: 'Hello' });

      service.close();
      jest.useRealTimers();
    });
  });

  describe('edge cases', () => {
    it('should handle empty values', () => {
      cacheService.set('empty', '');
      const value = cacheService.get('empty');
      expect(value).toBe('');
    });

    it('should handle null values', () => {
      cacheService.set('null', null);
      const value = cacheService.get('null');
      expect(value).toBeNull();
    });

    it('should not cache undefined values (Issue #10)', () => {
      // Undefined values should not be cached (no entry created)
      // This avoids the fragile magic string approach
      cacheService.set('undefined-key', undefined);

      // Should return null (cache miss) since undefined wasn't stored
      const value = cacheService.get('undefined-key');
      expect(value).toBeNull();

      // No cache entry should exist
      const stats = cacheService.stats();
      expect(stats.entries).toBe(0);
    });

    it('should handle very large entries', () => {
      const largeValue = { text: 'x'.repeat(50000) }; // ~50KB
      cacheService.set('large', largeValue);
      const value = cacheService.get('large');
      expect(value).toEqual(largeValue);
    });

    it('should handle special characters in keys', () => {
      const specialKey = 'key:with/special\\chars';
      cacheService.set(specialKey, { text: 'Hello' });
      const value = cacheService.get(specialKey);
      expect(value).toEqual({ text: 'Hello' });
    });

    it('should handle concurrent operations', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(Promise.resolve(cacheService.set(`concurrent-${i}`, { value: i })));
      }

      await Promise.all(promises);

      const stats = cacheService.stats();
      expect(stats.entries).toBe(10);
    });

    it('should truncate cache key in corruption warning to first 8 characters', () => {
      // Use a long SHA-256-like key (64 hex characters)
      const longKey = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

      const db = (cacheService as any).db;
      const timestamp = Date.now();
      db.prepare(`
        INSERT INTO cache (key, value, timestamp, size)
        VALUES (?, ?, ?, ?)
      `).run(longKey, 'not-valid-json{{{', timestamp, 18);

      const value = cacheService.get(longKey);
      expect(value).toBeNull();

      expect(Logger.warn).toHaveBeenCalledTimes(1);
      const warningMsg = (Logger.warn as jest.Mock).mock.calls[0]![0] as string;
      // Should show truncated key (first 8 chars + "...")
      expect(warningMsg).toContain('a1b2c3d4...');
      // Should NOT contain the full key
      expect(warningMsg).not.toContain(longKey);
    });

    it('should not truncate short cache keys in corruption warning', () => {
      const shortKey = 'abcd1234';

      const db = (cacheService as any).db;
      const timestamp = Date.now();
      db.prepare(`
        INSERT INTO cache (key, value, timestamp, size)
        VALUES (?, ?, ?, ?)
      `).run(shortKey, 'bad-json!!!', timestamp, 11);

      cacheService.get(shortKey);

      expect(Logger.warn).toHaveBeenCalledTimes(1);
      const warningMsg = (Logger.warn as jest.Mock).mock.calls[0]![0] as string;
      // Short key (8 chars or fewer) should appear as-is without truncation
      expect(warningMsg).toContain(shortKey);
      expect(warningMsg).not.toContain('...');
    });

    it('should log warning when cache corruption is detected (Issue #11)', () => {
      const db = (cacheService as any).db;
      const timestamp = Date.now();
      db.prepare(`
        INSERT INTO cache (key, value, timestamp, size)
        VALUES (?, ?, ?, ?)
      `).run('corrupted-key', 'invalid-json-{', timestamp, 15);

      // Attempt to retrieve the corrupted entry
      const value = cacheService.get('corrupted-key');

      // Should return null (entry was removed)
      expect(value).toBeNull();

      // Should have logged a warning about corruption via Logger
      expect(Logger.warn).toHaveBeenCalled();
      const firstCall = (Logger.warn as jest.Mock).mock.calls[0];
      expect(firstCall).toBeDefined();
      expect(firstCall![0]).toContain('corruption');
      expect(firstCall![0]).toContain('corrupte...');

      // Entry should be deleted from cache
      const stats = cacheService.stats();
      expect(stats.entries).toBe(0);
    });
  });

  describe('database cleanup', () => {
    it('should remove expired entries on cleanup', () => {
      jest.useFakeTimers();
      const service = new CacheService({
        dbPath: testCachePath,
        ttl: 100,
      });

      service.set('key1', { text: 'Value 1' });
      service.set('key2', { text: 'Value 2' });

      jest.advanceTimersByTime(150);

      service.set('key3', { text: 'Value 3' });

      // Force cleanup since amortized interval hasn't elapsed
      service.forceCleanup();

      const stats = service.stats();
      expect(stats.entries).toBe(1); // Only key3 should remain

      service.close();
      jest.useRealTimers();
    });

    it('should skip cleanup when interval has not elapsed', () => {
      const service = new CacheService({
        dbPath: testCachePath,
        ttl: 30 * 24 * 60 * 60 * 1000,
      });

      service.set('key1', { text: 'Value 1' });
      service.set('key2', { text: 'Value 2' });

      // Access the db to spy on prepare calls
      const db = (service as any).db;
      const originalPrepare = db.prepare.bind(db);
      let deleteCalls = 0;
      db.prepare = (sql: string) => {
        if (sql.includes('DELETE') && sql.includes('timestamp')) {
          deleteCalls++;
        }
        return originalPrepare(sql);
      };

      // Multiple get/set calls should not trigger cleanup each time
      service.get('key1');
      service.set('key3', { text: 'Value 3' });
      service.get('key2');

      expect(deleteCalls).toBe(0);

      db.prepare = originalPrepare;
      service.close();
    });

    it('should run cleanup when interval has elapsed', () => {
      const service = new CacheService({
        dbPath: testCachePath,
        ttl: 30 * 24 * 60 * 60 * 1000,
      });

      service.set('key1', { text: 'Value 1' });

      // Simulate elapsed time by setting lastCleanupTime to the past
      (service as any).lastCleanupTime = 0;

      const db = (service as any).db;
      const originalPrepare = db.prepare.bind(db);
      let deleteCalls = 0;
      db.prepare = (sql: string) => {
        if (sql.includes('DELETE') && sql.includes('timestamp')) {
          deleteCalls++;
        }
        return originalPrepare(sql);
      };

      service.get('key1');

      expect(deleteCalls).toBe(1);

      db.prepare = originalPrepare;
      service.close();
    });
  });

  describe('close()', () => {
    it('should close database connection', () => {
      expect(() => cacheService.close()).not.toThrow();
    });

    it('should allow reopening after close', () => {
      cacheService.close();
      const newService = new CacheService({ dbPath: testCachePath });
      expect(newService).toBeInstanceOf(CacheService);
      newService.close();
    });
  });

  describe('singleton pattern (Issue #4)', () => {
    it('should return same instance on multiple getInstance calls', () => {
      const instance1 = CacheService.getInstance({ dbPath: testCachePath });
      const instance2 = CacheService.getInstance({ dbPath: testCachePath });

      expect(instance1).toBe(instance2);

      instance1.close();
    });

    it('should register exit handlers only once', () => {
      // Spy on process.once to verify handlers are only registered once
      const processOnceSpy = jest.spyOn(process, 'once');

      // Reset the singleton (access private static field via any cast)
      (CacheService as any).instance = null;
      (CacheService as any).handlersRegistered = false;

      // Call getInstance multiple times
      const instance1 = CacheService.getInstance({ dbPath: testCachePath });
      const instance2 = CacheService.getInstance({ dbPath: testCachePath });
      const instance3 = CacheService.getInstance({ dbPath: testCachePath });

      // Should only have registered handlers once (3 calls: exit, SIGINT, SIGTERM)
      expect(processOnceSpy).toHaveBeenCalledTimes(3);

      // All instances should be the same
      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);

      processOnceSpy.mockRestore();
      instance1.close();
    });

    it('should create new instance after close', () => {
      const instance1 = CacheService.getInstance({ dbPath: testCachePath });
      instance1.close();

      const instance2 = CacheService.getInstance({ dbPath: testCachePath });

      // Should be a different instance since first was closed
      expect(instance1).not.toBe(instance2);

      instance2.close();
    });

    it('should handle rapid getInstance calls without race condition', () => {
      // Reset singleton
      (CacheService as any).instance = null;
      (CacheService as any).handlersRegistered = false;

      // Spy on handler registration
      const processOnceSpy = jest.spyOn(process, 'once');

      // Simulate rapid calls (even though Node.js is single-threaded,
      // this tests the logic is correct)
      const instances = [];
      for (let i = 0; i < 10; i++) {
        instances.push(CacheService.getInstance({ dbPath: testCachePath }));
      }

      // All should be the same instance
      for (let i = 1; i < instances.length; i++) {
        expect(instances[i]).toBe(instances[0]);
      }

      // Handlers should only be registered once (3 calls: exit, SIGINT, SIGTERM)
      expect(processOnceSpy).toHaveBeenCalledTimes(3);

      processOnceSpy.mockRestore();
      instances[0]?.close();
    });

    it('does not re-register signal handlers across close/recreate cycles', () => {
      (CacheService as any).instance = null;
      (CacheService as any).handlersRegistered = false;

      const instance1 = CacheService.getInstance({ dbPath: testCachePath });
      instance1.close();

      const processOnceSpy = jest.spyOn(process, 'once');

      let last: CacheService | undefined;
      for (let i = 0; i < 5; i++) {
        last = CacheService.getInstance({ dbPath: testCachePath });
        last.close();
      }

      // Re-registering per cycle accumulates listeners until Node prints
      // MaxListenersExceededWarning to the user's stderr.
      expect(processOnceSpy).not.toHaveBeenCalled();

      processOnceSpy.mockRestore();
      last?.close();
    });

    it('should null instance on close but keep handlers registered', () => {
      (CacheService as any).instance = null;
      (CacheService as any).handlersRegistered = false;

      const instance = CacheService.getInstance({ dbPath: testCachePath });
      instance.close();

      expect((CacheService as any).instance).toBeNull();
      expect((CacheService as any).handlersRegistered).toBe(true);
    });
  });

  describe('corruption recovery', () => {
    it('should recover from a corrupt database file', () => {
      cacheService.close();

      // Write garbage bytes to the database file
      fs.writeFileSync(testCachePath, 'THIS IS NOT A VALID SQLITE DATABASE');

      const recovered = new CacheService({ dbPath: testCachePath });
      expect(recovered).toBeInstanceOf(CacheService);

      // Should work normally after recovery
      recovered.set('key', { text: 'Hello' });
      expect(recovered.get('key')).toEqual({ text: 'Hello' });

      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cache database corrupted'));

      recovered.close();
    });

    it('should clean up WAL and SHM files during recovery', () => {
      cacheService.close();

      // Create WAL and SHM files alongside the corrupt DB
      fs.writeFileSync(testCachePath, 'CORRUPT');
      fs.writeFileSync(testCachePath + '-wal', 'OLD WAL GARBAGE DATA');
      fs.writeFileSync(testCachePath + '-shm', 'OLD SHM GARBAGE DATA');

      const recovered = new CacheService({ dbPath: testCachePath });

      // Old corrupt WAL/SHM content should be gone (SQLite may recreate fresh ones)
      if (fs.existsSync(testCachePath + '-wal')) {
        expect(fs.readFileSync(testCachePath + '-wal', 'utf8')).not.toBe('OLD WAL GARBAGE DATA');
      }
      if (fs.existsSync(testCachePath + '-shm')) {
        expect(fs.readFileSync(testCachePath + '-shm', 'utf8')).not.toBe('OLD SHM GARBAGE DATA');
      }

      // DB should be functional
      recovered.set('test', { value: 1 });
      expect(recovered.get('test')).toEqual({ value: 1 });

      recovered.close();
    });

    it('should throw original error if recreation also fails', () => {
      cacheService.close();

      // Write corrupt data
      fs.writeFileSync(testCachePath, 'CORRUPT');

      // Make the directory read-only so recreation fails
      const readOnlyDir = path.join(os.tmpdir(), `deepl-cli-readonly-${Date.now()}`);
      fs.mkdirSync(readOnlyDir, { recursive: true });
      const readOnlyPath = path.join(readOnlyDir, 'subdir', 'cache.db');

      // Create a corrupt file at a location where recreation will also fail
      fs.mkdirSync(path.join(readOnlyDir, 'subdir'), { recursive: true });
      fs.writeFileSync(readOnlyPath, 'CORRUPT');
      // Make directory read-only to prevent recreation
      fs.chmodSync(path.join(readOnlyDir, 'subdir'), 0o444);

      try {
        expect(() => new CacheService({ dbPath: readOnlyPath })).toThrow();
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(path.join(readOnlyDir, 'subdir'), 0o755);
        fs.rmSync(readOnlyDir, { recursive: true, force: true });
      }
    });
  });

  describe('cache size tracking (Issue #5)', () => {
    it('should maintain accurate cache size in memory', () => {
      // Add entries
      cacheService.set('key1', { text: 'Value 1' });
      cacheService.set('key2', { text: 'Value 2' });
      cacheService.set('key3', { text: 'Value 3' });

      const stats = cacheService.stats();

      // Stats should be accurate
      expect(stats.entries).toBe(3);
      expect(stats.totalSize).toBeGreaterThan(0);

      // Delete an entry
      cacheService.clear();

      const statsAfter = cacheService.stats();
      expect(statsAfter.totalSize).toBe(0);
      expect(statsAfter.entries).toBe(0);
    });

    it('should track size correctly when replacing entries', () => {
      const smallValue = { text: 'Small' };
      const largeValue = { text: 'x'.repeat(1000) };

      // Add small entry
      cacheService.set('test', smallValue);
      const statsSmall = cacheService.stats();
      const smallSize = statsSmall.totalSize;

      // Replace with large entry
      cacheService.set('test', largeValue);
      const statsLarge = cacheService.stats();
      const largeSize = statsLarge.totalSize;

      // Size should have increased
      expect(largeSize).toBeGreaterThan(smallSize);

      // Should still be 1 entry
      expect(statsLarge.entries).toBe(1);
    });

    it('should efficiently check if eviction is needed without querying database', () => {
      // This test verifies that eviction checks are efficient
      // We can't directly spy on internal state, but we can verify behavior

      const smallCache = new CacheService({
        dbPath: testCachePath,
        maxSize: 10 * 1024, // 10KB
      });

      // Add entries that don't require eviction
      for (let i = 0; i < 5; i++) {
        smallCache.set(`key-${i}`, { text: 'x'.repeat(100) });
      }

      const stats = smallCache.stats();

      // Should not have triggered eviction yet
      expect(stats.entries).toBe(5);
      expect(stats.totalSize).toBeLessThan(stats.maxSize);

      smallCache.close();
    });
  });
});

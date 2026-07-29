/**
 * Cache Service
 * SQLite-based translation cache with LRU eviction
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { resolvePaths } from '../utils/paths.js';
import { ConfigError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';
import { errorMessage } from '../utils/error-message.js';
import { isNativeModuleLoadError } from '../utils/native-module-error.js';

export interface CacheServiceOptions {
  dbPath?: string;
  maxSize?: number; // in bytes
  ttl?: number; // in milliseconds, 0 = disabled
}

export interface CacheStats {
  entries: number;
  totalSize: number;
  maxSize: number;
  enabled: boolean;
}

interface CacheRow {
  key: string;
  value: string;
  timestamp: number;
  size: number;
}

const DEFAULT_MAX_SIZE = 1024 * 1024 * 1024; // 1GB
const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
const CLEANUP_INTERVAL = 60_000; // 60 seconds

/**
 * Current on-disk schema version for the SQLite cache. Stamped into
 * `PRAGMA user_version` on fresh DBs and checked on every open. Bumping
 * this number means "future callers will read a DB laid out differently."
 * Pre-versioned databases (created before this field existed) report
 * `user_version = 0` and are upgrade-stamped in place without data
 * migration — the schema is backward-compatible.
 */
const CACHE_SCHEMA_VERSION = 1;

export class CacheService {
  private static instance: CacheService | null = null;
  private static handlersRegistered: boolean = false;
  private db!: DatabaseSync;
  private maxSize: number;
  private ttl: number;
  private enabled: boolean = true;
  private isClosed: boolean = false;
  private currentSize: number = 0;
  private lastCleanupTime: number = Date.now();

  /**
   * Create a new CacheService instance. Production code should use
   * getInstance() to share a single connection and avoid duplicate
   * signal handlers. The constructor is public only for test isolation.
   */
  constructor(options: CacheServiceOptions = {}) {
    const dbPath = options.dbPath ?? resolvePaths().cacheFile;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttl = options.ttl ?? DEFAULT_TTL;

    try {
      this.openDatabase(dbPath);
    } catch (error) {
      // A backend that cannot load (node:sqlite missing on an older
      // Node runtime) is not corruption: the database on disk is
      // healthy, so renaming it aside would throw away a warm cache.
      if (isNativeModuleLoadError(error)) {
        throw error;
      }
      // Corrupted DB: rename-aside rather than unlink, so the user keeps
      // 30 days of cache history (and a forensic artifact) instead of
      // losing both silently. Suffix with a timestamp so repeated
      // corruption doesn't clobber earlier backups.
      const suffix = `.corrupt-${Date.now()}`;
      Logger.warn(
        `Cache database corrupted, backing up and recreating: ${(error as Error).message}. ` +
        `Previous contents preserved at ${path.basename(dbPath)}${suffix} (and -wal${suffix} / -shm${suffix} if present).`,
      );
      try {
        if (fs.existsSync(dbPath)) fs.renameSync(dbPath, dbPath + suffix);
        for (const sidecar of ['-wal', '-shm']) {
          const f = dbPath + sidecar;
          if (fs.existsSync(f)) fs.renameSync(f, f + suffix);
        }
        this.openDatabase(dbPath);
      } catch {
        throw error;
      }
    }
  }

  private openDatabase(dbPath: string): void {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(dbPath);
    fs.chmodSync(dbPath, 0o600);
    this.initialize();
  }

  static getInstance(options?: CacheServiceOptions): CacheService {
    const needsNewInstance = !CacheService.instance || CacheService.instance.isClosed;
    const needsHandlerRegistration = needsNewInstance && !CacheService.handlersRegistered;

    if (needsHandlerRegistration) {
      CacheService.handlersRegistered = true;
    }

    if (needsNewInstance) {
      CacheService.instance = new CacheService(options);
    }

    if (needsHandlerRegistration) {
      process.once('exit', () => {
        CacheService.instance?.close();
      });

      // Close the database but never exit: this handler is registered during
      // service construction, so it runs before the sync engine's own handler,
      // and exiting here would preempt that cleanup. Terminating is the CLI
      // entry point's job (see installSignalExit).
      process.once('SIGINT', () => {
        CacheService.instance?.close();
      });

      process.once('SIGTERM', () => {
        CacheService.instance?.close();
      });
    }

    return CacheService.instance!;
  }

  private initialize(): void {
    this.db.exec('PRAGMA journal_mode = WAL');

    // Schema version check: pre-versioned DBs report user_version = 0
    // and are upgrade-stamped in place (current schema is compatible).
    // Higher-than-current means the DB was written by a newer CLI
    // version than this one — refuse rather than risk data loss.
    const { user_version: userVersion } = this.db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number };
    if (userVersion > CACHE_SCHEMA_VERSION) {
      throw new ConfigError(
        `Cache DB schema version ${userVersion} is newer than this CLI supports (${CACHE_SCHEMA_VERSION}). Upgrade the CLI, or delete the cache DB to start fresh.`,
      );
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        size INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON cache(timestamp);
    `);

    if (userVersion < CACHE_SCHEMA_VERSION) {
      this.db.exec(`PRAGMA user_version = ${CACHE_SCHEMA_VERSION}`);
    }

    const row = this.db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM cache').get() as { total: number };
    this.currentSize = row.total;
  }

  /**
   * Get value from cache
   */
  get(key: string): unknown;
  get<T>(key: string, guard: (data: unknown) => data is T): T | null;
  get<T>(key: string, guard?: (data: unknown) => data is T): T | null {
    if (!this.enabled) {
      return null;
    }

    // Clean up expired entries first
    this.cleanupExpired();

    const stmt = this.db.prepare('SELECT value, timestamp FROM cache WHERE key = ?');
    const row = stmt.get(key) as CacheRow | undefined;

    if (!row) {
      return null;
    }

    // Check if entry is expired
    if (this.ttl > 0 && Date.now() - row.timestamp > this.ttl) {
      // Delete expired entry
      this.db.prepare('DELETE FROM cache WHERE key = ?').run(key);
      return null;
    }

    try {
      const parsed = JSON.parse(row.value) as unknown;

      if (guard && !guard(parsed)) {
        const truncatedKey = key.length > 8 ? key.substring(0, 8) + '...' : key;
        Logger.warn(`Cache type mismatch for key "${truncatedKey}". Removing entry.`);
        this.db.prepare('DELETE FROM cache WHERE key = ?').run(key);
        return null;
      }

      return parsed as T;
    } catch (error) {
      const truncatedKey = key.length > 8 ? key.substring(0, 8) + '...' : key;
      Logger.warn(`Cache corruption detected for key "${truncatedKey}": ${errorMessage(error)}. Removing entry.`);
      this.db.prepare('DELETE FROM cache WHERE key = ?').run(key);
      return null;
    }
  }

  set(key: string, value: unknown): void {
    if (!this.enabled) {
      return;
    }

    if (value === undefined) {
      return;
    }

    const json = JSON.stringify(value);
    const size = Buffer.byteLength(json, 'utf8');
    const timestamp = Date.now();

    // Clean up expired entries
    this.cleanupExpired();

    // Check if key already exists and get its size
    const existingStmt = this.db.prepare('SELECT size FROM cache WHERE key = ?');
    const existing = existingStmt.get(key) as { size: number } | undefined;
    const existingSize = existing?.size ?? 0;

    this.evictIfNeeded(size - existingSize);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cache (key, value, timestamp, size)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(key, json, timestamp, size);
    this.currentSize = this.currentSize - existingSize + size;
  }

  clear(): void {
    this.db.exec('DELETE FROM cache');
    this.currentSize = 0;
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as total
      FROM cache
    `);
    const row = stmt.get() as { count: number; total: number };

    return {
      entries: row.count,
      totalSize: row.total,
      maxSize: this.maxSize,
      enabled: this.enabled,
    };
  }

  /**
   * Enable cache
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable cache
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Set maximum cache size
   */
  setMaxSize(maxSize: number): void {
    if (maxSize < 0) {
      throw new ConfigError('Max size must be positive');
    }
    this.maxSize = maxSize;
  }

  /**
   * Close database connection
   */
  close(): void {
    if (!this.isClosed) {
      this.db.close();
      this.isClosed = true;
      if (CacheService.instance === this) {
        CacheService.instance = null;
        CacheService.handlersRegistered = false;
      }
    }
  }

  forceCleanup(): void {
    this.lastCleanupTime = 0;
    this.cleanupExpired();
  }

  private cleanupExpired(): void {
    if (this.ttl === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastCleanupTime < CLEANUP_INTERVAL) {
      return;
    }
    this.lastCleanupTime = now;

    const expirationTime = now - this.ttl;
    const sizeStmt = this.db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM cache WHERE timestamp < ?');
    const sizeRow = sizeStmt.get(expirationTime) as { total: number };
    const deletedSize = sizeRow.total;

    this.db.prepare('DELETE FROM cache WHERE timestamp < ?').run(expirationTime);
    this.currentSize -= deletedSize;
  }

  private evictIfNeeded(newEntrySize: number): void {
    if (this.currentSize + newEntrySize <= this.maxSize) {
      return;
    }

    const toFree = this.currentSize + newEntrySize - this.maxSize + 1;
    const { count: entries } = this.db.prepare(
      'SELECT COUNT(*) as count FROM cache'
    ).get() as { count: number };

    const avgSize = entries > 0 ? this.currentSize / entries : 1024;
    const estimatedEntries = Math.ceil(toFree / avgSize);
    const entriesToDelete = Math.ceil(estimatedEntries * 1.2);

    const deleted = this.db.prepare(`
      DELETE FROM cache
      WHERE key IN (
        SELECT key FROM cache
        ORDER BY timestamp ASC
        LIMIT ?
      )
      RETURNING size
    `).all(entriesToDelete) as { size: number }[];

    const deletedSize = deleted.reduce((sum, row) => sum + row.size, 0);
    this.currentSize -= deletedSize;
  }
}

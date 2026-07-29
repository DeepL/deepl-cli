/**
 * Cache Service
 * SQLite-based translation cache; evicts oldest-written entries first
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { resolvePaths } from '../utils/paths.js';
import { ConfigError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';
import { errorMessage } from '../utils/error-message.js';

export interface CacheServiceOptions {
  dbPath?: string;
  maxSize?: number; // in bytes
  ttl?: number; // in milliseconds, 0 = disabled
  busyTimeoutMs?: number; // how long SQLite waits on a locked DB before erroring
  enabled?: boolean; // starting state of the cache; defaults to true
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
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const EVICTION_BATCH = 32;
const CORRUPT_BACKUPS_TO_KEEP = 3;

// SQLite primary result codes that mean the file itself is damaged. Everything
// else (BUSY, PERM, a deliberate ConfigError, a backend that cannot load) must
// propagate: the DB on disk is healthy and renaming it aside would destroy it.
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

// Duck-typed rather than `instanceof Error`: node:sqlite errors are created
// in the host realm, so instanceof fails against another realm's Error (as
// in a jest test context).
function isCorruptionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { errcode, message } = error as { errcode?: unknown; message?: unknown };
  if (typeof errcode === 'number') {
    const primary = errcode & 0xff;
    return primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB;
  }
  return (
    typeof message === 'string' &&
    /file is not a database|database disk image is malformed/i.test(message)
  );
}

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
  private busyTimeoutMs: number;
  // Seeded from options so the in-memory flag matches the persisted
  // `cache.enabled` config; a bare `new CacheService()` stays enabled.
  private enabled: boolean;
  private isClosed: boolean = false;
  // Seeded to 0 so the first operation of every process sweeps expired rows;
  // seeding to Date.now() would keep the sweep from ever running in a process
  // shorter than CLEANUP_INTERVAL — i.e. nearly every CLI invocation.
  private lastCleanupTime: number = 0;

  /**
   * Create a new CacheService instance. Production code should use
   * getInstance() to share a single connection and avoid duplicate
   * signal handlers. The constructor is public only for test isolation.
   */
  constructor(options: CacheServiceOptions = {}) {
    const dbPath = options.dbPath ?? resolvePaths().cacheFile;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttl = options.ttl ?? DEFAULT_TTL;
    this.busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    this.enabled = options.enabled ?? true;

    try {
      this.openDatabase(dbPath);
    } catch (error) {
      // Only genuine file damage may take the rename-aside path. Lock
      // contention (SQLITE_BUSY), a schema written by a newer CLI
      // (ConfigError), permission errors, and a backend that cannot load
      // all leave a healthy database on disk — propagate them so the
      // cache loader degrades to an uncached run instead.
      if (!isCorruptionError(error)) {
        throw error;
      }
      // Rename-aside rather than unlink, so the user keeps 30 days of
      // cache history (and a forensic artifact) instead of losing both
      // silently. Suffix with a timestamp so repeated corruption doesn't
      // clobber earlier backups.
      const suffix = `.corrupt-${Date.now()}`;
      Logger.warn(
        `Cache database corrupted, backing up and recreating: ${(error as Error).message}. ` +
        `Previous contents preserved at ${path.basename(dbPath)}${suffix} (and ${path.basename(dbPath)}${suffix}-wal / -shm if present).`,
      );
      try {
        // Sidecars must be preserved BEFORE closing the failed handle —
        // SQLite unlinks -wal/-shm when the last connection closes — and as
        // <backup>-wal / <backup>-shm, because SQLite resolves a database's
        // sidecars as <db-file>-wal / <db-file>-shm.
        for (const sidecar of ['-wal', '-shm']) {
          const f = dbPath + sidecar;
          if (fs.existsSync(f)) fs.copyFileSync(f, dbPath + suffix + sidecar);
        }
        // Close before renaming the main file: an open fd on the renamed
        // file blocks the rename on Windows.
        try {
          (this.db as DatabaseSync | undefined)?.close();
        } catch {
          // Never opened, or already closed.
        }
        if (fs.existsSync(dbPath)) fs.renameSync(dbPath, dbPath + suffix);
        for (const sidecar of ['-wal', '-shm']) {
          fs.rmSync(dbPath + sidecar, { force: true });
        }
        this.pruneCorruptBackups(dbPath);
        this.openDatabase(dbPath);
      } catch {
        throw error;
      }
    }
  }

  /**
   * Keep only the most recent CORRUPT_BACKUPS_TO_KEEP rename-aside backups
   * (each can be up to maxSize) so repeated corruption cannot fill the disk.
   */
  private pruneCorruptBackups(dbPath: string): void {
    try {
      const dir = path.dirname(dbPath);
      const prefix = `${path.basename(dbPath)}.corrupt-`;
      const stamps = [...new Set(
        fs.readdirSync(dir)
          .filter((f) => f.startsWith(prefix))
          .map((f) => /\.corrupt-(\d+)/.exec(f)?.[1])
          .filter((s): s is string => s !== undefined),
      )].sort((a, b) => Number(b) - Number(a));
      for (const stamp of stamps.slice(CORRUPT_BACKUPS_TO_KEEP)) {
        for (const suffix of ['', '-wal', '-shm']) {
          fs.rmSync(`${dbPath}.corrupt-${stamp}${suffix}`, { force: true });
        }
      }
    } catch {
      // Best-effort: a failed prune must not block cache recreation.
    }
  }

  private openDatabase(dbPath: string): void {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
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
  }

  /**
   * Total stored bytes, always read from the database. A process-local
   * counter cannot stay correct here: get()-path deletes, eviction during
   * overwrites, and concurrent processes sharing the file all move the real
   * total without this process seeing it.
   */
  private totalSize(): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(size), 0) as total FROM cache')
      .get() as { total: number };
    return row.total;
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

    // An entry that alone exceeds the cap can never be cached without
    // evicting everything else first — skip it rather than wipe the cache.
    if (size > this.maxSize) {
      Logger.verbose(
        `Skipping cache write: entry of ${size} bytes exceeds the ${this.maxSize}-byte cache size limit.`,
      );
      return;
    }

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
  }

  clear(): void {
    this.db.exec('DELETE FROM cache');
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
        // handlersRegistered stays true: the process handlers tolerate a
        // null instance, and re-registering on every getInstance/close
        // cycle accumulates listeners until Node warns on stderr.
        CacheService.instance = null;
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

    this.db.prepare('DELETE FROM cache WHERE timestamp < ?').run(now - this.ttl);
  }

  private evictIfNeeded(newEntrySize: number): void {
    let excess = this.totalSize() + newEntrySize - this.maxSize;

    // Delete oldest rows in batches until enough space is freed. A one-shot
    // estimate from the average row size under-evicts whenever sizes are
    // skewed, leaving the cache over its cap.
    while (excess > 0) {
      const deleted = this.db.prepare(`
        DELETE FROM cache
        WHERE key IN (
          SELECT key FROM cache
          ORDER BY timestamp ASC
          LIMIT ${EVICTION_BATCH}
        )
        RETURNING size
      `).all() as { size: number }[];

      if (deleted.length === 0) {
        return;
      }
      excess -= deleted.reduce((sum, row) => sum + row.size, 0);
    }
  }
}

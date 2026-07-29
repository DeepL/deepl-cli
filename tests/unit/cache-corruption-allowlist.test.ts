/**
 * Tests that only genuine corruption (SQLITE_CORRUPT / SQLITE_NOTADB) takes
 * the rename-aside-and-recreate path. Everything else — lock contention, a
 * newer-than-supported schema, permission errors — must propagate so the
 * cache loader degrades to an uncached run instead of destroying a healthy
 * database.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CacheService } from '../../src/storage/cache';
import { ConfigError } from '../../src/utils/errors';

describe('CacheService corruption allowlist', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-cache-corrupt-'));
    dbPath = path.join(dir, 'cache.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function corruptBackups(): string[] {
    return fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  }

  it('refuses a newer-schema DB without renaming it aside', () => {
    const svc = new CacheService({ dbPath, ttl: 0 });
    svc.set('key', 'value');
    svc.close();

    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    expect(() => new CacheService({ dbPath })).toThrow(ConfigError);

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(corruptBackups()).toHaveLength(0);

    const check = new DatabaseSync(dbPath);
    const { count } = check
      .prepare('SELECT COUNT(*) as count FROM cache')
      .get() as { count: number };
    check.close();
    expect(count).toBe(1);
  });

  it('propagates lock contention instead of destroying the locked DB', () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA journal_mode = DELETE');
    raw.exec(
      'CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, timestamp INTEGER NOT NULL, size INTEGER NOT NULL)',
    );
    raw.exec(`INSERT INTO cache VALUES ('k', '"v"', ${Date.now()}, 3)`);
    raw.exec('BEGIN EXCLUSIVE');

    expect(() => new CacheService({ dbPath, busyTimeoutMs: 50 })).toThrow();
    expect(corruptBackups()).toHaveLength(0);

    // The lock holder's transaction must survive the failed open.
    expect(() => raw.exec('COMMIT')).not.toThrow();
    raw.close();

    const svc = new CacheService({ dbPath, ttl: 0, busyTimeoutMs: 50 });
    expect(svc.stats().entries).toBe(1);
    svc.close();
  });

  it('still renames a genuinely corrupt file aside and recreates', () => {
    fs.writeFileSync(dbPath, 'this is not a sqlite database, padded well past the 16-byte header');

    const svc = new CacheService({ dbPath, ttl: 0 });
    svc.set('key', 'value');
    expect(svc.stats().entries).toBe(1);
    svc.close();

    expect(corruptBackups().length).toBeGreaterThanOrEqual(1);
  });

  it('names renamed sidecars so the backup DB can find its own WAL', () => {
    // A corrupt-interior file (valid header, garbage pages) fails with
    // SQLITE_CORRUPT and, unlike a garbage header, leaves sidecars on disk
    // for the recovery path to preserve.
    const raw = new DatabaseSync(dbPath);
    raw.exec('CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT, timestamp INTEGER, size INTEGER)');
    raw.close();
    const buf = fs.readFileSync(dbPath);
    buf.fill(0xde, 100, 600);
    fs.writeFileSync(dbPath, buf);
    fs.writeFileSync(`${dbPath}-wal`, 'fake wal contents');

    const svc = new CacheService({ dbPath, ttl: 0 });
    svc.close();

    const files = fs.readdirSync(dir);
    const backup = files.find((f) => /^cache\.db\.corrupt-\d+$/.test(f));
    expect(backup).toBeDefined();
    // SQLite resolves a DB's WAL as <db-file>-wal, so the sidecar must be
    // <backup>-wal, not <original>-wal<suffix>.
    expect(files).toContain(`${backup}-wal`);
  });

  it('prunes old .corrupt-* backups, keeping the most recent three', () => {
    for (const ts of [100, 200, 300]) {
      fs.writeFileSync(`${dbPath}.corrupt-${ts}`, 'old backup');
    }
    fs.writeFileSync(dbPath, 'this is not a sqlite database, padded well past the 16-byte header');

    const svc = new CacheService({ dbPath, ttl: 0 });
    svc.close();

    const backups = corruptBackups();
    const timestamps = [...new Set(backups.map((f) => /\.corrupt-(\d+)/.exec(f)![1]))];
    expect(timestamps).toHaveLength(3);
    expect(timestamps).not.toContain('100');
  });
});

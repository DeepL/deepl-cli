/**
 * Tests that the cache size cap is enforced from the database's actual
 * contents, not a process-local counter. A counter drifts: downward on
 * overwrite-with-eviction (cap stops being enforced), upward when get()
 * deletes expired rows (premature eviction), and negative when another
 * process's rows are swept (eviction disabled for the process lifetime).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CacheService } from '../../src/storage/cache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('CacheService size accounting', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-cache-size-'));
    dbPath = path.join(dir, 'cache.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps enforcing the cap after an overwrite evicts the key being replaced', () => {
    const maxSize = 2000;
    const svc = new CacheService({ dbPath, maxSize, ttl: 0 });

    for (let i = 0; i < 10; i++) {
      svc.set(`key-${i}`, 'x'.repeat(188)); // 190 bytes as JSON
    }
    expect(svc.stats().totalSize).toBeLessThanOrEqual(maxSize);

    // Overwriting the oldest key with a larger value makes eviction delete
    // the very row being replaced.
    svc.set('key-0', 'x'.repeat(320));
    expect(svc.stats().totalSize).toBeLessThanOrEqual(maxSize);

    for (let i = 0; i < 4; i++) {
      svc.set(`fresh-${i}`, 'x'.repeat(98)); // 100 bytes each
      expect(svc.stats().totalSize).toBeLessThanOrEqual(maxSize);
    }

    svc.close();
  });

  it('does not wipe existing entries when an oversized value is set', () => {
    const maxSize = 1000;
    const svc = new CacheService({ dbPath, maxSize, ttl: 0 });

    for (let i = 0; i < 10; i++) {
      svc.set(`small-${i}`, 'x'.repeat(8));
    }
    expect(svc.stats().entries).toBe(10);

    svc.set('oversized', 'x'.repeat(4998)); // 5000 bytes as JSON, > maxSize

    const stats = svc.stats();
    expect(stats.entries).toBe(10);
    expect(svc.get('oversized')).toBeNull();
    expect(stats.totalSize).toBeLessThanOrEqual(maxSize);

    svc.close();
  });

  it('does not evict fresh entries after expired rows were deleted via get()', async () => {
    const maxSize = 1500;
    const svc = new CacheService({ dbPath, maxSize, ttl: 40 });

    for (const key of ['a', 'b', 'c']) {
      svc.set(key, 'x'.repeat(478)); // 480 bytes each, 1440 total
    }
    await sleep(80);

    expect(svc.get('a')).toBeNull();
    expect(svc.get('b')).toBeNull();
    expect(svc.get('c')).toBeNull();

    svc.set('d', 'x'.repeat(98)); // 100 bytes
    svc.set('e', 'x'.repeat(98)); // 100 bytes; 200 total, far below the cap

    expect(svc.get('d')).not.toBeNull();
    expect(svc.get('e')).not.toBeNull();

    svc.close();
  });

  it('keeps enforcing the cap after sweeping rows another instance wrote', async () => {
    const maxSize = 4000;
    const a = new CacheService({ dbPath, maxSize, ttl: 100 });
    const b = new CacheService({ dbPath, maxSize, ttl: 0 });

    for (let i = 0; i < 10; i++) {
      b.set(`b-${i}`, 'x'.repeat(188)); // 1900 bytes a never counted
    }
    await sleep(150);

    a.forceCleanup(); // sweeps b's now-expired rows

    for (let i = 0; i < 25; i++) {
      a.set(`a-${i}`, 'x'.repeat(188)); // 4750 bytes if nothing evicts
    }
    expect(a.stats().totalSize).toBeLessThanOrEqual(maxSize);

    a.close();
    b.close();
  });

  it('enforces the cap under entry-size skew', () => {
    const maxSize = 10_000;
    const svc = new CacheService({ dbPath, maxSize, ttl: 0 });

    for (let i = 0; i < 500; i++) {
      svc.set(`tiny-${i}`, 'a'); // 3 bytes as JSON
    }
    for (let i = 0; i < 12; i++) {
      svc.set(`large-${i}`, 'x'.repeat(998)); // 1000 bytes as JSON
      expect(svc.stats().totalSize).toBeLessThanOrEqual(maxSize);
    }

    svc.close();
  });

  it('sweeps entries that expired before this instance opened', async () => {
    const writer = new CacheService({ dbPath, ttl: 50 });
    writer.set('old', 'value');
    writer.close();

    await sleep(80);

    const reader = new CacheService({ dbPath, ttl: 50 });
    reader.set('new', 'value');

    expect(reader.stats().entries).toBe(1);

    reader.close();
  });
});

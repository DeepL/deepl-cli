import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sweepStaleBackups, bucketSweepRoots, DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS } from '../../../src/sync/sync-bak-cleanup';

// ──────────────────────────────────────────────────────────────────────────────
// bucketSweepRoots()
// ──────────────────────────────────────────────────────────────────────────────

describe('bucketSweepRoots()', () => {
  const root = '/project';

  it('returns the literal directory prefix for a simple glob', () => {
    const result = bucketSweepRoots(root, { json: { include: ['locales/**/*.json'] } });
    expect(result).toEqual([path.resolve(root, 'locales')]);
  });

  it('handles a glob with no directory prefix (project root)', () => {
    const result = bucketSweepRoots(root, { json: { include: ['*.json'] } });
    expect(result).toEqual([root]);
  });

  it('handles a trailing-slash prefix (directory glob)', () => {
    const result = bucketSweepRoots(root, { json: { include: ['src/locales/'] } });
    expect(result).toContain(path.resolve(root, 'src/locales'));
  });

  it('deduplicates roots across multiple buckets', () => {
    const result = bucketSweepRoots(root, {
      a: { include: ['locales/**/*.json'] },
      b: { include: ['locales/**/*.yaml'] },
    });
    expect(result).toEqual([path.resolve(root, 'locales')]);
  });

  it('returns distinct roots for different literal prefixes', () => {
    const result = bucketSweepRoots(root, {
      a: { include: ['src/locales/**/*.json'] },
      b: { include: ['resources/**/*.json'] },
    });
    expect(result).toHaveLength(2);
    expect(result).toContain(path.resolve(root, 'src/locales'));
    expect(result).toContain(path.resolve(root, 'resources'));
  });

  it('handles a glob with a {brace} wildcard', () => {
    const result = bucketSweepRoots(root, { json: { include: ['src/{en,de}/**/*.json'] } });
    expect(result).toEqual([path.resolve(root, 'src')]);
  });

  it('handles a glob with a ? wildcard', () => {
    const result = bucketSweepRoots(root, { json: { include: ['loc?les/**/*.json'] } });
    expect(result).toEqual([root]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// sweepStaleBackups() — scoped to bucket dirs
// ──────────────────────────────────────────────────────────────────────────────

describe('sweepStaleBackups() with bucket config', () => {
  let tmpDir: string;
  let readdirSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-bak-sweep-'));
    readdirSpy = jest.spyOn(fs.promises, 'readdir');
  });

  afterEach(() => {
    readdirSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('only calls readdir inside bucket-include directories, not outside', async () => {
    const localesDir = path.join(tmpDir, 'locales');
    const outsideDir = path.join(tmpDir, 'node_src');
    fs.mkdirSync(localesDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    // Place a stale .deepl.bak in locales (should be swept)
    const staleBak = path.join(localesDir, 'de.json.deepl.bak');
    fs.writeFileSync(staleBak, 'stale', 'utf-8');
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(staleBak, tenMinAgo, tenMinAgo);

    // Place a .deepl.bak outside the bucket dir (should NOT be touched by a scoped sweep)
    const outsideBak = path.join(outsideDir, 'other.json.deepl.bak');
    fs.writeFileSync(outsideBak, 'outside', 'utf-8');
    fs.utimesSync(outsideBak, tenMinAgo, tenMinAgo);

    const buckets = { json: { include: ['locales/**/*.json'] } };
    await sweepStaleBackups(tmpDir, 5 * 60_000, buckets);

    // The stale .deepl.bak inside the bucket dir must be removed
    expect(fs.existsSync(staleBak)).toBe(false);

    // No readdir call should have touched outsideDir
    const readdirCalls: string[] = readdirSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(readdirCalls.some((p) => p.startsWith(outsideDir))).toBe(false);
  });

  it('removes a stale .deepl.bak file within bucket dirs', async () => {
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });

    const staleBak = path.join(localesDir, 'fr.json.deepl.bak');
    fs.writeFileSync(staleBak, 'stale', 'utf-8');
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(staleBak, tenMinAgo, tenMinAgo);

    await sweepStaleBackups(tmpDir, 5 * 60_000, { json: { include: ['locales/**/*.json'] } });
    expect(fs.existsSync(staleBak)).toBe(false);
  });

  it('leaves a fresh .deepl.bak file alone', async () => {
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });

    const freshBak = path.join(localesDir, 'en.json.deepl.bak');
    fs.writeFileSync(freshBak, 'fresh', 'utf-8');

    await sweepStaleBackups(tmpDir, 5 * 60_000, { json: { include: ['locales/**/*.json'] } });
    expect(fs.existsSync(freshBak)).toBe(true);
  });

  it('leaves user-owned *.bak files completely untouched, even when stale', async () => {
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });

    const userBak = path.join(localesDir, 'my-important-notes.bak');
    fs.writeFileSync(userBak, 'user data', 'utf-8');
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(userBak, tenMinAgo, tenMinAgo);
    const sibling = path.join(localesDir, 'my-important-notes');

    await sweepStaleBackups(tmpDir, 5 * 60_000, { json: { include: ['locales/**/*.json'] } });

    expect(fs.existsSync(userBak)).toBe(true);
    expect(fs.readFileSync(userBak, 'utf-8')).toBe('user data');
    expect(fs.existsSync(sibling)).toBe(false);
  });

  it('does not resurrect a sibling that does not exist', async () => {
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });

    const sibling = path.join(localesDir, 'de.json');
    const bakFile = `${sibling}.deepl.bak`;
    fs.writeFileSync(bakFile, '{"key":"value"}', 'utf-8');
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(bakFile, tenMinAgo, tenMinAgo);
    // sibling does not exist

    await sweepStaleBackups(tmpDir, 5 * 60_000, { json: { include: ['locales/**/*.json'] } });

    expect(fs.existsSync(sibling)).toBe(false);
    expect(fs.existsSync(bakFile)).toBe(false);
  });

  it('restores a zero-length sibling from .deepl.bak before unlinking', async () => {
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });

    const sibling = path.join(localesDir, 'de.json');
    const bakFile = `${sibling}.deepl.bak`;
    fs.writeFileSync(sibling, '', 'utf-8');
    fs.writeFileSync(bakFile, '{"key":"value"}', 'utf-8');
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(bakFile, tenMinAgo, tenMinAgo);

    await sweepStaleBackups(tmpDir, 5 * 60_000, { json: { include: ['locales/**/*.json'] } });

    expect(fs.readFileSync(sibling, 'utf-8')).toBe('{"key":"value"}');
    expect(fs.existsSync(bakFile)).toBe(false);
  });

  it('leaves a non-empty sibling untouched while removing the stale .deepl.bak', async () => {
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });

    const sibling = path.join(localesDir, 'de.json');
    const bakFile = `${sibling}.deepl.bak`;
    fs.writeFileSync(sibling, '{"current":"content"}', 'utf-8');
    fs.writeFileSync(bakFile, '{"old":"content"}', 'utf-8');
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(bakFile, tenMinAgo, tenMinAgo);

    await sweepStaleBackups(tmpDir, 5 * 60_000, { json: { include: ['locales/**/*.json'] } });

    expect(fs.readFileSync(sibling, 'utf-8')).toBe('{"current":"content"}');
    expect(fs.existsSync(bakFile)).toBe(false);
  });

  it('readdir call count is O(bucket dirs), not O(project)', async () => {
    // Create 5 dirs outside the bucket scope
    for (let i = 0; i < 5; i++) {
      fs.mkdirSync(path.join(tmpDir, `other${i}`), { recursive: true });
    }
    const localesDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localesDir, { recursive: true });

    const buckets = { json: { include: ['locales/**/*.json'] } };
    await sweepStaleBackups(tmpDir, 5 * 60_000, buckets);

    const readdirCalls: string[] = readdirSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    // Only locales (and any of its subdirs) should be visited — not the 5 other* dirs
    for (let i = 0; i < 5; i++) {
      expect(readdirCalls.some((p) => p.includes(`other${i}`))).toBe(false);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// sweepStaleBackups() — no bucket config (fallback)
// ──────────────────────────────────────────────────────────────────────────────

describe('sweepStaleBackups() without bucket config (fallback)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-bak-sweep-fb-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('still removes stale .deepl.bak files anywhere under projectRoot', async () => {
    const nested = path.join(tmpDir, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });

    const staleBak = path.join(nested, 'x.json.deepl.bak');
    fs.writeFileSync(staleBak, 'stale', 'utf-8');
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(staleBak, tenMinAgo, tenMinAgo);

    await sweepStaleBackups(tmpDir, 5 * 60_000);
    expect(fs.existsSync(staleBak)).toBe(false);
  });

  it('leaves fresh .deepl.bak files alone when no bucket config given', async () => {
    const nested = path.join(tmpDir, 'a');
    fs.mkdirSync(nested, { recursive: true });

    const freshBak = path.join(nested, 'y.json.deepl.bak');
    fs.writeFileSync(freshBak, 'fresh', 'utf-8');

    await sweepStaleBackups(tmpDir, 5 * 60_000);
    expect(fs.existsSync(freshBak)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveBakSweepAgeMs / DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS
// ──────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS', () => {
  it('equals 300', () => {
    expect(DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS).toBe(300);
  });
});

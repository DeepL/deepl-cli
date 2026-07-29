import { TmCache } from '../../../src/sync/tm-cache';

describe('TmCache', () => {
  it('returns cached value before TTL expires', () => {
    let now = 1_000;
    const cache = new TmCache(5 * 60_000, () => now);
    cache.set('key|en|de', 'uuid-1');

    now += 4 * 60_000;
    expect(cache.has('key|en|de')).toBe(true);
    expect(cache.get('key|en|de')).toBe('uuid-1');
  });

  it('treats entries as absent after TTL elapses', () => {
    let now = 1_000;
    const cache = new TmCache(5 * 60_000, () => now);
    cache.set('key|en|de', 'uuid-stale');

    now += 5 * 60_000;
    expect(cache.has('key|en|de')).toBe(false);
    expect(cache.get('key|en|de')).toBeUndefined();
  });

  it('lazily evicts stale entries on access', () => {
    let now = 1_000;
    const cache = new TmCache(1_000, () => now);
    cache.set('k', 'v');

    now += 2_000;
    cache.has('k');
    // Internal eviction: a fresh set-then-read round-trips the new value, not the old one.
    cache.set('k', 'v2');
    now += 500;
    expect(cache.get('k')).toBe('v2');
  });

  it('refreshes TTL on overwrite', () => {
    let now = 0;
    const cache = new TmCache(1_000, () => now);
    cache.set('k', 'v1');
    now += 900;
    cache.set('k', 'v2');
    now += 900;
    expect(cache.has('k')).toBe(true);
    expect(cache.get('k')).toBe('v2');
  });

  it('defaults TTL to 5 minutes', () => {
    expect(TmCache.DEFAULT_TTL_MS).toBe(5 * 60_000);
  });

  it('clear() removes all entries', () => {
    const cache = new TmCache();
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
  });

  it('satisfies the Map<string, string>-shaped signature used by resolveTranslationMemoryId', () => {
    const cache = new TmCache();
    // has/get/set — the three methods resolveTranslationMemoryId uses.
    expect(typeof cache.has).toBe('function');
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.set).toBe('function');
  });
});

/**
 * Tests per-locale staleness detection.
 *
 * Staleness is per locale, not per entry: a key is stale for any locale whose
 * stored hash lags the source, even when other locales are current, so
 * `--frozen` can see out-of-date translations. Conversely, failure status is
 * scoped to the locale under test — one locale's failure must not mark the key
 * stale for all locales and re-translate over human-edited files.
 */

import { computeDiff } from '../../../src/sync/sync-differ';
import { computeSourceHash } from '../../../src/sync/sync-lock';
import type { SyncLockEntry } from '../../../src/sync/types';
import type { ExtractedEntry } from '../../../src/formats/format';

const SOURCE = 'Hello';
const CURRENT_HASH = computeSourceHash(SOURCE);
const STALE_HASH = computeSourceHash('Old Hello');

function entries(): ExtractedEntry[] {
  return [{ key: 'greeting', value: SOURCE }];
}

function lockEntry(translations: SyncLockEntry['translations']): Record<string, SyncLockEntry> {
  return {
    greeting: { source_hash: CURRENT_HASH, source_text: SOURCE, translations },
  };
}

function translation(hash: string, status = 'translated'): SyncLockEntry['translations'][string] {
  return {
    hash,
    status,
    translated_at: '2026-01-01T00:00:00Z',
    character_count: SOURCE.length,
  } as SyncLockEntry['translations'][string];
}

describe('computeDiff per-locale staleness', () => {
  it('should report a key as current when every locale is up to date', () => {
    const diffs = computeDiff(
      lockEntry({ de: translation(CURRENT_HASH), fr: translation(CURRENT_HASH) }),
      entries(),
      ['de', 'fr'],
    );

    expect(diffs[0]?.status).toBe('current');
  });

  it('should report a key as stale when one locale lags behind the source', () => {
    // de is current, fr still holds the hash of the previous source text.
    const diffs = computeDiff(
      lockEntry({ de: translation(CURRENT_HASH), fr: translation(STALE_HASH) }),
      entries(),
      ['de', 'fr'],
    );

    expect(diffs[0]?.status).toBe('stale');
  });

  it('should not report a newly-added locale as stale', () => {
    // A locale with no lockfile entry is a new target, promoted to `new` by
    // sync-process-bucket's hasNewLocale path so backfill is counted as new
    // keys rather than as drift. Marking it stale here would misreport it.
    const diffs = computeDiff(lockEntry({ de: translation(CURRENT_HASH) }), entries(), [
      'de',
      'fr',
    ]);

    expect(diffs[0]?.status).toBe('current');
  });

  it('should report a key as stale when a locale previously failed', () => {
    const diffs = computeDiff(
      lockEntry({ de: translation(CURRENT_HASH), fr: translation(CURRENT_HASH, 'failed') }),
      entries(),
      ['de', 'fr'],
    );

    expect(diffs[0]?.status).toBe('stale');
  });

  it('should ignore locales that are not sync targets', () => {
    // A stale "es" entry left over from a locale no longer configured must not
    // keep flagging the key forever.
    const diffs = computeDiff(
      lockEntry({ de: translation(CURRENT_HASH), es: translation(STALE_HASH) }),
      entries(),
      ['de'],
    );

    expect(diffs[0]?.status).toBe('current');
  });

  it('should still report a changed source as stale', () => {
    const lock: Record<string, SyncLockEntry> = {
      greeting: {
        source_hash: STALE_HASH,
        source_text: 'Old Hello',
        translations: { de: translation(STALE_HASH) },
      },
    };

    const diffs = computeDiff(lock, entries(), ['de']);

    expect(diffs[0]?.status).toBe('stale');
  });

  it('should remain backward compatible when no target locales are supplied', () => {
    // sync-status and other callers may omit the locale list.
    const diffs = computeDiff(
      lockEntry({ de: translation(CURRENT_HASH), fr: translation(STALE_HASH) }),
      entries(),
    );

    expect(diffs[0]?.status).toBe('current');
  });
});

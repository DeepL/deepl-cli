import type { ExtractedEntry } from '../formats/format.js';
import type { SyncLockEntry, SyncDiff } from './types.js';
import { computeSourceHash } from './sync-lock.js';

/**
 * Is any of `targetLocales` out of date for this entry?
 *
 * Staleness is judged per locale, not from the entry-level `source_hash`
 * alone: a locale whose stored hash lags behind still needs re-translation
 * even when the source is unchanged.
 * Locales absent from `targetLocales` are ignored, so a leftover entry for a
 * de-configured locale does not flag the key indefinitely.
 */
function hasOutdatedLocale(
  lockEntry: SyncLockEntry,
  sourceHash: string,
  targetLocales: readonly string[],
): boolean {
  return targetLocales.some((locale) => {
    const translation = lockEntry.translations[locale];
    // A locale with NO entry is a newly-added target locale, not a stale one.
    // That case is promoted to `new` by the hasNewLocale path in
    // sync-process-bucket, which keeps new-locale backfill counted as new keys
    // rather than as drift.
    if (translation === undefined) return false;
    if (translation.status === 'failed') return true;
    return translation.hash !== sourceHash;
  });
}

export function computeDiff(
  lockEntries: Record<string, SyncLockEntry>,
  currentEntries: ExtractedEntry[],
  targetLocales?: readonly string[],
): SyncDiff[] {
  const currentKeys = new Set(currentEntries.map((e) => e.key));
  const currentMap = new Map(currentEntries.map((e) => [e.key, e]));
  const diffs: SyncDiff[] = [];

  for (const [key, entry] of currentMap) {
    const lockEntry = lockEntries[key];
    if (!lockEntry) {
      diffs.push({ key, status: 'new', value: entry.value, metadata: entry.metadata });
    } else if (computeSourceHash(entry.value, entry.metadata) === lockEntry.source_hash) {
      // Scope the check to the configured target locales when they are known: a
      // whole-entry `some(failed)` check would mark the key stale for EVERY
      // locale as soon as one had failed, re-translating locales that are already
      // fine and overwriting human-edited files.
      const needsWork = targetLocales
        ? hasOutdatedLocale(lockEntry, lockEntry.source_hash, targetLocales)
        : Object.values(lockEntry.translations).some(t => t.status === 'failed');
      if (needsWork) {
        diffs.push({ key, status: 'stale', value: entry.value, previous_hash: lockEntry.source_hash, metadata: entry.metadata });
      } else {
        diffs.push({ key, status: 'current', value: entry.value, metadata: entry.metadata });
      }
    } else {
      diffs.push({
        key,
        status: 'stale',
        value: entry.value,
        previous_hash: lockEntry.source_hash,
        metadata: entry.metadata,
      });
    }
  }

  for (const key of Object.keys(lockEntries)) {
    if (!currentKeys.has(key)) {
      const lockEntry = lockEntries[key];
      if (lockEntry) {
        diffs.push({ key, status: 'deleted', previous_hash: lockEntry.source_hash });
      }
    }
  }

  diffs.sort((a, b) => a.key.localeCompare(b.key));
  return diffs;
}

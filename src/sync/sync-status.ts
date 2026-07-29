import * as path from 'path';
import type { FormatRegistry } from '../formats/index.js';
import { SyncLockManager } from './sync-lock.js';
import { computeDiff } from './sync-differ.js';
import type { ResolvedSyncConfig } from './sync-config.js';
import { LOCK_FILE_NAME } from './types.js';
import { walkBuckets } from './sync-bucket-walker.js';

export interface LocaleStatus {
  locale: string;
  complete: number;
  missing: number;
  outdated: number;
  coverage: number;
}

export interface SyncStatusResult {
  sourceLocale: string;
  totalKeys: number;
  /**
   * Keys whose parser tagged them with `metadata.skipped` — e.g., Laravel
   * pipe-pluralization values. Not sent for translation; round-trip
   * byte-verbatim. Included in `totalKeys`.
   */
  skippedKeys: number;
  locales: LocaleStatus[];
}

export async function computeSyncStatus(
  config: ResolvedSyncConfig,
  formatRegistry: FormatRegistry,
): Promise<SyncStatusResult> {
  const lockManager = new SyncLockManager(path.join(config.projectRoot, LOCK_FILE_NAME));
  const lockFile = await lockManager.read();
  let totalKeys = 0;
  let skippedKeys = 0;
  const localeStats = new Map<string, { complete: number; missing: number; outdated: number }>();

  for (const locale of config.target_locales) {
    localeStats.set(locale, { complete: 0, missing: 0, outdated: 0 });
  }

  for await (const walked of walkBuckets(config, formatRegistry)) {
    const { relPath, entries, skippedEntries } = walked;
    totalKeys += entries.length + skippedEntries.length;
    skippedKeys += skippedEntries.length;

    const fileLockEntries = lockFile.entries[relPath] ?? {};
    const diffs = computeDiff(fileLockEntries, entries);

    for (const locale of config.target_locales) {
      const stats = localeStats.get(locale);
      if (!stats) continue;

      for (const diff of diffs) {
        if (diff.status === 'deleted') continue;
        const lockEntry = fileLockEntries[diff.key];
        const translation = lockEntry?.translations[locale];
        const hasTranslation = translation !== undefined;
        // Judge staleness for THIS locale rather than inheriting the shared
        // source-level status: a locale whose stored hash lags behind, or whose
        // last attempt failed, is outdated even when the source is unchanged.
        const localeOutdated =
          lockEntry !== undefined &&
          translation !== undefined &&
          (translation.status === 'failed' || translation.hash !== lockEntry.source_hash);

        if (diff.status === 'new' || !hasTranslation) {
          stats.missing++;
        } else if (diff.status === 'stale' || localeOutdated) {
          stats.outdated++;
        } else {
          stats.complete++;
        }
      }
    }
  }

  const locales: LocaleStatus[] = config.target_locales.map((locale) => {
    const stats = localeStats.get(locale) ?? { complete: 0, missing: 0, outdated: 0 };
    const total = stats.complete + stats.missing + stats.outdated;
    const coverage = total > 0 ? Math.round((stats.complete / total) * 100) : 0;
    return { locale, ...stats, coverage };
  });

  return { sourceLocale: config.source_locale, totalKeys, skippedKeys, locales };
}

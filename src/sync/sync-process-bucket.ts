import * as fs from 'fs';
import * as path from 'path';
import type { TranslationService } from '../services/translation.js';
import type { GlossaryService } from '../services/glossary.js';
import { computeDiff } from './sync-differ.js';
import { mapWithConcurrency, MULTI_TARGET_CONCURRENCY } from '../utils/concurrency.js';
import { ValidationError } from '../utils/errors.js';
import { resolveTargetPath, assertPathWithinRoot } from './sync-utils.js';
import { computeSourceHash } from './sync-lock.js';
import type { ResolvedSyncConfig } from './sync-config.js';
import type { SyncLockFile, SyncLockTranslation } from './types.js';
import type { Language } from '../types/common.js';
import type { KeyContext } from './sync-context.js';
import { resolveTranslationMemoryId } from '../services/translation-memory.js';
import type { TmCacheLike } from './tm-cache.js';
import { Logger } from '../utils/logger.js';
import { extractTranslatable, type WalkedBucketFile } from './sync-bucket-walker.js';
import type { LocaleTranslator } from './sync-locale-translator.js';
import type { SyncFileResult, SyncOptions } from './sync-service.js';

export interface ProcessBucketDeps {
  config: ResolvedSyncConfig;
  options: SyncOptions | undefined;
  // Mutated in place by processBucket — orchestrator-owned refs:
  lockFile: SyncLockFile;
  sourceEntryMap: Map<string, string>;
  targetEntryMap: Map<string, Map<string, string>>;
  allContextSentKeys: Set<string>;
  allInstructionSentKeys: Set<string>;
  allInstructionGroupTotals: Map<string, number>;
  // Read-only refs:
  keyContexts: Map<string, KeyContext>;
  localeTranslator: LocaleTranslator;
  glossaryService: GlossaryService;
  translationService: TranslationService;
  tmCache: TmCacheLike;
  // For cost-cap check — orchestrator's cumulative as of this bucket:
  currentTotalCharsBilled: number;
}

export interface BucketContribution {
  totalKeysDelta: number;
  newKeysDelta: number;
  staleKeysDelta: number;
  deletedKeysDelta: number;
  currentKeysDelta: number;
  totalCharsBilledDelta: number;
  estimatedCharactersDelta: number;
  validationWarningsDelta: number;
  validationErrorsDelta: number;
  fileResults: SyncFileResult[];
  driftDetected: boolean;
  lockDirty: boolean;
}

const EMPTY: BucketContribution = {
  totalKeysDelta: 0, newKeysDelta: 0, staleKeysDelta: 0, deletedKeysDelta: 0,
  currentKeysDelta: 0, totalCharsBilledDelta: 0, estimatedCharactersDelta: 0,
  validationWarningsDelta: 0, validationErrorsDelta: 0,
  fileResults: [], driftDetected: false, lockDirty: false,
};

export async function processBucket(
  walked: WalkedBucketFile,
  deps: ProcessBucketDeps,
): Promise<BucketContribution> {
  const { config, options, lockFile, sourceEntryMap, targetEntryMap,
    allContextSentKeys, allInstructionSentKeys, allInstructionGroupTotals,
    keyContexts, localeTranslator, glossaryService, translationService, tmCache,
    currentTotalCharsBilled } = deps;
  const { bucketConfig, parser, relPath, content, entries, isMultiLocale } = walked;

  const out: BucketContribution = { ...EMPTY, fileResults: [] };

  const fileLockEntries = lockFile.entries[relPath] ?? {};
  // Pass the configured locales so staleness is judged per locale: a key whose
  // source is unchanged still needs work if any target locale's stored hash
  // lags behind, or if that locale previously failed.
  let diffs = computeDiff(fileLockEntries, entries, config.target_locales);

  if (options?.force) {
    diffs = diffs.map(d => ({ ...d, status: 'new' as const }));
  }

  for (const d of diffs) {
    switch (d.status) {
      case 'new':
        if (d.value !== undefined) out.newKeysDelta++;
        else out.deletedKeysDelta++;
        break;
      case 'stale': out.staleKeysDelta++; break;
      case 'deleted': out.deletedKeysDelta++; break;
      case 'current': out.currentKeysDelta++; break;
    }
  }
  out.totalKeysDelta += entries.length;

  const toTranslate = diffs.filter(d => (d.status === 'new' || d.status === 'stale') && d.value !== undefined);
  const deletedDiffs = diffs.filter(d => d.status === 'deleted');

  // Check if any target locale is missing translations for current keys
  const hasNewLocale = config.target_locales.some(locale => {
    const localeFilter = options?.localeFilter;
    if (localeFilter?.length && !localeFilter.includes(locale)) return false;
    return diffs.some(d => d.status === 'current' && !fileLockEntries[d.key]?.translations[locale]);
  });

  if (options?.frozen) {
    const failMissing = config.validation?.fail_on_missing !== false;
    const failStale = config.validation?.fail_on_stale !== false;
    const hasNew = toTranslate.some(d => d.status === 'new') || hasNewLocale;
    const hasStale = toTranslate.some(d => d.status === 'stale');
    if ((failMissing && (hasNew || deletedDiffs.length > 0)) || (failStale && hasStale)) {
      // Promote current keys missing a target-locale translation into newKeysDelta
      // so the displayed count matches dry-run for the same input state.
      if (hasNewLocale) {
        const currentDiffs = diffs.filter(d => d.status === 'current');
        out.newKeysDelta += currentDiffs.length;
      }
      out.driftDetected = true;
      return out;
    }
  }

  if (options?.dryRun) {
    const effectiveLocales = options?.localeFilter?.length
      ? config.target_locales.filter(l => options.localeFilter!.includes(l))
      : config.target_locales;

    // Estimate characters for new/stale keys across all effective locales
    out.estimatedCharactersDelta += toTranslate.reduce((sum, d) => sum + (d.value?.length ?? 0), 0) * effectiveLocales.length;

    if (hasNewLocale) {
      // Count current keys needing translation for new locales
      const currentDiffs = diffs.filter(d => d.status === 'current');
      out.newKeysDelta += currentDiffs.length;

      // Estimate characters for current keys needing translation for new locales only
      const currentChars = currentDiffs.reduce((sum, d) => sum + (d.value?.length ?? 0), 0);
      const newLocaleCount = effectiveLocales.filter(locale =>
        diffs.some(d => d.status === 'current' && !fileLockEntries[d.key]?.translations[locale]),
      ).length;
      out.estimatedCharactersDelta += currentChars * newLocaleCount;
    }
    return out;
  }

  if (deletedDiffs.length > 0) {
    const fileEntryMap = lockFile.entries[relPath] ??= {};
    for (const diff of deletedDiffs) {
      delete fileEntryMap[diff.key];
    }
    if (Object.keys(fileEntryMap).length === 0) {
      delete lockFile.entries[relPath];
    }
    out.lockDirty = true;
  }

  const hasDeleted = diffs.some(d => d.status === 'deleted');

  if (toTranslate.length === 0 && !hasDeleted && !hasNewLocale) {
    return out;
  }

  const locales = options?.localeFilter?.length
    ? config.target_locales.filter(l => options.localeFilter!.includes(l))
    : config.target_locales;

  if (options?.localeFilter?.length && locales.length === 0) {
    Logger.warn(`No matching locales for filter [${options.localeFilter.join(', ')}]. Available: ${config.target_locales.join(', ')}`);
  }

  const concurrency = isMultiLocale
    ? 1
    : (options?.concurrency ?? config.sync?.concurrency ?? MULTI_TARGET_CONCURRENCY);

  if (config.sync?.max_characters !== undefined && !options?.force) {
    let estimatedChars = toTranslate.reduce((sum, d) => sum + (d.value?.length ?? 0), 0) * locales.length;
    if (hasNewLocale) {
      const currentDiffs = diffs.filter(d => d.status === 'current');
      const currentChars = currentDiffs.reduce((sum, d) => sum + (d.value?.length ?? 0), 0);
      const newLocaleCount = locales.filter(locale =>
        diffs.some(d => d.status === 'current' && !fileLockEntries[d.key]?.translations[locale]),
      ).length;
      estimatedChars += currentChars * newLocaleCount;
    }
    if (currentTotalCharsBilled + out.totalCharsBilledDelta + estimatedChars > config.sync.max_characters) {
      throw new ValidationError(
        `Cost cap exceeded: this sync would use ~${(currentTotalCharsBilled + out.totalCharsBilledDelta + estimatedChars).toLocaleString()} characters ` +
        `(cap: ${config.sync.max_characters.toLocaleString()}). Use --force to override.`,
      );
    }
  }

  // Pre-read existing target files to get current translations
  const existingTargetEntries = new Map<string, Map<string, string>>();
  for (const locale of locales) {
    if (isMultiLocale) {
      const targetParsed = extractTranslatable(parser, content, locale);
      existingTargetEntries.set(locale, new Map(targetParsed.map(e => [e.key, e.value])));
    } else {
      const targetRelPath = resolveTargetPath(relPath, config.source_locale, locale, bucketConfig.target_path_pattern);
      const targetAbsPath = path.join(config.projectRoot, targetRelPath);
      assertPathWithinRoot(targetAbsPath, config.projectRoot);
      try {
        const targetContent = await fs.promises.readFile(targetAbsPath, 'utf-8');
        const targetParsed = extractTranslatable(parser, targetContent);
        existingTargetEntries.set(locale, new Map(targetParsed.map(e => [e.key, e.value])));
      } catch {
        existingTargetEntries.set(locale, new Map());
      }
    }
  }

  // Accumulate source entries for auto-glossary
  for (const entry of entries) {
    sourceEntryMap.set(entry.key, entry.value);
  }

  const localeSuccessMap = new Map<string, Set<string>>();
  const localeBilledMap = new Map<string, Map<string, number>>();
  const contextSentSet = new Set<string>();
  for (const diff of toTranslate) {
    localeSuccessMap.set(diff.key, new Set());
  }
  // Also seed for current keys that may need new-locale translation
  for (const diff of diffs) {
    if (diff.status === 'current' && !localeSuccessMap.has(diff.key)) {
      localeSuccessMap.set(diff.key, new Set());
    }
  }

  const localeGlossaryIds = new Map<string, string>();
  for (const locale of locales) {
    const override = config.translation?.locale_overrides?.[locale]?.glossary;
    if (override && override !== 'auto' && !options?.dryRun) {
      localeGlossaryIds.set(locale, await glossaryService.resolveGlossaryId(override));
    }
  }

  const localeTmIds = new Map<string, string>();
  for (const locale of locales) {
    const override = config.translation?.locale_overrides?.[locale]?.translation_memory;
    if (override && !options?.dryRun) {
      localeTmIds.set(locale, await resolveTranslationMemoryId(
        translationService,
        override,
        tmCache,
        { from: config.source_locale as Language, targets: [locale as Language] },
      ));
    }
  }

  await mapWithConcurrency(locales, async (locale) => {
   if (options?.cancellationSignal?.cancelled) {
    return;
   }
   try {
    const result = await localeTranslator.translate({
      locale, relPath, content, parser,
      diffs, toTranslate, fileLockEntries,
      existingTargetEntries, keyContexts,
      localeGlossaryIds, localeTmIds,
      bucketConfig, isMultiLocale,
    });

    out.totalCharsBilledDelta += result.charactersBilled;
    out.validationWarningsDelta += result.validationWarnings;
    out.validationErrorsDelta += result.validationErrors;
    out.fileResults.push(result.fileResult);

    for (const key of result.successfulKeys) {
      localeSuccessMap.get(key)?.add(locale);
    }
    for (const [key, chars] of result.billedPerKey) {
      const billedMap = localeBilledMap.get(key) ?? new Map<string, number>();
      billedMap.set(locale, chars);
      localeBilledMap.set(key, billedMap);
    }
    for (const key of result.contextSentKeys) {
      contextSentSet.add(key);
      allContextSentKeys.add(key);
    }
    for (const key of result.instructionSentKeys) {
      allInstructionSentKeys.add(key);
    }
    for (const [elemType, count] of result.instructionGroupCounts) {
      allInstructionGroupTotals.set(elemType, (allInstructionGroupTotals.get(elemType) ?? 0) + count);
    }

    const localeTargetEntries = targetEntryMap.get(locale) ?? new Map<string, string>();
    for (const [key, value] of result.targetEntries) {
      localeTargetEntries.set(key, value);
    }
    targetEntryMap.set(locale, localeTargetEntries);

    options?.onProgress?.({
      type: 'locale-complete',
      locale,
      file: relPath,
      translated: result.fileResult.translated,
      failed: result.fileResult.failed,
      totalKeys: result.fileResult.translated + result.fileResult.failed,
      charactersBilled: result.charactersBilled,
    });
   } catch (localeError) {
    const msg = localeError instanceof Error ? localeError.message : String(localeError);
    // Containment violations abort the whole sync instead of being retried per locale.
    if (msg.includes('Authentication') || msg.includes('Forbidden') || msg.includes('quota')
      || (localeError instanceof ValidationError && msg.includes('escapes project root'))) {
      throw localeError;
    }
    Logger.error(`Sync failed for locale "${locale}" on "${relPath}": ${msg}`);
    out.fileResults.push({
      file: relPath,
      locale,
      translated: 0,
      skipped: 0,
      failed: diffs.length,
      written: false,
    });
    options?.onProgress?.({
      type: 'locale-complete',
      locale,
      file: relPath,
      translated: 0,
      failed: diffs.length,
      totalKeys: toTranslate.length,
      charactersBilled: 0,
    });
   }
  }, concurrency);

  const fileEntryMap = lockFile.entries[relPath] ??= {};
  for (const diff of toTranslate) {
    if (diff.value === undefined) continue;
    const existingEntry = fileEntryMap[diff.key];
    const existingTranslations = existingEntry?.translations ?? {};

    const newTranslations: Record<string, SyncLockTranslation> = { ...existingTranslations };
    for (const locale of locales) {
      const charCount = localeBilledMap.get(diff.key)?.get(locale);
      newTranslations[locale] = {
        hash: computeSourceHash(diff.value, diff.metadata),
        translated_at: new Date().toISOString(),
        status: localeSuccessMap.get(diff.key)?.has(locale) ? 'translated' : 'failed',
        ...(charCount !== undefined && { character_count: charCount }),
        ...(contextSentSet.has(diff.key) && { context_sent: true }),
        ...(options?.flagForReview && { review_status: 'machine_translated' as const }),
      };
    }

    fileEntryMap[diff.key] = {
      source_hash: computeSourceHash(diff.value, diff.metadata),
      source_text: diff.value,
      translations: newTranslations,
    };
    out.lockDirty = true;
  }

  // Write lock entries for current keys that were translated for new locales
  for (const diff of diffs) {
    if (diff.status !== 'current' || diff.value === undefined) continue;
    const successSet = localeSuccessMap.get(diff.key);
    if (!successSet || successSet.size === 0) continue;
    const existingEntry = fileEntryMap[diff.key];
    const existingTranslations = existingEntry?.translations ?? {};
    let updated = false;
    const newTranslations = { ...existingTranslations };
    for (const locale of locales) {
      if (successSet.has(locale) && !existingTranslations[locale]) {
        newTranslations[locale] = {
          hash: computeSourceHash(diff.value, diff.metadata),
          translated_at: new Date().toISOString(),
          status: 'translated' as const,
          ...(contextSentSet.has(diff.key) && { context_sent: true }),
          ...(options?.flagForReview && { review_status: 'machine_translated' as const }),
        };
        updated = true;
      }
    }
    if (updated) {
      fileEntryMap[diff.key] = {
        source_hash: computeSourceHash(diff.value, diff.metadata),
        source_text: diff.value,
        translations: newTranslations,
      };
      out.lockDirty = true;
    }
  }

  // Clean up empty file entries after all updates
  if (Object.keys(fileEntryMap).length === 0) {
    delete lockFile.entries[relPath];
  }

  return out;
}

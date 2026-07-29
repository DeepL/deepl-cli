import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import type { TranslationService } from '../services/translation.js';
import type { GlossaryService } from '../services/glossary.js';
import type { FormatRegistry } from '../formats/index.js';
import { SyncLockManager } from './sync-lock.js';
import { acquireSyncProcessLock } from './sync-process-lock.js';
import { sweepStaleBackups, resolveBakSweepAgeMs } from './sync-bak-cleanup.js';
import { ValidationError } from '../utils/errors.js';
import { walkBuckets } from './sync-bucket-walker.js';
import type { BucketFileCache } from './sync-bucket-walker.js';
import { LocaleTranslator } from './sync-locale-translator.js';
import { finalizeSyncResult } from './sync-finalize.js';
import { processBucket } from './sync-process-bucket.js';
export { resolveTargetPath } from './sync-utils.js';
import type { ResolvedSyncConfig } from './sync-config.js';
import { LOCK_FILE_NAME } from './types.js';
import type { Language } from '../types/common.js';
import { extractAllKeyContexts, resolveTemplatePatterns, synthesizeContext } from './sync-context.js';
import type { TemplatePatternMatch } from './sync-context.js';
import type { KeyContext } from './sync-context.js';
import { SyncGlossaryManager } from './sync-glossary.js';
import { resolveTranslationMemoryId } from '../services/translation-memory.js';
import { TmCache } from './tm-cache.js';
import { Logger } from '../utils/logger.js';
import { errorMessage } from '../utils/error-message.js';

export type SyncProgressEvent =
  | { type: 'locale-complete'; locale: string; file: string; translated: number; failed: number; totalKeys: number; charactersBilled: number }
  | { type: 'key-translated'; locale: string; file: string; key: string; translated: number; totalKeys: number };

export interface CancellationSignal {
  cancelled: boolean;
}

export interface SyncOptions {
  dryRun?: boolean;
  frozen?: boolean;
  force?: boolean;
  flagForReview?: boolean;
  localeFilter?: string[];
  concurrency?: number;
  batchSize?: number;
  batch?: boolean;
  onProgress?: (event: SyncProgressEvent) => void;
  /**
   * Cooperative cancellation: checked between locale iterations so a long-running
   * sync can be abandoned mid-flight without waiting on the DeepL API. Used by
   * watch mode to abort gracefully on SIGINT/SIGTERM.
   */
  cancellationSignal?: CancellationSignal;
  /**
   * External tracker that receives every `.bak` path this sync creates so an
   * outer controller (e.g. watch mode) can clean them up even if the sync
   * throws or is cancelled before its own successful-completion cleanup runs.
   */
  backupTracker?: Set<string>;
}

export interface SyncFileResult {
  file: string;
  locale: string;
  translated: number;
  skipped: number;
  failed: number;
  written: boolean;
}

export interface SyncStrategy {
  context: number;
  instruction: Record<string, number>;
  batch: number;
}

export interface SyncResult {
  success: boolean;
  totalKeys: number;
  newKeys: number;
  staleKeys: number;
  deletedKeys: number;
  currentKeys: number;
  totalCharactersBilled: number;
  fileResults: SyncFileResult[];
  validationWarnings: number;
  validationErrors: number;
  estimatedCharacters: number;
  targetLocaleCount: number;
  dryRun: boolean;
  frozen: boolean;
  driftDetected: boolean;
  lockUpdated: boolean;
  strategy?: SyncStrategy;
}

export class SyncService {
  // 5-minute TTL: short enough that a TM rotation or deletion is picked up
  // within a single watch session without requiring a process restart, long
  // enough to avoid re-resolving on every bucket pass of a single sync.
  private readonly tmCache = new TmCache();

  constructor(
    private readonly translationService: TranslationService,
    private readonly glossaryService: GlossaryService,
    private readonly formatRegistry: FormatRegistry,
  ) {}

  async sync(config: ResolvedSyncConfig, options?: SyncOptions): Promise<SyncResult> {
    const processLock = acquireSyncProcessLock(config.projectRoot);
    // Watch mode owns its own sweep + backup cleanup via `backupTracker`;
    // only the non-watch runs (single `deepl sync`, `sync push/pull/export`,
    // etc.) need the startup sweep and per-run signal cleanup wired up here.
    const isOuterWatchRun = options?.backupTracker !== undefined;
    const runBackupPaths = options?.backupTracker ?? new Set<string>();

    const cleanupBackups = (): void => {
      for (const bakPath of runBackupPaths) {
        try {
          fs.unlinkSync(bakPath);
        } catch {
          /* ignore — already gone or never landed */
        }
      }
      runBackupPaths.clear();
    };

    const onSignal = (): void => {
      if (!isOuterWatchRun) cleanupBackups();
      processLock.release();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    // --dry-run must not modify the working tree, and this sweep both deletes
    // stale .bak files and can restore a sibling from one, so it is gated on
    // both the watch-run and dry-run flags.
    if (!isOuterWatchRun && !options?.dryRun) {
      try {
        await sweepStaleBackups(
          config.projectRoot,
          resolveBakSweepAgeMs(config.sync?.bak_sweep_max_age_seconds),
          config.buckets,
        );
      } catch (error) {
        // Best-effort — never block the sync — but warn rather than swallowing
        // the error silently.
        Logger.warn(
          `Stale-backup sweep skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    try {
      return await this.runSync(config, { ...options, backupTracker: runBackupPaths });
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      processLock.release();
    }
  }

  private async runSync(config: ResolvedSyncConfig, options?: SyncOptions): Promise<SyncResult> {
    const lockPath = path.join(config.projectRoot, LOCK_FILE_NAME);
    const lockManager = new SyncLockManager(lockPath);
    const lockFile = await lockManager.read();

    if (options?.force && options?.frozen) {
      throw new ValidationError('Cannot use --force and --frozen together');
    }

    if (options?.dryRun && options?.force) {
      Logger.warn('--dry-run with --force shows all keys as new; this does not reflect actual translation needs');
    }

    if (lockFile.source_locale === '') {
      lockFile.source_locale = config.source_locale;
    }

    let totalKeys = 0;
    let newKeys = 0;
    let staleKeys = 0;
    let deletedKeys = 0;
    let currentKeys = 0;
    let totalCharsBilled = 0;
    let estimatedCharacters = 0;
    const fileResults: SyncFileResult[] = [];
    let validationWarnings = 0;
    let validationErrors = 0;
    let driftDetected = false;
    let lockDirty = false;

    let resolvedGlossaryId: string | undefined;
    if (config.translation?.glossary && config.translation.glossary !== 'auto' && !options?.dryRun) {
      resolvedGlossaryId = await this.glossaryService.resolveGlossaryId(config.translation.glossary);
    }

    let resolvedTmId: string | undefined;
    if (config.translation?.translation_memory && !options?.dryRun) {
      const effectiveLocales = options?.localeFilter?.length
        ? config.target_locales.filter(l => options.localeFilter!.includes(l))
        : config.target_locales;
      resolvedTmId = await resolveTranslationMemoryId(
        this.translationService,
        config.translation.translation_memory,
        this.tmCache,
        { from: config.source_locale as Language, targets: effectiveLocales as Language[] },
      );
    }

    let keyContexts = new Map<string, KeyContext>();
    let templatePatterns: TemplatePatternMatch[] = [];
    if (config.context?.enabled) {
      const contextResult = await extractAllKeyContexts({
        scanPaths: config.context.scan_paths ?? ['src/**/*.{ts,tsx,js,jsx}'],
        rootDir: config.projectRoot,
        functionNames: config.context.function_names,
        contextLines: config.context.context_lines,
        maxScanFiles: config.sync?.max_scan_files,
      });
      keyContexts = contextResult.keyContexts;
      templatePatterns = contextResult.templatePatterns;

      if (config.translation?.instruction_templates) {
        const hasElementTypes = [...keyContexts.values()].some(kc => kc.elementType);
        if (!hasElementTypes) {
          Logger.warn('instruction_templates configured but no element types detected in source. Templates only apply to keys inside recognized HTML elements (button, label, th, etc.).');
        }
      }
    }

    // Resolve template literal patterns against known keys from source locale files.
    // Cache (absPath → {content, entries}) so walkBuckets can reuse the same
    // reads/parses for the main translation loop instead of re-reading every file.
    const bucketFileCache: BucketFileCache = new Map();
    if (templatePatterns.length > 0) {
      const allKnownKeys = new Set<string>();
      for (const [fk, bc] of Object.entries(config.buckets)) {
        const p = this.formatRegistry.getParserByFormatKey(fk);
        if (!p) continue;
        const ignorePatterns = [...(bc.exclude ?? []), ...(config.ignore ?? [])];
        const files = await fg(bc.include, {
          cwd: config.projectRoot, ignore: ignorePatterns,
          absolute: true, followSymbolicLinks: false,
        });
        for (const f of files) {
          try {
            const c = await fs.promises.readFile(f, 'utf-8');
            const entries = p.multiLocale ? p.extract(c, config.source_locale) : p.extract(c);
            bucketFileCache.set(f, { content: c, entries });
            for (const entry of entries) allKnownKeys.add(entry.key);
          } catch { /* skip unreadable files */ }
        }
      }
      const resolved = resolveTemplatePatterns(templatePatterns, Array.from(allKnownKeys));
      for (const [key, matches] of resolved) {
        if (!keyContexts.has(key)) {
          keyContexts.set(key, { key, context: synthesizeContext(matches, { key }), occurrences: matches.length });
        }
      }
    }

    if (config.translation?.instruction_templates && !config.context?.enabled) {
      Logger.warn('instruction_templates configured but context scanning is disabled — templates have no effect. Set context.enabled: true.');
    }

    const sourceEntryMap = new Map<string, string>();
    const targetEntryMap = new Map<string, Map<string, string>>();
    const processedFiles = new Set<string>();
    const backupPaths = options?.backupTracker ?? new Set<string>();
    const localeTranslator = new LocaleTranslator(
      this.translationService,
      backupPaths,
      config,
      resolvedGlossaryId,
      resolvedTmId,
      options?.batch ?? config.sync?.batch,
      options?.onProgress,
    );
    const allContextSentKeys = new Set<string>();
    const allInstructionSentKeys = new Set<string>();
    const allInstructionGroupTotals = new Map<string, number>();

    for await (const walked of walkBuckets(config, this.formatRegistry, { strictParser: true, fileCache: bucketFileCache })) {
      processedFiles.add(walked.relPath);
      const contribution = await processBucket(walked, {
        config, options, lockFile,
        sourceEntryMap, targetEntryMap,
        allContextSentKeys, allInstructionSentKeys, allInstructionGroupTotals,
        keyContexts, localeTranslator,
        glossaryService: this.glossaryService,
        translationService: this.translationService,
        tmCache: this.tmCache,
        currentTotalCharsBilled: totalCharsBilled,
      });

      totalKeys += contribution.totalKeysDelta;
      newKeys += contribution.newKeysDelta;
      staleKeys += contribution.staleKeysDelta;
      deletedKeys += contribution.deletedKeysDelta;
      currentKeys += contribution.currentKeysDelta;
      totalCharsBilled += contribution.totalCharsBilledDelta;
      estimatedCharacters += contribution.estimatedCharactersDelta;
      validationWarnings += contribution.validationWarningsDelta;
      validationErrors += contribution.validationErrorsDelta;
      fileResults.push(...contribution.fileResults);
      if (contribution.driftDetected) driftDetected = true;
      if (contribution.lockDirty) lockDirty = true;
    }

    // Fix SPEC-02: Wire auto-glossary sync
    if (config.translation?.glossary === 'auto' && !options?.dryRun && !driftDetected) {
      const effectiveLocales = options?.localeFilter?.length
        ? config.target_locales.filter(l => options.localeFilter!.includes(l))
        : config.target_locales;
      const glossaryManager = new SyncGlossaryManager({
        sourceLocale: config.source_locale,
        targetLocales: effectiveLocales,
        glossaryService: this.glossaryService,
      });
      try {
        const glossaryIds = await glossaryManager.syncGlossaries(sourceEntryMap, targetEntryMap);
        lockFile.glossary_ids = { ...lockFile.glossary_ids, ...glossaryIds };
        lockDirty = true;
      } catch (error) {
        Logger.warn(
          `Auto-glossary sync failed for locales ${effectiveLocales.join(', ')}: ${errorMessage(error)}. Translations were written; the project glossaries were not updated.`,
        );
      }
    }

    // Clean stale lock entries for files no longer matched by any bucket glob.
    // Before deletion, scan the project root for any file sharing the base
    // name of the lock path: if one exists, the bucket glob has likely changed
    // (path moved) rather than the source being truly deleted, so preserve the
    // entry and log a warning. Silent deletion in that case would wipe
    // translation history.
    if (!options?.dryRun && !options?.frozen && !driftDetected) {
      const staleByBaseName = new Map<string, string[]>();
      for (const lockPath of Object.keys(lockFile.entries)) {
        if (processedFiles.has(lockPath)) continue;
        const baseName = path.basename(lockPath);
        const group = staleByBaseName.get(baseName);
        if (group) {
          group.push(lockPath);
        } else {
          staleByBaseName.set(baseName, [lockPath]);
        }
      }

      if (staleByBaseName.size > 0) {
        const patterns = Array.from(staleByBaseName.keys()).map(
          (b) => `**/${fg.escapePath(b)}`,
        );
        const scanHits = await fg(patterns, {
          cwd: config.projectRoot,
          absolute: false,
          followSymbolicLinks: false,
          ignore: config.ignore,
        });
        for (const [baseName, lockPaths] of staleByBaseName) {
          const hitsForBase = scanHits.filter((hit) => path.basename(hit) === baseName);
          for (const lockPath of lockPaths) {
            const foundElsewhere = hitsForBase.filter((hit) => hit !== lockPath);
            if (foundElsewhere.length > 0) {
              const preview = foundElsewhere.slice(0, 3).join(', ');
              const suffix = foundElsewhere.length > 3 ? ', …' : '';
              Logger.warn(
                `Lock entry "${lockPath}" no longer matches any bucket glob, but a ` +
                  `file named "${baseName}" exists at: ${preview}${suffix}. ` +
                  `Preserving entry — glob change suspected. Update your bucket ` +
                  `patterns or remove the entry manually to resolve.`,
              );
              continue;
            }
            delete lockFile.entries[lockPath];
            lockDirty = true;
          }
        }
      }
    }

    let lockUpdated = false;
    if (lockDirty && !options?.dryRun && !options?.frozen && !driftDetected) {
      await lockManager.write(lockFile);
      lockUpdated = true;
    }

    if (backupPaths.size > 0 && !driftDetected) {
      for (const bakPath of backupPaths) {
        try {
          await fs.promises.unlink(bakPath);
        } catch {
          Logger.warn(`Failed to remove backup: ${bakPath}`);
        }
      }
      // When an external controller is tracking backups (watch mode), clear
      // the set to reflect that we've already unlinked them — otherwise the
      // controller would warn about missing files on its own cleanup pass.
      if (options?.backupTracker) {
        backupPaths.clear();
      }
    }

    if (config.validation?.fail_on_error && validationErrors > 0) {
      throw new ValidationError(
        `Sync completed but validation failed: ${validationErrors} error(s), ${validationWarnings} warning(s)`
      );
    }

    const effectiveLocaleCount = options?.localeFilter?.length
      ? config.target_locales.filter(l => options.localeFilter!.includes(l)).length
      : config.target_locales.length;

    return finalizeSyncResult({
      totalKeys, newKeys, staleKeys, deletedKeys, currentKeys,
      totalCharsBilled, fileResults, validationWarnings, validationErrors,
      estimatedCharacters, effectiveLocaleCount,
      dryRun: options?.dryRun ?? false,
      frozen: options?.frozen ?? false,
      driftDetected, lockUpdated,
      allContextSentKeys, allInstructionSentKeys, allInstructionGroupTotals,
    });
  }

}

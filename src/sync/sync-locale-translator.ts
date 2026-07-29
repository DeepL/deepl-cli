import * as fs from 'fs';
import * as path from 'path';
import type { FormatParser, TranslatedEntry } from '../formats/index.js';
import type { TranslationService } from '../services/translation.js';
import type { TranslationOptions } from '../types/api.js';
import type { TranslationResult } from '../api/translation-client.js';
import type { Language } from '../types/common.js';
import type { ResolvedSyncConfig } from './sync-config.js';
import type { SyncBucketConfig, SyncDiff, SyncLockEntry } from './types.js';
import type { KeyContext } from './sync-context.js';
import { sectionContextKey, sectionToContext } from './sync-context.js';
import { supportsCustomInstructions, generateElementInstruction, mergeInstructions, generateLengthInstruction } from './sync-instructions.js';
import { validateBatch } from './translation-validator.js';
import { atomicWriteFile } from '../utils/atomic-write.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { resolveTargetPath, assertPathWithinRoot } from './sync-utils.js';
import { BACKUP_SUFFIX } from './sync-bak-cleanup.js';
import { Logger } from '../utils/logger.js';
import { preserveVariables, restorePlaceholders } from '../utils/text-preservation.js';
import { expandPlurals, detectIcu, reassembleIcu, writebackPlurals } from './sync-message-preprocess.js';
import type { SyncProgressEvent, SyncFileResult } from './sync-service.js';

export interface LocaleTranslatorContext {
  locale: string;
  relPath: string;
  content: string;
  parser: FormatParser;
  diffs: SyncDiff[];
  toTranslate: SyncDiff[];
  fileLockEntries: Record<string, SyncLockEntry>;
  existingTargetEntries: Map<string, Map<string, string>>;
  keyContexts: Map<string, KeyContext>;
  localeGlossaryIds: Map<string, string>;
  localeTmIds: Map<string, string>;
  bucketConfig: SyncBucketConfig;
  isMultiLocale: boolean;
}

export interface TranslateLocaleResult {
  fileResult: SyncFileResult;
  successfulKeys: string[];
  charactersBilled: number;
  billedPerKey: Map<string, number>;
  contextSentKeys: Set<string>;
  instructionSentKeys: Set<string>;
  instructionGroupCounts: Map<string, number>;
  targetEntries: Map<string, string>;
  validationWarnings: number;
  validationErrors: number;
}

export class LocaleTranslator {
  // tmCache remains instance-level on SyncService. The orchestrator resolves
  // TM IDs before calling LocaleTranslator.translate and passes the resolved
  // per-locale Map through the context; LocaleTranslator itself does not
  // resolve TM IDs.
  constructor(
    private readonly translationService: TranslationService,
    private readonly backupPaths: Set<string>,
    private readonly config: ResolvedSyncConfig,
    private readonly resolvedGlossaryId: string | undefined,
    private readonly resolvedTmId: string | undefined,
    private readonly forceBatch: boolean | undefined,
    private readonly onProgress: ((e: SyncProgressEvent) => void) | undefined,
  ) {}

  async translate(ctx: LocaleTranslatorContext): Promise<TranslateLocaleResult> {
    const { locale, relPath, content, parser, diffs, toTranslate,
      fileLockEntries, existingTargetEntries, keyContexts,
      localeGlossaryIds, localeTmIds,
      bucketConfig, isMultiLocale } = ctx;
    const config = this.config;
    const resolvedGlossaryId = this.resolvedGlossaryId;
    const resolvedTmId = this.resolvedTmId;
    const forceBatch = this.forceBatch;

    const localeOverrides = config.translation?.locale_overrides?.[locale];
    const baseTranslationOpts: TranslationOptions = {
      sourceLang: config.source_locale as Language,
      targetLang: locale as Language,
      formality: localeOverrides?.formality ?? config.translation?.formality,
      glossaryId: localeGlossaryIds.get(locale) ?? resolvedGlossaryId,
      translationMemoryId: localeTmIds.get(locale) ?? resolvedTmId,
      translationMemoryThreshold:
        localeOverrides?.translation_memory_threshold ?? config.translation?.translation_memory_threshold,
      modelType: config.translation?.model_type,
      customInstructions: localeOverrides?.custom_instructions ?? config.translation?.custom_instructions,
      styleId: localeOverrides?.style_id ?? config.translation?.style_id,
      showBilledCharacters: true,
    };

    // Deep-clone metadata per locale to prevent concurrent mutation
    const localeDiffs = toTranslate.map(d => ({
      ...d,
      metadata: d.metadata ? JSON.parse(JSON.stringify(d.metadata)) as Record<string, unknown> : undefined,
    }));

    const textsToTranslate = localeDiffs
      .map(d => d.value)
      .filter((v): v is string => v !== undefined);

    const { extendedTexts: pluralExpanded, pluralSlots } = expandPlurals(textsToTranslate, localeDiffs);
    const { extendedTexts, icuMappings } = detectIcu(pluralExpanded);

    const preservationMaps: Map<string, string>[] = [];
    const protectedTexts = extendedTexts.map(text => {
      const preservationMap = new Map<string, string>();
      const protected_ = preserveVariables(text, preservationMap);
      preservationMaps.push(preservationMap);
      return protected_;
    });

    // Three-way translation: per-key context vs. element instruction batch vs. plain batch
    let results: (TranslationResult | null)[];
    const contextSentKeys = new Set<string>();
    const instructionSentKeys = new Set<string>();
    const instructionGroupCounts = new Map<string, number>();

    if (forceBatch === true || localeDiffs.length <= 1) {
      // --batch mode or single key: use existing batch behavior
      const contextForSingle = localeDiffs.length === 1
        ? (config.context?.overrides?.[localeDiffs[0]?.key ?? ''] ?? keyContexts.get(localeDiffs[0]?.key ?? '')?.context)
        : undefined;
      if (contextForSingle && !forceBatch) {
        contextSentKeys.add(localeDiffs[0]!.key);
      }
      const translationOpts: TranslationOptions = { ...baseTranslationOpts, context: contextForSingle };
      results = await this.translationService.translateBatch(protectedTexts, translationOpts);
      for (let i = 0; i < localeDiffs.length; i++) {
        this.onProgress?.({
          type: 'key-translated', locale, file: relPath,
          key: localeDiffs[i]!.key, translated: i + 1, totalKeys: localeDiffs.length,
        });
      }
    } else {
      // Three-way partitioning: context (per-key) vs. element instruction (batched) vs. plain batch
      const localeSupportsInstructions = supportsCustomInstructions(locale);
      const contextIndices: number[] = [];
      const instructionGroups = new Map<string, number[]>(); // elementType → indices
      const batchIndices: number[] = [];

      for (let i = 0; i < localeDiffs.length; i++) {
        const diff = localeDiffs[i]!;
        const keyContext = config.context?.overrides?.[diff.key] ?? keyContexts.get(diff.key)?.context;
        if (keyContext) {
          // Path B: per-key context takes priority
          contextIndices.push(i);
        } else if (localeSupportsInstructions) {
          const elementType = keyContexts.get(diff.key)?.elementType;
          const instruction = generateElementInstruction(elementType, config.translation?.instruction_templates);
          if (instruction) {
            // Path C: batch by element type with shared instructions
            const group = instructionGroups.get(elementType!) ?? [];
            group.push(i);
            instructionGroups.set(elementType!, group);
          } else {
            batchIndices.push(i);
          }
        } else {
          batchIndices.push(i);
        }
      }

      results = new Array<TranslationResult | null>(protectedTexts.length).fill(null);

      // Path A: batch translation for keys without context or instructions
      if (batchIndices.length > 0) {
        const batchTexts: string[] = [];
        const batchPMapIndices: number[] = [];
        for (const idx of batchIndices) {
          batchTexts.push(protectedTexts[idx]!);
          batchPMapIndices.push(idx);
        }
        const batchSet = new Set(batchIndices);
        for (const slot of pluralSlots) {
          if (batchSet.has(slot.diffIndex)) {
            batchTexts.push(protectedTexts[slot.textIndex]!);
            batchPMapIndices.push(slot.textIndex);
          }
        }
        const batchOpts: TranslationOptions = { ...baseTranslationOpts, context: undefined };
        const batchResults = await this.translationService.translateBatch(batchTexts, batchOpts);
        for (let bi = 0; bi < batchPMapIndices.length; bi++) {
          results[batchPMapIndices[bi]!] = batchResults[bi] ?? null;
        }
        for (let bi = 0; bi < batchIndices.length; bi++) {
          this.onProgress?.({
            type: 'key-translated', locale, file: relPath,
            key: localeDiffs[batchIndices[bi]!]!.key, translated: bi + 1, totalKeys: localeDiffs.length,
          });
        }
      }

      // Path C: batch by element type with shared custom_instructions
      let pathCCompleted = batchIndices.length;
      for (const [elementType, indices] of instructionGroups) {
        instructionGroupCounts.set(elementType, (instructionGroupCounts.get(elementType) ?? 0) + indices.length);
        for (const idx of indices) {
          instructionSentKeys.add(localeDiffs[idx]!.key);
        }
        const instruction = generateElementInstruction(elementType, config.translation?.instruction_templates)!;
        const groupInstructions = mergeInstructions(baseTranslationOpts.customInstructions, instruction);

        const groupTexts: string[] = [];
        const groupPMapIndices: number[] = [];
        for (const idx of indices) {
          groupTexts.push(protectedTexts[idx]!);
          groupPMapIndices.push(idx);
        }
        const indicesSet = new Set(indices);
        for (const slot of pluralSlots) {
          if (indicesSet.has(slot.diffIndex)) {
            groupTexts.push(protectedTexts[slot.textIndex]!);
            groupPMapIndices.push(slot.textIndex);
          }
        }

        const groupOpts: TranslationOptions = { ...baseTranslationOpts, context: undefined, customInstructions: groupInstructions };
        const groupResults = await this.translationService.translateBatch(groupTexts, groupOpts);
        for (let gi = 0; gi < groupPMapIndices.length; gi++) {
          results[groupPMapIndices[gi]!] = groupResults[gi] ?? null;
        }
        for (const idx of indices) {
          pathCCompleted++;
          this.onProgress?.({
            type: 'key-translated', locale, file: relPath,
            key: localeDiffs[idx]!.key, translated: pathCCompleted, totalKeys: localeDiffs.length,
          });
        }
      }

      // Path B: context keys — batch by section where possible, per-key for overrides
      let perKeyCompleted = pathCCompleted;
      if (contextIndices.length > 0) {
        for (const idx of contextIndices) {
          contextSentKeys.add(localeDiffs[idx]!.key);
        }

        // --no-batch forces true per-key; default uses section batching for multi-segment keys
        const forcePerKey = forceBatch === false;
        const perKeyIndices: number[] = [];
        const sectionGroups = new Map<string, number[]>();
        for (const idx of contextIndices) {
          const diff = localeDiffs[idx]!;
          const section = sectionContextKey(diff.key);
          if (forcePerKey || config.context?.overrides?.[diff.key] || !section) {
            perKeyIndices.push(idx);
          } else {
            const group = sectionGroups.get(section) ?? [];
            group.push(idx);
            sectionGroups.set(section, group);
          }
        }

        // Path B1: section-batched context translation
        for (const [section, indices] of sectionGroups) {
          const sectionCtx = sectionToContext(section);

          // Track element instructions for keys in this section batch
          for (const idx of indices) {
            const elementType = keyContexts.get(localeDiffs[idx]!.key)?.elementType;
            const autoInstruction = localeSupportsInstructions
              ? generateElementInstruction(elementType, config.translation?.instruction_templates)
              : undefined;
            if (autoInstruction && elementType) {
              instructionSentKeys.add(localeDiffs[idx]!.key);
              instructionGroupCounts.set(elementType, (instructionGroupCounts.get(elementType) ?? 0) + 1);
            }
          }

          const groupTexts: string[] = [];
          const groupPMapIndices: number[] = [];
          for (const idx of indices) {
            groupTexts.push(protectedTexts[idx]!);
            groupPMapIndices.push(idx);
          }
          const sectionIndicesSet = new Set(indices);
          for (const slot of pluralSlots) {
            if (sectionIndicesSet.has(slot.diffIndex)) {
              groupTexts.push(protectedTexts[slot.textIndex]!);
              groupPMapIndices.push(slot.textIndex);
            }
          }

          const groupOpts: TranslationOptions = { ...baseTranslationOpts, context: sectionCtx };
          const groupResults = await this.translationService.translateBatch(groupTexts, groupOpts);
          for (let gi = 0; gi < groupPMapIndices.length; gi++) {
            results[groupPMapIndices[gi]!] = groupResults[gi] ?? null;
          }
          for (const idx of indices) {
            perKeyCompleted++;
            this.onProgress?.({
              type: 'key-translated', locale, file: relPath,
              key: localeDiffs[idx]!.key, translated: perKeyCompleted, totalKeys: localeDiffs.length,
            });
          }
        }

        // Path B2: per-key for override keys and single-segment keys
        if (perKeyIndices.length > 0) {
          const concurrency = config.sync?.concurrency ?? 5;
          await mapWithConcurrency(perKeyIndices, async (idx) => {
            const diff = localeDiffs[idx]!;
            const keyContext = config.context?.overrides?.[diff.key] ?? keyContexts.get(diff.key)?.context ?? '';

            const elementType = keyContexts.get(diff.key)?.elementType;
            const autoInstruction = localeSupportsInstructions
              ? generateElementInstruction(elementType, config.translation?.instruction_templates)
              : undefined;
            if (autoInstruction && elementType) {
              instructionSentKeys.add(diff.key);
              instructionGroupCounts.set(elementType, (instructionGroupCounts.get(elementType) ?? 0) + 1);
            }
            const lengthInstruction = (localeSupportsInstructions && config.translation?.length_limits?.enabled)
              ? generateLengthInstruction(diff.value ?? '', elementType, locale, config.translation.length_limits)
              : undefined;
            let perKeyInstructions = mergeInstructions(baseTranslationOpts.customInstructions, autoInstruction);
            perKeyInstructions = mergeInstructions(perKeyInstructions, lengthInstruction);

            const keyOpts: TranslationOptions = { ...baseTranslationOpts, context: keyContext, customInstructions: perKeyInstructions };

            const keyTexts = [protectedTexts[idx]!];
            const keyTextIndices = [idx];
            for (const slot of pluralSlots) {
              if (slot.diffIndex === idx) {
                keyTexts.push(protectedTexts[slot.textIndex]!);
                keyTextIndices.push(slot.textIndex);
              }
            }

            const keyResults = await this.translationService.translateBatch(keyTexts, keyOpts);
            for (let ki = 0; ki < keyTextIndices.length; ki++) {
              results[keyTextIndices[ki]!] = keyResults[ki] ?? null;
            }
            perKeyCompleted++;
            this.onProgress?.({
              type: 'key-translated', locale, file: relPath,
              key: diff.key, translated: perKeyCompleted, totalKeys: localeDiffs.length,
            });
          }, concurrency);
        }
      }
    }

    // Restore placeholders in all results
    for (let ri = 0; ri < results.length; ri++) {
      const pMap = preservationMaps[ri];
      if (results[ri] && pMap && pMap.size > 0) {
        results[ri]!.text = restorePlaceholders(results[ri]!.text, pMap);
      }
    }

    await reassembleIcu(this.translationService, results, icuMappings, baseTranslationOpts);
    writebackPlurals(results, pluralSlots, localeDiffs);

    for (let i = 0; i < localeDiffs.length; i++) {
      const diff = localeDiffs[i]!;
      const result = results[i];
      if (!result || !diff.metadata) continue;

      if (diff.metadata['msgid_plural'] !== undefined) {
        const forms = (diff.metadata['plural_forms'] as Record<string, string>) ?? {};
        forms['msgstr[0]'] = result.text;
        diff.metadata['plural_forms'] = forms;
      }

      const androidPlurals = diff.metadata['plurals'] as Array<{quantity: string; value: string}> | undefined;
      if (androidPlurals) {
        const primary = androidPlurals.find(p => p.value === diff.value);
        if (primary) primary.value = result.text;
      }
    }

    const translatedEntries: TranslatedEntry[] = [];
    let translated = 0;
    let failed = 0;
    let localeBilled = 0;
    const billedPerKey = new Map<string, number>();

    for (let i = 0; i < localeDiffs.length; i++) {
      const diff = localeDiffs[i]!;
      const result = results[i];
      if (result && diff.value !== undefined) {
        translatedEntries.push({
          key: diff.key,
          value: diff.value,
          translation: result.text,
          metadata: diff.metadata,
        });
        translated++;
        if (result.billedCharacters) {
          localeBilled += result.billedCharacters;
          billedPerKey.set(diff.key, result.billedCharacters);
        }
      } else {
        failed++;
      }
    }

    for (let ri = textsToTranslate.length; ri < results.length; ri++) {
      if (results[ri]?.billedCharacters) {
        localeBilled += results[ri]!.billedCharacters!;
      }
    }

    const successfulKeys: string[] = translatedEntries.map(te => te.key);

    let localeValidationWarnings = 0;
    let localeValidationErrors = 0;
    if (config.validation?.validate_after_sync !== false && config.validation?.check_placeholders !== false) {
      const validationInputs = translatedEntries.map(e => ({
        key: e.key,
        source: e.value,
        translation: e.translation,
      }));
      const validationResults = validateBatch(validationInputs);
      for (const vr of validationResults) {
        for (const issue of vr.issues) {
          if (issue.severity === 'warn') localeValidationWarnings++;
          if (issue.severity === 'error') localeValidationErrors++;
        }
      }
    }

    // Use target file translations for current keys
    const existingTranslations = existingTargetEntries.get(locale) ?? new Map<string, string>();
    const allTranslatedEntries: TranslatedEntry[] = [...translatedEntries];
    const currentDiffs = diffs.filter(d => d.status === 'current');
    const currentDiffByKey = new Map(currentDiffs.map((d) => [d.key, d]));
    const untranslatedCurrentKeys: string[] = [];
    for (const cd of currentDiffs) {
      if (cd.value === undefined) continue;
      const existingTranslation = existingTranslations.get(cd.key);
      const lockEntry = fileLockEntries[cd.key];
      const hasLocaleTranslation = lockEntry?.translations[locale] !== undefined;
      if (existingTranslation !== undefined) {
        // Present in the target file — including a deliberately empty string,
        // which must be preserved rather than treated as missing.
        allTranslatedEntries.push({
          key: cd.key,
          value: cd.value,
          translation: existingTranslation,
          metadata: cd.metadata,
        });
      } else {
        // No translation in the target file. Translate it, even when the
        // lockfile claims this locale already has one: that combination means
        // the target file was deleted or emptied. Writing the source value here
        // would record untranslated text as `translated`, which no later run
        // would correct.
        untranslatedCurrentKeys.push(cd.key);
        if (hasLocaleTranslation) {
          Logger.verbose(
            `[verbose] ${locale}: lockfile records a translation for "${cd.key}" but the target file has none — re-translating`,
          );
        }
      }
    }

    // Translate current keys that have no translation for this locale (new locale scenario)
    if (untranslatedCurrentKeys.length > 0) {
      const textsForNewLocale = untranslatedCurrentKeys
        .map(key => currentDiffByKey.get(key)!)
        .map(d => d.value!)
        .filter((v): v is string => v !== null && v !== undefined);
      if (textsForNewLocale.length > 0) {
        const nlPreservationMaps: Map<string, string>[] = [];
        const nlProtectedTexts = textsForNewLocale.map(text => {
          const pMap = new Map<string, string>();
          const protected_ = preserveVariables(text, pMap);
          nlPreservationMaps.push(pMap);
          return protected_;
        });

        const newLocaleOpts: TranslationOptions = { ...baseTranslationOpts, context: undefined };
        const newLocaleResults = await this.translationService.translateBatch(nlProtectedTexts, newLocaleOpts);

        for (let ri = 0; ri < newLocaleResults.length; ri++) {
          const pMap = nlPreservationMaps[ri];
          if (newLocaleResults[ri] && pMap && pMap.size > 0) {
            newLocaleResults[ri]!.text = restorePlaceholders(newLocaleResults[ri]!.text, pMap);
          }
        }

        for (let nli = 0; nli < untranslatedCurrentKeys.length; nli++) {
          const key = untranslatedCurrentKeys[nli]!;
          const cd = currentDiffByKey.get(key)!;
          const nlResult = newLocaleResults[nli];
          if (nlResult) {
            allTranslatedEntries.push({
              key,
              value: cd.value!,
              translation: nlResult.text,
              metadata: cd.metadata,
            });
            successfulKeys.push(key);
            translated++;
            if (nlResult.billedCharacters) {
              localeBilled += nlResult.billedCharacters;
            }
          } else {
            allTranslatedEntries.push({
              key,
              value: cd.value!,
              translation: cd.value!,
              metadata: cd.metadata,
            });
            failed++;
          }
        }
      }
    }

    const targetRelPath = isMultiLocale
      ? relPath
      : resolveTargetPath(relPath, config.source_locale, locale, bucketConfig.target_path_pattern);
    const targetAbsPath = path.join(config.projectRoot, targetRelPath);
    assertPathWithinRoot(targetAbsPath, config.projectRoot);

    let templateContent = content;
    let targetExists = false;
    try {
      const existingTargetContent = await fs.promises.readFile(targetAbsPath, 'utf-8');
      if (existingTargetContent.trim()) {
        templateContent = existingTargetContent;
      }
      targetExists = true;
    } catch {
      templateContent = content;
    }

    if (targetExists && config.sync?.backup !== false && !this.backupPaths.has(targetAbsPath + BACKUP_SUFFIX)) {
      const bakPath = targetAbsPath + BACKUP_SUFFIX;
      try {
        await fs.promises.copyFile(targetAbsPath, bakPath);
        this.backupPaths.add(bakPath);
      } catch (err) {
        Logger.warn(`Failed to backup ${targetRelPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const reconstructed = isMultiLocale
      ? parser.reconstruct(templateContent, allTranslatedEntries, locale)
      : parser.reconstruct(templateContent, allTranslatedEntries);
    await fs.promises.mkdir(path.dirname(targetAbsPath), { recursive: true });
    await atomicWriteFile(targetAbsPath, reconstructed, 'utf-8');

    const targetEntries = new Map<string, string>();
    for (const te of allTranslatedEntries) {
      targetEntries.set(te.key, te.translation);
    }

    return {
      fileResult: {
        file: targetRelPath,
        locale,
        translated,
        skipped: currentDiffs.length,
        failed,
        written: true,
      },
      successfulKeys,
      charactersBilled: localeBilled,
      billedPerKey,
      contextSentKeys,
      instructionSentKeys,
      instructionGroupCounts,
      targetEntries,
      validationWarnings: localeValidationWarnings,
      validationErrors: localeValidationErrors,
    };
  }
}

import type { Language } from '../../../types/index.js';
import type { GlossaryService } from '../../../services/glossary.js';
import type { TranslationService } from '../../../services/translation.js';
import { resolveTranslationMemoryId } from '../../../services/translation-memory.js';
import type { TranslateOptions, TranslationParams } from './types.js';
import { buildTranslationOptions as buildBaseLegacy, resolveGlossaryId } from './translate-utils.js';

/**
 * Single source of truth for the *base* TranslateOptions mapping from CLI
 * flags — the shape all translate handlers (text, file, directory, document)
 * agreed on. Produces the same field set regardless of handler.
 *
 * Shared downstream shaping lives in `applySharedTmAndGlossary`; handlers
 * keep only handler-specific shaping (custom instructions, style id, XML tag
 * handling, multi-target stripping of `targetLang`, etc.).
 *
 * Intentional drift NOT folded in:
 *  - `SyncCommand` builds `TranslateOptions` from resolved config, not CLI
 *    flags (per-locale `formality` overrides, `context_sent` wiring, glossary
 *    and TM IDs resolved separately via LocaleTranslator). That construction
 *    stays in `src/sync/sync-locale-translator.ts`.
 *  - `customInstructions` and `styleId` are only meaningful for text and
 *    multi-target text translate; those handlers layer them in directly.
 *  - XML tag-handling parameters (`outlineDetection`, `splittingTags`, etc.)
 *    are text-handler-specific.
 */
export function buildBaseTranslationOptions(options: TranslateOptions): TranslationParams {
  return buildBaseLegacy(options);
}

export interface SharedTmAndGlossaryDeps {
  glossaryService: GlossaryService;
  translationService: TranslationService;
  targets: Language[];
  /**
   * Optional shared TM resolver cache. Defaults to a fresh per-call Map so
   * callers that don't already manage one get safe no-op behavior. Sync/watch
   * flows pass their session-scoped cache here.
   */
  tmCache?: Map<string, string>;
}

/**
 * Layer glossary + translation-memory resolution + tm-threshold + model-type
 * default onto a base `TranslationParams`-compatible object. Mutates `base`
 * in place so handlers can compose additional downstream shaping.
 *
 * Shared by the text + file handlers. All
 * validation (required `--from`, TM-requires-quality_optimized, extended-lang
 * constraints) remains in the caller so per-handler error messages are
 * preserved; this helper is called only after validation passes.
 *
 * The generic `T` lets callers pass a `TranslationParams` (text handler), a
 * `TranslationParams & { outputDir: string }` (file multi-target), or the
 * rest-spread object produced by multi-target text (which drops `targetLang`)
 * without TypeScript index-signature friction.
 */
export async function applySharedTmAndGlossary<
  T extends {
    glossaryId?: string;
    translationMemoryId?: string;
    translationMemoryThreshold?: number;
    modelType?: TranslationParams['modelType'];
  },
>(
  base: T,
  options: TranslateOptions,
  deps: SharedTmAndGlossaryDeps,
): Promise<void> {
  if (options.glossary) {
    base.glossaryId = await resolveGlossaryId(deps.glossaryService, options.glossary);
  }

  if (options.translationMemory) {
    const cache = deps.tmCache ?? new Map<string, string>();
    base.translationMemoryId = await resolveTranslationMemoryId(
      deps.translationService,
      options.translationMemory,
      cache,
      { from: options.from as Language, targets: deps.targets },
    );
    if (options.tmThreshold !== undefined) {
      base.translationMemoryThreshold = options.tmThreshold;
    }
    base.modelType = base.modelType ?? 'quality_optimized';
  }
}

import type { GlossaryService } from '../services/glossary.js';
import type { Language } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export interface SyncGlossaryManagerOptions {
  sourceLocale: string;
  targetLocales: string[];
  glossaryService: GlossaryService;
}

const MAX_TERM_LENGTH = 50;
const MIN_KEY_COUNT = 3;

function entriesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export class SyncGlossaryManager {
  constructor(private readonly options: SyncGlossaryManagerOptions) {}

  /**
   * Extract consistent term mappings from source and target file entries.
   * A "term" is a short source string (<=50 chars) that appears in 3+ different keys
   * with the same translation for a given target locale.
   */
  extractTerms(
    sourceEntries: Map<string, string>,
    targetEntries: Map<string, Map<string, string>>,
  ): Map<string, Record<string, string>> {
    const result = new Map<string, Record<string, string>>();

    // Build a reverse index: sourceText -> Set of keys that have that source text
    const sourceTextToKeys = new Map<string, Set<string>>();
    for (const [key, sourceText] of sourceEntries) {
      if (sourceText.length > MAX_TERM_LENGTH) continue;

      const existing = sourceTextToKeys.get(sourceText);
      if (existing) {
        existing.add(key);
      } else {
        sourceTextToKeys.set(sourceText, new Set([key]));
      }
    }

    for (const [locale, localeEntries] of targetEntries) {
      // Null-prototype: keyed by untrusted source strings, which may be
      // named after Object.prototype members.
      const terms: Record<string, string> = Object.create(null) as Record<string, string>;

      for (const [sourceText, keys] of sourceTextToKeys) {
        if (keys.size < MIN_KEY_COUNT) continue;

        // Collect all translations for this source text in this locale
        let consistentTranslation: string | undefined;
        let isConsistent = true;

        for (const key of keys) {
          const translation = localeEntries.get(key);
          if (translation === undefined) {
            isConsistent = false;
            break;
          }
          if (consistentTranslation === undefined) {
            consistentTranslation = translation;
          } else if (consistentTranslation !== translation) {
            isConsistent = false;
            break;
          }
        }

        if (isConsistent && consistentTranslation !== undefined) {
          terms[sourceText] = consistentTranslation;
        }
      }

      if (Object.keys(terms).length > 0) {
        result.set(locale, terms);
      }
    }

    return result;
  }

  /**
   * Create or update project glossary for each target locale.
   * Naming convention: "deepl-sync-{source}-{target}"
   */
  async syncGlossaries(
    sourceEntries: Map<string, string>,
    targetEntries: Map<string, Map<string, string>>,
  ): Promise<Record<string, string>> {
    const terms = this.extractTerms(sourceEntries, targetEntries);
    const glossaryIds: Record<string, string> = Object.create(null) as Record<string, string>;

    for (const targetLocale of this.options.targetLocales) {
      const localeTerms = terms.get(targetLocale);
      if (!localeTerms || Object.keys(localeTerms).length === 0) {
        continue;
      }

      const name = this.getGlossaryName(targetLocale);
      const existing = await this.options.glossaryService.getGlossaryByName(name);
      const sourceLang = this.options.sourceLocale as Language;
      const targetLang = targetLocale as Language;

      if (existing) {
        const currentEntries = await this.options.glossaryService.getGlossaryEntries(
          existing.glossary_id,
          sourceLang,
          targetLang,
        );

        const localePair = `${this.options.sourceLocale}-${targetLocale}`;
        glossaryIds[localePair] = existing.glossary_id;

        if (!entriesEqual(currentEntries, localeTerms)) {
          await this.options.glossaryService.updateGlossary(existing.glossary_id, {
            dictionaries: [{
              sourceLang,
              targetLang,
              entries: localeTerms,
            }],
          });
          Logger.info(`Updated glossary "${name}" (${existing.glossary_id})`);
        }
      } else {
        const created = await this.options.glossaryService.createGlossary(
          name,
          sourceLang,
          [targetLang],
          localeTerms,
        );
        const localePair = `${this.options.sourceLocale}-${targetLocale}`;
        glossaryIds[localePair] = created.glossary_id;
        Logger.info(`Created glossary "${name}" (${created.glossary_id})`);
      }
    }

    return glossaryIds;
  }

  /**
   * Get existing project glossary ID for a locale pair, or null.
   */
  async getProjectGlossary(targetLocale: string): Promise<string | null> {
    const name = this.getGlossaryName(targetLocale);
    const glossary = await this.options.glossaryService.getGlossaryByName(name);
    return glossary?.glossary_id ?? null;
  }

  getGlossaryName(targetLocale: string): string {
    return `deepl-sync-${this.options.sourceLocale}-${targetLocale}`;
  }
}

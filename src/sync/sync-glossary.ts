import type { GlossaryService } from '../services/glossary.js';
import type { Language } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { errorMessage } from '../utils/error-message.js';

export interface SyncGlossaryManagerOptions {
  sourceLocale: string;
  targetLocales: string[];
  glossaryService: GlossaryService;
}

const MAX_TERM_LENGTH = 50;
const MIN_KEY_COUNT = 3;
const TERM_FORBIDDEN_CHARS = /[\t\r\n]/;

/**
 * A term the glossary TSV format cannot carry: tabs and newlines are the
 * column and row separators, so uploading one either splits the term or
 * fabricates a different entry pair.
 */
function isUnusableTerm(text: string): boolean {
  return text.trim() === '' || TERM_FORBIDDEN_CHARS.test(text);
}

/**
 * Normalize the way the glossary TSV round trip does — the API returns entries
 * parsed back out of TSV, which trims each field. Comparing raw local terms
 * against that could never be equal, so every sync re-uploaded the dictionary.
 */
function normalizeForComparison(entries: Record<string, string>): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [source, target] of Object.entries(entries)) {
    normalized.set(source.trim(), target.trim());
  }
  return normalized;
}

function entriesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const normalizedA = normalizeForComparison(a);
  const normalizedB = normalizeForComparison(b);
  if (normalizedA.size !== normalizedB.size) return false;
  for (const [key, value] of normalizedA) {
    if (normalizedB.get(key) !== value) return false;
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

        if (!isConsistent || consistentTranslation === undefined) continue;

        if (isUnusableTerm(sourceText) || isUnusableTerm(consistentTranslation)) {
          const sampleKey = keys.values().next().value;
          Logger.warn(
            `Skipping glossary term from key "${sampleKey}" (${locale}): source or translation is empty or contains a tab, carriage return or newline.`,
          );
          continue;
        }

        terms[sourceText] = consistentTranslation;
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
      const sourceLang = this.options.sourceLocale as Language;
      const targetLang = targetLocale as Language;
      const localePair = `${this.options.sourceLocale}-${targetLocale}`;

      // One rejected dictionary must not abandon the remaining locales.
      try {
        const existing = await this.options.glossaryService.getGlossaryByName(name);

        if (existing) {
          const currentEntries = await this.options.glossaryService.getGlossaryEntries(
            existing.glossary_id,
            sourceLang,
            targetLang,
          );

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
          glossaryIds[localePair] = created.glossary_id;
          Logger.info(`Created glossary "${name}" (${created.glossary_id})`);
        }
      } catch (error) {
        delete glossaryIds[localePair];
        Logger.warn(
          `Glossary sync failed for ${localePair} (glossary "${name}", ${Object.keys(localeTerms).length} terms): ${errorMessage(error)}`,
        );
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

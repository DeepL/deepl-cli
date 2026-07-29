import type { FormatParser, ExtractedEntry, TranslatedEntry } from './format.js';
import { detectIndent } from './util/detect-indent.js';

interface StringUnit {
  state: string;
  value: string;
}

/**
 * Per-locale entry. `variations` carries plural/device-width categories that
 * this parser does not surface as entries, so it must be preserved verbatim
 * rather than replaced.
 */
interface Localization {
  stringUnit?: StringUnit;
  variations?: Record<string, unknown>;
}

interface StringDefinition {
  comment?: string;
  extractionState?: string;
  localizations?: Record<string, Localization>;
}

interface XcstringsFile {
  sourceLanguage: string;
  version: string;
  strings: Record<string, StringDefinition>;
}

export class XcstringsFormatParser implements FormatParser {
  readonly name = 'Xcode String Catalog';
  readonly configKey = 'xcstrings';
  readonly extensions = ['.xcstrings'];
  readonly multiLocale = true;

  extract(content: string, locale?: string): ExtractedEntry[] {
    if (!locale) return [];
    const data = JSON.parse(content) as XcstringsFile;
    const entries: ExtractedEntry[] = [];

    for (const [key, def] of Object.entries(data.strings ?? {})) {
      const localization = def.localizations?.[locale];
      if (!localization?.stringUnit?.value) continue;

      entries.push({
        key,
        value: localization.stringUnit.value,
        ...(def.comment ? { context: def.comment, metadata: { comment: def.comment } } : {}),
      });
    }

    return entries;
  }

  reconstruct(content: string, entries: TranslatedEntry[], locale?: string): string {
    if (!locale) return content;
    const data = JSON.parse(content) as XcstringsFile;
    const hadTrailingNewline = content.endsWith('\n');

    for (const entry of entries) {
      const def = data.strings[entry.key] ??= {} as StringDefinition;
      def.localizations ??= {};
      const existing = def.localizations[locale];
      // Replacing the whole localization discarded plural `variations`, which
      // carry per-category translations this parser does not surface as
      // entries — so they could never be restored.
      if (existing?.variations) {
        def.localizations[locale] = {
          ...existing,
          stringUnit: { state: 'translated', value: entry.translation },
        };
      } else {
        def.localizations[locale] = {
          stringUnit: { state: 'translated', value: entry.translation },
        };
      }
    }

    const indent = detectIndent(content);
    let result = JSON.stringify(data, null, indent);
    if (hadTrailingNewline && !result.endsWith('\n')) {
      result += '\n';
    }
    return result;
  }

}

import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { detectIndent } from './util/detect-indent.js';

/** JSON.parse rejects a leading BOM, which editors on Windows add routinely. */
function stripBom(content: string): string {
  return content.replace(/^\uFEFF/, '');
}

export class ArbFormatParser implements FormatParser {
  readonly name = 'ARB (Flutter)';
  readonly configKey = 'arb';
  readonly extensions = ['.arb'];

  extract(content: string): ExtractedEntry[] {
    const data = JSON.parse(stripBom(content)) as Record<string, unknown>;
    const entries: ExtractedEntry[] = [];

    for (const key of Object.keys(data)) {
      if (key.startsWith('@')) {
        continue;
      }

      const value = data[key];
      if (typeof value !== 'string') {
        continue;
      }

      const entry: ExtractedEntry = { key, value };

      const metaKey = `@${key}`;
      const meta = data[metaKey];
      if (typeof meta === 'object' && meta !== null) {
        const metaRecord = meta as Record<string, unknown>;
        entry.metadata = { ...metaRecord };

        const description = metaRecord['description'];
        if (typeof description === 'string') {
          entry.context = description;
        }
      }

      entries.push(entry);
    }

    return entries;
  }

  reconstruct(content: string, entries: TranslatedEntry[]): string {
    const data = JSON.parse(stripBom(content)) as Record<string, unknown>;
    const indent = detectIndent(content);
    const trailingNewline = content.endsWith('\n');

    const translations = new Map<string, string>();
    for (const entry of entries) {
      translations.set(entry.key, entry.translation);
    }

    for (const key of Object.keys(data)) {
      if (key.startsWith('@')) {
        continue;
      }
      const translation = translations.get(key);
      if (translation !== undefined) {
        data[key] = translation;
      }
    }

    for (const key of Object.keys(data)) {
      if (!key.startsWith('@') && !translations.has(key)) {
        delete data[key];
        if (`@${key}` in data) {
          delete data[`@${key}`];
        }
      }
    }

    for (const [key, translation] of translations) {
      if (!(key in data)) {
        data[key] = translation;
      }
    }

    let result = JSON.stringify(data, null, indent);
    if (trailingNewline) {
      result += '\n';
    }
    return result;
  }

  extractContext(content: string, key: string): string | undefined {
    const data = JSON.parse(stripBom(content)) as Record<string, unknown>;
    const metaKey = `@${key}`;
    const meta = data[metaKey];
    if (typeof meta === 'object' && meta !== null) {
      const metaRecord = meta as Record<string, unknown>;
      const description = metaRecord['description'];
      if (typeof description === 'string') {
        return description;
      }
    }
    return undefined;
  }

}

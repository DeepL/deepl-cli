import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { ValidationError } from '../utils/errors.js';

interface PluralItem {
  quantity: string;
  value: string;
}

const STRING_RE =
  /<string\s+name="([^"]+)"((?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*="[^"]*")*)>([\s\S]*?)<\/string>/g;

const TRANSLATABLE_FALSE_RE = /\btranslatable\s*=\s*"false"/;

const PLURALS_RE =
  /<plurals\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/plurals>/g;

const PLURAL_ITEM_RE =
  /<item\s+quantity="([^"]+)"[^>]*>([\s\S]*?)<\/item>/g;

const STRING_ARRAY_RE =
  /<string-array\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/string-array>/g;

const ARRAY_ITEM_RE = /<item>([\s\S]*?)<\/item>/g;

const XML_ENTITY_RE = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;

/**
 * Decodes XML entities in a single pass, so a literal `&amp;lt;` decodes to
 * `&lt;` rather than collapsing all the way to `<`.
 */
function decodeXmlEntities(value: string): string {
  return value.replace(XML_ENTITY_RE, (match, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (dec !== undefined) {
      const code = Number.parseInt(dec, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    switch (named) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return match;
    }
  });
}

function unescapeAndroid(value: string): string {
  const withoutBackslashEscapes = value.replace(/\\(\\|'|"|n|t|r)/g, (_match, ch: string) => {
    switch (ch) {
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      default: return ch;
    }
  });
  return decodeXmlEntities(withoutBackslashEscapes);
}

function escapeAndroid(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    // & must precede < and >, or the entities produced below get re-escaped
    // into &amp;lt; — which compounds on every subsequent sync run.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Refuse a value that would close the CDATA section it is written into.
 * Nothing inside a CDATA body is entity-escaped, so the text after a "]]>"
 * would be parsed as XML — an injected element in a generated resource file.
 * Fail fast rather than rewrite the value into something the round-trip
 * cannot reproduce, matching the XLIFF parser's stance on CDATA.
 */
function assertNoCdataBreakout(value: string): void {
  if (value.includes(']]>')) {
    throw new ValidationError(
      'Android CDATA values containing "]]>" are not supported.',
      'Remove the "]]>" sequence from the text, or drop the <![CDATA[...]]> wrapper in the source file so the value is entity-escaped instead.',
    );
  }
}

export class AndroidXmlFormatParser implements FormatParser {
  readonly name = 'Android XML';
  readonly configKey = 'android_xml';
  readonly extensions = ['.xml'];

  extract(content: string): ExtractedEntry[] {
    const entries: ExtractedEntry[] = [];

    this.extractStrings(content, entries);
    this.extractPlurals(content, entries);
    this.extractStringArrays(content, entries);

    return entries;
  }

  reconstruct(originalContent: string, entries: TranslatedEntry[]): string {
    const translations = new Map<string, string>();
    const pluralTranslations = new Map<string, Map<string, string>>();
    const arrayTranslations = new Map<string, Map<number, string>>();

    for (const entry of entries) {
      if (entry.metadata?.['plurals']) {
        const plurals = entry.metadata['plurals'] as PluralItem[];
        const quantityMap = new Map<string, string>();
        for (const p of plurals) {
          quantityMap.set(p.quantity, p.value);
        }
        pluralTranslations.set(entry.key, quantityMap);
      } else if (entry.key.includes('.')) {
        const lastDot = entry.key.lastIndexOf('.');
        const arrayName = entry.key.substring(0, lastDot);
        const indexStr = entry.key.substring(lastDot + 1);
        const index = parseInt(indexStr, 10);

        if (!isNaN(index) && this.isStringArrayKey(originalContent, arrayName)) {
          if (!arrayTranslations.has(arrayName)) {
            arrayTranslations.set(arrayName, new Map());
          }
          arrayTranslations.get(arrayName)!.set(index, entry.translation);
        } else {
          translations.set(entry.key, entry.translation);
        }
      } else {
        translations.set(entry.key, entry.translation);
      }
    }

    let result = originalContent;

    result = result.replace(STRING_RE, (match, name: string, attrs: string, innerText: string) => {
      if (TRANSLATABLE_FALSE_RE.test(attrs)) {
        return match;
      }
      const translation = translations.get(name);
      if (translation !== undefined) {
        const escapedTranslation = this.escapeForReconstruct(innerText, translation);
        return `<string name="${name}"${attrs}>${escapedTranslation}</string>`;
      }
      return match;
    });

    result = result.replace(PLURALS_RE, (match, name: string, extraAttrs: string, innerContent: string) => {
      const quantityMap = pluralTranslations.get(name);
      if (!quantityMap) {
        return match;
      }
      const updatedInner = innerContent.replace(
        PLURAL_ITEM_RE,
        (itemMatch, quantity: string, value: string) => {
          const translation = quantityMap.get(quantity);
          if (translation !== undefined) {
            return `<item quantity="${quantity}">${this.escapeForReconstruct(value, translation)}</item>`;
          }
          return itemMatch;
        },
      );
      return `<plurals name="${name}"${extraAttrs}>${updatedInner}</plurals>`;
    });

    result = result.replace(STRING_ARRAY_RE, (match, name: string, extraAttrs: string, innerContent: string) => {
      const indexMap = arrayTranslations.get(name);
      if (!indexMap) {
        return match;
      }
      let idx = 0;
      const updatedInner = innerContent.replace(
        ARRAY_ITEM_RE,
        (itemMatch, value: string) => {
          const translation = indexMap.get(idx);
          idx++;
          if (translation !== undefined) {
            return `<item>${this.escapeForReconstruct(value, translation)}</item>`;
          }
          return itemMatch;
        },
      );
      return `<string-array name="${name}"${extraAttrs}>${updatedInner}</string-array>`;
    });

    const stringKeys = new Set([...translations.keys()]);
    const pluralKeys = new Set([...pluralTranslations.keys()]);
    const arrayKeys = new Set([...arrayTranslations.keys()]);

    result = result.replace(
      /[ \t]*<string\s+name="([^"]+)"[^>]*>[\s\S]*?<\/string>\s*\n?/g,
      (match, name: string) => stringKeys.has(name) || TRANSLATABLE_FALSE_RE.test(match) ? match : '',
    );
    result = result.replace(
      /[ \t]*<plurals\s+name="([^"]+)"[^>]*>[\s\S]*?<\/plurals>\s*\n?/g,
      (match, name: string) => pluralKeys.has(name) ? match : '',
    );
    result = result.replace(
      /[ \t]*<string-array\s+name="([^"]+)"[^>]*>[\s\S]*?<\/string-array>\s*\n?/g,
      (match, name: string) => arrayKeys.has(name) ? match : '',
    );

    return result;
  }

  private extractStrings(content: string, entries: ExtractedEntry[]): void {
    const regex = new RegExp(STRING_RE.source, STRING_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]!;
      const attrs = match[2] ?? '';
      const rawValue = match[3]!;

      if (TRANSLATABLE_FALSE_RE.test(attrs)) {
        continue;
      }

      const value = this.decodeValue(rawValue);
      entries.push({ key: name, value });
    }
  }

  private extractPlurals(content: string, entries: ExtractedEntry[]): void {
    const pluralsRegex = new RegExp(PLURALS_RE.source, PLURALS_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = pluralsRegex.exec(content)) !== null) {
      const name = match[1]!;
      const innerContent = match[3]!;

      const plurals: PluralItem[] = [];
      const itemRegex = new RegExp(PLURAL_ITEM_RE.source, PLURAL_ITEM_RE.flags);
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(innerContent)) !== null) {
        plurals.push({
          quantity: itemMatch[1]!,
          value: this.decodeValue(itemMatch[2]!),
        });
      }

      const defaultItem = plurals.find(p => p.quantity === 'other') ?? plurals[0];
      entries.push({
        key: name,
        value: defaultItem?.value ?? '',
        metadata: { plurals },
      });
    }
  }

  private extractStringArrays(content: string, entries: ExtractedEntry[]): void {
    const arrayRegex = new RegExp(STRING_ARRAY_RE.source, STRING_ARRAY_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = arrayRegex.exec(content)) !== null) {
      const name = match[1]!;
      const innerContent = match[3]!;

      const itemRegex = new RegExp(ARRAY_ITEM_RE.source, ARRAY_ITEM_RE.flags);
      let itemMatch: RegExpExecArray | null;
      let index = 0;
      while ((itemMatch = itemRegex.exec(innerContent)) !== null) {
        entries.push({
          key: `${name}.${index}`,
          value: this.decodeValue(itemMatch[1]!),
        });
        index++;
      }
    }
  }

  private decodeValue(raw: string): string {
    if (raw.startsWith('<![CDATA[')) {
      // Adjacent sections concatenate, so `<![CDATA[a]]><![CDATA[b]]>` is "ab".
      const sectionRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
      let joined = '';
      let consumedTo = 0;
      let match: RegExpExecArray | null;
      while ((match = sectionRe.exec(raw)) !== null) {
        if (match.index !== consumedTo) break;
        joined += match[1]!;
        consumedTo = match.index + match[0].length;
      }
      if (consumedTo === raw.length) return joined;
    }
    return unescapeAndroid(raw);
  }

  private escapeForReconstruct(originalInner: string, translation: string): string {
    if (originalInner.startsWith('<![CDATA[')) {
      assertNoCdataBreakout(translation);
      return `<![CDATA[${translation}]]>`;
    }
    return escapeAndroid(translation);
  }

  private isStringArrayKey(content: string, name: string): boolean {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<string-array\\s+name="${escaped}"`);
    return regex.test(content);
  }
}

import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { ValidationError } from '../utils/errors.js';
import {
  replaceElements,
  scanElements,
  type ElementPattern,
  type ScannedElement,
} from './xml-scan.js';

interface PluralItem {
  quantity: string;
  value: string;
}

const ATTRS = String.raw`((?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*=(?:"[^"<]*"|'[^'<]*'))*)`;

const STRING_EL: ElementPattern = {
  open: new RegExp(String.raw`<string\s+name="([^"<]+)"${ATTRS}>`, 'y'),
  close: /<\/string>/y,
};

const PLURALS_EL: ElementPattern = {
  open: new RegExp(String.raw`<plurals\s+name="([^"<]+)"${ATTRS}>`, 'y'),
  close: /<\/plurals>/y,
};

const PLURAL_ITEM_EL: ElementPattern = {
  open: new RegExp(String.raw`<item\s+quantity="([^"<]+)"${ATTRS}>`, 'y'),
  close: /<\/item>/y,
};

const STRING_ARRAY_EL: ElementPattern = {
  open: new RegExp(String.raw`<string-array\s+name="([^"<]+)"${ATTRS}>`, 'y'),
  close: /<\/string-array>/y,
};

const ARRAY_ITEM_EL: ElementPattern = {
  open: /<item>/y,
  close: /<\/item>/y,
};

const TRANSLATABLE_FALSE_RE = /\btranslatable\s*=\s*"false"/;

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
    let arrayNames: Set<string> | undefined;

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
        const index = parseInt(entry.key.substring(lastDot + 1), 10);
        arrayNames ??= new Set(
          scanElements(originalContent, STRING_ARRAY_EL).map((el) => el.groups[0]!),
        );

        if (!isNaN(index) && arrayNames.has(arrayName)) {
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

    let result = replaceElements(originalContent, STRING_EL, (el) => {
      const attrs = el.groups[1] ?? '';
      if (TRANSLATABLE_FALSE_RE.test(attrs)) {
        return el.text;
      }
      const translation = translations.get(el.groups[0]!);
      if (translation === undefined) {
        return null;
      }
      return this.rewriteInner(el, this.escapeForReconstruct(el.inner, translation));
    });

    result = replaceElements(result, PLURALS_EL, (el) => {
      const quantityMap = pluralTranslations.get(el.groups[0]!);
      if (!quantityMap) {
        return null;
      }
      const inner = replaceElements(el.inner, PLURAL_ITEM_EL, (item) => {
        const translation = quantityMap.get(item.groups[0]!);
        if (translation === undefined) {
          return item.text;
        }
        return this.rewriteInner(item, this.escapeForReconstruct(item.inner, translation));
      });
      return this.rewriteInner(el, inner);
    });

    result = replaceElements(result, STRING_ARRAY_EL, (el) => {
      const indexMap = arrayTranslations.get(el.groups[0]!);
      if (!indexMap) {
        return null;
      }
      let index = 0;
      const inner = replaceElements(el.inner, ARRAY_ITEM_EL, (item) => {
        const translation = indexMap.get(index);
        index++;
        if (translation === undefined) {
          return item.text;
        }
        return this.rewriteInner(item, this.escapeForReconstruct(item.inner, translation));
      });
      return this.rewriteInner(el, inner);
    });

    return result;
  }

  private rewriteInner(element: ScannedElement, inner: string): string {
    return `${element.openTag}${inner}${element.closeTag}`;
  }

  private extractStrings(content: string, entries: ExtractedEntry[]): void {
    for (const el of scanElements(content, STRING_EL)) {
      if (TRANSLATABLE_FALSE_RE.test(el.groups[1] ?? '')) {
        continue;
      }
      entries.push({ key: el.groups[0]!, value: this.decodeValue(el.inner) });
    }
  }

  private extractPlurals(content: string, entries: ExtractedEntry[]): void {
    for (const el of scanElements(content, PLURALS_EL)) {
      const plurals: PluralItem[] = scanElements(el.inner, PLURAL_ITEM_EL).map((item) => ({
        quantity: item.groups[0]!,
        value: this.decodeValue(item.inner),
      }));

      const defaultItem = plurals.find(p => p.quantity === 'other') ?? plurals[0];
      entries.push({
        key: el.groups[0]!,
        value: defaultItem?.value ?? '',
        metadata: { plurals },
      });
    }
  }

  private extractStringArrays(content: string, entries: ExtractedEntry[]): void {
    for (const el of scanElements(content, STRING_ARRAY_EL)) {
      const name = el.groups[0]!;
      let index = 0;
      for (const item of scanElements(el.inner, ARRAY_ITEM_EL)) {
        entries.push({ key: `${name}.${index}`, value: this.decodeValue(item.inner) });
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
}

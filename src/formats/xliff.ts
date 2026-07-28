import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { ValidationError } from '../utils/errors.js';

const VERSION_RE = /<(?:\w+:)?xliff[^>]*version=["'](\d+\.\d+)["']/i;

const TRANS_UNIT_RE =
  /<(?:\w+:)?trans-unit\s+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?trans-unit>/gi;

const UNIT_RE =
  /<(?:\w+:)?unit\s+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?unit>/gi;

const SOURCE_RE = /<(?:\w+:)?source>([\s\S]*?)<\/(?:\w+:)?source>/i;
// Attributes are optional but must be preserved: `state` is a standard XLIFF
// attribute that every CAT tool writes, and requiring a bare tag previously
// made these elements invisible (dropping units and duplicating targets).
const TARGET_RE = /<(\w+:)?target((?:\s[^>]*)?)>([\s\S]*?)<\/(?:\w+:)?target>/i;
const NOTE_RE = /<(?:\w+:)?note(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?note>/i;
const SEGMENT_RE = /<(?:\w+:)?segment(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?segment>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const XML_ENTITY_RE = /&(?:(amp|lt|gt|quot|apos)|#(x[0-9a-fA-F]+|[0-9]+));/g;

/**
 * Decode XML entities in a single pass. Handles the five named entities
 * plus decimal (`&#NN;`) and hex (`&#xNN;`) numeric character references.
 *
 * Single-pass is load-bearing: the previous chained `.replace()` impl
 * double-decoded `&amp;lt;` (first pass `&amp;` → `&`, second pass
 * `&lt;` → `<`), silently corrupting any payload that round-tripped
 * literal entities through translation.
 */
function unescapeXml(value: string): string {
  return value.replace(XML_ENTITY_RE, (match, named: string | undefined, numeric: string | undefined) => {
    if (named) return NAMED_ENTITIES[named] ?? match;
    if (numeric) {
      const code = numeric.startsWith('x') || numeric.startsWith('X')
        ? parseInt(numeric.slice(1), 16)
        : parseInt(numeric, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10FFFF
        ? String.fromCodePoint(code)
        : match;
    }
    return match;
  });
}

const CDATA_IN_TRANSLATABLE_RE =
  /<(?:\w+:)?(?:source|target)[^>]*>[\s\S]*?<!\[CDATA\[[\s\S]*?<\/(?:\w+:)?(?:source|target)>/i;

/**
 * Refuse XLIFF input that contains a CDATA section inside a `<source>` or
 * `<target>` element. The regex-based extract/reconstruct pair cannot
 * round-trip CDATA correctly — the `<` / `>` inside a CDATA body would
 * round-trip asymmetrically through `escapeXml` — so silent data
 * corruption is the alternative. Fail fast with an allowlist-style
 * message, matching the posture of the Laravel PHP parser's heredoc /
 * interpolation rejection.
 */
function assertNoCdataInTranslatable(content: string): void {
  if (!content.includes('<![CDATA[')) return;
  if (CDATA_IN_TRANSLATABLE_RE.test(content)) {
    throw new ValidationError(
      'XLIFF <source> / <target> elements containing CDATA sections are not supported.',
      'Inline the literal text without the <![CDATA[...]]> wrapper, or preprocess the file to entity-escape CDATA content before syncing.',
    );
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function detectVersion(content: string): string {
  const match = VERSION_RE.exec(content);
  return match?.[1] ?? '1.2';
}

export class XliffFormatParser implements FormatParser {
  readonly name = 'XLIFF';
  readonly configKey = 'xliff';
  readonly extensions = ['.xlf', '.xliff'];

  extract(content: string): ExtractedEntry[] {
    assertNoCdataInTranslatable(content);
    const version = detectVersion(content);
    const entries: ExtractedEntry[] = [];

    if (version === '2.0') {
      this.extractV2(content, entries);
    } else {
      this.extractV12(content, entries);
    }

    return entries;
  }

  reconstruct(content: string, entries: TranslatedEntry[]): string {
    assertNoCdataInTranslatable(content);
    const version = detectVersion(content);
    const translations = new Map<string, string>();
    for (const entry of entries) {
      translations.set(entry.key, entry.translation);
    }

    if (version === '2.0') {
      return this.reconstructV2(content, translations);
    }
    return this.reconstructV12(content, translations);
  }

  extractContext(content: string, key: string): string | undefined {
    const version = detectVersion(content);

    if (version === '2.0') {
      return this.extractContextV2(content, key);
    }
    return this.extractContextV12(content, key);
  }

  private extractV12(content: string, entries: ExtractedEntry[]): void {
    const regex = new RegExp(TRANS_UNIT_RE.source, TRANS_UNIT_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const id = match[1]!;
      const block = match[2]!;

      const sourceMatch = SOURCE_RE.exec(block);
      if (!sourceMatch) continue;

      const value = unescapeXml(sourceMatch[1]!);
      const noteMatch = NOTE_RE.exec(block);
      const context = noteMatch ? unescapeXml(noteMatch[1]!) : undefined;

      const entry: ExtractedEntry = { key: id, value };
      if (context !== undefined) {
        entry.context = context;
      }
      entries.push(entry);
    }
  }

  private extractV2(content: string, entries: ExtractedEntry[]): void {
    const regex = new RegExp(UNIT_RE.source, UNIT_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const id = match[1]!;
      const block = match[2]!;

      const segmentMatch = SEGMENT_RE.exec(block);
      if (!segmentMatch) continue;

      const segment = segmentMatch[1]!;
      const sourceMatch = SOURCE_RE.exec(segment);
      if (!sourceMatch) continue;

      const value = unescapeXml(sourceMatch[1]!);
      const noteMatch = NOTE_RE.exec(block);
      const context = noteMatch ? unescapeXml(noteMatch[1]!) : undefined;

      const entry: ExtractedEntry = { key: id, value };
      if (context !== undefined) {
        entry.context = context;
      }
      entries.push(entry);
    }
  }

  private reconstructV12(
    content: string,
    translations: Map<string, string>,
  ): string {
    const regex = new RegExp(TRANS_UNIT_RE.source, TRANS_UNIT_RE.flags);
    let result = content.replace(regex, (fullMatch, id: string, block: string) => {
      const translation = translations.get(id);
      if (translation === undefined) return '';

      const escaped = escapeXml(translation);
      const targetMatch = TARGET_RE.exec(block);

      let newBlock: string;
      if (targetMatch) {
        const ns = targetMatch[1] ?? '';
        const attrs = targetMatch[2] ?? '';
        newBlock = block.replace(TARGET_RE, () => `<${ns}target${attrs}>${escaped}</${ns}target>`);
      } else {
        const sourceNsMatch = /<(\w+:)?source>/i.exec(block);
        const ns = sourceNsMatch?.[1] ?? '';
        newBlock = block.replace(
          /(<\/(?:\w+:)?source>)/i,
          (_match, src: string) => `${src}\n        <${ns}target>${escaped}</${ns}target>`,
        );
      }

      return fullMatch.replace(block, () => newBlock);
    });
    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
  }

  private reconstructV2(
    content: string,
    translations: Map<string, string>,
  ): string {
    const regex = new RegExp(UNIT_RE.source, UNIT_RE.flags);
    let result = content.replace(regex, (fullMatch, id: string, block: string) => {
      const translation = translations.get(id);
      if (translation === undefined) return '';

      const escaped = escapeXml(translation);
      const segmentMatch = SEGMENT_RE.exec(block);
      if (!segmentMatch) return fullMatch;

      const segment = segmentMatch[1]!;
      const targetMatch = TARGET_RE.exec(segment);

      let newSegment: string;
      if (targetMatch) {
        const ns = targetMatch[1] ?? '';
        const attrs = targetMatch[2] ?? '';
        newSegment = segment.replace(TARGET_RE, () => `<${ns}target${attrs}>${escaped}</${ns}target>`);
      } else {
        const sourceNsMatch = /<(\w+:)?source>/i.exec(segment);
        const ns = sourceNsMatch?.[1] ?? '';
        newSegment = segment.replace(
          /(<\/(?:\w+:)?source>)/i,
          (_match, src: string) => `${src}\n        <${ns}target>${escaped}</${ns}target>`,
        );
      }

      const newBlock = block.replace(segment, () => newSegment);
      return fullMatch.replace(block, () => newBlock);
    });
    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
  }

  private extractContextV12(content: string, key: string): string | undefined {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<(?:\\w+:)?trans-unit\\s+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?trans-unit>`,
      'i',
    );
    const match = regex.exec(content);
    if (!match) return undefined;

    const block = match[1]!;
    const noteMatch = NOTE_RE.exec(block);
    return noteMatch ? unescapeXml(noteMatch[1]!) : undefined;
  }

  private extractContextV2(content: string, key: string): string | undefined {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<(?:\\w+:)?unit\\s+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?unit>`,
      'i',
    );
    const match = regex.exec(content);
    if (!match) return undefined;

    const block = match[1]!;
    const noteMatch = NOTE_RE.exec(block);
    return noteMatch ? unescapeXml(noteMatch[1]!) : undefined;
  }
}

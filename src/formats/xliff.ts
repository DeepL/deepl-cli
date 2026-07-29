import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { ValidationError } from '../utils/errors.js';
import {
  findElement,
  replaceElements,
  scanElements,
  type ElementPattern,
  type ScannedElement,
} from './xml-scan.js';

const VERSION_RE = /<(?:\w+:)?xliff[^>]*version=["'](\d+\.\d+)["']/i;

const TRANS_UNIT_EL: ElementPattern = {
  open: /<(?:\w+:)?trans-unit\s+id=["']([^"'<]+)["'][^><]*>/iy,
  close: /<\/(?:\w+:)?trans-unit>/iy,
};

const UNIT_EL: ElementPattern = {
  open: /<(?:\w+:)?unit\s+id=["']([^"'<]+)["'][^><]*>/iy,
  close: /<\/(?:\w+:)?unit>/iy,
};

const SOURCE_EL: ElementPattern = {
  open: /<(\w+:)?source>/iy,
  close: /<\/(?:\w+:)?source>/iy,
};

// Attributes are optional but must be preserved: `state` is a standard XLIFF
// attribute that every CAT tool writes, so requiring a bare tag would make
// those elements invisible to this scan.
const TARGET_EL: ElementPattern = {
  open: /<(\w+:)?target((?:\s[^><]*)?)>/iy,
  close: /<\/(?:\w+:)?target>/iy,
};

const NOTE_EL: ElementPattern = {
  open: /<(?:\w+:)?note(?:\s[^><]*)?>/iy,
  close: /<\/(?:\w+:)?note>/iy,
};

const SEGMENT_EL: ElementPattern = {
  open: /<(?:\w+:)?segment(?:\s[^><]*)?>/iy,
  close: /<\/(?:\w+:)?segment>/iy,
};

const TRANSLATABLE_EL: ElementPattern = {
  open: /<(?:\w+:)?(?:source|target)(?:\s[^><]*)?>/iy,
  close: /<\/(?:\w+:)?(?:source|target)>/iy,
};

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
 * The single pass is required for correctness: chained `.replace()` calls
 * double-decode `&amp;lt;` (`&amp;` → `&`, then `&lt;` → `<`), corrupting
 * payloads that carry literal entities.
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
  for (const element of scanElements(content, TRANSLATABLE_EL)) {
    if (element.inner.includes('<![CDATA[')) {
      throw new ValidationError(
        'XLIFF <source> / <target> elements containing CDATA sections are not supported.',
        'Inline the literal text without the <![CDATA[...]]> wrapper, or preprocess the file to entity-escape CDATA content before syncing.',
      );
    }
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

function rewriteInner(element: ScannedElement, inner: string): string {
  return `${element.openTag}${inner}${element.closeTag}`;
}

/**
 * Replace the first `<target>` in a block, or insert one after `<source>`
 * when the block has none.
 */
function applyTarget(block: string, escaped: string): string {
  const target = findElement(block, TARGET_EL);
  if (target) {
    const ns = target.groups[0] ?? '';
    const attrs = target.groups[1] ?? '';
    return (
      block.slice(0, target.start) +
      `<${ns}target${attrs}>${escaped}</${ns}target>` +
      block.slice(target.end)
    );
  }

  const source = findElement(block, SOURCE_EL);
  if (!source) return block;
  const ns = source.groups[0] ?? '';
  return (
    block.slice(0, source.end) +
    `\n        <${ns}target>${escaped}</${ns}target>` +
    block.slice(source.end)
  );
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
    const unit = detectVersion(content) === '2.0' ? UNIT_EL : TRANS_UNIT_EL;

    for (const element of scanElements(content, unit)) {
      if (element.groups[0] !== key) continue;
      const note = findElement(element.inner, NOTE_EL);
      return note ? unescapeXml(note.inner) : undefined;
    }
    return undefined;
  }

  private extractV12(content: string, entries: ExtractedEntry[]): void {
    for (const element of scanElements(content, TRANS_UNIT_EL)) {
      const source = findElement(element.inner, SOURCE_EL);
      if (!source) continue;
      entries.push(this.toEntry(element.groups[0]!, source.inner, element.inner));
    }
  }

  private extractV2(content: string, entries: ExtractedEntry[]): void {
    for (const element of scanElements(content, UNIT_EL)) {
      const segment = findElement(element.inner, SEGMENT_EL);
      if (!segment) continue;

      const source = findElement(segment.inner, SOURCE_EL);
      if (!source) continue;
      entries.push(this.toEntry(element.groups[0]!, source.inner, element.inner));
    }
  }

  private toEntry(id: string, rawSource: string, block: string): ExtractedEntry {
    const entry: ExtractedEntry = { key: id, value: unescapeXml(rawSource) };
    const note = findElement(block, NOTE_EL);
    if (note) {
      entry.context = unescapeXml(note.inner);
    }
    return entry;
  }

  private reconstructV12(content: string, translations: Map<string, string>): string {
    const result = replaceElements(content, TRANS_UNIT_EL, (element) => {
      const translation = translations.get(element.groups[0]!);
      if (translation === undefined) return '';
      return rewriteInner(element, applyTarget(element.inner, escapeXml(translation)));
    });
    return result.replace(/\n{3,}/g, '\n\n');
  }

  private reconstructV2(content: string, translations: Map<string, string>): string {
    const result = replaceElements(content, UNIT_EL, (element) => {
      const translation = translations.get(element.groups[0]!);
      if (translation === undefined) return '';

      const segment = findElement(element.inner, SEGMENT_EL);
      if (!segment) return element.text;

      const inner =
        element.inner.slice(0, segment.start) +
        rewriteInner(segment, applyTarget(segment.inner, escapeXml(translation))) +
        element.inner.slice(segment.end);
      return rewriteInner(element, inner);
    });
    return result.replace(/\n{3,}/g, '\n\n');
  }
}

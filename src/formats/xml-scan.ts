/**
 * Bounded element scanning for the XML-shaped format parsers.
 *
 * Matching an element as one regex (`<tag ...>([\s\S]*?)</tag>`) costs a scan
 * of the remaining input for every opening tag that never closes, which is
 * quadratic in file size. The scanners here walk the input once: opening tags
 * are matched sticky (anchored, so no scan), and the search for a closing tag
 * moves a single cursor forward. Once no closing tag remains, no later opening
 * tag can have one either, so scanning stops.
 *
 * Every quantifier in a pattern passed here must exclude `<`, so a match
 * attempt cannot run past the following tag. XML forbids `<` in attribute
 * values, so this only rejects input that is already malformed.
 */

const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';
const WHITESPACE_RE = /\s/;

export interface ElementPattern {
  /** Sticky pattern for an opening tag: `<` followed by an element name. */
  open: RegExp;
  /** Sticky pattern for a closing tag: `</` followed by an element name. */
  close: RegExp;
}

export interface ScannedElement {
  /** Index of the `<` that opens the element. */
  start: number;
  /** Index just past the closing tag. */
  end: number;
  openTag: string;
  closeTag: string;
  /** Text between the opening and closing tags. */
  inner: string;
  /** The element, opening and closing tags included. */
  text: string;
  /** Capture groups of the opening-tag pattern. */
  groups: (string | undefined)[];
}

function matchAt(content: string, index: number, sticky: RegExp): RegExpExecArray | null {
  sticky.lastIndex = index;
  return sticky.exec(content);
}

/** True for `</`, the only shape a closing tag can start with. */
function isCloseTagStart(content: string, lt: number): boolean {
  return content.charCodeAt(lt + 1) === 0x2f;
}

/**
 * Locate the next closing tag, skipping CDATA sections so that markup quoted
 * inside one cannot end the element. Undefined means the rest of the input
 * holds no closing tag at all.
 */
function findClose(
  content: string,
  from: number,
  close: RegExp,
): { index: number; length: number } | undefined {
  let pos = from;
  while (pos < content.length) {
    const lt = content.indexOf('<', pos);
    if (lt === -1) return undefined;
    if (content.startsWith(CDATA_OPEN, lt)) {
      const sectionEnd = content.indexOf(CDATA_CLOSE, lt + CDATA_OPEN.length);
      if (sectionEnd === -1) return undefined;
      pos = sectionEnd + CDATA_CLOSE.length;
      continue;
    }
    if (isCloseTagStart(content, lt)) {
      const match = matchAt(content, lt, close);
      if (match) return { index: lt, length: match[0].length };
    }
    pos = lt + 1;
  }
  return undefined;
}

function nextElement(
  content: string,
  cursor: number,
  pattern: ElementPattern,
): ScannedElement | undefined {
  let pos = cursor;

  while (pos < content.length) {
    const start = content.indexOf('<', pos);
    if (start === -1) return undefined;

    if (isCloseTagStart(content, start)) {
      pos = start + 1;
      continue;
    }

    const openMatch = matchAt(content, start, pattern.open);
    if (!openMatch) {
      pos = start + 1;
      continue;
    }

    const contentStart = start + openMatch[0].length;
    const close = findClose(content, contentStart, pattern.close);
    if (!close) return undefined;

    const end = close.index + close.length;
    return {
      start,
      end,
      openTag: openMatch[0],
      closeTag: content.slice(close.index, end),
      inner: content.slice(contentStart, close.index),
      text: content.slice(start, end),
      groups: openMatch.slice(1),
    };
  }

  return undefined;
}

/** Every non-overlapping element matching `pattern`, in document order. */
export function scanElements(content: string, pattern: ElementPattern): ScannedElement[] {
  const elements: ScannedElement[] = [];
  let cursor = 0;

  for (;;) {
    const element = nextElement(content, cursor, pattern);
    if (!element) return elements;
    elements.push(element);
    cursor = element.end;
  }
}

/** The first element matching `pattern`, or undefined. */
export function findElement(content: string, pattern: ElementPattern): ScannedElement | undefined {
  return nextElement(content, 0, pattern);
}

/**
 * Rewrite every element matching `pattern`. Returning null drops the element
 * along with its leading indentation and the whitespace that follows it.
 */
export function replaceElements(
  content: string,
  pattern: ElementPattern,
  replace: (element: ScannedElement) => string | null,
): string {
  const elements = scanElements(content, pattern);
  if (elements.length === 0) return content;

  const parts: string[] = [];
  let copied = 0;

  for (const element of elements) {
    const replacement = replace(element);
    if (replacement === null) {
      let from = element.start;
      while (from > copied && (content[from - 1] === ' ' || content[from - 1] === '\t')) from--;
      let to = element.end;
      while (to < content.length && WHITESPACE_RE.test(content[to]!)) to++;
      parts.push(content.slice(copied, from));
      copied = to;
    } else {
      parts.push(content.slice(copied, element.start), replacement);
      copied = element.end;
    }
  }

  parts.push(content.slice(copied));
  return parts.join('');
}

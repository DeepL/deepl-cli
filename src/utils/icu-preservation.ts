/**
 * ICU MessageFormat preservation for translation.
 *
 * Detects ICU plural/select/selectordinal patterns in i18n strings,
 * extracts only the translatable leaf text, and provides a reassemble
 * function to reconstruct the ICU structure after translation.
 *
 * Uses a brace-counting state machine — no external ICU dependencies.
 */

const ICU_KEYWORDS = new Set(['plural', 'select', 'selectordinal']);

// Deliberately NOT anchored: "You have {count, plural, ...} in your cart."
// is the most common real-world shape. Requiring the block at position 0
// would send the raw ICU syntax to the MT engine, which translates the
// keyword and the selectors.
const ICU_DETECT_RE = /\{\s*[\w]+\s*,\s*(?:plural|select|selectordinal)\s*,/;

export interface IcuSegment {
  text: string;
  isPluralBranch: boolean;
}

export interface IcuParseResult {
  isIcu: boolean;
  segments: IcuSegment[];
  reassemble: (translations: string[]) => string;
}

/**
 * Parse a string that may contain ICU MessageFormat syntax.
 * Returns segments for translation and a reassemble function.
 *
 * If the string is not ICU, returns { isIcu: false, segments: [], reassemble: identity }.
 * If parsing fails, returns the same (safe fallback — string passes through unchanged).
 */
export function parseIcu(text: string): IcuParseResult {
  const match = ICU_DETECT_RE.exec(text);
  if (!match) {
    return { isIcu: false, segments: [], reassemble: () => text };
  }

  try {
    const blockStart = match.index;
    const result = parseIcuBlock(text, blockStart);
    if (!result) {
      return { isIcu: false, segments: [], reassemble: () => text };
    }

    // Text on either side of the block is ordinary prose and must be
    // translated too — dropping it from the template silently deleted it.
    const prefix = text.slice(0, blockStart);
    // endIndex points AT the block's closing brace, which result.template
    // already includes, so the suffix starts one past it.
    const suffix = text.slice(result.endIndex + 1);
    const segments: IcuSegment[] = [];
    let template = '';

    if (prefix !== '') {
      template += `__ICU_LEAF_P__`;
      segments.push({ text: prefix, isPluralBranch: false });
    }
    template += result.template;
    segments.push(...result.segments);
    if (suffix !== '') {
      template += `__ICU_LEAF_S__`;
      segments.push({ text: suffix, isPluralBranch: false });
    }

    return {
      isIcu: true,
      segments,
      reassemble: (translations: string[]) => {
        if (translations.length !== segments.length) {
          // Filling missing values with '' produced empty plural branches,
          // which render nothing for that category.
          throw new Error(
            `ICU reassemble expected ${segments.length} translations, received ${translations.length}`,
          );
        }
        let idx = 0;
        return template.replace(/__ICU_LEAF_(?:\d+|P|S)__/g, () => translations[idx++] ?? '');
      },
    };
  } catch {
    return { isIcu: false, segments: [], reassemble: () => text };
  }
}

interface ParseBlockResult {
  template: string;
  segments: IcuSegment[];
  endIndex: number;
}

const OFFSET_RE = /^offset\s*:\s*\d+/;

function parseIcuBlock(text: string, start: number, inPluralContext = false): ParseBlockResult | null {
  let i = start;

  // Skip leading whitespace
  while (i < text.length && /\s/.test(text[i]!)) i++;

  // Expect opening brace
  if (text[i] !== '{') return null;
  i++;

  // Parse variable name
  const varStart = skipWhitespace(text, i);
  const varEnd = scanIdentifier(text, varStart);
  if (varEnd === varStart) return null;
  const varName = text.slice(varStart, varEnd);
  i = varEnd;

  // Expect comma
  i = skipWhitespace(text, i);
  if (text[i] !== ',') return null;
  i++;

  // Parse keyword
  i = skipWhitespace(text, i);
  const kwStart = i;
  const kwEnd = scanIdentifier(text, kwStart);
  if (kwEnd === kwStart) return null;
  const keyword = text.slice(kwStart, kwEnd);
  if (!ICU_KEYWORDS.has(keyword)) return null;
  i = kwEnd;

  // Expect comma
  i = skipWhitespace(text, i);
  if (text[i] !== ',') return null;
  i++;

  const isPluralType = keyword === 'plural' || keyword === 'selectordinal';
  const pluralContext = isPluralType || inPluralContext;
  const segments: IcuSegment[] = [];
  let template = `{${varName}, ${keyword},`;

  // Optional offset:N (plural/selectordinal only), preserved verbatim
  if (isPluralType) {
    const offsetStart = skipWhitespace(text, i);
    const offsetMatch = OFFSET_RE.exec(text.slice(offsetStart));
    if (offsetMatch) {
      template += ` ${offsetMatch[0]}`;
      i = offsetStart + offsetMatch[0].length;
    }
  }

  // Parse branches: selector {content}
  while (i < text.length) {
    i = skipWhitespace(text, i);

    // Check for closing brace (end of ICU block)
    if (text[i] === '}') {
      template += '}';
      return { template, segments, endIndex: i };
    }

    // Parse selector (e.g., 'one', 'other', '=0', 'male')
    const selStart = i;
    while (i < text.length && text[i] !== '{' && !/\s/.test(text[i]!)) i++;
    const selector = text.slice(selStart, i).trim();
    if (!selector) return null;

    // Expect opening brace for branch content
    i = skipWhitespace(text, i);
    if (text[i] !== '{') return null;

    // Extract branch content using brace counting
    const branchContent = extractBraceContent(text, i, pluralContext);
    if (branchContent === null) return null;

    const content = branchContent.content;
    i = branchContent.endIndex + 1;

    // Check if branch content itself contains nested ICU
    const nestedResult = tryParseNestedContent(content, pluralContext, segments);
    const leafIndex = segments.length;

    if (nestedResult) {
      template += ` ${selector} {${nestedResult.template}}`;
    } else {
      // Leaf text — this is what gets translated
      segments.push({ text: content, isPluralBranch: isPluralType });
      template += ` ${selector} {__ICU_LEAF_${leafIndex}__}`;
    }
  }

  return null; // Unterminated
}

function tryParseNestedContent(
  content: string,
  inPluralContext: boolean,
  segments: IcuSegment[],
): { template: string } | null {
  // Check if content contains a nested ICU block
  // e.g., "{gender, select, male {He has # items} female {She has # items}}"
  // Content might be mixed: "text before {var, plural, ...} text after"

  // For MVP: only handle content that IS a full ICU block (starts with {var, keyword, ...})
  const trimmed = content.trim();
  if (!ICU_DETECT_RE.test(trimmed)) return null;

  const nested = parseIcuBlock(trimmed, 0, inPluralContext);
  if (!nested || nested.endIndex < trimmed.length - 1) return null;

  // Merge nested segments into parent segments array
  const baseIndex = segments.length;
  for (const seg of nested.segments) {
    segments.push(seg);
  }

  // Reindex the nested template's leaf references
  let reindexed = nested.template;
  for (let j = nested.segments.length - 1; j >= 0; j--) {
    reindexed = reindexed.replace(`__ICU_LEAF_${j}__`, `__ICU_LEAF_${baseIndex + j}__`);
  }

  return { template: reindexed };
}

/**
 * Brace counting honours ICU single-quote escaping: an apostrophe immediately
 * followed by a syntax character ({, }, or # in plural context) opens a quoted
 * literal span ending at the next lone apostrophe; '' is a literal apostrophe.
 * Braces inside quoted spans do not affect nesting depth.
 */
function extractBraceContent(
  text: string,
  start: number,
  inPluralContext: boolean,
): { content: string; endIndex: number } | null {
  if (text[start] !== '{') return null;

  let depth = 0;
  let i = start;
  let inQuote = false;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "'") {
      if (text[i + 1] === "'") {
        i += 2;
        continue;
      }
      if (inQuote) {
        inQuote = false;
      } else {
        const next = text[i + 1];
        if (next === '{' || next === '}' || (inPluralContext && next === '#')) {
          inQuote = true;
        }
      }
      i++;
      continue;
    }

    if (!inQuote) {
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return {
            content: text.slice(start + 1, i),
            endIndex: i,
          };
        }
      }
    }

    i++;
  }

  return null; // Unmatched braces
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

function scanIdentifier(text: string, i: number): number {
  while (i < text.length && /[\w]/.test(text[i]!)) i++;
  return i;
}

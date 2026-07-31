import * as TOML from 'smol-toml';
import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { PendingCommentBuffer } from './pending-comment-buffer.js';

// `[section]` or `[a.b.c]` — captures the path. Matches only at the start of a
// trimmed line; trailing whitespace and a `# comment` tail are allowed.
const SECTION_RE = /^\[([^[\]]+)\]\s*(?:#.*)?$/;

// `[[arr]]` array-of-tables. We don't attempt to translate inside these; the
// line is passed through verbatim and the section context is not updated to
// its path (entries inside an AoT are not reached by the dotted-path extract
// anyway, so no surgery is needed).
const ARRAY_OF_TABLES_RE = /^\[\[([^[\]]+)\]\]\s*(?:#.*)?$/;

// `key = value[...]` — captures:
//   1 indent
//   2 key (bare or dotted bare; quoted keys deliberately excluded — they are
//     rare in i18n TOML and would require careful dot-path round-tripping)
//   3 `=` + surrounding whitespace
//   4 rest of line (value + optional trailing whitespace + optional `#`)
const ENTRY_LINE_RE =
  /^(\s*)([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(\s*=\s*)(.*)$/;

// String-literal prefix of an entry's RHS. Captures:
//   1 the quoted literal (including quotes)
//   2 the trailing bytes (whitespace + optional comment)
const STRING_VALUE_RE = /^("(?:[^"\\]|\\.)*"|'[^']*')(.*)$/;

// Triple-quoted opener — multi-line strings are out of scope for span-surgical
// reconstruct (would require multi-line lookahead). Lines starting one are
// passed through as-is.
const TRIPLE_QUOTE_PREFIX_RE = /^(""".*|'''.*)$/;

export class TomlFormatParser implements FormatParser {
  readonly name = 'TOML i18n';
  readonly configKey = 'toml';
  readonly extensions = ['.toml'];

  extract(content: string): ExtractedEntry[] {
    if (!content.trim()) return [];
    const data = TOML.parse(content);
    const entries: ExtractedEntry[] = [];
    this.walk(data, '', entries);
    return entries;
  }

  reconstruct(content: string, entries: TranslatedEntry[]): string {
    if (!content.trim()) return '';

    const translations = new Map<string, TranslatedEntry>();
    for (const entry of entries) {
      translations.set(entry.key, entry);
    }

    const trailingNewline = content.endsWith('\n');
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    const usedKeys = new Set<string>();
    let currentSection = '';
    const pending = new PendingCommentBuffer();

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      const trimmed = line.trim();

      const sectionMatch = trimmed.match(SECTION_RE);
      if (sectionMatch) {
        pending.flushToOutput(out);
        currentSection = sectionMatch[1]!.trim();
        out.push(line);
        continue;
      }

      const aotMatch = trimmed.match(ARRAY_OF_TABLES_RE);
      if (aotMatch) {
        pending.flushToOutput(out);
        // Don't adjust currentSection — AoT entries are not surfaced by extract
        // so no span-surgical surgery will target them anyway.
        out.push(line);
        continue;
      }

      if (trimmed === '' || trimmed.startsWith('#')) {
        pending.collect(line);
        continue;
      }

      const entryMatch = line.match(ENTRY_LINE_RE);
      if (entryMatch) {
        const indent = entryMatch[1]!;
        const keyPart = entryMatch[2]!;
        const equals = entryMatch[3]!;
        const valuePart = entryMatch[4]!;

        // Multi-line strings (non-goal): don't attempt rewrite. Emit the whole
        // block verbatim and skip past it, so body lines that happen to look
        // like `key = "..."` are not mistaken for entries and deleted.
        if (TRIPLE_QUOTE_PREFIX_RE.test(valuePart)) {
          pending.flushToOutput(out);
          const delimiter = valuePart.startsWith('"""') ? '"""' : "'''";
          out.push(line);
          // A single-line `k = """text"""` closes on the opening line itself.
          const closesOnOpeningLine =
            valuePart.length > delimiter.length * 2 - 1 &&
            valuePart.slice(delimiter.length).includes(delimiter);
          if (!closesOnOpeningLine) {
            while (lineIndex + 1 < lines.length) {
              lineIndex++;
              const bodyLine = lines[lineIndex]!;
              out.push(bodyLine);
              if (bodyLine.includes(delimiter)) break;
            }
          }
          const multilineKey = currentSection ? `${currentSection}.${keyPart}` : keyPart;
          usedKeys.add(multilineKey);
          continue;
        }

        const fullKey = currentSection ? `${currentSection}.${keyPart}` : keyPart;
        const stringMatch = valuePart.match(STRING_VALUE_RE);

        if (stringMatch) {
          const quotedValue = stringMatch[1]!;
          const trailing = stringMatch[2]!;
          const useDoubleQuote = quotedValue.startsWith('"');
          const translation = translations.get(fullKey);

          if (translation !== undefined) {
            pending.flushToOutput(out);
            const newValue = encodeTomlString(translation.translation, useDoubleQuote);
            out.push(`${indent}${keyPart}${equals}${newValue}${trailing}`);
            usedKeys.add(fullKey);
            continue;
          }

          // Source had a string at this key but translation map doesn't — delete
          // the entry line AND drop any pending comments that belonged with it.
          // Mirrors PropertiesFormatParser and PoFormatParser.
          pending.drop();
          continue;
        }

        // Non-string value (number, bool, date, array, inline table). Always
        // passthrough — extract never surfaces these, so there is no translation
        // key to consider.
        pending.flushToOutput(out);
        out.push(line);
        continue;
      }

      // Unrecognized line shape (e.g. quoted keys, array multi-line continuation).
      // Flush buffered comments and passthrough.
      pending.flushToOutput(out);
      out.push(line);
    }

    // Emit any trailing pending block (typically blank lines at EOF).
    pending.flushToOutput(out);

    // Insert new keys into their own section. Appending `section.key` at end
    // of file would nest it under whichever [section] header is still in
    // scope there, producing `section.section.key` and leaving the intended
    // key still missing.
    const newEntries = entries.filter((e) => !usedKeys.has(e.key));
    if (newEntries.length > 0) {
      this.insertNewEntries(out, newEntries);
    }

    let result = out.join('\n');
    if (trailingNewline && !result.endsWith('\n')) result += '\n';
    return result;
  }

  /**
   * Places each new entry inside the section its key belongs to, appending a
   * new `[section]` header only when that section is absent. Mutates `out`.
   */
  private insertNewEntries(out: string[], newEntries: TranslatedEntry[]): void {
    // Map section name -> index just past the end of its block in `out`.
    const sectionEnd = new Map<string, number>();
    let seen = '';
    sectionEnd.set('', 0);
    for (let i = 0; i < out.length; i++) {
      const sectionMatch = out[i]!.trim().match(SECTION_RE);
      if (sectionMatch) {
        seen = sectionMatch[1]!.trim();
      }
      sectionEnd.set(seen, i + 1);
    }

    // Group by section so each section is touched once.
    const bySection = new Map<string, { leaf: string; entry: TranslatedEntry }[]>();
    for (const entry of newEntries) {
      const lastDot = entry.key.lastIndexOf('.');
      const section = lastDot === -1 ? '' : entry.key.slice(0, lastDot);
      const leaf = lastDot === -1 ? entry.key : entry.key.slice(lastDot + 1);
      const group = bySection.get(section);
      if (group) group.push({ leaf, entry });
      else bySection.set(section, [{ leaf, entry }]);
    }

    // Insert from the highest index downward so earlier indices stay valid.
    const existing = [...bySection.entries()]
      .filter(([section]) => sectionEnd.has(section))
      .sort((a, b) => sectionEnd.get(b[0])! - sectionEnd.get(a[0])!);

    for (const [section, group] of existing) {
      const at = sectionEnd.get(section)!;
      out.splice(at, 0, ...group.map(({ leaf, entry }) =>
        `${leaf} = ${encodeTomlString(entry.translation, true)}`));
    }

    // Sections not present in the file get appended with a header.
    for (const [section, group] of bySection) {
      if (sectionEnd.has(section)) continue;
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(`[${section}]`);
      for (const { leaf, entry } of group) {
        out.push(`${leaf} = ${encodeTomlString(entry.translation, true)}`);
      }
    }
  }

  private walk(obj: Record<string, unknown>, prefix: string, entries: ExtractedEntry[]): void {
    for (const [prop, val] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${prop}` : prop;
      if (typeof val === 'string') {
        entries.push({ key, value: val });
      } else if (
        typeof val === 'object' &&
        val !== null &&
        !Array.isArray(val) &&
        !(val instanceof Date)
      ) {
        this.walk(val as Record<string, unknown>, key, entries);
      }
    }
  }
}

function encodeTomlString(value: string, useDoubleQuote: boolean): string {
  if (!useDoubleQuote) {
    // Literal strings (single-quoted) are raw — no escapes, cannot contain `'`
    // or a newline. U+2028/U+2029 also force the double-quoted fallback: left
    // raw they break ENTRY_LINE_RE on the next pass (JS `.` excludes line
    // separators), so the key is re-appended as a duplicate.
    if (value.includes("'") || /[\n\r\u2028\u2029]/.test(value)) {
      return encodeTomlString(value, true);
    }
    return `'${value}'`;
  }

  // Double-quoted: escape backslash first, then `"`, then common control chars.
  // Order matters so later escapes don't double-escape the backslashes we add.
  // U+2028/U+2029 must never be written raw (see the literal-string comment).
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `"${escaped}"`;
}

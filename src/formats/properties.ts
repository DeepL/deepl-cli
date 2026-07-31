import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { PendingCommentBuffer } from './pending-comment-buffer.js';

const ENTRY_RE = /^([^=:#!\s][^=:]*?)\s*[=:]\s*(.*)/;
const COMMENT_RE = /^\s*[#!]/;

export class PropertiesFormatParser implements FormatParser {
  readonly name = 'Java Properties';
  readonly configKey = 'properties';
  readonly extensions = ['.properties'];

  extract(content: string): ExtractedEntry[] {
    const entries: ExtractedEntry[] = [];
    const lines = content.split(/\r?\n/);
    let pendingComment: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!;
      const trimmed = line.trim();

      if (trimmed === '') {
        pendingComment = undefined;
        continue;
      }

      if (COMMENT_RE.test(trimmed)) {
        pendingComment = trimmed.replace(/^\s*[#!]\s?/, '');
        continue;
      }

      // Handle line continuations (trailing backslash)
      while (line.endsWith('\\') && i + 1 < lines.length) {
        i++;
        line = line.slice(0, -1) + lines[i]!.trimStart();
      }

      const match = ENTRY_RE.exec(line);
      if (match) {
        const key = this.unescapeKey(match[1]!.trim());
        const value = this.unescapeValue(match[2]!);
        const entry: ExtractedEntry = { key, value };
        if (pendingComment !== undefined) {
          entry.metadata = { comment: pendingComment };
        }
        entries.push(entry);
        pendingComment = undefined;
      }
    }

    return entries;
  }

  reconstruct(content: string, entries: TranslatedEntry[]): string {
    const translations = new Map<string, string>();
    for (const entry of entries) {
      translations.set(entry.key, entry.translation);
    }

    const lines = content.split(/\r?\n/);
    const result: string[] = [];
    const pending = new PendingCommentBuffer();

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!;
      const trimmed = line.trim();

      if (trimmed === '') {
        pending.collect(line);
        continue;
      }

      if (COMMENT_RE.test(trimmed)) {
        pending.collect(line);
        continue;
      }

      // Handle line continuations
      const startLine = i;
      while (line.endsWith('\\') && i + 1 < lines.length) {
        i++;
        line = line.slice(0, -1) + lines[i]!.trimStart();
      }

      const match = ENTRY_RE.exec(line);
      if (match) {
        const key = this.unescapeKey(match[1]!.trim());
        const translation = translations.get(key);
        if (translation !== undefined) {
          pending.flushToOutput(result);
          const escapedValue = this.escapeValue(translation);
          const originalLine = lines[startLine]!;
          const sepMatch = /^([^=:#!\s][^=:]*?\s*[=:]\s*)/.exec(originalLine);
          if (sepMatch) {
            result.push(sepMatch[1] + escapedValue);
          } else {
            result.push(`${this.escapeKey(key)}=${escapedValue}`);
          }
        } else {
          pending.drop();
        }
      } else {
        pending.flushToOutput(result);
        result.push(line);
      }
    }
    pending.flushToOutput(result);

    return result.join('\n');
  }

  private unescapeKey(s: string): string {
    return this.unescapeValue(s);
  }

  private unescapeValue(s: string): string {
    let result = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const next = s[i + 1]!;
        switch (next) {
          case 'n': result += '\n'; i += 2; break;
          case 't': result += '\t'; i += 2; break;
          case 'r': result += '\r'; i += 2; break;
          case '\\': result += '\\'; i += 2; break;
          case '=': result += '='; i += 2; break;
          case ':': result += ':'; i += 2; break;
          case ' ': result += ' '; i += 2; break;
          case 'u': {
            const hex = s.slice(i + 2, i + 6);
            if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
              result += String.fromCharCode(parseInt(hex, 16));
              i += 6;
            } else {
              result += next;
              i += 2;
            }
            break;
          }
          default:
            result += next;
            i += 2;
            break;
        }
      } else {
        result += s[i]!;
        i++;
      }
    }
    return result;
  }

  private escapeKey(s: string): string {
    return s.replace(/[=: \\]/g, (ch) => '\\' + ch);
  }

  private escapeValue(s: string): string {
    // Leading spaces must be escaped: the value parser strips unescaped
    // whitespace after the separator, so a raw leading space is lost on
    // the next read. (Leading tabs are covered by the \t escape below.)
    const leading = /^ +/.exec(s);
    let result = leading ? '\\ '.repeat(leading[0].length) : '';
    for (const ch of s.slice(leading ? leading[0].length : 0)) {
      switch (ch) {
        case '\n': result += '\\n'; break;
        case '\t': result += '\\t'; break;
        case '\r': result += '\\r'; break;
        case '\\': result += '\\\\'; break;
        default: {
          if (ch.codePointAt(0)! > 0x7e) {
            // Emit every UTF-16 code unit: an astral character such as an
            // emoji is a surrogate pair, and writing only charCodeAt(0)
            // leaves a lone high surrogate that cannot be decoded back.
            for (let i = 0; i < ch.length; i++) {
              result += '\\u' + ch.charCodeAt(i).toString(16).padStart(4, '0');
            }
          } else {
            result += ch;
          }
          break;
        }
      }
    }
    return result;
  }
}

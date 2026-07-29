import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';

const ENTRY_RE = /^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;\s*$/;

const BLOCK_COMMENT_RE = /^\/\*[\s\S]*?\*\/$/;
const LINE_COMMENT_RE = /^\/\//;

export class IosStringsFormatParser implements FormatParser {
  readonly name = 'iOS Strings';
  readonly configKey = 'ios_strings';
  readonly extensions = ['.strings'];

  extract(content: string): ExtractedEntry[] {
    const entries: ExtractedEntry[] = [];
    const lines = content.split(/\r?\n/);
    let pendingComment: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (trimmed === '') {
        continue;
      }

      if (BLOCK_COMMENT_RE.test(trimmed)) {
        pendingComment = trimmed.slice(2, -2).trim();
        continue;
      }

      if (LINE_COMMENT_RE.test(trimmed)) {
        pendingComment = trimmed.slice(2).trim();
        continue;
      }

      // Handle multi-line block comments
      if (trimmed.startsWith('/*') && !trimmed.endsWith('*/')) {
        let commentBody = trimmed;
        while (i + 1 < lines.length) {
          i++;
          const nextLine = lines[i]!;
          commentBody += '\n' + nextLine;
          if (nextLine.trim().endsWith('*/')) {
            break;
          }
        }
        const inner = commentBody.replace(/^\/\*/, '').replace(/\*\/$/, '').trim();
        pendingComment = inner;
        continue;
      }

      const match = ENTRY_RE.exec(line);
      if (match) {
        const key = this.unescape(match[1]!);
        const value = this.unescape(match[2]!);
        const entry: ExtractedEntry = { key, value };
        if (pendingComment !== undefined) {
          entry.metadata = { comment: pendingComment };
        }
        entries.push(entry);
        pendingComment = undefined;
      } else {
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
    let pendingComments: string[] = [];
    let inBlockComment = false;

    for (const line of lines) {
      if (inBlockComment) {
        pendingComments.push(line);
        if (line.includes('*/')) {
          inBlockComment = false;
        }
        continue;
      }

      const match = ENTRY_RE.exec(line);
      if (match) {
        const key = this.unescape(match[1]!);
        const translation = translations.get(key);
        if (translation !== undefined) {
          result.push(...pendingComments);
          pendingComments = [];
          const escapedValue = this.escape(translation);
          const newLine = line.replace(
            /=\s*"(?:[^"\\]|\\.)*"\s*;/,
            () => `= "${escapedValue}";`,
          );
          result.push(newLine);
        } else {
          pendingComments = [];
        }
      } else {
        const trimmed = line.trim();
        if (trimmed.startsWith('/*') && trimmed.includes('*/')) {
          pendingComments.push(line);
        } else if (trimmed.startsWith('/*')) {
          inBlockComment = true;
          pendingComments.push(line);
        } else if (trimmed.startsWith('//') || trimmed === '') {
          pendingComments.push(line);
        } else {
          result.push(...pendingComments);
          pendingComments = [];
          result.push(line);
        }
      }
    }
    result.push(...pendingComments);

    return result.join('\n');
  }

  private unescape(s: string): string {
    let result = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const next = s[i + 1]!;
        switch (next) {
          case '"': result += '"'; i += 2; break;
          case '\\': result += '\\'; i += 2; break;
          case 'n': result += '\n'; i += 2; break;
          case 't': result += '\t'; i += 2; break;
          case 'r': result += '\r'; i += 2; break;
          case '0': result += '\0'; i += 2; break;
          case 'U':
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

  private escape(s: string): string {
    let result = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      switch (ch) {
        case '"': result += '\\"'; break;
        case '\\': result += '\\\\'; break;
        case '\n': result += '\\n'; break;
        case '\t': result += '\\t'; break;
        case '\r': result += '\\r'; break;
        case '\0': result += '\\0'; break;
        default: result += ch; break;
      }
    }
    return result;
  }
}

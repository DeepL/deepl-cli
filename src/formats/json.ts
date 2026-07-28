import type { ExtractedEntry, FormatParser, TranslatedEntry } from './format.js';
import { detectIndent } from './util/detect-indent.js';
import { Logger } from '../utils/logger.js';

interface FlatKeyInfo {
  keys: Set<string>;
  scopes: Map<string, number>;
}

export class JsonFormatParser implements FormatParser {
  readonly name = 'JSON i18n';
  readonly configKey = 'json';
  readonly extensions = ['.json'];

  extract(content: string): ExtractedEntry[] {
    const clean = content.replace(/^\uFEFF/, '');
    if (!clean.trim()) return [];

    const duplicates = this.findDuplicateJsonKeys(clean);
    if (duplicates.length > 0) {
      Logger.warn(
        `JSON file contains duplicate keys: ${duplicates.join(', ')}. ` +
        `Only the last value for each key will be used.`,
      );
    }

    const data: unknown = JSON.parse(clean);
    const entries: ExtractedEntry[] = [];
    this.walk(data, '', entries);
    return entries;
  }

  reconstruct(content: string, entries: TranslatedEntry[]): string {
    const clean = content.replace(/^\uFEFF/, '');
    const data: unknown = JSON.parse(clean);
    const indent = detectIndent(clean);
    const trailingNewline = content.endsWith('\n');
    const flatKeyInfo = this.detectFlatKeys(data);

    const translations = new Map<string, string>();
    for (const entry of entries) {
      translations.set(entry.key, entry.translation);
    }

    const clone = structuredClone(data);
    this.applyTranslations(clone, '', translations, flatKeyInfo);
    this.insertNewKeys(clone, translations, flatKeyInfo);
    this.removeDeletedKeys(clone, '', translations, flatKeyInfo);

    let result = JSON.stringify(clone, null, indent);
    if (trailingNewline) {
      result += '\n';
    }
    return result;
  }

  private detectFlatKeys(data: unknown): FlatKeyInfo {
    const keys = new Set<string>();
    const scopes = new Map<string, number>();
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { keys, scopes };
    }
    this.collectFlatKeys(data as Record<string, unknown>, '', keys, scopes);
    return { keys, scopes };
  }

  private collectFlatKeys(
    obj: Record<string, unknown>,
    prefix: string,
    keys: Set<string>,
    scopes: Map<string, number>,
  ): void {
    for (const prop of Object.keys(obj)) {
      const dotPath = prefix ? `${prefix}.${prop}` : prop;
      if (prop.includes('.')) {
        keys.add(dotPath);
        const dotCount = (prop.match(/\./g) ?? []).length;
        scopes.set(prefix, dotCount);
      }
      const val = obj[prop];
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        this.collectFlatKeys(val as Record<string, unknown>, dotPath, keys, scopes);
      }
    }
  }

  private splitKeyParts(dotPath: string, info: FlatKeyInfo): string[] {
    if (info.keys.size === 0) return dotPath.split('.');
    if (info.keys.has(dotPath)) return [dotPath];

    for (const flatKey of info.keys) {
      if (dotPath.startsWith(flatKey + '.')) {
        return [flatKey, ...dotPath.slice(flatKey.length + 1).split('.')];
      }
      if (dotPath.endsWith('.' + flatKey)) {
        return [...dotPath.slice(0, dotPath.length - flatKey.length - 1).split('.'), flatKey];
      }
    }

    return dotPath.split('.');
  }

  private splitKeyPartsForInsert(dotPath: string, info: FlatKeyInfo): string[] {
    const standard = this.splitKeyParts(dotPath, info);
    if (standard.length === 1 || info.scopes.size === 0) return standard;

    if (!dotPath.includes('.')) return standard;

    for (const [scopePrefix, dotCount] of info.scopes) {
      if (scopePrefix === '') {
        const parts = dotPath.split('.');
        if (parts.length === dotCount + 1) {
          return [dotPath];
        }
      } else if (dotPath.startsWith(scopePrefix + '.')) {
        const remainder = dotPath.slice(scopePrefix.length + 1);
        const remainderDots = (remainder.match(/\./g) ?? []).length;
        if (remainderDots === dotCount) {
          return [...scopePrefix.split('.'), remainder];
        }
      }
    }
    return standard;
  }

  private walk(obj: unknown, prefix: string, entries: ExtractedEntry[]): void {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const item: unknown = obj[i];
        const key = prefix ? `${prefix}.${i}` : String(i);
        if (typeof item === 'string') {
          entries.push({ key, value: item });
        } else if (typeof item === 'object' && item !== null) {
          this.walk(item, key, entries);
        }
      }
      return;
    }

    if (typeof obj === 'object' && obj !== null) {
      const record = obj as Record<string, unknown>;
      for (const prop of Object.keys(record)) {
        const val: unknown = record[prop];
        const key = prefix ? `${prefix}.${prop}` : prop;
        if (typeof val === 'string') {
          entries.push({ key, value: val });
        } else if (typeof val === 'object' && val !== null) {
          this.walk(val, key, entries);
        }
      }
    }
  }

  private applyTranslations(
    obj: unknown,
    prefix: string,
    translations: Map<string, string>,
    flatKeyInfo: FlatKeyInfo,
  ): void {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const key = prefix ? `${prefix}.${i}` : String(i);
        const item: unknown = obj[i];
        if (typeof item === 'string') {
          const translation = translations.get(key);
          if (translation !== undefined) {
            obj[i] = translation;
          }
        } else if (typeof item === 'object' && item !== null) {
          this.applyTranslations(item, key, translations, flatKeyInfo);
        }
      }
      return;
    }

    if (typeof obj === 'object' && obj !== null) {
      const record = obj as Record<string, unknown>;
      for (const prop of Object.keys(record)) {
        const key = prefix ? `${prefix}.${prop}` : prop;
        const val: unknown = record[prop];
        if (typeof val === 'string') {
          const translation = translations.get(key);
          if (translation !== undefined) {
            record[prop] = translation;
          }
        } else if (typeof val === 'object' && val !== null) {
          this.applyTranslations(val, key, translations, flatKeyInfo);
        }
      }
    }
  }

  private insertNewKeys(obj: unknown, translations: Map<string, string>, flatKeyInfo: FlatKeyInfo): void {
    if (typeof obj !== 'object' || obj === null) return;
    for (const [key, value] of translations) {
      if (!this.hasKey(obj, key, flatKeyInfo)) {
        const parts = this.splitKeyPartsForInsert(key, flatKeyInfo);
        this.setKeyWithParts(obj as Record<string, unknown>, parts, value);
      }
    }
  }

  private hasKey(obj: unknown, dotPath: string, flatKeyInfo: FlatKeyInfo): boolean {
    const parts = this.splitKeyParts(dotPath, flatKeyInfo);
    let current: unknown = obj;
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return false;
      const record = current as Record<string, unknown>;
      // Own-property check only: `part in record` reports inherited members, so
      // an i18n key named "toString" or "__proto__" would be seen as present.
      if (!Object.hasOwn(record, part)) return false;
      current = record[part];
    }
    return true;
  }

  /**
   * Assigns an own, enumerable property. Plain assignment cannot be used:
   * `obj['__proto__'] = v` invokes the prototype setter instead of creating a
   * property, which both loses the translation and mutates Object.prototype.
   */
  private setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(obj, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  private setKeyWithParts(obj: Record<string, unknown>, parts: string[], value: string): void {
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const existing = Object.hasOwn(current, part) ? current[part] : undefined;
      if (typeof existing !== 'object' || existing === null) {
        this.setOwn(current, part, {});
      }
      current = current[part] as Record<string, unknown>;
    }
    const lastPart = parts[parts.length - 1];
    if (lastPart !== undefined) {
      this.setOwn(current, lastPart, value);
    }
  }

  private removeDeletedKeys(
    obj: unknown,
    prefix: string,
    translations: Map<string, string>,
    flatKeyInfo: FlatKeyInfo,
  ): void {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
    const record = obj as Record<string, unknown>;
    for (const prop of Object.keys(record)) {
      const key = prefix ? `${prefix}.${prop}` : prop;
      const val = record[prop];
      if (typeof val === 'string') {
        if (!translations.has(key)) {
          delete record[prop];
        }
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        this.removeDeletedKeys(val, key, translations, flatKeyInfo);
        if (Object.keys(val).length === 0) {
          delete record[prop];
        }
      }
    }
  }

  private findDuplicateJsonKeys(content: string): string[] {
    const duplicates: string[] = [];
    const stack: Set<string>[] = [];
    let i = 0;

    const skipString = (): string => {
      let result = '';
      i++;
      while (i < content.length) {
        if (content[i] === '\\') {
          result += content[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (content[i] === '"') {
          i++;
          return result;
        }
        result += content[i];
        i++;
      }
      return result;
    };

    while (i < content.length) {
      const ch = content[i]!;
      if (ch === '{') {
        stack.push(new Set());
        i++;
      } else if (ch === '}') {
        stack.pop();
        i++;
      } else if (ch === '"') {
        const str = skipString();
        while (i < content.length && /\s/.test(content[i]!)) i++;
        if (i < content.length && content[i] === ':') {
          i++;
          const level = stack[stack.length - 1];
          if (level) {
            if (level.has(str)) {
              duplicates.push(str);
            } else {
              level.add(str);
            }
          }
        }
      } else {
        i++;
      }
    }

    return duplicates;
  }
}

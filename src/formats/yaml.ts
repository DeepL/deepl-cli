import * as YAML from 'yaml';
import type { FormatParser, ExtractedEntry, TranslatedEntry } from './format.js';

export class YamlFormatParser implements FormatParser {
  readonly name = 'YAML';
  readonly configKey = 'yaml';
  readonly extensions = ['.yaml', '.yml'];

  extract(content: string): ExtractedEntry[] {
    if (!content.trim()) {
      return [];
    }

    const doc = YAML.parseDocument(content);

    if (doc.errors.length > 0) {
      const messages = doc.errors.map(e => e.message).join('; ');
      throw new Error(`YAML parse error: ${messages}`);
    }

    if (!doc.contents) {
      return [];
    }

    const entries: ExtractedEntry[] = [];
    this.walkNode(doc.contents, [], entries, doc);
    return entries;
  }

  reconstruct(content: string, entries: TranslatedEntry[]): string {
    if (!content.trim()) return '';

    const doc = YAML.parseDocument(content);

    const translationMap = new Map<string, string>();
    for (const entry of entries) {
      translationMap.set(entry.key, entry.translation);
    }

    for (const [key, translation] of translationMap) {
      const pathArray = key.split('\0');
      doc.setIn(pathArray, translation);
    }

    const existingPaths: string[][] = [];
    const walkAlias = (alias: YAML.Alias, path: string[]): void => {
      const resolved = alias.resolve(doc);
      if (YAML.isScalar(resolved) && typeof resolved.value === 'string') {
        existingPaths.push(path);
      }
    };
    const walkDoc = (node: unknown, path: string[]): void => {
      if (YAML.isMap(node)) {
        for (const item of node.items) {
          const key = String(YAML.isScalar(item.key) ? item.key.value : item.key);
          if (YAML.isScalar(item.value) && typeof item.value.value === 'string') {
            existingPaths.push([...path, key]);
          } else if (YAML.isMap(item.value) || YAML.isSeq(item.value)) {
            walkDoc(item.value, [...path, key]);
          } else if (YAML.isAlias(item.value)) {
            walkAlias(item.value, [...path, key]);
          }
        }
      } else if (YAML.isSeq(node)) {
        for (let i = 0; i < node.items.length; i++) {
          const item = node.items[i];
          if (YAML.isScalar(item) && typeof item.value === 'string') {
            existingPaths.push([...path, String(i)]);
          } else if (YAML.isMap(item) || YAML.isSeq(item)) {
            walkDoc(item, [...path, String(i)]);
          } else if (YAML.isAlias(item)) {
            walkAlias(item, [...path, String(i)]);
          }
        }
      }
    };
    walkDoc(doc.contents, []);

    for (const pathArray of existingPaths) {
      const key = pathArray.join('\0');
      if (!translationMap.has(key)) {
        doc.deleteIn(pathArray);
      }
    }

    let result = doc.toString();

    const originalEndsWithNewline = content.endsWith('\n');
    const resultEndsWithNewline = result.endsWith('\n');

    if (originalEndsWithNewline && !resultEndsWithNewline) {
      result += '\n';
    } else if (!originalEndsWithNewline && resultEndsWithNewline) {
      result = result.replace(/\n$/, '');
    }

    return result;
  }

  private walkNode(
    node: unknown,
    pathParts: string[],
    entries: ExtractedEntry[],
    doc: YAML.Document,
  ): void {
    if (YAML.isMap(node)) {
      for (const item of node.items) {
        const key = String(YAML.isScalar(item.key) ? item.key.value : item.key);
        this.walkNode(item.value, [...pathParts, key], entries, doc);
      }
    } else if (YAML.isSeq(node)) {
      for (let i = 0; i < node.items.length; i++) {
        this.walkNode(node.items[i], [...pathParts, String(i)], entries, doc);
      }
    } else if (YAML.isScalar(node) && typeof node.value === 'string') {
      entries.push({ key: pathParts.join('\0'), value: node.value });
    } else if (YAML.isAlias(node)) {
      const resolved = node.resolve(doc);
      if (YAML.isScalar(resolved) && typeof resolved.value === 'string') {
        entries.push({ key: pathParts.join('\0'), value: resolved.value });
      }
      // Aliases to collections stay references; their content is handled at
      // the anchor site, so nothing is ever expanded through an alias.
    }
  }
}

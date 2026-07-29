import * as YAML from 'yaml';
import type { FormatParser, ExtractedEntry, TranslatedEntry } from './format.js';

type StringSlot =
  | { path: string[]; value: string; parent: YAML.YAMLMap; pair: YAML.Pair }
  | { path: string[]; value: string; parent: YAML.YAMLSeq; index: number };

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

    if (YAML.isScalar(doc.contents) && typeof doc.contents.value === 'string') {
      return [{ key: '', value: doc.contents.value }];
    }

    return this.collectStringSlots(doc).map(slot => ({
      key: slot.path.join('\0'),
      value: slot.value,
    }));
  }

  reconstruct(content: string, entries: TranslatedEntry[]): string {
    if (!content.trim()) return '';

    // uniqueKeys costs O(n²) at parse time and extract() already rejects duplicates.
    const doc = YAML.parseDocument(content, { uniqueKeys: false });

    const translationMap = new Map<string, string>();
    for (const entry of entries) {
      translationMap.set(entry.key, entry.translation);
    }

    const applied = new Set<string>();
    const mapRemovals = new Map<YAML.YAMLMap, Set<YAML.Pair>>();
    const seqRemovals = new Map<YAML.YAMLSeq, Set<number>>();

    for (const slot of this.collectStringSlots(doc)) {
      const key = slot.path.join('\0');
      const translation = translationMap.get(key);

      if (translation === undefined) {
        if ('pair' in slot) {
          let pairs = mapRemovals.get(slot.parent);
          if (!pairs) mapRemovals.set(slot.parent, (pairs = new Set()));
          pairs.add(slot.pair);
        } else {
          let indices = seqRemovals.get(slot.parent);
          if (!indices) seqRemovals.set(slot.parent, (indices = new Set()));
          indices.add(slot.index);
        }
        continue;
      }

      applied.add(key);
      if ('pair' in slot) {
        if (YAML.isScalar(slot.pair.value)) {
          slot.pair.value.value = translation;
        } else {
          slot.pair.value = doc.createNode(translation);
        }
      } else {
        const item = slot.parent.items[slot.index];
        if (YAML.isScalar(item)) {
          item.value = translation;
        } else {
          slot.parent.items[slot.index] = doc.createNode(translation);
        }
      }
    }

    for (const [map, pairs] of mapRemovals) {
      map.items = map.items.filter(pair => !pairs.has(pair));
    }
    for (const [seq, indices] of seqRemovals) {
      seq.items = seq.items.filter((_, i) => !indices.has(i));
    }

    for (const [key, translation] of translationMap) {
      if (!applied.has(key)) {
        doc.setIn(key.split('\0'), translation);
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

  /**
   * Collects every string-valued position in one document walk, recording the
   * parent collection so reconstruct() can mutate nodes directly instead of
   * re-resolving each path via setIn/deleteIn (which scan collection items
   * linearly per call). Anchors are indexed in the same walk so aliases
   * resolve by lookup rather than a per-alias document scan. Aliases to
   * collections are skipped: they stay references, and their content is
   * handled at the anchor site.
   */
  private collectStringSlots(doc: YAML.Document): StringSlot[] {
    const slots: StringSlot[] = [];
    const anchors = new Map<string, YAML.Node>();

    const recordAnchor = (node: unknown): void => {
      if (YAML.isNode(node) && node.anchor) {
        anchors.set(node.anchor, node);
      }
    };

    const resolveAliasString = (alias: YAML.Alias): string | undefined => {
      const resolved = anchors.get(alias.source) ?? alias.resolve(doc);
      return YAML.isScalar(resolved) && typeof resolved.value === 'string'
        ? resolved.value
        : undefined;
    };

    const visit = (node: unknown, path: string[]): void => {
      if (YAML.isMap(node)) {
        for (const pair of node.items) {
          const key = String(YAML.isScalar(pair.key) ? pair.key.value : pair.key);
          const childPath = [...path, key];
          const value = pair.value;
          recordAnchor(value);
          if (YAML.isScalar(value) && typeof value.value === 'string') {
            slots.push({ path: childPath, value: value.value, parent: node, pair });
          } else if (YAML.isMap(value) || YAML.isSeq(value)) {
            visit(value, childPath);
          } else if (YAML.isAlias(value)) {
            const resolved = resolveAliasString(value);
            if (resolved !== undefined) {
              slots.push({ path: childPath, value: resolved, parent: node, pair });
            }
          }
        }
      } else if (YAML.isSeq(node)) {
        for (let i = 0; i < node.items.length; i++) {
          const item = node.items[i];
          const childPath = [...path, String(i)];
          recordAnchor(item);
          if (YAML.isScalar(item) && typeof item.value === 'string') {
            slots.push({ path: childPath, value: item.value, parent: node, index: i });
          } else if (YAML.isMap(item) || YAML.isSeq(item)) {
            visit(item, childPath);
          } else if (YAML.isAlias(item)) {
            const resolved = resolveAliasString(item);
            if (resolved !== undefined) {
              slots.push({ path: childPath, value: resolved, parent: node, index: i });
            }
          }
        }
      }
    };

    recordAnchor(doc.contents);
    visit(doc.contents, []);
    return slots;
  }
}

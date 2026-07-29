import { createDefaultRegistry } from '../../../src/formats/index';
import { YamlFormatParser } from '../../../src/formats/yaml';
import type { TranslatedEntry } from '../../../src/formats/format';

const parser = new YamlFormatParser();

describe('yaml parser', () => {
  it('should be registered in the default registry', async () => {
    const registry = await createDefaultRegistry();
    const extensions = registry.getSupportedExtensions();
    expect(extensions.length).toBeGreaterThan(0);
  });

  describe('reconstruct with empty content', () => {
    it('should return empty string without throwing', () => {
      const result = parser.reconstruct('', []);
      expect(result).toBe('');
    });

    it('should return empty string for whitespace-only content', () => {
      const result = parser.reconstruct('   \n  ', []);
      expect(result).toBe('');
    });
  });

  describe('null-byte key separator', () => {
    it('should extract a key with a literal dot as a flat key', () => {
      const yaml = '"my.key": value\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe('my.key');
      expect(entries[0]!.value).toBe('value');
    });

    it('should round-trip a key with a literal dot without nesting', () => {
      const yaml = '"my.key": value\n';
      const entries = parser.extract(yaml);
      const translated: TranslatedEntry[] = [
        { key: entries[0]!.key, value: 'value', translation: 'translated' },
      ];
      const result = parser.reconstruct(yaml, translated);
      expect(result).toContain('"my.key"');
      expect(result).toContain('translated');
      expect(result).not.toMatch(/^my:\n/m);
    });

    it('should extract nested keys with null-byte separator', () => {
      const yaml = 'nav:\n  home: value\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe('nav\0home');
      expect(entries[0]!.value).toBe('value');
    });

    it('should reconstruct nested keys from null-byte separated paths', () => {
      const yaml = 'nav:\n  home: value\n';
      const entries: TranslatedEntry[] = [
        { key: 'nav\0home', value: 'value', translation: 'Inicio' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('nav');
      expect(result).toContain('home');
      expect(result).toContain('Inicio');
    });
  });

  describe('array values', () => {
    it('should extract string array items with index-based keys', () => {
      const yaml = 'items:\n  - hello\n  - world\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.key).toBe('items\x000');
      expect(entries[0]!.value).toBe('hello');
      expect(entries[1]!.key).toBe('items\x001');
      expect(entries[1]!.value).toBe('world');
    });

    it('should round-trip array values preserving structure', () => {
      const yaml = 'items:\n  - hello\n  - world\n';
      const entries: TranslatedEntry[] = [
        { key: 'items\x000', value: 'hello', translation: 'hola' },
        { key: 'items\x001', value: 'world', translation: 'mundo' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('- hola');
      expect(result).toContain('- mundo');
      expect(result).toContain('items:');
    });

    it('should skip non-string array items', () => {
      const yaml = 'mixed:\n  - hello\n  - 42\n  - true\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe('mixed\x000');
      expect(entries[0]!.value).toBe('hello');
    });

    it('should walk into object items within arrays', () => {
      const yaml = 'list:\n  - name: Alice\n    role: admin\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(2);
      const keys = entries.map(e => e.key);
      expect(keys).toContain('list\x000\x00name');
      expect(keys).toContain('list\x000\x00role');
    });
  });

  describe('anchor/alias handling', () => {
    it('should extract both anchor and alias entries with correct values', () => {
      const yaml = 'base: &anchor "hello"\nalias: *anchor\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(2);
      const baseEntry = entries.find(e => e.key === 'base');
      const aliasEntry = entries.find(e => e.key === 'alias');
      expect(baseEntry).toBeDefined();
      expect(baseEntry!.value).toBe('hello');
      expect(aliasEntry).toBeDefined();
      expect(aliasEntry!.value).toBe('hello');
    });

    it('should reconstruct with translations preserving YAML structure', () => {
      const yaml = 'base: &anchor "hello"\nalias: *anchor\n';
      const entries: TranslatedEntry[] = [
        { key: 'base', value: 'hello', translation: 'hola' },
        { key: 'alias', value: 'hello', translation: 'hola' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('base');
      expect(result).toContain('alias');
      expect(result).toContain('hola');
    });
  });

  describe('reconstruct removes deleted keys', () => {
    it('should not include keys absent from translation entries', () => {
      const template = [
        'greeting: Hello',
        'farewell: Goodbye',
        'deleted_key: Remove me',
      ].join('\n');

      const entries: TranslatedEntry[] = [
        { key: 'greeting', value: 'Hello', translation: 'Hola' },
        { key: 'farewell', value: 'Goodbye', translation: 'Adiós' },
      ];

      const result = parser.reconstruct(template, entries);
      expect(result).toContain('greeting');
      expect(result).toContain('farewell');
      expect(result).not.toContain('deleted_key');
      expect(result).not.toContain('Remove me');
    });

    it('should remove nested deleted keys', () => {
      const template = [
        'nav:',
        '  home: Home',
        '  about: About',
        '  removed: Gone',
      ].join('\n');

      const entries: TranslatedEntry[] = [
        { key: 'nav\0home', value: 'Home', translation: 'Inicio' },
        { key: 'nav\0about', value: 'About', translation: 'Acerca' },
      ];

      const result = parser.reconstruct(template, entries);
      expect(result).toContain('home');
      expect(result).toContain('about');
      expect(result).not.toContain('removed');
      expect(result).not.toContain('Gone');
    });
  });

  describe('extract edge cases', () => {
    it('should return empty array for empty content', () => {
      expect(parser.extract('')).toEqual([]);
    });

    it('should return empty array for whitespace-only content', () => {
      expect(parser.extract('   \n  ')).toEqual([]);
    });

    it('should return empty array when document has no contents (comment-only YAML)', () => {
      const yaml = '# just a comment\n';
      const entries = parser.extract(yaml);
      expect(entries).toEqual([]);
    });

    it('should throw on YAML parse errors', () => {
      const yaml = 'key: [invalid: yaml: :::';
      expect(() => parser.extract(yaml)).toThrow('YAML parse error');
    });

    it('should skip non-string scalar values', () => {
      const yaml = 'name: Hello\ncount: 42\nflag: true\nnull_val: null\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe('name');
    });
  });

  describe('walkNode with sequences', () => {
    it('should walk into nested sequences within sequences', () => {
      const yaml = 'matrix:\n  - - a\n    - b\n  - - c\n';
      const entries = parser.extract(yaml);
      const keys = entries.map(e => e.key);
      expect(keys).toContain('matrix\x000\x000');
      expect(keys).toContain('matrix\x000\x001');
      expect(keys).toContain('matrix\x001\x000');
    });

    it('should walk into map nodes inside sequences', () => {
      const yaml = 'items:\n  - title: First\n  - title: Second\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(2);
      const keys = entries.map(e => e.key);
      expect(keys).toContain('items\x000\x00title');
      expect(keys).toContain('items\x001\x00title');
    });
  });

  describe('aliases resolving to collections', () => {
    it('should extract aliased map content only at its anchor site', () => {
      const yaml = 'defaults: &defaults\n  color: red\n  size: large\ntheme: *defaults\n';
      const entries = parser.extract(yaml);
      const keys = entries.map(e => e.key);
      expect(keys).toEqual(['defaults\0color', 'defaults\0size']);
    });

    it('should extract aliased map content in a sequence only at its anchor site', () => {
      const yaml = 'base: &base\n  x: hello\nitems:\n  - *base\n';
      const entries = parser.extract(yaml);
      const keys = entries.map(e => e.key);
      expect(keys).toEqual(['base\0x']);
    });

    it('should round-trip an alias to a map, preserving the reference', () => {
      const yaml = 'defaults: &defaults\n  color: red\ntheme: *defaults\n';
      const entries: TranslatedEntry[] = [
        { key: 'defaults\0color', value: 'red', translation: 'rojo' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('&defaults');
      expect(result).toContain('theme: *defaults');
      expect(result).toContain('rojo');
      expect(result).not.toContain('red');
    });

    it('should round-trip an alias to a sequence, preserving the reference', () => {
      const yaml = 'langs: &langs\n  - hello\ncopy: *langs\n';
      const entries: TranslatedEntry[] = [
        { key: 'langs\x000', value: 'hello', translation: 'hola' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('&langs');
      expect(result).toContain('copy: *langs');
      expect(result).toContain('- hola');
    });

    it('should round-trip merge keys, preserving the merge reference', () => {
      const yaml = [
        'defaults: &d',
        '  color: red',
        'theme:',
        '  <<: *d',
        '  name: Dark',
        '',
      ].join('\n');
      const extracted = parser.extract(yaml);
      expect(extracted.map(e => e.key)).toEqual(['defaults\0color', 'theme\0name']);

      const entries: TranslatedEntry[] = extracted.map(e => ({
        ...e,
        translation: e.value === 'red' ? 'rojo' : 'Oscuro',
      }));
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('&d');
      expect(result).toContain('<<: *d');
      expect(result).toContain('rojo');
      expect(result).toContain('Oscuro');
    });

    it('should translate anchored content so aliases resolve to translations', () => {
      const yaml = 'defaults: &defaults\n  color: red\ntheme: *defaults\n';
      const entries: TranslatedEntry[] = [
        { key: 'defaults\0color', value: 'red', translation: 'rojo' },
      ];
      const result = parser.reconstruct(yaml, entries);
      const roundTripped = parser.extract(result);
      expect(roundTripped).toEqual([{ key: 'defaults\0color', value: 'rojo' }]);
    });
  });

  describe('reconstruct walkDoc with sequences', () => {
    it('should delete sequence string items absent from translations', () => {
      const yaml = 'items:\n  - keep\n  - remove\n';
      const entries: TranslatedEntry[] = [
        { key: 'items\x000', value: 'keep', translation: 'kept' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('kept');
      expect(result).not.toContain('remove');
    });

    it('should walk into map nodes inside sequences during reconstruct', () => {
      const yaml = 'list:\n  - name: Alice\n  - name: Bob\n';
      const entries: TranslatedEntry[] = [
        { key: 'list\x000\x00name', value: 'Alice', translation: 'Alicia' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('Alicia');
      expect(result).not.toContain('Bob');
    });

    it('should walk into nested sequences during reconstruct', () => {
      const yaml = 'matrix:\n  - - a\n    - b\n';
      const entries: TranslatedEntry[] = [
        { key: 'matrix\x000\x000', value: 'a', translation: 'x' },
        { key: 'matrix\x000\x001', value: 'b', translation: 'y' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('x');
      expect(result).toContain('y');
    });
  });

  describe('reconstruct walkDoc with aliases', () => {
    it('should handle alias resolving to a scalar in walkDoc for deletion', () => {
      const yaml = 'base: &anchor hello\nalias: *anchor\nremoved: *anchor\n';
      const entries: TranslatedEntry[] = [
        { key: 'base', value: 'hello', translation: 'hola' },
        { key: 'alias', value: 'hello', translation: 'hola' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('hola');
      expect(result).not.toContain('removed');
    });

    it('should walk alias resolving to scalar in map value during walkDoc', () => {
      const yaml = 'base: &anchor hello\nkept: world\nalias_ref: *anchor\n';
      const entries: TranslatedEntry[] = [
        { key: 'kept', value: 'world', translation: 'mundo' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('mundo');
    });

    it('should walk alias resolving to scalar in map value and delete it', () => {
      const yaml = 'base: &anchor hello\nkept: world\nalias1: *anchor\nalias2: *anchor\n';
      const entries: TranslatedEntry[] = [
        { key: 'kept', value: 'world', translation: 'mundo' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('mundo');
      expect(result).not.toContain('alias1');
      expect(result).not.toContain('alias2');
    });

    it('should handle alias in sequence resolving to scalar in walkDoc', () => {
      const yaml = 'base: &val hello\nitems:\n  - *val\n  - world\n';
      const entries: TranslatedEntry[] = [
        { key: 'base', value: 'hello', translation: 'hola' },
        { key: 'items\x000', value: 'hello', translation: 'hola' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('hola');
      expect(result).not.toContain('world');
    });

    it('should handle alias in sequence resolving to scalar in extract', () => {
      const yaml = 'base: &val hello\nitems:\n  - *val\n  - extra\n';
      const entries = parser.extract(yaml);
      const keys = entries.map(e => e.key);
      expect(keys).toContain('base');
      expect(keys).toContain('items\x000');
      expect(keys).toContain('items\x001');
      expect(entries.find(e => e.key === 'items\x000')!.value).toBe('hello');
    });

    it('should walk alias resolving to scalar in seq during walkDoc and delete it', () => {
      const yaml = 'base: &val hello\nkept: world\nitems:\n  - *val\n';
      const entries: TranslatedEntry[] = [
        { key: 'kept', value: 'world', translation: 'mundo' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('mundo');
      expect(result).not.toContain('*val');
    });
  });

  describe('alias-heavy documents', () => {
    // Would expand to 9^12 nodes if collection aliases were followed; any
    // regression toward expansion blows the test timeout.
    const aliasBomb = (): string => {
      const lines = ['level0: &level0 [a, b, c, d]'];
      for (let i = 1; i <= 12; i++) {
        const refs = Array.from({ length: 9 }, () => `*level${i - 1}`).join(', ');
        lines.push(`level${i}: &level${i} [${refs}]`);
      }
      return `${lines.join('\n')}\n`;
    };

    const anchorReusedManyTimes = (): string => {
      const lines = ['base: &base shared'];
      for (let i = 0; i < 200; i++) {
        lines.push(`key${i}: *base`);
      }
      return `${lines.join('\n')}\n`;
    };

    it('should extract nested alias fan-out without expanding it', () => {
      const entries = parser.extract(aliasBomb());
      expect(entries.map(e => e.key)).toEqual([
        'level0\x000',
        'level0\x001',
        'level0\x002',
        'level0\x003',
      ]);
    });

    it('should reconstruct nested alias fan-out without expanding it', () => {
      const yaml = aliasBomb();
      const entries: TranslatedEntry[] = parser
        .extract(yaml)
        .map(e => ({ ...e, translation: e.value.toUpperCase() }));
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('&level0');
      expect(result).toContain('*level11');
      expect(result).toContain('A');
    });

    it('should extract a large anchor once, leaving its copies as references', () => {
      const lines = ['big: &big'];
      for (let i = 0; i < 500; i++) {
        lines.push(`  entry${i}: value${i}`);
      }
      for (let i = 0; i < 500; i++) {
        lines.push(`copy${i}: *big`);
      }
      const yaml = `${lines.join('\n')}\n`;

      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(500);
      expect(entries.every(e => e.key.startsWith('big\0'))).toBe(true);
    });

    it('should extract nothing from a self-referential anchor', () => {
      const yaml = 'root: &r\n  child: *r\n';
      expect(parser.extract(yaml)).toEqual([]);
    });

    it('should round-trip a self-referential anchor unchanged', () => {
      const yaml = 'root: &r\n  child: *r\n';
      expect(parser.reconstruct(yaml, [])).toBe(yaml);
    });

    it('should still extract a document that reuses one anchor many times', () => {
      const entries = parser.extract(anchorReusedManyTimes());
      expect(entries).toHaveLength(201);
      expect(entries.every(e => e.value === 'shared')).toBe(true);
    });

    it('should still round-trip a document that reuses one anchor many times', () => {
      const yaml = anchorReusedManyTimes();
      const entries: TranslatedEntry[] = parser
        .extract(yaml)
        .map(e => ({ key: e.key, value: e.value, translation: 'compartido' }));
      const result = parser.reconstruct(yaml, entries);
      expect(result).toContain('compartido');
      expect(result).toContain('key199');
    });
  });

  describe('reconstruct with multiple deletions', () => {
    it('should remove several sequence items while keeping the translated one', () => {
      const yaml = 'items:\n  - a\n  - b\n  - c\n  - d\n';
      const entries: TranslatedEntry[] = [
        { key: 'items\x002', value: 'c', translation: 'ce' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toBe('items:\n  - ce\n');
    });

    it('should apply translations and deletions correctly across a large document', () => {
      const size = 500;
      const lines: string[] = ['root:'];
      for (let i = 0; i < size; i++) {
        lines.push(`  key_${i}: value ${i}`);
      }
      const yaml = lines.join('\n') + '\n';

      const entries: TranslatedEntry[] = [];
      for (let i = 0; i < size; i += 2) {
        entries.push({
          key: `root\0key_${i}`,
          value: `value ${i}`,
          translation: `translated ${i}`,
        });
      }

      const result = parser.reconstruct(yaml, entries);
      const roundTripped = parser.extract(result);
      expect(roundTripped).toEqual(entries.map(e => ({ key: e.key, value: e.translation })));
    });
  });

  describe('reconstruct trailing newline handling', () => {
    it('should strip trailing newline if original does not end with one', () => {
      const yaml = 'greeting: Hello';
      const entries: TranslatedEntry[] = [
        { key: 'greeting', value: 'Hello', translation: 'Hola' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).not.toMatch(/\n$/);
      expect(result).toContain('Hola');
    });

    it('should add trailing newline if original ends with one', () => {
      const yaml = 'greeting: Hello\n';
      const entries: TranslatedEntry[] = [
        { key: 'greeting', value: 'Hello', translation: 'Hola' },
      ];
      const result = parser.reconstruct(yaml, entries);
      expect(result).toMatch(/\n$/);
    });
  });

  describe('reconstruct with non-scalar map keys', () => {
    it('should stringify non-scalar map keys', () => {
      const yaml = '123: numeric key value\n';
      const entries = parser.extract(yaml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.value).toBe('numeric key value');
    });
  });
});

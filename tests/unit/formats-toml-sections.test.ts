/**
 * Tests that new TOML keys land in the right section.
 *
 * New keys were appended at end of file using their full dotted path while
 * the last `[section]` header was still in scope, so `messages.newkey`
 * parsed back as `messages.messages.newkey`. Because the intended key was
 * then still missing, it was re-appended on every subsequent sync run.
 */

import { TomlFormatParser } from '../../src/formats/toml';

describe('TOML section handling for new keys', () => {
  const sectioned = '[messages]\ngreeting = "Hello"\n';

  it('should place a new key inside its own section, not nested under it', () => {
    const parser = new TomlFormatParser();

    const out = parser.reconstruct(sectioned, [
      { key: 'messages.greeting', value: 'Hello', translation: 'Hallo' },
      { key: 'messages.farewell', value: 'Goodbye', translation: 'Auf Wiedersehen' },
    ]);

    const keys = parser.extract(out).map((e) => e.key).sort();
    expect(keys).toEqual(['messages.farewell', 'messages.greeting']);
    expect(out).not.toContain('messages.messages');
  });

  it('should produce output that still parses as TOML', () => {
    const parser = new TomlFormatParser();

    const out = parser.reconstruct(sectioned, [
      { key: 'messages.greeting', value: 'Hello', translation: 'Hallo' },
      { key: 'messages.farewell', value: 'Goodbye', translation: 'Auf Wiedersehen' },
    ]);

    // A duplicated section header or doubled path throws here.
    expect(() => parser.extract(out)).not.toThrow();
  });

  it('should not re-append the same key on a second run', () => {
    const parser = new TomlFormatParser();
    const entries = [
      { key: 'messages.greeting', value: 'Hello', translation: 'Hallo' },
      { key: 'messages.farewell', value: 'Goodbye', translation: 'Auf Wiedersehen' },
    ];

    const first = parser.reconstruct(sectioned, entries);
    const second = parser.reconstruct(first, entries);

    expect(second).toBe(first);
    expect(parser.extract(second)).toHaveLength(2);
  });

  it('should still append a root-level key at root', () => {
    const parser = new TomlFormatParser();

    const out = parser.reconstruct('greeting = "Hello"\n', [
      { key: 'greeting', value: 'Hello', translation: 'Hallo' },
      { key: 'farewell', value: 'Goodbye', translation: 'Auf Wiedersehen' },
    ]);

    expect(parser.extract(out).map((e) => e.key).sort()).toEqual(['farewell', 'greeting']);
  });

  describe('multi-line string blocks', () => {
    // A body line inside a multi-line string can look like `key = "..."`; it
    // must not be parsed as an entry, or the block is torn apart and the
    // document stops parsing.
    const multiline = [
      'intro = """',
      'Welcome to the app.',
      'setting = "this looks like a key"',
      'Goodbye.',
      '"""',
      'greeting = "Hello"',
      '',
    ].join('\n');

    it('should preserve the whole block verbatim', () => {
      const parser = new TomlFormatParser();
      const entries = parser.extract(multiline);

      const out = parser.reconstruct(
        multiline,
        entries.map((e) => ({ ...e, translation: e.key === 'greeting' ? 'Hallo' : e.value })),
      );

      expect(out).toContain('setting = "this looks like a key"');
      expect(out).toContain('Goodbye.');
    });

    it('should not append a duplicate of the multi-line key', () => {
      const parser = new TomlFormatParser();
      const entries = parser.extract(multiline);

      const out = parser.reconstruct(
        multiline,
        entries.map((e) => ({ ...e, translation: e.key === 'greeting' ? 'Hallo' : e.value })),
      );

      expect(() => parser.extract(out)).not.toThrow();
      expect(parser.extract(out).map((e) => e.key).sort()).toEqual(['greeting', 'intro']);
    });

    it('should still translate ordinary keys alongside a multi-line block', () => {
      const parser = new TomlFormatParser();
      const entries = parser.extract(multiline);

      const out = parser.reconstruct(
        multiline,
        entries.map((e) => ({ ...e, translation: e.key === 'greeting' ? 'Hallo' : e.value })),
      );

      const byKey = new Map(parser.extract(out).map((e) => [e.key, e.value]));
      expect(byKey.get('greeting')).toBe('Hallo');
    });

    it('should handle a single-line triple-quoted value', () => {
      const parser = new TomlFormatParser();
      const source = 'note = """all on one line"""\ngreeting = "Hello"\n';
      const entries = parser.extract(source);

      const out = parser.reconstruct(
        source,
        entries.map((e) => ({ ...e, translation: e.key === 'greeting' ? 'Hallo' : e.value })),
      );

      expect(() => parser.extract(out)).not.toThrow();
      expect(new Map(parser.extract(out).map((e) => [e.key, e.value])).get('greeting')).toBe('Hallo');
    });
  });

  it('should handle a new key for a section that does not exist yet', () => {
    const parser = new TomlFormatParser();

    const out = parser.reconstruct(sectioned, [
      { key: 'messages.greeting', value: 'Hello', translation: 'Hallo' },
      { key: 'errors.notFound', value: 'Not found', translation: 'Nicht gefunden' },
    ]);

    const keys = parser.extract(out).map((e) => e.key).sort();
    expect(keys).toEqual(['errors.notFound', 'messages.greeting']);
  });
});

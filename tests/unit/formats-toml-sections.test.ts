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

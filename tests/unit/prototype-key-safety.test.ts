/**
 * Tests that accumulators keyed by untrusted strings tolerate keys named
 * after Object.prototype members.
 *
 * An i18n key, TMS key, or glossary term may legitimately be called
 * "toString", "constructor", or "__proto__". A `Record<string, X> = {}`
 * accumulator inherits Object.prototype, so a `key in obj` or
 * `obj[key] !== undefined` membership test returns a truthy *inherited
 * function* for those names — which has produced prototype pollution and
 * permanent loss of human translations.
 *
 * IMPORTANT: every fixture here is a RAW STRING or a real file. A fixture
 * written as a JS object literal cannot express these keys, because in
 * object-literal syntax `__proto__:` sets the prototype instead of creating
 * an own property — that is exactly why this class went undetected.
 */

import { JsonFormatParser } from '../../src/formats/json';
import { sanitizePullKeysResponse } from '../../src/sync/tms-client';
import { GlossaryService } from '../../src/services/glossary';
import { sortedKeysReplacer } from '../../src/sync/sync-lock';
import { Logger } from '../../src/utils/logger';

const PROTO_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];

describe('prototype-named key safety', () => {
  afterEach(() => {
    // Never leak pollution into sibling suites.
    for (const probe of ['polluted', 'injected']) {
      delete (Object.prototype as unknown as Record<string, unknown>)[probe];
    }
  });

  /** Reads a probe off a fresh object without tripping index-signature rules. */
  function probeOnFreshObject(name: string): unknown {
    return (({}) as Record<string, unknown>)[name];
  }

  describe('JsonFormatParser', () => {
    it('should not pollute Object.prototype when reconstructing a __proto__ key', () => {
      const source = '{"__proto__": {"polluted": "x"}, "greeting": "Hello"}';
      const parser = new JsonFormatParser();
      const entries = parser.extract(source);
      const translated = entries.map((e) => ({
        ...e,
        translation: e.key === 'greeting' ? 'Hallo' : 'PWNED',
      }));

      parser.reconstruct('{}', translated);

      expect(probeOnFreshObject('polluted')).toBeUndefined();
      expect((([] as unknown) as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('should round-trip a literal toString key as ordinary data', () => {
      const source = '{"toString": "Convert to text", "greeting": "Hello"}';
      const parser = new JsonFormatParser();
      const entries = parser.extract(source);
      const translated = entries.map((e) => ({
        ...e,
        translation: e.key === 'toString' ? 'In Text umwandeln' : 'Hallo',
      }));

      const out = parser.reconstruct('{}', translated);

      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(Object.hasOwn(parsed, 'toString')).toBe(true);
      expect(parsed['toString']).toBe('In Text umwandeln');
      expect(parsed['greeting']).toBe('Hallo');
    });

    it.each(PROTO_KEYS)('should round-trip a %s key present in the entry list', (key) => {
      const parser = new JsonFormatParser();
      // Note: a key absent from the entry list is pruned by removeDeletedKeys,
      // which is intended behaviour — so the key under test must be supplied.
      const target = `{"greeting":"Hallo",${JSON.stringify(key)}:"alt"}`;

      const out = parser.reconstruct(target, [
        { key: 'greeting', value: 'Hello', translation: 'Hallo' },
        { key, value: 'Source', translation: 'vorhanden' },
      ]);

      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(Object.hasOwn(parsed, key)).toBe(true);
      expect(parsed[key]).toBe('vorhanden');
    });

    // The cases above reconstruct a key the target already holds. Inserting a
    // key the target lacks is a different code path, and the one where plain
    // assignment silently drops the translation instead of polluting: on a
    // fresh {}, obj['__proto__'] = v retargets that object's prototype, so a
    // negative "was Object.prototype polluted" assertion still passes.
    it.each(PROTO_KEYS)('should insert a %s key absent from the target as own data', (key) => {
      const parser = new JsonFormatParser();

      const out = parser.reconstruct('{"greeting":"Hallo"}', [
        { key: 'greeting', value: 'Hello', translation: 'Hallo' },
        { key, value: 'Source', translation: 'eingefuegt' },
      ]);

      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(Object.hasOwn(parsed, key)).toBe(true);
      expect(parsed[key]).toBe('eingefuegt');
      expect(probeOnFreshObject('eingefuegt')).toBeUndefined();
    });

    it('should insert a nested key under __proto__ as own data', () => {
      const parser = new JsonFormatParser();

      const out = parser.reconstruct('{"greeting":"Hallo"}', [
        { key: 'greeting', value: 'Hello', translation: 'Hallo' },
        { key: '__proto__.nested', value: 'Source', translation: 'verschachtelt' },
      ]);

      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
      expect((parsed['__proto__'] as Record<string, unknown>)['nested']).toBe('verschachtelt');
    });
  });

  describe('sanitizePullKeysResponse', () => {
    it('should return an object with no inherited members', () => {
      const raw = JSON.parse('{"greeting": "Hallo"}') as Record<string, unknown>;

      const result = sanitizePullKeysResponse(raw);

      // A prototype-less accumulator is what makes membership tests honest.
      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    it.each(PROTO_KEYS)('should report %s as absent when the TMS export is empty', (key) => {
      const result = sanitizePullKeysResponse(JSON.parse('{}') as Record<string, unknown>);

      // The bug: result[key] returned an inherited function, so callers
      // treated the key as freshly approved and discarded the real translation.
      expect(result[key]).toBeUndefined();
      expect(Object.hasOwn(result, key)).toBe(false);
    });

    it('should retain a genuine translation for a prototype-named key', () => {
      const raw = JSON.parse('{"toString": "In Text umwandeln"}') as Record<string, unknown>;

      const result = sanitizePullKeysResponse(raw);

      expect(Object.hasOwn(result, 'toString')).toBe(true);
      expect(result['toString']).toBe('In Text umwandeln');
    });
  });

  describe('GlossaryService.tsvToEntries', () => {
    it.each(PROTO_KEYS)('should keep a %s source term instead of dropping it', (key) => {
      const tsv = `hello\tHallo\n${key}\tPrototyp\nworld\tWelt\n`;

      const entries = GlossaryService.tsvToEntries(tsv);

      expect(Object.keys(entries).sort()).toEqual([key, 'hello', 'world'].sort());
      expect(entries[key]).toBe('Prototyp');
    });

    it('should not report a prototype-named term as a duplicate', () => {
      const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      try {
        GlossaryService.tsvToEntries('toString\tIn Text umwandeln\n');

        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Duplicate source'));
      } finally {
        warn.mockRestore();
      }
    });

    it('should still report a genuine duplicate', () => {
      const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      try {
        GlossaryService.tsvToEntries('hello\tHallo\nhello\tGuten Tag\n');

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate source'));
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('sortedKeysReplacer', () => {
    it.each(PROTO_KEYS)('should preserve a %s lockfile key when sorting', (key) => {
      // Built by JSON.parse so the prototype-named key is a real own property.
      const src = JSON.parse(`{"zebra": 1, ${JSON.stringify(key)}: 2, "alpha": 3}`) as Record<
        string,
        unknown
      >;

      const out = sortedKeysReplacer('entries', src) as Record<string, unknown>;

      expect(Object.hasOwn(out, key)).toBe(true);
      expect(out[key]).toBe(2);
      expect(JSON.parse(JSON.stringify(out)) as Record<string, unknown>).toHaveProperty(key, 2);
    });
  });
});

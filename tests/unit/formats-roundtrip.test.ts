/**
 * Round-trip stability tests: extract -> reconstruct -> extract must be a
 * fixed point. A parser that is not idempotent corrupts a little more on
 * every `deepl sync` run, which is how entity double-escaping went
 * unnoticed — a single run looks almost right.
 */

import { AndroidXmlFormatParser } from '../../src/formats/android-xml';
import { PropertiesFormatParser } from '../../src/formats/properties';

describe('parser round-trip stability', () => {
  describe('Android XML entity escaping', () => {
    const source = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="terms">Terms &amp; Conditions</string>
  <string name="cmp">5 &lt; 10</string>
</resources>
`;

    it('should decode entities on extract', () => {
      const entries = new AndroidXmlFormatParser().extract(source);

      const byKey = new Map(entries.map((e) => [e.key, e.value]));
      expect(byKey.get('terms')).toBe('Terms & Conditions');
      expect(byKey.get('cmp')).toBe('5 < 10');
    });

    it('should not double-escape ampersands on reconstruct', () => {
      const parser = new AndroidXmlFormatParser();
      const entries = parser.extract(source);

      const out = parser.reconstruct(
        source,
        entries.map((e) => ({ ...e, translation: e.value })),
      );

      expect(out).not.toContain('&amp;amp;');
      expect(out).not.toContain('&amp;lt;');
    });

    it('should be a fixed point across three successive syncs', () => {
      const parser = new AndroidXmlFormatParser();
      let content = source;
      const seen: string[] = [];

      for (let run = 0; run < 3; run++) {
        const entries = parser.extract(content);
        // Identity "translation": any drift is the parser's, not the engine's.
        content = parser.reconstruct(
          content,
          entries.map((e) => ({ ...e, translation: e.value })),
        );
        seen.push(parser.extract(content).map((e) => `${e.key}=${e.value}`).join('|'));
      }

      expect(seen[1]).toBe(seen[0]);
      expect(seen[2]).toBe(seen[0]);
      expect(seen[0]).toContain('terms=Terms & Conditions');
    });
  });

  describe('Java .properties astral characters', () => {
    const source = 'greeting=Hello world\n';

    it('should escape an emoji as a complete surrogate pair', () => {
      const parser = new PropertiesFormatParser();
      const entries = parser.extract(source);

      const out = parser.reconstruct(
        source,
        entries.map((e) => ({ ...e, translation: 'Hello 😀 world' })),
      );

      // A lone high surrogate (\ud83d with no \ude00) is malformed and
      // unrecoverable — the emoji must survive as both units.
      expect(out).toContain('\\ud83d\\ude00');
    });

    it('should round-trip an emoji back to the same string', () => {
      const parser = new PropertiesFormatParser();
      const withEmoji = parser.reconstruct(
        source,
        parser.extract(source).map((e) => ({ ...e, translation: 'Hello 😀 world' })),
      );

      const reExtracted = parser.extract(withEmoji);

      expect(reExtracted[0]?.value).toBe('Hello 😀 world');
    });

    it('should round-trip non-ASCII BMP characters unchanged', () => {
      const parser = new PropertiesFormatParser();
      const withUmlaut = parser.reconstruct(
        source,
        parser.extract(source).map((e) => ({ ...e, translation: 'Grüße, Welt' })),
      );

      expect(parser.extract(withUmlaut)[0]?.value).toBe('Grüße, Welt');
    });
  });
});

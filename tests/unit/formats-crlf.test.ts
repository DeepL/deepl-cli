/**
 * Tests that line-based parsers treat CRLF input the same as LF.
 *
 * Splitting on '\n' alone leaves a trailing '\r' that defeats the `$`-anchored
 * entry patterns, so a Windows-authored resource file extracts zero entries:
 * `deepl sync status` reports 0% coverage with exit 0 and reconstruct rewrites
 * the file from nothing.
 */

import { PoFormatParser } from '../../src/formats/po';
import { IosStringsFormatParser } from '../../src/formats/ios-strings';
import { PropertiesFormatParser } from '../../src/formats/properties';
import { TomlFormatParser } from '../../src/formats/toml';
import type { FormatParser } from '../../src/formats/format';

interface LineBasedCase {
  label: string;
  parser: () => FormatParser;
  /** LF-only source; the CRLF variant is derived from it. */
  source: string;
  expectedKeys: string[];
}

const CASES: LineBasedCase[] = [
  {
    label: 'PO',
    parser: () => new PoFormatParser(),
    source: 'msgid "greeting"\nmsgstr "Hello"\n\nmsgid "farewell"\nmsgstr "Goodbye"\n',
    expectedKeys: ['greeting', 'farewell'],
  },
  {
    label: 'iOS .strings',
    parser: () => new IosStringsFormatParser(),
    source: '"greeting" = "Hello";\n"farewell" = "Goodbye";\n',
    expectedKeys: ['greeting', 'farewell'],
  },
  {
    label: 'Java .properties',
    parser: () => new PropertiesFormatParser(),
    source: 'greeting=Hello\nfarewell=Goodbye\n',
    expectedKeys: ['greeting', 'farewell'],
  },
  {
    label: 'TOML',
    parser: () => new TomlFormatParser(),
    source: 'greeting = "Hello"\nfarewell = "Goodbye"\n',
    expectedKeys: ['greeting', 'farewell'],
  },
];

describe('line-based parsers with CRLF line endings', () => {
  describe.each(CASES)('$label', ({ parser, source, expectedKeys }) => {
    const crlf = source.replace(/\n/g, '\r\n');

    it('should extract the same keys from LF and CRLF sources', () => {
      const fromLf = parser().extract(source).map((e) => e.key);
      const fromCrlf = parser().extract(crlf).map((e) => e.key);

      expect(fromLf).toEqual(expect.arrayContaining(expectedKeys));
      expect(fromCrlf).toEqual(fromLf);
    });

    it('should extract the same values from LF and CRLF sources', () => {
      const fromLf = parser().extract(source).map((e) => e.value);
      const fromCrlf = parser().extract(crlf).map((e) => e.value);

      expect(fromCrlf).toEqual(fromLf);
      // A stray \r must not survive into an extracted value.
      for (const value of fromCrlf) {
        expect(value).not.toContain('\r');
      }
    });

    it('should not silently extract zero entries from a CRLF source', () => {
      const entries = parser().extract(crlf);

      expect(entries.length).toBeGreaterThan(0);
    });

    it('should reconstruct a CRLF source without losing entries', () => {
      const entries = parser().extract(crlf);
      const translated = entries.map((e) => ({ ...e, translation: `[de]${e.value}` }));

      const out = parser().reconstruct(crlf, translated);
      const reExtracted = parser().extract(out);

      expect(reExtracted.map((e) => e.key)).toEqual(entries.map((e) => e.key));
    });
  });
});

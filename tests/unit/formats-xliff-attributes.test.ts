/**
 * Tests that XLIFF elements carrying attributes are handled.
 *
 * `state` is a standard XLIFF attribute that every CAT tool writes, but
 * SEGMENT_RE and TARGET_RE required bare `<segment>` / `<target>` tags. The
 * consequences were severe and silent: for XLIFF 2.0, extract returned no
 * entries and reconstruct then deleted every `<unit>`; for XLIFF 1.2, an
 * existing `<target state="...">` was treated as absent and a second
 * `<target>` was injected, producing schema-invalid output that retained
 * the stale translation.
 */

import { XliffFormatParser } from '../../src/formats/xliff';

const V12_WITH_STATE = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2">
  <file source-language="en" target-language="de" datatype="plaintext" original="app">
    <body>
      <trans-unit id="greeting">
        <source>Hello</source>
        <target state="needs-translation">Hallo alt</target>
      </trans-unit>
    </body>
  </file>
</xliff>
`;

const V20_WITH_STATE = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="2.0" srcLang="en" trgLang="de">
  <file id="f1">
    <unit id="greeting">
      <segment state="initial">
        <source>Hello</source>
        <target>Hallo alt</target>
      </segment>
    </unit>
  </file>
</xliff>
`;

describe('XLIFF elements with attributes', () => {
  describe('XLIFF 2.0 <segment state="...">', () => {
    it('should extract the unit rather than returning nothing', () => {
      const entries = new XliffFormatParser().extract(V20_WITH_STATE);

      expect(entries.map((e) => e.key)).toEqual(['greeting']);
      expect(entries[0]?.value).toBe('Hello');
    });

    it('should not delete the unit on reconstruct', () => {
      const parser = new XliffFormatParser();
      const entries = parser.extract(V20_WITH_STATE);
      const translated = entries.map((e) => ({ ...e, translation: 'Guten Tag' }));

      const out = parser.reconstruct(V20_WITH_STATE, translated);

      expect(out).toContain('<unit id="greeting">');
      expect(out).toContain('Guten Tag');
      expect(parser.extract(out).map((e) => e.key)).toEqual(['greeting']);
    });

    it('should preserve the segment state attribute', () => {
      const parser = new XliffFormatParser();
      const entries = parser.extract(V20_WITH_STATE);

      const out = parser.reconstruct(
        V20_WITH_STATE,
        entries.map((e) => ({ ...e, translation: 'Guten Tag' })),
      );

      expect(out).toContain('state="initial"');
    });
  });

  describe('XLIFF 1.2 <target state="...">', () => {
    it('should replace the existing target rather than injecting a second one', () => {
      const parser = new XliffFormatParser();
      const entries = parser.extract(V12_WITH_STATE);

      const out = parser.reconstruct(
        V12_WITH_STATE,
        entries.map((e) => ({ ...e, translation: 'Guten Tag' })),
      );

      const targetOpenTags = out.match(/<target[\s>]/g) ?? [];
      expect(targetOpenTags).toHaveLength(1);
      expect(out).toContain('Guten Tag');
      expect(out).not.toContain('Hallo alt');
    });

    it('should preserve the target state attribute', () => {
      const parser = new XliffFormatParser();
      const entries = parser.extract(V12_WITH_STATE);

      const out = parser.reconstruct(
        V12_WITH_STATE,
        entries.map((e) => ({ ...e, translation: 'Guten Tag' })),
      );

      expect(out).toContain('state="needs-translation"');
    });
  });
});

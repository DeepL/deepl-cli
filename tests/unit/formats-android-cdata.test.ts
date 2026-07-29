/**
 * A translation cannot break out of an Android CDATA section.
 *
 * The regex round-trip is asymmetric inside CDATA — nothing in the body is
 * entity-escaped — so a value carrying `]]>` would close the section and have
 * its remainder parsed as XML. Such values are refused, matching the XLIFF
 * parser's stance on CDATA in translatable content.
 */

import { AndroidXmlFormatParser } from '../../src/formats/android-xml';
import { ValidationError } from '../../src/utils/errors';

const WITH_CDATA = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="body"><![CDATA[<b>Bold</b> text]]></string>
  <string name="plain">Plain</string>
</resources>
`;

const BREAKOUT =
  ']]></string><string name="injected">https://evil.example.com</string><string name="body"><![CDATA[';

describe('Android XML CDATA safety', () => {
  it('should extract CDATA content without the wrapper', () => {
    const entries = new AndroidXmlFormatParser().extract(WITH_CDATA);

    const byKey = new Map(entries.map((e) => [e.key, e.value]));
    expect(byKey.get('body')).toBe('<b>Bold</b> text');
  });

  it('should refuse a translation that closes the CDATA section', () => {
    const parser = new AndroidXmlFormatParser();
    const entries = parser.extract(WITH_CDATA);
    const translated = entries.map((e) => ({
      ...e,
      translation: e.key === 'body' ? BREAKOUT : e.value,
    }));

    expect(() => parser.reconstruct(WITH_CDATA, translated)).toThrow(ValidationError);
    expect(() => parser.reconstruct(WITH_CDATA, translated)).toThrow(/CDATA/);
  });

  it('should refuse a bare "]]>" sequence rather than splitting the section', () => {
    const parser = new AndroidXmlFormatParser();
    const entries = parser.extract(WITH_CDATA);

    expect(() =>
      parser.reconstruct(
        WITH_CDATA,
        entries.map((e) => ({ ...e, translation: e.key === 'body' ? 'array]]> end' : e.value })),
      ),
    ).toThrow(/"\]\]>"/);
  });

  it('should refuse a breakout inside a plural item', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <plurals name="items">
    <item quantity="one"><![CDATA[<b>1</b> item]]></item>
    <item quantity="other"><![CDATA[<b>%d</b> items]]></item>
  </plurals>
</resources>
`;
    const parser = new AndroidXmlFormatParser();

    expect(() =>
      parser.reconstruct(xml, [
        {
          key: 'items',
          value: '<b>%d</b> items',
          translation: '<b>%d</b> Elemente',
          metadata: {
            plurals: [
              { quantity: 'one', value: '<b>1</b> Element' },
              { quantity: 'other', value: `]]><string name="injected">x</string><![CDATA[` },
            ],
          },
        },
      ]),
    ).toThrow(ValidationError);
  });

  it('should refuse a breakout inside a string-array item', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string-array name="labels">
    <item><![CDATA[Less < More]]></item>
  </string-array>
</resources>
`;
    const parser = new AndroidXmlFormatParser();

    expect(() =>
      parser.reconstruct(xml, [
        { key: 'labels.0', value: 'Less < More', translation: ']]></item><item>injected<![CDATA[' },
      ]),
    ).toThrow(ValidationError);
  });

  it('should escape "]]>" as entities outside a CDATA section', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="plain">Plain</string>
</resources>
`;
    const parser = new AndroidXmlFormatParser();

    const out = parser.reconstruct(xml, [
      { key: 'plain', value: 'Plain', translation: 'array]]> end' },
    ]);

    expect(out).toContain('array]]&gt; end');
    expect(new Map(parser.extract(out).map((e) => [e.key, e.value])).get('plain')).toBe(
      'array]]> end',
    );
  });

  it('should keep CDATA output well-formed for ordinary translations', () => {
    const parser = new AndroidXmlFormatParser();
    const entries = parser.extract(WITH_CDATA);

    const out = parser.reconstruct(
      WITH_CDATA,
      entries.map((e) => ({ ...e, translation: e.key === 'body' ? '<b>Fett</b> Text' : e.value })),
    );

    expect(out).toContain('<![CDATA[<b>Fett</b> Text]]>');
    expect(new Map(parser.extract(out).map((e) => [e.key, e.value])).get('body')).toBe(
      '<b>Fett</b> Text',
    );
  });

  it('should never re-extract more entries than the template declares', () => {
    const parser = new AndroidXmlFormatParser();
    const entries = parser.extract(WITH_CDATA);

    const out = parser.reconstruct(
      WITH_CDATA,
      entries.map((e) => ({ ...e, translation: e.key === 'body' ? '<i>x</i>' : e.value })),
    );

    expect(parser.extract(out)).toHaveLength(entries.length);
  });

  it('should concatenate adjacent CDATA sections when extracting', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="split"><![CDATA[first]]><![CDATA[second]]></string>
</resources>
`;
    const entries = new AndroidXmlFormatParser().extract(xml);

    expect(entries).toEqual([{ key: 'split', value: 'firstsecond' }]);
  });
});

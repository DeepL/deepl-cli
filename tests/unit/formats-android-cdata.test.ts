/**
 * Tests that a translation cannot break out of an Android CDATA section.
 *
 * escapeForReconstruct wrapped the translation in `<![CDATA[...]]>` with no
 * escaping, so a value containing `]]>` closed the section early and the
 * remainder was parsed as XML — allowing extra <string> elements to be
 * injected into a generated resource file. This is reachable without a
 * malicious API, because on translation failure the source string is written
 * through verbatim and the source file is used as the template when the
 * target locale file does not exist yet.
 */

import { AndroidXmlFormatParser } from '../../src/formats/android-xml';

const WITH_CDATA = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="body"><![CDATA[<b>Bold</b> text]]></string>
  <string name="plain">Plain</string>
</resources>
`;

describe('Android XML CDATA safety', () => {
  it('should extract CDATA content without the wrapper', () => {
    const entries = new AndroidXmlFormatParser().extract(WITH_CDATA);

    const byKey = new Map(entries.map((e) => [e.key, e.value]));
    expect(byKey.get('body')).toBe('<b>Bold</b> text');
  });

  it('should keep injected markup inside the CDATA section', () => {
    const parser = new AndroidXmlFormatParser();
    const entries = parser.extract(WITH_CDATA);
    const attack =
      ']]></string><string name="injected">https://evil.example.com</string><string name="body"><![CDATA[';

    const out = parser.reconstruct(
      WITH_CDATA,
      entries.map((e) => ({ ...e, translation: e.key === 'body' ? attack : e.value })),
    );

    // Strip every CDATA section: whatever remains is real markup, and the
    // attacker's element must not be part of it.
    const markupOnly = out.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    expect(markupOnly).not.toContain('name="injected"');
    // Known limitation, unchanged by this fix: extract() is regex-based, so
    // literal `<string name=…>` text inside a CDATA body is still counted as
    // an element. A real Android build reads one element here.
  });

  it('should preserve "]]>" as literal text through a round-trip', () => {
    const parser = new AndroidXmlFormatParser();
    const entries = parser.extract(WITH_CDATA);
    const literal = 'array]]> end';

    const out = parser.reconstruct(
      WITH_CDATA,
      entries.map((e) => ({ ...e, translation: e.key === 'body' ? literal : e.value })),
    );

    const roundTripped = new Map(parser.extract(out).map((e) => [e.key, e.value]));
    expect(roundTripped.get('body')).toBe(literal);
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
});

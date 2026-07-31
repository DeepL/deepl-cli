/**
 * Round-trip laws over all 11 format parsers, driven by fast-check.
 *
 * Symmetric formats (extract reads the same slot reconstruct writes):
 *   L1  value round-trip:  extract(reconstruct(skeleton, t)).values === t
 *   L2  content idempotence: reconstruct(out, same entries) === out
 *   L3  extract fixed point: extract after a second identity cycle is stable
 *
 * Asymmetric formats (PO, XLIFF — extract reads msgid/<source>, reconstruct
 * writes msgstr/<target>):
 *   L2  content idempotence: reconstruct(out, t) === out
 *   L4  source preservation: extract(out).values === extract(skeleton).values
 */
import fc from 'fast-check';
import { createDefaultRegistrySync } from '../../src/formats/index';
import type { FormatParser, TranslatedEntry } from '../../src/formats/format';
import { fcParams, translationsArb } from './arbitraries';

interface FormatCase {
  configKey: string;
  skeleton: string;
  symmetric: boolean;
  /** multi-locale formats: locale extract reads from / reconstruct writes to */
  sourceLocale?: string;
  targetLocale?: string;
}

const CASES: FormatCase[] = [
  {
    configKey: 'json',
    symmetric: true,
    skeleton: `{
  "greeting": "Hello",
  "nav": {
    "home": "Home",
    "title": "Site: \\"quoted\\""
  },
  "count": 42,
  "enabled": true
}
`,
  },
  {
    configKey: 'yaml',
    symmetric: true,
    skeleton: `# top comment
greeting: Hello
nav:
  home: Home
  title: "Quoted: value"
`,
  },
  {
    configKey: 'po',
    symmetric: false,
    skeleton: `msgid ""
msgstr "Content-Type: text/plain; charset=UTF-8\\n"

#. Developer note
#: src/app.ts:10
msgid "Hello"
msgstr ""

msgctxt "menu"
msgid "Open"
msgstr ""

msgid "Terms & Conditions"
msgstr ""
`,
  },
  {
    configKey: 'android_xml',
    symmetric: true,
    skeleton: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="greeting">Hello</string>
  <string name="terms">Terms &amp; Conditions</string>
  <string name="cmp">5 &lt; 10</string>
</resources>
`,
  },
  {
    configKey: 'ios_strings',
    symmetric: true,
    skeleton: `/* Greeting shown on launch */
"greeting" = "Hello";
"farewell" = "Goodbye";
"quoted" = "Say \\"hi\\"";
`,
  },
  {
    configKey: 'arb',
    symmetric: true,
    skeleton: `{
  "@@locale": "en",
  "greeting": "Hello",
  "@greeting": {
    "description": "A greeting"
  },
  "farewell": "Goodbye"
}
`,
  },
  {
    configKey: 'xliff',
    symmetric: false,
    skeleton: `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="de" datatype="plaintext" original="app">
    <body>
      <trans-unit id="greeting">
        <source>Hello</source>
        <note>A greeting</note>
      </trans-unit>
      <trans-unit id="terms">
        <source>Terms &amp; Conditions</source>
      </trans-unit>
    </body>
  </file>
</xliff>
`,
  },
  {
    configKey: 'toml',
    symmetric: true,
    skeleton: `greeting = "Hello"

[nav]
home = "Home"
title = "Quoted \\"value\\""
`,
  },
  {
    configKey: 'properties',
    symmetric: true,
    skeleton: `# Top comment
greeting=Hello
nav.home=Home
nav.title=With spaces
`,
  },
  {
    configKey: 'xcstrings',
    symmetric: true,
    sourceLocale: 'en',
    targetLocale: 'de',
    skeleton: `${JSON.stringify(
      {
        sourceLanguage: 'en',
        version: '1.0',
        strings: {
          greeting: {
            comment: 'Welcome screen title',
            localizations: {
              en: { stringUnit: { state: 'translated', value: 'Hello' } },
            },
          },
          farewell: {
            localizations: {
              en: { stringUnit: { state: 'translated', value: 'Goodbye' } },
            },
          },
        },
      },
      null,
      2
    )}\n`,
  },
  {
    configKey: 'laravel_php',
    symmetric: true,
    skeleton: `<?php

return [
    'greeting' => 'Hello',
    'nav' => [
        'home' => 'Home',
    ],
];
`,
  },
];

const registry = createDefaultRegistrySync();

function valueMap(
  parser: FormatParser,
  content: string,
  locale?: string
): Map<string, string> {
  return new Map(parser.extract(content, locale).map((e) => [e.key, e.value]));
}

describe('format parser round-trip properties', () => {
  it('covers every registered format', () => {
    const covered = new Set(CASES.map((c) => c.configKey));
    expect([...covered].sort()).toEqual([...registry.getFormatKeys()].sort());
  });

  describe.each(CASES.map((c) => [c.configKey, c] as const))(
    '%s',
    (_key, fmt) => {
      const parser = registry.getParserByFormatKey(fmt.configKey)!;
      const baseEntries = parser.extract(fmt.skeleton, fmt.sourceLocale);

      it('skeleton extracts at least two entries', () => {
        expect(baseEntries.length).toBeGreaterThanOrEqual(2);
      });

      if (fmt.symmetric) {
        it('L1+L2+L3: generated translations survive reconstruct/extract and reach a fixed point', () => {
          fc.assert(
            fc.property(translationsArb(baseEntries.length), (translations) => {
              const entries: TranslatedEntry[] = baseEntries.map((e, i) => ({
                ...e,
                translation: translations[i]!,
              }));

              // L1: one write, values must survive intact
              const out = parser.reconstruct(
                fmt.skeleton,
                entries,
                fmt.targetLocale
              );
              const extractLocale = fmt.targetLocale ?? fmt.sourceLocale;
              const got = valueMap(parser, out, extractLocale);
              for (let i = 0; i < baseEntries.length; i++) {
                const key = baseEntries[i]!.key;
                expect(got.get(key)).toBe(translations[i]!);
              }

              // L2: re-applying the same translations must not change the file
              const out2 = parser.reconstruct(out, entries, fmt.targetLocale);
              expect(out2).toBe(out);

              // L3: identity cycle on the written file is a fixed point
              const identityEntries: TranslatedEntry[] = parser
                .extract(out, extractLocale)
                .map((e) => ({ ...e, translation: e.value }));
              const out3 = parser.reconstruct(
                out,
                identityEntries,
                fmt.targetLocale
              );
              expect(valueMap(parser, out3, extractLocale)).toEqual(got);
            }),
            fcParams()
          );
        });
      } else {
        it('L2+L4: reconstruct is idempotent and never mutates source values', () => {
          const sourceValues = valueMap(parser, fmt.skeleton, fmt.sourceLocale);
          fc.assert(
            fc.property(translationsArb(baseEntries.length), (translations) => {
              const entries: TranslatedEntry[] = baseEntries.map((e, i) => ({
                ...e,
                translation: translations[i]!,
              }));

              const out = parser.reconstruct(fmt.skeleton, entries);

              // L4: extract still returns the untouched source strings
              expect(valueMap(parser, out)).toEqual(sourceValues);

              // L2: applying the same translations again must be a no-op
              const out2 = parser.reconstruct(out, entries);
              expect(out2).toBe(out);
            }),
            fcParams()
          );
        });
      }
    }
  );
});

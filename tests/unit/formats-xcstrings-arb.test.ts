/**
 * Tests for two localized-resource defects:
 *  - Xcode String Catalogs: reconstruct replaced a locale's entire
 *    localization object, destroying pre-existing plural `variations`.
 *  - ARB: a UTF-8 BOM made JSON.parse throw, so a BOM-prefixed Flutter
 *    resource file could not be read at all.
 */

import { XcstringsFormatParser } from '../../src/formats/xcstrings';
import { ArbFormatParser } from '../../src/formats/arb';

describe('Xcode String Catalog localizations', () => {
  const withVariations = JSON.stringify(
    {
      sourceLanguage: 'en',
      version: '1.0',
      strings: {
        item_count: {
          localizations: {
            en: { stringUnit: { state: 'translated', value: '%lld items' } },
            de: {
              variations: {
                plural: {
                  one: { stringUnit: { state: 'translated', value: '%lld Artikel' } },
                  other: { stringUnit: { state: 'translated', value: '%lld Artikel' } },
                },
              },
            },
          },
        },
        greeting: {
          localizations: { en: { stringUnit: { state: 'translated', value: 'Hello' } } },
        },
      },
    },
    null,
    2,
  );

  it('should not destroy plural variations of the key being translated', () => {
    const parser = new XcstringsFormatParser();

    // item_count already has German plural variations; translating it must not
    // flatten them away into a single stringUnit.
    const out = parser.reconstruct(
      withVariations,
      [{ key: 'item_count', value: '%lld items', translation: '%lld Artikel' }],
      'de',
    );

    const parsed = JSON.parse(out) as {
      strings: Record<string, { localizations?: Record<string, Record<string, unknown>> }>;
    };
    expect(parsed.strings['item_count']?.localizations?.['de']?.['variations']).toBeDefined();
  });

  it('should not destroy variations of an untranslated key', () => {
    const parser = new XcstringsFormatParser();

    const out = parser.reconstruct(
      withVariations,
      [{ key: 'greeting', value: 'Hello', translation: 'Hallo' }],
      'de',
    );

    const parsed = JSON.parse(out) as {
      strings: Record<string, { localizations?: Record<string, Record<string, unknown>> }>;
    };
    expect(parsed.strings['item_count']?.localizations?.['de']?.['variations']).toBeDefined();
  });

  it('should still write the translation for the requested key', () => {
    const parser = new XcstringsFormatParser();

    const out = parser.reconstruct(
      withVariations,
      [{ key: 'greeting', value: 'Hello', translation: 'Hallo' }],
      'de',
    );

    const parsed = JSON.parse(out) as {
      strings: Record<
        string,
        { localizations?: Record<string, { stringUnit?: { value?: string } }> }
      >;
    };
    expect(parsed.strings['greeting']?.localizations?.['de']?.stringUnit?.value).toBe('Hallo');
  });

  it('should leave other locales untouched', () => {
    const parser = new XcstringsFormatParser();

    const out = parser.reconstruct(
      withVariations,
      [{ key: 'greeting', value: 'Hello', translation: 'Hallo' }],
      'de',
    );

    const parsed = JSON.parse(out) as {
      strings: Record<
        string,
        { localizations?: Record<string, { stringUnit?: { value?: string } }> }
      >;
    };
    expect(parsed.strings['greeting']?.localizations?.['en']?.stringUnit?.value).toBe('Hello');
  });
});

describe('ARB byte-order mark', () => {
  const body = JSON.stringify({ greeting: 'Hello', '@greeting': { description: 'A greeting' } }, null, 2);

  it('should extract from a BOM-prefixed file', () => {
    const entries = new ArbFormatParser().extract('﻿' + body);

    expect(entries.map((e) => e.key)).toEqual(['greeting']);
    expect(entries[0]?.value).toBe('Hello');
  });

  it('should reconstruct a BOM-prefixed file', () => {
    const parser = new ArbFormatParser();
    const withBom = '﻿' + body;

    const out = parser.reconstruct(withBom, [
      { key: 'greeting', value: 'Hello', translation: 'Hallo' },
    ]);

    expect(parser.extract(out)[0]?.value).toBe('Hallo');
  });

  it('should extract identically with and without a BOM', () => {
    const parser = new ArbFormatParser();

    const withoutBom = parser.extract(body).map((e) => `${e.key}=${e.value}`);
    const withBom = parser.extract('﻿' + body).map((e) => `${e.key}=${e.value}`);

    expect(withBom).toEqual(withoutBom);
  });
});

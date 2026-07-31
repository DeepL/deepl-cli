/**
 * Property tests for the translation validator
 * (src/sync/translation-validator.ts).
 *
 * The validator inspects machine-translation output, so it must be total:
 *   V1  never throws, on any (source, translation) pair
 *   V2  a translation identical in structure to its source is never an error
 *       (identity can warn — e.g. "untranslated" — but a text cannot
 *       structurally mismatch itself)
 *   V3  dropping a placeholder from the translation is always flagged as a
 *       placeholders error
 *   V4  a placeholder added to the translation is always flagged
 */
import fc from 'fast-check';
import { validateTranslation } from '../../src/sync/translation-validator';
import { fcParams, translationArb } from './arbitraries';

const PLACEHOLDERS = [
  '{name}',
  '{{count}}',
  '${var}',
  '%1$s',
  '%s',
  '%@',
  '{0}',
];

const proseArb = fc
  .string({ unit: 'grapheme', minLength: 1, maxLength: 15 })
  // Keep prose free of placeholder/ICU syntax so the generated placeholders
  // are the only ones in play.
  .filter((s) => !/[{}%$]/.test(s));

/** Prose interleaved with a known set of placeholders. */
const sourceWithPlaceholdersArb = fc
  .tuple(
    fc.array(fc.constantFrom(...PLACEHOLDERS), { minLength: 1, maxLength: 4 }),
    fc.array(proseArb, { minLength: 2, maxLength: 5 })
  )
  .map(([placeholders, prose]) => {
    const parts: string[] = [prose[0]!];
    placeholders.forEach((ph, i) => {
      parts.push(ph, prose[(i + 1) % prose.length]!);
    });
    return { text: parts.join(' '), placeholders };
  });

describe('translation validator properties', () => {
  it('V1: never throws on arbitrary input pairs', () => {
    fc.assert(
      fc.property(translationArb, translationArb, (source, translation) => {
        expect(() =>
          validateTranslation('k', source, translation)
        ).not.toThrow();
      }),
      fcParams()
    );
  });

  it('V2: identity is never a structural error', () => {
    fc.assert(
      fc.property(translationArb, (text) => {
        const result = validateTranslation('k', text, text);
        expect(result.severity).not.toBe('error');
      }),
      fcParams()
    );
  });

  it('V3: a dropped placeholder is always an error', () => {
    fc.assert(
      fc.property(
        sourceWithPlaceholdersArb,
        fc.nat(),
        ({ text, placeholders }, pick) => {
          const dropped = placeholders[pick % placeholders.length]!;
          const translation = text.replace(dropped, '');

          const result = validateTranslation('k', text, translation);

          expect(result.severity).toBe('error');
          expect(
            result.issues.some(
              (i) => i.check === 'placeholders' && i.severity === 'error'
            )
          ).toBe(true);
        }
      ),
      fcParams()
    );
  });

  it('V4: an added placeholder is always flagged', () => {
    fc.assert(
      fc.property(
        sourceWithPlaceholdersArb,
        fc.constantFrom(...PLACEHOLDERS),
        ({ text }, extra) => {
          const translation = `${text} ${extra}`;

          const result = validateTranslation('k', text, translation);

          expect(result.issues.some((i) => i.check === 'placeholders')).toBe(
            true
          );
        }
      ),
      fcParams()
    );
  });
});

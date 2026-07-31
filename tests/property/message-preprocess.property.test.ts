/**
 * Property tests for the sync message-preprocess pipeline
 * (src/sync/sync-message-preprocess.ts).
 *
 * The pipeline's stated invariant is positional: every stage preserves array
 * length and index assignments, so pluralSlots.textIndex and
 * icuMappings.textIndex remain valid indices into the results array.
 *
 *   P1  expandPlurals keeps the original texts as an unchanged prefix
 *   P2  every plural slot points past the prefix, at its own plural value
 *   P3  detectIcu preserves length and rewrites exactly the ICU positions
 *   P4  writebackPlurals writes each result to its slot's plural form and
 *       leaves slots without a result untouched
 */
import fc from 'fast-check';
import {
  expandPlurals,
  detectIcu,
  writebackPlurals,
} from '../../src/sync/sync-message-preprocess';
import type { SyncDiff } from '../../src/sync/types';
import type { TranslationResult } from '../../src/api/translation-client';
import { fcParams } from './arbitraries';

const valueArb = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 20 });

const QUANTITIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

const diffArb: fc.Arbitrary<SyncDiff> = fc
  .record({
    key: fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 10 }),
    value: valueArb,
    plurals: fc.option(
      fc
        .uniqueArray(fc.constantFrom(...QUANTITIES), {
          minLength: 1,
          maxLength: 4,
        })
        .chain((quantities) =>
          fc.tuple(
            fc.constant(quantities),
            fc.array(valueArb, {
              minLength: quantities.length,
              maxLength: quantities.length,
            })
          )
        )
        .map(([quantities, values]) =>
          quantities.map((quantity, i) => ({ quantity, value: values[i]! }))
        ),
      { nil: undefined }
    ),
    msgidPlural: fc.option(valueArb, { nil: undefined }),
  })
  .map(({ key, value, plurals, msgidPlural }) => {
    const diff: SyncDiff = { key, status: 'new', value };
    if (plurals || msgidPlural) {
      diff.metadata = {};
      if (plurals) diff.metadata['plurals'] = plurals;
      if (msgidPlural) diff.metadata['msgid_plural'] = msgidPlural;
    }
    return diff;
  });

const diffsArb = fc.array(diffArb, { minLength: 0, maxLength: 12 });

function baseTexts(diffs: SyncDiff[]): string[] {
  return diffs.map((d) => d.value ?? '');
}

describe('sync message-preprocess pipeline positions', () => {
  it('P1+P2: expandPlurals appends plural values without disturbing the prefix', () => {
    fc.assert(
      fc.property(diffsArb, (diffs) => {
        const texts = baseTexts(diffs);
        const { extendedTexts, pluralSlots } = expandPlurals(texts, diffs);

        // P1
        expect(extendedTexts.slice(0, texts.length)).toEqual(texts);

        // P2
        for (const slot of pluralSlots) {
          expect(slot.textIndex).toBeGreaterThanOrEqual(texts.length);
          expect(slot.textIndex).toBeLessThan(extendedTexts.length);
          const diff = diffs[slot.diffIndex]!;
          if (slot.format === 'android') {
            const plurals = diff.metadata?.['plurals'] as Array<{
              quantity: string;
              value: string;
            }>;
            const item = plurals.find((p) => p.quantity === slot.slotKey)!;
            expect(extendedTexts[slot.textIndex]).toBe(item.value);
          } else {
            expect(extendedTexts[slot.textIndex]).toBe(
              diff.metadata?.['msgid_plural']
            );
          }
        }

        // Every appended text is claimed by exactly one slot.
        const claimed = pluralSlots
          .map((s) => s.textIndex)
          .sort((a, b) => a - b);
        expect(new Set(claimed).size).toBe(claimed.length);
        expect(claimed.length).toBe(extendedTexts.length - texts.length);
      }),
      fcParams()
    );
  });

  it('P3: detectIcu preserves length and rewrites exactly the ICU positions', () => {
    const icuText = 'You have {count, plural, one {# item} other {# items}}.';
    fc.assert(
      fc.property(
        fc.array(fc.oneof(valueArb, fc.constant(icuText)), { maxLength: 15 }),
        (texts) => {
          const { extendedTexts, icuMappings } = detectIcu(texts);

          expect(extendedTexts.length).toBe(texts.length);
          const icuIndices = new Set(icuMappings.map((m) => m.textIndex));
          for (let i = 0; i < texts.length; i++) {
            if (icuIndices.has(i)) {
              expect(extendedTexts[i]).toBe(`__ICU_PLACEHOLDER_${i}__`);
            } else {
              expect(extendedTexts[i]).toBe(texts[i]);
            }
          }
        }
      ),
      fcParams()
    );
  });

  it('P4: writebackPlurals writes each available result to its slot and skips the rest', () => {
    fc.assert(
      fc.property(
        diffsArb,
        fc.infiniteStream(fc.boolean()),
        (diffs, haveResult) => {
          const texts = baseTexts(diffs);
          const { extendedTexts, pluralSlots } = expandPlurals(texts, diffs);

          const results: (TranslationResult | null)[] = extendedTexts.map(
            () => null
          );
          const iterator = haveResult[Symbol.iterator]();
          const expectTranslated = new Set<number>();
          for (const slot of pluralSlots) {
            if (iterator.next().value) {
              results[slot.textIndex] = {
                text: `T:${extendedTexts[slot.textIndex]!}`,
              };
              expectTranslated.add(slot.textIndex);
            }
          }

          writebackPlurals(results, pluralSlots, diffs);

          for (const slot of pluralSlots) {
            const diff = diffs[slot.diffIndex]!;
            const original = extendedTexts[slot.textIndex]!;
            if (slot.format === 'android') {
              const plurals = diff.metadata?.['plurals'] as Array<{
                quantity: string;
                value: string;
              }>;
              const item = plurals.find((p) => p.quantity === slot.slotKey)!;
              expect(item.value).toBe(
                expectTranslated.has(slot.textIndex)
                  ? `T:${original}`
                  : original
              );
            } else if (expectTranslated.has(slot.textIndex)) {
              const forms = diff.metadata?.['plural_forms'] as Record<
                string,
                string
              >;
              expect(forms['msgstr[1]']).toBe(`T:${original}`);
            } else {
              expect(diff.metadata?.['plural_forms']).toBeUndefined();
            }
          }
        }
      ),
      fcParams()
    );
  });
});

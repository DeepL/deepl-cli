/**
 * Property tests for TranslationService.translateBatch chunking and
 * index mapping (src/services/translation.ts).
 *
 * Laws, with a fake client and the cache disabled:
 *   B1  no client call carries more than TRANSLATE_BATCH_SIZE texts
 *   B2  the texts sent across all calls are exactly the unique non-empty
 *       inputs, each sent once (dedup)
 *   B3  every non-empty input position gets its own text's translation,
 *       duplicates included (index mapping)
 *   B4  the number of client calls is ceil(unique / TRANSLATE_BATCH_SIZE)
 */
import fc from 'fast-check';
import {
  TranslationService,
  TRANSLATE_BATCH_SIZE,
} from '../../src/services/translation';
import type { DeepLClient } from '../../src/api/deepl-client';
import type { ConfigService } from '../../src/storage/config';
import { fcParams } from './arbitraries';

interface RecordedCall {
  texts: string[];
}

function makeFakes(): {
  client: DeepLClient;
  config: ConfigService;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client = {
    translateBatch: (texts: string[]) => {
      calls.push({ texts: [...texts] });
      return Promise.resolve(texts.map((t) => ({ text: `X:${t}` })));
    },
  } as unknown as DeepLClient;
  const config = {
    get: () => ({ defaults: {} }),
    getValue: () => false, // cache.enabled -> false
  } as unknown as ConfigService;
  return { client, config, calls };
}

/**
 * Input positions index into a small pool so duplicates are common — the
 * index-mapping law is only interesting when the same text appears at
 * several positions.
 */
const textsArb = fc
  .tuple(
    fc.array(fc.string({ unit: 'grapheme', minLength: 1, maxLength: 20 }), {
      minLength: 1,
      maxLength: 130,
    }),
    fc.array(fc.nat(129), { minLength: 0, maxLength: 200 })
  )
  .map(([pool, picks]) => {
    // Suffix with the pool index so pool entries are pairwise distinct.
    const distinct = pool.map((t, i) => `${t}#${i}`);
    return picks.map((p) => distinct[p % distinct.length]!);
  });

describe('translateBatch chunking and index mapping', () => {
  it('B1-B4: chunk size, dedup, index mapping, call count', () => {
    return fc.assert(
      fc.asyncProperty(textsArb, async (texts) => {
        const { client, config, calls } = makeFakes();
        const service = new TranslationService(client, config);

        const results = await service.translateBatch(texts, {
          targetLang: 'de',
        });

        // B1
        for (const call of calls) {
          expect(call.texts.length).toBeLessThanOrEqual(TRANSLATE_BATCH_SIZE);
        }

        // B2
        const sent = calls.flatMap((c) => c.texts);
        const unique = [...new Set(texts.filter((t) => t))];
        expect(sent.length).toBe(unique.length);
        expect(new Set(sent)).toEqual(new Set(unique));

        // B3
        expect(results.length).toBe(texts.length);
        for (let i = 0; i < texts.length; i++) {
          if (texts[i]) {
            expect(results[i]?.text).toBe(`X:${texts[i]!}`);
          }
        }

        // B4
        const expectedCalls =
          unique.length === 0
            ? 0
            : Math.ceil(unique.length / TRANSLATE_BATCH_SIZE);
        expect(calls.length).toBe(expectedCalls);
      }),
      fcParams()
    );
  });

  it('empty input makes no client calls and returns an empty array', async () => {
    const { client, config, calls } = makeFakes();
    const service = new TranslationService(client, config);

    const results = await service.translateBatch([], { targetLang: 'de' });

    expect(results).toEqual([]);
    expect(calls).toEqual([]);
  });
});

/**
 * Tests that concurrency is genuinely bounded.
 *
 * These deliberately do NOT mock p-limit. A manual mock under
 * tests/__mocks__/p-limit.ts is auto-applied repo-wide, which would leave
 * real concurrency limits unexercised everywhere. The first test here fails
 * if such a mock is ever introduced.
 */

import pLimit from 'p-limit';
import fg from 'fast-glob';
import { mapWithConcurrency } from '../../src/utils/concurrency';

/** Runs `total` tasks through `schedule` and reports the peak overlap. */
async function measurePeakConcurrency(
  total: number,
  schedule: (task: () => Promise<void>) => Promise<unknown>,
): Promise<number> {
  let active = 0;
  let peak = 0;
  const task = async (): Promise<void> => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
  };
  await Promise.all(Array.from({ length: total }, () => schedule(task)));
  return peak;
}

describe('concurrency limiting', () => {
  describe('p-limit is the real implementation', () => {
    it('should return a callable limiter', () => {
      const limit = pLimit(2);

      expect(typeof limit).toBe('function');
    });

    it('should reject a non-positive concurrency instead of silently degrading', () => {
      expect(() => pLimit(0)).toThrow();
      expect(() => pLimit(-1)).toThrow();
      expect(() => pLimit(NaN)).toThrow();
    });

    it.each([1, 2, 3])('should never exceed a concurrency of %i', async (concurrency) => {
      const limit = pLimit(concurrency);

      const peak = await measurePeakConcurrency(9, (task) => limit(task));

      expect(peak).toBeLessThanOrEqual(concurrency);
    });
  });

  describe('fast-glob is the real implementation', () => {
    // Same exposure for fast-glob: an auto-applied manual mock resolving to
    // undefined would leave every glob-walking path unexercised.
    it('should return matching paths rather than undefined', async () => {
      const matches = await fg('tests/unit/concurrency-limiting.test.ts');

      expect(Array.isArray(matches)).toBe(true);
      expect(matches).toContain('tests/unit/concurrency-limiting.test.ts');
    });
  });

  describe('mapWithConcurrency', () => {
    it('should process every item', async () => {
      const items = [1, 2, 3, 4, 5];

      const result = await mapWithConcurrency(items, async (n) => n * 2, 2);

      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it('should never exceed the requested concurrency', async () => {
      let active = 0;
      let peak = 0;

      await mapWithConcurrency(
        Array.from({ length: 9 }, (_unused, i) => i),
        async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active--;
        },
        3,
      );

      expect(peak).toBeLessThanOrEqual(3);
    });

    // Array.from({length: Math.min(NaN, n)}) is empty, so an invalid
    // concurrency spawned zero workers and mapWithConcurrency returned []
    // having done nothing and thrown nothing — `deepl sync --concurrency abc`
    // printed "Sync complete" and translated no files.
    it.each([
      ['zero', 0],
      ['negative', -3],
      ['NaN', NaN],
      ['fractional', 0.5],
    ])('should still process every item when concurrency is %s', async (_label, concurrency) => {
      const items = [1, 2, 3, 4];
      let processed = 0;

      const result = await mapWithConcurrency(items, async (n) => {
        processed++;
        return n * 2;
      }, concurrency);

      expect(processed).toBe(items.length);
      expect(result).toEqual([2, 4, 6, 8]);
    });

    it('should treat a huge concurrency as bounded by the item count', async () => {
      const result = await mapWithConcurrency([1, 2], async (n) => n, Number.MAX_SAFE_INTEGER);

      expect(result).toEqual([1, 2]);
    });

    it('should propagate a worker error', async () => {
      const boom = new Error('worker failed');

      await expect(
        mapWithConcurrency([1, 2, 3], async () => {
          throw boom;
        }, 2),
      ).rejects.toThrow('worker failed');
    });
  });
});

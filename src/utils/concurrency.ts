export const MULTI_TARGET_CONCURRENCY = 5;
export const PUSH_CONCURRENCY = 10;

export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  let aborted = false;
  async function worker() {
    while (index < items.length && !aborted) {
      const i = index++;
      try {
        results[i] = await fn(items[i] as T);
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  }
  // Normalize before sizing the worker pool: Math.min(NaN, n) is NaN and
  // Array.from({length: NaN}) is empty, so an unnormalized invalid
  // concurrency would spawn zero workers and silently return [].
  const requested = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const workerCount = Math.min(Math.max(1, requested), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

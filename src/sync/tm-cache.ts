/**
 * Narrow cache surface consumed by `resolveTranslationMemoryId`. Kept
 * structural so long-lived callers (e.g. watch mode) can supply a TTL-aware
 * implementation that invalidates stale TM IDs across iterations, while a
 * plain `Map<string, string>` satisfies it for one-shot callers (translate
 * text/file handlers).
 */
export interface TmCacheLike {
  has(key: string): boolean;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

/**
 * TTL-scoped wrapper around `Map<string, string>`. Entries older than
 * `ttlMs` are treated as absent on `.has()` / `.get()` and lazily evicted.
 * Used by `SyncService.tmCache` so a rotated or deleted TM is not served
 * from a stale cache for the entire lifetime of a `deepl sync --watch`
 * process.
 */
export class TmCache implements TmCacheLike {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number = TmCache.DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  static readonly DEFAULT_TTL_MS = 5 * 60_000;

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: string): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}

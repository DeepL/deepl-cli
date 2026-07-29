/**
 * Lazy cache-service loader for the CLI entry point.
 * The cache backend (node:sqlite) can fail to load on runtimes that
 * predate it (Node < 22.5.0). Commands that merely
 * benefit from a cache must degrade to running without one instead of
 * crashing, with a single warning per process.
 */

import type { CacheService, CacheServiceOptions } from '../storage/cache.js';
import type { ConfigService } from '../storage/config.js';
import { Logger } from '../utils/logger.js';
import { errorMessage } from '../utils/error-message.js';
import { isNativeModuleLoadError } from '../utils/native-module-error.js';

type CacheModule = Pick<typeof import('../storage/cache.js'), 'CacheService'>;

/**
 * Derive cache-service options from persisted config. Reading `cache.enabled`
 * here is what keeps the service's in-memory flag from diverging from config:
 * `cache stats` and the translation path then agree on the same value.
 */
export function resolveCacheOptions(config: ConfigService, dbPath: string): CacheServiceOptions {
  const ttlSeconds = config.getValue<number>('cache.ttl');
  return {
    dbPath,
    // Config TTL is in seconds, CacheService expects milliseconds
    ttl: ttlSeconds !== undefined ? ttlSeconds * 1000 : undefined,
    maxSize: config.getValue<number>('cache.maxSize'),
    enabled: config.getValue<boolean>('cache.enabled'),
  };
}

export function createCacheServiceGetter(
  getOptions: () => CacheServiceOptions,
  importCacheModule: () => Promise<CacheModule> = () => import('../storage/cache.js'),
): () => Promise<CacheService | undefined> {
  let instance: CacheService | undefined;
  let unavailable = false;

  return async (): Promise<CacheService | undefined> => {
    if (instance || unavailable) {
      return instance;
    }
    try {
      const { CacheService: CacheSvc } = await importCacheModule();
      instance = CacheSvc.getInstance(getOptions());
    } catch (error) {
      unavailable = true;
      const detail = errorMessage(error);
      if (isNativeModuleLoadError(error)) {
        Logger.warn(
          `Translation cache backend failed to load (${detail}). ` +
          'Your cache database has not been modified. Caching is disabled for this run. ' +
          'Reinstall the CLI, or run it with the Node.js version it was installed with, to restore caching.',
        );
      } else {
        Logger.warn(
          `Translation cache is unavailable (${detail}). Caching is disabled for this run.`,
        );
      }
    }
    return instance;
  };
}

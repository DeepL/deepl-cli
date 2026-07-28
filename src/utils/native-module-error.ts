/**
 * Classifies errors thrown while loading the cache's storage backend.
 * These indicate the module itself cannot load (ABI mismatch after a
 * Node upgrade, missing binding, runtime without node:sqlite) — the
 * database file on disk is healthy and must not be touched.
 */

const NATIVE_LOAD_ERROR_CODES = new Set([
  'ERR_DLOPEN_FAILED',
  'ERR_UNKNOWN_BUILTIN_MODULE',
  'MODULE_NOT_FOUND',
  'ERR_MODULE_NOT_FOUND',
]);

export function isNativeModuleLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code && NATIVE_LOAD_ERROR_CODES.has(code)) {
    return true;
  }
  return error.message.includes('NODE_MODULE_VERSION');
}

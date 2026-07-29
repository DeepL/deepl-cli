import * as fs from 'fs';

/**
 * In-flight `.tmp` sibling files created by atomicWriteFile / atomicWriteFileSync.
 * A SIGINT / SIGTERM handler is registered on first use and detached when the
 * set drains, so `deepl sync` (and every other caller) leaves no orphans after
 * a crash between the write and the rename.
 */
const inFlightTmpPaths = new Set<string>();
let signalHandlersAttached = false;

function unlinkIgnoringMissing(tmpPath: string): void {
  try {
    fs.unlinkSync(tmpPath);
  } catch {
    /* ignore — file may have been renamed or already removed */
  }
}

function cleanupAllTmp(): void {
  if (inFlightTmpPaths.size === 0) return;
  for (const tmpPath of inFlightTmpPaths) {
    unlinkIgnoringMissing(tmpPath);
  }
  inFlightTmpPaths.clear();
}

function onSignalCleanup(): void {
  cleanupAllTmp();
  // Do not call process.exit here — other signal handlers (watch mode
  // shutdown, sync-process-lock release) still need to run.
}

function ensureSignalHandlers(): void {
  if (signalHandlersAttached) return;
  process.on('SIGINT', onSignalCleanup);
  process.on('SIGTERM', onSignalCleanup);
  signalHandlersAttached = true;
}

function maybeDetachSignalHandlers(): void {
  if (!signalHandlersAttached) return;
  if (inFlightTmpPaths.size > 0) return;
  process.off('SIGINT', onSignalCleanup);
  process.off('SIGTERM', onSignalCleanup);
  signalHandlersAttached = false;
}

function registerTmp(tmpPath: string): void {
  inFlightTmpPaths.add(tmpPath);
  ensureSignalHandlers();
}

function unregisterTmp(tmpPath: string): void {
  inFlightTmpPaths.delete(tmpPath);
  maybeDetachSignalHandlers();
}

/**
 * Public cleanup hook. Callers that own their own SIGINT handler (e.g. watch
 * mode) can invoke this defensively on shutdown to guarantee no orphan `.tmp`
 * sibling outlives the process.
 */
export function __cleanupInFlightTmpFiles(): void {
  cleanupAllTmp();
  maybeDetachSignalHandlers();
}

/**
 * Test-only introspection.
 */
export function __getInFlightTmpCount(): number {
  return inFlightTmpPaths.size;
}

/**
 * Write a file atomically by writing to a temp file then renaming.
 * Prevents partial writes from corrupting output files. An existing
 * target's mode is preserved across the rename (chmod is not subject to
 * the umask, unlike the mode applied at file creation).
 */
export async function atomicWriteFile(
  filePath: string,
  content: string | Buffer,
  encoding?: BufferEncoding,
): Promise<void> {
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Math.random().toString(36).slice(2, 8);
  let existingMode: number | undefined;
  try {
    existingMode = (await fs.promises.stat(filePath)).mode & 0o7777;
  } catch {
    /* target does not exist — keep default mode for new files */
  }
  registerTmp(tmpPath);
  try {
    await fs.promises.writeFile(tmpPath, content, encoding ? { encoding } : undefined);
    if (existingMode !== undefined) {
      await fs.promises.chmod(tmpPath, existingMode);
    }
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    try { await fs.promises.unlink(tmpPath); } catch { /* ignore cleanup errors */ }
    throw error;
  } finally {
    unregisterTmp(tmpPath);
  }
}

/**
 * Synchronous variant of atomicWriteFile.
 */
export function atomicWriteFileSync(
  filePath: string,
  content: string | Buffer,
  encoding?: BufferEncoding,
): void {
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Math.random().toString(36).slice(2, 8);
  let existingMode: number | undefined;
  try {
    existingMode = fs.statSync(filePath).mode & 0o7777;
  } catch {
    /* target does not exist — keep default mode for new files */
  }
  registerTmp(tmpPath);
  try {
    fs.writeFileSync(tmpPath, content, encoding ? { encoding } : undefined);
    if (existingMode !== undefined) {
      fs.chmodSync(tmpPath, existingMode);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    throw error;
  } finally {
    unregisterTmp(tmpPath);
  }
}

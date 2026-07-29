import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger.js';

/**
 * Suffix appended to target files when the sync engine writes a backup.
 * Distinctive on purpose: the startup sweep only ever deletes files with
 * this exact suffix, so user-owned `*.bak` files are never touched.
 */
export const BACKUP_SUFFIX = '.deepl.bak';

/**
 * Default age (seconds) above which a leftover backup sibling is considered
 * orphaned and safe to sweep at sync startup. Matches the watch-mode
 * precedent (5 minutes) and is overridable via `sync.bak_sweep_max_age_seconds`
 * in `.deepl-sync.yaml`.
 */
export const DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS = 300;

let _warnedNoScope = false;

/**
 * Derive the set of concrete directory roots to sweep from bucket `include`
 * globs. Returns unique absolute paths that are the longest literal prefixes
 * of each glob (i.e. everything before the first `*`, `?`, `{`, or `[`).
 * Falls back to `projectRoot` for globs with no literal prefix.
 */
export function bucketSweepRoots(
  projectRoot: string,
  buckets: Record<string, { include: string[] }>,
): string[] {
  const roots = new Set<string>();
  const rootPrefix = path.resolve(projectRoot) + path.sep;
  for (const bucket of Object.values(buckets)) {
    for (const glob of bucket.include) {
      const specialIdx = glob.search(/[*?{[]/);
      const literal = specialIdx === -1 ? glob : glob.slice(0, specialIdx);
      const dir = literal.endsWith('/') ? literal.slice(0, -1) : path.dirname(literal);
      const abs = path.resolve(projectRoot, dir);
      // Defence in depth. validateSyncConfig rejects traversing includes, but
      // this sweep deletes and re-creates files, so it must never accept a
      // root outside the project even if it is reached another way.
      if (abs !== path.resolve(projectRoot) && !(abs + path.sep).startsWith(rootPrefix)) {
        Logger.warn(`Ignoring stale-backup sweep root outside the project: ${abs}`);
        continue;
      }
      roots.add(abs);
    }
  }
  return Array.from(roots);
}

/**
 * Walk `projectRoot` breadth-first and remove `.deepl.bak` files whose mtime
 * is older than `maxAgeMs`. When the sibling (the backup's target) exists but
 * is zero-length, restore it from the backup before unlinking. A missing
 * sibling is never recreated, and files with any other suffix (including
 * plain `.bak`) are left untouched.
 *
 * When `buckets` is provided the sweep is scoped to the directories implied by
 * each bucket's `include` globs instead of the entire project tree, keeping
 * cold-start cost proportional to bucket size rather than project size.
 *
 * Symlink loops are avoided by tracking each visited realpath. `node_modules`
 * and `.git` are skipped.
 */
export async function sweepStaleBackups(
  projectRoot: string,
  maxAgeMs: number,
  buckets?: Record<string, { include: string[] }>,
): Promise<void> {
  const threshold = Date.now() - maxAgeMs;
  const visited = new Set<string>();
  let roots: string[];
  if (buckets && Object.keys(buckets).length > 0) {
    roots = bucketSweepRoots(projectRoot, buckets);
  } else {
    if (!_warnedNoScope) {
      Logger.warn('sweepStaleBackups: no bucket config provided, falling back to full project tree sweep.');
      _warnedNoScope = true;
    }
    roots = [projectRoot];
  }
  for (const root of roots) {
    await sweepDir(root, visited, threshold);
  }
}

async function sweepDir(dir: string, visited: Set<string>, threshold: number): Promise<void> {
  const real = (() => {
    try { return fs.realpathSync(dir); } catch { return dir; }
  })();
  if (visited.has(real)) return;
  visited.add(real);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      await sweepDir(full, visited, threshold);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(BACKUP_SUFFIX)) continue;
    try {
      const stat = await fs.promises.stat(full);
      if (stat.mtimeMs >= threshold) continue;
      const sibling = full.slice(0, -BACKUP_SUFFIX.length);
      let siblingEmpty = false;
      try {
        const sStat = await fs.promises.stat(sibling);
        siblingEmpty = sStat.size === 0;
      } catch {
        siblingEmpty = false;
      }
      if (siblingEmpty) {
        try {
          await fs.promises.copyFile(full, sibling);
          Logger.warn(`Restored ${sibling} from stale backup ${full}.`);
        } catch {
          /* fall through to unlink */
        }
      }
      try {
        await fs.promises.unlink(full);
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Resolve the configured sweep age (seconds) into milliseconds, applying the
 * documented default. Callers that accept a user-configurable override should
 * route through this so the guard against non-positive values stays in one
 * place.
 */
export function resolveBakSweepAgeMs(configuredSeconds: number | undefined): number {
  if (configuredSeconds === undefined || configuredSeconds <= 0) {
    return DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS * 1000;
  }
  return configuredSeconds * 1000;
}

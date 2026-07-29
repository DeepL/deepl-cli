import * as fs from 'fs';
import * as crypto from 'crypto';
import { atomicWriteFile } from '../utils/atomic-write.js';
import { Logger } from '../utils/logger.js';
import type { SyncLockFile, SyncLockEntry } from './types.js';
import { LOCK_FILE_VERSION, LOCK_FILE_COMMENT } from './types.js';

function filesystemSafeTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+/, '');
}

function backupLockFile(lockFilePath: string, raw: string, tag: string): string | null {
  const backupPath = `${lockFilePath}.bak-${tag}-${filesystemSafeTimestamp()}`;
  try {
    fs.writeFileSync(backupPath, raw, 'utf-8');
    return backupPath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.warn(`Failed to write lock file backup to ${backupPath}: ${message}`);
    return null;
  }
}

export function computeSourceHash(text: string, metadata?: Record<string, unknown>): string {
  let input = text;
  if (metadata) {
    const plurals = metadata['plurals'] ?? metadata['msgid_plural'] ?? metadata['plural_forms'];
    if (plurals) {
      input += '\0' + JSON.stringify(plurals);
    }
  }
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex').substring(0, 12);
}

export function createEmptyLockFile(sourceLocale: string): SyncLockFile {
  const now = new Date().toISOString();
  return {
    _comment: LOCK_FILE_COMMENT,
    version: LOCK_FILE_VERSION,
    generated_at: now,
    source_locale: sourceLocale,
    entries: {},
    stats: { total_keys: 0, total_translations: 0, last_sync: now },
  };
}

/**
 * JSON.stringify replacer that emits plain objects with sorted keys, so the
 * lockfile is never materialized twice in memory: the replacer is invoked
 * lazily as stringify recurses, so only a single sorted-key shell lives at
 * each level of the tree.
 * Objects whose own-enumeration order is already sorted are returned as-is so
 * leaf shells (translations, stats) don't allocate.
 */
export function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const src = value as Record<string, unknown>;
  const keys = Object.keys(src);
  let alreadySorted = true;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i - 1]! > keys[i]!) {
      alreadySorted = false;
      break;
    }
  }
  if (alreadySorted) {
    return value;
  }
  const sortedKeys = keys.slice().sort();
  // Null-prototype: `out['__proto__'] = v` on a plain object invokes the
  // prototype setter, so an i18n key of that name would vanish from the
  // serialized lockfile on every write.
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of sortedKeys) {
    out[k] = src[k];
  }
  return out;
}

// Per-manager memo of the entries-mutation counter value that `stats` were
// last computed for. Avoids walking every entry twice on each updateEntry /
// removeEntry (once in the method, once again in write()).
const lockFileMutationVersion = new WeakMap<SyncLockFile, number>();

function bumpMutationVersion(lockFile: SyncLockFile): void {
  lockFileMutationVersion.set(lockFile, (lockFileMutationVersion.get(lockFile) ?? 0) + 1);
}

function recomputeStats(lockFile: SyncLockFile): void {
  let totalKeys = 0;
  let totalTranslations = 0;
  for (const fileEntries of Object.values(lockFile.entries)) {
    for (const entry of Object.values(fileEntries)) {
      totalKeys++;
      totalTranslations += Object.keys(entry.translations).length;
    }
  }
  lockFile.stats.total_keys = totalKeys;
  lockFile.stats.total_translations = totalTranslations;
  lockFile.stats.last_sync = new Date().toISOString();
}

export class SyncLockManager {
  private readonly statsComputedFor = new WeakMap<SyncLockFile, number>();

  constructor(private readonly lockFilePath: string) {}

  async read(): Promise<SyncLockFile> {
    try {
      await fs.promises.access(this.lockFilePath);
    } catch {
      return createEmptyLockFile('');
    }

    const raw = await fs.promises.readFile(this.lockFilePath, 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const backup = backupLockFile(this.lockFilePath, raw, 'corrupt');
      const suffix = backup ? ` Previous lock file backed up to ${backup}.` : '';
      Logger.warn(`Lock file corrupted, performing full sync.${suffix}`);
      return createEmptyLockFile('');
    }

    const obj = parsed as Record<string, unknown>;
    if (obj['version'] === undefined) {
      const backup = backupLockFile(this.lockFilePath, raw, 'v-unknown');
      const suffix = backup ? ` Previous lock file backed up to ${backup}.` : '';
      Logger.warn(`Lock file corrupted (missing version), performing full sync.${suffix}`);
      return createEmptyLockFile('');
    }
    if (obj['version'] !== LOCK_FILE_VERSION) {
      const versionTag = typeof obj['version'] === 'number' ? `v${obj['version']}` : 'v-unknown';
      const backup = backupLockFile(this.lockFilePath, raw, versionTag);
      const suffix = backup ? ` Previous lock file backed up to ${backup}.` : '';
      Logger.warn(
        `Unsupported lock file version ${obj['version']} (expected ${LOCK_FILE_VERSION}), performing full sync.${suffix}`,
      );
      return createEmptyLockFile('');
    }
    if (!obj['entries'] || typeof obj['entries'] !== 'object') {
      const backup = backupLockFile(this.lockFilePath, raw, `v${LOCK_FILE_VERSION}-no-entries`);
      const suffix = backup ? ` Previous lock file backed up to ${backup}.` : '';
      Logger.warn(`Lock file missing entries, performing full sync.${suffix}`);
      return createEmptyLockFile('');
    }

    return parsed as SyncLockFile;
  }

  async write(lockFile: SyncLockFile): Promise<void> {
    const mutationVersion = lockFileMutationVersion.get(lockFile) ?? 0;
    const lastComputed = this.statsComputedFor.get(lockFile);
    if (lastComputed !== mutationVersion) {
      recomputeStats(lockFile);
      this.statsComputedFor.set(lockFile, mutationVersion);
    } else {
      lockFile.stats.last_sync = new Date().toISOString();
    }
    lockFile.generated_at = new Date().toISOString();
    lockFile._comment = LOCK_FILE_COMMENT;
    const serialized = JSON.stringify(lockFile, sortedKeysReplacer, 2) + '\n';
    await atomicWriteFile(this.lockFilePath, serialized, 'utf-8');
  }

  async updateEntry(filePath: string, key: string, entry: SyncLockEntry): Promise<void> {
    const lockFile = await this.read();
    lockFile.entries[filePath] ??= {};
    lockFile.entries[filePath][key] = entry;
    bumpMutationVersion(lockFile);
    await this.write(lockFile);
  }

  async removeEntry(filePath: string, key: string): Promise<void> {
    const lockFile = await this.read();
    const fileEntries = lockFile.entries[filePath];
    if (fileEntries) {
      delete fileEntries[key];
      if (Object.keys(fileEntries).length === 0) {
        delete lockFile.entries[filePath];
      }
    }
    bumpMutationVersion(lockFile);
    await this.write(lockFile);
  }

  async exists(): Promise<boolean> {
    try {
      await fs.promises.access(this.lockFilePath);
      return true;
    } catch {
      return false;
    }
  }
}

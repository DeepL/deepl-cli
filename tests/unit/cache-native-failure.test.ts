/**
 * Tests for CacheService storage-backend load failure classification.
 * A backend that fails to load (e.g. node:sqlite missing on an older
 * Node runtime) must NOT be treated as database corruption: the DB file
 * and its -wal/-shm sidecars must be left untouched. Genuine open
 * failures must still trigger the rename-aside recovery path.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    output: jest.fn(),
  },
}));

let mockConstructorError: Error | null = null;

// A plain function, not jest.fn(): the project's resetMocks setting would
// strip a jest.fn implementation between tests.
jest.mock('node:sqlite', () => ({
  DatabaseSync: function MockDatabaseSync(): never {
    throw mockConstructorError ?? new Error('mockConstructorError not set');
  },
}));

import { CacheService } from '../../src/storage/cache';
import { Logger } from '../../src/utils/logger';

function makeError(message: string, code?: string): Error {
  const error = new Error(message);
  if (code) {
    (error as NodeJS.ErrnoException).code = code;
  }
  return error;
}

describe('CacheService native-module load failure', () => {
  let testCacheDir: string;
  let testCachePath: string;
  const dbContent = 'pretend this is a healthy 1MB sqlite database';
  const walContent = 'wal sidecar';
  const shmContent = 'shm sidecar';

  beforeEach(() => {
    jest.clearAllMocks();
    testCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-cli-native-fail-'));
    testCachePath = path.join(testCacheDir, 'cache.db');
    fs.writeFileSync(testCachePath, dbContent);
    fs.writeFileSync(testCachePath + '-wal', walContent);
    fs.writeFileSync(testCachePath + '-shm', shmContent);
  });

  afterEach(() => {
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });

  function listCorruptBackups(): string[] {
    return fs.readdirSync(testCacheDir).filter((f) => f.includes('.corrupt-'));
  }

  describe.each([
    [
      'ERR_DLOPEN_FAILED (ABI mismatch)',
      makeError(
        "The module '/x/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127.",
        'ERR_DLOPEN_FAILED',
      ),
    ],
    [
      'ERR_UNKNOWN_BUILTIN_MODULE (missing node:sqlite)',
      makeError("No such built-in module: node:sqlite", 'ERR_UNKNOWN_BUILTIN_MODULE'),
    ],
    [
      'NODE_MODULE_VERSION message without a code',
      makeError('was compiled against a different Node.js version using NODE_MODULE_VERSION 137'),
    ],
    [
      'MODULE_NOT_FOUND (binding removed)',
      makeError("Cannot find module 'better-sqlite3'", 'MODULE_NOT_FOUND'),
    ],
  ])('%s', (_label, error) => {
    it('rethrows without renaming the database or its sidecars', () => {
      mockConstructorError = error;

      expect(() => new CacheService({ dbPath: testCachePath })).toThrow(error.message);

      expect(fs.readFileSync(testCachePath, 'utf-8')).toBe(dbContent);
      expect(fs.readFileSync(testCachePath + '-wal', 'utf-8')).toBe(walContent);
      expect(fs.readFileSync(testCachePath + '-shm', 'utf-8')).toBe(shmContent);
      expect(listCorruptBackups()).toEqual([]);
    });

    it('does not log the corruption warning', () => {
      mockConstructorError = error;

      expect(() => new CacheService({ dbPath: testCachePath })).toThrow();

      expect(Logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('corrupted'),
      );
    });
  });

  describe('genuine open failure (not a load failure)', () => {
    it('still renames the database aside', () => {
      mockConstructorError = makeError('file is not a database', 'SQLITE_NOTADB');

      // Recreation also fails (the mock always throws), so the constructor
      // rethrows — but the rename-aside must have happened first.
      expect(() => new CacheService({ dbPath: testCachePath })).toThrow('file is not a database');

      expect(fs.existsSync(testCachePath)).toBe(false);
      const backups = listCorruptBackups();
      expect(backups.some((f) => f.startsWith('cache.db.corrupt-'))).toBe(true);
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cache database corrupted'));
    });
  });
});

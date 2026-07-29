import { SyncService, resolveTargetPath } from '../../../src/sync/sync-service';
import type { ResolvedSyncConfig } from '../../../src/sync/sync-config';
import type { SyncLockFile, SyncLockEntry } from '../../../src/sync/types';
import { computeSourceHash } from '../../../src/sync/sync-lock';
import { createMockTranslationService, createMockGlossaryService } from '../../helpers/mock-factories';
import { FormatRegistry } from '../../../src/formats/index';
import type { FormatParser, ExtractedEntry, TranslatedEntry } from '../../../src/formats/format';
import { JsonFormatParser } from '../../../src/formats/json';
import { YamlFormatParser } from '../../../src/formats/yaml';
import { ValidationError } from '../../../src/utils/errors';

jest.mock('fast-glob', () => {
  const mockFn = Object.assign(
    jest.fn().mockResolvedValue([]),
    { escapePath: (s: string) => s.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&') },
  );
  return { __esModule: true, default: mockFn };
});

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue('{}'),
    mkdir: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockRejectedValue(new Error('ENOENT')),
    copyFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/sync/sync-process-lock', () => ({
  PROCESS_LOCK_FILE_NAME: '.deepl-sync.lock.pidfile',
  acquireSyncProcessLock: (): { pidFilePath: string; release: () => void } => ({
    pidFilePath: '.deepl-sync.lock.pidfile',
    release: (): void => {
      /* no-op in unit tests */
    },
  }),
}));

jest.mock('../../../src/utils/atomic-write', () => ({
  atomicWriteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/sync/sync-context', () => ({
  extractAllKeyContexts: jest.fn().mockResolvedValue({ keyContexts: new Map(), templatePatterns: [] }),
  resolveTemplatePatterns: jest.fn().mockReturnValue(new Map()),
  synthesizeContext: jest.fn().mockReturnValue(''),
  sectionContextKey: jest.fn().mockImplementation((key: string) => {
    const segments = key.split('.');
    if (segments.length < 2) return '';
    return segments.slice(0, -1).filter((s: string) => !/^\d+$/.test(s)).join('.');
  }),
  sectionToContext: jest.fn().mockImplementation((section: string) => {
    if (!section) return '';
    return `Used in the ${section.replace(/\./g, ' > ')} section.`;
  }),
}));

jest.mock('../../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

jest.mock('../../../src/sync/sync-lock', () => {
  const actual = jest.requireActual('../../../src/sync/sync-lock');
  return {
    ...actual,
    SyncLockManager: jest.fn().mockImplementation(() => ({
      read: jest.fn().mockResolvedValue({
        _comment: '',
        version: 1,
        generated_at: '',
        source_locale: '',
        entries: {},
        stats: { total_keys: 0, total_translations: 0, last_sync: '' },
      }),
      write: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

import fg from 'fast-glob';
import * as fs from 'fs';
import { atomicWriteFile } from '../../../src/utils/atomic-write';
import { SyncLockManager } from '../../../src/sync/sync-lock';
import { extractAllKeyContexts } from '../../../src/sync/sync-context';
import { Logger } from '../../../src/utils/logger';

const mockExtractAllKeyContexts = extractAllKeyContexts as jest.MockedFunction<typeof extractAllKeyContexts>;
const mockFg = fg as jest.MockedFunction<typeof fg>;
const mockReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;
const mockMkdir = fs.promises.mkdir as jest.MockedFunction<typeof fs.promises.mkdir>;
const mockAtomicWriteFile = atomicWriteFile as jest.MockedFunction<typeof atomicWriteFile>;
const mockCopyFile = fs.promises.copyFile as jest.MockedFunction<typeof fs.promises.copyFile>;
const mockUnlink = fs.promises.unlink as jest.MockedFunction<typeof fs.promises.unlink>;
const MockSyncLockManager = SyncLockManager as jest.MockedClass<typeof SyncLockManager>;

function makeConfig(overrides: Partial<ResolvedSyncConfig> = {}): ResolvedSyncConfig {
  return {
    version: 1,
    source_locale: 'en',
    target_locales: ['de'],
    buckets: { json: { include: ['locales/en.json'] } },
    configPath: '/test/.deepl-sync.yaml',
    projectRoot: '/test',
    overrides: {},
    ...overrides,
  };
}

function makeEmptyLockFile(sourceLocale = ''): SyncLockFile {
  return {
    _comment: '',
    version: 1,
    generated_at: '',
    source_locale: sourceLocale,
    entries: {},
    stats: { total_keys: 0, total_translations: 0, last_sync: '' },
  };
}

function makeLockFileWithEntries(
  entries: Record<string, Record<string, SyncLockEntry>>,
  sourceLocale = 'en',
): SyncLockFile {
  return {
    ...makeEmptyLockFile(sourceLocale),
    entries,
  };
}

/**
 * `hash` is optional and defaults to the entry's own source hash, which is the
 * real lockfile invariant: sync-process-bucket writes
 * `computeSourceHash(value)` to both `source_hash` and each
 * `translations[locale].hash`. Pass an explicit hash only to model a locale
 * that has genuinely fallen behind the source.
 */
function makeLockEntry(value: string, translations: Record<string, { hash?: string; status: string }> = {}): SyncLockEntry {
  const translationEntries: SyncLockEntry['translations'] = {};
  for (const [locale, info] of Object.entries(translations)) {
    translationEntries[locale] = {
      hash: info.hash ?? computeSourceHash(value),
      translated_at: '2026-01-01T00:00:00.000Z',
      status: info.status as 'translated' | 'failed' | 'pending',
    };
  }
  return {
    source_hash: computeSourceHash(value),
    source_text: value,
    translations: translationEntries,
  };
}

function createRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register(new JsonFormatParser());
  registry.register(new YamlFormatParser());
  return registry;
}

function createService(overrides: {
  translateBatch?: jest.Mock;
} = {}) {
  const mockTranslation = createMockTranslationService({
    translateBatch: overrides.translateBatch ?? jest.fn().mockResolvedValue([]),
  });
  const mockGlossary = createMockGlossaryService();
  const registry = createRegistry();
  const service = new SyncService(mockTranslation, mockGlossary, registry);
  return { service, mockTranslation, mockGlossary, registry };
}

// Mock multi-locale parser for testing the engine's multi-locale code path.
// Simulates the .xcstrings format: a single JSON file with all locales.
const mockMultiLocaleParser: FormatParser = {
  name: 'MockMultiLocale',
  configKey: 'xcstrings',
  extensions: ['.xcstrings'],
  multiLocale: true,
  extract(content: string, locale?: string): ExtractedEntry[] {
    const data = JSON.parse(content);
    if (!locale) return [];
    const entries: ExtractedEntry[] = [];
    for (const [key, val] of Object.entries(data.strings ?? {})) {
      const loc = (val as Record<string, unknown>)['localizations'] as Record<string, unknown> | undefined;
      const unit = (loc?.[locale] as Record<string, unknown>)?.['stringUnit'] as Record<string, string> | undefined;
      if (unit?.['value']) {
        entries.push({ key, value: unit['value'] });
      }
    }
    return entries.sort((a, b) => a.key.localeCompare(b.key));
  },
  reconstruct(content: string, entries: TranslatedEntry[], locale?: string): string {
    const data = JSON.parse(content);
    data.strings ??= {};
    for (const entry of entries) {
      data.strings[entry.key] ??= { localizations: {} };
      data.strings[entry.key].localizations[locale!] = {
        stringUnit: { state: 'translated', value: entry.translation },
      };
    }
    return JSON.stringify(data, null, 2) + '\n';
  },
};

function createMultiLocaleRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register(mockMultiLocaleParser);
  return registry;
}

function createMultiLocaleService(overrides: { translateBatch?: jest.Mock } = {}) {
  const mockTranslation = createMockTranslationService({
    translateBatch: overrides.translateBatch ?? jest.fn().mockResolvedValue([]),
  });
  const mockGlossary = createMockGlossaryService();
  const registry = createMultiLocaleRegistry();
  const service = new SyncService(mockTranslation, mockGlossary, registry);
  return { service, mockTranslation, mockGlossary, registry };
}

function setupLockManager(lockFile: SyncLockFile) {
  const mockRead = jest.fn().mockResolvedValue(lockFile);
  const mockWrite = jest.fn().mockResolvedValue(undefined);
  MockSyncLockManager.mockImplementation(() => ({
    read: mockRead,
    write: mockWrite,
    updateEntry: jest.fn(),
    removeEntry: jest.fn(),
    exists: jest.fn(),
  }) as unknown as SyncLockManager);
  return { mockRead, mockWrite };
}

const SOURCE_JSON = JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye' }, null, 2) + '\n';

describe('SyncService', () => {
  describe('sync() — happy path', () => {
    it('should translate new strings and write target files', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig();
      const result = await service.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(result.totalKeys).toBe(2);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(translateBatch).toHaveBeenCalledWith(
        ['Goodbye', 'Hello'],
        expect.objectContaining({ targetLang: 'de' }),
      );
      expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('should track billed characters', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig());
      expect(result.totalCharactersBilled).toBe(20);
    });
  });

  describe('sync() — dryRun', () => {
    it('should NOT call translateBatch or write files', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn();
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      const result = await service.sync(makeConfig(), { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(translateBatch).not.toHaveBeenCalled();
      expect(mockAtomicWriteFile).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should still count keys correctly', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      const result = await service.sync(makeConfig(), { dryRun: true });
      expect(result.totalKeys).toBe(2);
      expect(result.newKeys).toBe(2);
      expect(result.currentKeys).toBe(0);
    });
  });

  describe('sync() — dryRun estimation', () => {
    it('should multiply estimation by number of target locales', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      // "Hello" (5) + "Goodbye" (7) = 12 chars × 2 locales = 24
      const config = makeConfig({ target_locales: ['de', 'fr'] });
      const result = await service.sync(config, { dryRun: true });
      expect(result.estimatedCharacters).toBe(24);
    });

    it('should respect localeFilter in estimation', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      // 12 chars × 1 filtered locale = 12
      const config = makeConfig({ target_locales: ['de', 'fr'] });
      const result = await service.sync(config, { dryRun: true, localeFilter: ['de'] });
      expect(result.estimatedCharacters).toBe(12);
    });
  });

  describe('sync() — backup behavior', () => {
    beforeEach(() => {
      mockCopyFile.mockReset().mockResolvedValue(undefined);
      mockUnlink.mockReset().mockResolvedValue(undefined);
    });

    it('should create .bak and clean up on success', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/locales/en.json') return SOURCE_JSON;
        if (filePath === '/test/locales/de.json') return '{"greeting":"Alt"}';
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      expect(mockCopyFile).toHaveBeenCalledWith(
        '/test/locales/de.json',
        '/test/locales/de.json.deepl.bak',
      );
      expect(mockUnlink).toHaveBeenCalledWith('/test/locales/de.json.deepl.bak');
    });

    it('should NOT create .bak in dry-run mode', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig(), { dryRun: true });

      expect(mockCopyFile).not.toHaveBeenCalled();
    });
  });

  // Non-watch sync runs must register SIGINT/SIGTERM cleanup for `.bak`
  // sibling files so a user crash mid-translate doesn't leave orphans. Watch
  // mode is already covered by its own WatchController.
  describe('sync() — SIGINT/SIGTERM .bak cleanup', () => {
    beforeEach(() => {
      mockCopyFile.mockReset().mockResolvedValue(undefined);
      mockUnlink.mockReset().mockResolvedValue(undefined);
    });

    it('registers one SIGINT and one SIGTERM listener during a non-watch run and detaches after completion', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      const sigintBase = process.listenerCount('SIGINT');
      const sigtermBase = process.listenerCount('SIGTERM');

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig(), { dryRun: true });

      expect(process.listenerCount('SIGINT')).toBe(sigintBase);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBase);
    });

    it('does not emit the "outer controller" clear-set branch when no backupTracker is supplied', async () => {
      // Non-watch runs wire up a backupTracker internally; this pins the
      // semantic that they do not receive any backupTracker reference back.
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/locales/en.json') return SOURCE_JSON;
        if (filePath === '/test/locales/de.json') return '{"greeting":"Alt"}';
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig());
      expect(result.success).toBe(true);
      // Backup was created, then unlinked (normal post-success path).
      expect(mockUnlink).toHaveBeenCalledWith('/test/locales/de.json.deepl.bak');
    });
  });

  describe('sync() — multi-locale format', () => {
    const XCSTRINGS_SOURCE = JSON.stringify({
      sourceLanguage: 'en',
      version: '1.0',
      strings: {
        greeting: {
          localizations: {
            en: { stringUnit: { state: 'translated', value: 'Hello' } },
          },
        },
        farewell: {
          localizations: {
            en: { stringUnit: { state: 'translated', value: 'Goodbye' } },
          },
        },
      },
    }, null, 2) + '\n';

    function makeMultiLocaleConfig(overrides: Partial<ResolvedSyncConfig> = {}): ResolvedSyncConfig {
      return {
        version: 1,
        source_locale: 'en',
        target_locales: ['de', 'fr'],
        buckets: { xcstrings: { include: ['Localizable.xcstrings'] } },
        configPath: '/test/.deepl-sync.yaml',
        projectRoot: '/test',
        overrides: {},
        ...overrides,
      };
    }

    it('should use source path as target for all locales', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn()
        .mockResolvedValueOnce([
          { text: 'Auf Wiedersehen', billedCharacters: 15 },
          { text: 'Hallo', billedCharacters: 5 },
        ])
        .mockResolvedValueOnce([
          { text: 'Au revoir', billedCharacters: 9 },
          { text: 'Bonjour', billedCharacters: 7 },
        ]);
      const { service } = createMultiLocaleService({ translateBatch });

      mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/Localizable.xcstrings') return XCSTRINGS_SOURCE;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeMultiLocaleConfig());

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);
      // All file results should reference the source path, not locale-specific paths
      for (const fr of result.fileResults) {
        expect(fr.file).toBe('Localizable.xcstrings');
      }
      expect(result.fileResults).toHaveLength(2);
      expect(result.fileResults.map(f => f.locale).sort()).toEqual(['de', 'fr']);
    });

    it('should pass locale to parser.extract() for source entries', async () => {
      setupLockManager(makeEmptyLockFile());
      const extractSpy = jest.spyOn(mockMultiLocaleParser, 'extract');
      const { service } = createMultiLocaleService();

      mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
      mockReadFile.mockResolvedValue(XCSTRINGS_SOURCE);

      await service.sync(makeMultiLocaleConfig(), { dryRun: true });

      // Source extraction should pass the source locale
      expect(extractSpy).toHaveBeenCalledWith(XCSTRINGS_SOURCE, 'en');
      extractSpy.mockRestore();
    });

    it('should pass locale to parser.reconstruct()', async () => {
      setupLockManager(makeEmptyLockFile());
      const reconstructSpy = jest.spyOn(mockMultiLocaleParser, 'reconstruct');
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Translated1', billedCharacters: 10 },
        { text: 'Translated2', billedCharacters: 10 },
      ]);
      const { service } = createMultiLocaleService({ translateBatch });

      mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/Localizable.xcstrings') return XCSTRINGS_SOURCE;
        throw new Error('ENOENT');
      });

      await service.sync(makeMultiLocaleConfig());

      // reconstruct should be called with locale for each target
      const localeArgs = reconstructSpy.mock.calls.map(c => c[2]);
      expect(localeArgs).toContain('de');
      expect(localeArgs).toContain('fr');
      reconstructSpy.mockRestore();
    });

    it('should force concurrency=1 for multi-locale formats', async () => {
      setupLockManager(makeEmptyLockFile());
      const callOrder: string[] = [];
      const translateBatch = jest.fn().mockImplementation(async (_texts: string[], opts: { targetLang: string }) => {
        callOrder.push(opts.targetLang);
        return [
          { text: 'T1', billedCharacters: 2 },
          { text: 'T2', billedCharacters: 2 },
        ];
      });
      const { service } = createMultiLocaleService({ translateBatch });

      mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/Localizable.xcstrings') return XCSTRINGS_SOURCE;
        throw new Error('ENOENT');
      });

      await service.sync(makeMultiLocaleConfig());

      // Sequential processing means locales are in order
      expect(callOrder).toEqual(['de', 'fr']);
    });

    it('should only create one .bak backup for shared target file', async () => {
      setupLockManager(makeEmptyLockFile());
      mockCopyFile.mockReset().mockResolvedValue(undefined);
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'T1', billedCharacters: 2 },
        { text: 'T2', billedCharacters: 2 },
      ]);
      const { service } = createMultiLocaleService({ translateBatch });

      mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
      // File exists on every read (including between locale writes)
      mockReadFile.mockResolvedValue(XCSTRINGS_SOURCE);

      await service.sync(makeMultiLocaleConfig());

      // copyFile should only be called once despite 2 locales
      expect(mockCopyFile).toHaveBeenCalledTimes(1);
      expect(mockCopyFile).toHaveBeenCalledWith(
        '/test/Localizable.xcstrings',
        '/test/Localizable.xcstrings.deepl.bak',
      );
    });

    it('should work with dry-run mode', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn();
      const { service } = createMultiLocaleService({ translateBatch });

      mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
      mockReadFile.mockResolvedValue(XCSTRINGS_SOURCE);

      const result = await service.sync(makeMultiLocaleConfig(), { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(translateBatch).not.toHaveBeenCalled();
      expect(mockAtomicWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('sync() — frozen mode', () => {
    it('should detect drift when new keys exist', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn();
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      const result = await service.sync(makeConfig(), { frozen: true });

      expect(result.frozen).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.success).toBe(false);
      expect(translateBatch).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should detect drift when only deleted keys exist', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
          removed_key: makeLockEntry('Old text', { de: { status: 'translated' } }),
        },
      });
      const { mockWrite } = setupLockManager(lockFile);
      const translateBatch = jest.fn();
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      const result = await service.sync(makeConfig(), { frozen: true });

      expect(result.frozen).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.success).toBe(false);
      expect(translateBatch).not.toHaveBeenCalled();
      expect(mockAtomicWriteFile).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should not detect drift when all keys are current', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
      });
      const { mockWrite } = setupLockManager(lockFile);
      const translateBatch = jest.fn();
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      const result = await service.sync(makeConfig(), { frozen: true });

      expect(result.driftDetected).toBe(false);
      expect(result.success).toBe(true);
      expect(translateBatch).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('sync() — force + frozen guard', () => {
    it('should throw ValidationError when both force and frozen are set', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue([] as never);

      await expect(service.sync(makeConfig(), { force: true, frozen: true })).rejects.toThrow(ValidationError);
      await expect(service.sync(makeConfig(), { force: true, frozen: true })).rejects.toThrow(
        'Cannot use --force and --frozen together',
      );
    });
  });

  describe('sync() — force mode', () => {
    it('should treat all entries as new when force is true', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
      });
      setupLockManager(lockFile);

      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig(), { force: true });

      expect(result.newKeys).toBe(2);
      expect(result.currentKeys).toBe(0);
      expect(translateBatch).toHaveBeenCalledWith(
        ['Goodbye', 'Hello'],
        expect.objectContaining({ targetLang: 'de' }),
      );
    });
  });

  describe('sync() — force mode with deleted keys', () => {
    it('should not crash and correctly count deleted keys when force includes deleted entries', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
          removed_key: makeLockEntry('Old text', { de: { status: 'translated' } }),
        },
      });
      setupLockManager(lockFile);

      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig(), { force: true });

      expect(result.deletedKeys).toBe(1);
      expect(result.newKeys).toBe(2);
      expect(translateBatch).toHaveBeenCalledWith(
        ['Goodbye', 'Hello'],
        expect.objectContaining({ targetLang: 'de' }),
      );
    });
  });

  describe('sync() — localeFilter', () => {
    it('should only translate filtered locales', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({ target_locales: ['de', 'fr', 'es'] });
      const result = await service.sync(config, { localeFilter: ['de'] });

      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ targetLang: 'de' }),
      );
      expect(result.fileResults.every(fr => fr.locale === 'de')).toBe(true);
    });
  });

  describe('sync() — empty source file', () => {
    it('should make no API calls for empty source files', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn();
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue('{}');

      const result = await service.sync(makeConfig());

      expect(translateBatch).not.toHaveBeenCalled();
      expect(result.totalKeys).toBe(0);
      expect(result.newKeys).toBe(0);
    });
  });

  describe('sync() — empty existing target template fallback', () => {
    it('should reconstruct JSON targets from source when the existing target file is empty', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/locales/en.json') return SOURCE_JSON;
        if (filePath === '/test/locales/de.json') return '';
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1);
      const writtenContent = String(mockAtomicWriteFile.mock.calls[0]![1]);
      expect(JSON.parse(writtenContent)).toEqual({
        farewell: 'Auf Wiedersehen',
        greeting: 'Hallo',
      });
    });

    it('should reconstruct YAML targets from source when the existing target file is empty', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.yaml'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/locales/en.yaml') return 'greeting: Hello\n';
        if (filePath === '/test/locales/de.yaml') return '';
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        buckets: { yaml: { include: ['locales/en.yaml'] } },
      });

      await service.sync(config);

      expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1);
      expect(String(mockAtomicWriteFile.mock.calls[0]![1])).toBe('greeting: Hallo\n');
    });
  });

  describe('sync() — missing format parser', () => {
    it('should throw ValidationError for unsupported format', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      const config = makeConfig({
        buckets: { xml: { include: ['locales/en.xml'] } },
      });

      await expect(service.sync(config)).rejects.toThrow(ValidationError);
      await expect(service.sync(config)).rejects.toThrow('No parser for format "xml"');
    });
  });

  describe('sync() — multiple files', () => {
    it('should process each file separately', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Translated', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en/a.json', '/test/locales/en/b.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath.endsWith('a.json') || filePath.endsWith('b.json')) {
          return JSON.stringify({ key: 'value' }, null, 2) + '\n';
        }
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        buckets: { json: { include: ['locales/en/*.json'] } },
      });
      const result = await service.sync(config);

      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(result.totalKeys).toBe(2);
      expect(result.fileResults).toHaveLength(2);
    });
  });

  describe('sync() — lock file management', () => {
    it('should write lock file after sync', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('should NOT write lock file in dryRun mode', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig(), { dryRun: true });
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should NOT write lock file when frozen with drift', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig(), { frozen: true });
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should update lock entries with correct hashes', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      const fileEntries = writtenLockFile.entries['locales/en.json'];
      expect(fileEntries).toBeDefined();

      const greetingEntry = fileEntries!['greeting'];
      expect(greetingEntry).toBeDefined();
      expect(greetingEntry!.source_hash).toBe(computeSourceHash('Hello'));
      expect(greetingEntry!.source_text).toBe('Hello');
      expect(greetingEntry!.translations['de']).toBeDefined();
      expect(greetingEntry!.translations['de']!.status).toBe('translated');
    });
  });

  describe('sync() — target directory creation', () => {
    it('should create target directory with recursive option', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('locales'),
        { recursive: true },
      );
    });
  });

  describe('sync() — sets source_locale on empty lock file', () => {
    it('should set source_locale when lock file has empty string', async () => {
      const lockFile = makeEmptyLockFile('');
      setupLockManager(lockFile);
      const { service } = createService();

      mockFg.mockResolvedValue([] as never);

      const result = await service.sync(makeConfig());
      expect(result.success).toBe(true);
      expect(lockFile.source_locale).toBe('en');
    });
  });

  describe('sync() — fileResults tracking', () => {
    it('should record translated count in file results', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig());

      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0]!.translated).toBe(2);
      expect(result.fileResults[0]!.written).toBe(true);
      expect(result.fileResults[0]!.locale).toBe('de');
    });
  });

  describe('sync() — stale keys', () => {
    it('should retranslate stale entries', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Old Hello', { de: { status: 'translated' } }),
        },
      });
      setupLockManager(lockFile);

      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig());

      expect(result.staleKeys).toBe(1);
      expect(result.currentKeys).toBe(1);
      // The stale key is re-translated. The current key ("farewell") is too,
      // because this fixture has no de.json on disk: a lockfile entry with no
      // target content means the file was deleted, so the key must be
      // translated again rather than recorded as already done.
      const sentTexts = translateBatch.mock.calls.flatMap((call) => call[0] as string[]);
      expect(sentTexts).toContain('Hello');
      expect(sentTexts).toContain('Goodbye');
    });
  });

  describe('sync() — nothing to translate', () => {
    it('should skip translation when all keys are current', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
      });
      setupLockManager(lockFile);

      const translateBatch = jest.fn();
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      const result = await service.sync(makeConfig());

      expect(translateBatch).not.toHaveBeenCalled();
      expect(result.currentKeys).toBe(2);
      expect(result.newKeys).toBe(0);
    });
  });

  describe('sync() — multiple target locales', () => {
    it('should call translateBatch once per locale', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Translated', billedCharacters: 10 },
        { text: 'Translated2', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({ target_locales: ['de', 'fr'] });
      const result = await service.sync(config);

      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(result.fileResults).toHaveLength(2);

      const locales = result.fileResults.map(fr => fr.locale);
      expect(locales).toContain('de');
      expect(locales).toContain('fr');
    });
  });

  describe('sync() — multiple locales all recorded as successful', () => {
    it('should record all locales in lock file when concurrency >= 2', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Translated1', billedCharacters: 10 },
        { text: 'Translated2', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({ target_locales: ['de', 'fr', 'es'] });
      await service.sync(config, { concurrency: 3 });

      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      const fileEntries = writtenLockFile.entries['locales/en.json'];
      expect(fileEntries).toBeDefined();

      for (const key of ['farewell', 'greeting']) {
        const entry = fileEntries![key]!;
        for (const locale of ['de', 'fr', 'es']) {
          expect(entry.translations[locale]).toBeDefined();
          expect(entry.translations[locale]!.status).toBe('translated');
        }
      }
    });
  });

  describe('sync() — exclude patterns', () => {
    it('should pass exclude to fast-glob', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue([] as never);

      const config = makeConfig({
        buckets: { json: { include: ['locales/**/*.json'], exclude: ['locales/generated/**'] } },
      });
      await service.sync(config);

      expect(mockFg).toHaveBeenCalledWith(
        ['locales/**/*.json'],
        expect.objectContaining({
          ignore: ['locales/generated/**'],
        }),
      );
    });
  });

  describe('sync() — ARCH-01: current keys use target translations', () => {
    it('should use existing target file translations for unchanged keys', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
      });
      setupLockManager(lockFile);

      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo NEU', billedCharacters: 9 },
      ]);
      const { service } = createService({ translateBatch });

      const sourceJson = JSON.stringify({ greeting: 'Hello CHANGED', farewell: 'Goodbye' }, null, 2) + '\n';
      const targetDeJson = JSON.stringify({ greeting: 'Hallo', farewell: 'Auf Wiedersehen' }, null, 2) + '\n';

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/locales/en.json') return sourceJson;
        if (filePath === '/test/locales/de.json') return targetDeJson;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      const writeCall = mockAtomicWriteFile.mock.calls[0];
      expect(writeCall).toBeDefined();
      // writeCall args: [filePath, content, encoding]
      const writtenJson = JSON.parse(String(writeCall![1])) as Record<string, string>;
      // The target file should use 'Auf Wiedersehen' (from existing target), not 'Goodbye' (source text)
      expect(writtenJson['farewell']).toBe('Auf Wiedersehen');
      expect(writtenJson['greeting']).toBe('Hallo NEU');
    });
  });

  describe('sync() — ARCH-07: deleted keys pruned from lock file', () => {
    it('should remove deleted keys from the lock file entries', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          farewell: makeLockEntry('Goodbye', { de: { status: 'translated' } }),
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
          removed_key: makeLockEntry('Old text', { de: { status: 'translated' } }),
        },
      });
      const { mockWrite } = setupLockManager(lockFile);

      const translateBatch = jest.fn().mockResolvedValue([]);
      const { service } = createService({ translateBatch });

      // Source file only has 2 keys; removed_key was deleted
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig());

      expect(result.deletedKeys).toBe(1);
      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      const fileEntries = writtenLockFile.entries['locales/en.json'];
      expect(fileEntries).toBeDefined();
      expect(fileEntries!['removed_key']).toBeUndefined();
      expect(fileEntries!['greeting']).toBeDefined();
      expect(fileEntries!['farewell']).toBeDefined();
    });

    it('should remove file entry entirely when all keys are deleted', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/en.json': {
          old_key: makeLockEntry('Old text', { de: { status: 'translated' } }),
        },
      });
      const { mockWrite } = setupLockManager(lockFile);

      const translateBatch = jest.fn().mockResolvedValue([]);
      const { service } = createService({ translateBatch });

      // Source file is empty — old_key was deleted
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return '{}';
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      expect(writtenLockFile.entries['locales/en.json']).toBeUndefined();
    });
  });

  describe('sync() — stale lock GC preserves moved sources', () => {
    it('preserves a lockfile entry whose source file is findable by base name elsewhere', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/old-path/en.json': {
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
        'locales/en.json': {
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
      });
      const { mockWrite } = setupLockManager(lockFile);
      const translateBatch = jest.fn().mockResolvedValue([]);
      const { service } = createService({ translateBatch });
      const warnSpy = Logger.warn as jest.Mock;

      // fast-glob returns `locales/en.json` for the bucket pattern (matching
      // the new path only) and returns both `en.json` occurrences for the
      // broader base-name scan used by the GC guard.
      mockFg.mockImplementation((async (patterns: string | string[]): Promise<string[]> => {
        const arr = Array.isArray(patterns) ? patterns : [patterns];
        const first = arr[0] ?? '';
        if (first.startsWith('**/')) {
          return ['locales/en.json', 'locales/old-path/en.json'];
        }
        return ['/test/locales/en.json'];
      }));
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      // Entry for the old path survives because its base name is findable.
      expect(writtenLockFile.entries['locales/old-path/en.json']).toBeDefined();
      expect(writtenLockFile.entries['locales/old-path/en.json']!['greeting']).toBeDefined();
      // The warning names the lock path and hints at a glob change.
      const messages = warnSpy.mock.calls.map((c) => c.join(' '));
      expect(messages.some((m: string) => m.includes('locales/old-path/en.json'))).toBe(true);
      expect(messages.some((m: string) => m.toLowerCase().includes('glob change'))).toBe(true);
    });

    it('still deletes entries whose base name is absent from projectRoot', async () => {
      const lockFile = makeLockFileWithEntries({
        'locales/truly-deleted.json': {
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
        'locales/en.json': {
          greeting: makeLockEntry('Hello', { de: { status: 'translated' } }),
        },
      });
      const { mockWrite } = setupLockManager(lockFile);
      const translateBatch = jest.fn().mockResolvedValue([]);
      const { service } = createService({ translateBatch });

      mockFg.mockImplementation((async (patterns: string | string[]): Promise<string[]> => {
        const arr = Array.isArray(patterns) ? patterns : [patterns];
        const first = arr[0] ?? '';
        if (first.startsWith('**/')) {
          // Base-name scan for `truly-deleted.json` returns nothing.
          return [];
        }
        return ['/test/locales/en.json'];
      }));
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      expect(writtenLockFile.entries['locales/truly-deleted.json']).toBeUndefined();
      expect(writtenLockFile.entries['locales/en.json']).toBeDefined();
    });
  });

  describe('sync() — per-locale translation success tracking', () => {
    it('should set lock status to failed for keys where translation returned undefined', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        undefined,
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const result = await service.sync(makeConfig());

      expect(result.newKeys).toBe(2);
      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      const fileEntries = writtenLockFile.entries['locales/en.json'];
      expect(fileEntries).toBeDefined();

      const farewellStatus = fileEntries!['farewell']?.translations['de']?.status;
      const greetingStatus = fileEntries!['greeting']?.translations['de']?.status;
      // One should be 'translated', one should be 'failed'
      const statuses = [farewellStatus, greetingStatus].sort();
      expect(statuses).toEqual(['failed', 'translated']);
    });
  });

  describe('sync() — partial batch failure', () => {
    it('should complete sync when some batch results are undefined', async () => {
      setupLockManager(makeEmptyLockFile());
      const sourceJson = JSON.stringify(
        { alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma' },
        null,
        2,
      ) + '\n';
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Alpha-DE', billedCharacters: 5 },
        undefined,
        { text: 'Gamma-DE', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig());

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(3);
      expect(result.fileResults).toHaveLength(1);
      const fileResult = result.fileResults[0]!;
      expect(fileResult.failed).toBe(1);
      expect(fileResult.translated).toBe(2);
    });

    it('should write successful translations to target file despite partial failure', async () => {
      setupLockManager(makeEmptyLockFile());
      const sourceJson = JSON.stringify(
        { alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma' },
        null,
        2,
      ) + '\n';
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Alpha-DE', billedCharacters: 5 },
        undefined,
        { text: 'Gamma-DE', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1);
      const writtenContent = String(mockAtomicWriteFile.mock.calls[0]![1]);
      const parsed = JSON.parse(writtenContent) as Record<string, string>;
      expect(parsed['alpha']).toBe('Alpha-DE');
      expect(parsed['gamma']).toBe('Gamma-DE');
    });

    it('should record failed status in lock file for undefined batch results', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const sourceJson = JSON.stringify(
        { alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma' },
        null,
        2,
      ) + '\n';
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Alpha-DE', billedCharacters: 5 },
        undefined,
        { text: 'Gamma-DE', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      const fileEntries = writtenLockFile.entries['locales/en.json'];
      expect(fileEntries).toBeDefined();

      expect(fileEntries!['alpha']?.translations['de']?.status).toBe('translated');
      expect(fileEntries!['beta']?.translations['de']?.status).toBe('failed');
      expect(fileEntries!['gamma']?.translations['de']?.status).toBe('translated');
    });
  });

  describe('sync() — context omitted for multi-key batches', () => {
    it('should set context for single-key batch', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const singleKeyJson = JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return singleKeyJson;
        throw new Error('ENOENT');
      });

      mockExtractAllKeyContexts.mockResolvedValue({
        keyContexts: new Map([['greeting', { key: 'greeting', context: 'Used in navbar header', occurrences: 1 }]]),
        templatePatterns: [],
      });

      const config = makeConfig({ context: { enabled: true } });
      await service.sync(config);

      expect(translateBatch).toHaveBeenCalledWith(
        ['Hello'],
        expect.objectContaining({ context: 'Used in navbar header' }),
      );
    });

    it('should send per-key requests with context for multi-key batch', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'translated', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      mockExtractAllKeyContexts.mockResolvedValue({
        keyContexts: new Map([
          ['greeting', { key: 'greeting', context: 'Header context', occurrences: 1 }],
          ['farewell', { key: 'farewell', context: 'Footer context', occurrences: 1 }],
        ]),
        templatePatterns: [],
      });

      const config = makeConfig({ context: { enabled: true } });
      await service.sync(config);

      // Both keys are single-segment (no parent section), so they stay per-key
      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: 'Footer context' }),
      );
      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: 'Header context' }),
      );
    });

    it('should force batch mode with --batch flag even when context exists', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      mockExtractAllKeyContexts.mockResolvedValue({
        keyContexts: new Map([
          ['greeting', { key: 'greeting', context: 'Header context', occurrences: 1 }],
          ['farewell', { key: 'farewell', context: 'Footer context', occurrences: 1 }],
        ]),
        templatePatterns: [],
      });

      const config = makeConfig({ context: { enabled: true } });
      await service.sync(config, { batch: true });

      // --batch forces all keys into one batch without context
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: undefined }),
      );
    });

    it('should batch keys without context and send per-key for keys with context', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'translated', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const threeKeyJson = JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye', other: 'Other' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return threeKeyJson;
        throw new Error('ENOENT');
      });

      // Only 'greeting' has context; 'farewell' and 'other' do not
      mockExtractAllKeyContexts.mockResolvedValue({
        keyContexts: new Map([
          ['greeting', { key: 'greeting', context: 'Navbar header', occurrences: 1 }],
        ]),
        templatePatterns: [],
      });

      const config = makeConfig({ context: { enabled: true } });
      await service.sync(config);

      // 1 per-key call for 'greeting' with context + 1 batch call for the others without context
      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: 'Navbar header' }),
      );
      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: undefined }),
      );
    });
  });

  describe('sync() — onProgress callback', () => {
    it('should fire key-translated then locale-complete with correct counts', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const events: Array<{ type: string; key?: string; translated: number }> = [];
      await service.sync(makeConfig(), {
        onProgress: (event) => events.push({
          type: event.type,
          key: event.type === 'key-translated' ? event.key : undefined,
          translated: event.translated,
        }),
      });

      const keyEvents = events.filter(e => e.type === 'key-translated');
      const localeEvents = events.filter(e => e.type === 'locale-complete');
      expect(keyEvents.length).toBe(2);
      expect(keyEvents[0]!.translated).toBe(1);
      expect(keyEvents[1]!.translated).toBe(2);
      expect(localeEvents.length).toBe(1);
      expect(localeEvents[0]!.translated).toBe(2);
      const lastKeyIdx = events.findIndex(e => e === keyEvents[keyEvents.length - 1]);
      const localeIdx = events.findIndex(e => e === localeEvents[0]);
      expect(lastKeyIdx).toBeLessThan(localeIdx);
    });

    it('should not fire onProgress in dry-run mode', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const progressEvents: unknown[] = [];
      await service.sync(makeConfig(), {
        dryRun: true,
        onProgress: (event) => progressEvents.push(event),
      });

      expect(progressEvents).toHaveLength(0);
    });
  });

  describe('sync() — context_sent in lock entries', () => {
    it('should set context_sent: true for keys translated with context', async () => {
      const { mockWrite } = setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const singleKeyJson = JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return singleKeyJson;
        throw new Error('ENOENT');
      });

      mockExtractAllKeyContexts.mockResolvedValue({
        keyContexts: new Map([['greeting', { key: 'greeting', context: 'Navbar header', occurrences: 1 }]]),
        templatePatterns: [],
      });

      const config = makeConfig({ context: { enabled: true } });
      await service.sync(config);

      const writtenLockFile = mockWrite.mock.calls[0]![0] as SyncLockFile;
      const entry = writtenLockFile.entries['locales/en.json']!['greeting']!;
      expect(entry.translations['de']!.context_sent).toBe(true);
    });
  });

  describe('sync() — SPEC-06: custom_instructions and style_id', () => {
    it('should pass custom_instructions and style_id to translateBatch', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        translation: {
          custom_instructions: ['Keep formal tone'],
          style_id: 'style-123',
        },
      });
      await service.sync(config);

      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customInstructions: ['Keep formal tone'],
          styleId: 'style-123',
        }),
      );
    });

    it('should use locale overrides for custom_instructions and style_id', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        translation: {
          custom_instructions: ['Keep formal tone'],
          style_id: 'style-default',
          locale_overrides: {
            de: {
              custom_instructions: ['Use du instead of Sie'],
              style_id: 'style-de',
            },
          },
        },
      });
      await service.sync(config);

      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customInstructions: ['Use du instead of Sie'],
          styleId: 'style-de',
        }),
      );
    });
  });

  describe('sync() — per-locale glossary override resolution', () => {
    it('should resolve per-locale glossary name via glossaryService', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 15 },
      ]);
      const { service, mockGlossary } = createService({ translateBatch });
      mockGlossary.resolveGlossaryId.mockResolvedValue('resolved-glossary-id-123');

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        translation: {
          locale_overrides: {
            de: {
              glossary: 'my-glossary',
            },
          },
        },
      });
      await service.sync(config);

      expect(mockGlossary.resolveGlossaryId).toHaveBeenCalledWith('my-glossary');
      expect(translateBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ glossaryId: 'resolved-glossary-id-123' }),
      );
    });
  });

  describe('sync() — locale filter warning', () => {
    it('should warn and produce 0 translations when locale filter matches nothing', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        const filePath = String(p);
        if (filePath === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({ target_locales: ['de', 'fr'] });
      const result = await service.sync(config, { localeFilter: ['zz'] });

      expect(result.totalCharactersBilled).toBe(0);
      expect(translateBatch).not.toHaveBeenCalled();
      expect(Logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No matching locales for filter [zz]'),
      );
    });
  });

  describe('sync() — Android XML plural translation', () => {
    it('should translate non-primary plural forms in metadata', async () => {
      setupLockManager(makeEmptyLockFile());

      const sourceJson = JSON.stringify({ item_count: '%d items' }, null, 2) + '\n';
      const translateBatch = jest.fn().mockResolvedValue([
        { text: '%d Artikel', billedCharacters: 10 },
        { text: '1 Artikel', billedCharacters: 9 },
      ]);
      const { service, registry } = createService({ translateBatch });

      const mockParser = {
        name: 'JSON',
        configKey: 'json',
        extensions: ['.json'],
        extract: jest.fn().mockReturnValue([
          {
            key: 'item_count',
            value: '%d items',
            metadata: {
              plurals: [
                { quantity: 'one', value: '1 item' },
                { quantity: 'other', value: '%d items' },
              ],
            },
          },
        ]),
        reconstruct: jest.fn().mockReturnValue('{}'),
      };
      jest.spyOn(registry, 'getParser').mockReturnValue(mockParser);
      jest.spyOn(registry, 'getParserByFormatKey').mockReturnValue(mockParser);

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      expect(translateBatch).toHaveBeenCalledTimes(1);
      const calledTexts = translateBatch.mock.calls[0]![0] as string[];
      expect(calledTexts).toHaveLength(2);
      expect(calledTexts[1]).toBe('1 item');

      const reconstructCall = mockParser.reconstruct.mock.calls[0];
      const entries = reconstructCall[1] as Array<{ key: string; metadata?: Record<string, unknown> }>;
      const itemEntry = entries.find(e => e.key === 'item_count');
      expect(itemEntry).toBeDefined();
      const plurals = itemEntry!.metadata!['plurals'] as Array<{ quantity: string; value: string }>;
      expect(plurals.find(p => p.quantity === 'one')!.value).toBe('1 Artikel');
      expect(plurals.find(p => p.quantity === 'other')!.value).toBe('%d Artikel');
    });
  });

  describe('sync() — PO plural translation', () => {
    it('should translate msgid_plural and populate plural_forms metadata', async () => {
      setupLockManager(makeEmptyLockFile());

      const sourceJson = JSON.stringify({ item: 'item' }, null, 2) + '\n';
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Artikel', billedCharacters: 7 },
        { text: 'Artikel (pl)', billedCharacters: 12 },
      ]);
      const { service, registry } = createService({ translateBatch });

      const mockParser = {
        name: 'JSON',
        configKey: 'json',
        extensions: ['.json'],
        extract: jest.fn().mockReturnValue([
          {
            key: 'item',
            value: 'item',
            metadata: {
              msgid_plural: 'items',
              plural_forms: {},
            },
          },
        ]),
        reconstruct: jest.fn().mockReturnValue('{}'),
      };
      jest.spyOn(registry, 'getParser').mockReturnValue(mockParser);
      jest.spyOn(registry, 'getParserByFormatKey').mockReturnValue(mockParser);

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      await service.sync(makeConfig());

      expect(translateBatch).toHaveBeenCalledTimes(1);
      const calledTexts = translateBatch.mock.calls[0]![0] as string[];
      expect(calledTexts).toHaveLength(2);
      expect(calledTexts[0]).toBe('item');
      expect(calledTexts[1]).toBe('items');

      const reconstructCall = mockParser.reconstruct.mock.calls[0];
      const entries = reconstructCall[1] as Array<{ key: string; metadata?: Record<string, unknown> }>;
      const itemEntry = entries.find(e => e.key === 'item');
      expect(itemEntry).toBeDefined();
      const forms = itemEntry!.metadata!['plural_forms'] as Record<string, string>;
      expect(forms['msgstr[0]']).toBe('Artikel');
      expect(forms['msgstr[1]']).toBe('Artikel (pl)');
    });
  });

  describe('sync() — config.sync.concurrency wiring', () => {
    it('should use concurrency from config.sync when options.concurrency is not set', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Translated1', billedCharacters: 10 },
        { text: 'Translated2', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        target_locales: ['de', 'fr', 'es'],
        sync: {
          concurrency: 2,
          batch_size: 50,
        },
      });
      const result = await service.sync(config);

      expect(result.success).toBe(true);
      expect(translateBatch).toHaveBeenCalledTimes(3);
      expect(result.fileResults).toHaveLength(3);
    });

    it('should prefer options.concurrency over config.sync.concurrency', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Translated1', billedCharacters: 10 },
        { text: 'Translated2', billedCharacters: 10 },
      ]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        target_locales: ['de', 'fr'],
        sync: {
          concurrency: 1,
          batch_size: 50,
        },
      });
      const result = await service.sync(config, { concurrency: 5 });

      expect(result.success).toBe(true);
      expect(translateBatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('sync() — config.validation.fail_on_error', () => {
    it('should throw ValidationError when fail_on_error is true and validation errors exist', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const sourceJson = JSON.stringify({ greeting: 'Hello {name}' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        validation: {
          fail_on_error: true,
          check_placeholders: true,
        },
      });

      await expect(service.sync(config)).rejects.toThrow(
        'Sync completed but validation failed',
      );
    });

    it('should not throw when fail_on_error is false even with validation errors', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const sourceJson = JSON.stringify({ greeting: 'Hello {name}' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        validation: {
          fail_on_error: false,
          check_placeholders: true,
        },
      });

      const result = await service.sync(config);
      expect(result.validationErrors).toBeGreaterThan(0);
      expect(result.success).toBe(true);
    });
  });

  describe('sync() — config.validation.check_placeholders: false', () => {
    it('should skip validation when check_placeholders is false', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const sourceJson = JSON.stringify({ greeting: 'Hello {name}' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        validation: {
          check_placeholders: false,
          fail_on_error: true,
        },
      });

      const result = await service.sync(config);
      expect(result.validationErrors).toBe(0);
      expect(result.validationWarnings).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe('sync() — config.validation.validate_after_sync: false', () => {
    it('should skip validation entirely when validate_after_sync is false', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const sourceJson = JSON.stringify({ greeting: 'Hello {name}' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      const config = makeConfig({
        validation: {
          validate_after_sync: false,
          check_placeholders: true,
          fail_on_error: true,
        },
      });

      const result = await service.sync(config);
      expect(result.validationErrors).toBe(0);
      expect(result.validationWarnings).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe('sync() — plural billed characters', () => {
    it('should include characters billed for plural translations', async () => {
      setupLockManager(makeEmptyLockFile());

      const sourceJson = JSON.stringify({ item_count: '%d items' }, null, 2) + '\n';
      const translateBatch = jest.fn().mockResolvedValue([
        { text: '%d Artikel', billedCharacters: 10 },
        { text: '1 Artikel', billedCharacters: 9 },
      ]);
      const { service, registry } = createService({ translateBatch });

      const mockParser = {
        name: 'JSON',
        configKey: 'json',
        extensions: ['.json'],
        extract: jest.fn().mockReturnValue([
          {
            key: 'item_count',
            value: '%d items',
            metadata: {
              plurals: [
                { quantity: 'one', value: '1 item' },
                { quantity: 'other', value: '%d items' },
              ],
            },
          },
        ]),
        reconstruct: jest.fn().mockReturnValue('{}'),
      };
      jest.spyOn(registry, 'getParser').mockReturnValue(mockParser);
      jest.spyOn(registry, 'getParserByFormatKey').mockReturnValue(mockParser);

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      const result = await service.sync(makeConfig());
      expect(result.totalCharactersBilled).toBe(19);
    });
  });

  describe('sync() — cost cap (max_characters)', () => {
    it('should throw when estimated characters exceed max_characters', async () => {
      const { service } = createService();
      setupLockManager(makeEmptyLockFile());

      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue('{"greeting":"Hello World test string that is long"}');

      const config = makeConfig({
        sync: { concurrency: 1, batch_size: 50, max_characters: 10 },
      });

      await expect(service.sync(config)).rejects.toThrow('Cost cap exceeded');
    });

    it('should allow sync when --force overrides cost cap', async () => {
      const { mockTranslation: translationService, service } = createService();
      setupLockManager(makeEmptyLockFile());
      translationService.translateBatch.mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);

      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue('{"greeting":"Hello World test string"}');

      const config = makeConfig({
        sync: { concurrency: 1, batch_size: 50, max_characters: 10 },
      });

      const result = await service.sync(config, { force: true });
      expect(result.success).toBe(true);
    });
  });

  describe('sync() — frozen with fail_on_missing/fail_on_stale', () => {
    it('should not detect drift for new keys when fail_on_missing=false', async () => {
      const { service } = createService();
      setupLockManager(makeEmptyLockFile());

      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue('{"greeting":"Hello"}');

      const config = makeConfig({
        validation: { fail_on_missing: false },
      });

      const result = await service.sync(config, { frozen: true });
      expect(result.driftDetected).toBe(false);
    });

    it('should detect drift for stale keys even when fail_on_missing=false', async () => {
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue('{"greeting":"Hello Changed"}');

      setupLockManager(makeLockFileWithEntries({
        'locales/en.json': {
          greeting: {
            source_hash: computeSourceHash('Hello Original'),
            source_text: 'Hello Original',
            translations: { de: { hash: 'x', translated_at: '', status: 'translated' as const } },
          },
        },
      }));

      const config = makeConfig({
        validation: { fail_on_missing: false },
      });

      const result = await service.sync(config, { frozen: true });
      expect(result.driftDetected).toBe(true);
    });

    it('should not detect drift for stale keys when fail_on_stale=false', async () => {
      const { service } = createService();

      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue('{"greeting":"Hello Changed"}');

      setupLockManager(makeLockFileWithEntries({
        'locales/en.json': {
          greeting: {
            source_hash: computeSourceHash('Hello Original'),
            source_text: 'Hello Original',
            translations: { de: { hash: 'x', translated_at: '', status: 'translated' as const } },
          },
        },
      }));

      const config = makeConfig({
        validation: { fail_on_stale: false },
      });

      const result = await service.sync(config, { frozen: true });
      expect(result.driftDetected).toBe(false);
    });
  });

  describe('sync() — dryRun + force warning', () => {
    it('should warn when both dryRun and force are set', async () => {
      const { service } = createService();
      setupLockManager(makeEmptyLockFile());
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig(), { dryRun: true, force: true });

      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('--dry-run with --force'));
    });
  });

  describe('sync() — translation memory resolution', () => {
    const TM_UUID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const TM_UUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    it('should thread top-level TM id to every locale when no per-locale override', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
        { text: 'Auf Wiedersehen', billedCharacters: 14 },
      ]);
      const { service, mockTranslation } = createService({ translateBatch });
      mockTranslation.listTranslationMemories.mockResolvedValue([
        { translation_memory_id: TM_UUID_A, name: 'my-tm', source_language: 'en', target_languages: ['de'] },
      ]);
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig({
        translation: { translation_memory: 'my-tm' },
      }));

      expect(translateBatch).toHaveBeenCalled();
      const opts = translateBatch.mock.calls[0]![1] as Record<string, unknown>;
      expect(opts['translationMemoryId']).toBe(TM_UUID_A);
    });

    it('should apply per-locale override only to override locale when top-level is not set', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'x', billedCharacters: 1 },
        { text: 'y', billedCharacters: 1 },
      ]);
      const { service, mockTranslation } = createService({ translateBatch });
      mockTranslation.listTranslationMemories.mockResolvedValue([
        { translation_memory_id: TM_UUID_A, name: 'de-tm', source_language: 'en', target_languages: ['de'] },
      ]);
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig({
        target_locales: ['de', 'fr'],
        translation: {
          locale_overrides: { de: { translation_memory: 'de-tm' } },
        },
      }));

      const deCall = translateBatch.mock.calls.find(c => (c[1] as Record<string, unknown>)['targetLang'] === 'de');
      const frCall = translateBatch.mock.calls.find(c => (c[1] as Record<string, unknown>)['targetLang'] === 'fr');
      expect((deCall![1] as Record<string, unknown>)['translationMemoryId']).toBe(TM_UUID_A);
      expect((frCall![1] as Record<string, unknown>)['translationMemoryId']).toBeUndefined();
    });

    it('should prefer per-locale override TM id over top-level for override locale', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'x', billedCharacters: 1 },
        { text: 'y', billedCharacters: 1 },
      ]);
      const { service, mockTranslation } = createService({ translateBatch });
      mockTranslation.listTranslationMemories.mockResolvedValue([
        { translation_memory_id: TM_UUID_A, name: 'top-tm', source_language: 'en', target_languages: ['de'] },
        { translation_memory_id: TM_UUID_B, name: 'de-tm', source_language: 'en', target_languages: ['de'] },
      ]);
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig({
        target_locales: ['de'],
        translation: {
          translation_memory: 'top-tm',
          locale_overrides: { de: { translation_memory: 'de-tm' } },
        },
      }));

      const deCall = translateBatch.mock.calls.find(c => (c[1] as Record<string, unknown>)['targetLang'] === 'de');
      expect((deCall![1] as Record<string, unknown>)['translationMemoryId']).toBe(TM_UUID_B);
    });

    it('should prefer per-locale threshold over top-level threshold', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'x', billedCharacters: 1 },
        { text: 'y', billedCharacters: 1 },
      ]);
      const { service, mockTranslation } = createService({ translateBatch });
      mockTranslation.listTranslationMemories.mockResolvedValue([
        { translation_memory_id: TM_UUID_A, name: 'my-tm', source_language: 'en', target_languages: ['de'] },
      ]);
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig({
        target_locales: ['de'],
        translation: {
          translation_memory: 'my-tm',
          translation_memory_threshold: 60,
          locale_overrides: { de: { translation_memory_threshold: 90 } },
        },
      }));

      const deCall = translateBatch.mock.calls.find(c => (c[1] as Record<string, unknown>)['targetLang'] === 'de');
      expect((deCall![1] as Record<string, unknown>)['translationMemoryThreshold']).toBe(90);
    });

    it('should not resolve TM during dryRun', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service, mockTranslation } = createService();
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig({
        translation: {
          translation_memory: 'my-tm',
          locale_overrides: { de: { translation_memory: 'de-tm' } },
        },
      }), { dryRun: true });

      expect(mockTranslation.listTranslationMemories).not.toHaveBeenCalled();
    });

    it('should throw ConfigError when top-level TM does not support all target locales', async () => {
      setupLockManager(makeEmptyLockFile());
      const { service, mockTranslation } = createService();
      mockTranslation.listTranslationMemories.mockResolvedValue([
        { translation_memory_id: TM_UUID_A, name: 'shared-tm', source_language: 'en', target_languages: ['de'] },
      ]);
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await expect(service.sync(makeConfig({
        target_locales: ['de', 'fr'],
        translation: {
          translation_memory: 'shared-tm',
          locale_overrides: { de: { translation_memory: 'shared-tm' } },
        },
      }))).rejects.toThrow(/does not support the requested language pair/);
    });

    it('should reuse tmCache across top-level and per-locale override with same name', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: 'x', billedCharacters: 1 },
        { text: 'y', billedCharacters: 1 },
      ]);
      const { service, mockTranslation } = createService({ translateBatch });
      mockTranslation.listTranslationMemories.mockResolvedValue([
        { translation_memory_id: TM_UUID_A, name: 'shared-tm', source_language: 'en', target_languages: ['de'] },
      ]);
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig({
        target_locales: ['de'],
        translation: {
          translation_memory: 'shared-tm',
          locale_overrides: { de: { translation_memory: 'shared-tm' } },
        },
      }));

      expect(mockTranslation.listTranslationMemories).toHaveBeenCalledTimes(1);
    });
  });

  describe('sync() — glossary resolution', () => {
    it('should resolve glossary ID when config.translation.glossary is set', async () => {
      const { service, mockGlossary } = createService();
      setupLockManager(makeEmptyLockFile());
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue(SOURCE_JSON);
      mockGlossary.resolveGlossaryId.mockResolvedValue('glos-123');

      await service.sync(makeConfig({
        translation: { glossary: 'my-glossary' },
      }));

      expect(mockGlossary.resolveGlossaryId).toHaveBeenCalledWith('my-glossary');
    });

    it('should not resolve glossary during dryRun', async () => {
      const { service, mockGlossary } = createService();
      setupLockManager(makeEmptyLockFile());
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue(SOURCE_JSON);

      await service.sync(makeConfig({
        translation: { glossary: 'my-glossary' },
      }), { dryRun: true });

      expect(mockGlossary.resolveGlossaryId).not.toHaveBeenCalled();
    });
  });

  describe('sync() — context override', () => {
    it('should use context.overrides for single-key batches', async () => {
      const { mockTranslation: translationService, service } = createService();
      setupLockManager(makeEmptyLockFile());
      translationService.translateBatch.mockResolvedValue([
        { text: 'Hallo', billedCharacters: 5 },
      ]);

      mockExtractAllKeyContexts.mockResolvedValue({ keyContexts: new Map(), templatePatterns: [] });
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      mockReadFile.mockResolvedValue('{"greeting":"Hello"}');

      const config = makeConfig({
        context: {
          enabled: true,
          overrides: { greeting: 'Save button in toolbar' },
        },
      });

      await service.sync(config);

      const callArgs = translationService.translateBatch.mock.calls[0]!;
      const opts = callArgs[1] as unknown as Record<string, unknown>;
      expect(opts['context']).toBe('Save button in toolbar');
    });
  });

  describe('sync() — empty string values preserved', () => {
    it('should not drop keys with empty string values', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([
        { text: '', billedCharacters: 0 },
        { text: 'Hallo', billedCharacters: 5 },
      ]);
      const { service } = createService({ translateBatch });

      const sourceJson = JSON.stringify({ empty_key: '', greeting: 'Hello' }, null, 2) + '\n';
      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return sourceJson;
        throw new Error('ENOENT');
      });

      const config = makeConfig();
      const result = await service.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(translateBatch).toHaveBeenCalledWith(
        expect.arrayContaining(['']),
        expect.anything(),
      );
      expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1);
      const writtenContent = JSON.parse(String(mockAtomicWriteFile.mock.calls[0]![1]));
      expect(writtenContent).toHaveProperty('empty_key');
    });
  });

  describe('sync() — all translations failed sets success false', () => {
    it('should set success to false when all file results have only failures', async () => {
      setupLockManager(makeEmptyLockFile());
      const translateBatch = jest.fn().mockResolvedValue([null, null]);
      const { service } = createService({ translateBatch });

      mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
      mockReadFile.mockImplementation(async (p: unknown) => {
        if (String(p) === '/test/locales/en.json') return SOURCE_JSON;
        throw new Error('ENOENT');
      });

      const config = makeConfig();
      const result = await service.sync(config);

      expect(result.success).toBe(false);
      expect(result.fileResults.length).toBeGreaterThan(0);
      expect(result.fileResults.every(fr => fr.translated === 0)).toBe(true);
    });
  });
});

describe('resolveTargetPath()', () => {
  it('should replace locale in filename', () => {
    expect(resolveTargetPath('locales/en.json', 'en', 'de')).toBe('locales/de.json');
  });

  it('should replace locale in directory path', () => {
    expect(resolveTargetPath('locales/en/common.json', 'en', 'de')).toBe('locales/de/common.json');
  });

  it('should not partially match within longer words', () => {
    expect(resolveTargetPath('locales/en.json', 'en', 'de')).toBe('locales/de.json');
    expect(resolveTargetPath('content/en.json', 'en', 'de')).toBe('content/de.json');
  });

  it('should handle path with dots in directory name', () => {
    expect(resolveTargetPath('my.app/locales/en/messages.json', 'en', 'fr'))
      .toBe('my.app/locales/fr/messages.json');
  });

  it('should replace at start of path', () => {
    expect(resolveTargetPath('en/messages.json', 'en', 'de')).toBe('de/messages.json');
  });

  it('should handle regional locale codes', () => {
    expect(resolveTargetPath('locales/en-US.json', 'en-US', 'de-DE')).toBe('locales/de-DE.json');
  });

  it('should handle multiple occurrences', () => {
    expect(resolveTargetPath('en/data/en.json', 'en', 'de')).toBe('de/data/de.json');
  });
});

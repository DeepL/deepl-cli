import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { processBucket } from '../../../src/sync/sync-process-bucket';
import type { ProcessBucketDeps } from '../../../src/sync/sync-process-bucket';
import type { ResolvedSyncConfig } from '../../../src/sync/sync-config';
import type { SyncLockFile } from '../../../src/sync/types';
import type { WalkedBucketFile } from '../../../src/sync/sync-bucket-walker';
import type { LocaleTranslator, TranslateLocaleResult } from '../../../src/sync/sync-locale-translator';
import type { GlossaryService } from '../../../src/services/glossary';
import { ValidationError } from '../../../src/utils/errors';
import { createMockTranslationService } from '../../helpers/mock-factories';

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

function makeLockFile(): SyncLockFile {
  return {
    _comment: '',
    version: 1,
    generated_at: new Date().toISOString(),
    source_locale: 'en',
    entries: {},
    stats: { total_keys: 0, total_translations: 0, last_sync: '' },
  };
}

function makeConfig(projectRoot: string, targetPathPattern: string): ResolvedSyncConfig {
  return {
    version: 1,
    source_locale: 'en',
    target_locales: ['de'],
    buckets: {
      json: { include: ['locales/en.json'], target_path_pattern: targetPathPattern },
    },
    projectRoot,
    configPath: path.join(projectRoot, '.deepl-sync.yaml'),
    overrides: {},
  };
}

function makeTranslateResult(): TranslateLocaleResult {
  return {
    fileResult: { file: 'locales/de.json', locale: 'de', translated: 1, skipped: 0, failed: 0, written: true },
    successfulKeys: ['greeting'],
    charactersBilled: 5,
    billedPerKey: new Map(),
    contextSentKeys: new Set(),
    instructionSentKeys: new Set(),
    instructionGroupCounts: new Map(),
    targetEntries: new Map([['greeting', 'Hallo']]),
    validationWarnings: 0,
    validationErrors: 0,
  };
}

function makeDeps(
  config: ResolvedSyncConfig,
  translate: jest.Mock,
): ProcessBucketDeps {
  return {
    config,
    options: undefined,
    lockFile: makeLockFile(),
    sourceEntryMap: new Map(),
    targetEntryMap: new Map(),
    allContextSentKeys: new Set(),
    allInstructionSentKeys: new Set(),
    allInstructionGroupTotals: new Map(),
    keyContexts: new Map(),
    localeTranslator: { translate } as unknown as LocaleTranslator,
    glossaryService: { resolveGlossaryId: jest.fn() } as unknown as GlossaryService,
    translationService: createMockTranslationService(),
    tmCache: { has: () => false, get: () => undefined, set: () => undefined },
    currentTotalCharsBilled: 0,
  };
}

function makeWalked(config: ResolvedSyncConfig): WalkedBucketFile {
  return {
    bucket: 'json',
    bucketConfig: config.buckets['json']!,
    parser: {
      name: 'JSON',
      configKey: 'json',
      extensions: ['.json'],
      extract: jest.fn().mockReturnValue([]),
      reconstruct: jest.fn().mockReturnValue('{}'),
    },
    sourceFile: path.join(config.projectRoot, 'locales/en.json'),
    relPath: 'locales/en.json',
    content: '{"greeting":"Hello"}',
    entries: [{ key: 'greeting', value: 'Hello' }],
    skippedEntries: [],
  } as unknown as WalkedBucketFile;
}

describe('processBucket', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-process-bucket-'));
    fs.mkdirSync(path.join(tmpDir, 'locales'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('target path containment', () => {
    it('should throw ValidationError before translating when the target path escapes the project root', async () => {
      const config = makeConfig(tmpDir, '../outside/{locale}.json');
      const translate = jest.fn().mockResolvedValue(makeTranslateResult());

      await expect(
        processBucket(makeWalked(config), makeDeps(config, translate)),
      ).rejects.toThrow(/escapes project root/);
      expect(translate).not.toHaveBeenCalled();
    });

    it('should not read target files outside the project root during the pre-read', async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-outside-'));
      try {
        const secret = path.join(outsideDir, 'de.json');
        fs.writeFileSync(secret, '{"secret":"value"}', 'utf-8');
        const relOutside = path.relative(tmpDir, outsideDir);
        const config = makeConfig(tmpDir, path.posix.join(...relOutside.split(path.sep), '{locale}.json'));
        const translate = jest.fn().mockResolvedValue(makeTranslateResult());
        const readSpy = jest.spyOn(fs.promises, 'readFile');

        await expect(
          processBucket(makeWalked(config), makeDeps(config, translate)),
        ).rejects.toThrow(ValidationError);
        expect(readSpy.mock.calls.map((c) => String(c[0]))).not.toContain(secret);
        readSpy.mockRestore();
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('should rethrow a containment ValidationError raised inside the locale translator', async () => {
      const config = makeConfig(tmpDir, 'locales/{locale}.json');
      const translate = jest.fn().mockRejectedValue(
        new ValidationError('Target path escapes project root: /evil/de.json'),
      );

      await expect(
        processBucket(makeWalked(config), makeDeps(config, translate)),
      ).rejects.toThrow(/escapes project root/);
    });

    it('should still absorb generic per-locale translation failures', async () => {
      const config = makeConfig(tmpDir, 'locales/{locale}.json');
      const translate = jest.fn().mockRejectedValue(new Error('network hiccup'));

      const result = await processBucket(makeWalked(config), makeDeps(config, translate));

      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0]!.written).toBe(false);
      expect(result.fileResults[0]!.failed).toBeGreaterThan(0);
    });
  });

  describe('happy path', () => {
    it('should translate contained targets and report the file result', async () => {
      const config = makeConfig(tmpDir, 'locales/{locale}.json');
      const translate = jest.fn().mockResolvedValue(makeTranslateResult());

      const result = await processBucket(makeWalked(config), makeDeps(config, translate));

      expect(translate).toHaveBeenCalledTimes(1);
      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0]!.written).toBe(true);
    });
  });
});

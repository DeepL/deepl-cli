/**
 * Tests that source text is never written into a target locale file and
 * recorded as a translation.
 *
 * When the lockfile claims a locale already has a translation for a key but
 * the target file supplies none — the file was deleted to force regeneration,
 * or the stored translation was empty — the key must be re-translated. Using
 * the SOURCE value and recording it as `translated` would leave English in the
 * file permanently, because no later run would revisit the key.
 */

import { LocaleTranslator } from '../../../src/sync/sync-locale-translator';
import type { LocaleTranslatorContext } from '../../../src/sync/sync-locale-translator';
import type { ResolvedSyncConfig } from '../../../src/sync/sync-config';
import type { SyncDiff } from '../../../src/sync/types';
import type { KeyContext } from '../../../src/sync/sync-context';
import type { FormatParser, TranslatedEntry } from '../../../src/formats/format';
import { createMockTranslationService } from '../../helpers/mock-factories';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    mkdir: jest.fn(),
    copyFile: jest.fn(),
  },
}));

jest.mock('../../../src/utils/atomic-write', () => ({
  atomicWriteFile: jest.fn(),
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

jest.mock('../../../src/sync/sync-utils', () => ({
  resolveTargetPath: jest.fn(),
  assertPathWithinRoot: jest.fn(),
}));

jest.mock('../../../src/sync/translation-validator', () => ({
  validateBatch: jest.fn(),
}));

import * as fs from 'fs';
import { atomicWriteFile } from '../../../src/utils/atomic-write';
import { resolveTargetPath, assertPathWithinRoot } from '../../../src/sync/sync-utils';
import { validateBatch } from '../../../src/sync/translation-validator';

const mockReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;
const mockMkdir = fs.promises.mkdir as jest.MockedFunction<typeof fs.promises.mkdir>;
const mockAtomicWriteFile = atomicWriteFile as jest.MockedFunction<typeof atomicWriteFile>;
const mockResolveTargetPath = resolveTargetPath as jest.MockedFunction<typeof resolveTargetPath>;
const mockAssertPathWithinRoot = assertPathWithinRoot as jest.MockedFunction<
  typeof assertPathWithinRoot
>;
const mockValidateBatch = validateBatch as jest.MockedFunction<typeof validateBatch>;

/** Captures what reconstruct() was asked to write. */
let reconstructedEntries: TranslatedEntry[] = [];

function makeParser(): FormatParser {
  return {
    name: 'JSON',
    configKey: 'json',
    extensions: ['.json'],
    extract: jest.fn().mockReturnValue([]),
    reconstruct: jest.fn((_content: string, entries: TranslatedEntry[]) => {
      reconstructedEntries = entries;
      return '{}';
    }),
  };
}

function makeConfig(): ResolvedSyncConfig {
  return {
    version: 1,
    source_locale: 'en',
    target_locales: ['de'],
    buckets: {},
    projectRoot: '/project',
    configPath: '/project/.deepl-sync.yaml',
    overrides: {},
    translation: {},
    validation: { validate_after_sync: false },
  };
}

/**
 * Precondition under test: the key is `current` (unchanged source), the
 * lockfile says this locale has a translation, but the target file supplies
 * none — the file was deleted, or held an empty value.
 */
function makeCtx(existingForLocale: Map<string, string>): LocaleTranslatorContext {
  const diffs: SyncDiff[] = [{ key: 'greeting', value: 'Hello', status: 'current' }];
  return {
    locale: 'de',
    relPath: 'locales/en.json',
    content: '{}',
    parser: makeParser(),
    diffs,
    toTranslate: [],
    fileLockEntries: {
      greeting: {
        source_hash: 'abc',
        source_text: 'Hello',
        translations: {
          de: { character_count: 5, hash: 'abc', status: 'translated', translated_at: '2026-01-01' },
        },
      },
    } as unknown as LocaleTranslatorContext['fileLockEntries'],
    existingTargetEntries: new Map([['de', existingForLocale]]),
    keyContexts: new Map<string, KeyContext>(),
    localeGlossaryIds: new Map(),
    localeTmIds: new Map(),
    bucketConfig: { include: ['locales/en.json'] },
    isMultiLocale: false,
  };
}

describe('source text as translation', () => {
  beforeEach(() => {
    reconstructedEntries = [];
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockMkdir.mockResolvedValue(undefined);
    mockAtomicWriteFile.mockResolvedValue(undefined);
    mockResolveTargetPath.mockReturnValue('locales/de.json');
    mockAssertPathWithinRoot.mockReturnValue(undefined);
    mockValidateBatch.mockReturnValue([]);
  });

  it('should translate the key instead of writing the source when the target file is missing it', async () => {
    const service = createMockTranslationService();
    service.translateBatch = jest
      .fn()
      .mockResolvedValue([{ text: 'Hallo', billedCharacters: 5, detectedSourceLanguage: 'en' }]);
    const translator = new LocaleTranslator(service, new Set<string>(), makeConfig(), undefined, undefined, undefined, undefined);

    await translator.translate(makeCtx(new Map()));

    const written = reconstructedEntries.find((e) => e.key === 'greeting');
    expect(written?.translation).toBe('Hallo');
    expect(written?.translation).not.toBe('Hello');
  });

  it('should request a translation for the key rather than skipping it', async () => {
    const service = createMockTranslationService();
    const translateBatch = jest
      .fn()
      .mockResolvedValue([{ text: 'Hallo', billedCharacters: 5, detectedSourceLanguage: 'en' }]);
    service.translateBatch = translateBatch;
    const translator = new LocaleTranslator(service, new Set<string>(), makeConfig(), undefined, undefined, undefined, undefined);

    await translator.translate(makeCtx(new Map()));

    // The source text may be sent in any batch, so look across all calls
    // rather than assuming which one carries it.
    const sentTexts = translateBatch.mock.calls.flatMap(
      (call) => (call as unknown[])[0] as string[],
    );
    expect(sentTexts).toContain('Hello');
  });

  it('should keep an existing translation when the target file has one', async () => {
    const service = createMockTranslationService();
    service.translateBatch = jest.fn().mockResolvedValue([]);
    const translator = new LocaleTranslator(service, new Set<string>(), makeConfig(), undefined, undefined, undefined, undefined);

    await translator.translate(makeCtx(new Map([['greeting', 'Guten Tag']])));

    expect(reconstructedEntries.find((e) => e.key === 'greeting')?.translation).toBe('Guten Tag');
    // translateBatch is still invoked, but with nothing to do — the point is
    // that the already-translated key is not re-sent.
    const sentTexts = (service.translateBatch as jest.Mock).mock.calls.flatMap(
      (call) => (call as unknown[])[0] as string[],
    );
    expect(sentTexts).not.toContain('Hello');
  });
});

import { computeSyncStatus } from '../../../src/sync/sync-status';
import type { ResolvedSyncConfig } from '../../../src/sync/sync-config';
import type { FormatRegistry, FormatParser, ExtractedEntry } from '../../../src/formats/index';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    access: jest.fn(),
  },
}));
jest.mock('fast-glob', () => jest.fn());
jest.mock('../../../src/sync/sync-lock');
jest.mock('../../../src/sync/sync-differ');

import * as fs from 'fs';
import fg from 'fast-glob';
import { SyncLockManager } from '../../../src/sync/sync-lock';
import { computeDiff } from '../../../src/sync/sync-differ';

const mockFg = fg as jest.MockedFunction<typeof fg>;
const mockReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;
const mockComputeDiff = computeDiff as jest.MockedFunction<typeof computeDiff>;

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

function makeParser(): FormatParser {
  return {
    name: 'JSON',
    configKey: 'json',
    extensions: ['.json'],
    extract: jest.fn().mockReturnValue([
      { key: 'greeting', value: 'Hello' },
      { key: 'farewell', value: 'Goodbye' },
    ] as ExtractedEntry[]),
    reconstruct: jest.fn(),
  };
}

function makeRegistry(parser: FormatParser): FormatRegistry {
  return {
    getParser: jest.fn().mockReturnValue(parser),
    getParserByFormatKey: jest.fn().mockReturnValue(parser),
    register: jest.fn(),
    getSupportedExtensions: jest.fn(),
    getFormatKeys: jest.fn().mockReturnValue([parser.configKey]),
  } as unknown as FormatRegistry;
}

describe('computeSyncStatus', () => {
  beforeEach(() => {
    (SyncLockManager as jest.Mock).mockImplementation(() => ({
      read: jest.fn().mockResolvedValue({ entries: {}, source_locale: 'en', version: 1, _comment: '', generated_at: '', stats: { total_keys: 0, total_translations: 0, last_sync: '' } }),
    }));
    mockFg.mockResolvedValue(['/test/locales/en.json'] as never);
    mockReadFile.mockResolvedValue('{}');
    mockComputeDiff.mockReturnValue([
      { key: 'greeting', status: 'current', value: 'Hello' },
      { key: 'farewell', status: 'new', value: 'Goodbye' },
    ]);
  });

  it('should return status with correct source locale and key count', async () => {
    const parser = makeParser();
    const result = await computeSyncStatus(makeConfig(), makeRegistry(parser));
    expect(result.sourceLocale).toBe('en');
    expect(result.totalKeys).toBe(2);
  });

  it('should report missing keys for new entries without translations', async () => {
    const parser = makeParser();
    const result = await computeSyncStatus(makeConfig(), makeRegistry(parser));
    expect(result.locales[0]!.missing).toBeGreaterThan(0);
  });

  it('should report 100% when all keys are current with translations', async () => {
    mockComputeDiff.mockReturnValue([
      { key: 'greeting', status: 'current', value: 'Hello' },
      { key: 'farewell', status: 'current', value: 'Goodbye' },
    ]);
    (SyncLockManager as jest.Mock).mockImplementation(() => ({
      read: jest.fn().mockResolvedValue({
        entries: {
          'locales/en.json': {
            greeting: { source_hash: 'a', source_text: 'Hello', translations: { de: { hash: 'a', translated_at: '', status: 'translated' } } },
            farewell: { source_hash: 'c', source_text: 'Goodbye', translations: { de: { hash: 'c', translated_at: '', status: 'translated' } } },
          },
        },
        source_locale: 'en', version: 1, _comment: '', generated_at: '', stats: { total_keys: 2, total_translations: 2, last_sync: '' },
      }),
    }));
    const parser = makeParser();
    const result = await computeSyncStatus(makeConfig(), makeRegistry(parser));
    expect(result.locales[0]!.coverage).toBe(100);
  });

  it('should handle empty source file', async () => {
    const parser = makeParser();
    (parser.extract as jest.Mock).mockReturnValue([]);
    mockComputeDiff.mockReturnValue([]);
    const result = await computeSyncStatus(makeConfig(), makeRegistry(parser));
    expect(result.totalKeys).toBe(0);
  });

  it('should handle multiple target locales', async () => {
    const config = makeConfig({ target_locales: ['de', 'fr'] });
    const parser = makeParser();
    const result = await computeSyncStatus(config, makeRegistry(parser));
    expect(result.locales).toHaveLength(2);
    expect(result.locales[0]!.locale).toBe('de');
    expect(result.locales[1]!.locale).toBe('fr');
  });

  it('should not count deleted diffs in coverage stats', async () => {
    mockComputeDiff.mockReturnValue([
      { key: 'greeting', status: 'current', value: 'Hello' },
      { key: 'removed_key', status: 'deleted', previous_hash: 'abc123' },
    ]);
    (SyncLockManager as jest.Mock).mockImplementation(() => ({
      read: jest.fn().mockResolvedValue({
        entries: {
          'locales/en.json': {
            greeting: { source_hash: 'a', source_text: 'Hello', translations: { de: { hash: 'a', translated_at: '', status: 'translated' } } },
            removed_key: { source_hash: 'abc123', source_text: 'Old text', translations: { de: { hash: 'abc123', translated_at: '', status: 'translated' } } },
          },
        },
        source_locale: 'en', version: 1, _comment: '', generated_at: '', stats: { total_keys: 2, total_translations: 2, last_sync: '' },
      }),
    }));
    const parser = makeParser();
    const result = await computeSyncStatus(makeConfig(), makeRegistry(parser));
    const deStats = result.locales[0]!;
    expect(deStats.complete).toBe(1);
    expect(deStats.missing).toBe(0);
    expect(deStats.outdated).toBe(0);
    expect(deStats.complete + deStats.missing + deStats.outdated).toBe(1);
  });

  it('should resolve documented android_xml bucket keys via the registry config-key lookup', async () => {
    const parser = makeParser();
    const registry = makeRegistry(parser);

    await computeSyncStatus(
      makeConfig({
        buckets: { android_xml: { include: ['res/values/strings.xml'] } },
      }),
      registry,
    );

    expect(registry.getParserByFormatKey).toHaveBeenCalledWith('android_xml');
  });
});

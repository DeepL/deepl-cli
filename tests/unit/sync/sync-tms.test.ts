/**
 * Unit coverage for the walker-skip-partition invariant on the TMS push/pull
 * pipeline.
 *
 * The translation-bucket walker partitions extract output into `entries`
 * (translatable) and `skippedEntries` (metadata.skipped — currently Laravel
 * pipe-pluralization). Every inline `parser.extract(...)` site in push/pull
 * must re-apply that partition, or skipped pipe-plural values reach
 * `TmsClient.pushKey(...)` and the pull-merge translation set. These tests
 * lock the invariant in at each inline extract point plus the runtime guard on
 * `TmsClient.pushEntry(...)`.
 */
import * as path from 'path';

import {
  partitionEntries,
  type WalkedBucketFile,
} from '../../../src/sync/sync-bucket-walker';
import {
  formatSkippedSummary,
  pullTranslations,
  pushTranslations,
  type SkippedRecord,
} from '../../../src/sync/sync-tms';
import { TmsClient } from '../../../src/sync/tms-client';
import { FormatRegistry } from '../../../src/formats/index';
import type { FormatParser, ExtractedEntry } from '../../../src/formats/format';
import type { ResolvedSyncConfig } from '../../../src/sync/sync-config';
import { SKIP_REASON_PIPE_PLURALIZATION } from '../../../src/formats/php-arrays';

jest.mock('fast-glob', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
      stat: jest.fn().mockResolvedValue({ size: 1024 }),
    },
  };
});
jest.mock('../../../src/utils/atomic-write', () => ({
  atomicWriteFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../src/sync/sync-lock', () => {
  const actual = jest.requireActual('../../../src/sync/sync-lock');
  return {
    ...actual,
    SyncLockManager: jest.fn().mockImplementation(() => ({
      read: jest.fn().mockResolvedValue({
        _comment: '', version: 1, generated_at: '', source_locale: 'en',
        entries: {}, stats: { total_keys: 0, total_translations: 0, last_sync: '' },
      }),
      write: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

import fg from 'fast-glob';
import * as fs from 'fs';

const mockFg = fg as jest.MockedFunction<typeof fg>;
const mockReadFileSync = fs.readFileSync as jest.Mock;
const mockReadFile = fs.promises.readFile as jest.Mock;

function makeConfig(overrides: Partial<ResolvedSyncConfig> = {}): ResolvedSyncConfig {
  return {
    version: 1,
    source_locale: 'en',
    target_locales: ['de'],
    buckets: { laravel_php: { include: ['lang/en.php'] } },
    configPath: '/test/.deepl-sync.yaml',
    projectRoot: '/test',
    overrides: {},
    ...overrides,
  };
}

function makeStubParser(
  extractResults: ExtractedEntry[][] | ExtractedEntry[],
  opts: { multiLocale?: boolean; configKey?: string } = {},
): FormatParser {
  const queue = Array.isArray(extractResults[0]) && typeof extractResults[0] !== 'string'
    ? (extractResults as ExtractedEntry[][]).slice()
    : null;
  const single = !queue ? (extractResults as ExtractedEntry[]) : null;

  return {
    name: 'Stub',
    configKey: opts.configKey ?? 'laravel_php',
    extensions: ['.php'],
    ...(opts.multiLocale ? { multiLocale: true as const } : {}),
    extract: jest.fn(() => {
      if (queue) return queue.shift() ?? [];
      return single!;
    }),
    reconstruct: jest.fn((content) => content),
  };
}

function makeRegistryWithParser(parser: FormatParser): FormatRegistry {
  const reg = new FormatRegistry();
  reg.register(parser);
  return reg;
}

function makeTmsClient(): TmsClient {
  const client = new TmsClient({
    serverUrl: 'https://tms.test',
    projectId: 'proj-1',
    apiKey: 'k',
  });
  jest.spyOn(client, 'pushKey').mockResolvedValue(undefined);
  jest.spyOn(client, 'pullKeys').mockResolvedValue({});
  return client;
}

describe('partitionEntries', () => {
  it('returns empty arrays for empty input', () => {
    expect(partitionEntries([])).toEqual({ entries: [], skippedEntries: [] });
  });

  it('routes entries without metadata.skipped into entries', () => {
    const input: ExtractedEntry[] = [
      { key: 'a', value: 'Hello' },
      { key: 'b', value: 'World' },
    ];
    const { entries, skippedEntries } = partitionEntries(input);
    expect(entries.map((e) => e.key)).toEqual(['a', 'b']);
    expect(skippedEntries).toEqual([]);
  });

  it('routes entries tagged with metadata.skipped into skippedEntries', () => {
    const input: ExtractedEntry[] = [
      { key: 'a', value: 'Hello' },
      {
        key: 'pluralized',
        value: '{0} no|{1} one|[2,*] many',
        metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
      },
      { key: 'c', value: 'Goodbye' },
    ];
    const { entries, skippedEntries } = partitionEntries(input);
    expect(entries.map((e) => e.key)).toEqual(['a', 'c']);
    expect(skippedEntries.map((e) => e.key)).toEqual(['pluralized']);
  });

  it('preserves order within each partition', () => {
    const input: ExtractedEntry[] = [
      { key: 'a', value: 'a' },
      { key: 's1', value: 's1', metadata: { skipped: { reason: 'x' } } },
      { key: 'b', value: 'b' },
      { key: 's2', value: 's2', metadata: { skipped: { reason: 'y' } } },
    ];
    const { entries, skippedEntries } = partitionEntries(input);
    expect(entries.map((e) => e.key)).toEqual(['a', 'b']);
    expect(skippedEntries.map((e) => e.key)).toEqual(['s1', 's2']);
  });

  it('treats metadata without the skipped key as translatable', () => {
    const input: ExtractedEntry[] = [
      { key: 'a', value: 'Hello', metadata: { description: 'greeting' } },
    ];
    const { entries, skippedEntries } = partitionEntries(input);
    expect(entries).toHaveLength(1);
    expect(skippedEntries).toHaveLength(0);
  });

  it('is a structural type guard — satisfies WalkedBucketFile split shape', () => {
    const input: ExtractedEntry[] = [
      { key: 'a', value: 'a' },
      { key: 's', value: 's', metadata: { skipped: { reason: 'x' } } },
    ];
    const result = partitionEntries(input);
    const walked = {
      bucket: 'json',
      bucketConfig: { include: [] },
      parser: {} as FormatParser,
      sourceFile: '/x/a.json',
      relPath: 'a.json',
      content: '',
      isMultiLocale: false,
      ...result,
    } satisfies Omit<WalkedBucketFile, 'bucket'> & { bucket: string };
    expect(walked.entries).toHaveLength(1);
    expect(walked.skippedEntries).toHaveLength(1);
  });
});

describe('TmsClient.pushEntry — runtime skip-partition guard', () => {
  it('rejects entries with metadata.skipped and names the walker partition', async () => {
    const client = new TmsClient({
      serverUrl: 'https://tms.test',
      projectId: 'p',
      apiKey: 'k',
    });
    const pushKeySpy = jest.spyOn(client, 'pushKey').mockResolvedValue(undefined);
    const skipped: ExtractedEntry = {
      key: 'msgs.apples',
      value: '{0} none|{1} one|[2,*] many',
      metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
    };

    await expect(client.pushEntry(skipped, 'de')).rejects.toThrow(/walker/i);
    await expect(client.pushEntry(skipped, 'de')).rejects.toThrow(/skipped/i);
    expect(pushKeySpy).not.toHaveBeenCalled();
  });

  it('forwards translatable entries to pushKey unchanged', async () => {
    const client = new TmsClient({
      serverUrl: 'https://tms.test',
      projectId: 'p',
      apiKey: 'k',
    });
    const pushKeySpy = jest.spyOn(client, 'pushKey').mockResolvedValue(undefined);
    await client.pushEntry({ key: 'greeting', value: 'Hallo' }, 'de');
    expect(pushKeySpy).toHaveBeenCalledWith('greeting', 'de', 'Hallo');
  });
});

describe('pushTranslations — skip-partition invariant at inline extract sites', () => {
  beforeEach(() => {
    mockFg.mockReset();
    mockReadFile.mockReset();
    mockReadFileSync.mockReset();
  });

  it('non-multi-locale target extract: pipe-plural keys never reach pushKey (line 68)', async () => {
    mockFg.mockResolvedValue(['/test/lang/en.php'] as never);
    // Walker reads source file (en.php) once:
    mockReadFile.mockResolvedValue('<?php return [];');
    // Per-locale target-file read (de.php) happens via readFileSync inside push:
    mockReadFileSync.mockReturnValue('<?php return [];');

    // Two extract() calls: once for the walker (source), once per-locale for the
    // target inside pushTranslations. Both return a mixed entry set.
    const mixedEntries: ExtractedEntry[] = [
      { key: 'greeting', value: 'Hallo' },
      {
        key: 'plural.apples',
        value: '{0} no apples|{1} one apple|[2,*] many apples',
        metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
      },
      { key: 'farewell', value: 'Tschüss' },
    ];
    const parser = makeStubParser([mixedEntries, mixedEntries]);
    const client = makeTmsClient();

    const result = await pushTranslations(
      makeConfig(),
      client,
      makeRegistryWithParser(parser),
    );

    const pushKeyMock = client.pushKey as jest.Mock;
    const pushedKeys = pushKeyMock.mock.calls.map((args) => args[0]);
    expect(pushedKeys).toEqual(expect.arrayContaining(['greeting', 'farewell']));
    expect(pushedKeys).not.toContain('plural.apples');
    expect(result.pushed).toBe(2);
    expect(result.skipped).toContainEqual({
      file: expect.any(String),
      locale: 'de',
      reason: 'pipe_pluralization',
      key: 'plural.apples',
    });
  });

  it('multi-locale source extract: pipe-plural keys never reach pushKey (line 62)', async () => {
    mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
    mockReadFile.mockResolvedValue('{}');

    const mixedEntries: ExtractedEntry[] = [
      { key: 'greeting', value: 'Hallo' },
      {
        key: 'plural.apples',
        value: '{0} no|{1} one|[2,*] many',
        metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
      },
    ];
    const parser = makeStubParser([mixedEntries, mixedEntries], {
      multiLocale: true,
      configKey: 'xcstrings',
    });
    const client = makeTmsClient();

    const config = makeConfig({
      buckets: { xcstrings: { include: ['Localizable.xcstrings'] } },
    });
    const result = await pushTranslations(config, client, makeRegistryWithParser(parser));

    const pushKeyMock = client.pushKey as jest.Mock;
    expect(pushKeyMock.mock.calls.map((a) => a[0])).toEqual(['greeting']);
    expect(result.pushed).toBe(1);
  });

  it('records one skip per (file, locale, key) — never invokes pushKey with skipped entries', async () => {
    mockFg.mockResolvedValue(['/test/lang/en.php'] as never);
    mockReadFile.mockResolvedValue('<?php return [];');
    mockReadFileSync.mockReturnValue('<?php return [];');

    const mixedEntries: ExtractedEntry[] = [
      { key: 'a', value: 'a' },
      {
        key: 'p',
        value: '{0} no|{1} one',
        metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
      },
    ];
    const parser = makeStubParser([mixedEntries, mixedEntries, mixedEntries]);
    const client = makeTmsClient();

    const config = makeConfig({ target_locales: ['de', 'fr'] });
    const result = await pushTranslations(config, client, makeRegistryWithParser(parser));

    const pushKeyMock = client.pushKey as jest.Mock;
    for (const args of pushKeyMock.mock.calls) {
      expect(args[0]).not.toBe('p');
    }
    expect(result.pushed).toBe(2);
    const skippedKeys = result.skipped
      .filter((s) => s.reason === 'pipe_pluralization')
      .map((s) => `${s.locale}:${s.key}`);
    expect(skippedKeys.sort()).toEqual(['de:p', 'fr:p']);
  });
});

describe('pullTranslations — skip-partition invariant at pull-merge extract (lines 144-145)', () => {
  const { SyncLockManager: MockLockManager } = jest.requireMock('../../../src/sync/sync-lock');

  beforeEach(() => {
    mockFg.mockReset();
    mockReadFile.mockReset();
    MockLockManager.mockImplementation(() => ({
      read: jest.fn().mockResolvedValue({
        _comment: '', version: 1, generated_at: '', source_locale: 'en',
        entries: {}, stats: { total_keys: 0, total_translations: 0, last_sync: '' },
      }),
      write: jest.fn().mockResolvedValue(undefined),
    }));
  });

  it('existing-target extract (non-ML) partitions skipped before merge', async () => {
    mockFg.mockResolvedValue(['/test/lang/en.php'] as never);

    // Walker reads the source file; pull then also reads the target file.
    mockReadFile.mockImplementation(async (p: fs.PathLike) => {
      const name = path.basename(String(p));
      return name.includes('en') ? '<?php return ["a"=>"Hi"];' : '<?php return ["a"=>"Old"];';
    });

    const sourceEntries: ExtractedEntry[] = [
      { key: 'a', value: 'Hi' },
      {
        key: 'p',
        value: '{0} no|{1} one',
        metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
      },
    ];
    const targetEntries: ExtractedEntry[] = [
      { key: 'a', value: 'Old' },
      {
        key: 'p',
        value: '{0} no|{1} one',
        metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
      },
    ];
    // Walker calls extract(sourceContent) first, then pullTranslations calls
    // extract(templateContent) at the merge site.
    const parser = makeStubParser([sourceEntries, targetEntries]);
    const client = makeTmsClient();
    (client.pullKeys as jest.Mock).mockResolvedValue({ a: 'Hallo' });

    const result = await pullTranslations(
      makeConfig(),
      client,
      makeRegistryWithParser(parser),
    );

    expect(result.pulled).toBe(1);
    // The reconstructor must not be handed a translatedEntry derived from the
    // skipped pipe-plural entry. Inspect reconstruct arguments:
    const reconstructMock = parser.reconstruct as jest.Mock;
    expect(reconstructMock).toHaveBeenCalled();
    const [, translatedEntries] = reconstructMock.mock.calls[0] as [
      string,
      Array<{ key: string; translation: string }>,
    ];
    const pushedKeys = translatedEntries.map((e) => e.key);
    expect(pushedKeys).not.toContain('p');
  });

  it('multi-locale existing-target extract partitions skipped before merge', async () => {
    mockFg.mockResolvedValue(['/test/Localizable.xcstrings'] as never);
    mockReadFile.mockResolvedValue('{}');

    const mixedEntries: ExtractedEntry[] = [
      { key: 'a', value: 'Hi' },
      {
        key: 'p',
        value: '{0} no|{1} one',
        metadata: { skipped: { reason: SKIP_REASON_PIPE_PLURALIZATION } },
      },
    ];
    const parser = makeStubParser([mixedEntries, mixedEntries], {
      multiLocale: true,
      configKey: 'xcstrings',
    });
    const client = makeTmsClient();
    (client.pullKeys as jest.Mock).mockResolvedValue({ a: 'Hallo' });

    const config = makeConfig({
      buckets: { xcstrings: { include: ['Localizable.xcstrings'] } },
    });
    const result = await pullTranslations(config, client, makeRegistryWithParser(parser));

    expect(result.pulled).toBe(1);
    const reconstructMock = parser.reconstruct as jest.Mock;
    const [, translatedEntries] = reconstructMock.mock.calls[0] as [
      string,
      Array<{ key: string; translation: string }>,
    ];
    expect(translatedEntries.map((e) => e.key)).not.toContain('p');
  });
});

describe('formatSkippedSummary', () => {
  function rec(reason: SkippedRecord['reason'], key?: string): SkippedRecord {
    return { file: 'f', locale: 'de', reason, key };
  }

  it('returns empty string for no skips', () => {
    expect(formatSkippedSummary([])).toBe('');
  });

  it('renders a single-reason summary', () => {
    expect(formatSkippedSummary([rec('target_missing'), rec('target_missing')])).toBe(
      ' (2 skipped: 2 target file not yet present)',
    );
  });

  it('renders a mixed-reason summary with per-reason counts', () => {
    const summary = formatSkippedSummary([
      rec('target_missing'),
      rec('pipe_pluralization', 'app.count'),
      rec('pipe_pluralization', 'items.label'),
      rec('no_matches'),
    ]);
    expect(summary).toContain('(4 skipped:');
    expect(summary).toContain('1 target file not yet present');
    expect(summary).toContain('2 pipe-pluralization (never sent to TMS)');
    expect(summary).toContain('1 no matching keys');
  });
});

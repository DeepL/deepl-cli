import { TmsClient } from '../../../src/sync/tms-client';
import { pushTranslations, pullTranslations } from '../../../src/sync/sync-tms';
import type { ResolvedSyncConfig } from '../../../src/sync/sync-config';
import { FormatRegistry } from '../../../src/formats/index';
import { JsonFormatParser } from '../../../src/formats/json';

jest.mock('fast-glob', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue([]),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn().mockReturnValue('{"greeting":"Hallo"}'),
    promises: {
      ...actual.promises,
      readFile: jest.fn().mockResolvedValue('{"greeting":"Hello"}'),
      writeFile: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
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

// Mock fetch globally
const mockFetch = jest.fn();
(global as Record<string, unknown>)['fetch'] = mockFetch;

function makeClient() {
  return new TmsClient({
    serverUrl: 'https://tms.example.com',
    projectId: 'proj-123',
    apiKey: 'test-key',
  });
}

describe('sync push/pull (TMS integration)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('push workflow', () => {
    it('should push individual keys via pushKey', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const client = makeClient();
      await client.pushKey('greeting', 'de', 'Hallo');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://tms.example.com/api/projects/proj-123/keys/greeting',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ locale: 'de', value: 'Hallo' }),
        }),
      );
    });

    it('should encode key paths with special characters', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const client = makeClient();
      await client.pushKey('nav/home', 'de', 'Startseite');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('nav%2Fhome'),
        expect.anything(),
      );
    });
  });

  describe('pull workflow', () => {
    it('should pull keys and return key-value map', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ greeting: 'Hallo', farewell: 'Tschüss' }),
      });
      const client = makeClient();
      const result = await client.pullKeys('de');
      expect(result).toEqual({ greeting: 'Hallo', farewell: 'Tschüss' });
    });

    it('should pass locale as query parameter', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const client = makeClient();
      await client.pullKeys('fr');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('locale=fr'),
        expect.anything(),
      );
    });
  });

  describe('config gating', () => {
    it('should use ApiKey auth when apiKey configured', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const client = new TmsClient({
        serverUrl: 'https://s.com',
        projectId: 'p',
        apiKey: 'my-key',
      });
      await client.pushKey('k', 'de', 'v');
      const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers?.['Authorization']).toBe('ApiKey my-key');
    });

    it('should use Bearer auth when token configured', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const client = new TmsClient({
        serverUrl: 'https://s.com',
        projectId: 'p',
        token: 'my-token',
      });
      await client.pushKey('k', 'de', 'v');
      const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers?.['Authorization']).toBe('Bearer my-token');
    });

    it('should throw on API error responses', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
      const client = makeClient();
      await expect(client.pushKey('k', 'de', 'v')).rejects.toThrow('401');
    });
  });
});

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

function makeRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register(new JsonFormatParser());
  return registry;
}

describe('pushTranslations()', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFg.mockReset();
    // Jest resetMocks:true wipes the module-level fs.promises.readFile default,
    // so re-establish it. walkBuckets reads the source file up front; push then
    // decides whether to use that content (isMultiLocale) or re-read a target.
    (fs.promises.readFile as jest.Mock).mockResolvedValue('{"greeting":"Hello"}');
  });

  it('should push entries from target files to TmsClient', async () => {
    mockFg.mockResolvedValue(['/test/locales/en.json']);
    (fs.readFileSync as jest.Mock).mockReturnValue('{"greeting":"Hallo"}');
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const client = makeClient();
    const config = makeConfig();
    const result = await pushTranslations(config, client, makeRegistry());

    expect(result.pushed).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://tms.example.com/api/projects/proj-123/keys/greeting');
    expect(url).toContain('/keys/greeting');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ locale: 'de', value: 'Hallo' }));
  });

  it('should respect locale filter', async () => {
    mockFg.mockResolvedValue(['/test/locales/en.json']);
    (fs.readFileSync as jest.Mock).mockReturnValue('{"greeting":"Hallo"}');
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const client = makeClient();
    const config = makeConfig({ target_locales: ['de', 'fr'] });
    const result = await pushTranslations(config, client, makeRegistry(), { localeFilter: ['fr'] });

    // One source file (en.json) x one key (greeting) x one included locale (fr)
    // = 1 push. The excluded locale (de) must contribute 0 pushes.
    expect(result.pushed).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const fetchBodies = mockFetch.mock.calls.map((call) => {
      const init = call[1] as { body?: string } | undefined;
      return init?.body ?? '';
    });
    expect(fetchBodies).toEqual([JSON.stringify({ locale: 'fr', value: 'Hallo' })]);
    expect(fetchBodies.some((body) => body.includes('"locale":"fr"'))).toBe(true);
    expect(fetchBodies.some((body) => body.includes('"locale":"de"'))).toBe(false);
  });

  it('should skip when target file does not exist', async () => {
    mockFg.mockResolvedValue(['/test/locales/en.json']);
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const client = makeClient();
    const result = await pushTranslations(makeConfig(), client, makeRegistry());
    expect(result.pushed).toBe(0);
    // An ENOENT target file is recorded as a skip, not silently dropped.
    expect(result.skipped).toEqual([
      { file: 'locales/en.json', locale: 'de', reason: 'target_missing' },
    ]);
  });

  it('should propagate non-ENOENT errors (e.g. auth failures) instead of swallowing them', async () => {
    mockFg.mockResolvedValue(['/test/locales/en.json']);
    (fs.readFileSync as jest.Mock).mockReturnValue('{"greeting":"Hallo"}');
    mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });

    const client = makeClient();
    await expect(pushTranslations(makeConfig(), client, makeRegistry())).rejects.toThrow(/401/);
  });

  describe('bounded concurrency', () => {
    function buildThirtyKeyObject(): string {
      const obj: Record<string, string> = {};
      for (let i = 0; i < 30; i += 1) {
        obj[`key_${i.toString().padStart(2, '0')}`] = `value_${i}`;
      }
      return JSON.stringify(obj);
    }

    it('caps in-flight pushKey requests at the default (10) when push_concurrency is unset', async () => {
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      (fs.readFileSync as jest.Mock).mockReturnValue(buildThirtyKeyObject());

      let inFlight = 0;
      let peak = 0;
      mockFetch.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { ok: true, json: async () => ({}) };
      });

      const client = makeClient();
      const result = await pushTranslations(makeConfig(), client, makeRegistry());

      expect(result.pushed).toBe(30);
      expect(mockFetch).toHaveBeenCalledTimes(30);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(10);
    });

    it('respects tms.push_concurrency = 5 in config', async () => {
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      (fs.readFileSync as jest.Mock).mockReturnValue(buildThirtyKeyObject());

      let inFlight = 0;
      let peak = 0;
      mockFetch.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { ok: true, json: async () => ({}) };
      });

      const client = makeClient();
      const config = makeConfig({
        tms: {
          enabled: true,
          server: 'https://tms.example.com',
          project_id: 'proj-123',
          push_concurrency: 5,
        },
      });
      const result = await pushTranslations(config, client, makeRegistry());

      expect(result.pushed).toBe(30);
      expect(peak).toBeLessThanOrEqual(5);
      expect(peak).toBeGreaterThan(1);
    });

    it('fails fast when a push rejects: overall rejection and fewer than all pushes issued', async () => {
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      (fs.readFileSync as jest.Mock).mockReturnValue(buildThirtyKeyObject());

      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount += 1;
        const thisCall = callCount;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (thisCall === 2) {
          return { ok: false, status: 500, statusText: 'Internal Server Error', text: async () => '' };
        }
        return { ok: true, json: async () => ({}) };
      });

      const client = makeClient();
      await expect(pushTranslations(makeConfig(), client, makeRegistry())).rejects.toThrow(/500/);
      expect(callCount).toBeLessThan(30);
    });

    it('default path still works: omitting tms.push_concurrency uses default 10', async () => {
      mockFg.mockResolvedValue(['/test/locales/en.json']);
      (fs.readFileSync as jest.Mock).mockReturnValue(buildThirtyKeyObject());

      let inFlight = 0;
      let peak = 0;
      mockFetch.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { ok: true, json: async () => ({}) };
      });

      const client = makeClient();
      // No tms block at all on the resolved config -> default concurrency path.
      const result = await pushTranslations(makeConfig(), client, makeRegistry());

      expect(result.pushed).toBe(30);
      expect(peak).toBeLessThanOrEqual(10);
      expect(peak).toBeGreaterThan(1);
    });
  });
});

describe('pullTranslations()', () => {
  const { SyncLockManager: MockLockManager } = jest.requireMock('../../../src/sync/sync-lock');

  beforeEach(() => {
    mockFetch.mockReset();
    mockFg.mockReset();
    MockLockManager.mockImplementation(() => ({
      read: jest.fn().mockResolvedValue({
        _comment: '', version: 1, generated_at: '', source_locale: 'en',
        entries: {}, stats: { total_keys: 0, total_translations: 0, last_sync: '' },
      }),
      write: jest.fn().mockResolvedValue(undefined),
    }));
  });

  it('should pull keys and write target files', async () => {
    mockFg.mockResolvedValue(['/test/locales/en.json']);
    (fs.promises.readFile as jest.Mock).mockResolvedValue('{"greeting":"Hello"}');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ greeting: 'Hallo' }),
    });

    const client = makeClient();
    const result = await pullTranslations(makeConfig(), client, makeRegistry());

    expect(result.pulled).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it('should return 0 when no keys are pulled', async () => {
    mockFg.mockResolvedValue(['/test/locales/en.json']);
    (fs.promises.readFile as jest.Mock).mockResolvedValue('{"greeting":"Hello"}');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const client = makeClient();
    const result = await pullTranslations(makeConfig(), client, makeRegistry());
    expect(result.pulled).toBe(0);
    // No keys returned from TMS -> the file is skipped with reason 'no_matches'.
    expect(result.skipped).toEqual([
      { file: 'locales/en.json', locale: 'de', reason: 'no_matches' },
    ]);
  });

  it('should fetch each target locale dictionary exactly once, regardless of source-file count', async () => {
    // 3 source files across the same bucket, 2 target locales. pullKeys
    // returns the full per-locale dictionary; calling it per-file is wasteful.
    // Expectation: pullKeys is invoked once per locale (L), not F x L.
    const sourceFiles = [
      '/test/locales/en.json',
      '/test/locales/en/app.json',
      '/test/locales/en/marketing.json',
    ];
    mockFg.mockResolvedValue(sourceFiles);
    (fs.promises.readFile as jest.Mock).mockResolvedValue('{"greeting":"Hello"}');

    const pullKeysSpy = jest
      .spyOn(TmsClient.prototype, 'pullKeys')
      .mockImplementation(async (locale: string): Promise<Record<string, string>> => {
        if (locale === 'de') return { greeting: 'Hallo' };
        if (locale === 'fr') return { greeting: 'Bonjour' };
        return {};
      });

    try {
      const client = makeClient();
      const config = makeConfig({ target_locales: ['de', 'fr'] });
      const result = await pullTranslations(config, client, makeRegistry());

      // One GET per locale, not one per (file x locale).
      expect(pullKeysSpy).toHaveBeenCalledTimes(2);
      const calledLocales = pullKeysSpy.mock.calls.map((c) => c[0]).sort();
      expect(calledLocales).toEqual(['de', 'fr']);

      // 3 files x 2 locales = 6 pulled entries, one per (file, locale) pair.
      expect(result.pulled).toBe(6);
      expect(result.skipped).toEqual([]);
    } finally {
      pullKeysSpy.mockRestore();
    }
  });
});

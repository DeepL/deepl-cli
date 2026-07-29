/**
 * Stale-lock cleanup must invoke fg exactly once regardless of how many stale
 * entries need scanning: a single fg call with N patterns covers all stale
 * basenames, rather than N sequential full-tree scans.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const fgCalls: Array<string | string[]> = [];

jest.mock('fast-glob', () => {
  const real = jest.requireActual<any>('fast-glob');
  const realFn = real.default ?? real;
  const wrapped: any = async (patterns: string | string[], opts?: object): Promise<string[]> => {
    fgCalls.push(patterns);
    return realFn(patterns, opts);
  };
  // Attach static helpers so source code can call fg.escapePath etc.
  Object.assign(wrapped, realFn);
  return { __esModule: true, default: wrapped };
});

import nock from 'nock';
import { SyncService } from '../../src/sync/sync-service';
import { TranslationService } from '../../src/services/translation';
import { GlossaryService } from '../../src/services/glossary';
import { DeepLClient } from '../../src/api/deepl-client';
import { FormatRegistry } from '../../src/formats/index';
import { JsonFormatParser } from '../../src/formats/json';
import { loadSyncConfig } from '../../src/sync/sync-config';
import { DEEPL_FREE_API_URL, TEST_API_KEY } from '../helpers/nock-setup';
import { createMockConfigService, createMockCacheService } from '../helpers/mock-factories';

const STALE_COUNT = 50;

const CONFIG_YAML = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
`;

const SOURCE_JSON = JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n';

function createServices(): { client: DeepLClient; syncService: SyncService } {
  const client = new DeepLClient(TEST_API_KEY, { maxRetries: 0 });
  const mockConfig = createMockConfigService({
    get: jest.fn(() => ({
      auth: {},
      api: { baseUrl: '', usePro: false },
      defaults: { targetLangs: [], formality: 'default', preserveFormatting: false },
      cache: { enabled: false },
      output: { format: 'text', color: true },
      proxy: {},
    })),
    getValue: jest.fn(() => false),
  });
  const mockCache = createMockCacheService();
  const translationService = new TranslationService(client, mockConfig, mockCache);
  const glossaryService = new GlossaryService(client);
  const registry = new FormatRegistry();
  registry.register(new JsonFormatParser());
  const syncService = new SyncService(translationService, glossaryService, registry);
  return { client, syncService };
}

describe('sync-service stale-lock fg coalesce', () => {
  let tmpDir: string;
  let client: DeepLClient;
  let syncService: SyncService;

  beforeEach(() => {
    fgCalls.length = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-stale-fg-'));
    const services = createServices();
    client = services.client;
    syncService = services.syncService;
  });

  afterEach(() => {
    client.destroy();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    nock.cleanAll();
  });

  it(`invokes fg exactly once for ${STALE_COUNT} stale lock entries`, async () => {
    const configPath = path.join(tmpDir, '.deepl-sync.yaml');
    fs.writeFileSync(configPath, CONFIG_YAML, 'utf-8');

    const localeDir = path.join(tmpDir, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      SOURCE_JSON,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(localeDir, 'de.json'),
      JSON.stringify({ greeting: 'Hallo' }, null, 2) + '\n',
      'utf-8',
    );

    // Seed lock file with STALE_COUNT entries for files that no longer exist.
    // Each entry must have the correct SyncLockFile shape:
    //   entries[filePath][keyName] = { source_hash, source_text, translations }
    const lockPath = path.join(tmpDir, '.deepl-sync.lock');
    const entries: Record<string, Record<string, {
      source_hash: string;
      source_text: string;
      translations: Record<string, { hash: string; status: string }>;
    }>> = {};
    for (let i = 0; i < STALE_COUNT; i++) {
      const filePath = 'old/path/stale_' + String(i) + '.json';
      entries[filePath] = {
        greeting: {
          source_hash: 'deadbeef' + String(i).padStart(4, '0'),
          source_text: 'Hello',
          translations: { de: { hash: 'aabbccdd', status: 'translated' } },
        },
      };
    }
    // The real source file must also appear in entries so the sync doesn't
    // re-translate it; we leave its hash blank so it registers as stale-key
    // (not a stale lock GC candidate, since processedFiles will mark it seen).
    entries['locales/en.json'] = {
      greeting: {
        source_hash: '',
        source_text: '',
        translations: {},
      },
    };
    const now = new Date().toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        _comment: 'test',
        version: 1,
        generated_at: now,
        source_locale: 'en',
        entries,
        stats: { total_keys: STALE_COUNT + 1, total_translations: STALE_COUNT, last_sync: now },
        glossary_ids: {},
      }, null, 2),
      'utf-8',
    );

    nock(DEEPL_FREE_API_URL)
      .persist()
      .post('/v2/translate')
      .reply(200, { translations: [{ text: 'Hallo', detected_source_language: 'EN' }] });

    const config = await loadSyncConfig(configPath, {});
    await syncService.sync(config, {});

    // Count fg calls whose first pattern starts with "**/" — these are the
    // stale-entry sweep calls.
    const staleSweepCalls = fgCalls.filter((p) => {
      const first = Array.isArray(p) ? p[0] : p;
      return typeof first === 'string' && first.startsWith('**/');
    });

    expect(staleSweepCalls).toHaveLength(1);

    const patterns = staleSweepCalls[0];
    expect(Array.isArray(patterns)).toBe(true);
    expect((patterns as string[]).length).toBe(STALE_COUNT);
  }, 30_000);
});

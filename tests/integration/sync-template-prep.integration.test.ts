import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.unmock('fast-glob');

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

const CONFIG_YAML = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
context:
  enabled: true
  scan_paths:
    - "src/**/*.tsx"
`;

const SOURCE_TSX = `
import { useT } from 'i18n';
export function Features({ keys }: { keys: string[] }) {
  const t = useT();
  return keys.map(k => <h2 key={k}>{t(\`features.\${k}.title\`)}</h2>);
}
`;

const SOURCE_JSON =
  JSON.stringify(
    {
      'features.alpha.title': 'Alpha',
      'features.beta.title': 'Beta',
      'features.gamma.title': 'Gamma',
    },
    null,
    2,
  ) + '\n';

describe('sync-service template-pattern prep: source files read once per sync', () => {
  let tmpDir: string;
  let client: DeepLClient;
  let syncService: SyncService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-tpl-prep-'));
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
    jest.restoreAllMocks();
  });

  it('reads each bucket source file at most once when template patterns are configured', async () => {
      expect.assertions(1);
    const configPath = path.join(tmpDir, '.deepl-sync.yaml');
    fs.writeFileSync(configPath, CONFIG_YAML, 'utf-8');
    const srcPath = path.join(tmpDir, 'src', 'Features.tsx');
    fs.mkdirSync(path.dirname(srcPath), { recursive: true });
    fs.writeFileSync(srcPath, SOURCE_TSX, 'utf-8');
    const localePath = path.join(tmpDir, 'locales', 'en.json');
    fs.mkdirSync(path.dirname(localePath), { recursive: true });
    fs.writeFileSync(localePath, SOURCE_JSON, 'utf-8');

    nock(DEEPL_FREE_API_URL)
      .persist()
      .post('/v2/translate')
      .reply(200, {
        translations: [
          { text: 'Alpha-DE', detected_source_language: 'EN' },
          { text: 'Beta-DE', detected_source_language: 'EN' },
          { text: 'Gamma-DE', detected_source_language: 'EN' },
        ],
      });

    const config = await loadSyncConfig(configPath, {});

    const readFileSpy = jest.spyOn(fs.promises, 'readFile');

    await syncService.sync(config, { dryRun: false });

    const localeAbs = fs.realpathSync(localePath);
    const bucketReads = readFileSpy.mock.calls.filter((call) => {
      const p = typeof call[0] === 'string' ? call[0] : String(call[0]);
      try {
        return fs.realpathSync(p) === localeAbs;
      } catch {
        return path.resolve(p) === path.resolve(localePath);
      }
    }).length;

    expect(bucketReads).toBeLessThanOrEqual(1);
  }, 30_000);
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as querystring from 'querystring';

jest.unmock('fast-glob');

import nock from 'nock';
import { SyncService } from '../../src/sync/sync-service';
import { TranslationService } from '../../src/services/translation';
import { GlossaryService } from '../../src/services/glossary';
import { DeepLClient } from '../../src/api/deepl-client';
import { FormatRegistry } from '../../src/formats/index';
import { JsonFormatParser } from '../../src/formats/json';
import { YamlFormatParser } from '../../src/formats/yaml';
import { PoFormatParser } from '../../src/formats/po';
import { TomlFormatParser } from '../../src/formats/toml';
import { ArbFormatParser } from '../../src/formats/arb';
import { IosStringsFormatParser } from '../../src/formats/ios-strings';
import { PropertiesFormatParser } from '../../src/formats/properties';
import { AndroidXmlFormatParser } from '../../src/formats/android-xml';
import { loadSyncConfig } from '../../src/sync/sync-config';
import { computeSourceHash } from '../../src/sync/sync-lock';
import { LOCK_FILE_NAME } from '../../src/sync/types';
import { ConfigError, ValidationError } from '../../src/utils/errors';
import { DEEPL_FREE_API_URL, TEST_API_KEY } from '../helpers/nock-setup';
import { createMockConfigService, createMockCacheService } from '../helpers/mock-factories';

function parseNockBody(body: unknown): Record<string, string | string[]> {
  if (typeof body === 'string') {
    return querystring.parse(body) as Record<string, string | string[]>;
  }
  return body as Record<string, string | string[]>;
}

function getTexts(body: unknown): string[] {
  const parsed = parseNockBody(body);
  const text = parsed['text'];
  return Array.isArray(text) ? text : (text ? [text] : []);
}

function createServices(opts: { withYaml?: boolean; withAndroid?: boolean } = {}) {
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
  if (opts.withYaml) {
    registry.register(new YamlFormatParser());
  }
  if (opts.withAndroid) {
    registry.register(new AndroidXmlFormatParser());
  }
  const syncService = new SyncService(translationService, glossaryService, registry);
  return { client, syncService };
}

function writeYamlConfig(dir: string, yaml: string): void {
  fs.writeFileSync(path.join(dir, '.deepl-sync.yaml'), yaml, 'utf-8');
}

function writeSourceFile(dir: string, relPath: string, content: string): void {
  const absPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
}

const BASIC_CONFIG_YAML = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
`;

const SOURCE_JSON = JSON.stringify(
  { greeting: 'Hello', farewell: 'Goodbye', welcome: 'Welcome' },
  null,
  2,
) + '\n';

describe('Sync Integration', () => {
  let tmpDir: string;
  let client: DeepLClient;
  let syncService: SyncService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-integ-'));
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

  describe('first sync', () => {
    it('should translate all keys and write target file', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(3);
      expect(result.totalKeys).toBe(3);
      expect(scope.isDone()).toBe(true);

      const targetFile = path.join(tmpDir, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const translated = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      expect(translated).toHaveProperty('greeting');
      expect(translated).toHaveProperty('farewell');
      expect(translated).toHaveProperty('welcome');
    });

    it('should create lock file', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      const lockPath = path.join(tmpDir, LOCK_FILE_NAME);
      expect(fs.existsSync(lockPath)).toBe(true);

      const lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(lockContent.version).toBe(1);
      expect(lockContent.source_locale).toBe('en');
      expect(lockContent.entries['locales/en.json']).toBeDefined();

      const entries = lockContent.entries['locales/en.json'];
      expect(entries['greeting']).toBeDefined();
      expect(entries['greeting'].source_text).toBe('Hello');
      expect(entries['greeting'].translations['de']).toBeDefined();
      expect(entries['greeting'].translations['de'].status).toBe('translated');
    });

    it('should send correct languages to API', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          return body['source_lang'] === 'EN' && body['target_lang'] === 'DE';
        })
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      expect(scope.isDone()).toBe(true);
    });

    it('should handle multiple target locales', async () => {
      const multiLocaleConfig = `version: 1
source_locale: en
target_locales:
  - de
  - fr
buckets:
  json:
    include:
      - "locales/en.json"
`;
      writeYamlConfig(tmpDir, multiLocaleConfig);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      const deScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          return body['target_lang'] === 'DE';
        })
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const frScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          return body['target_lang'] === 'FR';
        })
        .reply(200, {
          translations: [
            { text: 'Au revoir', detected_source_language: 'EN', billed_characters: 10 },
            { text: 'Bonjour', detected_source_language: 'EN', billed_characters: 7 },
            { text: 'Bienvenue', detected_source_language: 'EN', billed_characters: 9 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(deScope.isDone()).toBe(true);
      expect(frScope.isDone()).toBe(true);

      expect(fs.existsSync(path.join(tmpDir, 'locales', 'de.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'locales', 'fr.json'))).toBe(true);
    });
  });

  describe('incremental sync', () => {
    async function doFirstSync(): Promise<void> {
      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);
    }

    it('should only translate changed keys', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);
      await doFirstSync();

      const updated = JSON.stringify(
        { greeting: 'Hi there', farewell: 'Goodbye', welcome: 'Welcome' },
        null,
        2,
      ) + '\n';
      writeSourceFile(tmpDir, 'locales/en.json', updated);

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const text = body['text'];
          return text === 'Hi there' || (Array.isArray(text) && text.length === 1 && text[0] === 'Hi there');
        })
        .reply(200, {
          translations: [
            { text: 'Hallo zusammen', detected_source_language: 'EN', billed_characters: 8 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.staleKeys).toBe(1);
      expect(result.currentKeys).toBe(2);
      expect(scope.isDone()).toBe(true);
    });

    it('should detect new keys', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);
      await doFirstSync();

      const updated = JSON.stringify(
        { greeting: 'Hello', farewell: 'Goodbye', welcome: 'Welcome', thanks: 'Thank you' },
        null,
        2,
      ) + '\n';
      writeSourceFile(tmpDir, 'locales/en.json', updated);

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const text = body['text'];
          return text === 'Thank you' || (Array.isArray(text) && text.length === 1 && text[0] === 'Thank you');
        })
        .reply(200, {
          translations: [
            { text: 'Danke', detected_source_language: 'EN', billed_characters: 9 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.newKeys).toBe(1);
      expect(result.currentKeys).toBe(3);
      expect(scope.isDone()).toBe(true);
    });

    it('should count deleted keys', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);
      await doFirstSync();

      const reduced = JSON.stringify(
        { greeting: 'Hello', farewell: 'Goodbye' },
        null,
        2,
      ) + '\n';
      writeSourceFile(tmpDir, 'locales/en.json', reduced);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.deletedKeys).toBe(1);
      expect(result.currentKeys).toBe(2);
      expect(result.totalKeys).toBe(2);
    });
  });

  describe('frozen mode', () => {
    it('should detect drift when new keys exist', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config, { frozen: true });

      expect(result.driftDetected).toBe(true);
      expect(result.success).toBe(false);
      expect(result.frozen).toBe(true);

      expect(fs.existsSync(path.join(tmpDir, LOCK_FILE_NAME))).toBe(false);
    });

    it('should not detect drift when all current', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      const result = await syncService.sync(config, { frozen: true });

      expect(result.driftDetected).toBe(false);
      expect(result.success).toBe(true);
    });

    it('should detect drift when a source key is deleted after the last sync', async () => {
      // Exercises the deletedDiffs > 0 frozen branch. A CI pipeline that
      // silently passes when a key is deleted would let translated files and
      // the lockfile drift from the source of truth.
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const configInitial = await loadSyncConfig(tmpDir);
      await syncService.sync(configInitial);

      // Remove one key from the source and rerun with --frozen.
      const reducedSource = JSON.stringify({ greeting: 'Hello', welcome: 'Welcome' }, null, 2) + '\n';
      writeSourceFile(tmpDir, 'locales/en.json', reducedSource);

      const configAfter = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(configAfter, { frozen: true });

      expect(result.driftDetected).toBe(true);
      expect(result.deletedKeys).toBeGreaterThanOrEqual(1);
      expect(result.success).toBe(false);
    });

    it('should report newKeys for a newly-added target locale needing backfill', async () => {
      // A newly-added target locale has no lockfile entries, so its keys carry
      // current status. --frozen must still promote them into newKeysDelta so
      // displayResult reports the real backfill count instead of "0 new, 0 stale".
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const configInitial = await loadSyncConfig(tmpDir);
      await syncService.sync(configInitial);

      // Add a second target locale (fr) without touching the source file.
      const expandedConfigYaml = `version: 1
source_locale: en
target_locales:
  - de
  - fr
buckets:
  json:
    include:
      - "locales/en.json"
`;
      writeYamlConfig(tmpDir, expandedConfigYaml);

      const configAfter = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(configAfter, { frozen: true });

      expect(result.driftDetected).toBe(true);
      expect(result.success).toBe(false);
      expect(result.newKeys).toBeGreaterThan(0);
    });
  });

  describe('dry run', () => {
    it('should not call API', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.newKeys).toBe(3);
      expect(result.totalKeys).toBe(3);
    });

    it('should not write files', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config, { dryRun: true });

      expect(fs.existsSync(path.join(tmpDir, 'locales', 'de.json'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, LOCK_FILE_NAME))).toBe(false);
    });

    it('should report correct counts', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config, { dryRun: true });

      expect(result.newKeys).toBe(3);
      expect(result.staleKeys).toBe(0);
      expect(result.deletedKeys).toBe(0);
      expect(result.currentKeys).toBe(0);
      expect(result.totalKeys).toBe(3);
    });
  });

  describe('force', () => {
    it('should retranslate all keys', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      const forceScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = body['text'] as string[];
          return Array.isArray(texts) && texts.length === 3;
        })
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen!', detected_source_language: 'EN', billed_characters: 16 },
            { text: 'Hallo!', detected_source_language: 'EN', billed_characters: 6 },
            { text: 'Willkommen!', detected_source_language: 'EN', billed_characters: 11 },
          ],
        });

      const result = await syncService.sync(config, { force: true });

      expect(result.newKeys).toBe(3);
      expect(result.currentKeys).toBe(0);
      expect(forceScope.isDone()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw on API 403', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(403, { message: 'Invalid API key' });

      const config = await loadSyncConfig(tmpDir);
      await expect(syncService.sync(config)).rejects.toThrow(/Authentication failed/);
    });

    it('should handle empty source file', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', '{}\n');

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.totalKeys).toBe(0);
      expect(result.newKeys).toBe(0);
    });
  });

  // Non-watch runs sweep stale `.bak` siblings at startup.
  describe('stale .bak sweep on non-watch sync', () => {
    it('removes stale .bak siblings older than sync.bak_sweep_max_age_seconds', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', '{}\n');

      const staleBak = path.join(tmpDir, 'locales', 'de.json.deepl.bak');
      fs.mkdirSync(path.dirname(staleBak), { recursive: true });
      fs.writeFileSync(staleBak, 'orphan from prior crash', 'utf-8');
      // Backdate 10 minutes past the 5-minute default threshold.
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(staleBak, tenMinAgo, tenMinAgo);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      expect(fs.existsSync(staleBak)).toBe(false);
    });

    it('respects a user-configured bak_sweep_max_age_seconds override', async () => {
      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
sync:
  bak_sweep_max_age_seconds: 60
`);
      writeSourceFile(tmpDir, 'locales/en.json', '{}\n');

      const staleBak = path.join(tmpDir, 'locales', 'de.json.deepl.bak');
      fs.mkdirSync(path.dirname(staleBak), { recursive: true });
      fs.writeFileSync(staleBak, 'orphan', 'utf-8');
      // 2 minutes old — stale under the 60-second override, fresh under the default.
      const twoMinAgo = new Date(Date.now() - 2 * 60_000);
      fs.utimesSync(staleBak, twoMinAgo, twoMinAgo);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      expect(fs.existsSync(staleBak)).toBe(false);
    });

    it('leaves fresh .bak files alone', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', '{}\n');

      const freshBak = path.join(tmpDir, 'locales', 'de.json.deepl.bak');
      fs.mkdirSync(path.dirname(freshBak), { recursive: true });
      fs.writeFileSync(freshBak, 'recent', 'utf-8');

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      expect(fs.existsSync(freshBak)).toBe(true);
    });

    it('leaves user-owned *.bak files untouched even when stale', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', '{}\n');

      const userBak = path.join(tmpDir, 'locales', 'my-important-notes.bak');
      fs.mkdirSync(path.dirname(userBak), { recursive: true });
      fs.writeFileSync(userBak, 'user data', 'utf-8');
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(userBak, tenMinAgo, tenMinAgo);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      expect(fs.existsSync(userBak)).toBe(true);
      expect(fs.readFileSync(userBak, 'utf-8')).toBe('user data');
      expect(fs.existsSync(path.join(tmpDir, 'locales', 'my-important-notes'))).toBe(false);
    });

    it('registers a SIGINT/SIGTERM cleanup handler during a non-watch run that unlinks tracked .bak paths', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', '{"a":"1"}\n');

      // Pre-create an orphan .bak from a simulated prior crash. It's fresh
      // (so the startup sweep leaves it alone), but we'll make it known to
      // the cleanup handler via the backupTracker option. This is what
      // watch mode does today; non-watch runs share the same discipline so
      // any sync code path gets SIGINT/SIGTERM cleanup.
      const bakPath = path.join(tmpDir, 'locales', 'de.json.bak');
      fs.mkdirSync(path.dirname(bakPath), { recursive: true });
      fs.writeFileSync(bakPath, 'in-flight', 'utf-8');

      // Baseline listener counts so we can assert the handler is attached
      // during the run and detached after.
      const sigintBefore = process.listenerCount('SIGINT');
      const sigtermBefore = process.listenerCount('SIGTERM');

      let observedSigint = 0;
      let observedSigterm = 0;
      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(() => {
          observedSigint = process.listenerCount('SIGINT') - sigintBefore;
          observedSigterm = process.listenerCount('SIGTERM') - sigtermBefore;
          return [200, { translations: [{ text: 'übersetzt', detected_source_language: 'EN', billed_characters: 1 }] }];
        });

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      expect(observedSigint).toBeGreaterThanOrEqual(1);
      expect(observedSigterm).toBeGreaterThanOrEqual(1);
      expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
    });
  });

  describe('multi-bucket sync', () => {
    let multiBucketDir: string;
    let multiBucketClient: DeepLClient;
    let multiBucketService: SyncService;

    beforeEach(() => {
      multiBucketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-multi-'));
      const services = createServices({ withYaml: true });
      multiBucketClient = services.client;
      multiBucketService = services.syncService;
    });

    afterEach(() => {
      multiBucketClient.destroy();
      if (fs.existsSync(multiBucketDir)) {
        fs.rmSync(multiBucketDir, { recursive: true, force: true });
      }
    });

    it('should process both json and yaml buckets', async () => {
      const multiBucketConfig = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en/*.json"
  yaml:
    include:
      - "locales/en/*.yaml"
`;
      writeYamlConfig(multiBucketDir, multiBucketConfig);

      const jsonContent = JSON.stringify({ title: 'Hello', subtitle: 'World' }, null, 2) + '\n';
      writeSourceFile(multiBucketDir, 'locales/en/messages.json', jsonContent);

      const yamlContent = 'nav:\n  home: Home\n  about: About\n';
      writeSourceFile(multiBucketDir, 'locales/en/navigation.yaml', yamlContent);

      const jsonScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = body['text'] as string[] | undefined;
          return Array.isArray(texts) && texts.includes('Hello');
        })
        .reply(200, {
          translations: [
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Welt', detected_source_language: 'EN', billed_characters: 5 },
          ],
        });

      const yamlScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = body['text'] as string[] | undefined;
          return Array.isArray(texts) && texts.includes('About');
        })
        .reply(200, {
          translations: [
            { text: 'Uber', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Startseite', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(multiBucketDir);
      const result = await multiBucketService.sync(config);

      expect(result.success).toBe(true);
      expect(result.totalKeys).toBe(4);
      expect(result.newKeys).toBe(4);
      expect(jsonScope.isDone()).toBe(true);
      expect(yamlScope.isDone()).toBe(true);

      const jsonTargetFile = path.join(multiBucketDir, 'locales', 'de', 'messages.json');
      expect(fs.existsSync(jsonTargetFile)).toBe(true);

      const yamlTargetFile = path.join(multiBucketDir, 'locales', 'de', 'navigation.yaml');
      expect(fs.existsSync(yamlTargetFile)).toBe(true);

      const lockPath = path.join(multiBucketDir, LOCK_FILE_NAME);
      expect(fs.existsSync(lockPath)).toBe(true);
      const lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(lockContent.entries['locales/en/messages.json']).toBeDefined();
      expect(lockContent.entries['locales/en/navigation.yaml']).toBeDefined();
    });
  });

  describe('ICU MessageFormat preservation', () => {
    it('should translate ICU leaf text while preserving structure', async () => {
      const icuConfig = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
`;
      writeYamlConfig(tmpDir, icuConfig);

      // Keys sorted alphabetically by JsonFormatParser: greeting (idx 0), items (idx 1)
      // The ICU string at idx 1 becomes __ICU_PLACEHOLDER_1__ in the main batch.
      const sourceContent = JSON.stringify(
        {
          items: '{count, plural, one {# item} other {# items}}',
          greeting: 'Hello',
        },
        null,
        2,
      ) + '\n';
      writeSourceFile(tmpDir, 'locales/en.json', sourceContent);

      // Main batch: "Hello" at idx 0 and the ICU placeholder at idx 1
      const mainScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = getTexts(body);
          return texts.some(t => t === 'Hello') &&
                 texts.some(t => t.startsWith('__ICU_PLACEHOLDER_'));
        })
        .reply(200, (_uri: string, rawBody: unknown) => {
          const texts = getTexts(rawBody);
          return {
            translations: texts.map(t => ({
              text: t.startsWith('__ICU_PLACEHOLDER_') ? t : 'Hallo',
              detected_source_language: 'EN',
              billed_characters: 5,
            })),
          };
        });

      // ICU segments batch: the leaf texts extracted from the plural branches
      // "# item" and "# items" — with # protected as __VAR_HASH_0__
      const icuScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = getTexts(body);
          return texts.length === 2 && !texts.some(t => t.startsWith('__ICU_PLACEHOLDER_'));
        })
        .reply(200, (_uri: string, rawBody: unknown) => {
          const texts = getTexts(rawBody);
          return {
            translations: texts.map(t => ({
              text: t.replace(/item(s?)/, 'Artikel'),
              detected_source_language: 'EN',
              billed_characters: 7,
            })),
          };
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.totalKeys).toBe(2);
      expect(mainScope.isDone()).toBe(true);
      expect(icuScope.isDone()).toBe(true);

      const targetFile = path.join(tmpDir, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const translated = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));

      expect(translated['items']).toMatch(/\{count, plural,/);
      expect(translated['items']).toMatch(/one \{/);
      expect(translated['items']).toMatch(/other \{/);
      expect(translated['items']).toContain('Artikel');

      expect(translated['greeting']).toBe('Hallo');
    });
  });

  describe('plural-is-ICU preservation', () => {
    // Locks the preprocessor pipeline ordering: plural-expand → ICU-detect → translate
    // → ICU-reassemble → plural-writeback. Any reorder silently leaks __ICU_PLACEHOLDER_
    // or translates into the wrong plural slot.
    it('should translate ICU leaves inside Android plural quantities', async () => {
      client.destroy();
      const services = createServices({ withAndroid: true });
      client = services.client;
      const localSyncService = services.syncService;

      const pluralIcuConfig = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  android_xml:
    include:
      - "locales/en/strings.xml"
`;
      writeYamlConfig(tmpDir, pluralIcuConfig);

      const sourceXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="greeting">Hello</string>
  <plurals name="widgets">
    <item quantity="one">{n, plural, one {# widget}}</item>
    <item quantity="other">{n, plural, other {# widgets}}</item>
  </plurals>
</resources>
`;
      writeSourceFile(tmpDir, 'locales/en/strings.xml', sourceXml);

      // Main batch: "Hello" plus one or two ICU placeholders for the plural quantities
      const mainScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = getTexts(body);
          return texts.some(t => t === 'Hello') &&
                 texts.some(t => t.startsWith('__ICU_PLACEHOLDER_'));
        })
        .reply(200, (_uri: string, rawBody: unknown) => {
          const texts = getTexts(rawBody);
          return {
            translations: texts.map(t => ({
              text: t.startsWith('__ICU_PLACEHOLDER_') ? t : 'Hallo',
              detected_source_language: 'EN',
              billed_characters: 5,
            })),
          };
        });

      // ICU segments batch: the leaf texts from the plural branches ("# widget", "# widgets")
      // — with # protected via __VAR_HASH_N__ preservation
      const icuScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = getTexts(body);
          return texts.length >= 1 && !texts.some(t => t.startsWith('__ICU_PLACEHOLDER_'));
        })
        .reply(200, (_uri: string, rawBody: unknown) => {
          const texts = getTexts(rawBody);
          return {
            translations: texts.map(t => ({
              text: t.replace(/widget(s?)/, (_m, s: string) => s ? 'Widgets' : 'Widget'),
              detected_source_language: 'EN',
              billed_characters: 7,
            })),
          };
        }).persist();

      const config = await loadSyncConfig(tmpDir);
      const result = await localSyncService.sync(config);

      expect(result.success).toBe(true);
      expect(mainScope.isDone()).toBe(true);
      expect(icuScope.isDone()).toBe(true);

      const targetFile = path.join(tmpDir, 'locales', 'de', 'strings.xml');
      expect(fs.existsSync(targetFile)).toBe(true);
      const translatedXml = fs.readFileSync(targetFile, 'utf-8');

      // Stop-the-line: no placeholder leaked into the final written file
      expect(translatedXml).not.toContain('__ICU_PLACEHOLDER_');
      // Plural structure preserved
      expect(translatedXml).toMatch(/<plurals\s+name="widgets">/);

      // Extract each quantity's inner text — bites the mutation: if plural-expand runs
      // BEFORE ICU-detect the quantity values go through ICU reassemble and contain
      // "Widget" / "Widgets". If the loop order is swapped, the "one" quantity bypasses
      // ICU detection and the mock's fallback returns "Hallo" — which we reject here.
      const oneMatch = translatedXml.match(/<item\s+quantity="one"[^>]*>([\s\S]*?)<\/item>/);
      const otherMatch = translatedXml.match(/<item\s+quantity="other"[^>]*>([\s\S]*?)<\/item>/);
      expect(oneMatch).not.toBeNull();
      expect(otherMatch).not.toBeNull();
      expect(oneMatch![1]).toContain('Widget');
      expect(oneMatch![1]).not.toContain('Widgets');
      expect(otherMatch![1]).toContain('Widgets');

      // Plain string also translated
      expect(translatedXml).toContain('Hallo');
    });
  });

  describe('three-way translation partitioning', () => {
    it('should route keys to correct paths based on context and element type', async () => {
      const contextConfig = `version: 1
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
translation:
  instruction_templates:
    button: "Keep concise."
    th: "Table header."
`;
      writeYamlConfig(tmpDir, contextConfig);

      const sourceJson = JSON.stringify(
        {
          'hero.title': 'Welcome',
          'hero.subtitle': 'Start here',
          'btn.save': 'Save',
          'table.name': 'Name',
          'misc': 'Other',
        },
        null,
        2,
      ) + '\n';
      writeSourceFile(tmpDir, 'locales/en.json', sourceJson);

      const tsxContent = `import { t } from 'i18n';
export function Page() {
  return (
    <div>
      <h2>{t('hero.title')}</h2>
      <p>{t('hero.subtitle')}</p>
      <button>{t('btn.save')}</button>
      <th>{t('table.name')}</th>
    </div>
  );
}
`;
      writeSourceFile(tmpDir, 'src/components/Page.tsx', tsxContent);

      const translateCalls: Array<{ texts: string[]; context?: string; instructions?: string[] }> = [];

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .times(10)
        .reply(200, (_uri: string, rawBody: unknown) => {
          const parsed = parseNockBody(rawBody);
          const texts = getTexts(rawBody);
          const context = parsed['context'];
          const instructions = parsed['custom_instructions'];
          translateCalls.push({
            texts,
            context: Array.isArray(context) ? context[0] : context,
            instructions: instructions ? (Array.isArray(instructions) ? instructions : [instructions]) : undefined,
          });
          return {
            translations: texts.map(t => ({
              text: t + '_DE',
              detected_source_language: 'EN',
              billed_characters: t.length,
            })),
          };
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.totalKeys).toBe(5);

      expect(result.strategy).toBeDefined();
      expect(result.strategy!.context).toBeGreaterThan(0);

      const contextCalls = translateCalls.filter(c => c.context && c.context.length > 0);
      expect(contextCalls.length).toBeGreaterThan(0);

      const targetFile = path.join(tmpDir, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const translated = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      expect(Object.keys(translated)).toHaveLength(5);
    });
  });

  describe('section-batched context', () => {
    it('should batch keys from same section with shared context', async () => {
      const sectionConfig = `version: 1
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
      writeYamlConfig(tmpDir, sectionConfig);

      const sourceJson = JSON.stringify(
        {
          'nav.home': 'Home',
          'nav.about': 'About',
          'nav.contact': 'Contact',
          'footer.copyright': 'Copyright',
        },
        null,
        2,
      ) + '\n';
      writeSourceFile(tmpDir, 'locales/en.json', sourceJson);

      const tsxContent = `import { t } from 'i18n';
export function Layout() {
  return (
    <nav>
      <a>{t('nav.home')}</a>
      <a>{t('nav.about')}</a>
      <a>{t('nav.contact')}</a>
    </nav>
    <footer>
      <p>{t('footer.copyright')}</p>
    </footer>
  );
}
`;
      writeSourceFile(tmpDir, 'src/Layout.tsx', tsxContent);

      const translateCalls: Array<{ texts: string[]; context?: string }> = [];

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .times(10)
        .reply(200, (_uri: string, rawBody: unknown) => {
          const parsed = parseNockBody(rawBody);
          const texts = getTexts(rawBody);
          const context = parsed['context'];
          translateCalls.push({
            texts,
            context: Array.isArray(context) ? context[0] : context,
          });
          return {
            translations: texts.map(t => ({
              text: t + '_DE',
              detected_source_language: 'EN',
              billed_characters: t.length,
            })),
          };
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.totalKeys).toBe(4);

      // Section batching: nav.* keys share section "nav" and should be batched together
      const navBatch = translateCalls.find(
        c => c.context && c.context.includes('nav') && c.texts.length >= 3,
      );
      expect(navBatch).toBeDefined();
      expect(navBatch!.texts).toEqual(expect.arrayContaining(['Home', 'About', 'Contact']));

      // Footer is a separate section batch
      const footerBatch = translateCalls.find(
        c => c.context?.includes('footer'),
      );
      expect(footerBatch).toBeDefined();
      expect(footerBatch!.texts).toContain('Copyright');

      // Verify all keys translated in target file
      const targetFile = path.join(tmpDir, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const translated = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      expect(Object.keys(translated)).toHaveLength(4);
    });
  });

  describe('new locale addition', () => {
    it('should translate all keys for a newly added locale', async () => {
      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
`);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          return body['target_lang'] === 'DE';
        })
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const firstConfig = await loadSyncConfig(tmpDir);
      const firstResult = await syncService.sync(firstConfig);
      expect(firstResult.success).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'locales', 'de.json'))).toBe(true);

      // Second sync: add fr
      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
  - fr
buckets:
  json:
    include:
      - "locales/en.json"
`);

      // Track which target_lang values the API is called with
      const calledLocales: string[] = [];
      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .times(5)
        .reply(200, (_uri: string, rawBody: unknown) => {
          const parsed = parseNockBody(rawBody);
          const targetLang = parsed['target_lang'];
          calledLocales.push(Array.isArray(targetLang) ? targetLang[0]! : targetLang as string);
          return {
            translations: [
              { text: 'Au revoir', detected_source_language: 'EN', billed_characters: 10 },
              { text: 'Bonjour', detected_source_language: 'EN', billed_characters: 7 },
              { text: 'Bienvenue', detected_source_language: 'EN', billed_characters: 9 },
            ],
          };
        });

      const secondConfig = await loadSyncConfig(tmpDir);
      const secondResult = await syncService.sync(secondConfig);
      expect(secondResult.success).toBe(true);

      // Only FR should have been called (DE already had all translations)
      expect(calledLocales).toContain('FR');
      expect(calledLocales).not.toContain('DE');

      const frFile = path.join(tmpDir, 'locales', 'fr.json');
      expect(fs.existsSync(frFile)).toBe(true);
      const frTranslated = JSON.parse(fs.readFileSync(frFile, 'utf-8'));
      expect(frTranslated).toHaveProperty('greeting');
      expect(frTranslated).toHaveProperty('farewell');
      expect(frTranslated).toHaveProperty('welcome');

      // Lock file should have translations for both locales
      const lockFilePath = path.join(tmpDir, LOCK_FILE_NAME);
      const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8'));
      const entries = lockContent.entries['locales/en.json'];
      expect(entries['greeting'].translations['de']).toBeDefined();
      expect(entries['greeting'].translations['fr']).toBeDefined();
      expect(entries['greeting'].translations['de'].status).toBe('translated');
      expect(entries['greeting'].translations['fr'].status).toBe('translated');
    });
  });

  describe('cost cap (max_characters) — new locale addition', () => {
    // 10 keys, each ~50 chars → ~500 chars total for zh → exceeds cap of 100
    const KEYS_50_CHARS = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`key${i}`, 'a'.repeat(50)]),
    );

    function seedLockWithDeOnly(dir: string, keys: Record<string, string>): void {
      const now = '2026-01-01T00:00:00Z';
      const entries: Record<string, Record<string, unknown>> = {};
      const fileEntries: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(keys)) {
        const hash = computeSourceHash(val);
        fileEntries[key] = { source_text: val, source_hash: hash, translations: { de: { hash, translated_at: now, status: 'translated' } } };
      }
      entries['locales/en.json'] = fileEntries;
      fs.writeFileSync(
        path.join(dir, LOCK_FILE_NAME),
        JSON.stringify({ version: 1, generated_at: now, source_locale: 'en', entries, stats: {} }, null, 2) + '\n',
        'utf-8',
      );
    }

    it('should throw cost-cap ValidationError before any API call when adding a new locale', async () => {
      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
  - zh
sync:
  max_characters: 100
buckets:
  json:
    include:
      - "locales/en.json"
`);
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify(KEYS_50_CHARS, null, 2) + '\n');
      seedLockWithDeOnly(tmpDir, KEYS_50_CHARS);

      // No nock scope — any HTTP call must fail the test
      nock(DEEPL_FREE_API_URL).post('/v2/translate').reply(200, { translations: [] });

      const config = await loadSyncConfig(tmpDir);
      await expect(syncService.sync(config)).rejects.toThrow(ValidationError);

      // Confirm no HTTP requests were made
      expect(nock.pendingMocks().length).toBe(1); // the unused mock is still pending
    });

    it('dry-run estimatedChars matches live-path preflight estimatedChars for new-locale addition', async () => {
      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
  - zh
sync:
  max_characters: 999999
buckets:
  json:
    include:
      - "locales/en.json"
`);
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify(KEYS_50_CHARS, null, 2) + '\n');
      seedLockWithDeOnly(tmpDir, KEYS_50_CHARS);

      const config = await loadSyncConfig(tmpDir);
      const dryResult = await syncService.sync(config, { dryRun: true });

      // dry-run must estimate currentChars * newLocaleCount (10 keys * 50 chars * 1 new locale = 500)
      expect(dryResult.estimatedCharacters).toBe(500);

      // The live path preflight must compute the same estimate; verify by setting cap just below it
      const configAtCap = await loadSyncConfig(tmpDir);
      (configAtCap as any).sync = { ...configAtCap.sync, max_characters: 499 };
      await expect(syncService.sync(configAtCap)).rejects.toThrow(ValidationError);

      const configAboveCap = await loadSyncConfig(tmpDir);
      (configAboveCap as any).sync = { ...configAboveCap.sync, max_characters: 500 };
      nock(DEEPL_FREE_API_URL).post('/v2/translate').times(20).reply(200, {
        translations: [{ text: 'zh-text', detected_source_language: 'EN', billed_characters: 1 }],
      });
      await expect(syncService.sync(configAboveCap)).resolves.not.toThrow();
    });
  });

  describe('error recovery', () => {
    it('should retry on 429 and complete successfully', async () => {
      const retryClient = new DeepLClient(TEST_API_KEY, { maxRetries: 1 });
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
      const retryTranslation = new TranslationService(retryClient, mockConfig, mockCache);
      const retryGlossary = new GlossaryService(retryClient);
      const retryRegistry = new FormatRegistry();
      retryRegistry.register(new JsonFormatParser());
      const retrySyncService = new SyncService(retryTranslation, retryGlossary, retryRegistry);

      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
`);
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ hello: 'Hello' }, null, 2) + '\n');

      // First request: 429 with Retry-After: 0
      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(429, { message: 'Too many requests' }, { 'Retry-After': '0' });

      // Second request (retry): 200 with translation
      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await retrySyncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.totalKeys).toBe(1);

      const targetFile = path.join(tmpDir, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const translated = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      expect(translated['hello']).toBe('Hallo');

      retryClient.destroy();
    });

    it('should not replay a translate POST on 503', async () => {
      const retryClient = new DeepLClient(TEST_API_KEY, { maxRetries: 1 });
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
      const retryTranslation = new TranslationService(retryClient, mockConfig, mockCache);
      const retryGlossary = new GlossaryService(retryClient);
      const retryRegistry = new FormatRegistry();
      retryRegistry.register(new JsonFormatParser());
      const retrySyncService = new SyncService(retryTranslation, retryGlossary, retryRegistry);

      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ hello: 'Hello' }, null, 2) + '\n');

      const scope503 = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(503, { message: 'Service unavailable' }, { 'Retry-After': '0' });

      const config = await loadSyncConfig(tmpDir);
      const result = await retrySyncService.sync(config);

      expect(scope503.isDone()).toBe(true);
      expect(nock.pendingMocks()).toHaveLength(0);

      const deResult = result.fileResults.find((r) => r.locale === 'de');
      expect(deResult?.written).toBe(false);
      expect(deResult?.failed).toBeGreaterThan(0);

      const targetFile = path.join(tmpDir, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(false);

      retryClient.destroy();
    });

    it('records per-locale failure in fileResults without aborting sibling locales', async () => {
      const multiLocaleYaml = `version: 1
source_locale: en
target_locales:
  - de
  - fr
buckets:
  json:
    include:
      - "locales/en.json"
`;
      writeYamlConfig(tmpDir, multiLocaleYaml);
      writeSourceFile(tmpDir, 'locales/en.json', SOURCE_JSON);

      // de: 200 with translations.
      const deScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => body['target_lang'] === 'DE')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      // fr: 500 (transient server error — sync catches per-locale, does not throw globally).
      const frScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => body['target_lang'] === 'FR')
        .reply(500, { message: 'Internal Server Error' });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(deScope.isDone()).toBe(true);
      expect(frScope.isDone()).toBe(true);

      const deFile = path.join(tmpDir, 'locales', 'de.json');
      const frFile = path.join(tmpDir, 'locales', 'fr.json');
      expect(fs.existsSync(deFile)).toBe(true);
      expect(fs.existsSync(frFile)).toBe(false);

      const deResult = result.fileResults.find((r) => r.locale === 'de');
      const frResult = result.fileResults.find((r) => r.locale === 'fr');
      expect(deResult?.written).toBe(true);
      expect(deResult?.translated).toBeGreaterThan(0);
      expect(frResult?.written).toBe(false);
      expect(frResult?.failed).toBeGreaterThan(0);
    });

    it('splits large key sets across multiple POST calls at the 50-key batch boundary', async () => {
      const sourceData: Record<string, string> = {};
      const batch1: Array<{ text: string; detected_source_language: string; billed_characters: number }> = [];
      const batch2: Array<{ text: string; detected_source_language: string; billed_characters: number }> = [];
      for (let i = 0; i < 100; i++) {
        const key = `key_${String(i).padStart(3, '0')}`;
        sourceData[key] = `source ${key}`;
        const translation = {
          text: `translated ${key}`,
          detected_source_language: 'EN',
          billed_characters: 10,
        };
        if (i < 50) batch1.push(translation);
        else batch2.push(translation);
      }

      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify(sourceData, null, 2) + '\n');

      const scope1 = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: unknown) => getTexts(body).length === 50)
        .reply(200, { translations: batch1 });
      const scope2 = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: unknown) => getTexts(body).length === 50)
        .reply(200, { translations: batch2 });

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(100);
      expect(scope1.isDone()).toBe(true);
      expect(scope2.isDone()).toBe(true);

      const targetFile = path.join(tmpDir, 'locales', 'de.json');
      expect(fs.existsSync(targetFile)).toBe(true);
      const translated = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      expect(Object.keys(translated)).toHaveLength(100);
      expect(translated['key_000']).toBe('translated key_000');
      expect(translated['key_099']).toBe('translated key_099');
    });
  });

  describe('xcstrings multi-locale round-trip', () => {
    // xcstrings is the only multi-locale format and the only one whose
    // reconstruct() mutates a file shared across locales. A parser regression
    // here would silently corrupt user translation files.
    it('translates en source into a de localization within the same .xcstrings file', async () => {
      const { XcstringsFormatParser } = jest.requireActual<typeof import('../../src/formats/xcstrings')>('../../src/formats/xcstrings');
      const xcRegistry = new FormatRegistry();
      xcRegistry.register(new XcstringsFormatParser());
      const xcServices = createServicesWithRegistry(xcRegistry);

      const xcConfig = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  xcstrings:
    include:
      - "Localizable.xcstrings"
`;
      writeYamlConfig(tmpDir, xcConfig);

      const xcFile: Record<string, unknown> = {
        sourceLanguage: 'en',
        version: '1.0',
        strings: {
          greeting: {
            comment: 'greeting shown on launch',
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
      };
      writeSourceFile(tmpDir, 'Localizable.xcstrings', JSON.stringify(xcFile, null, 2) + '\n');

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await xcServices.syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);

      const written = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'Localizable.xcstrings'), 'utf-8'),
      ) as { strings: Record<string, { localizations: Record<string, { stringUnit: { value: string; state: string } }> }> };

      // en localizations preserved
      expect(written.strings['greeting']!.localizations['en']!.stringUnit.value).toBe('Hello');
      expect(written.strings['farewell']!.localizations['en']!.stringUnit.value).toBe('Goodbye');
      // de localizations populated
      expect(written.strings['greeting']!.localizations['de']!.stringUnit.value).toBe('Hallo');
      expect(written.strings['greeting']!.localizations['de']!.stringUnit.state).toBe('translated');
      expect(written.strings['farewell']!.localizations['de']!.stringUnit.value).toBe('Auf Wiedersehen');

      xcServices.client.destroy();
    });
  });

  describe('po round-trip', () => {
    it('reconstructs a de.po file with translated msgstr, preserving msgctxt and long-string wrapping', async () => {
      const poRegistry = new FormatRegistry();
      poRegistry.register(new PoFormatParser());
      const poServices = createServicesWithRegistry(poRegistry);

      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  po:
    include:
      - "locales/en.po"
`);

      const longSource =
        'This is a very long description that should wrap across multiple lines when reconstructed because gettext prefers shorter lines for readability.';
      writeSourceFile(
        tmpDir,
        'locales/en.po',
        `msgctxt "button/save"
msgid "Save"
msgstr ""

msgid "${longSource}"
msgstr ""
`,
      );

      const longTranslation =
        'Dies ist eine sehr lange Beschreibung, die beim Wiederaufbau ueber mehrere Zeilen umgebrochen werden sollte, da gettext kuerzere Zeilen zur besseren Lesbarkeit bevorzugt.';

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Speichern', detected_source_language: 'EN', billed_characters: 4 },
            { text: longTranslation, detected_source_language: 'EN', billed_characters: longSource.length },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await poServices.syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(scope.isDone()).toBe(true);

      const targetPath = path.join(tmpDir, 'locales', 'de.po');
      expect(fs.existsSync(targetPath)).toBe(true);
      const written = fs.readFileSync(targetPath, 'utf-8');

      expect(written).toContain('msgctxt "button/save"');
      expect(written).toContain('msgstr "Speichern"');
      expect(written).toContain(longTranslation.split(' ').slice(0, 3).join(' '));

      const reparsed = new PoFormatParser().extract(written);
      const byKey = new Map(reparsed.map((e) => [e.key, e.value]));
      expect(byKey.size).toBe(2);

      poServices.client.destroy();
    });
  });

  describe('toml round-trip', () => {
    it('translates nested-table keys and preserves table structure on reconstruct', async () => {
      const tomlRegistry = new FormatRegistry();
      tomlRegistry.register(new TomlFormatParser());
      const tomlServices = createServicesWithRegistry(tomlRegistry);

      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  toml:
    include:
      - "locales/en.toml"
`);
      writeSourceFile(
        tmpDir,
        'locales/en.toml',
        `[greetings]
hello = "Hello"

[farewells]
goodbye = "Goodbye"
`,
      );

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await tomlServices.syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(scope.isDone()).toBe(true);

      const targetPath = path.join(tmpDir, 'locales', 'de.toml');
      expect(fs.existsSync(targetPath)).toBe(true);
      const written = fs.readFileSync(targetPath, 'utf-8');

      const reparsed = new TomlFormatParser().extract(written);
      const byKey = new Map(reparsed.map((e) => [e.key, e.value]));
      expect(byKey.get('greetings.hello')).toBe('Hallo');
      expect(byKey.get('farewells.goodbye')).toBe('Auf Wiedersehen');

      tomlServices.client.destroy();
    });
  });

  describe('arb round-trip', () => {
    it('translates user-facing keys while preserving @-prefixed metadata and placeholder markup', async () => {
      const arbRegistry = new FormatRegistry();
      arbRegistry.register(new ArbFormatParser());
      const arbServices = createServicesWithRegistry(arbRegistry);

      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  arb:
    include:
      - "locales/en.arb"
`);

      const sourceArb = {
        greeting: 'Hello, {name}',
        '@greeting': {
          description: 'Greeting with a name placeholder',
          placeholders: { name: { type: 'String' } },
        },
        welcome: 'Welcome',
      };
      writeSourceFile(tmpDir, 'locales/en.arb', JSON.stringify(sourceArb, null, 2) + '\n');

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Hallo, {name}', detected_source_language: 'EN', billed_characters: 13 },
            { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await arbServices.syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(scope.isDone()).toBe(true);

      const targetPath = path.join(tmpDir, 'locales', 'de.arb');
      expect(fs.existsSync(targetPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as Record<string, unknown>;

      expect(written['greeting']).toBe('Hallo, {name}');
      expect(written['welcome']).toBe('Willkommen');
      expect(written['@greeting']).toEqual({
        description: 'Greeting with a name placeholder',
        placeholders: { name: { type: 'String' } },
      });

      arbServices.client.destroy();
    });
  });

  describe('ios_strings round-trip', () => {
    it('translates entries while re-escaping quotes and preserving %@ placeholders', async () => {
      const iosRegistry = new FormatRegistry();
      iosRegistry.register(new IosStringsFormatParser());
      const iosServices = createServicesWithRegistry(iosRegistry);

      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  ios_strings:
    include:
      - "locales/en.strings"
`);
      writeSourceFile(
        tmpDir,
        'locales/en.strings',
        `"button_save" = "Save \\"Now\\"";
"greeting" = "Welcome %@";
`,
      );

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Jetzt "speichern"', detected_source_language: 'EN', billed_characters: 15 },
            { text: 'Willkommen %@', detected_source_language: 'EN', billed_characters: 13 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await iosServices.syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(2);
      expect(scope.isDone()).toBe(true);

      const targetPath = path.join(tmpDir, 'locales', 'de.strings');
      expect(fs.existsSync(targetPath)).toBe(true);
      const written = fs.readFileSync(targetPath, 'utf-8');

      expect(written).toContain('"button_save" = "Jetzt \\"speichern\\"";');
      expect(written).toContain('"greeting" = "Willkommen %@";');

      const reparsed = new IosStringsFormatParser().extract(written);
      const byKey = new Map(reparsed.map((e) => [e.key, e.value]));
      expect(byKey.get('button_save')).toBe('Jetzt "speichern"');
      expect(byKey.get('greeting')).toBe('Willkommen %@');

      iosServices.client.destroy();
    });
  });

  describe('properties round-trip', () => {
    it('handles keys with spaces, values containing =, and unicode characters', async () => {
      const propRegistry = new FormatRegistry();
      propRegistry.register(new PropertiesFormatParser());
      const propServices = createServicesWithRegistry(propRegistry);

      writeYamlConfig(tmpDir, `version: 1
source_locale: en
target_locales:
  - de
buckets:
  properties:
    include:
      - "locales/en.properties"
`);
      writeSourceFile(
        tmpDir,
        'locales/en.properties',
        `greeting=Hello
formula=x=5
cafe label=Café
`,
      );

      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Café', detected_source_language: 'EN', billed_characters: 4 },
            { text: 'x=5', detected_source_language: 'EN', billed_characters: 3 },
            { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
          ],
        });

      const config = await loadSyncConfig(tmpDir);
      const result = await propServices.syncService.sync(config);

      expect(result.success).toBe(true);
      expect(result.newKeys).toBe(3);
      expect(scope.isDone()).toBe(true);

      const targetPath = path.join(tmpDir, 'locales', 'de.properties');
      expect(fs.existsSync(targetPath)).toBe(true);
      const written = fs.readFileSync(targetPath, 'utf-8');

      const reparsed = new PropertiesFormatParser().extract(written);
      const byKey = new Map(reparsed.map((e) => [e.key, e.value]));
      expect(byKey.get('greeting')).toBe('Hallo');
      expect(byKey.get('formula')).toBe('x=5');
      expect(byKey.get('cafe label')).toBe('Café');

      propServices.client.destroy();
    });
  });
});

describe('Sync Integration — glossary: auto', () => {
  let tmpDir: string;
  let client: DeepLClient;
  let syncService: SyncService;

  const sourceWithRepeatedTerm = JSON.stringify(
    {
      'button.save': 'Save',
      'form.save': 'Save',
      'menu.save': 'Save',
      greeting: 'Hello',
    },
    null,
    2,
  ) + '\n';

  const autoGlossaryConfig = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  glossary: auto
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-gl-auto-'));
    const services = createServices();
    client = services.client;
    syncService = services.syncService;
  });

  afterEach(() => {
    client.destroy();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    nock.cleanAll();
  });

  it('creates a new glossary after first sync and persists the glossary_id in the lockfile', async () => {
    writeYamlConfig(tmpDir, autoGlossaryConfig);
    writeSourceFile(tmpDir, 'locales/en.json', sourceWithRepeatedTerm);

    // translateBatch deduplicates via Set, so 3 "Save" occurrences collapse to 1 request text.
    // Extraction order is alphabetical: button.save, form.save, greeting, menu.save.
    // Dedup preserves first-seen order → texts sent: ["Save", "Hello"].
    const translateScope = nock(DEEPL_FREE_API_URL)
      .post('/v2/translate')
      .reply(200, {
        translations: [
          { text: 'Speichern', detected_source_language: 'EN', billed_characters: 4 },
          { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
        ],
      });

    // getGlossaryByName → listGlossaries: no existing glossary
    const listScope = nock(DEEPL_FREE_API_URL)
      .get('/v3/glossaries')
      .reply(200, { glossaries: [] });

    // createGlossary
    const createScope = nock(DEEPL_FREE_API_URL)
      .post('/v3/glossaries')
      .reply(201, {
        glossary_id: 'gl-test-en-de',
        name: 'deepl-sync-en-de',
        creation_time: '2026-04-19T12:00:00Z',
        dictionaries: [{ source_lang: 'EN', target_lang: 'DE', entry_count: 1 }],
      });

    const config = await loadSyncConfig(tmpDir);
    const result = await syncService.sync(config);

    expect(result.success).toBe(true);
    expect(translateScope.isDone()).toBe(true);
    expect(listScope.isDone()).toBe(true);
    expect(createScope.isDone()).toBe(true);

    // Lockfile records the created glossary id for future runs
    const lockFilePath = path.join(tmpDir, LOCK_FILE_NAME);
    const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8'));
    expect(lockContent.glossary_ids).toBeDefined();
    expect(lockContent.glossary_ids['en-de']).toBe('gl-test-en-de');
  });

  it('updates the existing glossary on a re-sync without creating a new one', async () => {
    writeYamlConfig(tmpDir, autoGlossaryConfig);

    // Source adds one new key on top of the previously-synced set.
    writeSourceFile(
      tmpDir,
      'locales/en.json',
      JSON.stringify(
        {
          'button.save': 'Save',
          'form.save': 'Save',
          'menu.save': 'Save',
          greeting: 'Hello',
          farewell: 'Goodbye',
        },
        null,
        2,
      ) + '\n',
    );

    // Pre-seed target file (previous sync's output).
    writeSourceFile(
      tmpDir,
      'locales/de.json',
      JSON.stringify(
        {
          'button.save': 'Speichern',
          'form.save': 'Speichern',
          'menu.save': 'Speichern',
          greeting: 'Hallo',
        },
        null,
        2,
      ) + '\n',
    );

    const now = '2026-04-19T11:00:00Z';
    const saveHash = computeSourceHash('Save');
    const helloHash = computeSourceHash('Hello');
    const translatedDe = (hash: string) => ({ hash, translated_at: now, status: 'translated' as const });
    const seedEntries = {
      'locales/en.json': {
        'button.save': { source_text: 'Save', source_hash: saveHash, translations: { de: translatedDe(saveHash) } },
        'form.save': { source_text: 'Save', source_hash: saveHash, translations: { de: translatedDe(saveHash) } },
        'menu.save': { source_text: 'Save', source_hash: saveHash, translations: { de: translatedDe(saveHash) } },
        greeting: { source_text: 'Hello', source_hash: helloHash, translations: { de: translatedDe(helloHash) } },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, LOCK_FILE_NAME),
      JSON.stringify(
        {
          _comment: 'test lockfile',
          version: 1,
          generated_at: now,
          source_locale: 'en',
          glossary_ids: { 'en-de': 'gl-existing' },
          entries: seedEntries,
          stats: { total_keys: 4, total_translations: 4, last_sync: now },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // The new key "farewell" triggers one translate call for "Goodbye".
    const translateScope = nock(DEEPL_FREE_API_URL)
      .post('/v2/translate')
      .reply(200, {
        translations: [
          { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 7 },
        ],
      });

    // Existing glossary found by name (a POST /v3/glossaries would be the failure case).
    const listScope = nock(DEEPL_FREE_API_URL)
      .get('/v3/glossaries')
      .reply(200, {
        glossaries: [
          {
            glossary_id: 'gl-existing',
            name: 'deepl-sync-en-de',
            creation_time: '2026-04-18T10:00:00Z',
            dictionaries: [{ source_lang: 'EN', target_lang: 'DE', entry_count: 1 }],
          },
        ],
      });
    // Entries of existing glossary already match the single extracted term ("Save" -> "Speichern"),
    // so no add/remove calls fire.
    const entriesScope = nock(DEEPL_FREE_API_URL)
      .get('/v3/glossaries/gl-existing/entries')
      .query(true)
      .reply(200, {
        dictionaries: [
          { source_lang: 'EN', target_lang: 'DE', entries: 'Save\tSpeichern', entries_format: 'tsv' },
        ],
      });

    // If a translate or POST /v3/glossaries call happens, nock will raise an unmatched-request error
    // (we have not mocked either), which fails the test.

    const config = await loadSyncConfig(tmpDir);
    const result = await syncService.sync(config);

    expect(result.success).toBe(true);
    expect(translateScope.isDone()).toBe(true);
    expect(listScope.isDone()).toBe(true);
    expect(entriesScope.isDone()).toBe(true);

    // Lockfile glossary_id preserved — not overwritten, not cleared.
    const lockContent = JSON.parse(fs.readFileSync(path.join(tmpDir, LOCK_FILE_NAME), 'utf-8'));
    expect(lockContent.glossary_ids['en-de']).toBe('gl-existing');
  });
});

describe('Sync Integration — translation memory', () => {
  const TM_UUID_MY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const TM_UUID_BASE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const TM_UUID_DE_SPECIFIC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const TM_UUID_DE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const TM_UUID_FR = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const TM_UUID_SHARED = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  let tmpDir: string;
  let client: DeepLClient;
  let syncService: SyncService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-tm-'));
    const services = createServices();
    client = services.client;
    syncService = services.syncService;
  });

  afterEach(() => {
    client.destroy();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    nock.cleanAll();
  });

  interface TmEntry {
    id: string;
    name: string;
    source: string;
    target: string;
  }

  function mockListTms(tms: TmEntry[], times: number = 1): nock.Scope {
    const scope = nock(DEEPL_FREE_API_URL)
      .get('/v3/translation_memories')
      .times(times)
      .reply(200, {
        translation_memories: tms.map((t) => ({
          translation_memory_id: t.id,
          name: t.name,
          source_language: t.source,
          target_languages: [t.target],
        })),
      });
    return scope;
  }

  interface CapturedCall {
    targetLang: string;
    tmId: string | undefined;
    tmThreshold: string | undefined;
    body: Record<string, string | string[]>;
  }

  function mockTranslateCapture(capture: CapturedCall[], times: number): nock.Scope {
    return nock(DEEPL_FREE_API_URL)
      .post('/v2/translate')
      .times(times)
      .reply(200, (_uri: string, rawBody: unknown) => {
        const parsed = parseNockBody(rawBody);
        const targetLangRaw = parsed['target_lang'];
        const targetLang = Array.isArray(targetLangRaw) ? targetLangRaw[0]! : (targetLangRaw as string);
        const tmIdRaw = parsed['translation_memory_id'];
        const tmThresholdRaw = parsed['translation_memory_threshold'];
        capture.push({
          targetLang,
          tmId: Array.isArray(tmIdRaw) ? tmIdRaw[0] : (tmIdRaw),
          tmThreshold: Array.isArray(tmThresholdRaw) ? tmThresholdRaw[0] : (tmThresholdRaw),
          body: parsed,
        });
        const texts = getTexts(rawBody);
        return {
          translations: texts.map((t) => ({
            text: `${t}_${targetLang}`,
            detected_source_language: 'EN',
            billed_characters: t.length,
          })),
        };
      });
  }

  // ---- 1. Top-level-only TM ----
  //
  // The top-level pair-check validates the TM against every effective target
  // locale at once, so an en→de TM throws before any translate call fires for a
  // [de, fr] target set. Single-locale case only: the top-level name resolves
  // once and flows into the translate body with threshold defaulting to 75.
  describe('top-level TM only', () => {
    it('resolves via a single list call and threads id + default threshold into the translate body', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "my-tm"
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms([
        { id: TM_UUID_MY, name: 'my-tm', source: 'en', target: 'de' },
      ]);

      const calls: CapturedCall[] = [];
      const translateScope = mockTranslateCapture(calls, 1);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(listScope.isDone()).toBe(true);

      const deCall = calls.find((c) => c.targetLang === 'DE');
      expect(deCall).toBeDefined();
      expect(deCall!.tmId).toBe(TM_UUID_MY);
      expect(deCall!.tmThreshold).toBe('75');
      expect(translateScope.isDone()).toBe(true);
    });
  });

  // ---- 2. Per-locale override precedence ----
  describe('per-locale override precedence', () => {
    it('prefers override TM id over top-level TM id for the override locale', async () => {
      // Single target locale so the top-level pair-check passes. Both TM names
      // hit the list endpoint once each (cache is keyed by name), so two list
      // calls fire. The override TM wins on the de translate body.
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "base-tm"
  locale_overrides:
    de:
      translation_memory: "de-specific-tm"
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms(
        [
          { id: TM_UUID_BASE, name: 'base-tm', source: 'en', target: 'de' },
          { id: TM_UUID_DE_SPECIFIC, name: 'de-specific-tm', source: 'en', target: 'de' },
        ],
        2,
      );

      const calls: CapturedCall[] = [];
      const translateScope = mockTranslateCapture(calls, 1);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(listScope.isDone()).toBe(true);

      const deCall = calls.find((c) => c.targetLang === 'DE');
      expect(deCall!.tmId).toBe(TM_UUID_DE_SPECIFIC);
      expect(translateScope.isDone()).toBe(true);
    });

    it('routes each locale to its own per-locale override TM id in a multi-locale sync', async () => {
      // No top-level TM (avoids the multi-target pair-check ceiling), one
      // override per locale. Two distinct names → two list calls.
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
  - fr
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  locale_overrides:
    de:
      translation_memory: "de-tm"
    fr:
      translation_memory: "fr-tm"
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms(
        [
          { id: TM_UUID_DE, name: 'de-tm', source: 'en', target: 'de' },
          { id: TM_UUID_FR, name: 'fr-tm', source: 'en', target: 'fr' },
        ],
        2,
      );

      const calls: CapturedCall[] = [];
      const translateScope = mockTranslateCapture(calls, 2);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);

      expect(result.success).toBe(true);
      expect(listScope.isDone()).toBe(true);

      const deCall = calls.find((c) => c.targetLang === 'DE');
      const frCall = calls.find((c) => c.targetLang === 'FR');
      expect(deCall!.tmId).toBe(TM_UUID_DE);
      expect(frCall!.tmId).toBe(TM_UUID_FR);
      expect(translateScope.isDone()).toBe(true);
    });
  });

  // ---- 3. Threshold inheritance ----
  describe('threshold inheritance', () => {
    it('uses per-locale threshold override when set', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "my-tm"
  translation_memory_threshold: 60
  locale_overrides:
    de:
      translation_memory_threshold: 85
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms([
        { id: TM_UUID_MY, name: 'my-tm', source: 'en', target: 'de' },
      ]);

      const calls: CapturedCall[] = [];
      const translateScope = mockTranslateCapture(calls, 1);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      const deCall = calls.find((c) => c.targetLang === 'DE');
      expect(deCall!.tmId).toBe(TM_UUID_MY);
      expect(deCall!.tmThreshold).toBe('85');
      expect(listScope.isDone()).toBe(true);
      expect(translateScope.isDone()).toBe(true);
    });

    it('inherits top-level threshold when the locale has no override', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "my-tm"
  translation_memory_threshold: 60
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms([
        { id: TM_UUID_MY, name: 'my-tm', source: 'en', target: 'de' },
      ]);

      const calls: CapturedCall[] = [];
      const translateScope = mockTranslateCapture(calls, 1);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      const deCall = calls.find((c) => c.targetLang === 'DE');
      expect(deCall!.tmThreshold).toBe('60');
      expect(listScope.isDone()).toBe(true);
      expect(translateScope.isDone()).toBe(true);
    });
  });

  // ---- 4. Default threshold (75) ----
  describe('default threshold', () => {
    it('emits translation_memory_threshold=75 when no threshold is set anywhere', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "my-tm"
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms([
        { id: TM_UUID_MY, name: 'my-tm', source: 'en', target: 'de' },
      ]);

      const calls: CapturedCall[] = [];
      const translateScope = mockTranslateCapture(calls, 1);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      const deCall = calls.find((c) => c.targetLang === 'DE');
      expect(deCall!.tmThreshold).toBe('75');
      expect(listScope.isDone()).toBe(true);
      expect(translateScope.isDone()).toBe(true);
    });
  });

  // ---- 5. Omit-both on no-TM config ----
  describe('omit-both on no-TM config', () => {
    it('sends neither translation_memory_id nor translation_memory_threshold and makes zero list calls', async () => {
      writeYamlConfig(tmpDir, BASIC_CONFIG_YAML);
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const calls: CapturedCall[] = [];
      const translateScope = mockTranslateCapture(calls, 1);

      const config = await loadSyncConfig(tmpDir);
      await syncService.sync(config);

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.tmId).toBeUndefined();
        expect(call.tmThreshold).toBeUndefined();
        expect(call.body['translation_memory_id']).toBeUndefined();
        expect(call.body['translation_memory_threshold']).toBeUndefined();
      }

      const listMocksAfter = nock.pendingMocks().filter((m) => m.includes('/v3/translation_memories'));
      expect(listMocksAfter).toEqual([]);
      expect(translateScope.isDone()).toBe(true);
    });
  });

  // ---- 6. Lockfile non-recording (ADR Q7) ----
  describe('lockfile non-recording', () => {
    it('does not write translation_memory_ids onto the lockfile after a TM-configured sync', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "my-tm"
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms([
        { id: TM_UUID_MY, name: 'my-tm', source: 'en', target: 'de' },
      ]);
      const translateScope = mockTranslateCapture([], 1);

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config);
      expect(result.success).toBe(true);

      const lockContent = JSON.parse(
        fs.readFileSync(path.join(tmpDir, LOCK_FILE_NAME), 'utf-8'),
      ) as Record<string, unknown>;
      expect(lockContent['translation_memory_ids']).toBeUndefined();
      expect(listScope.isDone()).toBe(true);
      expect(translateScope.isDone()).toBe(true);
    });
  });

  // ---- 7. Cache-collision guard ----
  //
  // Shared TM name at top-level and per-locale override, with a per-locale
  // target the TM does not support. A silent cache hit on the second resolve
  // would skip the pair check; either way the required outcome is ConfigError,
  // not silent acceptance.
  describe('cache-collision regression guard', () => {
    it('throws ConfigError when a shared TM name cannot cover every target locale', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
  - fr
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "shared"
  locale_overrides:
    fr:
      translation_memory: "shared"
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      const listScope = mockListTms(
        [{ id: TM_UUID_SHARED, name: 'shared', source: 'en', target: 'de' }],
        1,
      );

      const config = await loadSyncConfig(tmpDir);
      const caught = await syncService.sync(config).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as Error).message).toMatch(/does not support the requested language pair/);

      expect(listScope.isDone()).toBe(true);
    });
  });

  // ---- 8. Invalid YAML threshold ----
  describe('invalid YAML threshold', () => {
    it('rejects translation_memory_threshold out of range at loadSyncConfig with key path in the message', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "my-tm"
  translation_memory_threshold: 999
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      await expect(loadSyncConfig(tmpDir)).rejects.toThrow(ConfigError);
      await expect(loadSyncConfig(tmpDir)).rejects.toThrow(
        /translation\.translation_memory_threshold must be an integer between 0 and 100/,
      );
    });
  });

  // ---- 9. Dry-run suppression ----
  describe('dry-run suppression', () => {
    it('makes zero list calls and zero translate calls when dryRun is set even with TM configured', async () => {
      writeYamlConfig(
        tmpDir,
        `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
translation:
  translation_memory: "my-tm"
  locale_overrides:
    de:
      translation_memory: "de-specific-tm"
`,
      );
      writeSourceFile(tmpDir, 'locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n');

      // No nock interceptors registered — any outbound request would
      // surface as an unmatched-request error and fail the test.

      const config = await loadSyncConfig(tmpDir);
      const result = await syncService.sync(config, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(nock.pendingMocks()).toEqual([]);
    });
  });
});

function createServicesWithRegistry(registry: FormatRegistry): { client: DeepLClient; syncService: SyncService } {
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
  const syncService = new SyncService(translationService, glossaryService, registry);
  return { client, syncService };
}

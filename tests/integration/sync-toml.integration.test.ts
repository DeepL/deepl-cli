/**
 * Integration test: fixture-driven TOML round-trip through the sync pipeline.
 *
 * Reads tests/fixtures/sync/formats/toml/source.toml, runs it through
 * SyncService with a nock-mocked DeepL response, and asserts the target
 * de.toml on disk matches tests/fixtures/sync/formats/toml/expected-after-sync/de.toml.
 *
 * Disk fixtures are required here: TomlFormatParser.reconstruct regressions
 * slip past unit tests that only exercise in-memory strings.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.unmock('fast-glob');

import nock from 'nock';

import { loadSyncConfig } from '../../src/sync/sync-config';
import { TomlFormatParser } from '../../src/formats/toml';
import { createSyncHarness, writeSyncConfig } from '../helpers/sync-harness';
import { DEEPL_FREE_API_URL } from '../helpers/nock-setup';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sync/formats/toml');

describe('sync TOML fixture round-trip', () => {
  let tmpDir: string;
  let harness: ReturnType<typeof createSyncHarness>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-toml-'));
    harness = createSyncHarness({ parsers: ['toml'] });
  });

  afterEach(() => {
    harness.cleanup();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    nock.cleanAll();
  });

  it('translates source.toml and writes de.toml matching the expected fixture', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'source.toml'), 'utf-8');
    const expected = fs.readFileSync(
      path.join(FIXTURE_DIR, 'expected-after-sync', 'de.toml'),
      'utf-8',
    );

    writeSyncConfig(tmpDir, {
      targetLocales: ['de'],
      buckets: { toml: { include: ['locales/en.toml'] } },
    });
    const sourcePath = path.join(tmpDir, 'locales', 'en.toml');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, source, 'utf-8');

    const scope = nock(DEEPL_FREE_API_URL)
      .post('/v2/translate')
      .reply(200, {
        // Order matches alphabetical sort of keys from TomlFormatParser.extract():
        // farewell, greeting, nav.home, nav.settings
        translations: [
          { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
          { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
          { text: 'Startseite', detected_source_language: 'EN', billed_characters: 10 },
          { text: 'Einstellungen', detected_source_language: 'EN', billed_characters: 13 },
        ],
      });

    const config = await loadSyncConfig(tmpDir);
    const result = await harness.syncService.sync(config);

    expect(result.success).toBe(true);
    expect(result.newKeys).toBe(4);
    expect(scope.isDone()).toBe(true);

    const targetPath = path.join(tmpDir, 'locales', 'de.toml');
    expect(fs.existsSync(targetPath)).toBe(true);
    const written = fs.readFileSync(targetPath, 'utf-8');
    expect(written).toBe(expected);

    // Defense in depth: reparse to confirm translations are extractable.
    const reparsed = new TomlFormatParser().extract(written);
    const byKey = new Map(reparsed.map((e) => [e.key, e.value]));
    expect(byKey.get('greeting')).toBe('Hallo');
    expect(byKey.get('farewell')).toBe('Auf Wiedersehen');
    expect(byKey.get('nav.home')).toBe('Startseite');
    expect(byKey.get('nav.settings')).toBe('Einstellungen');
  });
});

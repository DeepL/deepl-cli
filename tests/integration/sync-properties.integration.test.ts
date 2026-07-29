/**
 * Integration test: fixture-driven Java .properties round-trip through the sync pipeline.
 *
 * Reads tests/fixtures/sync/formats/properties/source.properties, runs it
 * through SyncService with a nock-mocked DeepL response, and asserts the
 * target de.properties on disk matches
 * tests/fixtures/sync/formats/properties/expected-after-sync/de.properties.
 *
 * Disk fixtures are required here: PropertiesFormatParser.reconstruct
 * regressions in escape handling or comment preservation slip past unit tests
 * that only exercise in-memory strings.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.unmock('fast-glob');

import nock from 'nock';

import { loadSyncConfig } from '../../src/sync/sync-config';
import { PropertiesFormatParser } from '../../src/formats/properties';
import { createSyncHarness, writeSyncConfig } from '../helpers/sync-harness';
import { DEEPL_FREE_API_URL } from '../helpers/nock-setup';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sync/formats/properties');

describe('sync Java properties fixture round-trip', () => {
  let tmpDir: string;
  let harness: ReturnType<typeof createSyncHarness>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-properties-'));
    harness = createSyncHarness({ parsers: ['properties'] });
  });

  afterEach(() => {
    harness.cleanup();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    nock.cleanAll();
  });

  it('translates source.properties and writes de.properties matching the expected fixture', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'source.properties'), 'utf-8');
    const expected = fs.readFileSync(
      path.join(FIXTURE_DIR, 'expected-after-sync', 'de.properties'),
      'utf-8',
    );

    writeSyncConfig(tmpDir, {
      targetLocales: ['de'],
      buckets: { properties: { include: ['locales/en.properties'] } },
    });
    const sourcePath = path.join(tmpDir, 'locales', 'en.properties');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, source, 'utf-8');

    const scope = nock(DEEPL_FREE_API_URL)
      .post('/v2/translate')
      .reply(200, {
        // Order matches alphabetical sort from PropertiesFormatParser.extract():
        // farewell, greeting, welcome
        translations: [
          { text: 'Auf Wiedersehen', detected_source_language: 'EN', billed_characters: 15 },
          { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
          { text: 'Willkommen', detected_source_language: 'EN', billed_characters: 10 },
        ],
      });

    const config = await loadSyncConfig(tmpDir);
    const result = await harness.syncService.sync(config);

    expect(result.success).toBe(true);
    expect(result.newKeys).toBe(3);
    expect(scope.isDone()).toBe(true);

    const targetPath = path.join(tmpDir, 'locales', 'de.properties');
    expect(fs.existsSync(targetPath)).toBe(true);
    const written = fs.readFileSync(targetPath, 'utf-8');
    expect(written).toBe(expected);

    // Defense in depth: the preceding comment ("# Welcome screen messages")
    // should be preserved verbatim in the target file.
    expect(written).toContain('# Welcome screen messages');

    const reparsed = new PropertiesFormatParser().extract(written);
    const byKey = new Map(reparsed.map((e) => [e.key, e.value]));
    expect(byKey.get('greeting')).toBe('Hallo');
    expect(byKey.get('farewell')).toBe('Auf Wiedersehen');
    expect(byKey.get('welcome')).toBe('Willkommen');
  });
});

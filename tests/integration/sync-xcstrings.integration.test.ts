/**
 * Integration test: fixture-driven Xcode String Catalog (.xcstrings) round-trip
 * through the sync pipeline.
 *
 * Reads tests/fixtures/sync/formats/xcstrings/source.xcstrings, runs it
 * through SyncService with a nock-mocked DeepL response, and asserts the
 * same Localizable.xcstrings file on disk (xcstrings is multi-locale — one
 * file holds every locale) matches
 * tests/fixtures/sync/formats/xcstrings/expected-after-sync/de.xcstrings.
 *
 * xcstrings multi-locale write serialization is called out as a landmine in
 * docs/SYNC.md: XcstringsFormatParser.reconstruct regressions would silently
 * corrupt user translation files, so it is exercised from disk fixtures.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.unmock('fast-glob');

import nock from 'nock';

import { loadSyncConfig } from '../../src/sync/sync-config';
import { XcstringsFormatParser } from '../../src/formats/xcstrings';
import { createSyncHarness, writeSyncConfig } from '../helpers/sync-harness';
import { DEEPL_FREE_API_URL } from '../helpers/nock-setup';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sync/formats/xcstrings');

describe('sync xcstrings fixture round-trip', () => {
  let tmpDir: string;
  let harness: ReturnType<typeof createSyncHarness>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-xcstrings-'));
    harness = createSyncHarness({ parsers: ['xcstrings'] });
  });

  afterEach(() => {
    harness.cleanup();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    nock.cleanAll();
  });

  it('translates source.xcstrings and writes the de localization in the same file matching the expected fixture', async () => {
    const source = fs.readFileSync(path.join(FIXTURE_DIR, 'source.xcstrings'), 'utf-8');
    const expected = fs.readFileSync(
      path.join(FIXTURE_DIR, 'expected-after-sync', 'de.xcstrings'),
      'utf-8',
    );

    writeSyncConfig(tmpDir, {
      targetLocales: ['de'],
      buckets: { xcstrings: { include: ['Localizable.xcstrings'] } },
    });
    const sourcePath = path.join(tmpDir, 'Localizable.xcstrings');
    fs.writeFileSync(sourcePath, source, 'utf-8');

    const scope = nock(DEEPL_FREE_API_URL)
      .post('/v2/translate')
      .reply(200, {
        // Order matches alphabetical sort from XcstringsFormatParser.extract():
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

    // xcstrings is multi-locale: the en source and de localizations live in
    // the SAME Localizable.xcstrings file, not a separate de.xcstrings file.
    const written = fs.readFileSync(sourcePath, 'utf-8');
    expect(written).toBe(expected);

    // Defense in depth: re-extract each locale to confirm both are present.
    const parser = new XcstringsFormatParser();
    const enEntries = parser.extract(written, 'en');
    const deEntries = parser.extract(written, 'de');
    expect(enEntries.map((e) => e.value).sort()).toEqual(['Goodbye', 'Hello', 'Welcome']);
    expect(deEntries.map((e) => e.value).sort()).toEqual(['Auf Wiedersehen', 'Hallo', 'Willkommen']);
  });
});

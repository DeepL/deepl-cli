/**
 * Integration test: walker skip-partition invariant on the TMS push/pull
 * pipeline.
 *
 * Drives pushTranslations / pullTranslations against a real Laravel PHP
 * source+target pair (from tests/fixtures/sync/laravel_php-pipe-plural/) with
 * a nock-mocked TMS server. Asserts the exact set of PUT /keys/... calls and
 * verifies that keys tagged as pipe-pluralization by the walker's skip
 * partition never cross the TMS wire on push, and never overwrite the target
 * file on pull.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.unmock('fast-glob');

import nock from 'nock';

import { TmsClient } from '../../src/sync/tms-client';
import { pushTranslations, pullTranslations } from '../../src/sync/sync-tms';
import { FormatRegistry } from '../../src/formats/index';
import { PhpArraysFormatParser } from '../../src/formats/php-arrays';
import type { ResolvedSyncConfig } from '../../src/sync/sync-config';

import { TMS_BASE, TMS_PROJECT, expectTmsPush, expectTmsPull } from '../helpers/tms-nock';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sync/laravel_php-pipe-plural');

function makeConfig(projectRoot: string, overrides: Partial<ResolvedSyncConfig> = {}): ResolvedSyncConfig {
  return {
    version: 1,
    source_locale: 'en',
    target_locales: ['de'],
    buckets: { laravel_php: { include: ['en.php'] } },
    configPath: path.join(projectRoot, '.deepl-sync.yaml'),
    projectRoot,
    overrides: {},
    tms: {
      enabled: true,
      server: TMS_BASE,
      project_id: TMS_PROJECT,
    },
    ...overrides,
  };
}

function makeRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register(new PhpArraysFormatParser());
  return registry;
}

function makeClient(): TmsClient {
  return new TmsClient({
    serverUrl: TMS_BASE,
    projectId: TMS_PROJECT,
    apiKey: 'k',
  });
}

describe('sync push/pull walker skip-partition integration', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-skip-partition-'));
    fs.copyFileSync(path.join(FIXTURE_DIR, 'en.php'), path.join(projectRoot, 'en.php'));
    fs.copyFileSync(path.join(FIXTURE_DIR, 'de.php'), path.join(projectRoot, 'de.php'));
  });

  afterEach(() => {
    if (fs.existsSync(projectRoot)) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
    nock.cleanAll();
  });

  it('push: pipe-plural keys are not sent on the wire; only non-plural keys reach /keys/...', async () => {
    // Scope exactly the calls we expect. If the pipe-plural leak regresses,
    // nock will yield a "No match for request" failure for `apples` or `days`,
    // and these scopes will report `isDone() === false` on the greeted ones.
    const scopes = [
      expectTmsPush('greeting', 'de', 'Hallo'),
      expectTmsPush('farewell', 'de', 'Tschüss'),
    ];

    const result = await pushTranslations(makeConfig(projectRoot), makeClient(), makeRegistry());

    expect(result.pushed).toBe(2);
    for (const scope of scopes) {
      expect(scope.isDone()).toBe(true);
    }

    const skippedKeys = result.skipped
      .filter((s) => s.reason === 'pipe_pluralization')
      .map((s) => s.key)
      .sort();
    expect(skippedKeys).toEqual(['apples', 'days']);
    expect(nock.isDone()).toBe(true);
  });

  it('pull: pipe-plural keys in the target file are not overwritten with TMS payload', async () => {
    // TMS returns translations for every source key including the pipe-plural
    // ones — a realistic "admin approved these in the TMS UI" scenario. If the
    // pull applied them, the single-string TMS payload would overwrite the
    // target's Laravel pluralization syntax and corrupt it.
    const scope = expectTmsPull('de', {
      greeting: 'Hallo',
      farewell: 'Tschüss',
      apples: 'WRONG — pipe plural replacement',
      days: 'WRONG — pipe plural replacement',
    });

    const result = await pullTranslations(makeConfig(projectRoot), makeClient(), makeRegistry());

    expect(result.pulled).toBeGreaterThanOrEqual(2);
    expect(scope.isDone()).toBe(true);

    const writtenDe = fs.readFileSync(path.join(projectRoot, 'de.php'), 'utf-8');
    // Pipe-plural values in the target file must be preserved verbatim from
    // the pre-pull target (which matched the source fixture). If the partition
    // regressed, the literal string 'WRONG — pipe plural replacement' would
    // appear in one of the two plural slots.
    expect(writtenDe).not.toContain('WRONG');
    expect(writtenDe).toContain('{0} No apples|{1} One apple|[2,*] Many apples');
    expect(writtenDe).toContain('[0,0] No days|[1,6] A few days|[7,*] Full week');
    expect(writtenDe).toContain("'greeting' => 'Hallo'");
    expect(writtenDe).toContain("'farewell' => 'Tschüss'");
    expect(nock.isDone()).toBe(true);
  });

  it('push: never issues a request for a pipe-plural key even when TMS is offline for those paths', async () => {
    // Only arm the two non-plural endpoints. If a leak regresses, nock will
    // reject the unmatched PUT with a NetConnectNotAllowedError, failing fast.
    nock.disableNetConnect();
    try {
      const scopes = [
        expectTmsPush('greeting', 'de', 'Hallo'),
        expectTmsPush('farewell', 'de', 'Tschüss'),
      ];

      const result = await pushTranslations(makeConfig(projectRoot), makeClient(), makeRegistry());

      expect(result.pushed).toBe(2);
      for (const scope of scopes) {
        expect(scope.isDone()).toBe(true);
      }
    } finally {
      nock.enableNetConnect();
    }
  });

  it('push: records SkippedRecord for every (file, locale, pipe_plural_key) triple', async () => {
    expectTmsPush('greeting', 'de', 'Hallo');
    expectTmsPush('farewell', 'de', 'Tschüss');
    expectTmsPush('greeting', 'fr', 'Hallo');
    expectTmsPush('farewell', 'fr', 'Tschüss');
    // Add a second target locale with the same target-file content so the
    // walker emits skip records for both locales.
    fs.copyFileSync(path.join(projectRoot, 'de.php'), path.join(projectRoot, 'fr.php'));

    const config = makeConfig(projectRoot, { target_locales: ['de', 'fr'] });
    const result = await pushTranslations(config, makeClient(), makeRegistry());

    expect(result.pushed).toBe(4);
    const keyed = result.skipped
      .filter((s) => s.reason === 'pipe_pluralization')
      .map((s) => `${s.locale}:${s.key}`)
      .sort();
    expect(keyed).toEqual([
      'de:apples',
      'de:days',
      'fr:apples',
      'fr:days',
    ]);
  });
});

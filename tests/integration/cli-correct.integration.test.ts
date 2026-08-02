/**
 * Integration Tests for Correct CLI Command
 * Tests the DeepL Write API /v2/write/correct integration
 */

import nock from 'nock';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { DeepLClient } from '../../src/api/deepl-client.js';
import { WriteService } from '../../src/services/write.js';
import { ConfigService } from '../../src/storage/config.js';
import { CacheService } from '../../src/storage/cache.js';
import { DEEPL_FREE_API_URL, TEST_API_KEY } from '../helpers';

describe('Correct Command Integration', () => {
  const API_KEY = TEST_API_KEY;
  const FREE_API_URL = DEEPL_FREE_API_URL;
  let client: DeepLClient;
  let writeService: WriteService;
  let configService: ConfigService;
  let cacheService: CacheService;
  const testDir = path.join(os.tmpdir(), `.deepl-cli-correct-int-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    const configPath = path.join(testDir, 'config.json');
    const cachePath = path.join(testDir, 'cache.db');
    configService = new ConfigService(configPath);
    cacheService = new CacheService({ dbPath: cachePath, maxSize: 1024 * 100 });
    client = new DeepLClient(API_KEY);
    writeService = new WriteService(client, configService, cacheService);
  });

  afterEach(() => {
    client.destroy();
    nock.abortPendingRequests();
    nock.cleanAll();
    try { cacheService.close(); } catch { /* ignore */ }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('correct() - Basic Correction', () => {
    it('should correct text with explicit target language', async () => {
      const scope = nock(FREE_API_URL)
        .post('/v2/write/correct', (body) => {
          expect(body.text).toBe('This is an test.');
          expect(body.target_lang).toBe('en-US');
          expect(body.writing_style).toBeUndefined();
          expect(body.tone).toBeUndefined();
          return true;
        })
        .reply(200, {
          improvements: [{ text: 'This is a test.', target_language: 'en-US' }],
        });

      const result = await writeService.correct('This is an test.', { targetLang: 'en-US' });

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('This is a test.');
      expect(scope.isDone()).toBe(true);
    });

    it('should correct text without target_lang (auto-detect)', async () => {
      const scope = nock(FREE_API_URL)
        .post('/v2/write/correct', (body) => {
          expect(body.text).toBe('Das ist ein Testt.');
          expect(body.target_lang).toBeUndefined();
          return true;
        })
        .reply(200, {
          improvements: [{ text: 'Das ist ein Test.', target_language: 'de', detected_source_language: 'de' }],
        });

      const result = await writeService.correct('Das ist ein Testt.');

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('Das ist ein Test.');
      expect(result[0]?.detectedSourceLanguage).toBe('de');
      expect(scope.isDone()).toBe(true);
    });

    it('should return multiple correction alternatives when provided', async () => {
      nock(FREE_API_URL)
        .post('/v2/write/correct')
        .reply(200, {
          improvements: [
            { text: 'This is a test.', target_language: 'en-US' },
            { text: 'This is one test.', target_language: 'en-US' },
          ],
        });

      const result = await writeService.correct('This is an test.', { targetLang: 'en-US' });

      expect(result).toHaveLength(2);
      expect(result[0]?.text).toBe('This is a test.');
      expect(result[1]?.text).toBe('This is one test.');
    });

    it('should throw error for empty improvements array from API', async () => {
      nock(FREE_API_URL)
        .post('/v2/write/correct')
        .reply(200, {
          improvements: [],
        });

      await expect(
        writeService.correct('Perfect text.', { targetLang: 'en-US' })
      ).rejects.toThrow('No improvements returned');
    });

    it('should not touch the rephrase endpoint', async () => {
      const rephraseScope = nock(FREE_API_URL)
        .post('/v2/write/rephrase')
        .reply(200, { improvements: [{ text: 'x', target_language: 'en-US' }] });
      nock(FREE_API_URL)
        .post('/v2/write/correct')
        .reply(200, {
          improvements: [{ text: 'This is a test.', target_language: 'en-US' }],
        });

      await writeService.correct('This is an test.', { targetLang: 'en-US' });

      expect(rephraseScope.isDone()).toBe(false);
    });
  });

  describe('correct() - Error Handling', () => {
    it('should handle 403 authentication error', async () => {
      nock(FREE_API_URL)
        .post('/v2/write/correct')
        .reply(403, { message: 'Authorization failed' });

      await expect(
        writeService.correct('Test', { targetLang: 'en-US' })
      ).rejects.toThrow(/auth|API key|forbidden/i);
    });

    it('should handle 429 rate limit error', async () => {
      nock(FREE_API_URL)
        .post('/v2/write/correct')
        .times(10)
        .reply(429, { message: 'Too many requests' });

      await expect(
        writeService.correct('Test', { targetLang: 'en-US' })
      ).rejects.toThrow(/rate|too many|limit/i);
    });

    it('should handle 503 service unavailable', async () => {
      nock(FREE_API_URL)
        .post('/v2/write/correct')
        .times(10)
        .reply(503, { message: 'Service unavailable' });

      await expect(
        writeService.correct('Test', { targetLang: 'en-US' })
      ).rejects.toThrow();
    });

    it('should reject empty text without any HTTP request', async () => {
      const scope = nock(FREE_API_URL)
        .post('/v2/write/correct')
        .reply(200, { improvements: [] });

      await expect(writeService.correct('', {})).rejects.toThrow('Text cannot be empty');
      expect(scope.isDone()).toBe(false);
    });
  });

  describe('correct() - Caching', () => {
    it('should serve a repeated request from cache with a single HTTP call', async () => {
      const scope = nock(FREE_API_URL)
        .post('/v2/write/correct')
        .once()
        .reply(200, {
          improvements: [{ text: 'This is a test.', target_language: 'en-US' }],
        });

      const first = await writeService.correct('This is an test.', { targetLang: 'en-US' });
      const second = await writeService.correct('This is an test.', { targetLang: 'en-US' });

      expect(first).toEqual(second);
      expect(scope.isDone()).toBe(true);
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should not serve correct results to improve() (distinct cache namespaces)', async () => {
      const correctScope = nock(FREE_API_URL)
        .post('/v2/write/correct')
        .once()
        .reply(200, {
          improvements: [{ text: 'Corrected.', target_language: 'en-US' }],
        });
      const rephraseScope = nock(FREE_API_URL)
        .post('/v2/write/rephrase')
        .once()
        .reply(200, {
          improvements: [{ text: 'Rephrased.', target_language: 'en-US' }],
        });

      const corrected = await writeService.correct('Same text.', { targetLang: 'en-US' });
      const improved = await writeService.improve('Same text.', { targetLang: 'en-US' });

      expect(corrected[0]?.text).toBe('Corrected.');
      expect(improved[0]?.text).toBe('Rephrased.');
      expect(correctScope.isDone()).toBe(true);
      expect(rephraseScope.isDone()).toBe(true);
    });

    it('should bypass cache when skipCache is set', async () => {
      const scope = nock(FREE_API_URL)
        .post('/v2/write/correct')
        .twice()
        .reply(200, {
          improvements: [{ text: 'This is a test.', target_language: 'en-US' }],
        });

      await writeService.correct('This is an test.', { targetLang: 'en-US' }, { skipCache: true });
      await writeService.correct('This is an test.', { targetLang: 'en-US' }, { skipCache: true });

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('getBestCorrection()', () => {
    it('should return the first correction from the API response', async () => {
      nock(FREE_API_URL)
        .post('/v2/write/correct')
        .reply(200, {
          improvements: [
            { text: 'Best correction.', target_language: 'en-US' },
            { text: 'Second correction.', target_language: 'en-US' },
          ],
        });

      const result = await writeService.getBestCorrection('Test', { targetLang: 'en-US' });

      expect(result.text).toBe('Best correction.');
    });
  });
});

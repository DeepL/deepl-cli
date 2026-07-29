/**
 * Integration Tests for File Translation Service
 * Tests file translation workflows with nock-mocked DeepL API
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import nock from 'nock';
import { FileTranslationService } from '../../src/services/file-translation';
import { TranslationService } from '../../src/services/translation';
import { DeepLClient } from '../../src/api/deepl-client';
import { ConfigService } from '../../src/storage/config';
import { CacheService } from '../../src/storage/cache';
import { DEEPL_FREE_API_URL, TEST_API_KEY } from '../helpers';

describe('FileTranslation Integration', () => {
  let testDir: string;
  let configDir: string;
  let service: FileTranslationService;
  let client: DeepLClient;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `deepl-file-integ-${Date.now()}`);
    configDir = path.join(os.tmpdir(), `deepl-file-integ-config-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    client = new DeepLClient(TEST_API_KEY);
    const configService = new ConfigService(path.join(configDir, 'config.json'));
    const cacheService = new CacheService({ dbPath: path.join(configDir, 'cache.db') });
    const translationService = new TranslationService(client, configService, cacheService);
    service = new FileTranslationService(translationService);
  });

  afterEach(() => {
    client.destroy();
    nock.cleanAll();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  describe('translateFile() with API', () => {
    it('should translate a .txt file via API', async () => {
      const inputPath = path.join(testDir, 'hello.txt');
      const outputPath = path.join(testDir, 'hola.txt');
      fs.writeFileSync(inputPath, 'Hello world');

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body) => {
          expect(body.text).toBe('Hello world');
          expect(body.target_lang).toBe('ES');
          return true;
        })
        .reply(200, {
          translations: [{ text: 'Hola mundo', detected_source_language: 'EN' }],
        });

      await service.translateFile(inputPath, outputPath, { targetLang: 'es' });

      const output = fs.readFileSync(outputPath, 'utf-8');
      expect(output).toBe('Hola mundo');
    });

    it('should translate a .md file via API', async () => {
      const inputPath = path.join(testDir, 'readme.md');
      const outputPath = path.join(testDir, 'readme-de.md');
      fs.writeFileSync(inputPath, '# Hello\n\nThis is a test.');

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: '# Hallo\n\nDas ist ein Test.', detected_source_language: 'EN' }],
        });

      await service.translateFile(inputPath, outputPath, { targetLang: 'de' });

      const output = fs.readFileSync(outputPath, 'utf-8');
      expect(output).toContain('# Hallo');
    });

    it('should handle 403 authentication error', async () => {
      const inputPath = path.join(testDir, 'test.txt');
      const outputPath = path.join(testDir, 'out.txt');
      fs.writeFileSync(inputPath, 'Hello');

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(403, { message: 'Invalid API key' });

      await expect(
        service.translateFile(inputPath, outputPath, { targetLang: 'es' })
      ).rejects.toThrow();
    });

    it('should handle 429 rate limit error', async () => {
      const inputPath = path.join(testDir, 'test.txt');
      const outputPath = path.join(testDir, 'out.txt');
      fs.writeFileSync(inputPath, 'Hello');

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .times(4)
        .reply(429, { message: 'Too many requests' });

      await expect(
        service.translateFile(inputPath, outputPath, { targetLang: 'es' })
      ).rejects.toThrow();
    });

    it('should handle 503 service unavailable', async () => {
      const inputPath = path.join(testDir, 'test.txt');
      const outputPath = path.join(testDir, 'out.txt');
      fs.writeFileSync(inputPath, 'Hello');

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(503, { message: 'Service unavailable' });

      await expect(
        service.translateFile(inputPath, outputPath, { targetLang: 'es' })
      ).rejects.toThrow();
    });

    it('should reject unsupported file types', async () => {
      const inputPath = path.join(testDir, 'doc.pdf');
      const outputPath = path.join(testDir, 'out.pdf');
      fs.writeFileSync(inputPath, 'pdf content');

      await expect(
        service.translateFile(inputPath, outputPath, { targetLang: 'es' })
      ).rejects.toThrow('Unsupported file type');
    });

    it('should reject empty files', async () => {
      const inputPath = path.join(testDir, 'empty.txt');
      const outputPath = path.join(testDir, 'out.txt');
      fs.writeFileSync(inputPath, '');

      await expect(
        service.translateFile(inputPath, outputPath, { targetLang: 'es' })
      ).rejects.toThrow('Cannot translate empty file');
    });

    it('should reject non-existent files', async () => {
      await expect(
        service.translateFile(
          path.join(testDir, 'missing.txt'),
          path.join(testDir, 'out.txt'),
          { targetLang: 'es' }
        )
      ).rejects.toThrow();
    });
  });

  describe('translateFileToMultiple() with API', () => {
    it('should translate to multiple languages', async () => {
      const inputPath = path.join(testDir, 'hello.txt');
      fs.writeFileSync(inputPath, 'Hello');

      nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body) => body.target_lang === 'DE')
        .reply(200, { translations: [{ text: 'Hallo', detected_source_language: 'EN' }] })
        .post('/v2/translate', (body) => body.target_lang === 'FR')
        .reply(200, { translations: [{ text: 'Bonjour', detected_source_language: 'EN' }] });

      const results = await service.translateFileToMultiple(
        inputPath,
        ['de', 'fr'],
        { outputDir: testDir }
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.targetLang).toBe('de');
      expect(results[1]?.targetLang).toBe('fr');
    });
  });
});

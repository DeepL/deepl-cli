/**
 * Integration Tests for Batch Translation Service
 * Tests parallel file translation with progress tracking and error recovery
 *
 * Uses real temp directories with actual files instead of mocking fast-glob,
 * so that changes to the fast-glob API are caught by these tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use real fast-glob instead of the automatic mock in __mocks__/fast-glob.ts
jest.unmock('fast-glob');

// Mock p-limit BEFORE other imports - return a factory function
jest.mock('p-limit', () => ({
  __esModule: true,
  default: (_concurrency: number) => {
    return (fn: () => Promise<any>) => fn();
  },
}));
import nock from 'nock';
import { BatchTranslationService } from '../../src/services/batch-translation.js';
import { FileTranslationService } from '../../src/services/file-translation.js';
import { TranslationService } from '../../src/services/translation.js';
import { DeepLClient } from '../../src/api/deepl-client.js';
import { ConfigService } from '../../src/storage/config.js';
import { TEST_API_KEY, createMockConfigService, createMockCacheService, DEEPL_FREE_API_URL } from '../helpers';

describe('Batch Translation Service Integration', () => {
  const API_KEY = TEST_API_KEY;
  let batchService: BatchTranslationService;
  let fileTranslationService: FileTranslationService;
  let translationService: TranslationService;
  let client: DeepLClient;
  let mockConfig: ConfigService;
  let tmpDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-batch-test-'));

    // Set up services
    client = new DeepLClient(API_KEY);
    mockConfig = createMockConfigService({
      get: jest.fn(() => ({
        auth: {},
        api: { baseUrl: '', usePro: false },
        defaults: { targetLangs: [], formality: 'default', preserveFormatting: false },
        cache: { enabled: true },
        output: { format: 'text', color: true },
        proxy: {},
      })),
      getValue: jest.fn(() => true),
    });

    translationService = new TranslationService(client, mockConfig);
    fileTranslationService = new FileTranslationService(translationService);
    batchService = new BatchTranslationService(fileTranslationService);
  });

  afterEach(() => {
    client.destroy();
    // Cleanup temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create service with default concurrency', () => {
      const service = new BatchTranslationService(fileTranslationService);
      expect(service).toBeInstanceOf(BatchTranslationService);
    });

    it('should create service with custom concurrency', () => {
      const service = new BatchTranslationService(fileTranslationService, { concurrency: 10 });
      expect(service).toBeInstanceOf(BatchTranslationService);
    });

    it('should throw error for concurrency less than 1', () => {
      expect(() => {
        new BatchTranslationService(fileTranslationService, { concurrency: 0 });
      }).toThrow('Concurrency must be at least 1');
    });

    it('should throw error for concurrency greater than 100', () => {
      expect(() => {
        new BatchTranslationService(fileTranslationService, { concurrency: 101 });
      }).toThrow('Concurrency cannot exceed 100');
    });

    it('should accept concurrency of 1', () => {
      const service = new BatchTranslationService(fileTranslationService, { concurrency: 1 });
      expect(service).toBeInstanceOf(BatchTranslationService);
    });

    it('should accept concurrency of 100', () => {
      const service = new BatchTranslationService(fileTranslationService, { concurrency: 100 });
      expect(service).toBeInstanceOf(BatchTranslationService);
    });
  });

  describe('translateFiles', () => {
    it('should return empty result for empty file list', async () => {
      const result = await batchService.translateFiles([], { targetLang: 'es' });

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it('should translate multiple files', async () => {
      // Create test files
      const file1 = path.join(tmpDir, 'file1.txt');
      const file2 = path.join(tmpDir, 'file2.txt');
      fs.writeFileSync(file1, 'Hello world');
      fs.writeFileSync(file2, 'Good morning');

      // Mock translation
      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola mundo',
      });

      const result = await batchService.translateFiles(
        [file1, file2],
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it('should skip unsupported file types', async () => {
      const txtFile = path.join(tmpDir, 'test.txt');
      const pdfFile = path.join(tmpDir, 'test.pdf');
      fs.writeFileSync(txtFile, 'Hello');
      fs.writeFileSync(pdfFile, Buffer.from([0x25, 0x50, 0x44, 0x46]));

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateFiles(
        [txtFile, pdfFile],
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      expect(result.successful).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.file).toBe(pdfFile);
      expect(result.skipped[0]?.reason).toBe('Unsupported file type');
    });

    it('should handle translation errors', async () => {
      const file1 = path.join(tmpDir, 'file1.txt');
      const file2 = path.join(tmpDir, 'file2.txt');
      fs.writeFileSync(file1, 'Hello');
      fs.writeFileSync(file2, 'World');

      // First translation succeeds, second fails
      jest.spyOn(translationService, 'translate')
        .mockResolvedValueOnce({ text: 'Hola' })
        .mockRejectedValueOnce(new Error('API error'));

      const result = await batchService.translateFiles(
        [file1, file2],
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      expect(result.successful).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.error).toContain('API error');
    });

    it('should call progress callback', async () => {
      const file1 = path.join(tmpDir, 'file1.txt');
      const file2 = path.join(tmpDir, 'file2.txt');
      fs.writeFileSync(file1, 'Hello');
      fs.writeFileSync(file2, 'World');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const progressCalls: Array<{ completed: number; total: number; current?: string }> = [];
      const onProgress = jest.fn((progress) => {
        progressCalls.push(progress);
      });

      await batchService.translateFiles(
        [file1, file2],
        { targetLang: 'es' },
        { outputDir: tmpDir, onProgress }
      );

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(progressCalls).toHaveLength(2);
      expect(progressCalls[0]?.total).toBe(2);
      expect(progressCalls[1]?.total).toBe(2);
      expect(progressCalls[1]?.completed).toBe(2);
    });

    it('should generate default output paths', async () => {
      const file = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(file, 'Hello');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateFiles(
        [file],
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      expect(result.successful).toHaveLength(1);
      expect(result.successful[0]?.outputPath).toBe(path.join(tmpDir, 'test.es.txt'));
    });

    it('should use custom output pattern', async () => {
      const file = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(file, 'Hello');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateFiles(
        [file],
        { targetLang: 'es' },
        { outputDir: tmpDir, outputPattern: '{name}-{lang}{ext}' }
      );

      expect(result.successful).toHaveLength(1);
      expect(result.successful[0]?.outputPath).toBe(path.join(tmpDir, 'test-es.txt'));
    });

    it('should preserve directory structure when baseDir is provided', async () => {
      const subDir = path.join(tmpDir, 'sub', 'nested');
      fs.mkdirSync(subDir, { recursive: true });
      const file = path.join(subDir, 'test.txt');
      fs.writeFileSync(file, 'Hello');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const outputDir = path.join(tmpDir, 'output');
      const result = await batchService.translateFiles(
        [file],
        { targetLang: 'es' },
        { outputDir, baseDir: tmpDir }
      );

      expect(result.successful).toHaveLength(1);
      expect(result.successful[0]?.outputPath).toBe(
        path.join(outputDir, 'sub', 'nested', 'test.es.txt')
      );
    });
  });

  describe('translateDirectory', () => {
    it('should not follow symlinks out of the input directory', async () => {
      const inputDir = path.join(tmpDir, 'input');
      const outsideDir = path.join(tmpDir, 'outside');
      fs.mkdirSync(inputDir);
      fs.mkdirSync(outsideDir);
      fs.writeFileSync(path.join(inputDir, 'real.txt'), 'Hello');
      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'Secret');
      fs.symlinkSync(outsideDir, path.join(inputDir, 'linked-dir'));
      fs.symlinkSync(
        path.join(outsideDir, 'secret.txt'),
        path.join(inputDir, 'linked-file.txt')
      );

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateDirectory(
        inputDir,
        { targetLang: 'es' },
        { outputDir: path.join(tmpDir, 'out') }
      );

      const seen = [
        ...result.successful.map((e) => e.file),
        ...result.failed.map((e) => e.file),
        ...result.skipped.map((e) => e.file),
      ];
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(path.join(inputDir, 'real.txt'));
    });

    it('should throw error for non-existent directory', async () => {
      await expect(
        batchService.translateDirectory('/nonexistent', { targetLang: 'es' })
      ).rejects.toThrow('Directory not found');
    });

    it('should throw error when path is not a directory', async () => {
      const file = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(file, 'Hello');

      await expect(
        batchService.translateDirectory(file, { targetLang: 'es' })
      ).rejects.toThrow('Not a directory');
    });

    it('should translate all files in directory', async () => {
      // Create test files
      fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'Hello');
      fs.writeFileSync(path.join(tmpDir, 'file2.md'), '# World');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateDirectory(
        tmpDir,
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('should filter to only supported file types', async () => {
      fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'Hello');
      fs.writeFileSync(path.join(tmpDir, 'file2.pdf'), Buffer.from([0x25]));
      fs.writeFileSync(path.join(tmpDir, 'file3.md'), '# World');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateDirectory(
        tmpDir,
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      // Only .txt and .md should be translated
      expect(result.successful).toHaveLength(2);
    });

    it('should respect recursive option (false)', async () => {
      fs.writeFileSync(path.join(tmpDir, 'root.txt'), 'Root');

      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'nested.txt'), 'Nested');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateDirectory(
        tmpDir,
        { targetLang: 'es' },
        { outputDir: tmpDir, recursive: false }
      );

      // Only root.txt should be found
      expect(result.successful).toHaveLength(1);
      expect(result.successful[0]?.file).toBe(path.join(tmpDir, 'root.txt'));
    });

    it('should respect recursive option (true, default)', async () => {
      fs.writeFileSync(path.join(tmpDir, 'root.txt'), 'Root');

      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'nested.txt'), 'Nested');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateDirectory(
        tmpDir,
        { targetLang: 'es' },
        { outputDir: tmpDir, recursive: true }
      );

      // Both files should be found
      expect(result.successful).toHaveLength(2);
    });

    it('should use custom pattern for file filtering', async () => {
      fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'Hello');
      fs.writeFileSync(path.join(tmpDir, 'file2.md'), '# World');

      jest.spyOn(translationService, 'translate').mockResolvedValue({
        text: 'Hola',
      });

      const result = await batchService.translateDirectory(
        tmpDir,
        { targetLang: 'es' },
        { outputDir: tmpDir, pattern: '*.txt' }
      );

      // Only .txt files should be matched
      expect(result.successful).toHaveLength(1);
      expect(result.successful[0]?.file).toBe(path.join(tmpDir, 'file1.txt'));
    });
  });

  describe('getStatistics', () => {
    it('should calculate statistics correctly', () => {
      const result = {
        successful: [{ file: 'a', outputPath: 'a.es' }, { file: 'b', outputPath: 'b.es' }],
        failed: [{ file: 'c', error: 'Error' }],
        skipped: [{ file: 'd', reason: 'Unsupported' }, { file: 'e', reason: 'Unsupported' }],
      };

      const stats = batchService.getStatistics(result);

      expect(stats.total).toBe(5);
      expect(stats.successful).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.skipped).toBe(2);
    });

    it('should return zero statistics for empty result', () => {
      const result = {
        successful: [],
        failed: [],
        skipped: [],
      };

      const stats = batchService.getStatistics(result);

      expect(stats.total).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.skipped).toBe(0);
    });
  });

  describe('plain text batching via nock', () => {
    let batchServiceWithTranslation: BatchTranslationService;

    beforeEach(() => {
      const mockCache = createMockCacheService();
      const isolatedTranslationService = new TranslationService(client, mockConfig, mockCache);
      batchServiceWithTranslation = new BatchTranslationService(
        new FileTranslationService(isolatedTranslationService),
        { concurrency: 5, translationService: isolatedTranslationService }
      );
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('should send fewer HTTP calls for a directory of .txt files', async () => {
      // Create 5 .txt files
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), `Text number ${i}`);
      }

      // Expect a single batch POST (all 5 texts in one request)
      const scope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          // Verify all 5 texts are in a single request
          const texts = body['text'] as string[];
          return Array.isArray(texts) && texts.length === 5;
        })
        .reply(200, {
          translations: Array(5).fill(null).map((_, i) => ({
            text: `Texto número ${i}`,
            detected_source_language: 'EN',
          })),
        });

      const result = await batchServiceWithTranslation.translateDirectory(
        tmpDir,
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      expect(result.successful).toHaveLength(5);
      expect(result.failed).toHaveLength(0);
      // Verify only 1 HTTP call was made (not 5)
      expect(scope.isDone()).toBe(true);
    });

    it('should handle mixed .txt and .json directory correctly', async () => {
      // Create mixed files
      fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'Hello world');
      fs.writeFileSync(path.join(tmpDir, 'data.json'), '{"greeting": "Hello"}');
      fs.writeFileSync(path.join(tmpDir, 'notes.md'), '# Notes');

      // .txt and .md go through batch (1 API call for 2 texts)
      const batchScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate', (body: Record<string, unknown>) => {
          const texts = body['text'] as string[];
          return Array.isArray(texts) && texts.length === 2;
        })
        .reply(200, {
          translations: [
            { text: 'Hola mundo', detected_source_language: 'EN' },
            { text: '# Notas', detected_source_language: 'EN' },
          ],
        });

      // .json goes through per-file path (StructuredFileTranslationService
      // will extract strings and batch them, resulting in its own API call)
      const jsonScope = nock(DEEPL_FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Hola', detected_source_language: 'EN' },
          ],
        });

      const result = await batchServiceWithTranslation.translateDirectory(
        tmpDir,
        { targetLang: 'es' },
        { outputDir: tmpDir }
      );

      expect(result.successful).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(batchScope.isDone()).toBe(true);
      expect(jsonScope.isDone()).toBe(true);
    });
  });
});

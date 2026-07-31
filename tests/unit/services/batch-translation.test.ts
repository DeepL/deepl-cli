/**
 * Tests for Batch Translation Service
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BatchTranslationService } from '../../../src/services/batch-translation';
import { FileTranslationService } from '../../../src/services/file-translation';
import { TranslationService, MAX_TEXT_BYTES } from '../../../src/services/translation';
import pLimit from 'p-limit';
import fg from 'fast-glob';
import { createMockFileTranslationService, createMockTranslationService } from '../../helpers/mock-factories';

// Mock ESM modules
jest.mock('p-limit');
jest.mock('fast-glob');

// Mock FileTranslationService
jest.mock('../../../src/services/file-translation');

const mockPLimit = pLimit as jest.MockedFunction<typeof pLimit>;
const mockFastGlob = fg as jest.MockedFunction<typeof fg>;

describe('BatchTranslationService', () => {
  let batchTranslationService: BatchTranslationService;
  let mockFileTranslationService: jest.Mocked<FileTranslationService>;
  let testDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `deepl-batch-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Mock p-limit to execute tasks immediately
    (mockPLimit as any).mockImplementation((_concurrency: number) => {
      return (fn: () => Promise<any>) => fn();
    });

    mockFileTranslationService = createMockFileTranslationService({
      getSupportedFileTypes: jest.fn().mockReturnValue(['.txt', '.md']),
      isSupportedFile: jest.fn((filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        return ['.txt', '.md'].includes(ext);
      }),
    });

    batchTranslationService = new BatchTranslationService(
      mockFileTranslationService
    );
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create a BatchTranslationService instance', () => {
      expect(batchTranslationService).toBeInstanceOf(BatchTranslationService);
    });

    it('should accept custom concurrency limit', async () => {
      mockPLimit.mockClear();
      const service = new BatchTranslationService(
        mockFileTranslationService,
        { concurrency: 5 }
      );

      const file = path.join(testDir, 'concurrency-test.txt');
      fs.writeFileSync(file, 'test content');
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      await service.translateFiles(
        [file],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(mockPLimit).toHaveBeenCalledWith(5);
    });
  });

  describe('translateFiles()', () => {
    it('should translate multiple files in parallel', async () => {
      const files = [
        path.join(testDir, 'file1.txt'),
        path.join(testDir, 'file2.txt'),
        path.join(testDir, 'file3.txt'),
      ];

      // Create test files
      files.forEach((file, i) => {
        fs.writeFileSync(file, `Content ${i + 1}`);
      });

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const results = await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(results.successful).toHaveLength(3);
      expect(results.failed).toHaveLength(0);
      expect(mockFileTranslationService.translateFile).toHaveBeenCalledTimes(3);
    });

    it('should handle errors gracefully and continue processing', async () => {
      const files = [
        path.join(testDir, 'file1.txt'),
        path.join(testDir, 'file2.txt'),
        path.join(testDir, 'file3.txt'),
      ];

      files.forEach((file, i) => {
        fs.writeFileSync(file, `Content ${i + 1}`);
      });

      // Make second file fail
      mockFileTranslationService.translateFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Translation failed'))
        .mockResolvedValueOnce(undefined);

      const results = await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(results.successful).toHaveLength(2);
      expect(results.failed).toHaveLength(1);
      expect(results.failed[0]?.file).toBe(files[1]);
      expect(results.failed[0]?.error).toContain('Translation failed');
    });

    it('should filter out unsupported file types', async () => {
      const files = [
        path.join(testDir, 'file1.txt'),
        path.join(testDir, 'file2.pdf'),
        path.join(testDir, 'file3.md'),
      ];

      files.forEach((file, i) => {
        fs.writeFileSync(file, `Content ${i + 1}`);
      });

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const results = await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(results.successful).toHaveLength(2);
      expect(results.skipped).toHaveLength(1);
      expect(results.skipped[0]?.file).toBe(files[1]);
      expect(mockFileTranslationService.translateFile).toHaveBeenCalledTimes(2);
    });

    it('should generate output paths based on input files', async () => {
      const files = [path.join(testDir, 'input.txt')];
      fs.writeFileSync(files[0]!, 'Content');

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(mockFileTranslationService.translateFile).toHaveBeenCalledWith(
        files[0],
        path.join(testDir, 'input.es.txt'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should support custom output filename pattern', async () => {
      const files = [path.join(testDir, 'input.txt')];
      fs.writeFileSync(files[0]!, 'Content');

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        {
          outputDir: testDir,
          outputPattern: '{name}-translated-{lang}{ext}',
        }
      );

      expect(mockFileTranslationService.translateFile).toHaveBeenCalledWith(
        files[0],
        path.join(testDir, 'input-translated-es.txt'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should handle empty file list', async () => {
      const results = await batchTranslationService.translateFiles(
        [],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(results.successful).toHaveLength(0);
      expect(results.failed).toHaveLength(0);
      expect(results.skipped).toHaveLength(0);
    });

    it('should call progress callback during translation', async () => {
      const files = [
        path.join(testDir, 'file1.txt'),
        path.join(testDir, 'file2.txt'),
      ];

      files.forEach((file, i) => {
        fs.writeFileSync(file, `Content ${i + 1}`);
      });

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const progressCalls: any[] = [];
      const onProgress = jest.fn((progress) => {
        progressCalls.push({ ...progress });
      });

      await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir, onProgress }
      );

      expect(onProgress).toHaveBeenCalled();
      expect(progressCalls[progressCalls.length - 1]?.completed).toBe(2);
      expect(progressCalls[progressCalls.length - 1]?.total).toBe(2);
    });
  });

  describe('translateDirectory()', () => {
    it('should translate all supported files in a directory', async () => {
      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');

      fs.mkdirSync(inputDir);

      const files = ['file1.txt', 'file2.md', 'file3.txt'];
      const absoluteFiles = files.map(f => path.join(inputDir, f));
      files.forEach(file => {
        fs.writeFileSync(path.join(inputDir, file), 'Content');
      });

      mockFastGlob.mockResolvedValue(absoluteFiles);
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const results = await batchTranslationService.translateDirectory(
        inputDir,
        { targetLang: 'es' },
        { outputDir }
      );

      expect(results.successful).toHaveLength(3);
      expect(mockFileTranslationService.translateFile).toHaveBeenCalledTimes(3);
    });

    it('should handle subdirectories when recursive option is enabled', async () => {
      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');

      fs.mkdirSync(inputDir);
      fs.mkdirSync(path.join(inputDir, 'sub1'));
      fs.mkdirSync(path.join(inputDir, 'sub2'));

      const absoluteFiles = [
        path.join(inputDir, 'file1.txt'),
        path.join(inputDir, 'sub1', 'file2.txt'),
        path.join(inputDir, 'sub2', 'file3.txt'),
      ];
      absoluteFiles.forEach(file => fs.writeFileSync(file, 'Content'));

      mockFastGlob.mockResolvedValue(absoluteFiles);
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const results = await batchTranslationService.translateDirectory(
        inputDir,
        { targetLang: 'es' },
        { outputDir, recursive: true }
      );

      expect(results.successful).toHaveLength(3);
    });

    it('should not process subdirectories when recursive is false', async () => {
      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');

      fs.mkdirSync(inputDir);
      fs.mkdirSync(path.join(inputDir, 'sub'));

      fs.writeFileSync(path.join(inputDir, 'file1.txt'), 'Content');
      fs.writeFileSync(path.join(inputDir, 'sub', 'file2.txt'), 'Content');

      mockFastGlob.mockResolvedValue([path.join(inputDir, 'file1.txt')]);
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const results = await batchTranslationService.translateDirectory(
        inputDir,
        { targetLang: 'es' },
        { outputDir, recursive: false }
      );

      expect(results.successful).toHaveLength(1);
      expect(mockFileTranslationService.translateFile).toHaveBeenCalledTimes(1);
    });

    it('should throw error for non-existent directory', async () => {
      const inputDir = path.join(testDir, 'nonexistent');
      const outputDir = path.join(testDir, 'output');

      await expect(
        batchTranslationService.translateDirectory(
          inputDir,
          { targetLang: 'es' },
          { outputDir }
        )
      ).rejects.toThrow('not found');
    });

    it('should preserve directory structure in output', async () => {
      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');

      fs.mkdirSync(inputDir);
      fs.mkdirSync(path.join(inputDir, 'sub'));

      const absoluteFiles = [
        path.join(inputDir, 'file1.txt'),
        path.join(inputDir, 'sub', 'file2.txt'),
      ];
      absoluteFiles.forEach(file => fs.writeFileSync(file, 'Content'));

      mockFastGlob.mockResolvedValue(absoluteFiles);
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      await batchTranslationService.translateDirectory(
        inputDir,
        { targetLang: 'es' },
        { outputDir, recursive: true }
      );

      const calls = mockFileTranslationService.translateFile.mock.calls;
      expect(calls[0]?.[1]).toBe(path.join(outputDir, 'file1.es.txt'));
      expect(calls[1]?.[1]).toBe(path.join(outputDir, 'sub', 'file2.es.txt'));
    });

    it('should support glob patterns', async () => {
      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');

      fs.mkdirSync(inputDir);

      fs.writeFileSync(path.join(inputDir, 'file1.txt'), 'Content');
      fs.writeFileSync(path.join(inputDir, 'file2.md'), 'Content');
      fs.writeFileSync(path.join(inputDir, 'file3.txt'), 'Content');

      const txtFiles = [
        path.join(inputDir, 'file1.txt'),
        path.join(inputDir, 'file3.txt'),
      ];
      mockFastGlob.mockResolvedValue(txtFiles);
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const results = await batchTranslationService.translateDirectory(
        inputDir,
        { targetLang: 'es' },
        { outputDir, pattern: '*.txt' }
      );

      expect(results.successful).toHaveLength(2);
      expect(mockFileTranslationService.translateFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatistics()', () => {
    it('should return statistics from batch translation results', () => {
      const results = {
        successful: [{ file: 'file1.txt', outputPath: 'file1.es.txt' }],
        failed: [{ file: 'file2.txt', error: 'Error' }],
        skipped: [{ file: 'file3.pdf', reason: 'Unsupported' }],
      };

      const stats = batchTranslationService.getStatistics(results);

      expect(stats.total).toBe(3);
      expect(stats.successful).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.skipped).toBe(1);
    });
  });

  describe('plain text batching', () => {
    let mockTranslationService: jest.Mocked<TranslationService>;
    let batchServiceWithTranslation: BatchTranslationService;

    beforeEach(() => {
      mockTranslationService = createMockTranslationService();
      batchServiceWithTranslation = new BatchTranslationService(
        mockFileTranslationService,
        { concurrency: 5, translationService: mockTranslationService }
      );
    });

    it('should batch multiple .txt files into one translateBatch() call', async () => {
      const files = [
        path.join(testDir, 'a.txt'),
        path.join(testDir, 'b.txt'),
        path.join(testDir, 'c.txt'),
      ];
      files.forEach((f, i) => fs.writeFileSync(f, `Text ${i + 1}`));

      mockTranslationService.translateBatch.mockResolvedValue([
        { text: 'Texto 1' },
        { text: 'Texto 2' },
        { text: 'Texto 3' },
      ]);

      const result = await batchServiceWithTranslation.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(mockTranslationService.translateBatch).toHaveBeenCalledTimes(1);
      expect(mockFileTranslationService.translateFile).not.toHaveBeenCalled();

      // Verify output files were written
      for (const entry of result.successful) {
        expect(fs.existsSync(entry.outputPath)).toBe(true);
      }
    });

    it('should batch .md files alongside .txt files', async () => {
      const files = [
        path.join(testDir, 'readme.md'),
        path.join(testDir, 'notes.txt'),
      ];
      fs.writeFileSync(files[0]!, '# Hello');
      fs.writeFileSync(files[1]!, 'World');

      mockTranslationService.translateBatch.mockResolvedValue([
        { text: '# Hola' },
        { text: 'Mundo' },
      ]);

      const result = await batchServiceWithTranslation.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(2);
      expect(mockTranslationService.translateBatch).toHaveBeenCalledTimes(1);
    });

    it('should split batches at TRANSLATE_BATCH_SIZE (50) texts', async () => {
      const files: string[] = [];
      for (let i = 0; i < 52; i++) {
        const f = path.join(testDir, `file${i}.txt`);
        fs.writeFileSync(f, `Text ${i}`);
        files.push(f);
      }

      mockTranslationService.translateBatch.mockImplementation(async (texts) =>
        texts.map(t => ({ text: `translated: ${t}` }))
      );

      const result = await batchServiceWithTranslation.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(52);
      expect(mockTranslationService.translateBatch).toHaveBeenCalledTimes(2);

      // First batch should have 50, second should have 2
      const firstCallTexts = mockTranslationService.translateBatch.mock.calls[0]![0];
      const secondCallTexts = mockTranslationService.translateBatch.mock.calls[1]![0];
      expect(firstCallTexts).toHaveLength(50);
      expect(secondCallTexts).toHaveLength(2);
    });

    it('should split batches when cumulative bytes exceed MAX_TEXT_BYTES', async () => {
      // Create two files that together exceed MAX_TEXT_BYTES
      const halfSize = Math.floor(MAX_TEXT_BYTES / 2) + 100;
      const file1 = path.join(testDir, 'big1.txt');
      const file2 = path.join(testDir, 'big2.txt');
      fs.writeFileSync(file1, 'a'.repeat(halfSize));
      fs.writeFileSync(file2, 'b'.repeat(halfSize));

      mockTranslationService.translateBatch.mockImplementation(async (texts) =>
        texts.map(() => ({ text: 'translated' }))
      );

      const result = await batchServiceWithTranslation.translateFiles(
        [file1, file2],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(2);
      // Each file goes into its own batch because they exceed MAX_TEXT_BYTES together
      expect(mockTranslationService.translateBatch).toHaveBeenCalledTimes(2);
    });

    it('should split batches by form-encoded size so CJK batches stay within the API body limit', async () => {
      // 10,000 CJK chars: 30,000 raw UTF-8 bytes but 90,000 bytes once
      // percent-encoded. Raw sum (60,000) fits MAX_TEXT_BYTES; encoded
      // sum (180,000) does not, so the files must land in separate batches.
      const cjkText = '你'.repeat(10_000);
      const file1 = path.join(testDir, 'cjk1.txt');
      const file2 = path.join(testDir, 'cjk2.txt');
      fs.writeFileSync(file1, cjkText);
      fs.writeFileSync(file2, cjkText);

      mockTranslationService.translateBatch.mockImplementation(async (texts) =>
        texts.map(() => ({ text: 'translated' }))
      );

      const result = await batchServiceWithTranslation.translateFiles(
        [file1, file2],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(2);
      expect(mockTranslationService.translateBatch).toHaveBeenCalledTimes(2);
    });

    it('should apply and restore code/variable preservation', async () => {
      const file = path.join(testDir, 'code.txt');
      fs.writeFileSync(file, 'Use `console.log()` with {name}');

      mockTranslationService.translateBatch.mockImplementation(async (texts) => {
        // Verify placeholders were applied before reaching translateBatch
        expect(texts[0]).toContain('__CODE_');
        expect(texts[0]).toContain('__VAR_');
        expect(texts[0]).not.toContain('`console.log()`');
        expect(texts[0]).not.toContain('{name}');
        return texts.map(t => ({ text: t.replace('Use', 'Usa') }));
      });

      const result = await batchServiceWithTranslation.translateFiles(
        [file],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(1);
      const outputContent = fs.readFileSync(result.successful[0]!.outputPath, 'utf-8');
      // Restored placeholders
      expect(outputContent).toContain('`console.log()`');
      expect(outputContent).toContain('{name}');
    });

    it('should handle per-file read errors gracefully', async () => {
      const goodFile = path.join(testDir, 'good.txt');
      const badFile = path.join(testDir, 'sub', 'missing.txt'); // non-existent
      fs.writeFileSync(goodFile, 'Hello');

      mockTranslationService.translateBatch.mockResolvedValue([
        { text: 'Hola' },
      ]);

      const result = await batchServiceWithTranslation.translateFiles(
        [goodFile, badFile],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.file).toBe(badFile);
    });

    it('should handle empty files by marking them as failed', async () => {
      const emptyFile = path.join(testDir, 'empty.txt');
      fs.writeFileSync(emptyFile, '');

      const result = await batchServiceWithTranslation.translateFiles(
        [emptyFile],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.error).toContain('empty');
    });

    it('should handle batch API failure by marking all files in batch as failed', async () => {
      const files = [
        path.join(testDir, 'x.txt'),
        path.join(testDir, 'y.txt'),
      ];
      files.forEach(f => fs.writeFileSync(f, 'content'));

      mockTranslationService.translateBatch.mockRejectedValue(new Error('API 503'));

      const result = await batchServiceWithTranslation.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(2);
      expect(result.failed[0]!.error).toContain('API 503');
      expect(result.failed[1]!.error).toContain('API 503');
    });

    it('should report progress per file after batch completes', async () => {
      const files = [
        path.join(testDir, 'p1.txt'),
        path.join(testDir, 'p2.txt'),
      ];
      files.forEach(f => fs.writeFileSync(f, 'hello'));

      mockTranslationService.translateBatch.mockResolvedValue([
        { text: 'hola' },
        { text: 'hola' },
      ]);

      const progressCalls: Array<{ completed: number; total: number }> = [];
      const result = await batchServiceWithTranslation.translateFiles(
        files,
        { targetLang: 'es' },
        {
          outputDir: testDir,
          onProgress: (p) => progressCalls.push({ completed: p.completed, total: p.total }),
        }
      );

      expect(result.successful).toHaveLength(2);
      // Progress should be reported per file, not per batch
      expect(progressCalls).toHaveLength(2);
      expect(progressCalls[progressCalls.length - 1]!.completed).toBe(2);
    });

    it('should fall back to per-file path when translationService not provided', async () => {
      // batchTranslationService (from outer beforeEach) has no translationService
      const file = path.join(testDir, 'fallback.txt');
      fs.writeFileSync(file, 'Hello');

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const result = await batchTranslationService.translateFiles(
        [file],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(1);
      expect(mockFileTranslationService.translateFile).toHaveBeenCalledTimes(1);
    });

    it('should route structured files (.json) through per-file path', async () => {
      mockFileTranslationService.isSupportedFile.mockImplementation((filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        return ['.txt', '.md', '.json', '.yaml', '.yml'].includes(ext);
      });

      const txtFile = path.join(testDir, 'plain.txt');
      const jsonFile = path.join(testDir, 'data.json');
      fs.writeFileSync(txtFile, 'Hello');
      fs.writeFileSync(jsonFile, '{"key": "value"}');

      mockTranslationService.translateBatch.mockResolvedValue([
        { text: 'Hola' },
      ]);
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const result = await batchServiceWithTranslation.translateFiles(
        [txtFile, jsonFile],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(2);
      // .txt batched via translateBatch, .json via translateFile
      expect(mockTranslationService.translateBatch).toHaveBeenCalledTimes(1);
      expect(mockFileTranslationService.translateFile).toHaveBeenCalledTimes(1);
    });

    it('should defend against result count mismatch', async () => {
      const files = [
        path.join(testDir, 'm1.txt'),
        path.join(testDir, 'm2.txt'),
      ];
      files.forEach(f => fs.writeFileSync(f, 'content'));

      // Return wrong number of results
      mockTranslationService.translateBatch.mockResolvedValue([
        { text: 'only one' },
      ]);

      const result = await batchServiceWithTranslation.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(2);
      expect(result.failed[0]!.error).toContain('mismatch');
    });

    it('should read files per batch instead of loading the whole set up-front', async () => {
      const files: string[] = [];
      for (let i = 0; i < 52; i++) {
        const f = path.join(testDir, `stream${i}.txt`);
        fs.writeFileSync(f, `Text ${i}`);
        files.push(f);
      }
      const lastFile = files[51]!;

      mockTranslationService.translateBatch.mockImplementation(async (texts) => {
        // Removing a later file while the first batch translates proves it
        // has not been read yet when this call happens.
        if (fs.existsSync(lastFile)) {
          fs.rmSync(lastFile);
        }
        return texts.map((t) => ({ text: `translated: ${t}` }));
      });

      const result = await batchServiceWithTranslation.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(51);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.file).toBe(lastFile);
      expect(mockTranslationService.translateBatch).toHaveBeenCalledTimes(2);
    });

    it('should reject files exceeding MAX_TEXT_BYTES', async () => {
      const bigFile = path.join(testDir, 'huge.txt');
      fs.writeFileSync(bigFile, 'x'.repeat(MAX_TEXT_BYTES + 1));

      const result = await batchServiceWithTranslation.translateFiles(
        [bigFile],
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.error).toContain('too large');
      expect(mockTranslationService.translateBatch).not.toHaveBeenCalled();
    });
  });

  describe('output path traversal guard', () => {
    it('should fail files whose baseDir-relative path escapes the output directory (per-file path)', async () => {
      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');
      fs.mkdirSync(inputDir);
      const outsideFile = path.join(testDir, 'outside.txt');
      fs.writeFileSync(outsideFile, 'Content');

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const result = await batchTranslationService.translateFiles(
        [outsideFile],
        { targetLang: 'es' },
        { outputDir, baseDir: inputDir }
      );

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.error).toMatch(/escapes output directory/);
      expect(mockFileTranslationService.translateFile).not.toHaveBeenCalled();
    });

    it('should fail escaping files in the plain-text batched path without calling translateBatch', async () => {
      const mockTranslationService = createMockTranslationService();
      const service = new BatchTranslationService(mockFileTranslationService, {
        translationService: mockTranslationService,
      });

      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');
      fs.mkdirSync(inputDir);
      const outsideFile = path.join(testDir, 'outside.txt');
      fs.writeFileSync(outsideFile, 'Content');

      const result = await service.translateFiles(
        [outsideFile],
        { targetLang: 'es' },
        { outputDir, baseDir: inputDir }
      );

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.error).toMatch(/escapes output directory/);
      expect(mockTranslationService.translateBatch).not.toHaveBeenCalled();
    });

    it('should still translate files nested under baseDir', async () => {
      const inputDir = path.join(testDir, 'input');
      const outputDir = path.join(testDir, 'output');
      const subDir = path.join(inputDir, 'sub');
      fs.mkdirSync(subDir, { recursive: true });
      const file = path.join(subDir, 'nested.txt');
      fs.writeFileSync(file, 'Content');

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const result = await batchTranslationService.translateFiles(
        [file],
        { targetLang: 'es' },
        { outputDir, baseDir: inputDir }
      );

      expect(result.failed).toHaveLength(0);
      expect(result.successful).toHaveLength(1);
      expect(result.successful[0]!.outputPath).toBe(
        path.join(outputDir, 'sub', 'nested.es.txt')
      );
    });
  });

  describe('translateDirectory symlink safety', () => {
    it('calls fast-glob with followSymbolicLinks:false (symlink-exfil defense)', async () => {
      const inputDir = path.join(testDir, 'input');
      fs.mkdirSync(inputDir);
      mockFastGlob.mockResolvedValue([]);

      await batchTranslationService.translateDirectory(
        inputDir,
        { targetLang: 'es' },
        { outputDir: testDir }
      );

      expect(mockFastGlob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ followSymbolicLinks: false })
      );
    });
  });

  describe('abort signal', () => {
    it('should skip remaining files when abort signal is triggered', async () => {
      const files = [
        path.join(testDir, 'file1.txt'),
        path.join(testDir, 'file2.txt'),
        path.join(testDir, 'file3.txt'),
      ];

      files.forEach((file, i) => {
        fs.writeFileSync(file, `Content ${i + 1}`);
      });

      const controller = new AbortController();

      // Abort after first file starts
      mockFileTranslationService.translateFile.mockImplementation(async () => {
        controller.abort();
      });

      const result = await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir, abortSignal: controller.signal }
      );

      // First file succeeds (abort happens during its translation),
      // remaining files should be skipped
      expect(result.successful.length + result.skipped.length + result.failed.length).toBe(files.length);
      expect(result.skipped.some(s => s.reason === 'Aborted')).toBe(true);
    });

    it('should not skip files when abort signal is not triggered', async () => {
      const files = [
        path.join(testDir, 'file1.txt'),
        path.join(testDir, 'file2.txt'),
      ];

      files.forEach((file, i) => {
        fs.writeFileSync(file, `Content ${i + 1}`);
      });

      const controller = new AbortController();
      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const result = await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir, abortSignal: controller.signal }
      );

      expect(result.successful).toHaveLength(2);
      expect(result.skipped.filter(s => s.reason === 'Aborted')).toHaveLength(0);
    });

    it('should respect pre-aborted signal', async () => {
      const files = [
        path.join(testDir, 'file1.txt'),
      ];

      files.forEach((file, i) => {
        fs.writeFileSync(file, `Content ${i + 1}`);
      });

      const controller = new AbortController();
      controller.abort(); // Pre-abort

      mockFileTranslationService.translateFile.mockResolvedValue(undefined);

      const result = await batchTranslationService.translateFiles(
        files,
        { targetLang: 'es' },
        { outputDir: testDir, abortSignal: controller.signal }
      );

      // File should be skipped since signal was pre-aborted
      expect(result.skipped.some(s => s.reason === 'Aborted')).toBe(true);
      expect(mockFileTranslationService.translateFile).not.toHaveBeenCalled();
    });
  });
});

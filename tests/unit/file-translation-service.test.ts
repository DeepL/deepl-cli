/**
 * Tests for File Translation Service
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileTranslationService } from '../../src/services/file-translation';
import { TranslationService } from '../../src/services/translation';
import { createMockTranslationService } from '../helpers/mock-factories';

// Mock TranslationService
jest.mock('../../src/services/translation');

describe('FileTranslationService', () => {
  let fileTranslationService: FileTranslationService;
  let mockTranslationService: jest.Mocked<TranslationService>;
  let testDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `deepl-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    mockTranslationService = createMockTranslationService();

    fileTranslationService = new FileTranslationService(mockTranslationService);
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create a FileTranslationService instance', () => {
      expect(fileTranslationService).toBeInstanceOf(FileTranslationService);
    });
  });

  describe('translateFile()', () => {
    it('should translate a text file', async () => {
      const inputPath = path.join(testDir, 'input.txt');
      const outputPath = path.join(testDir, 'output.txt');

      fs.writeFileSync(inputPath, 'Hello world');

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola mundo',
        detectedSourceLang: 'en',
      });

      await fileTranslationService.translateFile(inputPath, outputPath, {
        targetLang: 'es',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({ targetLang: 'es' }),
        expect.any(Object)
      );

      const output = fs.readFileSync(outputPath, 'utf-8');
      expect(output).toBe('Hola mundo');
    });

    it('should translate a markdown file', async () => {
      const inputPath = path.join(testDir, 'input.md');
      const outputPath = path.join(testDir, 'output.md');

      const markdown = '# Hello\n\nThis is a test.';
      fs.writeFileSync(inputPath, markdown);

      mockTranslationService.translate.mockResolvedValue({
        text: '# Hola\n\nEsta es una prueba.',
        detectedSourceLang: 'en',
      });

      await fileTranslationService.translateFile(inputPath, outputPath, {
        targetLang: 'es',
      });

      const output = fs.readFileSync(outputPath, 'utf-8');
      expect(output).toBe('# Hola\n\nEsta es una prueba.');
    });

    it('should preserve code blocks in markdown', async () => {
      const inputPath = path.join(testDir, 'input.md');
      const outputPath = path.join(testDir, 'output.md');

      const markdown = '# Example\n\n```js\nconst x = 1;\n```\n\nSome text.';
      fs.writeFileSync(inputPath, markdown);

      mockTranslationService.translate.mockResolvedValue({
        text: '# Ejemplo\n\n```js\nconst x = 1;\n```\n\nAlgún texto.',
        detectedSourceLang: 'en',
      });

      await fileTranslationService.translateFile(inputPath, outputPath, {
        targetLang: 'es',
      }, { preserveCode: true });

      const output = fs.readFileSync(outputPath, 'utf-8');
      expect(output).toContain('```js\nconst x = 1;\n```');
    });

    it('should throw error for non-existent file', async () => {
      const inputPath = path.join(testDir, 'nonexistent.txt');
      const outputPath = path.join(testDir, 'output.txt');

      await expect(
        fileTranslationService.translateFile(inputPath, outputPath, {
          targetLang: 'es',
        })
      ).rejects.toThrow();
    });

    it('should throw error for unsupported file type', async () => {
      const inputPath = path.join(testDir, 'file.pdf');
      const outputPath = path.join(testDir, 'output.pdf');

      fs.writeFileSync(inputPath, 'dummy content');

      await expect(
        fileTranslationService.translateFile(inputPath, outputPath, {
          targetLang: 'es',
        })
      ).rejects.toThrow('Unsupported file type');
    });

    it('should create output directory if it does not exist', async () => {
      const inputPath = path.join(testDir, 'input.txt');
      const outputPath = path.join(testDir, 'nested', 'dir', 'output.txt');

      fs.writeFileSync(inputPath, 'Hello');

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: 'en',
      });

      await fileTranslationService.translateFile(inputPath, outputPath, {
        targetLang: 'es',
      });

      expect(fs.existsSync(outputPath)).toBe(true);
    });

    it('should handle empty files', async () => {
      const inputPath = path.join(testDir, 'empty.txt');
      const outputPath = path.join(testDir, 'output.txt');

      fs.writeFileSync(inputPath, '');

      await expect(
        fileTranslationService.translateFile(inputPath, outputPath, {
          targetLang: 'es',
        })
      ).rejects.toThrow('Cannot translate empty file');
    });

    it('should handle very large files', async () => {
      const inputPath = path.join(testDir, 'large.txt');
      const outputPath = path.join(testDir, 'output.txt');

      // Create large content (1MB+)
      const largeContent = 'Hello world. '.repeat(100000);
      fs.writeFileSync(inputPath, largeContent);

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola mundo. '.repeat(100000),
        detectedSourceLang: 'en',
      });

      await fileTranslationService.translateFile(inputPath, outputPath, {
        targetLang: 'es',
      });

      expect(fs.existsSync(outputPath)).toBe(true);
    });

    it('should reject symlinks for security reasons', async () => {
      const realFile = path.join(testDir, 'real.txt');
      const symlinkFile = path.join(testDir, 'link.txt');

      fs.writeFileSync(realFile, 'Hello world');
      fs.symlinkSync(realFile, symlinkFile);

      const outputPath = path.join(testDir, 'output.txt');

      await expect(
        fileTranslationService.translateFile(symlinkFile, outputPath, {
          targetLang: 'es',
        })
      ).rejects.toThrow();

      expect(mockTranslationService.translate).not.toHaveBeenCalled();
    });
  });

  describe('translateFileToMultiple()', () => {
    it('should translate file to multiple languages', async () => {
      const inputPath = path.join(testDir, 'input.txt');

      fs.writeFileSync(inputPath, 'Hello world');

      mockTranslationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'es', text: 'Hola mundo' },
        { targetLang: 'fr', text: 'Bonjour le monde' },
      ]);

      const results = await fileTranslationService.translateFileToMultiple(
        inputPath,
        ['es', 'fr']
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.targetLang).toBe('es');
      expect(results[1]?.targetLang).toBe('fr');
    });

    it('should create output files with language suffix', async () => {
      const inputPath = path.join(testDir, 'input.txt');
      const outputDir = testDir;

      fs.writeFileSync(inputPath, 'Hello');

      mockTranslationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      await fileTranslationService.translateFileToMultiple(
        inputPath,
        ['es', 'fr'],
        { outputDir }
      );

      expect(fs.existsSync(path.join(outputDir, 'input.es.txt'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'input.fr.txt'))).toBe(true);
    });

    it('should handle translation errors gracefully', async () => {
      const inputPath = path.join(testDir, 'input.txt');

      fs.writeFileSync(inputPath, 'Hello');

      mockTranslationService.translateToMultiple.mockRejectedValue(
        new Error('API error')
      );

      await expect(
        fileTranslationService.translateFileToMultiple(inputPath, ['es'])
      ).rejects.toThrow('API error');
    });

    it('should reject symlinks for security reasons', async () => {
      const realFile = path.join(testDir, 'real.txt');
      const symlinkFile = path.join(testDir, 'link.txt');

      fs.writeFileSync(realFile, 'Hello world');
      fs.symlinkSync(realFile, symlinkFile);

      await expect(
        fileTranslationService.translateFileToMultiple(symlinkFile, ['es'])
      ).rejects.toThrow();

      expect(mockTranslationService.translateToMultiple).not.toHaveBeenCalled();
    });
  });

  describe('getSupportedFileTypes()', () => {
    it('should return list of supported file extensions', () => {
      const types = fileTranslationService.getSupportedFileTypes();

      expect(types).toContain('.txt');
      expect(types).toContain('.md');
      expect(types.length).toBeGreaterThan(0);
    });
  });

  describe('isSupportedFile()', () => {
    it('should return true for supported file types', () => {
      expect(fileTranslationService.isSupportedFile('test.txt')).toBe(true);
      expect(fileTranslationService.isSupportedFile('README.md')).toBe(true);
    });

    it('should return false for unsupported file types', () => {
      expect(fileTranslationService.isSupportedFile('test.pdf')).toBe(false);
      expect(fileTranslationService.isSupportedFile('image.png')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(fileTranslationService.isSupportedFile('TEST.TXT')).toBe(true);
      expect(fileTranslationService.isSupportedFile('README.MD')).toBe(true);
    });
  });

  describe('translateFile() with --output -', () => {
    let stdoutWriteSpy: jest.SpyInstance;

    beforeEach(() => {
      stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stdoutWriteSpy.mockRestore();
    });

    it('should write to stdout when outputPath is -', async () => {
      const inputPath = path.join(testDir, 'input.txt');
      fs.writeFileSync(inputPath, 'Hello world');

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola mundo',
        detectedSourceLang: 'en',
      });

      await fileTranslationService.translateFile(inputPath, '-', {
        targetLang: 'es',
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith('Hola mundo');
    });

    it('should not create output directory when outputPath is -', async () => {
      const inputPath = path.join(testDir, 'input.txt');
      fs.writeFileSync(inputPath, 'Hello');

      const mkdirSpy = jest.spyOn(fs.promises, 'mkdir');
      const writeFileSpy = jest.spyOn(fs.promises, 'writeFile');

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: 'en',
      });

      await fileTranslationService.translateFile(inputPath, '-', {
        targetLang: 'es',
      });

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(writeFileSpy).not.toHaveBeenCalled();

      mkdirSpy.mockRestore();
      writeFileSpy.mockRestore();
    });
  });
});

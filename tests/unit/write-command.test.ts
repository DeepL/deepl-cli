/**
 * Tests for WriteCommand
 */

import { WriteCommand } from '../../src/cli/commands/write.js';
import { WriteService } from '../../src/services/write.js';
import { WriteImprovement } from '../../src/types/index.js';
import { promises as fs, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMockWriteService } from '../helpers/mock-factories';

// Mock chalk to avoid ESM issues in tests
jest.mock('chalk', () => {
  const mockChalk = {
    green: (text: string) => text,
    red: (text: string) => text,
    cyan: (text: string) => text,
    bold: (text: string) => text,
    yellow: (text: string) => text,
  };
  return {
    __esModule: true,
    default: mockChalk,
  };
});

// Mock Logger
jest.mock('../../src/utils/logger', () => ({
  Logger: {
    verbose: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    output: jest.fn(),
  },
}));

import { Logger } from '../../src/utils/logger';
const mockLogger = Logger as jest.Mocked<typeof Logger>;

// Mock @inquirer/prompts
jest.mock('@inquirer/prompts', () => {
  const selectFn = jest.fn();
  return {
    __esModule: true,
    select: selectFn,
  };
});

import { select } from '@inquirer/prompts';
const mockSelect = select as jest.MockedFunction<typeof select>;

describe('WriteCommand', () => {
  let writeCommand: WriteCommand;
  let mockWriteService: jest.Mocked<WriteService>;
  let testDir: string;

  beforeEach(async () => {
    mockWriteService = createMockWriteService();

    writeCommand = new WriteCommand(mockWriteService);

    // Create temporary directory for file tests with more entropy to avoid collisions
    testDir = join(tmpdir(), `deepl-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test directory - wait a bit to avoid race conditions
    if (testDir) {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('initialization', () => {
    it('should create a WriteCommand instance', () => {
      expect(writeCommand).toBeInstanceOf(WriteCommand);
    });
  });

  describe('improve()', () => {
    describe('basic functionality', () => {
      it('should improve text successfully', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'This is a well-written sentence.',
            targetLanguage: 'en-US',
          },
        ];

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovements[0]!);

        const result = await writeCommand.improve('This is a sentence.', {
          lang: 'en-US',
        });

        expect(result).toBe('This is a well-written sentence.');
        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'This is a sentence.',
          { targetLang: 'en-US' },
          { skipCache: undefined }
        );
      });

      it('should propagate service error for empty text', async () => {
        mockWriteService.getBestImprovement.mockRejectedValueOnce(
          new Error('Text cannot be empty')
        );

        await expect(
          writeCommand.improve('', { lang: 'en-US' })
        ).rejects.toThrow('Text cannot be empty');
      });

      it('should allow omitting language for auto-detection', async () => {
        const mockImprovement: WriteImprovement = {
          text: 'Improved text.',
          targetLanguage: 'en-US',
          detectedSourceLanguage: 'en',
        };
        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('Test', {});

        expect(result).toBe('Improved text.');
      });
    });

    describe('writing style parameter', () => {
      it('should apply simple writing style', async () => {
        const mockImprovement: WriteImprovement = {
          text: 'This is easy to read.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('This is a sentence.', {
          lang: 'en-US',
          style: 'simple',
        });

        expect(result).toBe('This is easy to read.');
        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'This is a sentence.',
          { targetLang: 'en-US', writingStyle: 'simple' },
          { skipCache: undefined }
        );
      });

      it('should apply business writing style', async () => {
        const mockImprovement: WriteImprovement = {
          text: 'We are pleased to inform you.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('We want to tell you.', {
          lang: 'en-US',
          style: 'business',
        });

        expect(result).toBe('We are pleased to inform you.');
        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'We want to tell you.',
          { targetLang: 'en-US', writingStyle: 'business' },
          { skipCache: undefined }
        );
      });

      it('should apply academic writing style', async () => {
        const mockImprovement: WriteImprovement = {
          text: 'This study demonstrates effectiveness.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('This shows it works.', {
          lang: 'en-US',
          style: 'academic',
        });

        expect(result).toContain('demonstrates');
        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'This shows it works.',
          { targetLang: 'en-US', writingStyle: 'academic' },
          { skipCache: undefined }
        );
      });

      it('should apply casual writing style', async () => {
        const mockImprovement: WriteImprovement = {
          text: "Hey, that's pretty cool!",
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('That is interesting.', {
          lang: 'en-US',
          style: 'casual',
        });

        expect(result).toContain('cool');
        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'That is interesting.',
          { targetLang: 'en-US', writingStyle: 'casual' },
          { skipCache: undefined }
        );
      });
    });

    describe('tone parameter', () => {
      it('should apply enthusiastic tone', async () => {
        const mockImprovement: WriteImprovement = {
          text: 'This is absolutely fantastic!',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('This is good.', {
          lang: 'en-US',
          tone: 'enthusiastic',
        });

        expect(result).toContain('fantastic');
        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'This is good.',
          { targetLang: 'en-US', tone: 'enthusiastic' },
          { skipCache: undefined }
        );
      });

      it('should apply friendly tone', async () => {
        const mockImprovement: WriteImprovement = {
          text: "Hi there! Hope you're doing well.",
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('Hello.', {
          lang: 'en-US',
          tone: 'friendly',
        });

        expect(result).toContain('Hi');
      });

      it('should apply confident tone', async () => {
        const mockImprovement: WriteImprovement = {
          text: 'I am certain this will succeed.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('I think this will work.', {
          lang: 'en-US',
          tone: 'confident',
        });

        expect(result).toContain('certain');
      });

      it('should apply diplomatic tone', async () => {
        const mockImprovement: WriteImprovement = {
          text: 'Perhaps we could consider an alternative approach.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improve('Try something else.', {
          lang: 'en-US',
          tone: 'diplomatic',
        });

        expect(result).toContain('Perhaps');
      });
    });

    describe('alternatives option', () => {
      it('should return all alternatives when showAlternatives is true', async () => {
        const mockImprovements: WriteImprovement[] = [
          { text: 'First improvement.', targetLanguage: 'en-US' },
          { text: 'Second improvement.', targetLanguage: 'en-US' },
          { text: 'Third improvement.', targetLanguage: 'en-US' },
        ];

        mockWriteService.improve.mockResolvedValue(mockImprovements);

        const result = await writeCommand.improve('Test', {
          lang: 'en-US',
          showAlternatives: true,
        });

        expect(result).toContain('First improvement.');
        expect(result).toContain('Second improvement.');
        expect(result).toContain('Third improvement.');
        expect(mockWriteService.improve).toHaveBeenCalledWith(
          'Test',
          { targetLang: 'en-US' },
          { skipCache: undefined }
        );
      });

      it('should format alternatives with numbering', async () => {
        const mockImprovements: WriteImprovement[] = [
          { text: 'Option one.', targetLanguage: 'en-US' },
          { text: 'Option two.', targetLanguage: 'en-US' },
        ];

        mockWriteService.improve.mockResolvedValue(mockImprovements);

        const result = await writeCommand.improve('Test', {
          lang: 'en-US',
          showAlternatives: true,
        });

        expect(result).toMatch(/1\./);
        expect(result).toMatch(/2\./);
      });
    });

    describe('parameter constraints', () => {
      it('should propagate service error when both style and tone are specified', async () => {
        mockWriteService.getBestImprovement.mockRejectedValueOnce(
          new Error('Cannot specify both --style and --tone in a single request')
        );

        await expect(
          writeCommand.improve('Test', {
            lang: 'en-US',
            style: 'business',
            tone: 'enthusiastic',
          })
        ).rejects.toThrow('Cannot specify both --style and --tone');
      });
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        mockWriteService.getBestImprovement.mockRejectedValue(
          new Error('Service error')
        );

        await expect(
          writeCommand.improve('Test', { lang: 'en-US' })
        ).rejects.toThrow('Service error');
      });

      it('should handle authentication errors', async () => {
        mockWriteService.getBestImprovement.mockRejectedValue(
          new Error('Authentication failed: Invalid API key')
        );

        await expect(
          writeCommand.improve('Test', { lang: 'en-US' })
        ).rejects.toThrow('Authentication failed');
      });

      it('should handle quota exceeded errors', async () => {
        mockWriteService.getBestImprovement.mockRejectedValue(
          new Error('Quota exceeded: Character limit reached')
        );

        await expect(
          writeCommand.improve('Test', { lang: 'en-US' })
        ).rejects.toThrow('Quota exceeded');
      });
    });

    describe('supported languages', () => {
      it('should work with all supported Write languages', async () => {
        const languages: Array<'de' | 'en' | 'en-GB' | 'en-US' | 'es' | 'fr' | 'it' | 'pt' | 'pt-BR' | 'pt-PT'> = [
          'de',
          'en',
          'en-GB',
          'en-US',
          'es',
          'fr',
          'it',
          'pt',
          'pt-BR',
          'pt-PT',
        ];

        for (const lang of languages) {
          const mockImprovement: WriteImprovement = {
            text: 'Improved text.',
            targetLanguage: lang,
          };

          mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

          const result = await writeCommand.improve('Test', { lang });

          expect(result).toBe('Improved text.');
        }
      });
    });
  });

  describe('improveFile()', () => {
    describe('basic file operations', () => {
      it('should read and improve text from a file', async () => {
        // Ensure directory exists before writing file
        await fs.mkdir(testDir, { recursive: true });
        const testFile = join(testDir, 'test.txt');
        await fs.writeFile(testFile, 'Original content', 'utf-8');

        const mockImprovement: WriteImprovement = {
          text: 'This is improved content.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improveFile(testFile, {
          lang: 'en-US',
        });

        expect(result).toBe('This is improved content.');
        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'Original content',
          { targetLang: 'en-US' },
          { skipCache: undefined }
        );
      });

      it('should throw error for non-existent file', async () => {
        await expect(
          writeCommand.improveFile(join(testDir, 'nonexistent.txt'), { lang: 'en-US' })
        ).rejects.toThrow('File not found');
      });

      it('should throw error for empty file path', async () => {
        await expect(
          writeCommand.improveFile('', { lang: 'en-US' })
        ).rejects.toThrow('File path cannot be empty');
      });
    });

    describe('output to file', () => {
      it('should write improved text to output file', async () => {
        const inputFile = join(testDir, 'input.txt');
        const outputFile = join(testDir, 'output.txt');
        await fs.writeFile(inputFile, 'Original text', 'utf-8');

        const mockImprovement: WriteImprovement = {
          text: 'This is improved content.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        await writeCommand.improveFile(inputFile, {
          lang: 'en-US',
          outputFile,
        });

        const outputContent = await fs.readFile(outputFile, 'utf-8');
        expect(outputContent).toBe('This is improved content.');
      });

      it('should support in-place editing when no output file specified', async () => {
        const testFile = join(testDir, 'test.txt');
        await fs.writeFile(testFile, 'Original content', 'utf-8');

        const mockImprovement: WriteImprovement = {
          text: 'Improved content.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        const result = await writeCommand.improveFile(testFile, {
          lang: 'en-US',
          inPlace: true,
        });

        expect(result).toBe('Improved content.');
        const fileContent = await fs.readFile(testFile, 'utf-8');
        expect(fileContent).toBe('Improved content.');
      });
    });

    describe('file format handling', () => {
      it('should handle .txt files', async () => {
        const testFile = join(testDir, 'test.txt');
        await fs.writeFile(testFile, 'Plain text content', 'utf-8');

        const mockImprovement: WriteImprovement = {
          text: 'Improved text.',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        await writeCommand.improveFile(testFile, { lang: 'en-US' });

        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          'Plain text content',
          { targetLang: 'en-US' },
          { skipCache: undefined }
        );
      });

      it('should handle .md files', async () => {
        const testFile = join(testDir, 'test.md');
        await fs.writeFile(testFile, '# Original Heading', 'utf-8');

        const mockImprovement: WriteImprovement = {
          text: '# Improved Heading',
          targetLanguage: 'en-US',
        };

        mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

        await writeCommand.improveFile(testFile, { lang: 'en-US' });

        expect(mockWriteService.getBestImprovement).toHaveBeenCalledWith(
          '# Original Heading',
          { targetLang: 'en-US' },
          { skipCache: undefined }
        );
      });
    });
  });

  describe('generateDiff()', () => {
    it('should generate a diff between original and improved text', () => {
      const original = 'This is the original text.';
      const improved = 'This is the improved text.';

      const diff = writeCommand.generateDiff(original, improved);

      expect(diff).toContain('original');
      expect(diff).toContain('improved');
      expect(diff).toContain('-');
      expect(diff).toContain('+');
    });

    it('should show no changes when texts are identical', () => {
      const text = 'Same text.';

      const diff = writeCommand.generateDiff(text, text);

      expect(diff).toContain('===');
    });

    it('should handle multi-line text', () => {
      const original = 'Line 1\nLine 2\nLine 3';
      const improved = 'Line 1\nModified Line 2\nLine 3';

      const diff = writeCommand.generateDiff(original, improved);

      expect(diff).toContain('Line 1');
      expect(diff).toContain('Line 3');
    });

    it('should handle empty strings', () => {
      const diff = writeCommand.generateDiff('', 'New content');

      expect(diff).toContain('+');
      expect(diff).toContain('New content');
    });
  });

  describe('improveWithDiff()', () => {
    it('should return improved text with diff view', async () => {
      const original = 'Original text.';
      const mockImprovement: WriteImprovement = {
        text: 'Improved text.',
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.improveWithDiff(original, {
        lang: 'en-US',
      });

      expect(result.original).toBe(original);
      expect(result.improved).toBe('Improved text.');
      expect(result.diff).toContain('-');
      expect(result.diff).toContain('+');
    });

    it('should work with file input', async () => {
      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'Original content', 'utf-8');

      const mockImprovement: WriteImprovement = {
        text: 'Improved content.',
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.improveFileWithDiff(testFile, {
        lang: 'en-US',
      });

      expect(result.original).toBe('Original content');
      expect(result.improved).toBe('Improved content.');
      expect(result.diff).toContain('Original content');
    });
  });

  describe('checkText()', () => {
    it('should return true if text needs improvement', async () => {
      const mockImprovement: WriteImprovement = {
        text: 'Improved text.',
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.checkText('Original text.', {
        lang: 'en-US',
      });

      expect(result.needsImprovement).toBe(true);
      expect(result.original).toBe('Original text.');
      expect(result.improved).toBe('Improved text.');
      expect(result.changes).toBeGreaterThan(0);
    });

    it('should return false if text does not need improvement', async () => {
      const text = 'Perfect text.';
      const mockImprovement: WriteImprovement = {
        text,
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.checkText(text, {
        lang: 'en-US',
      });

      expect(result.needsImprovement).toBe(false);
      expect(result.original).toBe(text);
      expect(result.improved).toBe(text);
      expect(result.changes).toBe(0);
    });

    it('should count number of changes', async () => {
      const mockImprovement: WriteImprovement = {
        text: 'Line 1 improved\nLine 2\nLine 3 improved',
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.checkText(
        'Line 1 original\nLine 2\nLine 3 original',
        { lang: 'en-US' }
      );

      expect(result.needsImprovement).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });
  });

  describe('checkFile()', () => {
    it('should check if file needs improvement', async () => {
      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'Original content', 'utf-8');

      const mockImprovement: WriteImprovement = {
        text: 'Improved content.',
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.checkFile(testFile, {
        lang: 'en-US',
      });

      expect(result.needsImprovement).toBe(true);
      expect(result.filePath).toBe(testFile);
      expect(result.changes).toBeGreaterThan(0);
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        writeCommand.checkFile(join(testDir, 'nonexistent.txt'), {
          lang: 'en-US',
        })
      ).rejects.toThrow('File not found');
    });

    it('should return false if file does not need improvement', async () => {
      const testFile = join(testDir, 'perfect.txt');
      const content = 'Perfect content.';
      await fs.writeFile(testFile, content, 'utf-8');

      const mockImprovement: WriteImprovement = {
        text: content,
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.checkFile(testFile, {
        lang: 'en-US',
      });

      expect(result.needsImprovement).toBe(false);
      expect(result.changes).toBe(0);
    });
  });

  describe('autoFixFile()', () => {
    it('should automatically fix file in-place', async () => {
      await fs.mkdir(testDir, { recursive: true });
      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'Original content', 'utf-8');

      const mockImprovement: WriteImprovement = {
        text: 'Improved content.',
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.autoFixFile(testFile, {
        lang: 'en-US',
      });

      expect(result.fixed).toBe(true);
      expect(result.filePath).toBe(testFile);
      expect(result.changes).toBeGreaterThan(0);

      // Verify file was updated
      const fileContent = await fs.readFile(testFile, 'utf-8');
      expect(fileContent).toBe('Improved content.');
    });

    it('should not modify file if no improvements needed', async () => {
      await fs.mkdir(testDir, { recursive: true });
      const testFile = join(testDir, 'perfect.txt');
      const content = 'Perfect content.';
      await fs.writeFile(testFile, content, 'utf-8');

      const mockImprovement: WriteImprovement = {
        text: content,
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.autoFixFile(testFile, {
        lang: 'en-US',
      });

      expect(result.fixed).toBe(false);
      expect(result.changes).toBe(0);

      // Verify file was not changed
      const fileContent = await fs.readFile(testFile, 'utf-8');
      expect(fileContent).toBe(content);
    });

    it('should create backup when requested', async () => {
      await fs.mkdir(testDir, { recursive: true });
      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'Original content', 'utf-8');

      const mockImprovement: WriteImprovement = {
        text: 'Improved content.',
        targetLanguage: 'en-US',
      };

      mockWriteService.getBestImprovement.mockResolvedValue(mockImprovement);

      const result = await writeCommand.autoFixFile(testFile, {
        lang: 'en-US',
        createBackup: true,
      });

      expect(result.fixed).toBe(true);
      expect(result.backupPath).toMatch(/\.bak/);

      // Verify backup exists
      const backupContent = await fs.readFile(result.backupPath!, 'utf-8');
      expect(backupContent).toBe('Original content');
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        writeCommand.autoFixFile(join(testDir, 'nonexistent.txt'), {
          lang: 'en-US',
        })
      ).rejects.toThrow('File not found');
    });
  });

  describe('improveInteractive()', () => {
    beforeEach(() => {
      mockSelect.mockClear();
      // Mock console.log to avoid chalk issues in tests
      jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should generate alternatives with different styles', async () => {
      // Mock different responses for different styles
      mockWriteService.improve
        .mockResolvedValueOnce([{ text: 'Simple improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Business improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Academic improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Casual improvement.', targetLanguage: 'en-US' }]);

      mockSelect.mockResolvedValue(1);

      const result = await writeCommand.improveInteractive('Original text.', {
        lang: 'en-US',
      });

      // Should call API 4 times (once for each style)
      expect(mockWriteService.improve).toHaveBeenCalledTimes(4);
      expect(result).toBe('Business improvement.');
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should allow user to keep original text', async () => {
      mockWriteService.improve
        .mockResolvedValueOnce([{ text: 'Simple.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Business.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Academic.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Casual.', targetLanguage: 'en-US' }]);

      mockSelect.mockResolvedValue(-1); // -1 = keep original

      const result = await writeCommand.improveInteractive('Original text.', {
        lang: 'en-US',
      });

      expect(result).toBe('Original text.');
    });

    it('should use single style when specified by user', async () => {
      const mockImprovements: WriteImprovement[] = [
        { text: 'Business improvement.', targetLanguage: 'en-US' },
      ];

      mockWriteService.improve.mockResolvedValue(mockImprovements);
      mockSelect.mockResolvedValue(0);

      const result = await writeCommand.improveInteractive('Original text.', {
        lang: 'en-US',
        style: 'business',
      });

      // Should only call API once when style is specified
      expect(mockWriteService.improve).toHaveBeenCalledTimes(1);
      expect(result).toBe('Business improvement.');
    });

    it('should remove duplicate improvements', async () => {
      // Mock where some styles return the same text
      mockWriteService.improve
        .mockResolvedValueOnce([{ text: 'Same improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Same improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Different improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Same improvement.', targetLanguage: 'en-US' }]);

      mockSelect.mockResolvedValue(0);

      const result = await writeCommand.improveInteractive('Original.', {
        lang: 'en-US',
      });

      // Should work and return a result
      expect(['Same improvement.', 'Different improvement.']).toContain(result);
      expect(mockSelect).toHaveBeenCalled();

      // Verify deduplication happened - select() receives a config object with choices
      const selectConfig = mockSelect.mock.calls[0]![0] as any;
      expect(selectConfig.choices.length).toBe(3); // Keep original + 2 unique
    });

    it('should handle file input in interactive mode', async () => {
      await fs.mkdir(testDir, { recursive: true });
      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'Original content', 'utf-8');

      // improveFileInteractive calls improve once, then improveInteractive calls it 4 more times
      // First call: for building alternatives array
      mockWriteService.improve
        .mockResolvedValueOnce([{ text: 'Initial.', targetLanguage: 'en-US' }])
        // Next 4 calls: from improveInteractive for different styles
        .mockResolvedValueOnce([{ text: 'Simple.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Business.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Academic.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Casual.', targetLanguage: 'en-US' }]);

      // Selection 1 corresponds to Business (second in the list)
      mockSelect.mockResolvedValue(1);

      const result = await writeCommand.improveFileInteractive(testFile, {
        lang: 'en-US',
      });

      expect(result.selected).toBe('Business.');
      expect(result.alternatives).toEqual(['Initial.']);
    });

    it('should handle API errors gracefully', async () => {
      // Mock where some styles fail but others succeed
      mockWriteService.improve
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce([{ text: 'Business improvement.', targetLanguage: 'en-US' }])
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce([{ text: 'Casual improvement.', targetLanguage: 'en-US' }]);

      mockSelect.mockResolvedValue(0);

      const result = await writeCommand.improveInteractive('Original.', {
        lang: 'en-US',
      });

      // Should still work with partial results
      expect(result).toBe('Business improvement.');
    });

    it('should log verbose diagnostics when a write style fails', async () => {
      mockWriteService.improve
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce([{ text: 'Business improvement.', targetLanguage: 'en-US' }])
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce([{ text: 'Casual improvement.', targetLanguage: 'en-US' }]);

      mockSelect.mockResolvedValue(0);

      await writeCommand.improveInteractive('Original.', {
        lang: 'en-US',
      });

      expect(mockLogger.verbose).toHaveBeenCalledWith(
        'Write style simple failed:',
        'Rate limit exceeded'
      );
      expect(mockLogger.verbose).toHaveBeenCalledWith(
        'Write style academic failed:',
        'Server error'
      );
      expect(mockLogger.verbose).toHaveBeenCalledTimes(2);
    });

    it('should log verbose diagnostics with stringified non-Error objects', async () => {
      mockWriteService.improve
        .mockRejectedValueOnce('string error')
        .mockResolvedValueOnce([{ text: 'Business improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Academic improvement.', targetLanguage: 'en-US' }])
        .mockResolvedValueOnce([{ text: 'Casual improvement.', targetLanguage: 'en-US' }]);

      mockSelect.mockResolvedValue(0);

      await writeCommand.improveInteractive('Original.', {
        lang: 'en-US',
      });

      expect(mockLogger.verbose).toHaveBeenCalledWith(
        'Write style simple failed:',
        'string error'
      );
      expect(mockLogger.verbose).toHaveBeenCalledTimes(1);
    });

    it('should throw when all style variants fail', async () => {
      mockWriteService.improve
        .mockRejectedValueOnce(new Error('API error'))
        .mockRejectedValueOnce(new Error('API error'))
        .mockRejectedValueOnce(new Error('API error'))
        .mockRejectedValueOnce(new Error('API error'));

      await expect(
        writeCommand.improveInteractive('Original text.', { lang: 'en-US' })
      ).rejects.toThrow('No improvements could be generated');
    });

    it('should use single style path when tone is specified', async () => {
      const mockImprovements: WriteImprovement[] = [
        { text: 'Enthusiastic improvement!', targetLanguage: 'en-US' },
      ];

      mockWriteService.improve.mockResolvedValue(mockImprovements);
      mockSelect.mockResolvedValue(0);

      const result = await writeCommand.improveInteractive('Original text.', {
        lang: 'en-US',
        tone: 'enthusiastic',
      });

      expect(mockWriteService.improve).toHaveBeenCalledTimes(1);
      expect(mockWriteService.improve).toHaveBeenCalledWith(
        'Original text.',
        { targetLang: 'en-US', tone: 'enthusiastic' },
        { skipCache: undefined }
      );
      expect(result).toBe('Enthusiastic improvement!');
    });

    it('should return original text when user selects keep original with tone specified', async () => {
      const mockImprovements: WriteImprovement[] = [
        { text: 'Improved.', targetLanguage: 'en-US' },
      ];

      mockWriteService.improve.mockResolvedValue(mockImprovements);
      mockSelect.mockResolvedValue(-1);

      const result = await writeCommand.improveInteractive('Original text.', {
        lang: 'en-US',
        tone: 'friendly',
      });

      expect(result).toBe('Original text.');
    });
  });

  describe('symlink security', () => {
    let symlinkTarget: string;
    let symlinkPath: string;

    beforeEach(async () => {
      await fs.mkdir(testDir, { recursive: true });
      symlinkTarget = join(testDir, 'real-file.txt');
      symlinkPath = join(testDir, 'symlink.txt');
      writeFileSync(symlinkTarget, 'secret content', 'utf-8');
      symlinkSync(symlinkTarget, symlinkPath);
    });

    it('should reject symlinks in improveFile()', async () => {
      await expect(
        writeCommand.improveFile(symlinkPath, { lang: 'en-US' })
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should reject symlinks in improveFileWithDiff()', async () => {
      await expect(
        writeCommand.improveFileWithDiff(symlinkPath, { lang: 'en-US' })
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should reject symlinks in checkFile()', async () => {
      await expect(
        writeCommand.checkFile(symlinkPath, { lang: 'en-US' })
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should reject symlinks in autoFixFile()', async () => {
      await expect(
        writeCommand.autoFixFile(symlinkPath, { lang: 'en-US' })
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should reject symlinks in improveFileInteractive()', async () => {
      await expect(
        writeCommand.improveFileInteractive(symlinkPath, { lang: 'en-US' })
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });
  });

  describe('correct mode', () => {
    const mockCorrection: WriteImprovement = {
      text: 'This is a test.',
      targetLanguage: 'en-US',
    };

    it('should dispatch improve() to getBestCorrection when correct is set', async () => {
      mockWriteService.getBestCorrection.mockResolvedValue(mockCorrection);

      const result = await writeCommand.improve('This is an test.', {
        lang: 'en-US',
        correct: true,
      });

      expect(result).toBe('This is a test.');
      expect(mockWriteService.getBestCorrection).toHaveBeenCalledWith(
        'This is an test.',
        { targetLang: 'en-US' },
        { skipCache: undefined }
      );
      expect(mockWriteService.getBestImprovement).not.toHaveBeenCalled();
    });

    it('should dispatch alternatives to correct()', async () => {
      mockWriteService.correct.mockResolvedValue([
        mockCorrection,
        { text: 'This is one test.', targetLanguage: 'en-US' },
      ]);

      const result = await writeCommand.improve('This is an test.', {
        correct: true,
        showAlternatives: true,
      });

      expect(result).toContain('1. This is a test.');
      expect(result).toContain('2. This is one test.');
      expect(mockWriteService.correct).toHaveBeenCalledWith(
        'This is an test.',
        {},
        { skipCache: undefined }
      );
      expect(mockWriteService.improve).not.toHaveBeenCalled();
    });

    it('should pass skipCache through in correct mode', async () => {
      mockWriteService.getBestCorrection.mockResolvedValue(mockCorrection);

      await writeCommand.improve('Test', { correct: true, noCache: true });

      expect(mockWriteService.getBestCorrection).toHaveBeenCalledWith(
        'Test',
        {},
        { skipCache: true }
      );
    });

    it('should count changes via checkText in correct mode', async () => {
      mockWriteService.getBestCorrection.mockResolvedValue(mockCorrection);

      const result = await writeCommand.checkText('This is an test.', {
        lang: 'en-US',
        correct: true,
      });

      expect(result.needsImprovement).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
      expect(mockWriteService.getBestCorrection).toHaveBeenCalled();
    });

    it('should not use the correct endpoint when correct is not set', async () => {
      mockWriteService.getBestImprovement.mockResolvedValue(mockCorrection);

      await writeCommand.improve('Test', { lang: 'en-US' });

      expect(mockWriteService.getBestCorrection).not.toHaveBeenCalled();
      expect(mockWriteService.correct).not.toHaveBeenCalled();
    });
  });
});

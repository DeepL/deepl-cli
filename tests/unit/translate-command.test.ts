/**
 * Tests for Translate Command
 */

 

import { TranslateCommand } from '../../src/cli/commands/translate';
import { TranslationService } from '../../src/services/translation';
import { DocumentTranslationService } from '../../src/services/document-translation';
import { GlossaryService } from '../../src/services/glossary';
import { ConfigService } from '../../src/storage/config';
import { Logger } from '../../src/utils/logger';
import { safeReadFileSync } from '../../src/utils/safe-read-file';
import {
  createMockTranslationService,
  createMockDocumentTranslationService,
  createMockGlossaryService,
  createMockConfigService,
} from '../helpers/mock-factories';
import { buildTranslationOptions, getFileSize } from '../../src/cli/commands/translate/translate-utils';
import { atomicWriteFileSync } from '../../src/utils/atomic-write';

// Mock ESM dependencies
jest.mock('ora', () => {
  const mockSpinner = {
    start: jest.fn(function(this: any) { return this; }),
    succeed: jest.fn(function(this: any) { return this; }),
    fail: jest.fn(function(this: any) { return this; }),
    text: '',
  };
  return jest.fn(() => mockSpinner);
});

jest.mock('p-limit');
jest.mock('fast-glob');

// Mock dependencies
jest.mock('../../src/services/translation');
jest.mock('../../src/services/file-translation');
jest.mock('../../src/services/batch-translation');
jest.mock('../../src/services/document-translation');
jest.mock('../../src/services/glossary');
jest.mock('../../src/storage/config');
jest.mock('../../src/utils/safe-read-file');
jest.mock('../../src/utils/atomic-write', () => ({
  atomicWriteFile: jest.fn().mockResolvedValue(undefined),
  atomicWriteFileSync: jest.fn(),
}));

describe('TranslateCommand', () => {
  let mockTranslationService: jest.Mocked<TranslationService>;
  let mockDocumentTranslationService: jest.Mocked<DocumentTranslationService>;
  let mockGlossaryService: jest.Mocked<GlossaryService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let translateCommand: TranslateCommand;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTranslationService = createMockTranslationService();

    mockDocumentTranslationService = createMockDocumentTranslationService();

    mockGlossaryService = createMockGlossaryService();

    mockConfigService = createMockConfigService({
      getValue: jest.fn((key: string) => {
        if (key === 'auth.apiKey') {return 'mock-api-key';}
        return undefined;
      }),
    });

    translateCommand = new TranslateCommand(
      mockTranslationService,
      mockDocumentTranslationService,
      mockGlossaryService,
      mockConfigService
    );
  });

  describe('translateText()', () => {
    it('should translate simple text', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
        detectedSourceLang: 'en',
      });

      const result = await translateCommand.translateText('Hello world', {
        to: 'es',
      });

      expect(result).toBe('Hola mundo');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        { targetLang: 'es' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should pass source language when specified', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Bonjour',
      });

      await translateCommand.translateText('Hello', {
        to: 'fr',
        from: 'en',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        { targetLang: 'fr', sourceLang: 'en' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should pass formality when specified', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Buenos días',
      });

      await translateCommand.translateText('Good morning', {
        to: 'es',
        formality: 'more',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Good morning',
        { targetLang: 'es', formality: 'more' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should enable code preservation when requested', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Usa `console.log()` para imprimir',
      });

      await translateCommand.translateText('Use `console.log()` to print', {
        to: 'es',
        preserveCode: true,
      });

      // Check that translate was called with preserveCode option
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Use `console.log()` to print',
        { targetLang: 'es' },
        { preserveCode: true, skipCache: true }
      );
    });

    it('should propagate service error for empty text', async () => {
      (mockTranslationService.translate as jest.Mock).mockRejectedValueOnce(
        new Error('Text cannot be empty')
      );

      await expect(
        translateCommand.translateText('', { to: 'es' })
      ).rejects.toThrow('Text cannot be empty');
    });

    it('should throw error when API key is not set', async () => {
      // Override mock to return no API key for this specific test
      (mockConfigService.getValue as jest.Mock).mockImplementation(() => undefined);
      const originalEnv = process.env['DEEPL_API_KEY'];
      delete process.env['DEEPL_API_KEY'];

      await expect(
        translateCommand.translateText('Hello', { to: 'es' })
      ).rejects.toThrow('API key not set');

      // Restore environment
      if (originalEnv) {process.env['DEEPL_API_KEY'] = originalEnv;}
    });

    it('should support multiple target languages', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
        { targetLang: 'de', text: 'Hallo' },
      ]);

      const result = await translateCommand.translateText('Hello', {
        to: 'es,fr,de',
      });

      expect(result).toContain('Hola');
      expect(result).toContain('Bonjour');
      expect(result).toContain('Hallo');
    });
  });

  describe('translateFromStdin()', () => {
    let mockStdin: any;

    beforeEach(() => {
      // Mock process.stdin
      mockStdin = {
        setEncoding: jest.fn(),
        on: jest.fn(),
      };
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });
    });

    it('should read from stdin and translate', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola desde stdin',
      });

      // Mock stdin data
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback('Hello from stdin');
        } else if (event === 'end') {
          callback();
        }
        return mockStdin;
      });

      const result = await translateCommand.translateFromStdin({
        to: 'es',
      });

      expect(result).toBe('Hola desde stdin');
    });

    it('should handle multi-line stdin input', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Línea 1\nLínea 2\nLínea 3',
      });

      // Mock multi-line stdin data
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback('Line 1\nLine 2\nLine 3');
        } else if (event === 'end') {
          callback();
        }
        return mockStdin;
      });

      const result = await translateCommand.translateFromStdin({
        to: 'es',
      });

      expect(result).toContain('\n');
    });

    it('should throw error for empty stdin', async () => {
      // Mock empty stdin
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'end') {
          callback();
        }
        return mockStdin;
      });

      await expect(
        translateCommand.translateFromStdin({ to: 'es' })
      ).rejects.toThrow('No input provided');
    });

    it('should throw error for whitespace-only stdin', async () => {
      // Mock whitespace-only stdin
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback('   \n  \t  ');
        } else if (event === 'end') {
          callback();
        }
        return mockStdin;
      });

      await expect(
        translateCommand.translateFromStdin({ to: 'es' })
      ).rejects.toThrow('No input provided');
    });

    it('should handle stdin errors', async () => {
      // Mock stdin error
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'error') {
          callback(new Error('Stdin read error'));
        }
        return mockStdin;
      });

      await expect(
        translateCommand.translateFromStdin({ to: 'es' })
      ).rejects.toThrow('Stdin read error');
    });

    it('should handle large stdin input', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Large translated text',
      });

      // Mock large stdin data (simulate chunks) - call all 'data' handlers, then 'end'
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          // Immediately call the callback with all chunks
          callback('First chunk ');
          callback('second chunk ');
          callback('third chunk');
        } else if (event === 'end') {
          // Then call end
          callback();
        }
        return mockStdin;
      });

      const result = await translateCommand.translateFromStdin({
        to: 'es',
      });

      expect(result).toBe('Large translated text');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'First chunk second chunk third chunk',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should reject stdin input exceeding 128KB size limit', async () => {
      const maxSize = 131072; // 128KB
      // Create a chunk that exceeds the limit
      const oversizedChunk = 'x'.repeat(maxSize + 1);

      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback(oversizedChunk);
        } else if (event === 'end') {
          callback();
        }
        return mockStdin;
      });

      await expect(
        translateCommand.translateFromStdin({ to: 'es' })
      ).rejects.toThrow('Input exceeds maximum size of 128KB');
    });

    it('should reject stdin input exceeding 128KB across multiple chunks', async () => {
      const chunkSize = 70000; // two chunks of 70KB = 140KB > 128KB

      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback('x'.repeat(chunkSize));
          callback('x'.repeat(chunkSize));
        } else if (event === 'end') {
          callback();
        }
        return mockStdin;
      });

      await expect(
        translateCommand.translateFromStdin({ to: 'es' })
      ).rejects.toThrow('Input exceeds maximum size of 128KB');
    });

    it('should accept stdin input at exactly 128KB', async () => {
      const maxSize = 131072; // exactly 128KB
      const exactData = 'x'.repeat(maxSize);

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'translated',
      });

      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback(exactData);
        } else if (event === 'end') {
          callback();
        }
        return mockStdin;
      });

      const result = await translateCommand.translateFromStdin({ to: 'es' });
      expect(result).toBe('translated');
    });
  });

  describe('empty string input', () => {
    it('should throw error when text is an explicit empty string', async () => {
      await expect(
        translateCommand.translateText('', { to: 'es' })
      ).rejects.toThrow('Text cannot be empty');
    });

    it('should throw error when text is whitespace only', async () => {
      await expect(
        translateCommand.translateText('   ', { to: 'es' })
      ).rejects.toThrow('Text cannot be empty');
    });
  });

  describe('output formatting', () => {
    it('should output plain text by default', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      const result = await translateCommand.translateText('Hello', {
        to: 'es',
      });

      expect(result).toBe('Hola');
    });

    it('should support JSON output format', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
        detectedSourceLang: 'en',
      });

      const result = await translateCommand.translateText('Hello', {
        to: 'es',
        format: 'json',
      });

      const parsed = JSON.parse(result);
      expect(parsed.text).toBe('Hola');
      expect(parsed.targetLang).toBe('es');
    });

    it('should display source language when detected', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
        detectedSourceLang: 'en',
      });

      const result = await translateCommand.translateText('Hello', {
        to: 'es',
      });

      expect(result).toBe('Hola');
    });
  });

  describe('error handling', () => {
    it('should show user-friendly error for authentication failure', async () => {
      (mockTranslationService.translate as jest.Mock).mockRejectedValueOnce(
        new Error('Authentication failed: Invalid API key')
      );

      await expect(
        translateCommand.translateText('Hello', { to: 'es' })
      ).rejects.toThrow('Authentication failed');
    });

    it('should show user-friendly error for quota exceeded', async () => {
      (mockTranslationService.translate as jest.Mock).mockRejectedValueOnce(
        new Error('Quota exceeded: Character limit reached')
      );

      await expect(
        translateCommand.translateText('Hello', { to: 'es' })
      ).rejects.toThrow('Quota exceeded');
    });

    it('should show user-friendly error for network issues', async () => {
      (mockTranslationService.translate as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(
        translateCommand.translateText('Hello', { to: 'es' })
      ).rejects.toThrow('Network error');
    });
  });

  describe('context-aware translation', () => {
    it('should pass context to translation service', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        context: 'This is a greeting in a formal business email',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          targetLang: 'es',
          context: 'This is a greeting in a formal business email',
        }),
        expect.any(Object)
      );
    });

    it('should work without context parameter', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.not.objectContaining({
          context: expect.anything(),
        }),
        expect.any(Object)
      );
    });

    it('should pass context for multiple target languages', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,fr',
        context: 'Greeting in a casual conversation',
      });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['es', 'fr'],
        expect.objectContaining({
          context: 'Greeting in a casual conversation',
        })
      );
    });

    it('should handle long context strings', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'El banco está cerrado',
      });

      const longContext = 'This document is about financial services. The previous paragraph discussed banking hours and the next paragraph will cover online banking options.';

      await translateCommand.translateText('The bank is closed', {
        to: 'es',
        context: longContext,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'The bank is closed',
        expect.objectContaining({
          targetLang: 'es',
          context: longContext,
        }),
        expect.any(Object)
      );
    });

    it('should work with context and other options', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Cómo está usted',
      });

      await translateCommand.translateText('How are you', {
        to: 'es',
        from: 'en',
        formality: 'more',
        context: 'Formal business correspondence',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'How are you',
        expect.objectContaining({
          targetLang: 'es',
          sourceLang: 'en',
          formality: 'more',
          context: 'Formal business correspondence',
        }),
        expect.any(Object)
      );
    });
  });

  describe('model type selection', () => {
    it('should pass modelType to translation service when specified', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        modelType: 'latency_optimized',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          targetLang: 'es',
          modelType: 'latency_optimized',
        }),
        expect.any(Object)
      );
    });

    it('should work without modelType parameter', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.not.objectContaining({
          modelType: expect.anything(),
        }),
        expect.any(Object)
      );
    });

    it('should support quality_optimized model type', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        modelType: 'quality_optimized',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          modelType: 'quality_optimized',
        }),
        expect.any(Object)
      );
    });

    it('should support prefer_quality_optimized model type', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        modelType: 'prefer_quality_optimized',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          modelType: 'prefer_quality_optimized',
        }),
        expect.any(Object)
      );
    });
  });

  describe('advanced translation options', () => {
    it('should pass splitSentences option when specified', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Primera oración. Segunda oración.',
      });

      await translateCommand.translateText('First sentence. Second sentence.', {
        to: 'es',
        splitSentences: 'nonewlines',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'First sentence. Second sentence.',
        expect.objectContaining({
          targetLang: 'es',
          splitSentences: 'nonewlines',
        }),
        expect.any(Object)
      );
    });

    it('should pass tagHandling option when specified', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: '<p>Hola mundo</p>',
      });

      await translateCommand.translateText('<p>Hello world</p>', {
        to: 'es',
        tagHandling: 'html',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello world</p>',
        expect.objectContaining({
          targetLang: 'es',
          tagHandling: 'html',
        }),
        expect.any(Object)
      );
    });

    it('should pass formality to translateToMultiple', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'de', text: 'Hallo' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,de',
        formality: 'more',
      });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['es', 'de'],
        expect.objectContaining({
          formality: 'more',
        })
      );
    });

    it('should pass sourceLang to translateToMultiple', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,fr',
        from: 'en',
      });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['es', 'fr'],
        expect.objectContaining({
          sourceLang: 'en',
        })
      );
    });

    it('should work with all options combined', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: '<p>Hola. ¿Cómo estás?</p>',
      });

      await translateCommand.translateText('<p>Hello. How are you?</p>', {
        to: 'es',
        from: 'en',
        formality: 'more',
        context: 'Formal email greeting',
        splitSentences: 'on',
        tagHandling: 'html',
        modelType: 'quality_optimized',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello. How are you?</p>',
        expect.objectContaining({
          targetLang: 'es',
          sourceLang: 'en',
          formality: 'more',
          context: 'Formal email greeting',
          splitSentences: 'on',
          tagHandling: 'html',
          modelType: 'quality_optimized',
        }),
        expect.any(Object)
      );
    });
  });

  describe('custom instructions', () => {
    it('should pass custom instructions to translation service', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      await translateCommand.translateText('Hello world', {
        to: 'es',
        customInstruction: ['Use informal tone', 'Preserve brand names'],
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({
          targetLang: 'es',
          customInstructions: ['Use informal tone', 'Preserve brand names'],
        }),
        expect.any(Object)
      );
    });

    it('should work without custom instructions', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.not.objectContaining({
          customInstructions: expect.anything(),
        }),
        expect.any(Object)
      );
    });

    it('should reject more than 10 custom instructions', async () => {
      const instructions = Array.from({ length: 11 }, (_, i) => `Instruction ${i + 1}`);

      await expect(
        translateCommand.translateText('Hello', {
          to: 'es',
          customInstruction: instructions,
        })
      ).rejects.toThrow('Maximum 10 custom instructions allowed');
    });

    it('should reject instructions exceeding 300 characters', async () => {
      const longInstruction = 'x'.repeat(301);

      await expect(
        translateCommand.translateText('Hello', {
          to: 'es',
          customInstruction: [longInstruction],
        })
      ).rejects.toThrow('Custom instruction exceeds 300 character limit');
    });

    it('should reject custom instructions with latency_optimized model', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'es',
          customInstruction: ['Use informal tone'],
          modelType: 'latency_optimized',
        })
      ).rejects.toThrow('Custom instructions cannot be used with latency_optimized model type');
    });

    it('should pass custom instructions to translateToMultiple', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,fr',
        customInstruction: ['Keep it casual'],
      });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['es', 'fr'],
        expect.objectContaining({
          customInstructions: ['Keep it casual'],
        })
      );
    });

    it('should allow exactly 10 custom instructions', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      const instructions = Array.from({ length: 10 }, (_, i) => `Instruction ${i + 1}`);

      await translateCommand.translateText('Hello', {
        to: 'es',
        customInstruction: instructions,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          customInstructions: instructions,
        }),
        expect.any(Object)
      );
    });

    it('should allow instructions with exactly 300 characters', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola',
      });

      const instruction = 'x'.repeat(300);

      await translateCommand.translateText('Hello', {
        to: 'es',
        customInstruction: [instruction],
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          customInstructions: [instruction],
        }),
        expect.any(Object)
      );
    });
  });

  describe('translate() - file/directory detection', () => {
    it('should detect and route to translateDirectory() for directory paths', async () => {
      // Mock fs to indicate a directory; routing must consult lstatSync so symlinks are not followed.
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => false, isDirectory: () => true } as any);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as any);

      // Create a spy on translateDirectory
      const spy = jest.spyOn((translateCommand as any).directoryHandler, 'translateDirectory')
        .mockResolvedValue('Directory translation result');

      const result = await translateCommand.translate('/path/to/dir', {
        to: 'es',
        output: '/out',
      });

      expect(result).toBe('Directory translation result');
      expect(spy).toHaveBeenCalledWith('/path/to/dir', { to: 'es', output: '/out' });

      spy.mockRestore();
    });

    it('should detect and route to translateFile() for file paths', async () => {
      // Mock fs to indicate a file; routing must consult lstatSync so symlinks are not followed.
      const fs = jest.requireActual('fs');
      const mockStats = { isDirectory: () => false, isFile: () => true };
      jest.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => false, isFile: () => true } as any);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue(mockStats as any);

      // Create a spy on translateFile
      const spy = jest.spyOn((translateCommand as any).fileHandler, 'translateFile')
        .mockResolvedValue('File translation result');

      const result = await translateCommand.translate('/path/to/file.txt', {
        to: 'es',
        output: '/out.txt',
      });

      expect(result).toBe('File translation result');
      expect(spy).toHaveBeenCalledWith('/path/to/file.txt', { to: 'es', output: '/out.txt' }, mockStats);

      spy.mockRestore();
    });

    it('should route to translateText() for plain text input', async () => {
      // Mock fs to indicate path doesn't exist
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      const result = await translateCommand.translate('Hello world', { to: 'es' });

      expect(result).toBe('Hola mundo');
      expect(mockTranslationService.translate).toHaveBeenCalled();
    });
  });

  describe('translateFile()', () => {
    it('should throw error if output is not specified', async () => {
      await expect(
        (translateCommand as any).fileHandler.translateFile('/path/to/file.txt', { to: 'es' })
      ).rejects.toThrow('Output file path is required');
    });

    it('should translate single file to single language', async () => {
      // Mock fs to make file appear to exist and be a regular file
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({
        size: 1024, // 1KB
        isDirectory: () => false
      } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es',
        output: '/output.txt',
      });

      expect(result).toContain('Translated /input.txt');
      expect(result).toContain('/output.txt');
      expect(mockTranslationService.translate).toHaveBeenCalled();
    });

    it('should translate file to multiple languages', async () => {
      // Mock fs to make file appear to exist
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({
        size: 1024, // 1KB
        isDirectory: () => false
      } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');

      const mockFileService = {
        translateFileToMultiple: jest.fn().mockResolvedValue([
          { targetLang: 'es', outputPath: '/output.es.txt' },
          { targetLang: 'fr', outputPath: '/output.fr.txt' },
          { targetLang: 'de', outputPath: '/output.de.txt' },
        ]),
      };
      (translateCommand as any).ctx.fileTranslationService = mockFileService;

      const result = await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es,fr,de',
        output: '/output',
      });

      expect(result).toContain('Translated /input.txt to 3 languages');
      expect(result).toContain('[es]');
      expect(result).toContain('[fr]');
      expect(result).toContain('[de]');
      expect(mockFileService.translateFileToMultiple).toHaveBeenCalled();
    });

    it('should pass source language when specified', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      (safeReadFileSync as jest.Mock).mockReturnValue('Hello world');

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es',
        from: 'en',
        output: '/output.txt',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({ sourceLang: 'en', targetLang: 'es' }),
        expect.any(Object)
      );
    });

    it('should pass formality when specified', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      (safeReadFileSync as jest.Mock).mockReturnValue('Hello world');

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es',
        formality: 'more',
        output: '/output.txt',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({ formality: 'more', targetLang: 'es' }),
        expect.any(Object)
      );
    });

    it('should pass preserveCode option', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      (safeReadFileSync as jest.Mock).mockReturnValue('Hello world');

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es',
        output: '/output.txt',
        preserveCode: true,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        expect.any(Object),
        { preserveCode: true, skipCache: true }
      );
    });

    it('should pass source language to multi-file translation', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');

      const mockFileService = {
        translateFileToMultiple: jest.fn().mockResolvedValue([
          { targetLang: 'es', outputPath: '/output.es.txt' },
          { targetLang: 'fr', outputPath: '/output.fr.txt' },
        ]),
      };
      (translateCommand as any).ctx.fileTranslationService = mockFileService;

      await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es,fr',
        from: 'en',
        output: '/output',
      });

      expect(mockFileService.translateFileToMultiple).toHaveBeenCalledWith(
        '/input.txt',
        ['es', 'fr'],
        expect.objectContaining({ sourceLang: 'en', outputDir: '/output' })
      );
    });

    it('should pass formality to multi-file translation', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');

      const mockFileService = {
        translateFileToMultiple: jest.fn().mockResolvedValue([
          { targetLang: 'es', outputPath: '/output.es.txt' },
          { targetLang: 'de', outputPath: '/output.de.txt' },
        ]),
      };
      (translateCommand as any).ctx.fileTranslationService = mockFileService;

      await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es,de',
        formality: 'more',
        output: '/output',
      });

      expect(mockFileService.translateFileToMultiple).toHaveBeenCalledWith(
        '/input.txt',
        ['es', 'de'],
        expect.objectContaining({ formality: 'more', outputDir: '/output' })
      );
    });
  });

  describe('translateDirectory()', () => {
    it('should throw error if output directory is not specified', async () => {
      await expect(
        (translateCommand as any).directoryHandler.translateDirectory('/path/to/dir', { to: 'es' })
      ).rejects.toThrow('Output directory is required');
    });

    // Note: Directory translation with ora spinner interactions is complex to mock due to ESM issues
    // The spinner is created (line 281) before the onProgress callback (line 276) uses it,
    // creating a forward reference that's difficult to test in unit tests.
    // This functionality is thoroughly validated through integration and E2E tests:
    // - Successful batch translation with statistics display
    // - Failed files formatting (lines 221-225)
    // - Skipped files count display (line 229-231)
    // - Spinner progress updates (lines 187, 191)
    // - Source language and formality passthrough to batch service
  });

  describe('glossary integration', () => {
    it('should translate text with glossary by name', async () => {
      (mockGlossaryService.resolveGlossaryId as jest.Mock).mockResolvedValueOnce('glossary-123');

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hallo Welt',
        detectedSourceLang: 'en',
      });

      const result = await translateCommand.translateText('Hello world', {
        to: 'de',
        from: 'en',
        glossary: 'my-glossary',
      });

      expect(result).toBe('Hallo Welt');
      expect(mockGlossaryService.resolveGlossaryId).toHaveBeenCalledWith('my-glossary');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        { targetLang: 'de', sourceLang: 'en', glossaryId: 'glossary-123' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should translate text with glossary by ID', async () => {
      (mockGlossaryService.resolveGlossaryId as jest.Mock).mockResolvedValueOnce('01234567-89ab-cdef-0123-456789abcdef');

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Bonjour le monde',
        detectedSourceLang: 'en',
      });

      const result = await translateCommand.translateText('Hello world', {
        to: 'fr',
        from: 'en',
        glossary: '01234567-89ab-cdef-0123-456789abcdef',
      });

      expect(result).toBe('Bonjour le monde');
      expect(mockGlossaryService.resolveGlossaryId).toHaveBeenCalledWith('01234567-89ab-cdef-0123-456789abcdef');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello world',
        { targetLang: 'fr', sourceLang: 'en', glossaryId: '01234567-89ab-cdef-0123-456789abcdef' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should require --from when using --glossary', async () => {
      await expect(
        translateCommand.translateText('Hello world', {
          to: 'de',
          glossary: 'my-glossary',
        })
      ).rejects.toThrow('Source language (--from) is required when using a glossary');
    });

    it('should require --from when using --glossary with multi-target', async () => {
      await expect(
        translateCommand.translateText('Hello world', {
          to: 'de,fr',
          glossary: 'my-glossary',
        })
      ).rejects.toThrow('Source language (--from) is required when using a glossary');
    });

    it('should throw error when glossary not found by name', async () => {
      (mockGlossaryService.resolveGlossaryId as jest.Mock).mockRejectedValueOnce(
        new Error('Glossary "non-existent" not found')
      );

      await expect(
        translateCommand.translateText('Hello world', {
          to: 'de',
          from: 'en',
          glossary: 'non-existent',
        })
      ).rejects.toThrow('Glossary "non-existent" not found');

      expect(mockGlossaryService.resolveGlossaryId).toHaveBeenCalledWith('non-existent');
    });

    it('should translate to multiple languages with glossary', async () => {
      (mockGlossaryService.resolveGlossaryId as jest.Mock).mockResolvedValueOnce('glossary-789');

      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'de', text: 'Hallo' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      const result = await translateCommand.translateText('Hello', {
        to: 'de,fr',
        from: 'en',
        glossary: 'tech-terms',
      });

      expect(result).toBe('[de] Hallo\n[fr] Bonjour');
      expect(mockGlossaryService.resolveGlossaryId).toHaveBeenCalledWith('tech-terms');
      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['de', 'fr'],
        { sourceLang: 'en', glossaryId: 'glossary-789', skipCache: true }
      );
    });

    it('should combine glossary with other options (formality, context)', async () => {
      (mockGlossaryService.resolveGlossaryId as jest.Mock).mockResolvedValueOnce('glossary-abc');

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Sehr geehrte Damen und Herren',
        detectedSourceLang: 'en',
      });

      const result = await translateCommand.translateText('Dear Sir or Madam', {
        to: 'de',
        from: 'en',
        glossary: 'business-glossary',
        formality: 'more',
        context: 'Business letter opening',
      });

      expect(result).toBe('Sehr geehrte Damen und Herren');
      expect(mockGlossaryService.resolveGlossaryId).toHaveBeenCalledWith('business-glossary');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Dear Sir or Madam',
        {
          targetLang: 'de',
          sourceLang: 'en',
          glossaryId: 'glossary-abc',
          formality: 'more',
          context: 'Business letter opening',
        },
        { preserveCode: undefined, skipCache: true }
      );
    });
  });

  describe('text-based file caching', () => {
    // Mock fs module for file operations
    let mockFs: any;

    beforeEach(() => {
      mockFs = jest.requireActual('fs');
      jest.spyOn(mockFs, 'existsSync').mockReturnValue(true);
      jest.spyOn(mockFs, 'readFileSync');
      jest.spyOn(mockFs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(mockFs, 'mkdirSync').mockImplementation(() => undefined);

      // Mock Logger.shouldShowSpinner() to skip spinner code path in document translation
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should use cached text API for small .txt files (under 100 KiB)', async () => {
      const smallContent = 'Hello world!'.repeat(100); // Small file content

      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 50 * 1024, // 50 KiB
        isDirectory: () => false
      } as any);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue(smallContent);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Translated content',
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/path/to/small.txt', {
        to: 'es',
        output: '/out.txt',
      });

      // Should use text translation API (cached)
      expect(mockTranslationService.translate).toHaveBeenCalled();
      expect(mockDocumentTranslationService.translateDocument).not.toHaveBeenCalled();
      expect(result).toContain('Translated /path/to/small.txt');
    });

    it('should fall back to document API for large .txt files (over 100 KiB)', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 150 * 1024, // 150 KiB
        isDirectory: () => false
      } as any);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValueOnce({
        success: true,
        outputPath: '/out.txt',
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/path/to/large.txt', {
        to: 'es',
        output: '/out.txt',
      });

      // Should use document API (not cached)
      expect(mockDocumentTranslationService.translateDocument).toHaveBeenCalled();
      expect(mockTranslationService.translate).not.toHaveBeenCalled();
      expect(result).toContain('File exceeds');
      expect(result).toContain('using document API');
    });

    it('should use cached text API for small .md files', async () => {
      const smallContent = '# Markdown\n\nHello world!';

      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 10 * 1024, // 10 KiB
        isDirectory: () => false
      } as any);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue(smallContent);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(false);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Translated markdown',
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/path/to/doc.md', {
        to: 'es',
        output: '/out.md',
      });

      // Should use text translation API (cached)
      expect(mockTranslationService.translate).toHaveBeenCalled();
      expect(result).toContain('Translated /path/to/doc.md');
    });

    it('should use cached text API for small .html files', async () => {
      const smallContent = '<html><body>Hello</body></html>';

      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 5 * 1024, // 5 KiB
        isDirectory: () => false
      } as any);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue(smallContent);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: '<html><body>Hola</body></html>',
      });

      await (translateCommand as any).fileHandler.translateFile('/path/to/page.html', {
        to: 'es',
        output: '/out.html',
      });

      // Should use text translation API (cached)
      expect(mockTranslationService.translate).toHaveBeenCalled();
      expect(mockDocumentTranslationService.translateDocument).not.toHaveBeenCalled();
    });

    it('should use cached text API for .srt subtitle files', async () => {
      const srtContent = '1\n00:00:01,000 --> 00:00:02,000\nHello world';

      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 5 * 1024, // 5 KiB
        isDirectory: () => false
      } as any);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue(srtContent);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Translated subtitles',
      });

      await (translateCommand as any).fileHandler.translateFile('/path/to/movie.srt', {
        to: 'es',
        output: '/out.srt',
      });

      // Should use text translation API (cached)
      expect(mockTranslationService.translate).toHaveBeenCalled();
      expect(mockDocumentTranslationService.translateDocument).not.toHaveBeenCalled();
    });

    it('should use cached text API for .xlf translation files', async () => {
      const xlfContent = '<?xml version="1.0"?><xliff><file><trans-unit><source>Hello</source></trans-unit></file></xliff>';

      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 10 * 1024, // 10 KiB
        isDirectory: () => false
      } as any);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue(xlfContent);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Translated XML',
      });

      await (translateCommand as any).fileHandler.translateFile('/path/to/strings.xlf', {
        to: 'es',
        output: '/out.xlf',
      });

      // Should use text translation API (cached)
      expect(mockTranslationService.translate).toHaveBeenCalled();
      expect(mockDocumentTranslationService.translateDocument).not.toHaveBeenCalled();
    });

    it('should always use document API for binary files (.pdf, .docx)', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 10 * 1024, // 10 KiB (small, but still binary)
        isDirectory: () => false
      } as any);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValueOnce({
        success: true,
        outputPath: '/out.pdf',
      });

      await (translateCommand as any).fileHandler.translateFile('/path/to/document.pdf', {
        to: 'es',
        output: '/out.pdf',
      });

      // Should use document API (even though small)
      expect(mockDocumentTranslationService.translateDocument).toHaveBeenCalled();
      expect(mockTranslationService.translate).not.toHaveBeenCalled();
    });

    it('should show warning when falling back to document API', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 150 * 1024, // 150 KiB
        isDirectory: () => false
      } as any);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValueOnce({
        success: true,
        outputPath: '/out.txt',
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/path/to/large.txt', {
        to: 'es',
        output: '/out.txt',
      });

      // Should include warning message
      expect(result).toContain('File exceeds');
      expect(result).toContain('100 KiB');
      expect(result).toContain('document API');
    });

    it('should write translated content to output file when using text API', async () => {
      const smallContent = 'Hello world!';
      const translatedContent = 'Hola mundo!';

      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 1 * 1024, // 1 KiB
        isDirectory: () => false
      } as any);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue(smallContent);
      jest.spyOn(mockFs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(mockFs, 'mkdirSync').mockImplementation(() => undefined);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: translatedContent,
      });

      await (translateCommand as any).fileHandler.translateFile('/path/to/small.txt', {
        to: 'es',
        output: '/out.txt',
      });

      // Should write translated content to file via atomic write
      expect(atomicWriteFileSync).toHaveBeenCalledWith('/out.txt', translatedContent, 'utf-8');
    });

    it('should handle UTF-8 encoding correctly', async () => {
      const unicodeContent = 'Hello 世界 🌍';

      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 5 * 1024, // 5 KiB
        isDirectory: () => false
      } as any);
      (safeReadFileSync as jest.Mock).mockReturnValue(unicodeContent);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola 世界 🌍',
      });

      await (translateCommand as any).fileHandler.translateFile('/path/to/unicode.txt', {
        to: 'es',
        output: '/out.txt',
      });

      // Should read with UTF-8 encoding via safeReadFileSync
      expect(safeReadFileSync).toHaveBeenCalledWith('/path/to/unicode.txt', 'utf-8');
    });
  });

  describe('isFilePath() - cross-platform path detection (Issue #4)', () => {
    it('should detect Windows paths with backslashes (C:\\Users\\file.txt)', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      // Access the private isFilePath method via translate()
      // Windows path should be detected as file path
      const spy = jest.spyOn((translateCommand as any).fileHandler, 'translateFile')
        .mockResolvedValue('File translation result');

      // Mock fileTranslationService.isSupportedFile to return true for .txt
      const mockFileService = (translateCommand as any).ctx.fileTranslationService;
      jest.spyOn(mockFileService, 'isSupportedFile').mockReturnValue(true);

      await translateCommand.translate('C:\\Users\\Documents\\file.txt', {
        to: 'es',
        output: '/out.txt',
      });

      expect(spy).toHaveBeenCalledWith('C:\\Users\\Documents\\file.txt', { to: 'es', output: '/out.txt' }, null);
      spy.mockRestore();
    });

    it('should detect Unix paths with forward slashes (/home/user/file.txt)', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const spy = jest.spyOn((translateCommand as any).fileHandler, 'translateFile')
        .mockResolvedValue('File translation result');

      const mockFileService = (translateCommand as any).ctx.fileTranslationService;
      jest.spyOn(mockFileService, 'isSupportedFile').mockReturnValue(true);

      await translateCommand.translate('/home/user/documents/file.txt', {
        to: 'es',
        output: '/out.txt',
      });

      expect(spy).toHaveBeenCalledWith('/home/user/documents/file.txt', { to: 'es', output: '/out.txt' }, null);
      spy.mockRestore();
    });

    it('should NOT treat URLs as file paths (http://example.com/file.txt)', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const mockFileService = (translateCommand as any).ctx.fileTranslationService;
      jest.spyOn(mockFileService, 'isSupportedFile').mockReturnValue(true);

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Texto traducido',
      });

      // URL should be treated as text, not file path
      await translateCommand.translate('http://example.com/file.txt', {
        to: 'es',
      });

      // Should call translateText, NOT translateFile
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'http://example.com/file.txt',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should NOT treat text containing "/" as file path', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const mockFileService = (translateCommand as any).ctx.fileTranslationService;
      jest.spyOn(mockFileService, 'isSupportedFile').mockReturnValue(false);

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Texto traducido',
      });

      // Text with / should be treated as text, not file path
      await translateCommand.translate('Check https://example.com for details', {
        to: 'es',
      });

      // Should call translateText, NOT translateFile
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Check https://example.com for details',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should detect relative Windows paths (folder\\file.txt)', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const spy = jest.spyOn((translateCommand as any).fileHandler, 'translateFile')
        .mockResolvedValue('File translation result');

      const mockFileService = (translateCommand as any).ctx.fileTranslationService;
      jest.spyOn(mockFileService, 'isSupportedFile').mockReturnValue(true);

      await translateCommand.translate('folder\\subfolder\\file.txt', {
        to: 'es',
        output: '/out.txt',
      });

      expect(spy).toHaveBeenCalledWith('folder\\subfolder\\file.txt', { to: 'es', output: '/out.txt' }, null);
      spy.mockRestore();
    });

    it('should detect relative Unix paths (folder/file.txt)', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const spy = jest.spyOn((translateCommand as any).fileHandler, 'translateFile')
        .mockResolvedValue('File translation result');

      const mockFileService = (translateCommand as any).ctx.fileTranslationService;
      jest.spyOn(mockFileService, 'isSupportedFile').mockReturnValue(true);

      await translateCommand.translate('folder/subfolder/file.txt', {
        to: 'es',
        output: '/out.txt',
      });

      expect(spy).toHaveBeenCalledWith('folder/subfolder/file.txt', { to: 'es', output: '/out.txt' }, null);
      spy.mockRestore();
    });

    it('should handle files with no path separator (file.txt) as text when file doesn\'t exist', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const mockFileService = (translateCommand as any).ctx.fileTranslationService;
      jest.spyOn(mockFileService, 'isSupportedFile').mockReturnValue(true);

      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'archivo.txt',
      });

      // No path separator and file doesn't exist -> treat as text
      await translateCommand.translate('file.txt', {
        to: 'es',
      });

      // Should call translateText, NOT translateFile
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'file.txt',
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('multi-language validation (Issue #3)', () => {
    it('should reject invalid language codes in comma-separated list', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'es,invalid,fr',
        })
      ).rejects.toThrow('Invalid target language code: "invalid"');
    });

    it('should accept all valid language codes', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
        { targetLang: 'de', text: 'Hallo' },
      ]);

      const result = await translateCommand.translateText('Hello', {
        to: 'es,fr,de',
      });

      expect(result).toContain('Hola');
      expect(result).toContain('Bonjour');
      expect(result).toContain('Hallo');
      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['es', 'fr', 'de'],
        expect.any(Object)
      );
    });

    it('should reject invalid single language code', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'invalid',
        })
      ).rejects.toThrow('Invalid target language code: "invalid"');
    });

    it('should trim whitespace in language codes', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      const result = await translateCommand.translateText('Hello', {
        to: ' es , fr ',
      });

      expect(result).toContain('Hola');
      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['es', 'fr'],
        expect.any(Object)
      );
    });

    it('should accept mixed-case language codes by normalizing to lowercase', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'de', text: 'Hallo' },
        { targetLang: 'pt-br', text: 'Olá' },
      ]);

      const result = await translateCommand.translateText('Hello', {
        to: 'DE,pt-BR',
      });

      expect(result).toContain('Hallo');
      expect(result).toContain('Olá');
      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['de', 'pt-br'],
        expect.any(Object)
      );
    });

    it('should accept uppercase single language code by normalizing to lowercase', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hallo Welt',
      });

      const result = await translateCommand.translateText('Hello world', {
        to: 'DE',
      });

      expect(result).toContain('Hallo Welt');
    });

    it('should reject empty language codes after trimming', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'es,,fr',
        })
      ).rejects.toThrow('Invalid target language code: ""');
    });

    it('should validate language codes for file translation', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');

      await expect(
        (translateCommand as any).fileHandler.translateFile('/input.txt', {
          to: 'es,invalid,fr',
          output: '/output',
        })
      ).rejects.toThrow('Invalid target language code: "invalid"');
    });
  });

  describe('symlink path validation (Issue #6)', () => {
    it('should reject symlink file paths', async () => {
      const fs = jest.requireActual('fs');
      // Mock lstatSync to indicate it's a symlink
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => false,
      } as any);

      await expect(
        translateCommand.translate('/path/to/symlink.txt', {
          to: 'es',
          output: '/out.txt',
        })
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should reject symlink directory paths', async () => {
      const fs = jest.requireActual('fs');
      // Mock lstatSync to indicate it's a symlink directory
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => true,
        isDirectory: () => true,
        isFile: () => false,
      } as any);

      await expect(
        translateCommand.translate('/path/to/symlink-dir', {
          to: 'es',
          output: '/out',
        })
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should accept regular file paths', async () => {
      const fs = jest.requireActual('fs');
      // Mock lstatSync to indicate it's a regular file (not a symlink)
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
        size: 1024,
      } as any);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 1024,
      } as any);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('Hello world');
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      const result = await translateCommand.translate('/path/to/regular-file.txt', {
        to: 'es',
        output: '/out.txt',
      });

      expect(result).toContain('Translated');
      expect(result).toContain('/out.txt');
    });

    it('should accept regular directory paths', async () => {
      const fs = jest.requireActual('fs');
      // Mock lstatSync to indicate it's a regular directory (not a symlink)
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      } as any);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any);

      // Mock translateDirectory to return success
      const spy = jest.spyOn((translateCommand as any).directoryHandler, 'translateDirectory')
        .mockResolvedValue('Directory translation complete');

      const result = await translateCommand.translate('/path/to/regular-dir', {
        to: 'es',
        output: '/out',
      });

      expect(result).toBe('Directory translation complete');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should provide clear error message for symlinks', async () => {
      const fs = jest.requireActual('fs');
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => false,
      } as any);

      await expect(
        translateCommand.translate('/path/to/symlink.txt', {
          to: 'es',
          output: '/out.txt',
        })
      ).rejects.toThrow('Symlinks are not supported for security reasons: /path/to/symlink.txt');
    });
  });

  describe('style ID', () => {
    it('should pass styleId to translation service', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        styleId: 'abc-123-uuid',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ styleId: 'abc-123-uuid' }),
        expect.any(Object)
      );
    });

    it('should work without styleId', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', { to: 'es' });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.not.objectContaining({ styleId: expect.anything() }),
        expect.any(Object)
      );
    });

    it('should reject styleId with latency_optimized model', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'es',
          styleId: 'abc-123-uuid',
          modelType: 'latency_optimized',
        })
      ).rejects.toThrow('Style ID cannot be used with latency_optimized model type');
    });

    it('should pass styleId in translateToMultiple', async () => {
      mockTranslationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,fr',
        styleId: 'abc-123-uuid',
      });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        ['es', 'fr'],
        expect.objectContaining({ styleId: 'abc-123-uuid' })
      );
    });

    it('should allow styleId with quality_optimized model', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        styleId: 'abc-123-uuid',
        modelType: 'quality_optimized',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          styleId: 'abc-123-uuid',
          modelType: 'quality_optimized',
        }),
        expect.any(Object)
      );
    });
  });

  describe('expanded language support', () => {
    it('should accept extended language codes', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hujambo',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', { to: 'sw' });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ targetLang: 'sw' }),
        expect.any(Object)
      );
    });

    it('should accept target-only regional variants', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', { to: 'es-419' });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ targetLang: 'es-419' }),
        expect.any(Object)
      );
    });

    it('should accept zh-hans and zh-hant variants', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', { to: 'zh-hans' });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ targetLang: 'zh-hans' }),
        expect.any(Object)
      );
    });

    it('should reject latency_optimized model with extended languages', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'sw',
          modelType: 'latency_optimized',
        })
      ).rejects.toThrow('only support quality_optimized model type');
    });

    it('should reject formality with extended languages', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'sw',
          formality: 'more',
        })
      ).rejects.toThrow('do not support formality');
    });

    it('should reject glossary with extended languages', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'sw',
          glossary: 'my-glossary',
        })
      ).rejects.toThrow('do not support glossaries');
    });

    it('should allow formality=default with extended languages', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'sw',
        formality: 'default',
      });

      expect(mockTranslationService.translate).toHaveBeenCalled();
    });

    it('should reject latency_optimized with extended languages in multi-target', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'sw,hi',
          modelType: 'latency_optimized',
        })
      ).rejects.toThrow('only support quality_optimized model type');
    });

    it('should allow core + extended mix without restricted options', async () => {
      mockTranslationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'sw', text: 'Hujambo' },
      ]);

      await translateCommand.translateText('Hello', { to: 'es,sw' });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalled();
    });

    it('should reject formality with mixed core+extended targets', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'es,sw',
          formality: 'more',
        })
      ).rejects.toThrow('do not support formality');
    });

    it('should accept newly added core languages (he, vi)', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', { to: 'he' });
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ targetLang: 'he' }),
        expect.any(Object)
      );
    });

    it('should allow formality with newly added core languages', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'vi',
        formality: 'more',
      });

      expect(mockTranslationService.translate).toHaveBeenCalled();
    });
  });

  describe('tag handling version', () => {
    it('should pass tagHandlingVersion to translation service', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: '<p>Hola</p>',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<p>Hello</p>', {
        to: 'es',
        tagHandling: 'html',
        tagHandlingVersion: 'v2',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello</p>',
        expect.objectContaining({ tagHandlingVersion: 'v2' }),
        expect.any(Object)
      );
    });

    it('should reject tag-handling-version without tag-handling', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'es',
          tagHandlingVersion: 'v2',
        })
      ).rejects.toThrow('--tag-handling-version requires --tag-handling');
    });

    it('should reject invalid tag-handling-version value', async () => {
      await expect(
        translateCommand.translateText('Hello', {
          to: 'es',
          tagHandling: 'xml',
          tagHandlingVersion: 'v3',
        })
      ).rejects.toThrow('--tag-handling-version must be "v1" or "v2"');
    });

    it('should accept v1 tag-handling-version', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<p>Hello</p>', {
        to: 'es',
        tagHandling: 'xml',
        tagHandlingVersion: 'v1',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello</p>',
        expect.objectContaining({ tagHandlingVersion: 'v1' }),
        expect.any(Object)
      );
    });

    it('should work without tag-handling-version', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<p>Hello</p>', {
        to: 'es',
        tagHandling: 'html',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello</p>',
        expect.not.objectContaining({ tagHandlingVersion: expect.anything() }),
        expect.any(Object)
      );
    });
  });

  describe('XML tag handling parameters', () => {
    it('should reject XML tag params without --tag-handling xml', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          outlineDetection: 'true',
        })
      ).rejects.toThrow('XML tag handling parameters');
    });

    it('should reject splittingTags without --tag-handling xml', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          splittingTags: 'p,div',
        })
      ).rejects.toThrow('require --tag-handling xml');
    });

    it('should reject nonSplittingTags without --tag-handling xml', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          nonSplittingTags: 'span,em',
        })
      ).rejects.toThrow('require --tag-handling xml');
    });

    it('should reject ignoreTags without --tag-handling xml', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          ignoreTags: 'code,pre',
        })
      ).rejects.toThrow('require --tag-handling xml');
    });

    it('should reject invalid outlineDetection value', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          tagHandling: 'xml',
          outlineDetection: 'invalid',
        })
      ).rejects.toThrow('--outline-detection must be "true" or "false"');
    });

    it('should pass outlineDetection=true', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<p>Hello</p>', {
        to: 'es',
        tagHandling: 'xml',
        outlineDetection: 'true',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello</p>',
        expect.objectContaining({ outlineDetection: true }),
        expect.any(Object)
      );
    });

    it('should pass outlineDetection=false', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<p>Hello</p>', {
        to: 'es',
        tagHandling: 'xml',
        outlineDetection: 'false',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello</p>',
        expect.objectContaining({ outlineDetection: false }),
        expect.any(Object)
      );
    });

    it('should pass splittingTags as array', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<p>Hello</p>', {
        to: 'es',
        tagHandling: 'xml',
        splittingTags: 'p,div,section',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello</p>',
        expect.objectContaining({ splittingTags: ['p', 'div', 'section'] }),
        expect.any(Object)
      );
    });

    it('should pass nonSplittingTags as array', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<span>Hello</span>', {
        to: 'es',
        tagHandling: 'xml',
        nonSplittingTags: 'span,em,strong',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<span>Hello</span>',
        expect.objectContaining({ nonSplittingTags: ['span', 'em', 'strong'] }),
        expect.any(Object)
      );
    });

    it('should pass ignoreTags as array', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<code>test</code>', {
        to: 'es',
        tagHandling: 'xml',
        ignoreTags: 'code,pre',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<code>test</code>',
        expect.objectContaining({ ignoreTags: ['code', 'pre'] }),
        expect.any(Object)
      );
    });
  });

  describe('validateXmlTags()', () => {
    it('should reject empty tag names', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          tagHandling: 'xml',
          splittingTags: 'p,,div',
        })
      ).rejects.toThrow('Tag name cannot be empty');
    });

    it('should reject tags starting with "xml" (case-insensitive)', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          tagHandling: 'xml',
          splittingTags: 'xmlFoo',
        })
      ).rejects.toThrow('cannot start with "xml"');
    });

    it('should reject tags starting with "XML" (uppercase)', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          tagHandling: 'xml',
          nonSplittingTags: 'XMLBar',
        })
      ).rejects.toThrow('cannot start with "xml"');
    });

    it('should reject invalid XML tag names (starting with digit)', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          tagHandling: 'xml',
          ignoreTags: '1invalid',
        })
      ).rejects.toThrow('Invalid XML tag name');
    });

    it('should reject tag names with spaces', async () => {
      await expect(
        translateCommand.translateText('<p>Hello</p>', {
          to: 'es',
          tagHandling: 'xml',
          splittingTags: 'my tag',
        })
      ).rejects.toThrow('Invalid XML tag name');
    });

    it('should accept valid XML tag names with underscores, hyphens, periods', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'result',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('<p>Hello</p>', {
        to: 'es',
        tagHandling: 'xml',
        splittingTags: '_tag,my-tag,my.tag',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '<p>Hello</p>',
        expect.objectContaining({ splittingTags: ['_tag', 'my-tag', 'my.tag'] }),
        expect.any(Object)
      );
    });
  });

  describe('output format - JSON', () => {
    it('should return JSON format for single text translation', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: 'en',
      });

      const result = await translateCommand.translateText('Hello', {
        to: 'es',
        format: 'json',
      });

      const parsed = JSON.parse(result);
      expect(parsed.text).toBe('Hola');
      expect(parsed.targetLang).toBe('es');
    });

    it('should return JSON format for multi-target translation', async () => {
      mockTranslationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      const result = await translateCommand.translateText('Hello', {
        to: 'es,fr',
        format: 'json',
      });

      const parsed = JSON.parse(result);
      expect(parsed.translations).toHaveLength(2);
      expect(parsed.translations[0].text).toBe('Hola');
      expect(parsed.translations[1].text).toBe('Bonjour');
    });

    it('should return table format for multi-target translation when stdout is a TTY', async () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        configurable: true,
        writable: true,
      });
      try {
        mockTranslationService.translateToMultiple.mockResolvedValue([
          { targetLang: 'es', text: 'Hola' },
          { targetLang: 'fr', text: 'Bonjour' },
        ]);

        const result = await translateCommand.translateText('Hello', {
          to: 'es,fr',
          format: 'table',
        });

        expect(result).toContain('ES');
        expect(result).toContain('FR');
        expect(result).toContain('Hola');
        expect(result).toContain('Bonjour');
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', {
          value: originalIsTTY,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  describe('metadata display', () => {
    it('should display billed characters when returned by API', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
        billedCharacters: 5,
      });

      const result = await translateCommand.translateText('Hello', {
        to: 'es',
        showBilledCharacters: true,
      });

      expect(result).toContain('Hola');
      expect(result).toContain('Billed characters: 5');
    });

    it('should display model type when returned by API', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
        modelTypeUsed: 'quality_optimized',
      });

      const result = await translateCommand.translateText('Hello', {
        to: 'es',
      });

      expect(result).toContain('Hola');
      expect(result).toContain('Model: quality_optimized');
    });

    it('should display both billedCharacters and modelTypeUsed', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
        billedCharacters: 42,
        modelTypeUsed: 'latency_optimized',
      });

      const result = await translateCommand.translateText('Hello', {
        to: 'es',
        showBilledCharacters: true,
      });

      expect(result).toContain('Billed characters: 42');
      expect(result).toContain('Model: latency_optimized');
    });

    it('should pass showBilledCharacters option to service', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        showBilledCharacters: true,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ showBilledCharacters: true }),
        expect.any(Object)
      );
    });

    it('should pass showBilledCharacters to translateToMultiple', async () => {
      mockTranslationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'es', text: 'Hola' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,fr',
        showBilledCharacters: true,
      });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        expect.any(Array),
        expect.objectContaining({ showBilledCharacters: true })
      );
    });
  });

  describe('preserveFormatting option', () => {
    it('should pass preserveFormatting=true to service', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        preserveFormatting: true,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ preserveFormatting: true }),
        expect.any(Object)
      );
    });

    it('should pass preserveFormatting=false to service', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        preserveFormatting: false,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ preserveFormatting: false }),
        expect.any(Object)
      );
    });
  });

  describe('cache option', () => {
    it('should set skipCache=false when cache is true', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        cache: true,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.any(Object),
        expect.objectContaining({ skipCache: false })
      );
    });

    it('should set skipCache=true when cache is false (--no-cache)', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await translateCommand.translateText('Hello', {
        to: 'es',
        cache: false,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.any(Object),
        expect.objectContaining({ skipCache: true })
      );
    });

    it('should pass skipCache to translateToMultiple', async () => {
      mockTranslationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'es', text: 'Hola' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,fr',
        cache: true,
      });

      expect(mockTranslationService.translateToMultiple).toHaveBeenCalledWith(
        'Hello',
        expect.any(Array),
        expect.objectContaining({ skipCache: false })
      );
    });
  });

  describe('translateDirectory() - full path', () => {
    beforeEach(() => {
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should translate directory with successful results', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [
            { file: 'a.txt', outputPath: '/out/a.txt' },
            { file: 'b.txt', outputPath: '/out/b.txt' },
          ],
          failed: [],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 2,
          successful: 2,
          failed: 0,
          skipped: 0,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      const result = await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        output: '/out',
      });

      expect(result).toContain('Translation Statistics');
      expect(result).toContain('Total files: 2');
      expect(result).toContain('Successful: 2');
      expect(mockBatchService.translateDirectory).toHaveBeenCalled();
    });

    it('should show failed files in output', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [{ file: 'a.txt', outputPath: '/out/a.txt' }],
          failed: [{ file: 'b.txt', error: 'Network error' }],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 2,
          successful: 1,
          failed: 1,
          skipped: 0,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      const result = await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        output: '/out',
      });

      expect(result).toContain('Failed: 1');
      expect(result).toContain('Failed files');
      expect(result).toContain('b.txt: Network error');
    });

    it('should show skipped files in output', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [{ file: 'a.txt', outputPath: '/out/a.txt' }],
          failed: [],
          skipped: [{ file: 'c.bin', reason: 'Unsupported format' }],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 2,
          successful: 1,
          failed: 0,
          skipped: 1,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      const result = await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        output: '/out',
      });

      expect(result).toContain('Skipped: 1');
    });

    it('should pass source language and formality', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [],
          failed: [],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        from: 'en',
        formality: 'more',
        output: '/out',
      });

      expect(mockBatchService.translateDirectory).toHaveBeenCalledWith(
        '/src',
        expect.objectContaining({ targetLang: 'es', sourceLang: 'en', formality: 'more' }),
        expect.any(Object)
      );
    });

    it('should override concurrency when specified', async () => {
      // When concurrency is specified, a new BatchTranslationService is created
      // which replaces the existing one. We need to mock the constructor.
      const { BatchTranslationService } = jest.requireMock('../../src/services/batch-translation');
      const mockInstance = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [],
          failed: [],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
        }),
      };
      BatchTranslationService.mockImplementation(() => mockInstance);

      await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        output: '/out',
        concurrency: 10,
      });

      expect(BatchTranslationService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ concurrency: 10 })
      );
      expect(mockInstance.translateDirectory).toHaveBeenCalled();
    });

    it('should propagate errors from batch service', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockRejectedValue(new Error('Batch failed')),
        getStatistics: jest.fn(),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      await expect(
        (translateCommand as any).directoryHandler.translateDirectory('/src', {
          to: 'es',
          output: '/out',
        })
      ).rejects.toThrow('Batch failed');
    });

    it('should use spinner when shouldShowSpinner returns true', async () => {
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(true);

      // Re-setup ora mock since clearAllMocks resets it
      const ora = jest.requireMock('ora');
      const mockSpinner = {
        start: jest.fn(function(this: any) { return this; }),
        succeed: jest.fn(function(this: any) { return this; }),
        fail: jest.fn(function(this: any) { return this; }),
        text: '',
      };
      ora.mockReturnValue(mockSpinner);

      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [{ file: 'a.txt', outputPath: '/out/a.txt' }],
          failed: [],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 1,
          successful: 1,
          failed: 0,
          skipped: 0,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      const result = await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        output: '/out',
      });

      expect(result).toContain('Translation Statistics');
      expect(mockSpinner.start).toHaveBeenCalled();
      expect(mockSpinner.succeed).toHaveBeenCalled();
    });

    it('should pass recursive and pattern options', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [],
          failed: [],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        output: '/out',
        recursive: false,
        pattern: '*.md',
      });

      expect(mockBatchService.translateDirectory).toHaveBeenCalledWith(
        '/src',
        expect.any(Object),
        expect.objectContaining({
          outputDir: '/out',
          recursive: false,
          pattern: '*.md',
        })
      );
    });

    it('should support --no-recursive to disable recursive directory scanning', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [],
          failed: [],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es',
        output: '/out',
        recursive: false,
      });

      expect(mockBatchService.translateDirectory).toHaveBeenCalledWith(
        '/src',
        expect.any(Object),
        expect.objectContaining({
          recursive: false,
        })
      );
    });

    it('should support multi-target directory translation with comma-separated languages', async () => {
      const mockBatchService = {
        translateDirectory: jest.fn().mockResolvedValue({
          successful: [{ file: 'a.txt', outputPath: '/out/a.txt' }],
          failed: [],
          skipped: [],
        }),
        getStatistics: jest.fn().mockReturnValue({
          total: 1,
          successful: 1,
          failed: 0,
          skipped: 0,
        }),
      };
      (translateCommand as any).ctx.batchTranslationService = mockBatchService;

      const result = await (translateCommand as any).directoryHandler.translateDirectory('/src', {
        to: 'es,fr',
        output: '/out',
      });

      expect(mockBatchService.translateDirectory).toHaveBeenCalledTimes(2);
      expect(result).toContain('[es]');
      expect(result).toContain('[fr]');
    });
  });

  describe('translateDocument()', () => {
    beforeEach(() => {
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should translate a document successfully', async () => {
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValue({
        success: true,
        outputPath: '/out.pdf',
      });

      const result = await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
        to: 'es',
        output: '/out.pdf',
      });

      expect(result).toContain('Translated /doc.pdf -> /out.pdf');
      expect(mockDocumentTranslationService.translateDocument).toHaveBeenCalledWith(
        '/doc.pdf',
        '/out.pdf',
        expect.objectContaining({ targetLang: 'es' }),
        expect.any(Function)
      );
    });

    it('should pass sourceLang to document translation', async () => {
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValue({
        success: true,
        outputPath: '/out.pdf',
      });

      await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
        to: 'es',
        from: 'en',
        output: '/out.pdf',
      });

      expect(mockDocumentTranslationService.translateDocument).toHaveBeenCalledWith(
        '/doc.pdf',
        '/out.pdf',
        expect.objectContaining({ targetLang: 'es', sourceLang: 'en' }),
        expect.any(Function)
      );
    });

    it('should pass formality to document translation', async () => {
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValue({
        success: true,
        outputPath: '/out.pdf',
      });

      await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
        to: 'es',
        formality: 'more',
        output: '/out.pdf',
      });

      expect(mockDocumentTranslationService.translateDocument).toHaveBeenCalledWith(
        '/doc.pdf',
        '/out.pdf',
        expect.objectContaining({ formality: 'more' }),
        expect.any(Function)
      );
    });

    it('should pass outputFormat to document translation', async () => {
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValue({
        success: true,
        outputPath: '/out.docx',
      });

      await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
        to: 'es',
        output: '/out.docx',
        outputFormat: 'docx',
      });

      expect(mockDocumentTranslationService.translateDocument).toHaveBeenCalledWith(
        '/doc.pdf',
        '/out.docx',
        expect.objectContaining({ outputFormat: 'docx' }),
        expect.any(Function)
      );
    });

    it('should pass enableDocumentMinification option', async () => {
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValue({
        success: true,
        outputPath: '/out.pdf',
      });

      await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
        to: 'es',
        output: '/out.pdf',
        enableMinification: true,
      });

      expect(mockDocumentTranslationService.translateDocument).toHaveBeenCalledWith(
        '/doc.pdf',
        '/out.pdf',
        expect.objectContaining({ enableDocumentMinification: true }),
        expect.any(Function)
      );
    });

    it('should display billed characters when returned', async () => {
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValue({
        success: true,
        outputPath: '/out.pdf',
        billedCharacters: 1500,
      });

      const result = await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
        to: 'es',
        output: '/out.pdf',
      });

      expect(result).toContain('Billed characters: 1,500');
    });

    it('should propagate errors from document service', async () => {
      (mockDocumentTranslationService.translateDocument as jest.Mock).mockRejectedValue(
        new Error('Document upload failed')
      );

      await expect(
        (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
          to: 'es',
          output: '/out.pdf',
        })
      ).rejects.toThrow('Document upload failed');
    });

    it('should use spinner when shouldShowSpinner returns true', async () => {
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(true);

      // Re-setup ora mock since clearAllMocks resets it
      const ora = jest.requireMock('ora');
      const mockSpinner = {
        start: jest.fn(function(this: any) { return this; }),
        succeed: jest.fn(function(this: any) { return this; }),
        fail: jest.fn(function(this: any) { return this; }),
        text: '',
      };
      ora.mockReturnValue(mockSpinner);

      (mockDocumentTranslationService.translateDocument as jest.Mock).mockImplementation(
        (_input: string, _output: string, _opts: any, onProgress: Function) => {
          onProgress({ status: 'queued' });
          onProgress({ status: 'translating', secondsRemaining: 10 });
          onProgress({ status: 'translating' });
          onProgress({ status: 'done' });
          return Promise.resolve({ success: true, outputPath: '/out.pdf' });
        }
      );

      const result = await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
        to: 'es',
        output: '/out.pdf',
      });

      expect(result).toContain('Translated /doc.pdf -> /out.pdf');
      expect(mockSpinner.start).toHaveBeenCalled();
      expect(mockSpinner.succeed).toHaveBeenCalled();
    });

    it('should fail spinner when document service throws with spinner enabled', async () => {
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(true);

      // Re-setup ora mock since clearAllMocks resets it
      const ora = jest.requireMock('ora');
      const mockSpinner = {
        start: jest.fn(function(this: any) { return this; }),
        succeed: jest.fn(function(this: any) { return this; }),
        fail: jest.fn(function(this: any) { return this; }),
        text: '',
      };
      ora.mockReturnValue(mockSpinner);

      (mockDocumentTranslationService.translateDocument as jest.Mock).mockRejectedValue(
        new Error('Network error')
      );

      await expect(
        (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
          to: 'es',
          output: '/out.pdf',
        })
      ).rejects.toThrow('Network error');

      expect(mockSpinner.fail).toHaveBeenCalledWith('Document translation failed');
    });
  });

  describe('translateFile() - non-text-based files via fileTranslationService', () => {
    let mockFs: any;

    beforeEach(() => {
      mockFs = jest.requireActual('fs');
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should use fileTranslationService for unsupported non-text-based files', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 1024,
        isDirectory: () => false,
      } as any);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(false);

      const mockFileService = {
        translateFile: jest.fn().mockResolvedValue(undefined),
        isSupportedFile: jest.fn().mockReturnValue(true),
        translateFileToMultiple: jest.fn(),
      };
      (translateCommand as any).ctx.fileTranslationService = mockFileService;

      const result = await (translateCommand as any).fileHandler.translateFile('/input.csv', {
        to: 'es',
        output: '/output.csv',
      });

      expect(result).toBe('Translated /input.csv -> /output.csv');
      expect(mockFileService.translateFile).toHaveBeenCalledWith(
        '/input.csv',
        '/output.csv',
        expect.objectContaining({ targetLang: 'es' }),
        { preserveCode: undefined }
      );
    });

    it('should pass sourceLang and formality to fileTranslationService', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 1024,
        isDirectory: () => false,
      } as any);

      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(false);

      const mockFileService = {
        translateFile: jest.fn().mockResolvedValue(undefined),
        isSupportedFile: jest.fn().mockReturnValue(true),
        translateFileToMultiple: jest.fn(),
      };
      (translateCommand as any).ctx.fileTranslationService = mockFileService;

      await (translateCommand as any).fileHandler.translateFile('/input.csv', {
        to: 'es',
        from: 'en',
        formality: 'less',
        output: '/output.csv',
      });

      expect(mockFileService.translateFile).toHaveBeenCalledWith(
        '/input.csv',
        '/output.csv',
        expect.objectContaining({ targetLang: 'es', sourceLang: 'en', formality: 'less' }),
        { preserveCode: undefined }
      );
    });

    it('should throw when file size is null for text-based file', async () => {
      // Simulate statSync throwing for file that does not exist
      jest.spyOn(mockFs, 'statSync').mockImplementation(() => {
        throw new Error('ENOENT');
      });

      await expect(
        (translateCommand as any).fileHandler.translateFile('/nonexistent.txt', {
          to: 'es',
          output: '/out.txt',
        }, null)
      ).rejects.toThrow('File not found or cannot be accessed');
    });
  });

  describe('translateTextFile() - text-based file translation details', () => {
    let mockFs: any;

    beforeEach(() => {
      mockFs = jest.requireActual('fs');
      jest.spyOn(mockFs, 'existsSync').mockReturnValue(true);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue('Hello');
      jest.spyOn(mockFs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(mockFs, 'mkdirSync').mockImplementation(() => undefined);
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 1024,
        isDirectory: () => false,
      } as any);
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
      (safeReadFileSync as jest.Mock).mockReturnValue('Hello');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should pass glossaryId to text translation for file', async () => {
      (mockGlossaryService.resolveGlossaryId as jest.Mock).mockResolvedValue('glossary-file-123');
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await (translateCommand as any).fileHandler.translateTextFile('/doc.txt', {
        to: 'es',
        from: 'en',
        output: '/out.txt',
        glossary: 'my-glossary',
      });

      expect(mockGlossaryService.resolveGlossaryId).toHaveBeenCalledWith('my-glossary');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ glossaryId: 'glossary-file-123' }),
        expect.any(Object)
      );
    });

    it('should pass preserveFormatting to text translation for file', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await (translateCommand as any).fileHandler.translateTextFile('/doc.txt', {
        to: 'es',
        output: '/out.txt',
        preserveFormatting: true,
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ preserveFormatting: true }),
        expect.any(Object)
      );
    });

    it('should pass context to text translation for file', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await (translateCommand as any).fileHandler.translateTextFile('/doc.txt', {
        to: 'es',
        output: '/out.txt',
        context: 'Technical documentation',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ context: 'Technical documentation' }),
        expect.any(Object)
      );
    });

    it('should create output directory if it does not exist', async () => {
      jest.spyOn(mockFs, 'existsSync').mockImplementation((...args: unknown[]) => {
        if (args[0] === '/nested/dir') {
          return false;
        }
        return true;
      });

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await (translateCommand as any).fileHandler.translateTextFile('/doc.txt', {
        to: 'es',
        output: '/nested/dir/out.txt',
      });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/nested/dir', { recursive: true });
    });

    it('should pass formality and sourceLang to text file translation', async () => {
      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      await (translateCommand as any).fileHandler.translateTextFile('/doc.txt', {
        to: 'es',
        from: 'en',
        formality: 'more',
        output: '/out.txt',
      });

      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ targetLang: 'es', sourceLang: 'en', formality: 'more' }),
        expect.any(Object)
      );
    });

    it('should use safeReadFileSync instead of bare fs.readFileSync', async () => {
      (safeReadFileSync as jest.Mock).mockReturnValue('Safe content');
      mockTranslationService.translate.mockResolvedValue({
        text: 'Contenido seguro',
        detectedSourceLang: undefined,
      });

      await (translateCommand as any).fileHandler.translateTextFile('/doc.txt', {
        to: 'es',
        output: '/out.txt',
      });

      expect(safeReadFileSync).toHaveBeenCalledWith('/doc.txt', 'utf-8');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Safe content',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should reject symlinks when reading translation files', async () => {
      (safeReadFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Symlinks are not supported for security reasons: /doc.txt');
      });

      await expect(
        (translateCommand as any).fileHandler.translateTextFile('/doc.txt', {
          to: 'es',
          output: '/out.txt',
        })
      ).rejects.toThrow('Symlinks are not supported for security reasons: /doc.txt');

      expect(safeReadFileSync).toHaveBeenCalledWith('/doc.txt', 'utf-8');
      expect(mockTranslationService.translate).not.toHaveBeenCalled();
    });
  });

  describe('translateFile() - large text file fallback without document support', () => {
    let mockFs: any;

    beforeEach(() => {
      mockFs = jest.requireActual('fs');
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should fall through to fileTranslationService when large text file not supported by document API', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 150 * 1024,
        isDirectory: () => false,
      } as any);

      // Large .txt, but document API does NOT support it
      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(false);

      const mockFileService = {
        translateFile: jest.fn().mockResolvedValue(undefined),
        isSupportedFile: jest.fn().mockReturnValue(true),
        translateFileToMultiple: jest.fn(),
      };
      (translateCommand as any).ctx.fileTranslationService = mockFileService;

      const result = await (translateCommand as any).fileHandler.translateFile('/large.txt', {
        to: 'es',
        output: '/out.txt',
      });

      // Falls through to the fileTranslationService path
      expect(result).toBe('Translated /large.txt -> /out.txt');
      expect(mockFileService.translateFile).toHaveBeenCalled();
      expect(mockDocumentTranslationService.translateDocument).not.toHaveBeenCalled();
    });
  });

  describe('getFileSize()', () => {
    let mockFs: any;

    beforeEach(() => {
      mockFs = jest.requireActual('fs');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return null when file does not exist', () => {
      jest.spyOn(mockFs, 'statSync').mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = getFileSize('/nonexistent.txt');
      expect(result).toBeNull();
    });

    it('should return file size when file exists', () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({ size: 42 } as any);

      const result = getFileSize('/existing.txt');
      expect(result).toBe(42);
    });
  });

  describe('translateFile() with cachedStats', () => {
    let mockFs: any;

    beforeEach(() => {
      mockFs = jest.requireActual('fs');
      jest.spyOn(mockFs, 'existsSync').mockReturnValue(true);
      jest.spyOn(mockFs, 'readFileSync').mockReturnValue('Hello');
      jest.spyOn(mockFs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(mockFs, 'mkdirSync').mockImplementation(() => undefined);
      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should use cachedStats size when provided for text-based file', async () => {
      const cachedStats = { size: 5 * 1024, isDirectory: () => false } as any;

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/doc.txt', {
        to: 'es',
        output: '/out.txt',
      }, cachedStats);

      expect(result).toContain('Translated /doc.txt');
      expect(mockTranslationService.translate).toHaveBeenCalled();
    });

    it('should call getFileSize when cachedStats is null for text-based file', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 5 * 1024,
        isDirectory: () => false,
      } as any);

      mockTranslationService.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: undefined,
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/doc.txt', {
        to: 'es',
        output: '/out.txt',
      }, null);

      expect(result).toContain('Translated /doc.txt');
    });
  });

  describe('ignored option warnings', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    describe('multi-target mode', () => {
      beforeEach(() => {
        (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValue([
          { targetLang: 'es', text: 'Hola' },
          { targetLang: 'fr', text: 'Bonjour' },
        ]);
      });

      it('should warn when unsupported options are passed to multi-target mode', async () => {
        await translateCommand.translateText('Hello', {
          to: 'es,fr',
          splitSentences: 'on',
          tagHandling: 'xml',
          modelType: 'quality_optimized',
          preserveFormatting: true,
        });

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/multi-target mode does not support.*--split-sentences/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--tag-handling/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--model-type/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--preserve-formatting/)
        );
      });

      it('should not warn when only supported options are used in multi-target mode', async () => {
        await translateCommand.translateText('Hello', {
          to: 'es,fr',
          from: 'en',
          formality: 'more',
          context: 'greeting',
        });

        expect(warnSpy).not.toHaveBeenCalled();
      });

      it('should warn about XML tag params in multi-target mode', async () => {
        await translateCommand.translateText('Hello', {
          to: 'es,fr',
          outlineDetection: 'true',
          splittingTags: 'p,div',
          nonSplittingTags: 'span',
          ignoreTags: 'code',
        });

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--outline-detection/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--splitting-tags/)
        );
      });
    });

    describe('directory mode', () => {
      it('should warn when unsupported options are passed to directory mode', async () => {
        await expect(
          (translateCommand as any).directoryHandler.translateDirectory('/path/to/dir', {
            to: 'es',
            output: '/output',
            splitSentences: 'on',
            glossary: 'my-glossary',
            customInstruction: ['Be formal'],
            modelType: 'quality_optimized',
            context: 'technical docs',
          })
        ).rejects.toThrow(); // will fail due to batch service mock, but warning comes first

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/directory mode does not support/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--split-sentences/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--glossary/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--custom-instruction/)
        );
      });

      it('should not warn when only supported options are used in directory mode', async () => {
        await expect(
          (translateCommand as any).directoryHandler.translateDirectory('/path/to/dir', {
            to: 'es',
            output: '/output',
            from: 'en',
            formality: 'more',
          })
        ).rejects.toThrow(); // batch service mock will cause this to fail

        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    describe('document mode', () => {
      beforeEach(() => {
        jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
        (mockDocumentTranslationService.translateDocument as jest.Mock).mockResolvedValue({
          success: true,
          outputPath: '/output.pdf',
        });
      });

      it('should warn when unsupported options are passed to document mode', async () => {
        await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
          to: 'es',
          output: '/output.pdf',
          splitSentences: 'on',
          tagHandling: 'xml',
          modelType: 'quality_optimized',
          customInstruction: ['Be formal'],
          glossary: 'my-glossary',
          preserveCode: true,
        });

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/document mode does not support/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--split-sentences/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--glossary/)
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/--preserve-code/)
        );
      });

      it('should not warn when only supported options are used in document mode', async () => {
        await (translateCommand as any).fileHandler.documentHandler.translateDocument('/doc.pdf', {
          to: 'es',
          output: '/output.pdf',
          from: 'en',
          formality: 'more',
          outputFormat: 'docx',
          enableMinification: true,
        });

        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    it('should not warn for undefined or false boolean options', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValue([
        { targetLang: 'es', text: 'Hola' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      await translateCommand.translateText('Hello', {
        to: 'es,fr',
        preserveFormatting: undefined,
        preserveCode: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('buildTranslationOptions()', () => {
    it('should build base options with sourceLang and formality', () => {
      const result = buildTranslationOptions({
        to: 'es',
        from: 'en',
        formality: 'more',
      });
      expect(result).toEqual({
        targetLang: 'es',
        sourceLang: 'en',
        formality: 'more',
      });
    });

    it('should omit undefined optional fields', () => {
      const result = buildTranslationOptions({
        to: 'de',
      });
      expect(result).toEqual({ targetLang: 'de' });
      expect(result).not.toHaveProperty('sourceLang');
      expect(result).not.toHaveProperty('formality');
      expect(result).not.toHaveProperty('context');
    });

    it('should include context when provided', () => {
      const result = buildTranslationOptions({
        to: 'fr',
        context: 'medical document',
      });
      expect(result.context).toBe('medical document');
    });

    it('should not include glossaryId (resolved separately)', () => {
      const result = buildTranslationOptions({
        to: 'es',
        glossary: 'my-glossary',
      });
      expect(result).not.toHaveProperty('glossaryId');
    });

    it('should include preserveFormatting when explicitly set', () => {
      const result = buildTranslationOptions({
        to: 'es',
        preserveFormatting: true,
      });
      expect(result.preserveFormatting).toBe(true);
    });

    it('should include showBilledCharacters when set', () => {
      const result = buildTranslationOptions({
        to: 'es',
        showBilledCharacters: true,
      });
      expect(result.showBilledCharacters).toBe(true);
    });

    it('should include splitSentences when provided', () => {
      const result = buildTranslationOptions({
        to: 'es',
        splitSentences: 'nonewlines',
      });
      expect(result.splitSentences).toBe('nonewlines');
    });

    it('should include tagHandling when provided', () => {
      const result = buildTranslationOptions({
        to: 'es',
        tagHandling: 'html',
      });
      expect(result.tagHandling).toBe('html');
    });

    it('should include modelType when provided', () => {
      const result = buildTranslationOptions({
        to: 'es',
        modelType: 'quality_optimized',
      });
      expect(result.modelType).toBe('quality_optimized');
    });
  });

  describe('unicode and multibyte text handling', () => {
    it('should translate CJK Chinese text', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hello world',
        detectedSourceLang: 'zh',
      });

      const result = await translateCommand.translateText('你好世界', {
        to: 'en',
      });

      expect(result).toBe('Hello world');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '你好世界',
        { targetLang: 'en' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should translate CJK Japanese text', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hello',
        detectedSourceLang: 'ja',
      });

      const result = await translateCommand.translateText('こんにちは', {
        to: 'en',
      });

      expect(result).toBe('Hello');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'こんにちは',
        { targetLang: 'en' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should translate CJK Korean text', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hello',
        detectedSourceLang: 'ko',
      });

      const result = await translateCommand.translateText('안녕하세요', {
        to: 'en',
      });

      expect(result).toBe('Hello');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        '안녕하세요',
        { targetLang: 'en' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should translate Arabic/RTL text', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hello world',
        detectedSourceLang: 'ar',
      });

      const result = await translateCommand.translateText('مرحبا بالعالم', {
        to: 'en',
      });

      expect(result).toBe('Hello world');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'مرحبا بالعالم',
        { targetLang: 'en' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should handle text with emoji', async () => {
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola 🌍🎉',
      });

      const result = await translateCommand.translateText('Hello 🌍🎉', {
        to: 'es',
      });

      expect(result).toBe('Hola 🌍🎉');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        'Hello 🌍🎉',
        { targetLang: 'es' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should handle multi-codepoint emoji (family ZWJ sequence)', async () => {
      const familyEmoji = '👨‍👩‍👧‍👦';
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: `${familyEmoji} familia`,
      });

      const result = await translateCommand.translateText(`${familyEmoji} family`, {
        to: 'es',
      });

      expect(result).toBe(`${familyEmoji} familia`);
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        `${familyEmoji} family`,
        { targetLang: 'es' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should handle combining characters (precomposed vs decomposed)', async () => {
      const precomposed = 'caf\u00e9'; // café with precomposed é
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: precomposed,
      });

      const result = await translateCommand.translateText(precomposed, {
        to: 'es',
      });

      expect(result).toBe(precomposed);
    });

    it('should handle decomposed combining characters', async () => {
      const decomposed = 'cafe\u0301'; // café with combining acute accent
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: decomposed,
      });

      const result = await translateCommand.translateText(decomposed, {
        to: 'es',
      });

      expect(result).toBe(decomposed);
    });

    it('should handle mixed scripts in a single string', async () => {
      const mixedText = 'Hello 你好 مرحبا 🌍';
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Translated mixed text',
      });

      const result = await translateCommand.translateText(mixedText, {
        to: 'es',
      });

      expect(result).toBe('Translated mixed text');
      expect(mockTranslationService.translate).toHaveBeenCalledWith(
        mixedText,
        { targetLang: 'es' },
        { preserveCode: undefined, skipCache: true }
      );
    });

    it('should handle surrogate pair characters (astral plane)', async () => {
      const astralChar = '\uD835\uDC00'; // U+1D400 Mathematical Bold Capital A (𝐀)
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: astralChar,
      });

      const result = await translateCommand.translateText(astralChar, {
        to: 'es',
      });

      expect(result).toBe(astralChar);
    });

    it('should handle zero-width joiners in text', async () => {
      const textWithZWJ = 'test\u200Dword';
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: textWithZWJ,
      });

      const result = await translateCommand.translateText(textWithZWJ, {
        to: 'es',
      });

      expect(result).toBe(textWithZWJ);
      expect(result).toContain('\u200D');
    });

    it('should translate CJK text to multiple targets', async () => {
      (mockTranslationService.translateToMultiple as jest.Mock).mockResolvedValueOnce([
        { targetLang: 'en', text: 'Hello world' },
        { targetLang: 'fr', text: 'Bonjour le monde' },
      ]);

      const result = await translateCommand.translateText('你好世界', {
        to: 'en,fr',
      });

      expect(result).toContain('Hello world');
      expect(result).toContain('Bonjour le monde');
    });
  });

  describe('--output - (stdout mode)', () => {
    let mockFs: any;
    let stdoutWriteSpy: jest.SpyInstance;

    beforeEach(() => {
      mockFs = jest.requireActual('fs');
      jest.spyOn(mockFs, 'existsSync').mockReturnValue(true);
      jest.spyOn(mockFs, 'readFileSync');
      jest.spyOn(mockFs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(mockFs, 'mkdirSync').mockImplementation(() => undefined);

      jest.spyOn(Logger, 'shouldShowSpinner').mockReturnValue(false);
      stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should write translated text to stdout when output is -', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 1024,
        isDirectory: () => false
      } as any);
      (safeReadFileSync as jest.Mock).mockReturnValue('Hello world');
      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);
      (mockTranslationService.translate as jest.Mock).mockResolvedValueOnce({
        text: 'Hola mundo',
      });

      const result = await (translateCommand as any).fileHandler.translateFile('/input.txt', {
        to: 'es',
        output: '-',
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith('Hola mundo');
      expect(result).toBe('');
      expect(atomicWriteFileSync).not.toHaveBeenCalled();
    });

    it('should reject --output - with multiple target languages', async () => {
      await expect(
        (translateCommand as any).fileHandler.translateFile('/input.txt', {
          to: 'es,fr,de',
          output: '-',
        })
      ).rejects.toThrow('Cannot use --output - with multiple target languages');
    });

    it('should reject --output - for document translation', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 200 * 1024,
        isDirectory: () => false
      } as any);
      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(true);

      await expect(
        (translateCommand as any).fileHandler.documentHandler.translateDocument('/input.pdf', {
          to: 'es',
          output: '-',
        })
      ).rejects.toThrow('Cannot stream binary document translation to stdout');
    });

    it('should reject --output - for structured file (JSON/YAML) translation', async () => {
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        size: 1024,
        isDirectory: () => false
      } as any);
      (safeReadFileSync as jest.Mock).mockReturnValue('{"key": "value"}');
      (mockDocumentTranslationService.isDocumentSupported as jest.Mock).mockReturnValue(false);

      await expect(
        (translateCommand as any).fileHandler.translateFile('/input.json', {
          to: 'es',
          output: '-',
        })
      ).rejects.toThrow('Cannot stream structured file');
    });
  });
});

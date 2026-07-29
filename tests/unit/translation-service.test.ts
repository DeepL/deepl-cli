/**
 * Tests for TranslationService
 */

 

import { TranslationService, MAX_TEXT_BYTES, MULTI_TARGET_CONCURRENCY } from '../../src/services/translation';
import { DeepLClient, TranslationResult } from '../../src/api/deepl-client';
import { ConfigService } from '../../src/storage/config';
import { CacheService } from '../../src/storage/cache';
import { Language } from '../../src/types';
import { createMockDeepLClient, createMockConfigService, createMockCacheService } from '../helpers/mock-factories';

// Mock dependencies
jest.mock('../../src/api/deepl-client');
jest.mock('../../src/storage/config');
jest.mock('../../src/storage/cache');

describe('TranslationService', () => {
  let translationService: TranslationService;
  let mockDeepLClient: jest.Mocked<DeepLClient>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockCacheService: jest.Mocked<CacheService>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockDeepLClient = createMockDeepLClient();

    mockConfigService = createMockConfigService({
      get: jest.fn().mockReturnValue({
        defaults: {
          sourceLang: undefined,
          targetLangs: [],
          formality: 'default',
          preserveFormatting: true,
        },
        cache: {
          enabled: true,
          maxSize: 1024 * 1024 * 1024,
          ttl: 30 * 24 * 60 * 60,
        },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
      }),
      getValue: jest.fn().mockReturnValue(true),
    });

    mockCacheService = createMockCacheService();

    translationService = new TranslationService(mockDeepLClient, mockConfigService, mockCacheService);
  });

  describe('initialization', () => {
    it('should create a TranslationService instance', () => {
      expect(translationService).toBeInstanceOf(TranslationService);
    });

  });

  describe('translate()', () => {
    it('should translate text using DeepLClient', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: 'en',
      });

      const result = await translationService.translate('Hello', {
        targetLang: 'es',
      });

      expect(result.text).toBe('Hola');
      expect(result.detectedSourceLang).toBe('en');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello', {
        targetLang: 'es',
        sourceLang: undefined,
        formality: 'default',
        preserveFormatting: true,
      });
    });

    it('should use defaults from config when not specified', async () => {
      mockConfigService.get.mockReturnValue({
        defaults: {
          sourceLang: 'en',
          targetLangs: ['es'],
          formality: 'more',
          preserveFormatting: true,
        },
        cache: {
          enabled: true,
          maxSize: 1024 * 1024 * 1024,
          ttl: 30 * 24 * 60 * 60,
        },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
        auth: {},
        output: { format: 'text', color: true, verbose: false },
        watch: { debounceMs: 500, autoCommit: false, pattern: '**/*' },

      });

      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      await translationService.translate('Hello', {
        targetLang: 'es',
      });

      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello', {
        targetLang: 'es',
        sourceLang: 'en',
        formality: 'more',
        preserveFormatting: true,
      });
    });

    it('should override defaults with explicit options', async () => {
      mockConfigService.get.mockReturnValue({
        defaults: {
          sourceLang: 'en',
          targetLangs: ['es'],
          formality: 'more',
          preserveFormatting: true,
        },
        cache: { enabled: true, maxSize: 1024 * 1024 * 1024, ttl: 30 * 24 * 60 * 60 },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
        auth: {},
        output: { format: 'text', color: true, verbose: false },
        watch: { debounceMs: 500, autoCommit: false, pattern: '**/*' },

      });

      mockDeepLClient.translate.mockResolvedValue({
        text: 'Salut',
      });

      await translationService.translate('Hello', {
        targetLang: 'fr',
        formality: 'less',
        preserveFormatting: false,
      });

      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello', {
        targetLang: 'fr',
        sourceLang: 'en',
        formality: 'less',
        preserveFormatting: false,
      });
    });

    it('should throw error for empty text', async () => {
      await expect(
        translationService.translate('', { targetLang: 'es' })
      ).rejects.toThrow('Text cannot be empty');
    });

    it('should throw error when no target language specified', async () => {
      await expect(
         
        translationService.translate('Hello', {} as any)
      ).rejects.toThrow('Target language is required');
    });

    it('should handle translation errors', async () => {
      mockDeepLClient.translate.mockRejectedValue(
        new Error('API error: Translation failed')
      );

      await expect(
        translationService.translate('Hello', { targetLang: 'es' })
      ).rejects.toThrow('API error: Translation failed');
    });

    it('should pass through all DeepL API options', async () => {
      mockDeepLClient.translate.mockResolvedValue({ text: 'Translated' });

      await translationService.translate('Hello', {
        targetLang: 'es',
        sourceLang: 'en',
        formality: 'more',
        glossaryId: 'glossary-123',
        preserveFormatting: true,
        context: 'API documentation',
        splitSentences: 'nonewlines',
        tagHandling: 'xml',
      });

      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello', {
        targetLang: 'es',
        sourceLang: 'en',
        formality: 'more',
        glossaryId: 'glossary-123',
        preserveFormatting: true,
        context: 'API documentation',
        splitSentences: 'nonewlines',
        tagHandling: 'xml',
      });
    });

    it('should pass enableBetaLanguages to DeepL client', async () => {
      mockDeepLClient.translate.mockResolvedValue({ text: 'Hola' });

      await translationService.translate('Hello', {
        targetLang: 'es',
        enableBetaLanguages: true,
      });

      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello', expect.objectContaining({
        enableBetaLanguages: true,
      }));
    });
  });

  describe('translateBatch()', () => {
    it('should translate multiple texts using batch API', async () => {
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Hola' },
        { text: 'Adiós' },
        { text: 'Gracias' },
      ]);

      const results = await translationService.translateBatch(
        ['Hello', 'Goodbye', 'Thanks'],
        { targetLang: 'es' }
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.text).toBe('Hola');
      expect(results[1]?.text).toBe('Adiós');
      expect(results[2]?.text).toBe('Gracias');
      expect(mockDeepLClient.translateBatch).toHaveBeenCalledTimes(1);
      expect(mockDeepLClient.translateBatch).toHaveBeenCalledWith(
        ['Hello', 'Goodbye', 'Thanks'],
        expect.objectContaining({ targetLang: 'es' })
      );
    });

    it('should use batch API for efficient translation (single API call)', async () => {
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Uno' },
        { text: 'Dos' },
        { text: 'Tres' },
      ]);

      await translationService.translateBatch(['One', 'Two', 'Three'], {
        targetLang: 'es',
      });

      // Should use batch API (1 call) instead of individual translate calls (3 calls)
      expect(mockDeepLClient.translateBatch).toHaveBeenCalledTimes(1);
      expect(mockDeepLClient.translate).not.toHaveBeenCalled();
    });

    it('should handle empty array', async () => {
      const results = await translationService.translateBatch([], {
        targetLang: 'es',
      });

      expect(results).toHaveLength(0);
      expect(mockDeepLClient.translateBatch).not.toHaveBeenCalled();
      expect(mockDeepLClient.translate).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      mockDeepLClient.translateBatch.mockRejectedValue(new Error('API error'));

      await expect(
        translationService.translateBatch(['Hello', 'Goodbye', 'Thanks'], {
          targetLang: 'es',
        })
      ).rejects.toThrow('API error');
    });

    it('should utilize cache for batch translations', async () => {
      // Cache hit for first text, miss for others
      mockCacheService.get
        .mockReturnValueOnce({ text: 'Hola (cached)' })
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);

      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Adiós' },
        { text: 'Gracias' },
      ]);

      const results = await translationService.translateBatch(
        ['Hello', 'Goodbye', 'Thanks'],
        { targetLang: 'es' }
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.text).toBe('Hola (cached)');
      expect(results[1]?.text).toBe('Adiós');
      expect(results[2]?.text).toBe('Gracias');
      // Should only translate uncached texts
      expect(mockDeepLClient.translateBatch).toHaveBeenCalledWith(
        ['Goodbye', 'Thanks'],
        expect.any(Object)
      );
    });

    it('should handle batch size limits (50 texts per batch)', async () => {
      // Create 100 UNIQUE texts to avoid deduplication
      const largeTextArray = Array(100).fill(0).map((_, i) => `test${i}`);
      mockDeepLClient.translateBatch
        .mockResolvedValueOnce(Array(50).fill(0).map((_, i) => ({ text: `traducido${i}` })))
        .mockResolvedValueOnce(Array(50).fill(0).map((_, i) => ({ text: `traducido${i + 50}` })));

      await translationService.translateBatch(largeTextArray, {
        targetLang: 'es',
      });

      // Should split into 2 batches of 50 (100 unique texts)
      expect(mockDeepLClient.translateBatch).toHaveBeenCalledTimes(2);
    });

    it('should correctly map results when first batch fails (CRITICAL BUG #3)', async () => {
      // This test demonstrates the critical index mismatch bug
      // Scenario: 100 texts, first batch (50 texts) fails, second batch (50 texts) succeeds
      const batch1Texts = Array(50).fill(0).map((_, i) => `Text${i}`);
      const batch2Texts = Array(50).fill(0).map((_, i) => `Text${i + 50}`);
      const allTexts = [...batch1Texts, ...batch2Texts];

      // First batch fails, second batch succeeds
      mockDeepLClient.translateBatch
        .mockRejectedValueOnce(new Error('API error for first batch'))
        .mockResolvedValueOnce(batch2Texts.map(t => ({ text: `${t}_translated` })));

      const results = await translationService.translateBatch(allTexts, {
        targetLang: 'es',
      });

      // Should return full array preserving positional correspondence
      expect(results).toHaveLength(100);

      // First batch failed — indices 0-49 should be null
      for (let i = 0; i < 50; i++) {
        expect(results[i]).toBeNull();
      }

      // Second batch succeeded — indices 50-99 have correct translations
      for (let i = 50; i < 100; i++) {
        expect(results[i]?.text).toBe(`Text${i}_translated`);
      }

      // Verify cache was populated with correct mappings
      const cacheSetCalls = mockCacheService.set.mock.calls;
      expect(cacheSetCalls.length).toBe(50); // 50 successful translations cached

      // Verify a specific text was cached correctly
      const text55CacheCall = cacheSetCalls.find(call => {
        const result = call[1] as TranslationResult;
        return result.text === 'Text55_translated';
      });
      expect(text55CacheCall).toBeDefined();
    });

    it('should handle partial batch failures correctly', async () => {
      // Test with 100 texts split into 2 batches (50 each)
      // Batch 1 succeeds, Batch 2 fails
      const batch1Texts = Array(50).fill(0).map((_, i) => `Text${i}`);
      const batch2Texts = Array(50).fill(0).map((_, i) => `Text${i + 50}`);
      const allTexts = [...batch1Texts, ...batch2Texts];

      mockDeepLClient.translateBatch
        .mockResolvedValueOnce(batch1Texts.map(t => ({ text: `${t}_translated` }))) // Batch 1 succeeds
        .mockRejectedValueOnce(new Error('API error for second batch')); // Batch 2 fails

      const results = await translationService.translateBatch(allTexts, {
        targetLang: 'es',
      });

      // Should return full array preserving positional correspondence
      expect(results).toHaveLength(100);

      // Verify correct translations for first batch (indices 0-49)
      for (let i = 0; i < 50; i++) {
        expect(results[i]?.text).toBe(`Text${i}_translated`);
      }

      // Second batch failed — indices 50-99 should be null/undefined
      for (let i = 50; i < 100; i++) {
        expect(results[i]).toBeNull();
      }
    });

    it('should handle duplicate texts correctly (BUG #2)', async () => {
      // This test demonstrates the duplicate text bug
      // When the same text appears multiple times, all occurrences should get translations
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Hola' },     // Translation for "Hello"
        { text: 'Mundo' },    // Translation for "World"
      ]);

      // Input has "Hello" twice - both should be translated
      const results = await translationService.translateBatch(
        ['Hello', 'Hello', 'World'],  // "Hello" appears twice
        { targetLang: 'es' }
      );

      // Should have 3 results (not 2!)
      expect(results).toHaveLength(3);

      // Both "Hello" instances should have translations
      expect(results[0]?.text).toBe('Hola');
      expect(results[1]?.text).toBe('Hola');  // Second "Hello" should also be translated
      expect(results[2]?.text).toBe('Mundo');

      // Verify API was called with deduplicated texts (only unique texts sent)
      expect(mockDeepLClient.translateBatch).toHaveBeenCalledWith(
        ['Hello', 'World'],  // Deduplicated!
        expect.any(Object)
      );
    });
  });

  describe('translateToMultiple()', () => {
    it('should translate text to multiple target languages', async () => {
      mockDeepLClient.translate
        .mockResolvedValueOnce({ text: 'Hola' })
        .mockResolvedValueOnce({ text: 'Bonjour' })
        .mockResolvedValueOnce({ text: 'Hallo' });

      const results = await translationService.translateToMultiple('Hello', [
        'es',
        'fr',
        'de',
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]?.targetLang).toBe('es');
      expect(results[0]?.text).toBe('Hola');
      expect(results[1]?.targetLang).toBe('fr');
      expect(results[1]?.text).toBe('Bonjour');
      expect(results[2]?.targetLang).toBe('de');
      expect(results[2]?.text).toBe('Hallo');
    });

    it('should translate concurrently up to the concurrency limit', async () => {
      const langs: Language[] = ['es', 'fr', 'de'];
      const resolvers: Array<(value: { text: string }) => void> = [];

      mockDeepLClient.translate.mockImplementation(
        () => new Promise<{ text: string }>((resolve) => {
          resolvers.push(resolve);
        })
      );

      const resultPromise = translationService.translateToMultiple('Hello', langs);

      // With 3 languages and concurrency limit of 5, all 3 should start immediately
      await new Promise(r => setTimeout(r, 10));
      expect(resolvers).toHaveLength(3);

      resolvers.forEach(r => r({ text: 'Translated' }));
      const results = await resultPromise;
      expect(results).toHaveLength(3);
    });

    it('should enforce concurrency limit when target languages exceed it', async () => {
      const langs = Array.from(
        { length: MULTI_TARGET_CONCURRENCY + 3 }, (_, i) => `lang${i}`
      ) as Language[];
      let inflight = 0;
      let maxInflight = 0;

      mockDeepLClient.translate.mockImplementation(
        () => {
          inflight++;
          maxInflight = Math.max(maxInflight, inflight);
          return new Promise<{ text: string }>((resolve) => {
            setTimeout(() => {
              inflight--;
              resolve({ text: 'Translated' });
            }, 5);
          });
        }
      );

      const results = await translationService.translateToMultiple('Hello', langs);

      expect(results).toHaveLength(langs.length);
      expect(maxInflight).toBeLessThanOrEqual(MULTI_TARGET_CONCURRENCY);
      expect(maxInflight).toBe(MULTI_TARGET_CONCURRENCY);
    });

    it('should process all items even when concurrency is limited', async () => {
      const count = MULTI_TARGET_CONCURRENCY * 3;
      const langs = Array.from(
        { length: count }, (_, i) => `lang${i}`
      ) as Language[];

      mockDeepLClient.translate.mockImplementation(
        (_text: string, opts: { targetLang: string }) =>
          Promise.resolve({ text: `translated-${opts.targetLang}` })
      );

      const results = await translationService.translateToMultiple('Hello', langs);

      expect(results).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        expect(results[i]?.targetLang).toBe(`lang${i}`);
        expect(results[i]?.text).toBe(`translated-lang${i}`);
      }
    });

    it('should pass through translation options', async () => {
      mockDeepLClient.translate.mockResolvedValue({ text: 'Translated' });

      await translationService.translateToMultiple('Hello', ['es', 'fr'], {
        formality: 'more',
        context: 'greeting',
      });

      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello', {
        targetLang: 'es',
        sourceLang: undefined,
        formality: 'more',
        preserveFormatting: true,
        context: 'greeting',
      });
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello', {
        targetLang: 'fr',
        sourceLang: undefined,
        formality: 'more',
        preserveFormatting: true,
        context: 'greeting',
      });
    });

    it('should throw error for empty target languages', async () => {
      await expect(
        translationService.translateToMultiple('Hello', [])
      ).rejects.toThrow('At least one target language is required');
    });
  });

  describe('preserveCodeBlocks()', () => {
    it('should preserve inline code blocks', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Usa __CODE_0__ para imprimir',
      });

      const result = await translationService.translate(
        'Use `console.log()` to print',
        { targetLang: 'es' },
        { preserveCode: true }
      );

      expect(result.text).toBe('Usa `console.log()` para imprimir');
    });

    it('should preserve multi-line code blocks', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Aquí hay un ejemplo:\n\n__CODE_0__\n\nEste código imprime Hola',
      });

      const result = await translationService.translate(
        'Here is an example:\n\n```\nconst x = 1;\nconsole.log(x);\n```\n\nThis code prints Hello',
        { targetLang: 'es' },
        { preserveCode: true }
      );

      expect(result.text).toContain('```\nconst x = 1;');
      expect(result.text).toContain('console.log(x);\n```');
    });

    it('should preserve multiple code blocks', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Usa __CODE_0__ o __CODE_1__ para imprimir',
      });

      const result = await translationService.translate(
        'Use `console.log()` or `print()` to print',
        { targetLang: 'es' },
        { preserveCode: true }
      );

      expect(result.text).toBe('Usa `console.log()` o `print()` para imprimir');
    });

    it('should not preserve code blocks when disabled', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Usa registro de consola para imprimir',
      });

      const result = await translationService.translate(
        'Use `console.log()` to print',
        { targetLang: 'es' },
        { preserveCode: false }
      );

      expect(result.text).toBe('Usa registro de consola para imprimir');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith(
        'Use `console.log()` to print',
        expect.any(Object)
      );
    });
  });

  describe('preserveVariables()', () => {
    it('should preserve curly brace variables', async () => {
      // Mock to echo back the translated text with placeholders intact
      mockDeepLClient.translate.mockImplementation((text) => Promise.resolve({
        text: text.replace('Hello', 'Hola'),
      }));

      const result = await translationService.translate('Hello {name}', {
        targetLang: 'es',
      });

      expect(result.text).toBe('Hola {name}');
    });

    it('should preserve dollar sign variables', async () => {
      mockDeepLClient.translate.mockImplementation((text) => Promise.resolve({
        text: text.replace('Hello', 'Hola'),
      }));

      const result = await translationService.translate('Hello ${name}', {
        targetLang: 'es',
      });

      expect(result.text).toBe('Hola ${name}');
    });

    it('should preserve printf-style variables', async () => {
      mockDeepLClient.translate.mockImplementation((text) => Promise.resolve({
        text: text.replace('Hello', 'Hola').replace('you are', 'tienes').replace('years old', 'años'),
      }));

      const result = await translationService.translate('Hello %s, you are %d years old', {
        targetLang: 'es',
      });

      expect(result.text).toBe('Hola %s, tienes %d años');
    });

    it('should preserve numbered placeholders', async () => {
      mockDeepLClient.translate.mockImplementation((text) => Promise.resolve({
        text: text.replace('Hello', 'Hola').replace('you are', 'tienes').replace('years old', 'años'),
      }));

      const result = await translationService.translate('Hello {0}, you are {1} years old', {
        targetLang: 'es',
      });

      expect(result.text).toBe('Hola {0}, tienes {1} años');
    });

    it('should preserve multiple variable types', async () => {
      mockDeepLClient.translate.mockImplementation((text) => Promise.resolve({
        text: text.replace('has', 'tiene').replace('and', 'y'),
      }));

      const result = await translationService.translate('{name} has ${count} and %s', {
        targetLang: 'es',
      });

      // Variables are preserved, though order may change based on translation
      expect(result.text).toContain('{name}');
      expect(result.text).toContain('${count}');
      expect(result.text).toContain('%s');
    });

    it('should preserve many variables efficiently (Issue #7)', async () => {
      // Test with many variables to ensure efficient placeholder generation
      const text = Array(100).fill(0).map((_, i) => `{var${i}}`).join(' ');

      mockDeepLClient.translate.mockImplementation((translatedText) => Promise.resolve({
        text: translatedText, // Echo back with placeholders
      }));

      const result = await translationService.translate(text, {
        targetLang: 'es',
      });

      // All variables should be preserved
      for (let i = 0; i < 100; i++) {
        expect(result.text).toContain(`{var${i}}`);
      }
    });

    it('should handle duplicate variable names correctly', async () => {
      mockDeepLClient.translate.mockImplementation((text) => Promise.resolve({
        text: text.replace('and', 'y'),
      }));

      const result = await translationService.translate('{name} and {name} and {name}', {
        targetLang: 'es',
      });

      // Should preserve all three {name} instances
      const nameCount = (result.text.match(/\{name\}/g) ?? []).length;
      expect(nameCount).toBe(3);
    });

    it('should generate unique placeholders for each variable instance', async () => {
      // Test that placeholders don't collide even with same variable names
      const text = '{x} {x} {x}'; // Three instances of {x}

      let receivedText = '';
      mockDeepLClient.translate.mockImplementation((text) => {
        receivedText = text;
        return Promise.resolve({ text });
      });

      await translationService.translate(text, { targetLang: 'es' });

      // Check that the text sent to API has three DIFFERENT placeholders
      // (even though the original had three identical variables)
      const placeholders = receivedText.match(/__VAR_\w+__/g) ?? [];
      expect(placeholders.length).toBe(3);

      // All placeholders should be unique (no collisions)
      const uniquePlaceholders = new Set(placeholders);
      expect(uniquePlaceholders.size).toBe(3);
    });
  });

  describe('getUsage()', () => {
    it('should return usage statistics from DeepLClient', async () => {
      mockDeepLClient.getUsage.mockResolvedValue({
        characterCount: 12345,
        characterLimit: 500000,
      });

      const usage = await translationService.getUsage();

      expect(usage.characterCount).toBe(12345);
      expect(usage.characterLimit).toBe(500000);
      expect(mockDeepLClient.getUsage).toHaveBeenCalled();
    });

    it('should calculate usage percentage', async () => {
      mockDeepLClient.getUsage.mockResolvedValue({
        characterCount: 250000,
        characterLimit: 500000,
      });

      const usage = await translationService.getUsage();

      expect(usage.percentageUsed).toBe(50);
    });

    it('should calculate remaining characters', async () => {
      mockDeepLClient.getUsage.mockResolvedValue({
        characterCount: 12345,
        characterLimit: 500000,
      });

      const usage = await translationService.getUsage();

      expect(usage.remaining).toBe(487655);
    });

    it('should handle usage API errors', async () => {
      mockDeepLClient.getUsage.mockRejectedValue(
        new Error('Authentication failed')
      );

      await expect(translationService.getUsage()).rejects.toThrow(
        'Authentication failed'
      );
    });
  });

  describe('getSupportedLanguages()', () => {
    it('should return supported source languages', async () => {
      mockDeepLClient.getSupportedLanguages.mockResolvedValue([
        { language: 'en', name: 'English' },
        { language: 'es', name: 'Spanish' },
      ]);

      const languages = await translationService.getSupportedLanguages('source');

      expect(languages).toHaveLength(2);
      expect(languages[0]?.language).toBe('en');
      expect(languages[0]?.name).toBe('English');
    });

    it('should return supported target languages', async () => {
      mockDeepLClient.getSupportedLanguages.mockResolvedValue([
        { language: 'es', name: 'Spanish' },
        { language: 'fr', name: 'French' },
      ]);

      const languages = await translationService.getSupportedLanguages('target');

      expect(languages).toHaveLength(2);
      expect(languages[0]?.language).toBe('es');
    });

    it('should cache supported languages', async () => {
      mockDeepLClient.getSupportedLanguages.mockResolvedValue([
        { language: 'en', name: 'English' },
      ]);

      await translationService.getSupportedLanguages('source');
      await translationService.getSupportedLanguages('source');

      // Should only call API once due to caching
      expect(mockDeepLClient.getSupportedLanguages).toHaveBeenCalledTimes(1);
    });
  });

  describe('input length validation', () => {
    it('should accept text within the byte limit', async () => {
      const text = 'a'.repeat(50000);
      mockDeepLClient.translate.mockResolvedValue({ text: 'a'.repeat(50000) });

      const result = await translationService.translate(text, { targetLang: 'es' });

      expect(result.text.length).toBe(50000);
      expect(mockDeepLClient.translate).toHaveBeenCalled();
    });

    it('should accept text exactly at the byte limit', async () => {
      const text = 'a'.repeat(MAX_TEXT_BYTES);
      mockDeepLClient.translate.mockResolvedValue({ text });

      const result = await translationService.translate(text, { targetLang: 'es' });

      expect(result.text).toBe(text);
    });

    it('should reject text exceeding the byte limit', async () => {
      const text = 'a'.repeat(MAX_TEXT_BYTES + 1);

      await expect(
        translationService.translate(text, { targetLang: 'es' })
      ).rejects.toThrow('Text too large');
    });

    it('should include byte count in the error message', async () => {
      const text = 'a'.repeat(MAX_TEXT_BYTES + 100);
      const expectedBytes = Buffer.byteLength(text, 'utf8');

      await expect(
        translationService.translate(text, { targetLang: 'es' })
      ).rejects.toThrow(`${expectedBytes} bytes exceeds the ${MAX_TEXT_BYTES} byte limit`);
    });

    it('should suggest splitting text in the error message', async () => {
      const text = 'a'.repeat(MAX_TEXT_BYTES + 1);

      await expect(
        translationService.translate(text, { targetLang: 'es' })
      ).rejects.toThrow('Split the text into smaller chunks or use file translation');
    });

    it('should measure multi-byte characters correctly', async () => {
      // Each CJK character is 3 bytes in UTF-8
      const cjkChar = '\u4e16'; // 3 bytes
      const charCount = Math.floor(MAX_TEXT_BYTES / 3);
      const textAtLimit = cjkChar.repeat(charCount);
      mockDeepLClient.translate.mockResolvedValue({ text: textAtLimit });

      const result = await translationService.translate(textAtLimit, { targetLang: 'en' });
      expect(result.text).toBe(textAtLimit);

      // One more character pushes it over
      const textOverLimit = cjkChar.repeat(charCount + 1);
      await expect(
        translationService.translate(textOverLimit, { targetLang: 'en' })
      ).rejects.toThrow('Text too large');
    });

    it('should not call API when text exceeds the byte limit', async () => {
      const text = 'a'.repeat(MAX_TEXT_BYTES + 1);

      await expect(
        translationService.translate(text, { targetLang: 'es' })
      ).rejects.toThrow();

      expect(mockDeepLClient.translate).not.toHaveBeenCalled();
    });

    it('should reject individual texts exceeding limit in batch', async () => {
      const oversizedText = 'a'.repeat(MAX_TEXT_BYTES + 1);

      await expect(
        translationService.translateBatch(
          ['Hello', oversizedText, 'World'],
          { targetLang: 'es' }
        )
      ).rejects.toThrow('Text at index 1 too large');
    });

    it('should accept batch with large aggregate size — chunking handles splitting', async () => {
      // Each text is within the per-item limit; total exceeds 128KB but chunking handles it
      const halfLimit = Math.floor(MAX_TEXT_BYTES / 2) + 1;
      const text1 = 'a'.repeat(halfLimit);
      const text2 = 'b'.repeat(halfLimit);

      // Supply an explicit result so the assertion proves translation actually happened
      // rather than relying on a vacuous default.
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'A-translated' },
        { text: 'B-translated' },
      ]);

      const results = await translationService.translateBatch(
        [text1, text2],
        { targetLang: 'es' },
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.text).toBe('A-translated');
      expect(results[1]?.text).toBe('B-translated');
      expect(mockDeepLClient.translateBatch).toHaveBeenCalled();
    });

    it('should accept batch within the aggregate byte limit', async () => {
      const smallText1 = 'Hello';
      const smallText2 = 'World';
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Hola' },
        { text: 'Mundo' },
      ]);

      const results = await translationService.translateBatch(
        [smallText1, smallText2],
        { targetLang: 'es' }
      );

      expect(results).toHaveLength(2);
      expect(mockDeepLClient.translateBatch).toHaveBeenCalled();
    });

    it('should not call batch API when texts exceed the byte limit', async () => {
      const oversizedText = 'a'.repeat(MAX_TEXT_BYTES + 1);

      await expect(
        translationService.translateBatch([oversizedText], { targetLang: 'es' })
      ).rejects.toThrow();

      expect(mockDeepLClient.translateBatch).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle special characters', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: '¡Hola! ¿Cómo estás?',
      });

      const result = await translationService.translate('Hello! How are you?', {
        targetLang: 'es',
      });

      expect(result.text).toContain('¡');
      expect(result.text).toContain('¿');
    });

    it('should handle unicode characters', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: '你好世界 🌍',
      });

      const result = await translationService.translate('Hello world', {
        targetLang: 'zh',
      });

      expect(result.text).toContain('你好');
      expect(result.text).toContain('🌍');
    });

    it('should handle newlines and whitespace', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Línea 1\n\nLínea 2',
      });

      const result = await translationService.translate('Line 1\n\nLine 2', {
        targetLang: 'es',
      });

      expect(result.text).toContain('\n\n');
    });
  });

  describe('caching', () => {
    it('should cache translation results', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      // First call - should hit API
      await translationService.translate('Hello', { targetLang: 'es' });

      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(1);
      expect(mockCacheService.set).toHaveBeenCalledTimes(1);
    });

    it('should return cached result on second call', async () => {
      // Setup cache to return a hit
      mockCacheService.get.mockReturnValue({
        text: 'Hola (cached)',
      });

      const result = await translationService.translate('Hello', { targetLang: 'es' });

      expect(result.text).toBe('Hola (cached)');
      expect(mockDeepLClient.translate).not.toHaveBeenCalled();
      expect(mockCacheService.get).toHaveBeenCalled();
    });

    it('should flag cache hits with cached=true', async () => {
      mockCacheService.get.mockReturnValue({
        text: 'Hola (cached)',
      });

      const result = await translationService.translate('Hello', { targetLang: 'es' });

      expect(result.cached).toBe(true);
    });

    it('should flag fresh API translations with cached=false', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      const result = await translationService.translate('Hello', { targetLang: 'es' });

      expect(result.cached).toBe(false);
    });

    it('should not cache when cache is disabled', async () => {
      mockConfigService.getValue.mockReturnValue(false); // cache.enabled = false
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      await translationService.translate('Hello', { targetLang: 'es' });

      expect(mockCacheService.set).not.toHaveBeenCalled();
      expect(mockDeepLClient.translate).toHaveBeenCalled();
    });

    it('should generate different cache keys for different options', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      // Call with different options
      await translationService.translate('Hello', { targetLang: 'es' });
      await translationService.translate('Hello', { targetLang: 'fr' });

      // Should call API twice (different cache keys)
      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(2);
      expect(mockCacheService.set).toHaveBeenCalledTimes(2);
    });

    it('should use same cache key for same text and options', async () => {
      mockCacheService.get
        .mockReturnValueOnce(null) // First call: cache miss
        .mockReturnValueOnce({ text: 'Hola (cached)' }); // Second call: cache hit

      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      // First call
      await translationService.translate('Hello', { targetLang: 'es' });
      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(1);

      // Second call with same params
      const result2 = await translationService.translate('Hello', { targetLang: 'es' });
      expect(result2.text).toBe('Hola (cached)');
      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(1); // Still only 1 API call
    });

    it('should skip reading from cache when skipCache is true', async () => {
      // Setup cache to return a hit
      mockCacheService.get.mockReturnValue({
        text: 'Hola (cached)',
      });

      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola (fresh)',
      });

      const result = await translationService.translate(
        'Hello',
        { targetLang: 'es' },
        { skipCache: true }
      );

      expect(result.text).toBe('Hola (fresh)');
      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockDeepLClient.translate).toHaveBeenCalled();
    });

    it('should skip writing to cache when skipCache is true', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      await translationService.translate(
        'Hello',
        { targetLang: 'es' },
        { skipCache: true }
      );

      expect(mockCacheService.set).not.toHaveBeenCalled();
      expect(mockDeepLClient.translate).toHaveBeenCalled();
    });

    it('should bypass cache completely with skipCache flag', async () => {
      // Even with cache enabled and cache hit available
      mockConfigService.getValue.mockReturnValue(true); // cache enabled
      mockCacheService.get.mockReturnValue({ text: 'Hola (cached)' });

      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola (fresh from API)',
      });

      const result = await translationService.translate(
        'Hello',
        { targetLang: 'es' },
        { skipCache: true }
      );

      expect(result.text).toBe('Hola (fresh from API)');
      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(1);
    });

    it('should generate deterministic cache keys regardless of option order (BUG #1)', async () => {
      // This test demonstrates that cache keys must be deterministic
      // Two requests with identical options but different ordering should use the same cache key

      // Reset mocks to ensure clean state
      mockCacheService.get.mockReturnValue(null); // No cache hits
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
      });

      // First call with options in one order
      await translationService.translate('Hello', {
        targetLang: 'es',
        sourceLang: 'en',
        formality: 'more',
        glossaryId: 'glossary-123',
        context: 'greeting',
      });

      // Second call with identical options but different ordering
      await translationService.translate('Hello', {
        context: 'greeting',
        glossaryId: 'glossary-123',
        formality: 'more',
        sourceLang: 'en',
        targetLang: 'es',
      });

      // Verify the cache keys are the same by checking cache.set calls
      const cacheSetCalls = mockCacheService.set.mock.calls;
      expect(cacheSetCalls.length).toBe(2); // Two calls, should generate same key

      // Extract the cache keys (first parameter of each set call)
      const key1 = cacheSetCalls[0]?.[0] as string;
      const key2 = cacheSetCalls[1]?.[0] as string;

      // The cache keys MUST be identical despite different option ordering
      // This is critical for cache hit rate - identical requests should use the same key
      expect(key1).toBe(key2);
    });

    it('should use cached result when options are provided in different order', async () => {
      // Set up cache to return a hit for the second call
      let callCount = 0;
      mockCacheService.get.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return null; // First call: miss
        }
        return { text: 'Hola (cached)' }; // Second call: hit
      });

      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola (fresh)',
      });

      // First call
      const result1 = await translationService.translate('Hello', {
        targetLang: 'es',
        formality: 'more',
      });
      expect(result1.text).toBe('Hola (fresh)');
      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(1);

      // Second call with same options but different order
      const result2 = await translationService.translate('Hello', {
        formality: 'more',
        targetLang: 'es',
      });

      // Should use cached result
      expect(result2.text).toBe('Hola (cached)');
      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(1); // Still only 1 API call
    });
  });

  describe('unicode and multibyte text handling', () => {
    it('should translate CJK Chinese characters', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hello world',
        detectedSourceLang: 'zh',
      });

      const result = await translationService.translate('你好世界', {
        targetLang: 'en',
      });

      expect(result.text).toBe('Hello world');
      expect(result.detectedSourceLang).toBe('zh');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('你好世界', expect.objectContaining({
        targetLang: 'en',
      }));
    });

    it('should translate CJK Japanese characters', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hello',
        detectedSourceLang: 'ja',
      });

      const result = await translationService.translate('こんにちは', {
        targetLang: 'en',
      });

      expect(result.text).toBe('Hello');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('こんにちは', expect.objectContaining({
        targetLang: 'en',
      }));
    });

    it('should translate CJK Korean characters', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hello',
        detectedSourceLang: 'ko',
      });

      const result = await translationService.translate('안녕하세요', {
        targetLang: 'en',
      });

      expect(result.text).toBe('Hello');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('안녕하세요', expect.objectContaining({
        targetLang: 'en',
      }));
    });

    it('should translate Arabic/RTL text', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hello world',
        detectedSourceLang: 'ar',
      });

      const result = await translationService.translate('مرحبا بالعالم', {
        targetLang: 'en',
      });

      expect(result.text).toBe('Hello world');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('مرحبا بالعالم', expect.objectContaining({
        targetLang: 'en',
      }));
    });

    it('should handle text with emoji', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola 🌍🎉',
      });

      const result = await translationService.translate('Hello 🌍🎉', {
        targetLang: 'es',
      });

      expect(result.text).toBe('Hola 🌍🎉');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('Hello 🌍🎉', expect.objectContaining({
        targetLang: 'es',
      }));
    });

    it('should handle multi-codepoint emoji (family ZWJ sequence)', async () => {
      const familyEmoji = '👨‍👩‍👧‍👦';
      mockDeepLClient.translate.mockResolvedValue({
        text: `${familyEmoji} familia`,
      });

      const result = await translationService.translate(`${familyEmoji} family`, {
        targetLang: 'es',
      });

      expect(result.text).toBe(`${familyEmoji} familia`);
      expect(mockDeepLClient.translate).toHaveBeenCalledWith(`${familyEmoji} family`, expect.objectContaining({
        targetLang: 'es',
      }));
    });

    it('should handle combining characters (precomposed)', async () => {
      const precomposed = 'caf\u00e9'; // café with precomposed é (U+00E9)
      mockDeepLClient.translate.mockResolvedValue({
        text: precomposed,
      });

      const result = await translationService.translate(precomposed, {
        targetLang: 'es',
      });

      expect(result.text).toBe(precomposed);
      expect(mockDeepLClient.translate).toHaveBeenCalledWith(precomposed, expect.objectContaining({
        targetLang: 'es',
      }));
    });

    it('should handle combining characters (decomposed)', async () => {
      const decomposed = 'cafe\u0301'; // café with combining acute accent (e + U+0301)
      mockDeepLClient.translate.mockResolvedValue({
        text: decomposed,
      });

      const result = await translationService.translate(decomposed, {
        targetLang: 'es',
      });

      expect(result.text).toBe(decomposed);
      expect(mockDeepLClient.translate).toHaveBeenCalledWith(decomposed, expect.objectContaining({
        targetLang: 'es',
      }));
    });

    it('should handle mixed scripts in a single string', async () => {
      const mixedText = 'Hello 你好 مرحبا 🌍';
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Translated mixed text',
      });

      const result = await translationService.translate(mixedText, {
        targetLang: 'es',
      });

      expect(result.text).toBe('Translated mixed text');
      expect(mockDeepLClient.translate).toHaveBeenCalledWith(mixedText, expect.objectContaining({
        targetLang: 'es',
      }));
    });

    it('should handle surrogate pair characters (astral plane)', async () => {
      const astralChar = '\uD835\uDC00'; // U+1D400 Mathematical Bold Capital A (𝐀)
      mockDeepLClient.translate.mockResolvedValue({
        text: astralChar,
      });

      const result = await translationService.translate(astralChar, {
        targetLang: 'es',
      });

      expect(result.text).toBe(astralChar);
      expect(mockDeepLClient.translate).toHaveBeenCalledWith(astralChar, expect.objectContaining({
        targetLang: 'es',
      }));
    });

    it('should handle zero-width joiners in text', async () => {
      const textWithZWJ = 'test\u200Dword'; // zero-width joiner between test and word
      mockDeepLClient.translate.mockResolvedValue({
        text: textWithZWJ,
      });

      const result = await translationService.translate(textWithZWJ, {
        targetLang: 'es',
      });

      expect(result.text).toBe(textWithZWJ);
      expect(result.text).toContain('\u200D');
    });

    it('should handle text with zero-width non-joiner', async () => {
      const textWithZWNJ = 'test\u200Cword'; // zero-width non-joiner
      mockDeepLClient.translate.mockResolvedValue({
        text: textWithZWNJ,
      });

      const result = await translationService.translate(textWithZWNJ, {
        targetLang: 'es',
      });

      expect(result.text).toBe(textWithZWNJ);
      expect(result.text).toContain('\u200C');
    });

    it('should correctly pass CJK text through batch translation', async () => {
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Hello world' },
        { text: 'Hello' },
        { text: 'Hello' },
      ]);

      const results = await translationService.translateBatch(
        ['你好世界', 'こんにちは', '안녕하세요'],
        { targetLang: 'en' }
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.text).toBe('Hello world');
      expect(results[1]?.text).toBe('Hello');
      expect(results[2]?.text).toBe('Hello');
      expect(mockDeepLClient.translateBatch).toHaveBeenCalledWith(
        ['你好世界', 'こんにちは', '안녕하세요'],
        expect.objectContaining({ targetLang: 'en' })
      );
    });

    it('should correctly measure byte length of multibyte characters for validation', async () => {
      // CJK characters are 3 bytes each in UTF-8
      // 4-byte emoji should also be counted correctly
      const cjkText = '你'; // 3 bytes
      const emoji = '🌍'; // 4 bytes

      mockDeepLClient.translate.mockResolvedValue({ text: 'translated' });

      // These should pass validation (well under limit)
      await translationService.translate(cjkText, { targetLang: 'en' });
      await translationService.translate(emoji, { targetLang: 'en' });

      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(2);
    });

    it('should preserve variables in CJK text', async () => {
      mockDeepLClient.translate.mockImplementation((text) => Promise.resolve({
        text: text.replace('こんにちは', 'Hola'),
      }));

      const result = await translationService.translate('こんにちは {name}', {
        targetLang: 'es',
      });

      expect(result.text).toContain('{name}');
    });

    it('should handle emoji in batch with other unicode text', async () => {
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Hola 🌍🎉' },
        { text: '👨‍👩‍👧‍👦 familia' },
      ]);

      const results = await translationService.translateBatch(
        ['Hello 🌍🎉', '👨‍👩‍👧‍👦 family'],
        { targetLang: 'es' }
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.text).toBe('Hola 🌍🎉');
      expect(results[1]?.text).toBe('👨‍👩‍👧‍👦 familia');
    });

    it('should cache unicode text with correct keys', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hello',
      });

      await translationService.translate('你好', { targetLang: 'en' });

      expect(mockCacheService.set).toHaveBeenCalledTimes(1);
      expect(mockDeepLClient.translate).toHaveBeenCalledWith('你好', expect.objectContaining({
        targetLang: 'en',
      }));
    });
  });

  describe('without a cache backend', () => {
    let cachelessService: TranslationService;

    beforeEach(() => {
      cachelessService = new TranslationService(mockDeepLClient, mockConfigService);
    });

    it('should translate even though cache.enabled is true in config', async () => {
      mockDeepLClient.translate.mockResolvedValue({
        text: 'Hola',
        detectedSourceLang: 'en',
      });

      const result = await cachelessService.translate('Hello', { targetLang: 'es' });

      expect(result.text).toBe('Hola');
      expect(mockDeepLClient.translate).toHaveBeenCalledTimes(1);
    });

    it('should batch translate without a cache', async () => {
      mockDeepLClient.translateBatch.mockResolvedValue([
        { text: 'Hola' },
        { text: 'Mundo' },
      ]);

      const results = await cachelessService.translateBatch(['Hello', 'World'], { targetLang: 'es' });

      expect(results).toHaveLength(2);
      expect(results[0]?.text).toBe('Hola');
    });
  });

});

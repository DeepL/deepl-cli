/**
 * Tests for WriteService
 */

import { WriteService } from '../../src/services/write.js';
import { DeepLClient } from '../../src/api/deepl-client.js';
import { ConfigService } from '../../src/storage/config.js';
import { CacheService } from '../../src/storage/cache.js';
import { WriteImprovement } from '../../src/types/index.js';
import { createMockDeepLClient, createMockConfigService, createMockCacheService } from '../helpers/mock-factories';

describe('WriteService', () => {
  let writeService: WriteService;
  let mockClient: jest.Mocked<DeepLClient>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockCacheService: jest.Mocked<CacheService>;

  beforeEach(() => {
    mockClient = createMockDeepLClient();

    mockConfigService = createMockConfigService({
      getValue: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({ defaults: {} }),
    });

    mockCacheService = createMockCacheService();

    writeService = new WriteService(mockClient, mockConfigService, mockCacheService);
  });

  describe('initialization', () => {
    it('should create a WriteService instance', () => {
      expect(writeService).toBeInstanceOf(WriteService);
    });

    it('should throw error if client is not provided', () => {
      expect(() => {
        new WriteService(null as unknown as DeepLClient, mockConfigService, mockCacheService);
      }).toThrow('DeepL client is required');
    });

    it('should throw error if config service is not provided', () => {
      expect(() => {
        new WriteService(mockClient, null as unknown as ConfigService, mockCacheService);
      }).toThrow('Config service is required');
    });
  });

  describe('improve()', () => {
    describe('basic functionality', () => {
      it('should improve text successfully', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'This is a well-written sentence.',
            targetLanguage: 'en-US',
            detectedSourceLanguage: 'en',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('This is a sentence.', {
          targetLang: 'en-US',
        });

        expect(result).toHaveLength(1);
        expect(result[0]?.text).toBe('This is a well-written sentence.');
        expect(mockClient.improveText).toHaveBeenCalledWith('This is a sentence.', {
          targetLang: 'en-US',
        });
      });

      it('should throw error for empty text', async () => {
        await expect(
          writeService.improve('', { targetLang: 'en-US' })
        ).rejects.toThrow('Text cannot be empty');
      });

      it('should throw error for whitespace-only text', async () => {
        await expect(
          writeService.improve('   ', { targetLang: 'en-US' })
        ).rejects.toThrow('Text cannot be empty');
      });

      it('should allow omitting target language for auto-detection', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'Improved text.',
            targetLanguage: 'en-US',
            detectedSourceLanguage: 'en',
          },
        ];
        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Test', {});

        expect(result).toHaveLength(1);
        expect(mockClient.improveText).toHaveBeenCalledWith('Test', {});
      });
    });

    describe('writing style parameter', () => {
      it('should apply simple writing style', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'This is easy to read.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('This is a sentence.', {
          targetLang: 'en-US',
          writingStyle: 'simple',
        });

        expect(result[0]?.text).toBe('This is easy to read.');
        expect(mockClient.improveText).toHaveBeenCalledWith('This is a sentence.', {
          targetLang: 'en-US',
          writingStyle: 'simple',
        });
      });

      it('should apply business writing style', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'We are pleased to inform you.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('We want to tell you.', {
          targetLang: 'en-US',
          writingStyle: 'business',
        });

        expect(result[0]?.text).toBe('We are pleased to inform you.');
      });

      it('should apply academic writing style', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'This study demonstrates the effectiveness of the method.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('This shows it works.', {
          targetLang: 'en-US',
          writingStyle: 'academic',
        });

        expect(result[0]?.text).toContain('demonstrates');
      });

      it('should apply casual writing style', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: "Hey, that's pretty cool!",
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('That is interesting.', {
          targetLang: 'en-US',
          writingStyle: 'casual',
        });

        expect(result[0]?.text).toContain('cool');
      });
    });

    describe('tone parameter', () => {
      it('should apply enthusiastic tone', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'This is absolutely fantastic!',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('This is good.', {
          targetLang: 'en-US',
          tone: 'enthusiastic',
        });

        expect(result[0]?.text).toContain('fantastic');
      });

      it('should apply friendly tone', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: "Hi there! Hope you're doing well.",
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Hello.', {
          targetLang: 'en-US',
          tone: 'friendly',
        });

        expect(result[0]?.text).toContain('Hi');
      });

      it('should apply confident tone', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'I am certain this will succeed.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('I think this will work.', {
          targetLang: 'en-US',
          tone: 'confident',
        });

        expect(result[0]?.text).toContain('certain');
      });

      it('should apply diplomatic tone', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'Perhaps we could consider an alternative approach.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Try something else.', {
          targetLang: 'en-US',
          tone: 'diplomatic',
        });

        expect(result[0]?.text).toContain('Perhaps');
      });
    });

    describe('parameter constraints', () => {
      it('should throw error when both --style and --tone are specified', async () => {
        await expect(
          writeService.improve('Test', {
            targetLang: 'en-US',
            writingStyle: 'business',
            tone: 'enthusiastic',
          })
        ).rejects.toThrow('Cannot specify both --style and --tone');
      });

      it('should work with only target language', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'Improved text.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Test text.', {
          targetLang: 'en-US',
        });

        expect(result[0]?.text).toBe('Improved text.');
      });
    });

    describe('error handling', () => {
      it('should propagate client errors', async () => {
        mockClient.improveText.mockRejectedValue(new Error('API error'));

        await expect(
          writeService.improve('Test', { targetLang: 'en-US' })
        ).rejects.toThrow('API error');
      });

      it('should handle authentication errors', async () => {
        mockClient.improveText.mockRejectedValue(
          new Error('Authentication failed: Invalid API key')
        );

        await expect(
          writeService.improve('Test', { targetLang: 'en-US' })
        ).rejects.toThrow('Authentication failed');
      });

      it('should handle quota exceeded errors', async () => {
        mockClient.improveText.mockRejectedValue(
          new Error('Quota exceeded: Character limit reached')
        );

        await expect(
          writeService.improve('Test', { targetLang: 'en-US' })
        ).rejects.toThrow('Quota exceeded');
      });

      it('should handle rate limit errors', async () => {
        mockClient.improveText.mockRejectedValue(
          new Error('Rate limit exceeded: Too many requests')
        );

        await expect(
          writeService.improve('Test', { targetLang: 'en-US' })
        ).rejects.toThrow('Rate limit exceeded');
      });
    });

    describe('edge cases', () => {
      it('should handle long text', async () => {
        const longText = 'This is a test sentence. '.repeat(100);
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'Improved long text. '.repeat(100),
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve(longText, {
          targetLang: 'en-US',
        });

        expect(result[0]?.text.length).toBeGreaterThan(0);
      });

      it('should handle special characters', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'This is a test: "quotes" & special chars!',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Test: quotes & chars', {
          targetLang: 'en-US',
        });

        expect(result[0]?.text).toContain('&');
        expect(result[0]?.text).toContain('"');
      });

      it('should handle newlines', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'First paragraph.\n\nSecond paragraph.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Para 1.\n\nPara 2.', {
          targetLang: 'en-US',
        });

        expect(result[0]?.text).toContain('\n\n');
      });

      it('should handle multiple improvements', async () => {
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'First improvement.',
            targetLanguage: 'en-US',
          },
          {
            text: 'Second improvement.',
            targetLanguage: 'en-US',
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Test', {
          targetLang: 'en-US',
        });

        expect(result).toHaveLength(2);
        expect(result[0]?.text).toBe('First improvement.');
        expect(result[1]?.text).toBe('Second improvement.');
      });
    });
  });

  describe('getBestImprovement()', () => {
    it('should return the first improvement', async () => {
      const mockImprovements: WriteImprovement[] = [
        {
          text: 'Best improvement.',
          targetLanguage: 'en-US',
        },
        {
          text: 'Alternative improvement.',
          targetLanguage: 'en-US',
        },
      ];

      mockClient.improveText.mockResolvedValue(mockImprovements);

      const result = await writeService.getBestImprovement('Test', {
        targetLang: 'en-US',
      });

      expect(result.text).toBe('Best improvement.');
    });

    it('should throw error if no improvements available', async () => {
      mockClient.improveText.mockResolvedValue([]);

      await expect(
        writeService.getBestImprovement('Test', { targetLang: 'en-US' })
      ).rejects.toThrow('No improvements available');
    });
  });

  describe('caching', () => {
    const mockImprovements: WriteImprovement[] = [
      {
        text: 'Improved text.',
        targetLanguage: 'en-US',
      },
    ];

    it('should cache results after API call', async () => {
      mockClient.improveText.mockResolvedValue(mockImprovements);

      await writeService.improve('Test', { targetLang: 'en-US' });

      expect(mockCacheService.set).toHaveBeenCalledTimes(1);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^write:/),
        mockImprovements
      );
    });

    it('should return cached result on hit without calling API', async () => {
      mockCacheService.get.mockReturnValue(mockImprovements);

      const result = await writeService.improve('Test', { targetLang: 'en-US' });

      expect(result).toEqual(mockImprovements);
      expect(mockClient.improveText).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should skip cache when disabled via config', async () => {
      mockConfigService.getValue.mockReturnValue(false);
      mockClient.improveText.mockResolvedValue(mockImprovements);

      await writeService.improve('Test', { targetLang: 'en-US' });

      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
      expect(mockClient.improveText).toHaveBeenCalled();
    });

    it('should skip cache when skipCache is true', async () => {
      mockClient.improveText.mockResolvedValue(mockImprovements);

      await writeService.improve('Test', { targetLang: 'en-US' }, { skipCache: true });

      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
      expect(mockClient.improveText).toHaveBeenCalled();
    });

    it('should produce different cache keys for different options', async () => {
      mockClient.improveText.mockResolvedValue(mockImprovements);

      await writeService.improve('Test', { targetLang: 'en-US', writingStyle: 'business' });
      await writeService.improve('Test', { targetLang: 'en-US', writingStyle: 'casual' });

      const key1 = mockCacheService.set.mock.calls[0]![0];
      const key2 = mockCacheService.set.mock.calls[1]![0];
      expect(key1).not.toBe(key2);
    });

    it('should produce same cache key for same options (deterministic)', async () => {
      mockClient.improveText.mockResolvedValue(mockImprovements);

      await writeService.improve('Test', { targetLang: 'en-US', writingStyle: 'business' });
      await writeService.improve('Test', { targetLang: 'en-US', writingStyle: 'business' });

      const key1 = mockCacheService.set.mock.calls[0]![0];
      const key2 = mockCacheService.set.mock.calls[1]![0];
      expect(key1).toBe(key2);
    });

    it('should benefit getBestImprovement from cache', async () => {
      mockCacheService.get.mockReturnValue(mockImprovements);

      const result = await writeService.getBestImprovement('Test', { targetLang: 'en-US' });

      expect(result.text).toBe('Improved text.');
      expect(mockClient.improveText).not.toHaveBeenCalled();
    });
  });

  describe('correct()', () => {
    const mockCorrections: WriteImprovement[] = [
      {
        text: 'This is a test.',
        targetLanguage: 'en-US',
        detectedSourceLanguage: 'en',
      },
    ];

    it('should correct text via client.correctText', async () => {
      mockClient.correctText.mockResolvedValue(mockCorrections);

      const result = await writeService.correct('This is an test.', { targetLang: 'en-US' });

      expect(result).toEqual(mockCorrections);
      expect(mockClient.correctText).toHaveBeenCalledWith('This is an test.', { targetLang: 'en-US' });
      expect(mockClient.improveText).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for empty text', async () => {
      await expect(writeService.correct('', {})).rejects.toThrow('Text cannot be empty');
      await expect(writeService.correct('   ', {})).rejects.toThrow('Text cannot be empty');
      expect(mockClient.correctText).not.toHaveBeenCalled();
    });

    it('should cache results under the correct: prefix', async () => {
      mockClient.correctText.mockResolvedValue(mockCorrections);

      await writeService.correct('Test', { targetLang: 'en-US' });

      expect(mockCacheService.set).toHaveBeenCalledTimes(1);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^correct:/),
        mockCorrections
      );
    });

    it('should return cached result on hit without calling API', async () => {
      mockCacheService.get.mockReturnValue(mockCorrections);

      const result = await writeService.correct('Test', { targetLang: 'en-US' });

      expect(result).toEqual(mockCorrections);
      expect(mockClient.correctText).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should skip cache when skipCache is true', async () => {
      mockClient.correctText.mockResolvedValue(mockCorrections);

      await writeService.correct('Test', { targetLang: 'en-US' }, { skipCache: true });

      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
      expect(mockClient.correctText).toHaveBeenCalled();
    });

    it('should never share a cache key with improve() for the same input', async () => {
      mockClient.correctText.mockResolvedValue(mockCorrections);
      mockClient.improveText.mockResolvedValue(mockCorrections);

      await writeService.correct('Test', { targetLang: 'en-US' });
      await writeService.improve('Test', { targetLang: 'en-US' });

      const correctKey = mockCacheService.set.mock.calls[0]![0];
      const writeKey = mockCacheService.set.mock.calls[1]![0];
      expect(correctKey).not.toBe(writeKey);
    });

    it('should produce deterministic cache keys', async () => {
      mockClient.correctText.mockResolvedValue(mockCorrections);

      await writeService.correct('Test', { targetLang: 'en-US' });
      await writeService.correct('Test', { targetLang: 'en-US' });

      const key1 = mockCacheService.set.mock.calls[0]![0];
      const key2 = mockCacheService.set.mock.calls[1]![0];
      expect(key1).toBe(key2);
    });
  });

  describe('getBestCorrection()', () => {
    it('should return the first correction', async () => {
      mockClient.correctText.mockResolvedValue([
        { text: 'First.', targetLanguage: 'en-US' },
        { text: 'Second.', targetLanguage: 'en-US' },
      ]);

      const result = await writeService.getBestCorrection('Test', { targetLang: 'en-US' });

      expect(result.text).toBe('First.');
    });

    it('should throw when no corrections are available', async () => {
      mockCacheService.get.mockReturnValue([]);
      mockClient.correctText.mockResolvedValue([]);

      await expect(
        writeService.getBestCorrection('Test', { targetLang: 'en-US' })
      ).rejects.toThrow('No improvements available');
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
        const mockImprovements: WriteImprovement[] = [
          {
            text: 'Improved text.',
            targetLanguage: lang,
          },
        ];

        mockClient.improveText.mockResolvedValue(mockImprovements);

        const result = await writeService.improve('Test', {
          targetLang: lang,
        });

        expect(result[0]?.targetLanguage).toBe(lang);
      }
    });
  });

  describe('without a cache backend', () => {
    it('should improve text even though cache.enabled is true in config', async () => {
      const cachelessService = new WriteService(mockClient, mockConfigService);
      const mockImprovements: WriteImprovement[] = [
        { text: 'Improved.', targetLanguage: 'en-US' },
      ];
      mockClient.improveText.mockResolvedValue(mockImprovements);

      const result = await cachelessService.improve('Test', { targetLang: 'en-US' });

      expect(result).toHaveLength(1);
      expect(mockClient.improveText).toHaveBeenCalledTimes(1);
    });
  });
});

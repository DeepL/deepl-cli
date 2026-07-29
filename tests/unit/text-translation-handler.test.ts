import { TextTranslationHandler } from '../../src/cli/commands/translate/text-translation-handler';
import type { HandlerContext, TranslateOptions } from '../../src/cli/commands/translate/types';
import { ValidationError, AuthError } from '../../src/utils/errors';
import {
  createMockTranslationService,
  createMockFileTranslationService,
  createMockDocumentTranslationService,
  createMockGlossaryService,
  createMockConfigService,
} from '../helpers/mock-factories';
import type { TranslationService } from '../../src/services/translation';
import type { FileTranslationService } from '../../src/services/file-translation';
import type { DocumentTranslationService } from '../../src/services/document-translation';
import type { GlossaryService } from '../../src/services/glossary';
import type { ConfigService } from '../../src/storage/config';
import type { BatchTranslationService } from '../../src/services/batch-translation';

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    verbose: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    shouldShowSpinner: jest.fn().mockReturnValue(false),
  },
}));

function createMockContext(overrides: {
  translationService?: jest.Mocked<TranslationService>;
  fileTranslationService?: jest.Mocked<FileTranslationService>;
  documentTranslationService?: jest.Mocked<DocumentTranslationService>;
  glossaryService?: jest.Mocked<GlossaryService>;
  config?: jest.Mocked<ConfigService>;
} = {}): { ctx: HandlerContext; mocks: {
  translationService: jest.Mocked<TranslationService>;
  fileTranslationService: jest.Mocked<FileTranslationService>;
  batchTranslationService: jest.Mocked<BatchTranslationService>;
  documentTranslationService: jest.Mocked<DocumentTranslationService>;
  glossaryService: jest.Mocked<GlossaryService>;
  config: jest.Mocked<ConfigService>;
}} {
  const translationService = overrides.translationService ?? createMockTranslationService({
    translate: jest.fn().mockResolvedValue({ text: 'translated', detectedSourceLang: 'en' }),
  });
  const fileTranslationService = overrides.fileTranslationService ?? createMockFileTranslationService();
  const batchTranslationService = {} as jest.Mocked<BatchTranslationService>;
  const documentTranslationService = overrides.documentTranslationService ?? createMockDocumentTranslationService();
  const glossaryService = overrides.glossaryService ?? createMockGlossaryService();
  const config = overrides.config ?? createMockConfigService({
    getValue: jest.fn((key: string) => {
      if (key === 'auth.apiKey') return 'test-api-key';
      return undefined;
    }),
  });

  const ctx: HandlerContext = {
    translationService,
    fileTranslationService,
    batchTranslationService,
    documentTranslationService,
    glossaryService,
    config,
  };

  return { ctx, mocks: { translationService, fileTranslationService, batchTranslationService, documentTranslationService, glossaryService, config } };
}

function defaultOptions(overrides: Partial<TranslateOptions> = {}): TranslateOptions {
  return { to: 'de', cache: true, ...overrides };
}

describe('TextTranslationHandler', () => {
  let handler: TextTranslationHandler;
  let mocks: ReturnType<typeof createMockContext>['mocks'];
  const origEnv = process.env['DEEPL_API_KEY'];

  beforeEach(() => {
    jest.clearAllMocks();

    const { Logger: MockLogger } = jest.requireMock('../../src/utils/logger');
    MockLogger.warn.mockImplementation(() => {});
    MockLogger.verbose.mockImplementation(() => {});

    const result = createMockContext();
    handler = new TextTranslationHandler(result.ctx);
    mocks = result.mocks;
    delete process.env['DEEPL_API_KEY'];
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env['DEEPL_API_KEY'] = origEnv;
    } else {
      delete process.env['DEEPL_API_KEY'];
    }
  });

  describe('translateText()', () => {
    it('should throw ValidationError for empty text', async () => {
      await expect(handler.translateText('', defaultOptions())).rejects.toThrow(ValidationError);
      await expect(handler.translateText('', defaultOptions())).rejects.toThrow('Text cannot be empty');
    });

    it('should throw ValidationError for whitespace-only text', async () => {
      await expect(handler.translateText('   ', defaultOptions())).rejects.toThrow(ValidationError);
    });

    it('should throw AuthError when no API key is configured', async () => {
      const { ctx } = createMockContext({
        config: createMockConfigService({
          getValue: jest.fn().mockReturnValue(undefined),
        }),
      });
      const h = new TextTranslationHandler(ctx);
      await expect(h.translateText('Hello', defaultOptions())).rejects.toThrow(AuthError);
    });

    it('should not throw AuthError when DEEPL_API_KEY env var is set', async () => {
      process.env['DEEPL_API_KEY'] = 'env-key';
      const { ctx } = createMockContext({
        config: createMockConfigService({
          getValue: jest.fn().mockReturnValue(undefined),
        }),
      });
      const h = new TextTranslationHandler(ctx);
      const result = await h.translateText('Hello', defaultOptions());
      expect(result).toBe('translated');
    });

    it('should call translate() and return result text for single target', async () => {
      const result = await handler.translateText('Hello', defaultOptions());
      expect(mocks.translationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ targetLang: 'de' }),
        expect.objectContaining({ skipCache: false })
      );
      expect(result).toBe('translated');
    });

    it('should call translateToMultiple() for comma-separated targets', async () => {
      mocks.translationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'de', text: 'Hallo' },
        { targetLang: 'fr', text: 'Bonjour' },
      ]);

      const result = await handler.translateText('Hello', defaultOptions({ to: 'de,fr' }));
      expect(mocks.translationService.translateToMultiple).toHaveBeenCalled();
      expect(result).toContain('[de]');
      expect(result).toContain('[fr]');
    });

    describe('custom instructions validation', () => {
      it('should throw ValidationError when >10 custom instructions', async () => {
        const instructions = Array.from({ length: 11 }, (_, i) => `instruction ${i}`);
        await expect(
          handler.translateText('Hello', defaultOptions({ customInstruction: instructions }))
        ).rejects.toThrow(ValidationError);
        await expect(
          handler.translateText('Hello', defaultOptions({ customInstruction: instructions }))
        ).rejects.toThrow('Maximum 10 custom instructions allowed');
      });

      it('should throw ValidationError when instruction exceeds 300 chars', async () => {
        const longInstruction = 'x'.repeat(301);
        await expect(
          handler.translateText('Hello', defaultOptions({ customInstruction: [longInstruction] }))
        ).rejects.toThrow(ValidationError);
        await expect(
          handler.translateText('Hello', defaultOptions({ customInstruction: [longInstruction] }))
        ).rejects.toThrow('character limit');
      });

      it('should throw ValidationError when custom instructions used with latency_optimized', async () => {
        await expect(
          handler.translateText('Hello', defaultOptions({ customInstruction: ['Be formal'], modelType: 'latency_optimized' }))
        ).rejects.toThrow(ValidationError);
        await expect(
          handler.translateText('Hello', defaultOptions({ customInstruction: ['Be formal'], modelType: 'latency_optimized' }))
        ).rejects.toThrow('cannot be used with latency_optimized');
      });
    });

    it('should throw ValidationError when styleId used with latency_optimized', async () => {
      await expect(
        handler.translateText('Hello', defaultOptions({ styleId: 'some-style', modelType: 'latency_optimized' }))
      ).rejects.toThrow(ValidationError);
      await expect(
        handler.translateText('Hello', defaultOptions({ styleId: 'some-style', modelType: 'latency_optimized' }))
      ).rejects.toThrow('Style ID cannot be used with latency_optimized');
    });

    describe('XML parameters without --tag-handling xml', () => {
      it('should throw ValidationError for --outline-detection without --tag-handling xml', async () => {
        await expect(
          handler.translateText('Hello', defaultOptions({ outlineDetection: 'true' }))
        ).rejects.toThrow(ValidationError);
        await expect(
          handler.translateText('Hello', defaultOptions({ outlineDetection: 'true' }))
        ).rejects.toThrow('require --tag-handling xml');
      });

      it('should throw ValidationError for --splitting-tags without --tag-handling xml', async () => {
        await expect(
          handler.translateText('Hello', defaultOptions({ splittingTags: 'p,div' }))
        ).rejects.toThrow(ValidationError);
      });

      it('should throw ValidationError for --non-splitting-tags without --tag-handling xml', async () => {
        await expect(
          handler.translateText('Hello', defaultOptions({ nonSplittingTags: 'span' }))
        ).rejects.toThrow(ValidationError);
      });

      it('should throw ValidationError for --ignore-tags without --tag-handling xml', async () => {
        await expect(
          handler.translateText('Hello', defaultOptions({ ignoreTags: 'code' }))
        ).rejects.toThrow(ValidationError);
      });
    });

    it('should throw ValidationError for invalid outlineDetection value', async () => {
      await expect(
        handler.translateText('Hello', defaultOptions({ outlineDetection: 'yes', tagHandling: 'xml' }))
      ).rejects.toThrow(ValidationError);
      await expect(
        handler.translateText('Hello', defaultOptions({ outlineDetection: 'yes', tagHandling: 'xml' }))
      ).rejects.toThrow('must be "true" or "false"');
    });

    describe('tagHandlingVersion validation', () => {
      it('should throw ValidationError without --tag-handling', async () => {
        await expect(
          handler.translateText('Hello', defaultOptions({ tagHandlingVersion: 'v1' }))
        ).rejects.toThrow(ValidationError);
        await expect(
          handler.translateText('Hello', defaultOptions({ tagHandlingVersion: 'v1' }))
        ).rejects.toThrow('requires --tag-handling to be set');
      });

      it('should throw ValidationError for invalid version value', async () => {
        await expect(
          handler.translateText('Hello', defaultOptions({ tagHandlingVersion: 'v3', tagHandling: 'xml' }))
        ).rejects.toThrow(ValidationError);
        await expect(
          handler.translateText('Hello', defaultOptions({ tagHandlingVersion: 'v3', tagHandling: 'xml' }))
        ).rejects.toThrow('must be "v1" or "v2"');
      });
    });

    it('should throw ValidationError for glossary without --from', async () => {
      mocks.glossaryService.resolveGlossaryId.mockResolvedValue('glossary-123');
      await expect(
        handler.translateText('Hello', defaultOptions({ glossary: 'my-glossary' }))
      ).rejects.toThrow(ValidationError);
      await expect(
        handler.translateText('Hello', defaultOptions({ glossary: 'my-glossary' }))
      ).rejects.toThrow('Source language (--from) is required');
    });

    describe('--translation-memory', () => {
      const TM_UUID = '11111111-2222-3333-4444-555555555555';

      it('throws ValidationError (exit 6) when --translation-memory used without --from', async () => {
        const err = await handler
          .translateText('Hello', defaultOptions({ translationMemory: 'my-tm' }))
          .catch(e => e);
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).exitCode).toBe(6);
        expect((err as Error).message).toContain('--from is required when using --translation-memory');
      });

      it('throws ValidationError (exit 6) when combined with latency_optimized', async () => {
        const err = await handler
          .translateText('Hello', defaultOptions({
            from: 'en', translationMemory: 'my-tm', modelType: 'latency_optimized',
          }))
          .catch(e => e);
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).exitCode).toBe(6);
        expect((err as Error).message).toContain('requires quality_optimized model type');
      });

      it('resolves TM name via listTranslationMemories and passes resolved UUID to translate()', async () => {
        mocks.translationService.listTranslationMemories.mockResolvedValue([
          { translation_memory_id: TM_UUID, name: 'my-tm', source_language: 'en', target_languages: ['de'] },
        ]);

        await handler.translateText('Hello', defaultOptions({
          from: 'en', translationMemory: 'my-tm',
        }));

        expect(mocks.translationService.listTranslationMemories).toHaveBeenCalledTimes(1);
        expect(mocks.translationService.translate).toHaveBeenCalledWith(
          'Hello',
          expect.objectContaining({
            targetLang: 'de',
            translationMemoryId: TM_UUID,
            modelType: 'quality_optimized',
          }),
          expect.any(Object)
        );
      });

      it('passes --tm-threshold through as translationMemoryThreshold', async () => {
        mocks.translationService.listTranslationMemories.mockResolvedValue([
          { translation_memory_id: TM_UUID, name: 'my-tm', source_language: 'en', target_languages: ['de'] },
        ]);

        await handler.translateText('Hello', defaultOptions({
          from: 'en', translationMemory: 'my-tm', tmThreshold: 85,
        }));

        expect(mocks.translationService.translate).toHaveBeenCalledWith(
          'Hello',
          expect.objectContaining({ translationMemoryThreshold: 85 }),
          expect.any(Object)
        );
      });

      it('UUID fast-path: does NOT call listTranslationMemories when a UUID is passed', async () => {
        await handler.translateText('Hello', defaultOptions({
          from: 'en', translationMemory: TM_UUID,
        }));

        expect(mocks.translationService.listTranslationMemories).not.toHaveBeenCalled();
        expect(mocks.translationService.translate).toHaveBeenCalledWith(
          'Hello',
          expect.objectContaining({ translationMemoryId: TM_UUID }),
          expect.any(Object)
        );
      });

      it('forces modelType=quality_optimized when --translation-memory set and no --model-type given', async () => {
        mocks.translationService.listTranslationMemories.mockResolvedValue([
          { translation_memory_id: TM_UUID, name: 'my-tm', source_language: 'en', target_languages: ['de'] },
        ]);

        await handler.translateText('Hello', defaultOptions({
          from: 'en', translationMemory: 'my-tm',
        }));

        expect(mocks.translationService.translate).toHaveBeenCalledWith(
          'Hello',
          expect.objectContaining({ modelType: 'quality_optimized' }),
          expect.any(Object)
        );
      });

      describe('multi-target', () => {
        it('lists translation memories exactly once regardless of target count', async () => {
          mocks.translationService.listTranslationMemories.mockResolvedValue([
            { translation_memory_id: TM_UUID, name: 'my-tm', source_language: 'en', target_languages: ['de'] },
          ]);
          mocks.translationService.translateToMultiple.mockResolvedValue([
            { targetLang: 'de', text: 'Hallo' },
            { targetLang: 'de', text: 'Hallo' },
            { targetLang: 'de', text: 'Hallo' },
          ]);

          await handler.translateText('Hello', defaultOptions({
            from: 'en', to: 'de,de,de', translationMemory: 'my-tm',
          }));

          expect(mocks.translationService.listTranslationMemories).toHaveBeenCalledTimes(1);
          expect(mocks.translationService.translateToMultiple).toHaveBeenCalledWith(
            'Hello',
            ['de', 'de', 'de'],
            expect.objectContaining({
              translationMemoryId: TM_UUID,
              modelType: 'quality_optimized',
            })
          );
        });

        it('does NOT warn about --translation-memory or --tm-threshold as ignored options', async () => {
          const { Logger } = jest.requireMock('../../src/utils/logger');
          mocks.translationService.listTranslationMemories.mockResolvedValue([
            { translation_memory_id: TM_UUID, name: 'my-tm', source_language: 'en', target_languages: ['de'] },
          ]);
          mocks.translationService.translateToMultiple.mockResolvedValue([
            { targetLang: 'de', text: 'Hallo' },
          ]);

          await handler.translateText('Hello', defaultOptions({
            from: 'en', to: 'de,de', translationMemory: 'my-tm', tmThreshold: 80,
          }));

          const warnCalls = (Logger.warn as jest.Mock).mock.calls.map(c => c[0] as string);
          expect(warnCalls.some(m => m.includes('--translation-memory'))).toBe(false);
          expect(warnCalls.some(m => m.includes('--tm-threshold'))).toBe(false);
        });

        it('throws ValidationError when --translation-memory used without --from in multi-target', async () => {
          const err = await handler
            .translateText('Hello', defaultOptions({ to: 'de,fr', translationMemory: 'my-tm' }))
            .catch(e => e);
          expect(err).toBeInstanceOf(ValidationError);
          expect((err as ValidationError).exitCode).toBe(6);
          expect((err as Error).message).toContain('--from is required when using --translation-memory');
        });
      });
    });

    describe('format output', () => {
      it('should return JSON string for format=json', async () => {
        const result = await handler.translateText('Hello', defaultOptions({ format: 'json' }));
        const parsed = JSON.parse(result);
        expect(parsed).toHaveProperty('text', 'translated');
      });

      it('should include cached=false in JSON output for fresh translations', async () => {
        mocks.translationService.translate.mockResolvedValue({
          text: 'translated',
          detectedSourceLang: 'en',
          cached: false,
        });

        const result = await handler.translateText('Hello', defaultOptions({ format: 'json' }));

        expect(JSON.parse(result).cached).toBe(false);
      });

      it('should include cached=true in JSON output for cache hits', async () => {
        mocks.translationService.translate.mockResolvedValue({
          text: 'translated',
          detectedSourceLang: 'en',
          cached: true,
        });

        const result = await handler.translateText('Hello', defaultOptions({ format: 'json' }));

        expect(JSON.parse(result).cached).toBe(true);
      });

      it('should default cached to false when the service omits the flag', async () => {
        const result = await handler.translateText('Hello', defaultOptions({ format: 'json' }));

        expect(JSON.parse(result).cached).toBe(false);
      });

      it('should return table for format=table with multi-target', async () => {
        const originalIsTTY = process.stdout.isTTY;
        Object.defineProperty(process.stdout, 'isTTY', {
          value: true,
          configurable: true,
          writable: true,
        });
        try {
          mocks.translationService.translateToMultiple.mockResolvedValue([
            { targetLang: 'de', text: 'Hallo' },
            { targetLang: 'fr', text: 'Bonjour' },
          ]);

          const result = await handler.translateText('Hello', defaultOptions({ to: 'de,fr', format: 'table' }));
          expect(result).toContain('DE');
          expect(result).toContain('FR');
        } finally {
          Object.defineProperty(process.stdout, 'isTTY', {
            value: originalIsTTY,
            configurable: true,
            writable: true,
          });
        }
      });

      it('should fall back to plain text for format=table when stdout is not a TTY', async () => {
        const originalIsTTY = process.stdout.isTTY;
        Object.defineProperty(process.stdout, 'isTTY', {
          value: false,
          configurable: true,
          writable: true,
        });
        try {
          mocks.translationService.translateToMultiple.mockResolvedValue([
            { targetLang: 'de', text: 'Hallo' },
            { targetLang: 'fr', text: 'Bonjour' },
          ]);

          const result = await handler.translateText('Hello', defaultOptions({ to: 'de,fr', format: 'table' }));
          expect(result).toBe('[de] Hallo\n[fr] Bonjour');
        } finally {
          Object.defineProperty(process.stdout, 'isTTY', {
            value: originalIsTTY,
            configurable: true,
            writable: true,
          });
        }
      });

      it('should append billed characters metadata when present', async () => {
        mocks.translationService.translate.mockResolvedValue({
          text: 'translated',
          detectedSourceLang: 'en',
          billedCharacters: 42,
        });

        const result = await handler.translateText('Hello', defaultOptions());
        expect(result).toContain('Billed characters: 42');
      });

      it('should append model type metadata when present', async () => {
        mocks.translationService.translate.mockResolvedValue({
          text: 'translated',
          detectedSourceLang: 'en',
          modelTypeUsed: 'quality_optimized',
        });

        const result = await handler.translateText('Hello', defaultOptions());
        expect(result).toContain('Model: quality_optimized');
      });
    });

    it('should call warnIgnoredOptions for multi-target translation', async () => {
      const { Logger } = jest.requireMock('../../src/utils/logger');
      mocks.translationService.translateToMultiple.mockResolvedValue([
        { targetLang: 'de', text: 'Hallo' },
      ]);

      await handler.translateText('Hello', defaultOptions({
        to: 'de,fr',
        splitSentences: 'on',
      }));

      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('multi-target'));
    });

    it('should lowercase target and source language codes', async () => {
      await handler.translateText('Hello', defaultOptions({ to: 'DE', from: 'EN' }));
      expect(mocks.translationService.translate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ targetLang: 'de', sourceLang: 'en' }),
        expect.any(Object)
      );
    });
  });
});

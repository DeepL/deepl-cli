import { Language } from '../../../types/index.js';
import { formatTranslationJson, formatMultiTranslationJson, formatMultiTranslationTable } from '../../../utils/formatters.js';
import { Logger } from '../../../utils/logger.js';
import { ValidationError, AuthError } from '../../../utils/errors.js';
import type { HandlerContext, TranslateOptions } from './types.js';
import {
  validateLanguageCodes,
  validateExtendedLanguageConstraints,
  validateXmlTags,
  warnIgnoredOptions,
  MAX_CUSTOM_INSTRUCTIONS,
  MAX_CUSTOM_INSTRUCTION_CHARS,
} from './translate-utils.js';
import { buildBaseTranslationOptions, applySharedTmAndGlossary } from './translation-options-factory.js';

export class TextTranslationHandler {
  constructor(public ctx: HandlerContext) {}

  async translateText(text: string, options: TranslateOptions): Promise<string> {
    if (options.to) {
      options.to = options.to.toLowerCase();
    }
    if (options.from) {
      options.from = options.from.toLowerCase();
    }

    if (!text || text.trim() === '') {
      throw new ValidationError(
        'Text cannot be empty',
        'Provide text to translate: deepl translate "Hello" --to es'
      );
    }

    const apiKey = this.ctx.config.getValue<string>('auth.apiKey');
    const envKey = process.env['DEEPL_API_KEY'];
    if (!apiKey && !envKey) {
      throw new AuthError('API key not set. Run: deepl auth set-key <your-api-key>');
    }

    if (options.to.includes(',')) {
      return this.translateToMultiple(text, options);
    }

    validateLanguageCodes([options.to]);
    validateExtendedLanguageConstraints(options.to, options);

    if (options.glossary && !options.from) {
      throw new ValidationError(
        'Source language (--from) is required when using a glossary',
        'Example: deepl translate --from en --to es --glossary my-glossary "Hello"'
      );
    }

    if (options.translationMemory) {
      if (!options.from) {
        throw new ValidationError(
          '--from is required when using --translation-memory',
          'Example: deepl translate --from en --to de --translation-memory my-tm "Hello"'
        );
      }
      if (options.modelType && options.modelType !== 'quality_optimized') {
        throw new ValidationError(
          '--translation-memory requires quality_optimized model type',
          'Remove --model-type or set --model-type quality_optimized'
        );
      }
    }

    const translationOptions = buildBaseTranslationOptions(options);
    await applySharedTmAndGlossary(translationOptions, options, {
      glossaryService: this.ctx.glossaryService,
      translationService: this.ctx.translationService,
      targets: [options.to as Language],
    });

    if (options.customInstruction && options.customInstruction.length > 0) {
      if (options.customInstruction.length > MAX_CUSTOM_INSTRUCTIONS) {
        throw new ValidationError(`Maximum ${MAX_CUSTOM_INSTRUCTIONS} custom instructions allowed`);
      }
      for (const instruction of options.customInstruction) {
        if (instruction.length > MAX_CUSTOM_INSTRUCTION_CHARS) {
          throw new ValidationError(`Custom instruction exceeds ${MAX_CUSTOM_INSTRUCTION_CHARS} character limit (${instruction.length} chars): "${instruction.substring(0, 50)}..."`);
        }
      }
      if (options.modelType === 'latency_optimized') {
        throw new ValidationError('Custom instructions cannot be used with latency_optimized model type');
      }
      translationOptions.customInstructions = options.customInstruction;
    }

    if (options.styleId) {
      if (options.modelType === 'latency_optimized') {
        throw new ValidationError('Style ID cannot be used with latency_optimized model type');
      }
      translationOptions.styleId = options.styleId;
    }

    if (options.outlineDetection !== undefined || options.splittingTags || options.nonSplittingTags || options.ignoreTags) {
      if (options.tagHandling !== 'xml') {
        throw new ValidationError('XML tag handling parameters (--outline-detection, --splitting-tags, --non-splitting-tags, --ignore-tags) require --tag-handling xml');
      }
    }

    if (options.outlineDetection !== undefined) {
      const boolValue = options.outlineDetection.toLowerCase();
      if (boolValue !== 'true' && boolValue !== 'false') {
        throw new ValidationError('--outline-detection must be "true" or "false"');
      }
      translationOptions.outlineDetection = boolValue === 'true';
    }

    if (options.splittingTags) {
      const tags = options.splittingTags.split(',').map(tag => tag.trim());
      validateXmlTags(tags, '--splitting-tags');
      translationOptions.splittingTags = tags;
    }

    if (options.nonSplittingTags) {
      const tags = options.nonSplittingTags.split(',').map(tag => tag.trim());
      validateXmlTags(tags, '--non-splitting-tags');
      translationOptions.nonSplittingTags = tags;
    }

    if (options.ignoreTags) {
      const tags = options.ignoreTags.split(',').map(tag => tag.trim());
      validateXmlTags(tags, '--ignore-tags');
      translationOptions.ignoreTags = tags;
    }

    if (options.tagHandlingVersion) {
      if (!options.tagHandling) {
        throw new ValidationError('--tag-handling-version requires --tag-handling to be set (xml or html)');
      }
      if (options.tagHandlingVersion !== 'v1' && options.tagHandlingVersion !== 'v2') {
        throw new ValidationError('--tag-handling-version must be "v1" or "v2"');
      }
      translationOptions.tagHandlingVersion = options.tagHandlingVersion;
    }

    if (options.enableBetaLanguages) {
      translationOptions.enableBetaLanguages = true;
    }

    const result = await this.ctx.translationService.translate(
      text,
      translationOptions,
      {
        preserveCode: options.preserveCode,
        skipCache: !options.cache
      }
    );

    if (result.detectedSourceLang) {
      Logger.verbose(`[verbose] Detected source language: ${result.detectedSourceLang}`);
    }
    if (result.modelTypeUsed) {
      Logger.verbose(`[verbose] Model type used: ${result.modelTypeUsed}`);
    }
    Logger.verbose(`[verbose] Character count: ${text.length}`);

    if (options.format === 'json') {
      return formatTranslationJson(result, options.to as Language, result.cached ?? false);
    }

    const metadata: string[] = [];
    if (result.billedCharacters !== undefined) {
      metadata.push(`Billed characters: ${result.billedCharacters.toLocaleString()}`);
    }
    if (result.modelTypeUsed) {
      metadata.push(`Model: ${result.modelTypeUsed}`);
    }
    if (metadata.length > 0) {
      return `${result.text}\n\n${metadata.join('\n')}`;
    }

    return result.text;
  }

  private async translateToMultiple(text: string, options: TranslateOptions): Promise<string> {
    const supported = new Set(['from', 'formality', 'context', 'glossary', 'translationMemory', 'tmThreshold', 'showBilledCharacters', 'customInstruction', 'styleId']);
    warnIgnoredOptions('multi-target', options, supported);

    const targetLangs = options.to.split(',').map(lang => lang.trim());
    validateLanguageCodes(targetLangs);
    validateExtendedLanguageConstraints(options.to, options);

    if (options.glossary && !options.from) {
      throw new ValidationError(
        'Source language (--from) is required when using a glossary',
        'Example: deepl translate --from en --to es --glossary my-glossary "Hello"'
      );
    }

    if (options.translationMemory) {
      if (!options.from) {
        throw new ValidationError(
          '--from is required when using --translation-memory',
          'Example: deepl translate --from en --to de --translation-memory my-tm "Hello"'
        );
      }
      if (options.modelType && options.modelType !== 'quality_optimized') {
        throw new ValidationError(
          '--translation-memory requires quality_optimized model type',
          'Remove --model-type or set --model-type quality_optimized'
        );
      }
    }

    const validTargetLangs = targetLangs as Language[];

    const { targetLang: _, ...translationOptions } = buildBaseTranslationOptions(options);

    await applySharedTmAndGlossary(translationOptions, options, {
      glossaryService: this.ctx.glossaryService,
      translationService: this.ctx.translationService,
      targets: validTargetLangs,
    });

    if (options.customInstruction && options.customInstruction.length > 0) {
      translationOptions.customInstructions = options.customInstruction;
    }

    if (options.styleId) {
      translationOptions.styleId = options.styleId;
    }

    const results = await this.ctx.translationService.translateToMultiple(
      text,
      validTargetLangs,
      { ...translationOptions, skipCache: !options.cache }
    );

    if (options.format === 'json') {
      return formatMultiTranslationJson(results);
    }

    if (options.format === 'table') {
      if (!process.stdout.isTTY) {
        Logger.warn('WARN  --format table is not supported in non-TTY output; falling back to plain text');
        return results
          .map(result => `[${result.targetLang}] ${result.text}`)
          .join('\n');
      }
      return formatMultiTranslationTable(results);
    }

    return results
      .map(result => `[${result.targetLang}] ${result.text}`)
      .join('\n');
  }
}

/**
 * Write Service
 * Business logic for text improvement operations using DeepL Write API
 */

import * as crypto from 'crypto';
import { DeepLClient } from '../api/deepl-client.js';
import { ConfigService } from '../storage/config.js';
import type { CacheService } from '../storage/cache.js';
import { WriteOptions, CorrectOptions, WriteImprovement, isWriteImprovementArray } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { ValidationError, ConfigError } from '../utils/errors.js';

export interface WriteServiceOptions {
  skipCache?: boolean;
}

export class WriteService {
  private client: DeepLClient;
  private config: ConfigService;
  // No cache means "run cacheless" — the CLI passes undefined when the
  // cache backend is unavailable (see cli/cache-loader.ts).
  private cache?: CacheService;

  constructor(client: DeepLClient, config: ConfigService, cache?: CacheService) {
    if (!client) {
      throw new ConfigError('DeepL client is required');
    }

    if (!config) {
      throw new ConfigError('Config service is required');
    }

    this.client = client;
    this.config = config;
    this.cache = cache;
  }

  /**
   * Improve text using DeepL Write API
   */
  async improve(
    text: string,
    options: WriteOptions,
    serviceOptions: WriteServiceOptions = {}
  ): Promise<WriteImprovement[]> {
    if (!text || text.trim() === '') {
      throw new ValidationError('Text cannot be empty');
    }

    if (options.writingStyle && options.tone) {
      throw new ValidationError('Cannot specify both --style and --tone in a single request');
    }

    return this.requestWithCache(
      this.generateCacheKey(text, options, 'write'),
      serviceOptions,
      () => this.client.improveText(text, options)
    );
  }

  /**
   * Correct spelling and grammar using DeepL Write API (no rewording)
   */
  async correct(
    text: string,
    options: CorrectOptions = {},
    serviceOptions: WriteServiceOptions = {}
  ): Promise<WriteImprovement[]> {
    if (!text || text.trim() === '') {
      throw new ValidationError('Text cannot be empty');
    }

    return this.requestWithCache(
      this.generateCacheKey(text, options, 'correct'),
      serviceOptions,
      () => this.client.correctText(text, options)
    );
  }

  /**
   * Get the best improvement (first one returned by API)
   */
  async getBestImprovement(
    text: string,
    options: WriteOptions,
    serviceOptions: WriteServiceOptions = {}
  ): Promise<WriteImprovement> {
    const improvements = await this.improve(text, options, serviceOptions);

    if (!improvements || improvements.length === 0) {
      throw new ValidationError('No improvements available');
    }

    return improvements[0]!;
  }

  /**
   * Get the best correction (first one returned by API)
   */
  async getBestCorrection(
    text: string,
    options: CorrectOptions = {},
    serviceOptions: WriteServiceOptions = {}
  ): Promise<WriteImprovement> {
    const improvements = await this.correct(text, options, serviceOptions);

    if (!improvements || improvements.length === 0) {
      throw new ValidationError('No improvements available');
    }

    return improvements[0]!;
  }

  private async requestWithCache(
    cacheKey: string,
    serviceOptions: WriteServiceOptions,
    call: () => Promise<WriteImprovement[]>
  ): Promise<WriteImprovement[]> {
    const cacheEnabled = this.config.getValue<boolean>('cache.enabled') ?? true;
    const shouldUseCache = cacheEnabled && !serviceOptions.skipCache;

    if (!cacheEnabled) {
      Logger.info('ℹ️  Cache is disabled');
    } else if (serviceOptions.skipCache) {
      Logger.info('ℹ️  Cache bypassed for this request (--no-cache)');
    }

    if (shouldUseCache) {
      const cachedResult = this.cache?.get(cacheKey, isWriteImprovementArray);
      if (cachedResult) {
        Logger.verbose('[verbose] Cache hit');
        return cachedResult;
      }
      Logger.verbose('[verbose] Cache miss');
    }

    const improvements = await call();

    if (shouldUseCache) {
      this.cache?.set(cacheKey, improvements);
    }

    return improvements;
  }

  /**
   * Generate cache key from text and options
   *
   * The text is hashed byte-exact, with no Unicode normalization: NFC and NFD
   * encodings of the same visible string produce distinct cache keys. This is
   * intentional — the API receives the un-normalized bytes, so the cache keys
   * on exactly what is sent.
   *
   * The prefix separates rephrase and correct results: the two endpoints
   * return different text for the same input, so their entries must never
   * satisfy each other's lookups.
   */
  private generateCacheKey(
    text: string,
    options: WriteOptions | CorrectOptions,
    prefix: 'write' | 'correct'
  ): string {
    const cacheData = {
      text,
      targetLang: options.targetLang,
      writingStyle: (options as WriteOptions).writingStyle,
      tone: (options as WriteOptions).tone,
    };

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(cacheData))
      .digest('hex');

    return `${prefix}:${hash}`;
  }
}

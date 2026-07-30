/**
 * Tests for DeepL API Client
 */

import nock from 'nock';
import { DeepLClient } from '../../src/api/deepl-client';
import { HttpClient, USER_AGENT } from '../../src/api/http-client';
import { Logger } from '../../src/utils/logger';

describe('DeepLClient', () => {
  let client: DeepLClient;
  const apiKey = 'test-api-key';
  const baseUrl = 'https://api-free.deepl.com';

  beforeEach(() => {
    jest.spyOn(HttpClient.prototype, 'sleep' as any).mockResolvedValue(undefined);
    client = new DeepLClient(apiKey);
    nock.cleanAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    nock.cleanAll();
  });

  afterAll(() => {
    client.destroy();
  });

  describe('initialization', () => {
    it('should create a DeepLClient instance', () => {
      expect(client).toBeInstanceOf(DeepLClient);
    });

    it('should use free API endpoint by default', async () => {
      const freeClient = new DeepLClient('test-key');
      nock('https://api-free.deepl.com')
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Hola' }] });
      const result = await freeClient.translate('Hello', { targetLang: 'es' });
      expect(result.text).toBe('Hola');
    });

    it('should use pro API endpoint when specified', async () => {
      const proClient = new DeepLClient('test-key', { usePro: true });
      nock('https://api.deepl.com')
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Hola' }] });
      const result = await proClient.translate('Hello', { targetLang: 'es' });
      expect(result.text).toBe('Hola');
    });

    it('should throw error for invalid API key', () => {
      expect(() => {
        new DeepLClient('');
      }).toThrow('API key is required');
    });

    it('should send User-Agent header with requests', async () => {
      const scope = nock(baseUrl, {
        reqheaders: { 'User-Agent': USER_AGENT },
      })
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Hola' }] });
      const result = await client.translate('Hello', { targetLang: 'es' });
      expect(result.text).toBe('Hola');
      scope.done();
    });

    it('should include cli version and node version in User-Agent', () => {
      expect(USER_AGENT).toMatch(/^deepl-cli\/\d+\.\d+\.\d+ node\/\d+\.\d+\.\d+$/);
    });
  });

  describe('translate()', () => {
    it('should translate text successfully', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
        });

      const result = await client.translate('Hello', {
        targetLang: 'es',
      });

      expect(result.text).toBe('Hola');
      expect(result.detectedSourceLang).toBe('en');
    });

    it('should include source language when specified', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.source_lang === 'EN';
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
        });

      await client.translate('Hello', {
        sourceLang: 'en',
        targetLang: 'es',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should handle formality parameter', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.formality === 'more';
        })
        .reply(200, {
          translations: [{ text: 'Buenos días' }],
        });

      const result = await client.translate('Good morning', {
        targetLang: 'es',
        formality: 'more',
      });

      expect(result.text).toBe('Buenos días');
    });

    it('should handle glossary parameter', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.glossary_id === 'glossary-123';
        })
        .reply(200, {
          translations: [{ text: 'API REST' }],
        });

      await client.translate('REST API', {
        targetLang: 'es',
        glossaryId: 'glossary-123',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should handle preserve_formatting option', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.preserve_formatting === '1';
        })
        .reply(200, {
          translations: [{ text: 'Hola\nmundo' }],
        });

      await client.translate('Hello\nworld', {
        targetLang: 'es',
        preserveFormatting: true,
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should handle context parameter', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.context === 'API documentation';
        })
        .reply(200, {
          translations: [{ text: 'Punto final' }],
        });

      await client.translate('Endpoint', {
        targetLang: 'es',
        context: 'API documentation',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should handle split_sentences parameter', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.split_sentences === 'nonewlines';
        })
        .reply(200, {
          translations: [{ text: 'Texto traducido' }],
        });

      await client.translate('Translated text', {
        targetLang: 'es',
        splitSentences: 'nonewlines',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should map split_sentences "on" to API value "1"', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.split_sentences === '1';
        })
        .reply(200, {
          translations: [{ text: 'Hallo' }],
        });

      await client.translate('Hello', {
        targetLang: 'de',
        splitSentences: 'on',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should map split_sentences "off" to API value "0"', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.split_sentences === '0';
        })
        .reply(200, {
          translations: [{ text: 'Hallo' }],
        });

      await client.translate('Hello', {
        targetLang: 'de',
        splitSentences: 'off',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should handle tag_handling parameter', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.tag_handling === 'xml';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'xml',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send show_billed_characters parameter when enabled', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.show_billed_characters === '1';
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
          billed_characters: 5,
        });

      await client.translate('Hello', {
        targetLang: 'es',
        showBilledCharacters: true,
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should parse billed_characters from response', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
          billed_characters: 5,
        });

      const result = await client.translate('Hello', {
        targetLang: 'es',
        showBilledCharacters: true,
      });

      expect(result.text).toBe('Hola');
      expect(result.billedCharacters).toBe(5);
    });

    it('should not send show_billed_characters when not requested', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.show_billed_characters === undefined;
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
        });

      await client.translate('Hello', {
        targetLang: 'es',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send enable_beta_languages parameter when enabled', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.enable_beta_languages === '1';
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
        });

      await client.translate('Hello', {
        targetLang: 'es',
        enableBetaLanguages: true,
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should not send enable_beta_languages when not requested', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.enable_beta_languages === undefined;
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
        });

      await client.translate('Hello', {
        targetLang: 'es',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send outline_detection parameter when set to true', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.outline_detection === '1';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'xml',
        outlineDetection: true,
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send outline_detection parameter when set to false', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.outline_detection === '0';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'xml',
        outlineDetection: false,
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send splitting_tags parameter as comma-separated string', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.splitting_tags === 'br,hr,div';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'xml',
        splittingTags: ['br', 'hr', 'div'],
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send non_splitting_tags parameter as comma-separated string', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.non_splitting_tags === 'code,pre,kbd';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'xml',
        nonSplittingTags: ['code', 'pre', 'kbd'],
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send ignore_tags parameter as comma-separated string', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.ignore_tags === 'script,style,noscript';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'xml',
        ignoreTags: ['script', 'style', 'noscript'],
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send all XML tag handling parameters together', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.outline_detection === '0' &&
             
            body.splitting_tags === 'br,hr' &&
             
            body.non_splitting_tags === 'code,pre' &&
             
            body.ignore_tags === 'script,style';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'xml',
        outlineDetection: false,
        splittingTags: ['br', 'hr'],
        nonSplittingTags: ['code', 'pre'],
        ignoreTags: ['script', 'style'],
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send custom_instructions parameter as array', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return Array.isArray(body.custom_instructions) &&
             
            body.custom_instructions.length === 2 &&
             
            body.custom_instructions[0] === 'Use informal tone' &&
             
            body.custom_instructions[1] === 'Preserve brand names';
        })
        .reply(200, {
          translations: [{ text: 'Hola mundo' }],
        });

      await client.translate('Hello world', {
        targetLang: 'es',
        customInstructions: ['Use informal tone', 'Preserve brand names'],
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should not send custom_instructions when not specified', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.custom_instructions === undefined;
        })
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', {
        targetLang: 'es',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should send custom_instructions in batch translation', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return Array.isArray(body.custom_instructions) &&
             
            body.custom_instructions[0] === 'Keep it short' &&
             
            body.custom_instructions[1] === 'Preserve names';
        })
        .reply(200, {
          translations: [
            { text: 'Hola' },
            { text: 'Mundo' },
          ],
        });

      await client.translateBatch(['Hello', 'World'], {
        targetLang: 'es',
        customInstructions: ['Keep it short', 'Preserve names'],
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should throw error for invalid target language', async () => {
      await expect(
         
        client.translate('Hello', { targetLang: 'invalid' as any })
      ).rejects.toThrow();
    });

  });

  describe('error handling', () => {
    const endpoints: Array<{
      name: string;
      path: string;
      call: (c: DeepLClient) => Promise<unknown>;
    }> = [
      {
        name: 'translate()',
        path: '/v2/translate',
        call: (c) => c.translate('Hello', { targetLang: 'es' }),
      },
      {
        name: 'improveText()',
        path: '/v2/write/rephrase',
        call: (c) => c.improveText('Test', { targetLang: 'en-US' }),
      },
    ];

    describe.each(endpoints)('$name', ({ path, call }) => {
      it('should handle 403 authentication error', async () => {
        nock(baseUrl)
          .post(path)
          .reply(403, { message: 'Authorization failed' });

        await expect(call(client)).rejects.toThrow('Authentication failed');
      });

      it('should handle 456 quota exceeded error', async () => {
        nock(baseUrl)
          .post(path)
          .reply(456, { message: 'Quota exceeded' });

        await expect(call(client)).rejects.toThrow('Quota exceeded');
      });

      it('should handle 429 rate limit error', async () => {
        nock(baseUrl)
          .post(path)
          .times(4)
          .reply(429, { message: 'Too many requests' });

        await expect(call(client)).rejects.toThrow('Rate limit exceeded');
      });

      it('should handle 503 service unavailable', async () => {
        nock(baseUrl)
          .post(path)
          .reply(503, { message: 'Service temporarily unavailable' });

        await expect(call(client)).rejects.toThrow('Service temporarily unavailable');
      });

      it('should handle network errors', async () => {
        nock(baseUrl)
          .post(path)
          .replyWithError('Network error');

        await expect(call(client)).rejects.toThrow();
      });
    });

    it('should throw classified AuthError for 403, not raw AxiosError', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(403, {
          message: 'Forbidden',
        });

      try {
        await client.translate('Hello', { targetLang: 'es' });
        fail('Expected error to be thrown');
      } catch (error) {
        expect((error as Error).name).toBe('AuthError');
      }
    });

    // Defense-in-depth: a malicious or buggy server could return a JSON body
    // whose `message` field contains ANSI escape sequences or other terminal
    // control characters. The HTTP client interpolates that field into
    // user-facing error strings (`API error: ${message}`, `Server error
    // (${status}): ${message}`); without sanitization, those bytes would
    // print verbatim to the user's terminal. Mirrors the TMS-client guard at
    // tests/unit/sync/tms-client.test.ts:253.
    it('should strip ANSI escape sequences from a 4xx server message before interpolating into the thrown error', async () => {
      const maliciousBody = { message: '\x1b[2J\x1b[0;0HCredentials stolen' };
      nock(baseUrl).post('/v2/translate').reply(400, maliciousBody);

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('\x1b') }),
      );
    });

    it('should strip ANSI escape sequences from a 5xx server message before interpolating into the thrown error', async () => {
      const maliciousBody = { message: '\x1b[31mInternal failure\x1b[0m' };
      nock(baseUrl).post('/v2/translate').reply(500, maliciousBody);

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('\x1b') }),
      );
    });

    it('should strip bidi override codepoints from a server message', async () => {
      const maliciousBody = { message: 'OK\u202EStolen' };
      nock(baseUrl).post('/v2/translate').reply(400, maliciousBody);

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('\u202E') }),
      );
    });

    it('should throw classified QuotaError for 456, not raw AxiosError', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(456, {
          message: 'Quota exceeded',
        });

      try {
        await client.translate('Hello', { targetLang: 'es' });
        fail('Expected error to be thrown');
      } catch (error) {
        expect((error as Error).name).toBe('QuotaError');
      }
    });

    it('should throw classified RateLimitError for 429, not raw AxiosError', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .times(4)
        .reply(429, {
          message: 'Too many requests',
        });

      try {
        await client.translate('Hello', { targetLang: 'es' });
        fail('Expected error to be thrown');
      } catch (error) {
        expect((error as Error).name).toBe('RateLimitError');
      }
    });

    it('should handle invalid JSON response', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, 'Invalid JSON');

      await expect(
        client.translate('Hello', { targetLang: 'es' })
      ).rejects.toThrow();
    });

    it('should handle missing translations in response', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {});

      await expect(
        client.translate('Hello', { targetLang: 'es' })
      ).rejects.toThrow('No translation returned from DeepL API');
    });
  });

  describe('getUsage()', () => {
    it('should return usage statistics', async () => {
      nock(baseUrl)
        .get('/v2/usage')
        .reply(200, {
          character_count: 12345,
          character_limit: 500000,
        });

      const usage = await client.getUsage();

      expect(usage.characterCount).toBe(12345);
      expect(usage.characterLimit).toBe(500000);
    });

    it('should handle usage API errors', async () => {
      nock(baseUrl)
        .get('/v2/usage')
        .reply(403);

      await expect(client.getUsage()).rejects.toThrow();
    });

    it('should parse speech-to-text milliseconds fields', async () => {
      nock(baseUrl)
        .get('/v2/usage')
        .reply(200, {
          character_count: 12345,
          character_limit: 500000,
          speech_to_text_milliseconds_count: 120000,
          speech_to_text_milliseconds_limit: 36000000,
        });

      const usage = await client.getUsage();

      expect(usage.characterCount).toBe(12345);
      expect(usage.speechToTextMillisecondsCount).toBe(120000);
      expect(usage.speechToTextMillisecondsLimit).toBe(36000000);
    });

    it('should parse products with billing_unit', async () => {
      nock(baseUrl)
        .get('/v2/usage')
        .reply(200, {
          character_count: 12345,
          character_limit: 500000,
          products: [
            { product_type: 'translate', character_count: 10000, api_key_character_count: 10000 },
            { product_type: 'speech_to_text', character_count: 120000, api_key_character_count: 120000, billing_unit: 'milliseconds' },
          ],
        });

      const usage = await client.getUsage();

      expect(usage.products).toHaveLength(2);
      const products = usage.products!;
      expect(products[0]!.billingUnit).toBeUndefined();
      expect(products[1]!.productType).toBe('speech_to_text');
      expect(products[1]!.billingUnit).toBe('milliseconds');
    });

    it('should omit speech-to-text fields when not present in response', async () => {
      nock(baseUrl)
        .get('/v2/usage')
        .reply(200, {
          character_count: 12345,
          character_limit: 500000,
        });

      const usage = await client.getUsage();

      expect(usage.speechToTextMillisecondsCount).toBeUndefined();
      expect(usage.speechToTextMillisecondsLimit).toBeUndefined();
    });
  });

  describe('getSupportedLanguages()', () => {
    it('should return supported source languages', async () => {
      nock(baseUrl)
        .get('/v2/languages')
        .query({ type: 'source' })
        .reply(200, [
          { language: 'EN', name: 'English' },
          { language: 'ES', name: 'Spanish' },
        ]);

      const languages = await client.getSupportedLanguages('source');

      expect(languages).toHaveLength(2);
      expect(languages[0]?.language).toBe('en');
      expect(languages[0]?.name).toBe('English');
    });

    it('should return supported target languages', async () => {
      nock(baseUrl)
        .get('/v2/languages')
        .query({ type: 'target' })
        .reply(200, [
          { language: 'ES', name: 'Spanish' },
          { language: 'FR', name: 'French' },
        ]);

      const languages = await client.getSupportedLanguages('target');

      expect(languages).toHaveLength(2);
      expect(languages[0]?.language).toBe('es');
    });

    it('should handle language API errors', async () => {
      nock(baseUrl)
        .get('/v2/languages')
        .query({ type: 'source' })
        .reply(500);

      await expect(
        client.getSupportedLanguages('source')
      ).rejects.toThrow();
    });
  });

  describe('retry logic', () => {
    it('should retry an idempotent request on transient failures', async () => {
      nock(baseUrl)
        .get('/v2/usage')
        .reply(503)
        .get('/v2/usage')
        .reply(503)
        .get('/v2/usage')
        .reply(200, { character_count: 1, character_limit: 2 });

      const usage = await client.getUsage();

      expect(usage.characterCount).toBe(1);
    });

    it('should not replay a translate request on transient failures', async () => {
      const scope = nock(baseUrl).post('/v2/translate').reply(503);

      await expect(
        client.translate('Hello', { targetLang: 'es' })
      ).rejects.toThrow('Service temporarily unavailable');

      expect(scope.isDone()).toBe(true);
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should give up after max retries', async () => {
      nock(baseUrl)
        .get('/v2/usage')
        .times(4)
        .reply(503);

      await expect(client.getUsage()).rejects.toThrow();
    });

    it('should not retry on 4xx errors', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(400, { message: 'Bad request' });

      await expect(
        client.translate('Hello', { targetLang: 'es' })
      ).rejects.toThrow();

      expect(nock.isDone()).toBe(true);
    });
  });

  describe('rate limiting', () => {
    it('should respect rate limits', async () => {
      const requests: number[] = [];

      nock(baseUrl)
        .post('/v2/translate')
        .times(5)
        .reply(200, () => {
          requests.push(Date.now());
          return { translations: [{ text: 'Hola' }] };
        });

      const promises = Array(5)
        .fill(null)
        .map(() => client.translate('Hello', { targetLang: 'es' }));

      await Promise.all(promises);

      expect(requests).toHaveLength(5);
    });
  });

  describe('edge cases', () => {
    it('should handle very long text', async () => {
      const longText = 'a'.repeat(50000);

      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: 'a'.repeat(50000) }],
        });

      const result = await client.translate(longText, { targetLang: 'es' });

      expect(result.text.length).toBe(50000);
    });

    it('should handle special characters', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: '¡Hola! ¿Cómo estás?' }],
        });

      const result = await client.translate('Hello! How are you?', {
        targetLang: 'es',
      });

      expect(result.text).toContain('¡');
      expect(result.text).toContain('¿');
    });

    it('should handle newlines and whitespace', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: 'Línea 1\n\nLínea 2' }],
        });

      const result = await client.translate('Line 1\n\nLine 2', {
        targetLang: 'es',
      });

      expect(result.text).toContain('\n\n');
    });

    it('should handle unicode characters', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: '你好世界 🌍' }],
        });

      const result = await client.translate('Hello world', {
        targetLang: 'zh',
      });

      expect(result.text).toContain('你好');
      expect(result.text).toContain('🌍');
    });
  });

  describe('configuration', () => {
    it('should allow custom timeout', () => {
      const customClient = new DeepLClient(apiKey, { timeout: 5000 });
      expect(customClient).toBeInstanceOf(DeepLClient);
    });

    it('should allow custom max retries', () => {
      const customClient = new DeepLClient(apiKey, { maxRetries: 5 });
      expect(customClient).toBeInstanceOf(DeepLClient);
    });

    it('should respect custom maxRetries setting', async () => {
      const customClient = new DeepLClient(apiKey, { maxRetries: 1 });

      nock(baseUrl)
        .get('/v2/usage')
        .times(2) // Should only retry 1 time + initial = 2 requests total
        .reply(503);

      await expect(customClient.getUsage()).rejects.toThrow();

      expect(nock.isDone()).toBe(true);
    });

    it('should respect maxRetries of 0 (no retries)', async () => {
      const customClient = new DeepLClient(apiKey, { maxRetries: 0 });

      nock(baseUrl)
        .get('/v2/usage')
        .times(1) // Should not retry, only 1 request
        .reply(503);

      await expect(customClient.getUsage()).rejects.toThrow();

      expect(nock.isDone()).toBe(true);
    });

    it('should allow higher maxRetries', async () => {
      const customClient = new DeepLClient(apiKey, { maxRetries: 2 });

      nock(baseUrl)
        .get('/v2/usage')
        .times(3) // Should retry 2 times + initial = 3 requests total
        .reply(503);

      await expect(customClient.getUsage()).rejects.toThrow();

      expect(nock.isDone()).toBe(true);
    });

    it('should allow custom base URL', async () => {
      const customClient = new DeepLClient(apiKey, {
        baseUrl: 'https://custom.api.com',
      });
      nock('https://custom.api.com')
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Hola' }] });
      const result = await customClient.translate('Hello', { targetLang: 'es' });
      expect(result.text).toBe('Hola');
    });

    it('should allow HTTP proxy configuration', () => {
      const proxyClient = new DeepLClient(apiKey, {
        proxy: {
          protocol: 'http',
          host: 'proxy.example.com',
          port: 8080,
        },
      });
      expect(proxyClient).toBeInstanceOf(DeepLClient);
    });

    it('should allow HTTPS proxy configuration', () => {
      const proxyClient = new DeepLClient(apiKey, {
        proxy: {
          protocol: 'https',
          host: 'proxy.example.com',
          port: 8443,
        },
      });
      expect(proxyClient).toBeInstanceOf(DeepLClient);
    });

    it('should allow proxy configuration with authentication', () => {
      const proxyClient = new DeepLClient(apiKey, {
        proxy: {
          protocol: 'http',
          host: 'proxy.example.com',
          port: 8080,
          auth: {
            username: 'proxyuser',
            password: 'proxypass',
          },
        },
      });
      expect(proxyClient).toBeInstanceOf(DeepLClient);
    });

    it('should allow proxy configuration from environment variables', () => {
      process.env['HTTP_PROXY'] = 'http://proxy.example.com:8080';
      const proxyClient = new DeepLClient(apiKey);
      expect(proxyClient).toBeInstanceOf(DeepLClient);
      delete process.env['HTTP_PROXY'];
    });

    it('should allow proxy configuration from HTTPS_PROXY environment variable', () => {
      process.env['HTTPS_PROXY'] = 'https://proxy.example.com:8443';
      const proxyClient = new DeepLClient(apiKey);
      expect(proxyClient).toBeInstanceOf(DeepLClient);
      delete process.env['HTTPS_PROXY'];
    });

    it('should warn when an HTTP proxy fronts an HTTPS API endpoint', () => {
      // The warning fires in HttpClient's constructor, not DeepLClient's
      // (DeepLClient lazy-builds sub-clients on first access). Assert
      // via HttpClient directly.
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
      try {
        new HttpClient(apiKey, {
          proxy: {
            protocol: 'http',
            host: 'proxy.example.com',
            port: 8080,
          },
        });
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/routing HTTPS traffic.*via HTTP proxy/i),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should NOT warn when HTTPS proxy fronts an HTTPS API endpoint', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
      try {
        new HttpClient(apiKey, {
          proxy: {
            protocol: 'https',
            host: 'proxy.example.com',
            port: 8443,
          },
        });
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringMatching(/routing HTTPS traffic.*via HTTP proxy/i),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should throw error for invalid proxy URL from environment variable (Issue #2)', () => {
      process.env['HTTP_PROXY'] = 'not-a-valid-url';
      expect(() => {
        new DeepLClient(apiKey);
      }).toThrow('Invalid proxy URL');
      delete process.env['HTTP_PROXY'];
    });

    it('should throw error for malformed proxy URL from environment variable (Issue #2)', () => {
      process.env['HTTP_PROXY'] = 'http://';
      expect(() => {
        new DeepLClient(apiKey);
      }).toThrow('Invalid proxy URL');
      delete process.env['HTTP_PROXY'];
    });

    it('should throw error for proxy URL with spaces (Issue #2)', () => {
      process.env['HTTP_PROXY'] = 'http://proxy example.com:8080';
      expect(() => {
        new DeepLClient(apiKey);
      }).toThrow('Invalid proxy URL');
      delete process.env['HTTP_PROXY'];
    });

    it('should sanitize invalid proxy URL in error message (Issue #2)', () => {
      process.env['HTTP_PROXY'] = 'not-a-valid-url';
      expect(() => {
        new DeepLClient(apiKey);
      }).toThrow(/Invalid proxy URL.*\[invalid URL\]/);
      delete process.env['HTTP_PROXY'];
    });

    it('should sanitize credentials from proxy URL in error messages', () => {
      process.env['HTTP_PROXY'] = 'http://user:s3cret@proxy.example.com:8080';
      const proxyClient = new DeepLClient(apiKey);
      expect(proxyClient).toBeDefined();
      delete process.env['HTTP_PROXY'];
    });

    it('should not leak credentials when proxy URL with auth fails to parse host', () => {
      expect.assertions(2);
      process.env['HTTP_PROXY'] = 'http://user:s3cret@';
      try {
        new DeepLClient(apiKey);
      } catch (e: any) {
        expect(e.message).not.toContain('s3cret');
        expect(e.message).toMatch(/Invalid proxy URL/);
      } finally {
        delete process.env['HTTP_PROXY'];
      }
    });

    it('should not leak credentials for invalid proxy URL with auth', () => {
      process.env['HTTP_PROXY'] = 'http://user:s3cret@proxy.example.com:99999';
      try {
        new DeepLClient(apiKey);
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).not.toContain('s3cret');
        expect(e.message).not.toContain('user');
        expect(e.message).toContain('[invalid URL]');
      } finally {
        delete process.env['HTTP_PROXY'];
      }
    });
  });

  describe('improveText()', () => {
    describe('basic functionality', () => {
      it('should improve text successfully', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'This is a well-written sentence.',
                target_language: 'en-US',
                detected_source_language: 'en',
              },
            ],
          });

        const result = await client.improveText('This is a sentence.', {
          targetLang: 'en-US',
        });

        expect(result).toHaveLength(1);
        expect(result[0]?.text).toBe('This is a well-written sentence.');
        expect(result[0]?.targetLanguage).toBe('en-US');
        expect(result[0]?.detectedSourceLanguage).toBe('en');
      });

      it('should throw error when no improvements returned', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, { improvements: [] });

        await expect(
          client.improveText('Test', { targetLang: 'en-US' })
        ).rejects.toThrow('No improvements returned');
      });
    });

    describe('writing style parameter', () => {
      it('should apply simple writing style', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.writing_style === 'simple';
          })
          .reply(200, {
            improvements: [
              {
                text: 'This is easy to read.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('This is a sentence.', {
          targetLang: 'en-US',
          writingStyle: 'simple',
        });

        expect(result[0]?.text).toBe('This is easy to read.');
        expect(nock.isDone()).toBe(true);
      });

      it('should apply business writing style', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.writing_style === 'business';
          })
          .reply(200, {
            improvements: [
              {
                text: 'We are pleased to inform you.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('We want to tell you.', {
          targetLang: 'en-US',
          writingStyle: 'business',
        });

        expect(result[0]?.text).toBe('We are pleased to inform you.');
        expect(nock.isDone()).toBe(true);
      });

      it('should apply academic writing style', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.writing_style === 'academic';
          })
          .reply(200, {
            improvements: [
              {
                text: 'This study demonstrates the effectiveness of the method.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('This shows it works.', {
          targetLang: 'en-US',
          writingStyle: 'academic',
        });

        expect(result[0]?.text).toContain('demonstrates');
        expect(nock.isDone()).toBe(true);
      });

      it('should apply casual writing style', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.writing_style === 'casual';
          })
          .reply(200, {
            improvements: [
              {
                text: "Hey, that's pretty cool!",
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('That is interesting.', {
          targetLang: 'en-US',
          writingStyle: 'casual',
        });

        expect(result[0]?.text).toContain('cool');
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('tone parameter', () => {
      it('should apply enthusiastic tone', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.tone === 'enthusiastic';
          })
          .reply(200, {
            improvements: [
              {
                text: 'This is absolutely fantastic!',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('This is good.', {
          targetLang: 'en-US',
          tone: 'enthusiastic',
        });

        expect(result[0]?.text).toContain('fantastic');
        expect(nock.isDone()).toBe(true);
      });

      it('should apply friendly tone', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.tone === 'friendly';
          })
          .reply(200, {
            improvements: [
              {
                text: "Hi there! Hope you're doing well.",
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('Hello.', {
          targetLang: 'en-US',
          tone: 'friendly',
        });

        expect(result[0]?.text).toContain('Hi');
        expect(nock.isDone()).toBe(true);
      });

      it('should apply confident tone', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.tone === 'confident';
          })
          .reply(200, {
            improvements: [
              {
                text: 'I am certain this will succeed.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('I think this will work.', {
          targetLang: 'en-US',
          tone: 'confident',
        });

        expect(result[0]?.text).toContain('certain');
        expect(nock.isDone()).toBe(true);
      });

      it('should apply diplomatic tone', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.tone === 'diplomatic';
          })
          .reply(200, {
            improvements: [
              {
                text: 'Perhaps we could consider an alternative approach.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('Try something else.', {
          targetLang: 'en-US',
          tone: 'diplomatic',
        });

        expect(result[0]?.text).toContain('Perhaps');
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('parameter constraints', () => {
      it('should work with only target language', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return !body.writing_style && !body.tone;
          })
          .reply(200, {
            improvements: [
              {
                text: 'Improved text.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('Test text.', {
          targetLang: 'en-US',
        });

        expect(result[0]?.text).toBe('Improved text.');
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('supported languages', () => {
      it('should work with German', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'Das ist ein guter Satz.',
                target_language: 'de',
              },
            ],
          });

        const result = await client.improveText('Das ist ein Satz.', {
          targetLang: 'de',
        });

        expect(result[0]?.targetLanguage).toBe('de');
      });

      it('should work with Spanish', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'Esta es una oración bien escrita.',
                target_language: 'es',
              },
            ],
          });

        const result = await client.improveText('Esta es una oración.', {
          targetLang: 'es',
        });

        expect(result[0]?.targetLanguage).toBe('es');
      });

      it('should work with French', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'Ceci est une phrase bien rédigée.',
                target_language: 'fr',
              },
            ],
          });

        const result = await client.improveText('Ceci est une phrase.', {
          targetLang: 'fr',
        });

        expect(result[0]?.targetLanguage).toBe('fr');
      });

      it('should work with British English', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'This is a well-written sentence with British spelling.',
                target_language: 'en-GB',
              },
            ],
          });

        const result = await client.improveText('This is a sentence.', {
          targetLang: 'en-GB',
        });

        expect(result[0]?.targetLanguage).toBe('en-GB');
      });
    });

    describe('edge cases', () => {
      it('should handle long text', async () => {
        const longText = 'This is a test sentence. '.repeat(100);

        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'Improved long text. '.repeat(100),
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText(longText, {
          targetLang: 'en-US',
        });

        expect(result[0]?.text.length).toBeGreaterThan(0);
      });

      it('should handle special characters', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'This is a test: "quotes" & special chars!',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('Test: quotes & chars', {
          targetLang: 'en-US',
        });

        expect(result[0]?.text).toContain('&');
        expect(result[0]?.text).toContain('"');
      });

      it('should preserve newlines in improved text', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase')
          .reply(200, {
            improvements: [
              {
                text: 'First paragraph.\n\nSecond paragraph.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('Para 1.\n\nPara 2.', {
          targetLang: 'en-US',
        });

        expect(result[0]?.text).toContain('\n\n');
      });
    });

    describe('prefer_ prefixes', () => {
      it('should apply prefer_simple writing style', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.writing_style === 'prefer_simple';
          })
          .reply(200, {
            improvements: [
              {
                text: 'This is easy to understand.',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('This is a sentence.', {
          targetLang: 'en-US',
          writingStyle: 'prefer_simple',
        });

        expect(result[0]?.text).toBe('This is easy to understand.');
        expect(nock.isDone()).toBe(true);
      });

      it('should apply prefer_enthusiastic tone', async () => {
        nock(baseUrl)
          .post('/v2/write/rephrase', (body) => {
             
            return body.tone === 'prefer_enthusiastic';
          })
          .reply(200, {
            improvements: [
              {
                text: 'This is great!',
                target_language: 'en-US',
              },
            ],
          });

        const result = await client.improveText('This is good.', {
          targetLang: 'en-US',
          tone: 'prefer_enthusiastic',
        });

        expect(result[0]?.text).toBe('This is great!');
        expect(nock.isDone()).toBe(true);
      });
    });
  });

  describe('translateBatch()', () => {
    it('should translate multiple texts in a single API call', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
          // Verify multiple text parameters are sent
           
          return Array.isArray(body.text) && body.text.length === 3;
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
            {
              detected_source_language: 'EN',
              text: 'Adiós',
            },
            {
              detected_source_language: 'EN',
              text: 'Gracias',
            },
          ],
        });

      const results = await client.translateBatch(
        ['Hello', 'Goodbye', 'Thank you'],
        { targetLang: 'es' }
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.text).toBe('Hola');
      expect(results[1]?.text).toBe('Adiós');
      expect(results[2]?.text).toBe('Gracias');
      expect(results[0]?.detectedSourceLang).toBe('en');
    });

    it('should handle empty array', async () => {
      const results = await client.translateBatch([], { targetLang: 'es' });
      expect(results).toHaveLength(0);
    });

    it('should handle single text in batch', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
          ],
        });

      const results = await client.translateBatch(['Hello'], {
        targetLang: 'es',
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.text).toBe('Hola');
    });

    it('should include all translation options in batch request', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.source_lang === 'EN' &&
             
            body.formality === 'more' &&
             
            body.glossary_id === 'test-glossary';
        })
        .reply(200, {
          translations: [
            { text: 'Hola' },
            { text: 'Adiós' },
          ],
        });

      await client.translateBatch(['Hello', 'Goodbye'], {
        targetLang: 'es',
        sourceLang: 'en',
        formality: 'more',
        glossaryId: 'test-glossary',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should handle API errors in batch translation', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(403, {
          message: 'Authorization failed',
        });

      await expect(
        client.translateBatch(['Hello', 'Goodbye'], { targetLang: 'es' })
      ).rejects.toThrow('Authentication failed');
    });

    it('should throw error if response has fewer translations than texts', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Hola' },
            // Missing second translation
          ],
        });

      await expect(
        client.translateBatch(['Hello', 'Goodbye'], { targetLang: 'es' })
      ).rejects.toThrow('Unexpected API response');
    });

    it('should throw error if response has more translations than texts', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            { text: 'Hola' },
            { text: 'Adiós' },
            { text: 'Extra' }, // Extra translation
          ],
        });

      await expect(
        client.translateBatch(['Hello', 'Goodbye'], { targetLang: 'es' })
      ).rejects.toThrow('Unexpected API response');
    });

    it('should handle batch with different detected languages', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
            {
              detected_source_language: 'FR',
              text: 'Hola',
            },
          ],
        });

      const results = await client.translateBatch(['Hello', 'Bonjour'], {
        targetLang: 'es',
      });

      expect(results[0]?.detectedSourceLang).toBe('en');
      expect(results[1]?.detectedSourceLang).toBe('fr');
    });

    it('should send show_billed_characters in batch translation', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.show_billed_characters === '1';
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
            {
              detected_source_language: 'EN',
              text: 'Adiós',
            },
          ],
          billed_characters: 12,
        });

      await client.translateBatch(['Hello', 'Goodbye'], {
        targetLang: 'es',
        showBilledCharacters: true,
      });

      expect(nock.isDone()).toBe(true);
    });

    it('should parse billed_characters in batch translation response', async () => {
      nock(baseUrl)
        .post('/v2/translate')
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
            {
              detected_source_language: 'EN',
              text: 'Adiós',
            },
          ],
          billed_characters: 12,
        });

      const results = await client.translateBatch(['Hello', 'Goodbye'], {
        targetLang: 'es',
        showBilledCharacters: true,
      });

      expect(results).toHaveLength(2);
      expect(results[0]?.text).toBe('Hola');
      expect(results[1]?.text).toBe('Adiós');
      // Note: In batch translation, billed_characters is for the entire batch,
      // not per translation. The API client returns it at the response level.
    });

    it('should send enable_beta_languages in batch translation', async () => {
      nock(baseUrl)
        .post('/v2/translate', (body) => {
           
          return body.enable_beta_languages === '1';
        })
        .reply(200, {
          translations: [
            {
              detected_source_language: 'EN',
              text: 'Hola',
            },
            {
              detected_source_language: 'EN',
              text: 'Adiós',
            },
          ],
        });

      await client.translateBatch(['Hello', 'Goodbye'], {
        targetLang: 'es',
        enableBetaLanguages: true,
      });

      expect(nock.isDone()).toBe(true);
    });
  });

  describe('getGlossaryLanguages()', () => {
    it('should return supported glossary language pairs', async () => {
      nock(baseUrl)
        .get('/v2/glossary-language-pairs')
        .reply(200, {
          supported_languages: [
            { source_lang: 'en', target_lang: 'de' },
            { source_lang: 'de', target_lang: 'en' },
            { source_lang: 'en', target_lang: 'fr' },
          ],
        });

      const pairs = await client.getGlossaryLanguages();

      expect(pairs).toHaveLength(3);
      expect(pairs[0]?.sourceLang).toBe('en');
      expect(pairs[0]?.targetLang).toBe('de');
      expect(pairs[1]?.sourceLang).toBe('de');
      expect(pairs[1]?.targetLang).toBe('en');
    });

    it('should normalize language codes to lowercase', async () => {
      nock(baseUrl)
        .get('/v2/glossary-language-pairs')
        .reply(200, {
          supported_languages: [
            { source_lang: 'EN', target_lang: 'DE' },
            { source_lang: 'EN-US', target_lang: 'ES' },
          ],
        });

      const pairs = await client.getGlossaryLanguages();

      expect(pairs[0]?.sourceLang).toBe('en');
      expect(pairs[0]?.targetLang).toBe('de');
      expect(pairs[1]?.sourceLang).toBe('en-us');
      expect(pairs[1]?.targetLang).toBe('es');
    });

    it('should handle empty response', async () => {
      nock(baseUrl)
        .get('/v2/glossary-language-pairs')
        .reply(200, {
          supported_languages: [],
        });

      const pairs = await client.getGlossaryLanguages();

      expect(pairs).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      nock(baseUrl)
        .get('/v2/glossary-language-pairs')
        .reply(403, {
          message: 'Authentication failed',
        });

      await expect(client.getGlossaryLanguages()).rejects.toThrow('Authentication failed');
    });

    it('should handle network errors', async () => {
      nock(baseUrl)
        .get('/v2/glossary-language-pairs')
        .replyWithError('Network error');

      await expect(client.getGlossaryLanguages()).rejects.toThrow();
    });
  });

  describe('style_id parameter', () => {
    it('should send style_id parameter in translation request', async () => {
      const scope = nock(baseUrl)
        .post('/v2/translate', (body: string) => {
          const params = new URLSearchParams(body);
          return params.get('style_id') === 'abc-123-def-456';
        })
        .reply(200, {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }],
        });

      await client.translate('Hello', {
        targetLang: 'es',
        styleId: 'abc-123-def-456',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should not send style_id when not specified', async () => {
      const scope = nock(baseUrl)
        .post('/v2/translate', (body: string) => {
          const params = new URLSearchParams(body);
          return !params.has('style_id');
        })
        .reply(200, {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }],
        });

      await client.translate('Hello', { targetLang: 'es' });

      expect(scope.isDone()).toBe(true);
    });

    it('should send style_id in batch translation', async () => {
      const scope = nock(baseUrl)
        .post('/v2/translate', (body: string) => {
          const params = new URLSearchParams(body);
          return params.get('style_id') === 'style-uuid-123';
        })
        .reply(200, {
          translations: [
            { text: 'Hola', detected_source_language: 'EN' },
            { text: 'Mundo', detected_source_language: 'EN' },
          ],
        });

      await client.translateBatch(['Hello', 'World'], {
        targetLang: 'es',
        styleId: 'style-uuid-123',
      });

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('getStyleRules', () => {
    it('should fetch style rules from v3 API', async () => {
      nock(baseUrl)
        .get('/v3/style_rules')
        .reply(200, {
          style_rules: [
            {
              style_id: 'uuid-1',
              name: 'My Style',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
            },
          ],
        });

      const rules = await client.getStyleRules();

      expect(rules).toHaveLength(1);
      expect(rules[0]).toEqual({
        styleId: 'uuid-1',
        name: 'My Style',
        language: 'en',
        version: 1,
        creationTime: '2024-01-01T00:00:00Z',
        updatedTime: '2024-01-02T00:00:00Z',
      });
    });

    it('should pass detailed query parameter', async () => {
      nock(baseUrl)
        .get('/v3/style_rules')
        .query({ detailed: true })
        .reply(200, {
          style_rules: [
            {
              style_id: 'uuid-1',
              name: 'My Style',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
              configured_rules: { punctuation: { quotation_mark: 'use_guillemets' } },
              custom_instructions: [
                { label: 'Instruction 1', prompt: 'Do this', source_language: 'en' },
              ],
            },
          ],
        });

      const rules = await client.getStyleRules({ detailed: true });

      expect(rules).toHaveLength(1);
      const detailed = rules[0] as any;
      expect(detailed.configuredRules).toEqual({ punctuation: { quotation_mark: 'use_guillemets' } });
      expect(detailed.customInstructions).toEqual([
        { label: 'Instruction 1', prompt: 'Do this', sourceLanguage: 'en' },
      ]);
    });

    it('should pass pagination parameters', async () => {
      nock(baseUrl)
        .get('/v3/style_rules')
        .query({ page: 2, page_size: 10 })
        .reply(200, {
          style_rules: [],
        });

      const rules = await client.getStyleRules({ page: 2, pageSize: 10 });

      expect(rules).toHaveLength(0);
    });

    it('should handle empty results', async () => {
      nock(baseUrl)
        .get('/v3/style_rules')
        .reply(200, {
          style_rules: [],
        });

      const rules = await client.getStyleRules();

      expect(rules).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      nock(baseUrl)
        .get('/v3/style_rules')
        .reply(403, {
          message: 'Authentication failed',
        });

      await expect(client.getStyleRules()).rejects.toThrow('Authentication failed');
    });
  });

  describe('tag_handling_version parameter', () => {
    it('should send tag_handling_version in translation request', async () => {
      const scope = nock(baseUrl)
        .post('/v2/translate', (body: string) => {
          const params = new URLSearchParams(body);
          return params.get('tag_handling_version') === 'v2';
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>', detected_source_language: 'EN' }],
        });

      await client.translate('<p>Hello</p>', {
        targetLang: 'es',
        tagHandling: 'html',
        tagHandlingVersion: 'v2',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should not send tag_handling_version when not specified', async () => {
      const scope = nock(baseUrl)
        .post('/v2/translate', (body: string) => {
          const params = new URLSearchParams(body);
          return !params.has('tag_handling_version');
        })
        .reply(200, {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }],
        });

      await client.translate('Hello', { targetLang: 'es' });

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('Admin API', () => {
    describe('listApiKeys', () => {
      it('should fetch API keys', async () => {
        nock(baseUrl)
          .get('/v2/admin/developer-keys')
          .reply(200, [
            {
              key_id: 'key-1',
              label: 'Production',
              creation_time: '2024-01-01T00:00:00Z',
              is_deactivated: false,
              usage_limits: { characters: 1000000 },
            },
          ]);

        const keys = await client.listApiKeys();

        expect(keys).toHaveLength(1);
        expect(keys[0]).toEqual({
          keyId: 'key-1',
          label: 'Production',
          creationTime: '2024-01-01T00:00:00Z',
          isDeactivated: false,
          usageLimits: { characters: 1000000 },
        });
      });

      it('should handle empty list', async () => {
        nock(baseUrl)
          .get('/v2/admin/developer-keys')
          .reply(200, []);

        const keys = await client.listApiKeys();
        expect(keys).toHaveLength(0);
      });

      it('should handle API errors', async () => {
        nock(baseUrl)
          .get('/v2/admin/developer-keys')
          .reply(403, { message: 'Authentication failed' });

        await expect(client.listApiKeys()).rejects.toThrow('Authentication failed');
      });
    });

    describe('createApiKey', () => {
      it('should create a key with label', async () => {
        nock(baseUrl)
          .post('/v2/admin/developer-keys', { label: 'Test Key' })
          .reply(200, {
            key_id: 'key-new',
            label: 'Test Key',
            creation_time: '2024-01-01T00:00:00Z',
            is_deactivated: false,
          });

        const key = await client.createApiKey('Test Key');
        expect(key.keyId).toBe('key-new');
        expect(key.label).toBe('Test Key');
      });

      it('should create a key without label', async () => {
        nock(baseUrl)
          .post('/v2/admin/developer-keys', {})
          .reply(200, {
            key_id: 'key-new',
            label: '',
            creation_time: '2024-01-01T00:00:00Z',
            is_deactivated: false,
          });

        const key = await client.createApiKey();
        expect(key.keyId).toBe('key-new');
      });
    });

    describe('deactivateApiKey', () => {
      it('should deactivate a key', async () => {
        nock(baseUrl)
          .put('/v2/admin/developer-keys/deactivate', { key_id: 'key-1' })
          .reply(204);

        await expect(client.deactivateApiKey('key-1')).resolves.toBeUndefined();
      });
    });

    describe('renameApiKey', () => {
      it('should rename a key', async () => {
        nock(baseUrl)
          .put('/v2/admin/developer-keys/label', { key_id: 'key-1', label: 'New Name' })
          .reply(204);

        await expect(client.renameApiKey('key-1', 'New Name')).resolves.toBeUndefined();
      });
    });

    describe('setApiKeyLimit', () => {
      it('should set a character limit', async () => {
        nock(baseUrl)
          .put('/v2/admin/developer-keys/limits', { key_id: 'key-1', characters: 500000 })
          .reply(204);

        await expect(client.setApiKeyLimit('key-1', 500000)).resolves.toBeUndefined();
      });

      it('should remove limit with null', async () => {
        nock(baseUrl)
          .put('/v2/admin/developer-keys/limits', { key_id: 'key-1', characters: null })
          .reply(204);

        await expect(client.setApiKeyLimit('key-1', null)).resolves.toBeUndefined();
      });
    });

    describe('getAdminUsage', () => {
      it('should fetch usage data', async () => {
        nock(baseUrl)
          .get('/v2/admin/analytics')
          .query({ start_date: '2024-01-01', end_date: '2024-01-31' })
          .reply(200, {
            usage_report: {
              total_usage: {
                total_characters: 5000,
                text_translation_characters: 3000,
                document_translation_characters: 1500,
                text_improvement_characters: 500,
                speech_to_text_milliseconds: 120000,
              },
              start_date: '2024-01-01',
              end_date: '2024-01-31',
            },
          });

        const report = await client.getAdminUsage({
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        });

        expect(report.totalUsage.totalCharacters).toBe(5000);
        expect(report.totalUsage.textTranslationCharacters).toBe(3000);
        expect(report.totalUsage.documentTranslationCharacters).toBe(1500);
        expect(report.totalUsage.textImprovementCharacters).toBe(500);
        expect(report.totalUsage.speechToTextMilliseconds).toBe(120000);
        expect(report.entries).toHaveLength(0);
      });

      it('should pass group_by parameter', async () => {
        nock(baseUrl)
          .get('/v2/admin/analytics')
          .query({ start_date: '2024-01-01', end_date: '2024-01-31', group_by: 'key' })
          .reply(200, {
            usage_report: {
              total_usage: {
                total_characters: 3000,
                text_translation_characters: 3000,
                document_translation_characters: 0,
                text_improvement_characters: 0,
                speech_to_text_milliseconds: 0,
              },
              start_date: '2024-01-01',
              end_date: '2024-01-31',
              group_by: 'key',
              key_usages: [
                {
                  api_key: 'dc88****3a2c',
                  api_key_label: 'Staging',
                  usage: {
                    total_characters: 3000,
                    text_translation_characters: 3000,
                    document_translation_characters: 0,
                    text_improvement_characters: 0,
                    speech_to_text_milliseconds: 0,
                  },
                },
              ],
            },
          });

        const report = await client.getAdminUsage({
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          groupBy: 'key',
        });

        expect(report.entries).toHaveLength(1);
        expect(report.entries[0]?.apiKey).toBe('dc88****3a2c');
        expect(report.entries[0]?.apiKeyLabel).toBe('Staging');
        expect(report.entries[0]?.usage.totalCharacters).toBe(3000);
      });
    });
  });
});

/**
 * Integration Tests for DeepL Client
 * Tests HTTP request/response handling with mocked DeepL API using nock
 * This validates that the client correctly formats requests and parses responses
 */

import nock from 'nock';
import { DeepLClient } from '../../src/api/deepl-client.js';
import { DEEPL_FREE_API_URL, DEEPL_PRO_API_URL, TEST_API_KEY } from '../helpers';

describe('DeepLClient Integration', () => {
  const API_KEY = TEST_API_KEY;
  const FREE_API_URL = DEEPL_FREE_API_URL;
  const PRO_API_URL = DEEPL_PRO_API_URL;
  const clients: DeepLClient[] = [];

  afterEach(() => {
    nock.abortPendingRequests();
    clients.forEach(c => c.destroy());
    clients.length = 0;
    nock.cleanAll();
  });


  describe('constructor', () => {
    it('should create client with API key', () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      expect(client).toBeInstanceOf(DeepLClient);
    });

    it('should throw error for empty API key', () => {
      expect(() => new DeepLClient('')).toThrow('API key is required');
    });

    it('should use free API URL by default', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(200, { character_count: 0, character_limit: 500000 });

      await client.getUsage();
      expect(scope.isDone()).toBe(true);
    });

    it('should use pro API URL when usePro is true', async () => {
      const client = new DeepLClient(API_KEY, { usePro: true });
      clients.push(client);

      const scope = nock(PRO_API_URL)
        .get('/v2/usage')
        .reply(200, { character_count: 0, character_limit: 500000 });

      await client.getUsage();
      expect(scope.isDone()).toBe(true);
    });

    it('should use custom baseUrl when provided', async () => {
      const customUrl = 'https://custom-api.example.com';
      const client = new DeepLClient(API_KEY, { baseUrl: customUrl });
      clients.push(client);

      const scope = nock(customUrl)
        .get('/v2/usage')
        .reply(200, { character_count: 0, character_limit: 500000 });

      await client.getUsage();
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('translate()', () => {
    it('should make correct HTTP POST request for translation', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate', (body) => {
          // Verify request body (nock parses form-encoded to object)
          expect(body.text).toBe('Hello');
          expect(body.target_lang).toBe('ES');
          return true;
        })
        .reply(200, {
          translations: [{ text: 'Hola', detected_source_language: 'EN' }],
        });

      const result = await client.translate('Hello', { targetLang: 'es' });

      expect(result.text).toBe('Hola');
      expect(result.detectedSourceLang).toBe('en');
      expect(scope.isDone()).toBe(true);
    });

    it('should include source language when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate', (body) => {
          expect(body.source_lang).toBe('EN');
          expect(body.target_lang).toBe('ES');
          return true;
        })
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', { targetLang: 'es', sourceLang: 'en' });
      expect(scope.isDone()).toBe(true);
    });

    it('should include formality when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate', (body) => {
          expect(body.formality).toBe('more');
          return true;
        })
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', { targetLang: 'es', formality: 'more' });
      expect(scope.isDone()).toBe(true);
    });

    it('should include context when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate', (body) => {
          expect(body.context).toBe('This is a greeting');
          return true;
        })
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', { targetLang: 'es', context: 'This is a greeting' });
      expect(scope.isDone()).toBe(true);
    });

    it('should include splitSentences when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate', (body) => {
          expect(body.split_sentences).toBe('nonewlines');
          return true;
        })
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', { targetLang: 'es', splitSentences: 'nonewlines' });
      expect(scope.isDone()).toBe(true);
    });

    it('should include tagHandling when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate', (body) => {
          expect(body.tag_handling).toBe('xml');
          return true;
        })
        .reply(200, {
          translations: [{ text: '<p>Hola</p>' }],
        });

      await client.translate('<p>Hello</p>', { targetLang: 'es', tagHandling: 'xml' });
      expect(scope.isDone()).toBe(true);
    });

    it('should include modelType when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate', (body) => {
          expect(body.model_type).toBe('quality_optimized');
          return true;
        })
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', { targetLang: 'es', modelType: 'quality_optimized' });
      expect(scope.isDone()).toBe(true);
    });

    it('should parse model_type_used from response', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [{
            text: 'Hola',
            detected_source_language: 'EN',
            model_type_used: 'quality_optimized',
          }],
        });

      const result = await client.translate('Hello', { targetLang: 'es' });
      expect(result.modelTypeUsed).toBe('quality_optimized');
    });

    it('should handle response without model_type_used', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      const result = await client.translate('Hello', { targetLang: 'es' });
      expect(result.modelTypeUsed).toBeUndefined();
    });

    it('should use correct Authorization header', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL, {
        reqheaders: {
          'authorization': `DeepL-Auth-Key ${API_KEY}`,
        },
      })
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', { targetLang: 'es' });
      expect(scope.isDone()).toBe(true);
    });

    it('should use form-encoded content type', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL, {
        reqheaders: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      })
        .post('/v2/translate')
        .reply(200, {
          translations: [{ text: 'Hola' }],
        });

      await client.translate('Hello', { targetLang: 'es' });
      expect(scope.isDone()).toBe(true);
    });

    it('should handle 403 authentication errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(403, { message: 'Authorization failed' });

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        'Authentication failed: Invalid API key'
      );
    });

    it('should handle 456 quota exceeded errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(456, { message: 'Quota exceeded' });

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        'Quota exceeded: Character limit reached'
      );
    });

    it('should handle 429 rate limit errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .times(4)
        .reply(429, { message: 'Too many requests' });

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        'Rate limit exceeded: Too many requests'
      );
    });

    it('should handle 503 service unavailable errors', async () => {
      const client = new DeepLClient(API_KEY, { maxRetries: 2 });
      clients.push(client);

      // A translate POST is not replayed, so one attempt is all the server sees.
      nock(FREE_API_URL).post('/v2/translate').reply(503, { message: 'Service temporarily unavailable' });

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        'Service temporarily unavailable: Please try again later'
      );
    });

    it('should handle network timeouts', async () => {
      const client = new DeepLClient(API_KEY, { timeout: 100, maxRetries: 0 });
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .replyWithError({ code: 'ECONNABORTED', message: 'timeout of 100ms exceeded' });

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow();
    });

    it('should handle malformed API responses', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL).post('/v2/translate').reply(200, { invalid: 'response' });

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        'No translation returned'
      );
    });

    it('should retry an idempotent request on 500 errors', async () => {
      const client = new DeepLClient(API_KEY, { maxRetries: 2 });
      clients.push(client);

      // First two attempts fail with 500, third succeeds
      nock(FREE_API_URL).get('/v2/usage').reply(500, 'Internal Server Error');
      nock(FREE_API_URL).get('/v2/usage').reply(500, 'Internal Server Error');
      nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(200, { character_count: 10, character_limit: 100 });

      const usage = await client.getUsage();
      expect(usage.characterCount).toBe(10);
    });

    it('should not replay a translate request on 500 errors', async () => {
      const client = new DeepLClient(API_KEY, { maxRetries: 2 });
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(500, { message: 'Internal Server Error' });

      await expect(
        client.translate('Hello', { targetLang: 'es' })
      ).rejects.toThrow(/Server error \(500\)/);

      expect(scope.isDone()).toBe(true);
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should NOT retry on 4xx errors', async () => {
      const client = new DeepLClient(API_KEY, { maxRetries: 2 });
      clients.push(client);

      // Only one request should be made for 4xx errors
      const scope = nock(FREE_API_URL).post('/v2/translate').reply(403, 'Forbidden');

      await expect(client.translate('Hello', { targetLang: 'es' })).rejects.toThrow(
        'Authentication failed'
      );

      expect(scope.isDone()).toBe(true);
      // No additional retries should have been attempted
      expect(nock.pendingMocks().length).toBe(0);
    });
  });

  describe('getUsage()', () => {
    it('should make correct HTTP GET request for usage', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(200, {
          character_count: 200000,
          character_limit: 500000,
        });

      const result = await client.getUsage();

      expect(result.characterCount).toBe(200000);
      expect(result.characterLimit).toBe(500000);
      expect(scope.isDone()).toBe(true);
    });

    it('should parse usage response correctly', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(200, {
          character_count: 12345,
          character_limit: 50000,
        });

      const result = await client.getUsage();

      expect(result.characterCount).toBe(12345);
      expect(result.characterLimit).toBe(50000);
    });

    it('should handle authentication errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL).get('/v2/usage').reply(403, { message: 'Invalid API key' });

      await expect(client.getUsage()).rejects.toThrow('Authentication failed');
    });

    it('should parse Pro API usage response with all fields', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(200, {
          character_count: 2150000,
          character_limit: 20000000,
          api_key_character_count: 1880000,
          api_key_character_limit: 0,
          start_time: '2025-04-24T14:58:02Z',
          end_time: '2025-05-24T14:58:02Z',
          products: [
            { product_type: 'translate', character_count: 900000, api_key_character_count: 880000 },
            { product_type: 'write', character_count: 1250000, api_key_character_count: 1000000 },
          ],
        });

      const result = await client.getUsage();

      expect(result.characterCount).toBe(2150000);
      expect(result.characterLimit).toBe(20000000);
      expect(result.apiKeyCharacterCount).toBe(1880000);
      expect(result.apiKeyCharacterLimit).toBe(0);
      expect(result.startTime).toBe('2025-04-24T14:58:02Z');
      expect(result.endTime).toBe('2025-05-24T14:58:02Z');
      expect(result.products).toEqual([
        { productType: 'translate', characterCount: 900000, apiKeyCharacterCount: 880000 },
        { productType: 'write', characterCount: 1250000, apiKeyCharacterCount: 1000000 },
      ]);
    });

    it('should handle Free API response without Pro fields', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(200, {
          character_count: 12345,
          character_limit: 50000,
        });

      const result = await client.getUsage();

      expect(result.characterCount).toBe(12345);
      expect(result.characterLimit).toBe(50000);
      expect(result.products).toBeUndefined();
      expect(result.apiKeyCharacterCount).toBeUndefined();
      expect(result.startTime).toBeUndefined();
    });
  });

  describe('getSupportedLanguages()', () => {
    it('should make correct HTTP GET request for source languages', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .get('/v2/languages')
        .query({ type: 'source' })
        .reply(200, [
          { language: 'EN', name: 'English' },
          { language: 'DE', name: 'German' },
        ]);

      const result = await client.getSupportedLanguages('source');

      expect(result).toEqual([
        { language: 'en', name: 'English' },
        { language: 'de', name: 'German' },
      ]);
      expect(scope.isDone()).toBe(true);
    });

    it('should make correct HTTP GET request for target languages', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .get('/v2/languages')
        .query({ type: 'target' })
        .reply(200, [
          { language: 'ES', name: 'Spanish' },
          { language: 'FR', name: 'French' },
        ]);

      const result = await client.getSupportedLanguages('target');

      expect(result).toEqual([
        { language: 'es', name: 'Spanish' },
        { language: 'fr', name: 'French' },
      ]);
      expect(scope.isDone()).toBe(true);
    });

    it('should normalize language codes to lowercase', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/languages')
        .query({ type: 'source' })
        .reply(200, [{ language: 'EN-US', name: 'English (American)' }]);

      const result = await client.getSupportedLanguages('source');

      expect(result[0]?.language).toBe('en-us');
    });

    it('should parse supports_formality for target languages', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/languages')
        .query({ type: 'target' })
        .reply(200, [
          { language: 'DE', name: 'German', supports_formality: true },
          { language: 'EN-US', name: 'English (American)', supports_formality: false },
        ]);

      const result = await client.getSupportedLanguages('target');

      expect(result[0]?.supportsFormality).toBe(true);
      expect(result[1]?.supportsFormality).toBe(false);
    });

    it('should omit supportsFormality when not in response', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/languages')
        .query({ type: 'source' })
        .reply(200, [{ language: 'EN', name: 'English' }]);

      const result = await client.getSupportedLanguages('source');

      expect(result[0]?.supportsFormality).toBeUndefined();
    });
  });

  describe('improveText() - Write API', () => {
    it('should make correct HTTP POST request for text improvement', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/write/rephrase', (body) => {
          expect(body.text).toBe('Hello world');
          expect(body.target_lang).toBe('en-US');
          return true;
        })
        .reply(200, {
          improvements: [{ text: 'Hello, world!', target_language: 'en-US' }],
        });

      const result = await client.improveText('Hello world', { targetLang: 'en-US' });

      expect(result[0]?.text).toBe('Hello, world!');
      expect(result[0]?.targetLanguage).toBe('en-US');
      expect(scope.isDone()).toBe(true);
    });

    it('should include writing style when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/write/rephrase', (body) => {
          expect(body.writing_style).toBe('business');
          return true;
        })
        .reply(200, {
          improvements: [{ text: 'Improved text', target_language: 'en-US' }],
        });

      await client.improveText('Test', { targetLang: 'en-US', writingStyle: 'business' });
      expect(scope.isDone()).toBe(true);
    });

    it('should include tone when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/write/rephrase', (body) => {
          expect(body.tone).toBe('friendly');
          return true;
        })
        .reply(200, {
          improvements: [{ text: 'Improved text', target_language: 'en-US' }],
        });

      await client.improveText('Test', { targetLang: 'en-US', tone: 'friendly' });
      expect(scope.isDone()).toBe(true);
    });

  });

  describe('custom API URLs', () => {
    it('should use custom baseUrl when provided', async () => {
      const customUrl = 'https://custom-api.example.com';
      const client = new DeepLClient(API_KEY, { baseUrl: customUrl });
      clients.push(client);

      const scope = nock(customUrl)
        .get('/v2/usage')
        .reply(200, {
          character_count: 100,
          character_limit: 500,
        });

      await client.getUsage();
      expect(scope.isDone()).toBe(true);
    });

    it('should use pro API URL when usePro is true', async () => {
      const client = new DeepLClient(API_KEY, { usePro: true });
      clients.push(client);

      const scope = nock(PRO_API_URL)
        .get('/v2/usage')
        .reply(200, {
          character_count: 100,
          character_limit: 500,
        });

      await client.getUsage();
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('uploadDocument() - Document API', () => {
    it('should make correct HTTP POST with multipart/form-data', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test pdf content');

      const scope = nock(FREE_API_URL)
        .post('/v2/document', (body) => {
          // Verify multipart/form-data contains file and target_lang
          return body.includes('test pdf content') && body.includes('target_lang');
        })
        .reply(200, {
          document_id: 'doc-123',
          document_key: 'key-456',
        });

      const result = await client.uploadDocument(fileBuffer, {
        targetLang: 'es',
        filename: 'test.pdf',
      });

      expect(result.documentId).toBe('doc-123');
      expect(result.documentKey).toBe('key-456');
      expect(scope.isDone()).toBe(true);
    });

    it('should include source language when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      const scope = nock(FREE_API_URL)
        .post('/v2/document', (body) => {
          return body.includes('source_lang') && body.includes('EN');
        })
        .reply(200, {
          document_id: 'doc-123',
          document_key: 'key-456',
        });

      await client.uploadDocument(fileBuffer, {
        targetLang: 'es',
        sourceLang: 'en',
        filename: 'test.pdf',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should include formality when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      const scope = nock(FREE_API_URL)
        .post('/v2/document', (body) => {
          return body.includes('formality') && body.includes('more');
        })
        .reply(200, {
          document_id: 'doc-123',
          document_key: 'key-456',
        });

      await client.uploadDocument(fileBuffer, {
        targetLang: 'es',
        formality: 'more',
        filename: 'test.pdf',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should include glossary ID when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      const scope = nock(FREE_API_URL)
        .post('/v2/document', (body) => {
          return body.includes('glossary_id') && body.includes('glossary-123');
        })
        .reply(200, {
          document_id: 'doc-123',
          document_key: 'key-456',
        });

      await client.uploadDocument(fileBuffer, {
        targetLang: 'es',
        glossaryId: 'glossary-123',
        filename: 'test.pdf',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should include output_format when specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      const scope = nock(FREE_API_URL)
        .post('/v2/document', (body) => {
          return body.includes('output_format') && body.includes('pdf');
        })
        .reply(200, {
          document_id: 'doc-123',
          document_key: 'key-456',
        });

      await client.uploadDocument(fileBuffer, {
        targetLang: 'es',
        outputFormat: 'pdf',
        filename: 'test.docx',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should not include output_format when not specified', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      const scope = nock(FREE_API_URL)
        .post('/v2/document', (body) => {
          return !body.includes('output_format');
        })
        .reply(200, {
          document_id: 'doc-123',
          document_key: 'key-456',
        });

      await client.uploadDocument(fileBuffer, {
        targetLang: 'es',
        filename: 'test.pdf',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should use correct Authorization header', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      const scope = nock(FREE_API_URL, {
        reqheaders: {
          'authorization': `DeepL-Auth-Key ${API_KEY}`,
        },
      })
        .post('/v2/document')
        .reply(200, {
          document_id: 'doc-123',
          document_key: 'key-456',
        });

      await client.uploadDocument(fileBuffer, {
        targetLang: 'es',
        filename: 'test.pdf',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should throw error for empty file buffer', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      await expect(
        client.uploadDocument(Buffer.from(''), {
          targetLang: 'es',
          filename: 'test.pdf',
        })
      ).rejects.toThrow('Document file cannot be empty');
    });

    it('should throw error for missing filename', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      await expect(
        client.uploadDocument(fileBuffer, {
          targetLang: 'es',
          filename: undefined as any,
        })
      ).rejects.toThrow('filename is required');
    });

    it('should handle 403 authentication errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      nock(FREE_API_URL).post('/v2/document').reply(403, { message: 'Invalid API key' });

      await expect(
        client.uploadDocument(fileBuffer, {
          targetLang: 'es',
          filename: 'test.pdf',
        })
      ).rejects.toThrow('Authentication failed');
    });

    it('should handle 413 file too large errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const fileBuffer = Buffer.from('test content');

      nock(FREE_API_URL).post('/v2/document').reply(413, { message: 'File too large' });

      await expect(
        client.uploadDocument(fileBuffer, {
          targetLang: 'es',
          filename: 'test.pdf',
        })
      ).rejects.toThrow('API error');
    });
  });

  describe('getDocumentStatus() - Document API', () => {
    it('should make correct HTTP POST with document_key', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL)
        .post('/v2/document/doc-123', (body) => {
          // nock parses form-encoded body as object
          expect(body.document_key).toBe('key-456');
          return true;
        })
        .reply(200, {
          document_id: 'doc-123',
          status: 'done',
          billed_characters: 500,
        });

      const result = await client.getDocumentStatus({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(result.documentId).toBe('doc-123');
      expect(result.status).toBe('done');
      expect(result.billedCharacters).toBe(500);
      expect(scope.isDone()).toBe(true);
    });

    it('should return status "queued"', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/document/doc-123')
        .reply(200, {
          document_id: 'doc-123',
          status: 'queued',
        });

      const result = await client.getDocumentStatus({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(result.status).toBe('queued');
      expect(result.secondsRemaining).toBeUndefined();
      expect(result.billedCharacters).toBeUndefined();
    });

    it('should return status "translating" with seconds remaining', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/document/doc-123')
        .reply(200, {
          document_id: 'doc-123',
          status: 'translating',
          seconds_remaining: 10,
        });

      const result = await client.getDocumentStatus({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(result.status).toBe('translating');
      expect(result.secondsRemaining).toBe(10);
    });

    it('should return status "done" with billed characters', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/document/doc-123')
        .reply(200, {
          document_id: 'doc-123',
          status: 'done',
          billed_characters: 1234,
        });

      const result = await client.getDocumentStatus({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(result.status).toBe('done');
      expect(result.billedCharacters).toBe(1234);
    });

    it('should return status "error" with error message', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/document/doc-123')
        .reply(200, {
          document_id: 'doc-123',
          status: 'error',
          error_message: 'Unsupported file format',
        });

      const result = await client.getDocumentStatus({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(result.status).toBe('error');
      expect(result.errorMessage).toBe('Unsupported file format');
    });

    it('should use form-encoded content type', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL, {
        reqheaders: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      })
        .post('/v2/document/doc-123')
        .reply(200, {
          document_id: 'doc-123',
          status: 'done',
        });

      await client.getDocumentStatus({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should handle 404 document not found errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/document/doc-nonexistent')
        .reply(404, { message: 'Document not found' });

      await expect(
        client.getDocumentStatus({
          documentId: 'doc-nonexistent',
          documentKey: 'key-456',
        })
      ).rejects.toThrow('API error');
    });
  });

  describe('downloadDocument() - Document API', () => {
    it('should make correct HTTP POST and return buffer', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const translatedContent = Buffer.from('translated content');

      const scope = nock(FREE_API_URL)
        .post('/v2/document/doc-123/result', (body) => {
          // nock parses form-encoded body as object
          expect(body.document_key).toBe('key-456');
          return true;
        })
        .reply(200, translatedContent);

      const result = await client.downloadDocument({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('translated content');
      expect(scope.isDone()).toBe(true);
    });

    it('should handle binary content (PDF)', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      const pdfContent = Buffer.from([0x25, 0x50, 0x44, 0x46]); // PDF header bytes

      nock(FREE_API_URL)
        .post('/v2/document/doc-123/result')
        .reply(200, pdfContent);

      const result = await client.downloadDocument({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result[0]).toBe(0x25);
      expect(result[1]).toBe(0x50);
      expect(result[2]).toBe(0x44);
      expect(result[3]).toBe(0x46);
    });

    it('should use form-encoded content type', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      const scope = nock(FREE_API_URL, {
        reqheaders: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      })
        .post('/v2/document/doc-123/result')
        .reply(200, Buffer.from('translated'));

      await client.downloadDocument({
        documentId: 'doc-123',
        documentKey: 'key-456',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should handle 404 document not found errors', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/document/doc-nonexistent/result')
        .reply(404, { message: 'Document not found' });

      await expect(
        client.downloadDocument({
          documentId: 'doc-nonexistent',
          documentKey: 'key-456',
        })
      ).rejects.toThrow('API error');
    });

    it('should handle 503 document not ready errors', async () => {
      const client = new DeepLClient(API_KEY, { maxRetries: 0 });
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/document/doc-123/result')
        .reply(503, { message: 'Document not ready yet' });

      await expect(
        client.downloadDocument({
          documentId: 'doc-123',
          documentKey: 'key-456',
        })
      ).rejects.toThrow('Service temporarily unavailable');
    });
  });

  describe('X-Trace-ID handling', () => {
    it('should capture trace ID from successful response', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Hola' }] }, {
          'x-trace-id': 'abc-123-trace',
        });

      await client.translate('Hello', { targetLang: 'es' });
      expect(client.lastTraceId).toBe('abc-123-trace');
    });

    it('should capture trace ID from error response', async () => {
      expect.assertions(1);
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(403, { message: 'Invalid API key' }, {
          'x-trace-id': 'err-456-trace',
        });

      try {
        await client.getUsage();
      } catch {
        // expected error
      }
      expect(client.lastTraceId).toBe('err-456-trace');
    });

    it('should include trace ID in error messages', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .get('/v2/usage')
        .reply(403, { message: 'Invalid API key' }, {
          'x-trace-id': 'trace-for-support',
        });

      await expect(client.getUsage()).rejects.toThrow('Trace ID: trace-for-support');
    });

    it('should return undefined when no trace ID present', () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);
      expect(client.lastTraceId).toBeUndefined();
    });

    it('should update trace ID on each request', async () => {
      const client = new DeepLClient(API_KEY);
      clients.push(client);

      nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Hola' }] }, {
          'x-trace-id': 'first-trace',
        });

      await client.translate('Hello', { targetLang: 'es' });
      expect(client.lastTraceId).toBe('first-trace');

      nock(FREE_API_URL)
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Bonjour' }] }, {
          'x-trace-id': 'second-trace',
        });

      await client.translate('Hello', { targetLang: 'fr' });
      expect(client.lastTraceId).toBe('second-trace');
    });
  });
});

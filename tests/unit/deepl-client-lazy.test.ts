/**
 * Tests for lazy sub-client construction in DeepLClient.
 */

import nock from 'nock';

describe('DeepLClient lazy sub-client construction', () => {
  const apiKey = 'test-api-key';
  const baseUrl = 'https://api-free.deepl.com';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should still validate API key eagerly', () => {
     
    const { DeepLClient } = require('../../src/api/deepl-client') as typeof import('../../src/api/deepl-client');
    expect(() => new DeepLClient('')).toThrow('API key is required');
  });

  it('should construct sub-clients lazily on first method call', async () => {
     
    const { DeepLClient } = require('../../src/api/deepl-client') as typeof import('../../src/api/deepl-client');
    const client = new DeepLClient(apiKey);

    // At this point, only static validation ran (no HttpClient instance created).
    // The actual sub-clients should not exist yet.
    // We test this by verifying the private fields are undefined.
    expect((client as any)._translationClient).toBeUndefined();
    expect((client as any)._glossaryClient).toBeUndefined();
    expect((client as any)._documentClient).toBeUndefined();
    expect((client as any)._writeClient).toBeUndefined();
    expect((client as any)._styleRulesClient).toBeUndefined();
    expect((client as any)._adminClient).toBeUndefined();

    // Now make a translate call - this should create TranslationClient
    nock(baseUrl).post('/v2/translate').reply(200, {
      translations: [{ text: 'Hola', detected_source_language: 'EN' }],
    });

    await client.translate('Hello', { targetLang: 'es' });

    expect((client as any)._translationClient).not.toBeNull();
    // Other clients should still be undefined
    expect((client as any)._glossaryClient).toBeUndefined();
    expect((client as any)._documentClient).toBeUndefined();
    expect((client as any)._writeClient).toBeUndefined();
    expect((client as any)._styleRulesClient).toBeUndefined();
    expect((client as any)._adminClient).toBeUndefined();
  });

  it('should reuse sub-client on subsequent calls', async () => {
     
    const { DeepLClient } = require('../../src/api/deepl-client') as typeof import('../../src/api/deepl-client');
    const client = new DeepLClient(apiKey);

    nock(baseUrl).post('/v2/translate').reply(200, {
      translations: [{ text: 'Hola', detected_source_language: 'EN' }],
    });
    await client.translate('Hello', { targetLang: 'es' });
    const firstClient = (client as any)._translationClient;

    nock(baseUrl).post('/v2/translate').reply(200, {
      translations: [{ text: 'Bonjour', detected_source_language: 'EN' }],
    });
    await client.translate('Hello', { targetLang: 'fr' });
    const secondClient = (client as any)._translationClient;

    expect(firstClient).toBe(secondClient);
  });

  it('should construct GlossaryClient lazily on glossary method call', async () => {
     
    const { DeepLClient } = require('../../src/api/deepl-client') as typeof import('../../src/api/deepl-client');
    const client = new DeepLClient(apiKey);

    expect((client as any)._glossaryClient).toBeUndefined();

    nock(baseUrl).get('/v3/glossaries').reply(200, { glossaries: [] });
    await client.listGlossaries();

    expect((client as any)._glossaryClient).not.toBeNull();
    expect((client as any)._translationClient).toBeUndefined();
  });

  it('should construct WriteClient lazily on improveText call', async () => {
     
    const { DeepLClient } = require('../../src/api/deepl-client') as typeof import('../../src/api/deepl-client');
    const client = new DeepLClient(apiKey);

    expect((client as any)._writeClient).toBeUndefined();

    nock(baseUrl).post('/v2/write/rephrase').reply(200, {
      improvements: [{ text: 'Improved.', target_language: 'en-US' }],
    });
    await client.improveText('Test.', { targetLang: 'en-US' });

    expect((client as any)._writeClient).not.toBeNull();
    expect((client as any)._translationClient).toBeUndefined();
  });

  it('should construct AdminClient lazily on listApiKeys call', async () => {
     
    const { DeepLClient } = require('../../src/api/deepl-client') as typeof import('../../src/api/deepl-client');
    const client = new DeepLClient(apiKey);

    expect((client as any)._adminClient).toBeUndefined();

    nock(baseUrl).get('/v2/admin/developer-keys').reply(200, []);
    await client.listApiKeys();

    expect((client as any)._adminClient).not.toBeNull();
    expect((client as any)._translationClient).toBeUndefined();
  });

  it('should construct StyleRulesClient lazily on getStyleRules call', async () => {
     
    const { DeepLClient } = require('../../src/api/deepl-client') as typeof import('../../src/api/deepl-client');
    const client = new DeepLClient(apiKey);

    expect((client as any)._styleRulesClient).toBeUndefined();

    nock(baseUrl).get('/v3/style_rules').reply(200, { style_rules: [] });
    await client.getStyleRules();

    expect((client as any)._styleRulesClient).not.toBeNull();
    expect((client as any)._translationClient).toBeUndefined();
  });
});

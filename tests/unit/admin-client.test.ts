/**
 * Tests for AdminClient
 * Verifies that createApiKey preserves the secret key from the API response.
 */

import nock from 'nock';
import { AdminClient } from '../../src/api/admin-client';
import { AuthError } from '../../src/utils/errors';

describe('AdminClient', () => {
  let client: AdminClient;
  const apiKey = 'test-admin-key';
  const baseUrl = 'https://api-free.deepl.com';

  beforeEach(() => {
    client = new AdminClient(apiKey);
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    client.destroy();
  });

  describe('createApiKey', () => {
    it('should preserve the secret key from the API response', async () => {
      nock(baseUrl)
        .post('/v2/admin/developer-keys')
        .reply(200, {
          key_id: 'new-key-id',
          key: 'dl-api-secret-abc123',
          label: 'CI Key',
          creation_time: '2024-06-01T12:00:00Z',
          is_deactivated: false,
          usage_limits: { characters: null },
        });

      const result = await client.createApiKey('CI Key');
      expect(result.key).toBe('dl-api-secret-abc123');
      expect(result.keyId).toBe('new-key-id');
      expect(result.label).toBe('CI Key');
    });

    it('should handle response without a key field', async () => {
      nock(baseUrl)
        .post('/v2/admin/developer-keys')
        .reply(200, {
          key_id: 'existing-key-id',
          label: 'Some Key',
          creation_time: '2024-06-01T12:00:00Z',
          is_deactivated: false,
        });

      const result = await client.createApiKey('Some Key');
      expect(result.key).toBeUndefined();
      expect(result.keyId).toBe('existing-key-id');
    });
  });

  describe('setApiKeyLimit', () => {
    it('should send characters-only limit when STT is not specified', async () => {
      const scope = nock(baseUrl)
        .put('/v2/admin/developer-keys/limits', { key_id: 'key-1', characters: 1000000 })
        .reply(200);

      await client.setApiKeyLimit('key-1', 1000000);
      expect(scope.isDone()).toBe(true);
    });

    it('should send both characters and STT limits', async () => {
      const scope = nock(baseUrl)
        .put('/v2/admin/developer-keys/limits', {
          key_id: 'key-1',
          characters: 1000000,
          speech_to_text_milliseconds: 3600000,
        })
        .reply(200);

      await client.setApiKeyLimit('key-1', 1000000, 3600000);
      expect(scope.isDone()).toBe(true);
    });

    it('should send null for unlimited STT', async () => {
      const scope = nock(baseUrl)
        .put('/v2/admin/developer-keys/limits', {
          key_id: 'key-1',
          characters: null,
          speech_to_text_milliseconds: null,
        })
        .reply(200);

      await client.setApiKeyLimit('key-1', null, null);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('listApiKeys', () => {
    it('should not include key field for listed keys', async () => {
      nock(baseUrl)
        .get('/v2/admin/developer-keys')
        .reply(200, [
          {
            key_id: 'key-1',
            label: 'Prod Key',
            creation_time: '2024-01-01T00:00:00Z',
            is_deactivated: false,
          },
        ]);

      const result = await client.listApiKeys();
      expect(result).toHaveLength(1);
      const first = result[0]!;
      expect(first.key).toBeUndefined();
      expect(first.keyId).toBe('key-1');
    });

    it('should normalize speech_to_text_milliseconds from usage_limits', async () => {
      nock(baseUrl)
        .get('/v2/admin/developer-keys')
        .reply(200, [
          {
            key_id: 'key-2',
            label: 'Voice Key',
            creation_time: '2024-01-01T00:00:00Z',
            is_deactivated: false,
            usage_limits: { characters: null, speech_to_text_milliseconds: 7200000 },
          },
        ]);

      const result = await client.listApiKeys();
      expect(result[0]!.usageLimits?.speechToTextMilliseconds).toBe(7200000);
    });
  });

  describe('authentication errors', () => {
    it('should suggest an administrator key on 403 instead of re-setting the key', async () => {
      expect.assertions(3);
      nock(baseUrl).get('/v2/admin/developer-keys').reply(403, {});

      let caught: unknown;
      try {
        await client.listApiKeys();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AuthError);
      const authError = caught as AuthError;
      expect(authError.suggestion).toMatch(/administrator/i);
      expect(authError.suggestion).not.toMatch(/set-key|deepl init/i);
    });

    it('should suggest an administrator key on 401', async () => {
      expect.assertions(2);
      nock(baseUrl).get('/v2/admin/developer-keys').reply(401, {});

      let caught: unknown;
      try {
        await client.listApiKeys();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AuthError);
      expect((caught as AuthError).suggestion).toMatch(/administrator/i);
    });
  });
});

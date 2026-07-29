/**
 * Retry-policy and transport-error classification tests for HttpClient.
 *
 * Every assertion here counts SERVER-SIDE requests: a replay of a
 * non-idempotent request is only observable from the server's side, so
 * `.rejects.toThrow()` alone cannot catch it.
 */

import nock from 'nock';
import { HttpClient } from '../../src/api/http-client';
import {
  AuthError,
  NetworkError,
  RateLimitError,
  ValidationError,
} from '../../src/utils/errors';
import { ExitCode, exitCodeForError } from '../../src/utils/exit-codes';

class TestHttpClient extends HttpClient {
  get<T>(path: string): Promise<T> {
    return this.makeRequest<T>('GET', path);
  }

  post<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    return this.makeRequest<T>('POST', path, data);
  }

  put<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    return this.makeRequest<T>('PUT', path, data);
  }

  delete<T>(path: string): Promise<T> {
    return this.makeRequest<T>('DELETE', path);
  }

  classify(error: unknown): Error {
    return this.handleError(error);
  }
}

const BASE_URL = 'https://api-free.deepl.com';

describe('HttpClient retry policy', () => {
  const apiKey = 'test-api-key';
  let clients: TestHttpClient[];
  let sleepSpy: jest.SpyInstance;

  function makeClient(options: Record<string, unknown> = {}): TestHttpClient {
    const client = new TestHttpClient(apiKey, {
      timeout: 200,
      maxRetries: 3,
      totalTimeout: 10_000,
      ...options,
    });
    sleepSpy = jest
      .spyOn(client as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue();
    clients.push(client);
    return client;
  }

  /** nock only produces a coded transport error from a real Error instance. */
  function transportError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
  }

  /** Counts requests the server actually received for `path`. */
  function countRequests(scope: nock.Scope): () => number {
    let count = 0;
    scope.on('request', () => {
      count++;
    });
    return () => count;
  }

  beforeEach(() => {
    clients = [];
  });

  // Interceptors left unconsumed are the point of several tests here (a
  // request that must NOT be replayed leaves its spare interceptors
  // pending), so clean up before the global pending-mock assertion runs.
  // The replyWithError-based blocks sit at the end of the file: nock v14
  // emits async socket errors from them that leak into later tests.
  afterEach(() => {
    for (const client of clients) {
      client.destroy();
    }
    nock.abortPendingRequests();
    nock.cleanAll();
  });

  describe('client-side timeout', () => {
    it('sends a POST exactly once when the client aborts on timeout', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .delayConnection(2000)
        .reply(200, { translations: [{ text: 'Hola' }] });
      const requests = countRequests(scope);

      await expect(makeClient().post('/v2/translate', { text: 'Hello' })).rejects.toThrow(
        NetworkError
      );

      expect(requests()).toBe(1);
    });

    it('classifies a client-side timeout as a network error (exit 5), not invalid input', async () => {
      nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .delayConnection(2000)
        .reply(200, { translations: [{ text: 'Hola' }] });

      const error = await makeClient()
        .post('/v2/translate', { text: 'Hello' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
      expect(exitCodeForError(error)).toBe(ExitCode.NetworkError);
    });

    it('retries an idempotent GET that times out', async () => {
      const scope = nock(BASE_URL)
        .get('/v2/usage')
        .times(4)
        .delayConnection(2000)
        .reply(200, {});
      const requests = countRequests(scope);

      await expect(makeClient().get('/v2/usage')).rejects.toThrow(NetworkError);

      expect(requests()).toBe(4);
    });

    it('retries an idempotent PUT that times out', async () => {
      const scope = nock(BASE_URL)
        .put('/v3/glossaries/g-1')
        .times(4)
        .delayConnection(2000)
        .reply(200, {});
      const requests = countRequests(scope);

      await expect(makeClient().put('/v3/glossaries/g-1', { name: 'x' })).rejects.toThrow(
        NetworkError
      );

      expect(requests()).toBe(4);
    });
  });

  describe('server errors', () => {
    it('retries a 500 on an idempotent GET', async () => {
      const scope = nock(BASE_URL).get('/v2/usage').times(4).reply(500, { message: 'boom' });
      const requests = countRequests(scope);

      await expect(makeClient().get('/v2/usage')).rejects.toThrow(NetworkError);

      expect(requests()).toBe(4);
    });

    it('does not retry a 500 on a POST', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .reply(500, { message: 'boom' });
      const requests = countRequests(scope);

      await expect(makeClient().post('/v2/translate', { text: 'Hello' })).rejects.toThrow(
        /Server error \(500\)/
      );

      expect(requests()).toBe(1);
    });

    it('does not retry a 503 on a POST', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .reply(503, { message: 'Service Unavailable' });
      const requests = countRequests(scope);

      await expect(makeClient().post('/v2/translate', { text: 'Hello' })).rejects.toThrow(
        /Service temporarily unavailable/
      );

      expect(requests()).toBe(1);
    });

    // A 429 proves the server received and rejected the request without
    // processing it, so replaying it cannot duplicate billable work — the
    // idempotency restriction does not apply.
    it('retries a POST on 429 and honours Retry-After', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .reply(429, { message: 'Too many requests' }, { 'Retry-After': '2' });
      const requests = countRequests(scope);
      const retryScope = nock(BASE_URL)
        .post('/v2/translate')
        .reply(200, { translations: [{ text: 'Hola' }] });
      const retryRequests = countRequests(retryScope);

      const client = makeClient();
      const result = await client.post<{ translations: { text: string }[] }>(
        '/v2/translate',
        { text: 'Hello' }
      );

      expect(result.translations[0]!.text).toBe('Hola');
      expect(requests()).toBe(1);
      expect(retryRequests()).toBe(1);
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(2000);
    });

    it('still retries a POST on 429 — the server rejected it without processing', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .reply(429, { message: 'Too many requests' });
      const requests = countRequests(scope);

      await expect(makeClient().post('/v2/translate', { text: 'Hello' })).rejects.toThrow(
        RateLimitError
      );

      expect(requests()).toBe(4);
    });
  });

  describe('401 handling', () => {
    it('maps 401 to AuthError without retrying', async () => {
      const scope = nock(BASE_URL).get('/v2/usage').times(4).reply(401, { message: 'Unauthorized' });
      const requests = countRequests(scope);

      const error = await makeClient()
        .get('/v2/usage')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AuthError);
      expect(exitCodeForError(error)).toBe(ExitCode.AuthError);
      expect(requests()).toBe(1);
    });
  });

  describe('total deadline', () => {
    it('stops retrying an idempotent request once the overall budget is spent', async () => {
      const scope = nock(BASE_URL)
        .get('/v2/usage')
        .times(6)
        .delayConnection(2000)
        .reply(200, {});
      const requests = countRequests(scope);

      const client = makeClient({ timeout: 200, maxRetries: 5, totalTimeout: 500 });
      const start = Date.now();
      await expect(client.get('/v2/usage')).rejects.toThrow(NetworkError);
      const elapsed = Date.now() - start;

      // Retries happen, but the budget cuts them short of maxRetries + 1 = 6.
      expect(requests()).toBeGreaterThanOrEqual(2);
      expect(requests()).toBeLessThanOrEqual(3);
      expect(elapsed).toBeLessThan(1500);
    });

    it('derives a default deadline from the request timeout', async () => {
      const scope = nock(BASE_URL)
        .get('/v2/usage')
        .times(6)
        .delayConnection(2000)
        .reply(200, {});
      const requests = countRequests(scope);

      const client = makeClient({ timeout: 200, maxRetries: 5, totalTimeout: undefined });
      await expect(client.get('/v2/usage')).rejects.toThrow(NetworkError);

      // Default budget is twice the timeout, so far short of six attempts.
      expect(requests()).toBeGreaterThanOrEqual(2);
      expect(requests()).toBeLessThanOrEqual(3);
    });
  });

  describe('transport failures', () => {
    it('retries a POST when the connection was refused', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .replyWithError(transportError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443'));
      const requests = countRequests(scope);

      await expect(makeClient().post('/v2/translate', { text: 'Hello' })).rejects.toThrow(
        NetworkError
      );

      expect(requests()).toBe(4);
    });

    it('retries a POST when DNS resolution failed', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .replyWithError(transportError('ENOTFOUND', 'getaddrinfo ENOTFOUND api-free.deepl.com'));
      const requests = countRequests(scope);

      await expect(makeClient().post('/v2/translate', { text: 'Hello' })).rejects.toThrow(
        NetworkError
      );

      expect(requests()).toBe(4);
    });

    it('does not retry a POST reset mid-flight — the request may have been accepted', async () => {
      const scope = nock(BASE_URL)
        .post('/v2/translate')
        .times(4)
        .replyWithError(transportError('ECONNRESET', 'socket hang up'));
      const requests = countRequests(scope);

      await expect(makeClient().post('/v2/translate', { text: 'Hello' })).rejects.toThrow(
        NetworkError
      );

      expect(requests()).toBe(1);
    });
  });

  describe('error messages', () => {
    it('does not double the "Network error" prefix', async () => {
      nock(BASE_URL).post('/v2/translate').replyWithError('Network error');

      const error = await makeClient()
        .post('/v2/translate', { text: 'Hello' })
        .catch((e: unknown) => e);

      expect((error as Error).message).not.toMatch(/Network error: Network error/);
    });

    it('leaves an already-classified error untouched', () => {
      const classified = new ValidationError('API error: Tone is not supported');

      expect(makeClient().classify(classified)).toBe(classified);
    });
  });
});

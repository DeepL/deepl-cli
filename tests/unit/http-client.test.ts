import nock from 'nock';
import { HttpClient } from '../../src/api/http-client';
import { NetworkError } from '../../src/utils/errors';

class TestHttpClient extends HttpClient {
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.makeRequest<T>('GET', path, params);
  }

  callParseRetryAfter(value: string | undefined): number | undefined {
    return this.parseRetryAfter(value);
  }
}

describe('HttpClient', () => {
  const apiKey = 'test-api-key';
  const baseUrl = 'https://api-free.deepl.com';
  let client: TestHttpClient;
  let sleepSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    client = new TestHttpClient(apiKey, { maxRetries: 3 });
    sleepSpy = jest.spyOn(client as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue();
    nock.cleanAll();
  });

  afterEach(() => {
    jest.useRealTimers();
    nock.cleanAll();
  });

  describe('Retry-After header parsing', () => {
    it('should parse numeric Retry-After value as seconds', () => {
      expect(client.callParseRetryAfter('5')).toBe(5000);
    });

    it('should parse Retry-After: 0 as immediate retry', () => {
      expect(client.callParseRetryAfter('0')).toBe(0);
    });

    it('should return undefined for missing Retry-After', () => {
      expect(client.callParseRetryAfter(undefined)).toBeUndefined();
    });

    it('should cap Retry-After exceeding 60 seconds', () => {
      expect(client.callParseRetryAfter('120')).toBe(60000);
    });

    it('should return undefined for invalid Retry-After value', () => {
      expect(client.callParseRetryAfter('not-a-number-or-date')).toBeUndefined();
    });

    it('should parse HTTP date format Retry-After', () => {
      const futureDate = new Date(Date.now() + 10000);
      const result = client.callParseRetryAfter(futureDate.toUTCString());
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(0);
      expect(result!).toBeLessThanOrEqual(11000);
    });

    it('should treat past HTTP date as 0 delay', () => {
      const pastDate = new Date(Date.now() - 5000);
      expect(client.callParseRetryAfter(pastDate.toUTCString())).toBe(0);
    });

    it('should cap HTTP date Retry-After exceeding 60 seconds', () => {
      const farFuture = new Date(Date.now() + 120000);
      expect(client.callParseRetryAfter(farFuture.toUTCString())).toBe(60000);
    });

    it('should handle negative numeric Retry-After as 0', () => {
      expect(client.callParseRetryAfter('-5')).toBe(0);
    });
  });

  describe('429 retry behavior', () => {
    it('should retry on 429 with Retry-After: 5 and wait 5 seconds', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' }, { 'Retry-After': '5' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(200, { result: 'ok' });

      const result = await client.get<{ result: string }>('/v2/test');

      expect(result).toEqual({ result: 'ok' });
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(5000);
    });

    it('should retry immediately on 429 with Retry-After: 0', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' }, { 'Retry-After': '0' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(200, { result: 'ok' });

      const result = await client.get<{ result: string }>('/v2/test');

      expect(result).toEqual({ result: 'ok' });
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(0);
    });

    it('should use jittered exponential backoff on 429 without Retry-After', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(200, { result: 'ok' });

      const result = await client.get<{ result: string }>('/v2/test');

      expect(result).toEqual({ result: 'ok' });
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      // Full jitter: attempt 0 → random in [0, INIT * 2^0] = [0, 1000]
      const delay = sleepSpy.mock.calls[0][0] as number;
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000);
    });

    it('should cap Retry-After at 60 seconds', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' }, { 'Retry-After': '300' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(200, { result: 'ok' });

      const result = await client.get<{ result: string }>('/v2/test');

      expect(result).toEqual({ result: 'ok' });
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(60000);
    });

    it('should fall back to jittered exponential backoff on invalid Retry-After', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' }, { 'Retry-After': 'garbage' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(200, { result: 'ok' });

      const result = await client.get<{ result: string }>('/v2/test');

      expect(result).toEqual({ result: 'ok' });
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      const delay = sleepSpy.mock.calls[0][0] as number;
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000);
    });

    it('should handle Retry-After as HTTP date format', async () => {
      const futureDate = new Date(Date.now() + 10000);
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' }, { 'Retry-After': futureDate.toUTCString() });
      nock(baseUrl)
        .get('/v2/test')
        .reply(200, { result: 'ok' });

      const result = await client.get<{ result: string }>('/v2/test');

      expect(result).toEqual({ result: 'ok' });
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      const delay = sleepSpy.mock.calls[0][0] as number;
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(11000);
    });

    it('should use jittered exponential backoff across multiple 429 retries without Retry-After', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(429, { message: 'Too many requests' });
      nock(baseUrl)
        .get('/v2/test')
        .reply(200, { result: 'ok' });

      const result = await client.get<{ result: string }>('/v2/test');

      expect(result).toEqual({ result: 'ok' });
      expect(sleepSpy).toHaveBeenCalledTimes(3);
      // Full jitter: attempt n → random in [0, INIT * 2^n]. The caps
      // grow exponentially; each call's delay must fall within its cap.
      const delay1 = sleepSpy.mock.calls[0][0] as number;
      const delay2 = sleepSpy.mock.calls[1][0] as number;
      const delay3 = sleepSpy.mock.calls[2][0] as number;
      expect(delay1).toBeGreaterThanOrEqual(0);
      expect(delay1).toBeLessThanOrEqual(1000);
      expect(delay2).toBeGreaterThanOrEqual(0);
      expect(delay2).toBeLessThanOrEqual(2000);
      expect(delay3).toBeGreaterThanOrEqual(0);
      expect(delay3).toBeLessThanOrEqual(4000);
    });

    it('should throw RateLimitError after exhausting all retries on 429', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .times(4)
        .reply(429, { message: 'Too many requests' });

      await expect(client.get('/v2/test')).rejects.toThrow();
      expect(sleepSpy).toHaveBeenCalledTimes(3);
    });

    it('should still throw immediately on other 4xx errors', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .reply(403, { message: 'Forbidden' });

      await expect(client.get('/v2/test')).rejects.toThrow('Authentication failed');
      expect(sleepSpy).not.toHaveBeenCalled();
    });
  });

  describe('retry error wrapping', () => {
    it('should throw NetworkError after retry exhaustion on 500', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .times(4)
        .reply(500, { message: 'Internal Server Error' });

      await expect(client.get('/v2/test')).rejects.toThrow(NetworkError);
      expect(sleepSpy).toHaveBeenCalledTimes(3);
    });

    it('should wrap retry-exhausted errors through handleError', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .times(4)
        .reply(500, { message: 'Internal Server Error' });

      await expect(client.get('/v2/test')).rejects.toThrow(/Server error \(500\)/);
    });
  });

  describe('5xx error mapping', () => {
    it('should map 500 to NetworkError with status in message', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .times(4)
        .reply(500, { message: 'Internal Server Error' });

      try {
        await client.get('/v2/test');
        fail('Expected error');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
        expect((error as Error).message).toContain('500');
      }
    });

    it('should map 502 to NetworkError with status in message', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .times(4)
        .reply(502, { message: 'Bad Gateway' });

      try {
        await client.get('/v2/test');
        fail('Expected error');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
        expect((error as Error).message).toContain('502');
      }
    });

    it('should still map 503 to the specific service unavailable message', async () => {
      nock(baseUrl)
        .get('/v2/test')
        .times(4)
        .reply(503, { message: 'Service Unavailable' });

      try {
        await client.get('/v2/test');
        fail('Expected error');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
        expect((error as Error).message).toContain('Service temporarily unavailable');
      }
    });
  });

  describe('NO_PROXY', () => {
    const PROXY_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = Object.fromEntries(PROXY_VARS.map((name) => [name, process.env[name]]));
      PROXY_VARS.forEach((name) => delete process.env[name]);
      process.env['HTTPS_PROXY'] = 'http://proxy.example.com:8080';
    });

    afterEach(() => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });

    function proxyFor(baseUrl: string): unknown {
      const instance = new TestHttpClient(apiKey, { baseUrl });
      return (instance as unknown as { client: { defaults: { proxy?: unknown } } }).client.defaults
        .proxy;
    }

    it('uses the proxy when NO_PROXY does not match', () => {
      process.env['NO_PROXY'] = 'example.org';

      expect(proxyFor('https://api.deepl.com')).toMatchObject({ host: 'proxy.example.com' });
    });

    it.each([
      ['exact host', 'api.deepl.com', 'https://api.deepl.com'],
      ['wildcard', '*', 'https://api.deepl.com'],
      ['leading dot subdomain', '.deepl.com', 'https://api.deepl.com'],
      ['star-dot subdomain', '*.deepl.com', 'https://api.deepl.com'],
      ['host with matching port', 'localhost:8080', 'http://localhost:8080'],
      ['entry among several', 'foo.test,api.deepl.com,bar.test', 'https://api.deepl.com'],
      ['case-insensitive', 'API.DeepL.com', 'https://api.deepl.com'],
    ])('bypasses the proxy for %s', (_label, noProxy, target) => {
      process.env['NO_PROXY'] = noProxy;

      expect(proxyFor(target)).toBeUndefined();
    });

    it('does not bypass when only the port differs', () => {
      process.env['NO_PROXY'] = 'localhost:9999';

      expect(proxyFor('http://localhost:8080')).toMatchObject({ host: 'proxy.example.com' });
    });

    it('honours the lowercase no_proxy spelling', () => {
      process.env['no_proxy'] = 'api.deepl.com';

      expect(proxyFor('https://api.deepl.com')).toBeUndefined();
    });
  });
});

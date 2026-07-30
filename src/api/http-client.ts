import axios, { AxiosInstance, AxiosError } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { Language } from '../types/index.js';
import {
  AuthError,
  RateLimitError,
  QuotaError,
  NetworkError,
  ConfigError,
  DeepLCLIError,
  ValidationError,
} from '../utils/errors.js';
import { Logger } from '../utils/logger.js';
import { errorMessage } from '../utils/error-message.js';
import { sanitizeForTerminal } from '../utils/control-chars.js';
import { sanitizeUrl } from '../utils/sanitize-url.js';
import { VERSION } from '../version.js';
import { FREE_API_URL, PRO_API_URL } from './endpoints.js';

export { FREE_API_URL, PRO_API_URL };

export const USER_AGENT = `deepl-cli/${VERSION} node/${process.versions.node}`;

export interface ProxyConfig {
  protocol?: 'http' | 'https';
  host: string;
  port: number;
  auth?: {
    username: string;
    password: string;
  };
}

export interface DeepLClientOptions {
  usePro?: boolean;
  timeout?: number;
  maxRetries?: number;
  /** Wall-clock budget for all attempts of one request, excluding backoff
   *  sleeps. Defaults to `timeout * 2`. */
  totalTimeout?: number;
  baseUrl?: string;
  proxy?: ProxyConfig;
}

export { sanitizeUrl };

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_SOCKETS = 10;
const MAX_FREE_SOCKETS = 10;
const KEEP_ALIVE_MSECS = 1000;
const RETRY_INITIAL_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 10000;
const RETRY_AFTER_MAX_SECONDS = 60;
const TOTAL_TIMEOUT_FACTOR = 2;

/**
 * Methods a failed attempt may be replayed on. A POST is excluded because a
 * client-side abort (timeout, mid-flight reset) says nothing about whether
 * the server already accepted — and billed — the request; replaying it
 * duplicates the work (a second translation, a second uploaded document, a
 * second API key whose secret is only returned once).
 */
const IDEMPOTENT_METHODS = new Set([
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'OPTIONS',
  'TRACE',
]);

/** Transport errors that prove the request never reached the server, so even
 *  a non-idempotent request is safe to replay. */
const UNSENT_REQUEST_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** Axios codes for a request the client itself gave up on. */
const CLIENT_ABORT_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ERR_CANCELED',
]);

/** Per-request overrides for the retry policy and timeouts. */
export interface RequestPolicy {
  maxRetries?: number;
  timeout?: number;
}

/**
 * Compute a retry delay for attempt `n` with full jitter: a uniform
 * random value in `[0, min(INIT * 2^n, MAX)]`. Full jitter is the AWS-
 * recommended variant for retry-storm dampening: it removes the fixed
 * lower bound of "equal jitter" entirely, so concurrent clients that
 * all 429 simultaneously see maximum decorrelation on the next attempt.
 * Exported for unit testing; the caller pulls the randomized value
 * and passes it straight to `sleep()`.
 */
export function computeBackoffWithJitter(attempt: number): number {
  const cap = Math.min(RETRY_INITIAL_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return Math.floor(Math.random() * cap);
}

/** Prefixes a transport failure without stuttering when the underlying
 *  message already carries the label. */
function prefixNetwork(detail: string, label: string): string {
  return /^network (error|timeout)\b/i.test(detail)
    ? detail
    : `${label}: ${detail}`;
}

export class HttpClient {
  protected client: AxiosInstance;
  protected maxRetries: number;
  protected requestTimeout: number;
  protected totalTimeout: number;
  protected _lastTraceId?: string;

  /**
   * Standard NO_PROXY matching: `*` bypasses everything, a leading dot or `*.`
   * matches subdomains, and an entry may carry a port. Without this a corporate
   * HTTPS_PROXY was applied even to a localhost endpoint.
   */
  private static isProxyBypassed(targetUrl: string): boolean {
    const noProxy = process.env['NO_PROXY'] ?? process.env['no_proxy'];
    if (!noProxy) return false;

    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch {
      return false;
    }

    const host = target.hostname.toLowerCase();
    const port = target.port || (target.protocol === 'https:' ? '443' : '80');

    return noProxy
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
      .some((entry) => {
        if (entry === '*') return true;

        const [entryHost, entryPort] = entry.split(':');
        if (entryPort !== undefined && entryPort !== port) return false;

        const pattern = (entryHost ?? '').replace(/^\*\./, '.');
        if (pattern.startsWith('.')) {
          return host === pattern.slice(1) || host.endsWith(pattern);
        }
        return host === pattern;
      });
  }

  private static parseProxyFromEnv(targetUrl?: string): ProxyConfig | undefined {
    if (targetUrl !== undefined && HttpClient.isProxyBypassed(targetUrl)) {
      return undefined;
    }

    const httpProxy = process.env['HTTP_PROXY'] ?? process.env['http_proxy'];
    const httpsProxy = process.env['HTTPS_PROXY'] ?? process.env['https_proxy'];
    const proxyUrl = httpsProxy ?? httpProxy;

    if (!proxyUrl) return undefined;

    try {
      const url = new URL(proxyUrl);
      const config: ProxyConfig = {
        protocol: url.protocol.replace(':', '') as 'http' | 'https',
        host: url.hostname,
        port: parseInt(
          url.port || (url.protocol === 'https:' ? '443' : '80'),
          10
        ),
      };

      if (url.username && url.password) {
        config.auth = {
          username: url.username,
          password: url.password,
        };
      }

      return config;
    } catch (error) {
      throw new ConfigError(
        `Invalid proxy URL "${sanitizeUrl(proxyUrl)}": ${errorMessage(error)}`
      );
    }
  }

  static validateConfig(
    apiKey: string,
    options: DeepLClientOptions = {}
  ): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new AuthError('API key is required');
    }

    if (!options.proxy) {
      HttpClient.parseProxyFromEnv();
    }
  }

  constructor(apiKey: string, options: DeepLClientOptions = {}) {
    if (!apiKey || apiKey.trim() === '') {
      throw new AuthError('API key is required');
    }

    const baseURL =
      options.baseUrl ?? (options.usePro ? PRO_API_URL : FREE_API_URL);

    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.requestTimeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.totalTimeout =
      options.totalTimeout ?? this.requestTimeout * TOTAL_TIMEOUT_FACTOR;

    const axiosConfig: Record<string, unknown> = {
      baseURL,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'User-Agent': USER_AGENT,
      },
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: KEEP_ALIVE_MSECS,
        maxSockets: MAX_SOCKETS,
        maxFreeSockets: MAX_FREE_SOCKETS,
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: KEEP_ALIVE_MSECS,
        maxSockets: MAX_SOCKETS,
        maxFreeSockets: MAX_FREE_SOCKETS,
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
      }),
    };

    const proxyConfig = options.proxy ?? HttpClient.parseProxyFromEnv(baseURL);

    if (proxyConfig) {
      // SECURITY: a plain-http proxy sitting in front of an https: API
      // endpoint is a MITM footgun. axios tunnels via CONNECT so TLS is
      // nominally end-to-end, but a misconfigured or compromised proxy
      // env var routes every DeepL call — including the Authorization
      // header — through attacker infrastructure. Warn loud at startup;
      // don't refuse the connection (users with legitimate corporate
      // http-only proxies need the escape hatch).
      if (proxyConfig.protocol === 'http' && baseURL.startsWith('https:')) {
        Logger.warn(
          `Warning: routing HTTPS traffic to ${baseURL} via HTTP proxy ${proxyConfig.host}:${proxyConfig.port}. ` +
          `TLS is tunneled end-to-end via CONNECT, but a malicious proxy that terminates TLS would see the Authorization header. ` +
          `Set HTTPS_PROXY to an https:// URL if possible, or unset it if the proxy isn't required.`,
        );
      }
      axiosConfig['proxy'] = {
        protocol: proxyConfig.protocol,
        host: proxyConfig.host,
        port: proxyConfig.port,
        ...(proxyConfig.auth && { auth: proxyConfig.auth }),
      };
    }

    this.client = axios.create(axiosConfig);
  }

  destroy(): void {
    const httpAgent = this.client.defaults?.httpAgent as http.Agent | undefined;
    const httpsAgent = this.client.defaults?.httpsAgent as
      | https.Agent
      | undefined;
    httpAgent?.destroy();
    httpsAgent?.destroy();
  }

  get lastTraceId(): string | undefined {
    return this._lastTraceId;
  }

  protected async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: Record<string, unknown>
  ): Promise<T> {
    const buildConfig = (): Record<string, unknown> => {
      if (method === 'GET') {
        return { params: data };
      } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const formData = new URLSearchParams();
        if (data) {
          for (const [key, value] of Object.entries(data)) {
            if (Array.isArray(value)) {
              value.forEach((v) => formData.append(key, String(v)));
            } else {
              formData.append(key, String(value));
            }
          }
        }
        return {
          data: formData.toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        };
      }
      return {};
    };

    return this.executeWithRetry<T>(method, path, buildConfig);
  }

  protected async makeJsonRequest<T, D = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: D,
    params?: Record<string, string | number | boolean>
  ): Promise<T> {
    const buildConfig = (): Record<string, unknown> => {
      const config: Record<string, unknown> = {};

      if (params) {
        config['params'] = params;
      }

      if (method === 'GET') {
        if (data) {
          config['params'] = {
            ...(params as Record<string, unknown>),
            ...(data as Record<string, unknown>),
          };
        }
      } else if (data !== undefined) {
        config['data'] = data;
        config['headers'] = {
          'Content-Type': 'application/json',
        };
      }

      return config;
    };

    return this.executeWithRetry<T>(method, path, buildConfig);
  }

  protected async makeRawRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    buildConfig: () => Record<string, unknown>,
    policy?: RequestPolicy
  ): Promise<T> {
    return this.executeWithRetry<T>(method, path, buildConfig, policy);
  }

  protected async executeWithRetry<T>(
    method: string,
    path: string,
    buildConfig: () => Record<string, unknown>,
    policy?: RequestPolicy
  ): Promise<T> {
    const maxRetries = policy?.maxRetries ?? this.maxRetries;
    const requestTimeout = policy?.timeout ?? this.requestTimeout;
    // The budget covers time spent inside attempts only; backoff and
    // Retry-After sleeps are excluded, so an honest rate-limit wait is not
    // charged against the deadline.
    let remainingBudget = Math.max(this.totalTimeout, requestTimeout);
    let lastError: Error | undefined;
    let traceId: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const requestStart = Date.now();
      try {
        const config = buildConfig();

        const response = await this.client.request<T>({
          method,
          url: path,
          ...config,
          timeout: Math.min(requestTimeout, remainingBudget),
        });
        const requestElapsed = Date.now() - requestStart;
        Logger.verbose(
          `[verbose] HTTP ${method} ${path} completed in ${requestElapsed}ms (status ${response.status})`
        );

        const responseTraceId = response.headers?.['x-trace-id'] as
          | string
          | undefined;
        if (responseTraceId) {
          this._lastTraceId = responseTraceId;
        }

        return response.data;
      } catch (error) {
        remainingBudget -= Date.now() - requestStart;
        lastError = error as Error;

        if (this.isAxiosError(error)) {
          const responseTraceId = error.response?.headers?.['x-trace-id'] as
            | string
            | undefined;
          if (responseTraceId) {
            traceId = responseTraceId;
            this._lastTraceId = responseTraceId;
          }

          const status = error.response?.status;
          if (status === 429 && attempt < maxRetries) {
            const retryAfterDelay = this.parseRetryAfter(
              error.response?.headers?.['retry-after'] as string | undefined
            );
            // Respect Retry-After verbatim when present; otherwise use
            // backoff with full jitter. Jitter prevents concurrent sync
            // buckets that all 429 at the same moment from forming a
            // thundering herd on the next attempt.
            const delay =
              retryAfterDelay ?? computeBackoffWithJitter(attempt);
            Logger.verbose(
              `[verbose] HTTP ${method} ${path} retry ${attempt + 1}/${maxRetries} in ${delay}ms (status 429${retryAfterDelay !== null && retryAfterDelay !== undefined ? ', Retry-After' : ', jitter backoff'})`
            );
            await this.sleep(delay);
            continue;
          }
          if (status && status >= 400 && status < 500) {
            throw this.handleError(error, undefined, traceId);
          }
        }

        if (
          attempt < maxRetries &&
          remainingBudget > 0 &&
          this.isReplayable(method, error)
        ) {
          const delay = computeBackoffWithJitter(attempt);
          const status = this.isAxiosError(error) ? error.response?.status : undefined;
          Logger.verbose(
            `[verbose] HTTP ${method} ${path} retry ${attempt + 1}/${maxRetries} in ${delay}ms (${status ? `status ${status}` : 'network error'}, jitter backoff)`
          );
          await this.sleep(delay);
          continue;
        }

        break;
      }
    }

    throw lastError
      ? this.handleError(lastError, undefined, traceId)
      : new NetworkError('Request failed after retries');
  }

  /**
   * Whether a failed attempt may be sent again. 4xx responses never reach
   * here (they throw immediately) and 429 is handled above, so the cases
   * left are 5xx responses and transport failures.
   */
  private isReplayable(method: string, error: unknown): boolean {
    if (!this.isAxiosError(error)) {
      return false;
    }
    if (!error.response && error.code && UNSENT_REQUEST_CODES.has(error.code)) {
      return true;
    }
    return IDEMPOTENT_METHODS.has(method.toUpperCase());
  }

  protected handleError(
    error: unknown,
    context?: string,
    traceId?: string
  ): Error {
    const result = this.classifyError(error, traceId);
    if (context) {
      result.message = `${result.message} [${context}]`;
    }
    return result;
  }

  private classifyError(error: unknown, traceId?: string): Error {
    // Classification is idempotent: callers that wrap their own catch in
    // handleError (write-client, document-client) hand back errors this
    // method already produced, and re-deriving a class from them would
    // discard the specific one.
    if (error instanceof DeepLCLIError) {
      return error;
    }

    const requestTraceId = traceId ?? this._lastTraceId;
    const traceIdSuffix = requestTraceId
      ? ` (Trace ID: ${requestTraceId})`
      : '';

    if (this.isAxiosError(error)) {
      const status = error.response?.status;
      const responseData = error.response?.data as
        | { message?: string }
        | undefined;
      // Sanitize the server-returned message before any interpolation into
      // user-facing error strings. Defense-in-depth against a malicious or
      // buggy server scribbling ANSI escape codes / control chars on the
      // user's terminal, matching the sanitization in tms-client.ts.
      // Coalesce to '' before sanitizing — some axios error shapes have no
      // `.message` field, and sanitizeForTerminal expects a string.
      const message = sanitizeForTerminal(responseData?.message ?? error.message ?? '');

      switch (status) {
        case 401:
          return new AuthError(
            `Authentication failed: Invalid or missing API key${traceIdSuffix}`
          );
        case 403:
          return new AuthError(
            `Authentication failed: Invalid API key${traceIdSuffix}`
          );
        case 456:
          return new QuotaError(
            `Quota exceeded: Character limit reached${traceIdSuffix}`
          );
        case 429:
          return new RateLimitError(
            `Rate limit exceeded: Too many requests${traceIdSuffix}`
          );
        case 503:
          return new NetworkError(
            `Service temporarily unavailable: Please try again later${traceIdSuffix}`
          );
        default:
          if (status && status >= 500) {
            return new NetworkError(
              `Server error (${status}): ${message}${traceIdSuffix}`
            );
          }
          // No response at all means the request never completed a round
          // trip: a refused connection, a DNS failure, a reset socket, or a
          // client-side abort. All of those are network conditions, and the
          // axios `code` is the reliable signal — the message is not (a
          // timeout reads "timeout of 30000ms exceeded" and matches no
          // substring list).
          if (!error.response) {
            return this.transportError(error);
          }
          return new ValidationError(`API error: ${message}${traceIdSuffix}`);
      }
    }

    if (error instanceof Error) {
      if (this.isNetworkLevelError(error)) {
        return new NetworkError(prefixNetwork(error.message, 'Network error'));
      }
      return error;
    }

    return new NetworkError('Unknown error occurred');
  }

  private transportError(error: AxiosError): NetworkError {
    const detail = sanitizeForTerminal(error.message ?? '');
    const label =
      error.code && CLIENT_ABORT_CODES.has(error.code)
        ? 'Network timeout'
        : 'Network error';
    return new NetworkError(prefixNetwork(detail, label));
  }

  private isNetworkLevelError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up')
    );
  }

  protected normalizeLanguage(lang: string): Language {
    return lang.toLowerCase() as Language;
  }

  protected isAxiosError(error: unknown): error is AxiosError {
    return axios.isAxiosError(error);
  }

  protected parseRetryAfter(
    headerValue: string | undefined
  ): number | undefined {
    if (headerValue === undefined || headerValue === null) {
      return undefined;
    }
    // Number('') and Number('   ') are 0, which passes the finite check below
    // and returns a 0 ms delay — collapsing 429 backoff into a tight retry
    // loop against an endpoint that is already rate-limiting us.
    if (headerValue.trim() === '') {
      return undefined;
    }

    const seconds = Number(headerValue);
    if (!isNaN(seconds) && isFinite(seconds)) {
      const clamped = Math.max(0, Math.min(seconds, RETRY_AFTER_MAX_SECONDS));
      return clamped * 1000;
    }

    const date = new Date(headerValue);
    if (!isNaN(date.getTime())) {
      const delayMs = date.getTime() - Date.now();
      const delaySec = Math.max(0, delayMs / 1000);
      const clamped = Math.min(delaySec, RETRY_AFTER_MAX_SECONDS);
      return clamped * 1000;
    }

    return undefined;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

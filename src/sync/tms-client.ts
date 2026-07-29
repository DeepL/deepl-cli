import { ConfigError, NetworkError, ValidationError } from '../utils/errors.js';
import { sanitizeForTerminal } from '../utils/control-chars.js';
import { sanitizeUrl } from '../utils/sanitize-url.js';
import { Logger } from '../utils/logger.js';
import type { ExtractedEntry } from '../formats/format.js';
import type { SyncTmsConfig } from './types.js';

const MAX_PULL_VALUE_BYTES = 64 * 1024;
export const MAX_PULL_KEY_COUNT = 50000;
export const MAX_PULL_BODY_BYTES = 32 * 1024 * 1024;
// eslint-disable-next-line no-control-regex -- intentional: checking for control chars in untrusted TMS-returned keys
const KEY_FORBIDDEN_CHARS = /[\x00-\x1f\x7f/\\]/;
// eslint-disable-next-line no-control-regex -- intentional: strip control chars from untrusted TMS-returned values before they reach the filesystem
const VALUE_CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

export function sanitizePullKeysResponse(raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(
      'TMS pull response must be a JSON object mapping keys to string values',
      'Check that your TMS server returns the documented shape: {"<key>": "<translation>", ...}.',
    );
  }
  const keys = Object.keys(raw);
  if (keys.length > MAX_PULL_KEY_COUNT) {
    throw new ValidationError(
      `TMS pull response exceeds MAX_PULL_KEY_COUNT (${MAX_PULL_KEY_COUNT})`,
      `Partition the TMS export by locale, or paginate the pull.`,
    );
  }
  // Null-prototype: callers test membership with `result[key] !== undefined`
  // and `??`, so an inherited Object.prototype member for a key named
  // "toString" or "constructor" would read as an approved translation and
  // silently replace the real one.
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (KEY_FORBIDDEN_CHARS.test(key)) {
      throw new ValidationError(
        `TMS pull response contains invalid key "${key.replace(VALUE_CONTROL_CHARS, '?')}" (path separators and control chars are not permitted)`,
        'Check your TMS for keys containing "/", "\\", or control characters; these cannot be written to the filesystem safely.',
      );
    }
    if (typeof value !== 'string') {
      throw new ValidationError(
        `TMS pull response contains non-string value for key "${key.replace(VALUE_CONTROL_CHARS, '?')}" (got ${value === null ? 'null' : typeof value})`,
        'Check that your TMS server returns string translations; nested objects, arrays, numbers, and null are not supported.',
      );
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_PULL_VALUE_BYTES) {
      throw new ValidationError(
        `TMS pull response value for key "${key.replace(VALUE_CONTROL_CHARS, '?')}" exceeds the ${MAX_PULL_VALUE_BYTES / 1024}KiB per-value limit`,
        'Split oversized translations into smaller keys, or raise the issue with your TMS administrator.',
      );
    }
    result[key] = value.replace(VALUE_CONTROL_CHARS, '');
  }
  return result;
}

/** A TMS request that hit the client-side timeout; classified as a network error (exit 5). */
export class TmsTimeoutError extends NetworkError {
  constructor(message: string) {
    super(message, 'Raise timeout_ms in the tms: block of .deepl-sync.yaml, or check that the TMS server is reachable.');
    this.name = 'TmsTimeoutError';
  }
}

export interface TmsClientRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export interface TmsClientOptions {
  serverUrl: string;
  projectId: string;
  apiKey?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  retry?: TmsClientRetryOptions;
}

export const DEFAULT_TMS_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 10000;
const ERROR_BODY_MAX_BYTES = 1024;

const RETRIABLE_STATUS = new Set([429, 503]);
const RETRIABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN']);

function isRetriableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && RETRIABLE_NETWORK_CODES.has(code)) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string' && RETRIABLE_NETWORK_CODES.has(causeCode)) return true;
  }
  return false;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean,
): number {
  const exp = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  if (!jitter) return exp;
  const jitterRange = exp * 0.25;
  const delta = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.floor(exp + delta));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return '';
    const truncated = text.length > ERROR_BODY_MAX_BYTES ? text.slice(0, ERROR_BODY_MAX_BYTES) + '...' : text;
    return sanitizeForTerminal(truncated);
  } catch {
    return '';
  }
}

function oversizedBodyError(): ValidationError {
  return new ValidationError(
    `TMS pull response exceeds the ${MAX_PULL_BODY_BYTES / (1024 * 1024)}MiB response size limit`,
    'Partition the TMS export by locale, or paginate the pull.',
  );
}

/**
 * Read and parse a JSON body without buffering more than the cap. The key and
 * value limits in sanitizePullKeysResponse only apply after a parse, so an
 * unbounded body would already have been materialized by then.
 */
async function readJsonBounded(response: Response): Promise<unknown> {
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PULL_BODY_BYTES) {
    throw oversizedBodyError();
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    return await response.json();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_PULL_BODY_BYTES) {
      await reader.cancel();
      throw oversizedBodyError();
    }
    chunks.push(value);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

export class TmsClient {
  private readonly timeoutMs: number;
  private readonly retry: Required<TmsClientRetryOptions>;

  constructor(private readonly options: TmsClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TMS_TIMEOUT_MS;
    this.retry = {
      maxAttempts: options.retry?.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
      baseDelayMs: options.retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      maxDelayMs: options.retry?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
      jitter: options.retry?.jitter ?? true,
    };
  }

  private getAuthHeader(): Record<string, string> {
    if (this.options.apiKey) return { Authorization: `ApiKey ${this.options.apiKey}` };
    if (this.options.token) return { Authorization: `Bearer ${this.options.token}` };
    return {};
  }

  private async fetchOnce(url: string, method: string, body?: unknown): Promise<Response> {
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetchImpl(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeader() },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new TmsTimeoutError(
          `TMS request timed out after ${this.timeoutMs}ms: ${method} ${sanitizeUrl(url)}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Join the configured server URL with an API path through the URL API, so a
   * trailing slash cannot produce "//" and a base path is preserved.
   */
  private buildUrl(path: string): string {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(this.options.serverUrl);
    } catch {
      throw new ConfigError(`Invalid TMS server URL: ${sanitizeUrl(this.options.serverUrl)}`);
    }

    const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
    if (parsedUrl.protocol !== 'https:' && !isLocalhost) {
      throw new ConfigError('TMS server URL must use HTTPS');
    }
    if (parsedUrl.search || parsedUrl.hash) {
      throw new ConfigError(
        `TMS server URL must not contain a query string or fragment: ${sanitizeUrl(this.options.serverUrl)}`,
        'Set server: to the bare origin (plus a base path if your TMS is mounted under one).',
      );
    }

    const basePath = parsedUrl.pathname.replace(/\/+$/, '');
    const projectPath = `${basePath}/api/projects/${encodeURIComponent(this.options.projectId)}`;
    return new URL(`${projectPath}${path}`, parsedUrl).toString();
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = this.buildUrl(path);

    let lastError: unknown;
    for (let attempt = 0; attempt < this.retry.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchOnce(url, method, body);
      } catch (err) {
        lastError = err;
        const retriable = err instanceof TmsTimeoutError || isRetriableNetworkError(err);
        if (!retriable || attempt === this.retry.maxAttempts - 1) throw err;
        const delay = computeBackoffDelay(attempt, this.retry.baseDelayMs, this.retry.maxDelayMs, this.retry.jitter);
        await sleep(delay);
        continue;
      }

      if (response.ok) return response;

      if (response.status === 401 || response.status === 403) {
        throw new ConfigError(
          `TMS authentication failed (${response.status} ${response.statusText})`,
          'Check that TMS_API_KEY or TMS_TOKEN is set correctly, and that the server and project_id in your .deepl-sync.yaml match the TMS you intended to reach.',
        );
      }

      if (RETRIABLE_STATUS.has(response.status) && attempt < this.retry.maxAttempts - 1) {
        const delay = computeBackoffDelay(attempt, this.retry.baseDelayMs, this.retry.maxDelayMs, this.retry.jitter);
        await sleep(delay);
        lastError = response;
        continue;
      }

      const bodyText = await readErrorBody(response);
      const suffix = bodyText ? `: ${bodyText}` : '';
      throw new Error(`TMS API error: ${response.status} ${sanitizeForTerminal(response.statusText)}${suffix}`);
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('TMS request failed after all retry attempts');
  }

  async pushKey(keyPath: string, locale: string, value: string): Promise<void> {
    await this.request('PUT', `/keys/${encodeURIComponent(keyPath)}`, { locale, value });
  }

  async pushEntry(entry: ExtractedEntry, locale: string): Promise<void> {
    if (entry.metadata && 'skipped' in entry.metadata) {
      throw new Error(
        `TmsClient.pushEntry refused to push key "${entry.key}" (locale=${locale}): ` +
        `entry is tagged metadata.skipped and must be filtered by the walker ` +
        `skip-partition (partitionEntries in src/sync/sync-bucket-walker.ts) before reaching push.`,
      );
    }
    await this.pushKey(entry.key, locale, entry.value);
  }

  async pullKeys(locale: string): Promise<Record<string, string>> {
    const resp = await this.request('GET', `/keys/export?format=json&locale=${encodeURIComponent(locale)}`);
    return sanitizePullKeysResponse(await readJsonBounded(resp));
  }

  async getProjectStatus(): Promise<unknown> {
    const resp = await this.request('GET', '');
    return await resp.json();
  }
}

export function resolveTmsCredentials(config: { api_key?: string; token?: string }): { apiKey?: string; token?: string } {
  const apiKey = process.env['TMS_API_KEY'] ?? config.api_key;
  const token = process.env['TMS_TOKEN'] ?? config.token;

  if (!process.env['TMS_API_KEY'] && config.api_key) {
    Logger.warn('Warning: TMS API key found in config file. Use TMS_API_KEY env var instead to avoid committing secrets.');
  }
  if (!process.env['TMS_TOKEN'] && config.token) {
    Logger.warn('Warning: TMS token found in config file. Use TMS_TOKEN env var instead to avoid committing secrets.');
  }

  return { apiKey, token };
}

export function createTmsClient(config: SyncTmsConfig): TmsClient {
  const { apiKey, token } = resolveTmsCredentials({ api_key: config.api_key, token: config.token });
  return new TmsClient({
    serverUrl: config.server,
    projectId: config.project_id,
    apiKey,
    token,
    ...(config.timeout_ms !== undefined && { timeoutMs: config.timeout_ms }),
  });
}

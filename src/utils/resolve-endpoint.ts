import { FREE_API_URL, PRO_API_URL } from '../api/endpoints.js';

export interface ResolveEndpointOptions {
  apiKey: string;
  configBaseUrl?: string;
  usePro?: boolean;
  apiUrlOverride?: string;
}

export function isFreeKey(apiKey: string): boolean {
  return apiKey.endsWith(':fx');
}

/**
 * Returns true only for the two standard DeepL API hostnames
 * (api.deepl.com and api-free.deepl.com). Any other URL —
 * including localhost, 127.0.0.1, regional endpoints like
 * api-jp.deepl.com, or custom proxies — returns false.
 */
export function isStandardDeepLUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'api.deepl.com' || hostname === 'api-free.deepl.com';
  } catch {
    return false;
  }
}

/**
 * Resolves the effective API base URL.
 *
 * Priority:
 *   1. --api-url CLI flag (apiUrlOverride)
 *   2. Custom config baseUrl (any non-standard hostname)
 *   3. Key suffix: :fx → free endpoint
 *   4. usePro === false → free endpoint
 *   5. Default → pro endpoint
 */
export function resolveEndpoint(options: ResolveEndpointOptions): string {
  const { apiKey, configBaseUrl, usePro, apiUrlOverride } = options;

  if (apiUrlOverride) {
    return apiUrlOverride;
  }

  if (configBaseUrl && !isStandardDeepLUrl(configBaseUrl)) {
    return configBaseUrl;
  }

  if (isFreeKey(apiKey)) {
    return FREE_API_URL;
  }

  if (usePro === false) {
    return FREE_API_URL;
  }

  return PRO_API_URL;
}

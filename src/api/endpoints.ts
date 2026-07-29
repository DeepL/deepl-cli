/**
 * DeepL API endpoint constants, kept dependency-free so lightweight modules
 * (e.g. utils/resolve-endpoint) can import them without pulling in the
 * axios-backed HTTP client at startup.
 */
export const FREE_API_URL = 'https://api-free.deepl.com';
export const PRO_API_URL = 'https://api.deepl.com';

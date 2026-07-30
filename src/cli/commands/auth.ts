/**
 * Auth Command
 * Handles API key management
 */

import { ConfigService } from '../../storage/config.js';
import { DeepLClient } from '../../api/deepl-client.js';
import type { DeepLClientOptions } from '../../api/http-client.js';
import { ValidationError, AuthError, NetworkError } from '../../utils/errors.js';
import { resolveEndpoint } from '../../utils/resolve-endpoint.js';

export class AuthCommand {
  private config: ConfigService;
  private httpOptions: DeepLClientOptions;

  constructor(config: ConfigService, httpOptions: DeepLClientOptions = {}) {
    this.config = config;
    this.httpOptions = httpOptions;
  }

  /**
   * Set API key and validate it
   */
  async setKey(apiKey: string, options: { verify?: boolean } = {}): Promise<void> {
    // Validate input
    if (!apiKey || apiKey.trim() === '') {
      throw new ValidationError('API key cannot be empty');
    }

    if (options.verify === false) {
      this.config.set('auth.apiKey', apiKey);
      return;
    }

    // Validate with DeepL API by making a test request
    // Note: No format validation - let the API determine if the key is valid
    // This supports production keys (:fx suffix), free keys, and test keys
    try {
      // Use configured API endpoint for validation
      const configBaseUrl = this.config.getValue<string>('api.baseUrl');
      const usePro = this.config.getValue<boolean>('api.usePro');
      const baseUrl = resolveEndpoint({ apiKey, configBaseUrl, usePro });

      const client = new DeepLClient(apiKey, { ...this.httpOptions, baseUrl });
      await client.getUsage(); // Test API key validity
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Authentication failed')) {
          throw new AuthError(
            'Invalid API key: Authentication failed with DeepL API'
          );
        }
        // The key is discarded when validation cannot reach the API at all, so
        // name the paths that do not require network access.
        if (error instanceof NetworkError) {
          throw new NetworkError(
            `Could not reach the DeepL API to validate the key: ${error.message}`,
            'Store the key without validating with --no-verify, or set DEEPL_API_KEY in your environment instead.',
          );
        }
        throw error;
      }
      throw new AuthError('Failed to validate API key');
    }

    // Save to config
    this.config.set('auth.apiKey', apiKey);
  }

  /**
   * Get API key from config or environment
   */
  async getKey(): Promise<string | undefined> {
    // Check environment variable first (for CI/CD)
    const envKey = process.env['DEEPL_API_KEY'];

    // Check config
    const configKey = this.config.getValue<string>('auth.apiKey');

    // Prefer config over environment
    return configKey ?? envKey;
  }

  /**
   * Remove API key from config
   */
  async clearKey(): Promise<void> {
    this.config.delete('auth.apiKey');
  }
}

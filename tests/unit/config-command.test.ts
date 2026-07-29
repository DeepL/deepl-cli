/**
 * Tests for Config Command
 */

 

import { ConfigCommand } from '../../src/cli/commands/config';
import { ConfigService } from '../../src/storage/config';
import { createMockConfigService } from '../helpers/mock-factories';

// Mock dependencies
jest.mock('../../src/storage/config');

describe('ConfigCommand', () => {
  let mockConfigService: jest.Mocked<ConfigService>;
  let configCommand: ConfigCommand;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigService = createMockConfigService();

    configCommand = new ConfigCommand(mockConfigService);
  });

  describe('get()', () => {
    it('should get specific config value', async () => {
      (mockConfigService.getValue as jest.Mock).mockReturnValueOnce('es');

      const value = await configCommand.get('defaults.sourceLang');

      expect(value).toBe('es');
      expect(mockConfigService.getValue).toHaveBeenCalledWith('defaults.sourceLang');
    });

    it('should return undefined for non-existent key', async () => {
      const value = await configCommand.get('nonexistent.key');

      expect(value).toBeUndefined();
    });

    it('should get entire config when no key specified', async () => {
      (mockConfigService.get as jest.Mock).mockReturnValueOnce({
        auth: { apiKey: 'test-key' },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
        defaults: {
          sourceLang: undefined,
          targetLangs: ['es', 'fr'],
          formality: 'default',
          preserveFormatting: true,
        },
        cache: { enabled: true, maxSize: 1024, ttl: 2592000 },
        output: { format: 'text', color: true, verbose: false },
        watch: { debounceMs: 500, autoCommit: false, pattern: '**/*' },

      });

      const config = await configCommand.get();

      expect(config).toBeDefined();
      expect(config).toHaveProperty('auth');
      expect(config).toHaveProperty('defaults');
    });

    it('should mask API key when returning entire config', async () => {
      (mockConfigService.get as jest.Mock).mockReturnValueOnce({
        auth: { apiKey: 'super-secret-key-123' },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
        defaults: { sourceLang: undefined, targetLangs: [], formality: 'default', preserveFormatting: true },
        cache: { enabled: true, maxSize: 1024, ttl: 2592000 },
        output: { format: 'text', color: true, verbose: false },
        watch: { debounceMs: 500, autoCommit: false, pattern: '**/*' },

      });

      const config = await configCommand.get() as Record<string, unknown>;

      expect(JSON.stringify(config)).not.toContain('super-secret-key-123');
      const auth = config['auth'] as Record<string, unknown>;
      expect(auth['apiKey']).toBe('supe...-123');
    });
  });

  describe('set()', () => {
    it('should set config value', async () => {
      await configCommand.set('defaults.sourceLang', 'en');

      expect(mockConfigService.set).toHaveBeenCalledWith('defaults.sourceLang', 'en');
    });

    it('should set array values', async () => {
      await configCommand.set('defaults.targetLangs', 'es,fr,de');

      expect(mockConfigService.set).toHaveBeenCalledWith('defaults.targetLangs', ['es', 'fr', 'de']);
    });

    it('should set boolean values', async () => {
      await configCommand.set('cache.enabled', 'false');

      expect(mockConfigService.set).toHaveBeenCalledWith('cache.enabled', false);
    });

    it('should coerce "true" to boolean true for known boolean keys', async () => {
      await configCommand.set('cache.enabled', 'true');
      expect(mockConfigService.set).toHaveBeenCalledWith('cache.enabled', true);
    });

    it('should coerce "false" to boolean false for all known boolean keys', async () => {
      const booleanKeys = [
        'api.usePro',
        'cache.enabled',
        'output.verbose',
        'output.color',
        'watch.autoCommit',
        'defaults.preserveFormatting',
      ];

      for (const key of booleanKeys) {
        (mockConfigService.set as jest.Mock).mockClear();
        await configCommand.set(key, 'false');
        expect(mockConfigService.set).toHaveBeenCalledWith(key, false);
      }
    });

    it('should coerce "true" to boolean true for all known boolean keys', async () => {
      const booleanKeys = [
        'api.usePro',
        'cache.enabled',
        'output.verbose',
        'output.color',
        'watch.autoCommit',
        'defaults.preserveFormatting',
      ];

      for (const key of booleanKeys) {
        (mockConfigService.set as jest.Mock).mockClear();
        await configCommand.set(key, 'true');
        expect(mockConfigService.set).toHaveBeenCalledWith(key, true);
      }
    });

    it('should not coerce "true" to boolean for non-boolean keys', async () => {
      await configCommand.set('auth.apiKey', 'true');
      expect(mockConfigService.set).toHaveBeenCalledWith('auth.apiKey', 'true');
    });

    it('should not coerce "false" to boolean for non-boolean keys', async () => {
      await configCommand.set('auth.apiKey', 'false');
      expect(mockConfigService.set).toHaveBeenCalledWith('auth.apiKey', 'false');
    });

    it('should set number values', async () => {
      await configCommand.set('cache.maxSize', '2048');

      expect(mockConfigService.set).toHaveBeenCalledWith('cache.maxSize', 2048);
    });

    it('should coerce numeric strings for all known numeric keys', async () => {
      const numericKeys = ['cache.maxSize', 'cache.ttl', 'watch.debounceMs'];

      for (const key of numericKeys) {
        (mockConfigService.set as jest.Mock).mockClear();
        await configCommand.set(key, '42');
        expect(mockConfigService.set).toHaveBeenCalledWith(key, 42);
      }
    });

    it('should not coerce numeric strings for non-numeric keys', async () => {
      await configCommand.set('auth.apiKey', '12345');
      expect(mockConfigService.set).toHaveBeenCalledWith('auth.apiKey', '12345');
    });

    it('should pass non-boolean strings through for boolean keys', async () => {
      await configCommand.set('cache.enabled', 'yes');
      expect(mockConfigService.set).toHaveBeenCalledWith('cache.enabled', 'yes');
    });

    it('should throw error for invalid key', async () => {
      (mockConfigService.set as jest.Mock).mockImplementationOnce(() => { throw new Error('Invalid config key'); });

      await expect(
        configCommand.set('invalid.key', 'value')
      ).rejects.toThrow('Invalid config key');
    });

    it('should throw error for invalid value', async () => {
      (mockConfigService.set as jest.Mock).mockImplementationOnce(() => { throw new Error('Invalid language code "invalid" for "defaults.sourceLang". Run: deepl languages to see valid codes'); });

      await expect(
        configCommand.set('defaults.sourceLang', 'invalid')
      ).rejects.toThrow('Invalid language code');
    });
  });

  describe('list()', () => {
    it('should list all config values', async () => {
      (mockConfigService.get as jest.Mock).mockReturnValueOnce({
        auth: { apiKey: 'test-key' },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
        defaults: {
          sourceLang: 'en',
          targetLangs: ['es', 'fr'],
          formality: 'default',
          preserveFormatting: true,
        },
        cache: { enabled: true, maxSize: 1024, ttl: 2592000 },
        output: { format: 'text', color: true, verbose: false },
        watch: { debounceMs: 500, autoCommit: false, pattern: '**/*' },

      });

      const config = await configCommand.list();

      expect(config).toHaveProperty('auth');
      expect(config).toHaveProperty('defaults');
      expect(config).toHaveProperty('cache');
    });

    it('should format config as readable key-value pairs', async () => {
      (mockConfigService.get as jest.Mock).mockReturnValueOnce({
        auth: { apiKey: 'test-key' },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
        defaults: {
          sourceLang: 'en',
          targetLangs: ['es', 'fr'],
          formality: 'default',
          preserveFormatting: true,
        },
        cache: { enabled: true, maxSize: 1024, ttl: 2592000 },
        output: { format: 'text', color: true, verbose: false },
        watch: { debounceMs: 500, autoCommit: false, pattern: '**/*' },

      });

      const config = await configCommand.list();

      expect(config).toBeDefined();
    });

    it('should hide sensitive values like API keys', async () => {
      (mockConfigService.get as jest.Mock).mockReturnValueOnce({
        auth: { apiKey: 'super-secret-key-123' },
        api: { baseUrl: 'https://api.deepl.com/v2', usePro: true },
        defaults: {
          sourceLang: undefined,
          targetLangs: [],
          formality: 'default',
          preserveFormatting: true,
        },
        cache: { enabled: true, maxSize: 1024, ttl: 2592000 },
        output: { format: 'text', color: true, verbose: false },
        watch: { debounceMs: 500, autoCommit: false, pattern: '**/*' },

      });

      const config = await configCommand.list();

      // Should mask API key
      expect(JSON.stringify(config)).not.toContain('super-secret-key-123');
    });
  });

  describe('formatValue()', () => {
    it('should format a single config value with key', () => {
      const result = configCommand.formatValue('cache.enabled', true);
      expect(result).toBe('cache.enabled = true');
    });

    it('should show (not set) for undefined value', () => {
      const result = configCommand.formatValue('defaults.sourceLang', undefined);
      expect(result).toBe('defaults.sourceLang = (not set)');
    });

    it('should format string value', () => {
      const result = configCommand.formatValue('defaults.formality', 'default');
      expect(result).toBe('defaults.formality = default');
    });

    it('should delegate to formatConfig when key is undefined', () => {
      const config = { auth: { apiKey: 'test' }, cache: { enabled: true } };
      const result = configCommand.formatValue(undefined, config);
      expect(result).toContain('auth.apiKey');
      expect(result).toContain('cache.enabled');
    });
  });

  describe('formatConfig()', () => {
    it('should flatten nested config to key=value pairs', () => {
      const config = {
        auth: { apiKey: 'test-key' },
        cache: { enabled: true, maxSize: 1024 },
        defaults: { targetLangs: ['es', 'fr'] },
      };
      const result = configCommand.formatConfig(config);

      expect(result).toContain('auth.apiKey = "test-key"');
      expect(result).toContain('cache.enabled = true');
      expect(result).toContain('cache.maxSize = 1024');
      expect(result).toContain('defaults.targetLangs = ["es","fr"]');
    });

    it('should handle empty config', () => {
      const result = configCommand.formatConfig({});
      expect(result).toBe('');
    });

    it('should handle deeply nested config', () => {
      const config = { a: { b: { c: 'deep' } } };
      const result = configCommand.formatConfig(config);
      expect(result).toContain('a.b.c = "deep"');
    });
  });

  describe('reset()', () => {
    it('should reset config to defaults', async () => {
      await configCommand.reset();

      expect(mockConfigService.clear).toHaveBeenCalled();
    });

    it('should handle reset errors', async () => {
      (mockConfigService.clear as jest.Mock).mockImplementationOnce(() => { throw new Error('Failed to reset'); });

      await expect(configCommand.reset()).rejects.toThrow('Failed to reset');
    });
  });
});

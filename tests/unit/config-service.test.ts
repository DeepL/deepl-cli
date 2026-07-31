/**
 * Tests for ConfigService
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigService } from '../../src/storage/config';

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockConfigPath: string;

  beforeEach(() => {
    // Use a temporary config path for testing
    mockConfigPath = '/tmp/deepl-cli-test-config.json';
    configService = new ConfigService(mockConfigPath);
  });

  afterEach(() => {
    // Clean up test config file
    configService.clear();
  });

  describe('initialization', () => {
    it('should create a new ConfigService instance', () => {
      expect(configService).toBeInstanceOf(ConfigService);
    });

    it('should return default config when no config file exists', () => {
      const config = configService.get();
      expect(config).toHaveProperty('defaults');
      expect(config.defaults.targetLangs).toEqual([]);
      expect(config.cache.enabled).toBe(true);
    });

    it('should create config directory if it does not exist', () => {
      const newPath = '/tmp/nonexistent-dir/config.json';
      const service = new ConfigService(newPath);
      expect(() => service.get()).not.toThrow();
    });
  });

  describe('get()', () => {
    it('should return the entire config object', () => {
      const config = configService.get();
      expect(config).toHaveProperty('auth');
      expect(config).toHaveProperty('defaults');
      expect(config).toHaveProperty('cache');
      expect(config).toHaveProperty('output');
      expect(config).toHaveProperty('watch');
    });

    it('should return readonly reference (mutations affect original)', () => {
      // get() now returns Readonly<DeepLConfig> for performance
      // TypeScript prevents mutations at compile time
      const config1 = configService.get();

      // This would be a TypeScript error: Cannot assign to 'targetLangs' because it is a read-only property
      // But in JavaScript runtime, the object is still mutable
       
      (config1 as any).defaults.targetLangs.push('es');

      const config2 = configService.get();
      // Since we return a reference now, mutations affect the original
      expect(config2.defaults.targetLangs).toEqual(['es']);

      // Clean up for other tests
       
      (config2 as any).defaults.targetLangs.pop();
    });
  });

  describe('set()', () => {
    it('should set a top-level config value', () => {
      configService.set('auth.apiKey', 'test-api-key');
      const config = configService.get();
      expect(config.auth.apiKey).toBe('test-api-key');
    });

    it('should set a nested config value', () => {
      configService.set('cache.enabled', false);
      const config = configService.get();
      expect(config.cache.enabled).toBe(false);
    });

    it('should set array values', () => {
      configService.set('defaults.targetLangs', ['es', 'fr', 'de']);
      const config = configService.get();
      expect(config.defaults.targetLangs).toEqual(['es', 'fr', 'de']);
    });

    it('should throw error for invalid path', () => {
      expect(() => {
        configService.set('invalid.path.key', 'value');
      }).toThrow();
    });

    it('should persist changes to disk', () => {
      configService.set('auth.apiKey', 'persistent-key');
      const newService = new ConfigService(mockConfigPath);
      const config = newService.get();
      expect(config.auth.apiKey).toBe('persistent-key');
    });
  });

  describe('getValue()', () => {
    beforeEach(() => {
      configService.set('auth.apiKey', 'test-key');
      configService.set('defaults.targetLangs', ['es', 'fr']);
    });

    it('should get a specific config value by path', () => {
      const apiKey = configService.getValue('auth.apiKey');
      expect(apiKey).toBe('test-key');
    });

    it('should get nested values', () => {
      const targetLangs = configService.getValue('defaults.targetLangs');
      expect(targetLangs).toEqual(['es', 'fr']);
    });

    it('should return undefined for non-existent path', () => {
      const value = configService.getValue('nonexistent.key');
      expect(value).toBeUndefined();
    });

    it('should return default value if provided', () => {
      const value = configService.getValue('nonexistent.key', 'default');
      expect(value).toBe('default');
    });
  });

  describe('has()', () => {
    beforeEach(() => {
      configService.set('auth.apiKey', 'test-key');
    });

    it('should return true if key exists', () => {
      expect(configService.has('auth.apiKey')).toBe(true);
    });

    it('should return false if key does not exist', () => {
      expect(configService.has('auth.nonexistent')).toBe(false);
    });

    it('should return true for top-level keys', () => {
      expect(configService.has('auth')).toBe(true);
    });
  });

  describe('delete()', () => {
    beforeEach(() => {
      configService.set('auth.apiKey', 'test-key');
      configService.set('output.verbose', true);
    });

    it('should delete a specific config value', () => {
      configService.delete('auth.apiKey');
      expect(configService.has('auth.apiKey')).toBe(false);
    });

    it('should not affect other config values', () => {
      configService.delete('auth.apiKey');
      expect(configService.getValue('output.verbose')).toBe(true);
    });

    it('should persist deletion to disk', () => {
      configService.delete('auth.apiKey');
      const newService = new ConfigService(mockConfigPath);
      expect(newService.has('auth.apiKey')).toBe(false);
    });
  });

  describe('clear()', () => {
    beforeEach(() => {
      configService.set('auth.apiKey', 'test-key');
      configService.set('defaults.targetLangs', ['es', 'fr']);
    });

    it('should reset config to defaults', () => {
      configService.clear();
      const config = configService.get();
      expect(config.auth.apiKey).toBeUndefined();
      expect(config.defaults.targetLangs).toEqual([]);
    });

    it('should remove config file from disk', () => {
      configService.clear();
      const newService = new ConfigService(mockConfigPath);
      const config = newService.get();
      expect(config.auth.apiKey).toBeUndefined();
    });
  });

  describe('getDefaults()', () => {
    it('should return default configuration', () => {
      const defaults = ConfigService.getDefaults();
      expect(defaults).toHaveProperty('auth');
      expect(defaults.auth).toHaveProperty('apiKey');
      expect(defaults.defaults).toHaveProperty('targetLangs');
      expect(defaults.cache).toHaveProperty('enabled');
    });

    it('should return same defaults each time', () => {
      const defaults1 = ConfigService.getDefaults();
      const defaults2 = ConfigService.getDefaults();
      expect(defaults1).toEqual(defaults2);
    });

    it('should have sensible default values', () => {
      const defaults = ConfigService.getDefaults();
      expect(defaults.cache.enabled).toBe(true);
      expect(defaults.cache.maxSize).toBeGreaterThan(0);
      expect(defaults.output.format).toBe('text');
      expect(defaults.defaults.formality).toBe('default');
    });
  });

  describe('validation', () => {
    it('should validate language codes', () => {
      expect(() => {
        configService.set('defaults.sourceLang', 'invalid');
      }).toThrow(/Invalid language code "invalid" for "defaults\.sourceLang"/);
    });

    it('should accept valid language codes', () => {
      expect(() => {
        configService.set('defaults.sourceLang', 'en');
      }).not.toThrow();
    });

    it('should validate formality values', () => {
      expect(() => {
        configService.set('defaults.formality', 'invalid');
      }).toThrow(/Invalid formality "invalid" for "defaults\.formality"\. Valid values:/);
    });

    it('should validate output format', () => {
      expect(() => {
        configService.set('output.format', 'invalid');
      }).toThrow(/Invalid output format "invalid" for "output\.format"\. Valid values:/);
    });

    it('should validate cache size is positive', () => {
      expect(() => {
        configService.set('cache.maxSize', -1);
      }).toThrow('Cache size must be positive');
    });

    it('should validate boolean values', () => {
      expect(() => {

        configService.set('cache.enabled', 'yes');
      }).toThrow(/Expected boolean for "cache\.enabled"\. Use true or false\./);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string values', () => {
      configService.set('auth.apiKey', '');
      expect(configService.getValue('auth.apiKey')).toBe('');
    });

    it('should handle null values', () => {
      configService.set('auth.apiKey', undefined);
      expect(configService.getValue('auth.apiKey')).toBeUndefined();
    });

    it('should handle concurrent writes', async () => {
      const promises = [
        configService.set('auth.apiKey', 'key1'),
        configService.set('output.format', 'json'),
        configService.set('defaults.sourceLang', 'en'),
      ];
      await Promise.all(promises);
      expect(configService.getValue('auth.apiKey')).toBe('key1');
      expect(configService.getValue('output.format')).toBe('json');
      expect(configService.getValue('defaults.sourceLang')).toBe('en');
    });

    it('should handle very long values', () => {
      const longValue = 'a'.repeat(10000);
      configService.set('auth.apiKey', longValue);
      expect(configService.getValue('auth.apiKey')).toBe(longValue);
    });
  });

  describe('type safety', () => {
    it('should maintain type integrity for nested objects', () => {
      const config = configService.get();
      expect(typeof config.cache.enabled).toBe('boolean');
      expect(typeof config.cache.maxSize).toBe('number');
      expect(Array.isArray(config.defaults.targetLangs)).toBe(true);
    });

    it('should preserve array types', () => {
      configService.set('defaults.targetLangs', ['es', 'fr']);
      const langs = configService.getValue('defaults.targetLangs');
      expect(Array.isArray(langs)).toBe(true);
    });
  });

  describe('config directory permissions', () => {
    it('should create config directory with mode 0o700', () => {
      const uniqueDir = path.join(os.tmpdir(), `deepl-perm-test-${Date.now()}`);
      const configPath = path.join(uniqueDir, 'config.json');

      // Ensure directory does not exist
      if (fs.existsSync(uniqueDir)) {
        fs.rmSync(uniqueDir, { recursive: true });
      }

      const service = new ConfigService(configPath);
      // Trigger a write to create the directory
      service.set('auth.apiKey', 'test');

      const stat = fs.statSync(uniqueDir);
      // mode includes file type bits; mask to permission bits only
      const dirMode = stat.mode & 0o777;
      expect(dirMode).toBe(0o700);

      // Cleanup
      fs.rmSync(uniqueDir, { recursive: true, force: true });
    });

    it('should write config file with mode 0o600', () => {
      const uniqueDir = path.join(os.tmpdir(), `deepl-perm-test-file-${Date.now()}`);
      const configPath = path.join(uniqueDir, 'config.json');

      const service = new ConfigService(configPath);
      service.set('auth.apiKey', 'test');

      const stat = fs.statSync(configPath);
      const fileMode = stat.mode & 0o777;
      expect(fileMode).toBe(0o600);

      // Cleanup
      fs.rmSync(uniqueDir, { recursive: true, force: true });
    });

    describe('temp file safety', () => {
      // The API key is written in plaintext, so the intermediate file must not
      // land on a path anyone else could have prepared in advance.
      it('should not write through a symlink planted at the predictable temp path', () => {
        const uniqueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-tmp-safety-'));
        const configPath = path.join(uniqueDir, 'config.json');
        const stolenPath = path.join(uniqueDir, 'stolen.txt');
        fs.symlinkSync(stolenPath, `${configPath}.tmp`);

        const service = new ConfigService(configPath);
        service.set('auth.apiKey', 'secret-key-value');

        expect(fs.existsSync(stolenPath)).toBe(false);
        expect(fs.lstatSync(configPath).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(configPath, 'utf-8')).toContain('secret-key-value');

        fs.rmSync(uniqueDir, { recursive: true, force: true });
      });

      it('should not write to the predictable temp path even when it is free', () => {
        const uniqueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-tmp-unique-'));
        const configPath = path.join(uniqueDir, 'config.json');
        const predictablePath = `${configPath}.tmp`;
        fs.writeFileSync(predictablePath, 'planted', 'utf-8');

        const service = new ConfigService(configPath);
        service.set('auth.apiKey', 'first');
        service.set('auth.apiKey', 'second');

        expect(fs.readFileSync(predictablePath, 'utf-8')).toBe('planted');
        expect(fs.readFileSync(configPath, 'utf-8')).toContain('second');

        fs.rmSync(uniqueDir, { recursive: true, force: true });
      });

      it('should leave no temp file behind after a successful write', () => {
        const uniqueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-tmp-clean-'));
        const configPath = path.join(uniqueDir, 'config.json');

        const service = new ConfigService(configPath);
        service.set('auth.apiKey', 'test');

        expect(fs.readdirSync(uniqueDir)).toEqual(['config.json']);
        expect(fs.existsSync(`${configPath}.tmp`)).toBe(false);

        fs.rmSync(uniqueDir, { recursive: true, force: true });
      });
    });
  });

  describe('error logging sanitization', () => {
    it('should log only error message, not full Error object with stack trace, when config loading fails', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Write invalid JSON to a config file so loading fails during JSON.parse
      const badConfigPath = path.join(os.tmpdir(), `deepl-bad-config-${Date.now()}`, 'config.json');
      const badConfigDir = path.dirname(badConfigPath);
      fs.mkdirSync(badConfigDir, { recursive: true });
      fs.writeFileSync(badConfigPath, '{ invalid json !!!');

      // Creating a ConfigService with a corrupt config file triggers load() which should log
      const service = new ConfigService(badConfigPath);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [message, errorArg] = consoleErrorSpy.mock.calls[0]!;
      expect(message).toBe('Failed to load config, using defaults:');
      // errorArg should be a string (error.message), not an Error object
      expect(typeof errorArg).toBe('string');
      // Should not contain stack trace frames (e.g. "    at Object.<anonymous> (/path/to/file.ts:123:45)")
      expect(errorArg).not.toMatch(/\n\s+at\s/);
      // Should not be a full Error object or its string representation
      expect(errorArg).not.toBeInstanceOf(Error);

      // Service should still work with defaults
      const config = service.get();
      expect(config.cache.enabled).toBe(true);

      consoleErrorSpy.mockRestore();
      fs.rmSync(badConfigDir, { recursive: true, force: true });
    });
  });

  describe('atomic saves', () => {
    it('should not leave a .tmp file after successful save', () => {
      configService.set('auth.apiKey', 'test-key');
      expect(fs.existsSync(mockConfigPath + '.tmp')).toBe(false);
      expect(fs.existsSync(mockConfigPath)).toBe(true);
    });

    it('should write valid JSON after save', () => {
      configService.set('auth.apiKey', 'test-key');
      const data = fs.readFileSync(mockConfigPath, 'utf-8');
      expect(() => JSON.parse(data)).not.toThrow();
      expect(JSON.parse(data).auth.apiKey).toBe('test-key');
    });

    it('should preserve file permissions on save', () => {
      configService.set('auth.apiKey', 'test-key');
      const stats = fs.statSync(mockConfigPath);
      // 0o600 = owner read/write only (0100600 in octal includes file type bits)
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe('path security validation (Issue #12)', () => {
    it('should reject paths with directory traversal (..)', () => {
      expect(() => {
        configService.set('../auth.apiKey', 'malicious');
      }).toThrow('Invalid path: contains directory traversal');
    });

    it('should reject paths with forward slashes', () => {
      expect(() => {
        configService.set('auth/apiKey', 'malicious');
      }).toThrow('Invalid path: contains path separator');
    });

    it('should reject paths with backslashes', () => {
      expect(() => {
        configService.set('auth\\apiKey', 'malicious');
      }).toThrow('Invalid path: contains path separator');
    });

    it('should reject paths with null bytes', () => {
      expect(() => {
        configService.set('auth\0apiKey', 'malicious');
      }).toThrow('Invalid path: contains null byte');
    });

    it('should reject empty path segments (consecutive dots)', () => {
      // Note: ".." is caught by directory traversal check (more serious security issue)
      expect(() => {
        configService.set('auth..apiKey', 'malicious');
      }).toThrow('Invalid path: contains directory traversal');
    });

    it('should reject paths with leading dots', () => {
      expect(() => {
        configService.set('.auth.apiKey', 'malicious');
      }).toThrow('Invalid path: segment starts with dot');
    });

    it('should accept valid paths with dots in segments', () => {
      // This should be allowed: segments themselves are just "auth" and "apiKey"
      expect(() => {
        configService.set('auth.apiKey', 'valid-key');
      }).not.toThrow();
    });
  });

  describe('prototype pollution protection', () => {
    it('should reject __proto__ path segments instead of polluting Object.prototype', () => {
      const originalToString = Object.prototype.toString;
      try {
        expect(() => {
          configService.set('__proto__.toString', 'PWNED');
        }).toThrow('Invalid path');
        expect(Object.prototype.toString).toBe(originalToString);
      } finally {
        if (Object.prototype.toString !== originalToString) {
          Object.defineProperty(Object.prototype, 'toString', {
            value: originalToString,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
      }
    });

    it('should reject constructor path segments', () => {
      expect(() => {
        configService.set('constructor.polluted', 'PWNED');
      }).toThrow('Invalid path');
    });

    it('should reject prototype path segments', () => {
      expect(() => {
        configService.set('auth.prototype', 'PWNED');
      }).toThrow('Invalid path');
    });

    it('delete() should reject __proto__ paths instead of deleting Object.prototype members', () => {
      const originalToString = Object.prototype.toString;
      try {
        expect(() => {
          configService.delete('__proto__.toString');
        }).toThrow('Invalid path');
        expect(Object.prototype.toString).toBe(originalToString);
      } finally {
        if (Object.prototype.toString !== originalToString) {
          Object.defineProperty(Object.prototype, 'toString', {
            value: originalToString,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
      }
    });

    it('delete() should reject constructor and prototype segments', () => {
      expect(() => configService.delete('constructor.polluted')).toThrow('Invalid path');
      expect(() => configService.delete('auth.prototype')).toThrow('Invalid path');
    });

    it('delete() should not walk inherited properties', () => {
      const originalHasOwnProperty = Object.prototype.hasOwnProperty;
      configService.delete('auth.hasOwnProperty');
      expect(Object.prototype.hasOwnProperty).toBe(originalHasOwnProperty);
    });

    it('getValue() should not walk the prototype chain', () => {
      expect(configService.getValue('__proto__.toString')).toBeUndefined();
      expect(configService.getValue('auth.hasOwnProperty')).toBeUndefined();
      expect(configService.getValue('constructor')).toBeUndefined();
    });

    it('has() should not report inherited properties as present', () => {
      expect(configService.has('__proto__.toString')).toBe(false);
      expect(configService.has('auth.hasOwnProperty')).toBe(false);
      expect(configService.has('constructor')).toBe(false);
    });

    it('should not treat inherited properties as valid config paths', () => {
      expect(() => {
        configService.set('toString', 'PWNED');
      }).toThrow('Invalid path');
      expect(() => {
        configService.set('auth.hasOwnProperty', 'PWNED');
      }).toThrow('Invalid path');
    });
  });
});

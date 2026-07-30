import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  findSyncConfigFile,
  loadSyncConfig,
  validateSyncConfig,
  applyCliOverrides,
  SYNC_CONFIG_FILENAME,
} from '../../../src/sync/sync-config';
import type { SyncConfig } from '../../../src/sync/types';
import { ConfigError, ValidationError } from '../../../src/utils/errors';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/sync/configs');

describe('sync-config', () => {
  describe('findSyncConfigFile', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should find config in current directory', () => {
      const configPath = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, 'version: 1\n');

      const result = findSyncConfigFile(tmpDir);
      expect(result).toBe(configPath);
    });

    it('should find config in parent directory', () => {
      const configPath = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, 'version: 1\n');

      const childDir = path.join(tmpDir, 'src', 'deep');
      fs.mkdirSync(childDir, { recursive: true });

      const result = findSyncConfigFile(childDir);
      expect(result).toBe(configPath);
    });

    it('should return null when no config is found', () => {
      const result = findSyncConfigFile(tmpDir);
      expect(result).toBeNull();
    });

    it('should find a config that lives next to .git', () => {
      fs.mkdirSync(path.join(tmpDir, '.git'));
      const configPath = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, 'version: 1\n');

      const childDir = path.join(tmpDir, 'src');
      fs.mkdirSync(childDir);

      expect(findSyncConfigFile(childDir)).toBe(configPath);
      expect(findSyncConfigFile(tmpDir)).toBe(configPath);
    });

    it('should not adopt a config from an ancestor above the .git boundary', () => {
      const configPath = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, 'version: 1\n');

      const repoDir = path.join(tmpDir, 'repo');
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      const childDir = path.join(repoDir, 'src');
      fs.mkdirSync(childDir);

      expect(findSyncConfigFile(childDir)).toBeNull();
      expect(findSyncConfigFile(repoDir)).toBeNull();
    });

    it('should find a config between the start directory and the .git boundary', () => {
      const repoDir = path.join(tmpDir, 'repo');
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
      const pkgDir = path.join(repoDir, 'packages', 'app');
      fs.mkdirSync(pkgDir, { recursive: true });
      const configPath = path.join(repoDir, 'packages', SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, 'version: 1\n');

      expect(findSyncConfigFile(pkgDir)).toBe(configPath);
    });

    it('should treat a .git file (worktree/submodule) as the boundary', () => {
      const configPath = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, 'version: 1\n');

      const repoDir = path.join(tmpDir, 'repo');
      fs.mkdirSync(repoDir);
      fs.writeFileSync(path.join(repoDir, '.git'), 'gitdir: elsewhere\n');

      expect(findSyncConfigFile(repoDir)).toBeNull();
    });
  });

  describe('validateSyncConfig', () => {
    it('should accept a valid config', () => {
      const raw = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de', 'fr'],
        buckets: {
          json: { include: ['locales/en.json'] },
        },
      };

      const result = validateSyncConfig(raw);
      expect(result.version).toBe(1);
      expect(result.source_locale).toBe('en');
      expect(result.target_locales).toEqual(['de', 'fr']);
      expect(result.buckets['json']?.include).toEqual(['locales/en.json']);
    });

    it('should throw when raw is not an object', () => {
      expect(() => validateSyncConfig('not-an-object')).toThrow(ConfigError);
      expect(() => validateSyncConfig('not-an-object')).toThrow('must be a YAML object');
    });

    it('should throw when raw is null', () => {
      expect(() => validateSyncConfig(null)).toThrow(ConfigError);
    });

    it('should throw when raw is an array', () => {
      expect(() => validateSyncConfig([])).toThrow(ConfigError);
    });

    it('should throw when version is missing', () => {
      expect(() => validateSyncConfig({
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('missing required field: version');
    });

    it('should throw when version is not 1', () => {
      expect(() => validateSyncConfig({
        version: 2,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('Unsupported sync config version: 2');
    });

    it('should throw when source_locale is missing', () => {
      expect(() => validateSyncConfig({
        version: 1,
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('missing required field: source_locale');
    });

    it('should throw when source_locale is empty string', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: '  ',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('missing required field: source_locale');
    });

    it('should reject source_locale containing path traversal', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: '../evil',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('Invalid source locale "../evil"');
    });

    it('should reject source_locale containing forward slash', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en/US',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('Invalid source locale "en/US"');
    });

    it('should reject source_locale containing backslash', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en\\US',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('Invalid source locale "en\\US"');
    });

    it('should reject target_locales containing path traversal', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['../../tmp/evil'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('Invalid target locale "../../tmp/evil"');
    });

    it('should reject target_locales with ../../etc/passwd traversal', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['../../etc/passwd'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow(ConfigError);
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['../../etc/passwd'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow(/path separators/);
    });

    it('should reject target_locales with en/../../tmp traversal', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['en/../../tmp'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow(ConfigError);
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['en/../../tmp'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow(/path separators/);
    });

    it('should reject source_locale with ../evil traversal', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: '../evil',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow(ConfigError);
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: '../evil',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow(/path separators/);
    });

    it('should reject target locales that are not BCP-47 style codes', () => {
      for (const bad of ['de_DE', 'de.json', 'de de', 'x', '.git', 'de!', 'verylonglocale-code-way-too-long']) {
        expect(() => validateSyncConfig({
          version: 1,
          source_locale: 'en',
          target_locales: [bad],
          buckets: { json: { include: ['a.json'] } },
        })).toThrow(ConfigError);
      }
    });

    it('should reject a source_locale that is not a BCP-47 style code', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en_US.utf8',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow(ConfigError);
    });

    it('should accept BCP-47 style locales with script and region subtags', () => {
      const result = validateSyncConfig({
        version: 1,
        source_locale: 'en-US',
        target_locales: ['de', 'pt-BR', 'zh-Hans', 'sr-Latn-RS'],
        buckets: { json: { include: ['a.json'] } },
      });
      expect(result.target_locales).toEqual(['de', 'pt-BR', 'zh-Hans', 'sr-Latn-RS']);
    });

    it('should reject a target_path_pattern that resolves into .git/', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['config'],
        buckets: { json: { include: ['a.json'], target_path_pattern: '.git/{locale}' } },
      })).toThrow(/\.git/);
    });

    it('should reject a target_path_pattern that resolves into .github/', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'], target_path_pattern: '.github/workflows/{locale}.yml' } },
      })).toThrow(ConfigError);
    });

    it('should reject a target_path_pattern with a nested .git segment', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'], target_path_pattern: 'vendor/.git/{locale}.json' } },
      })).toThrow(ConfigError);
    });

    it('should accept a target_path_pattern with a harmless dotted directory', () => {
      const result = validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'], target_path_pattern: 'locales/{locale}/app.json' } },
      });
      expect(result.buckets['json']?.target_path_pattern).toBe('locales/{locale}/app.json');
    });

    it('should throw when target_locales is empty', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: [],
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('target_locales must be a non-empty array');
    });

    it('should throw when target_locales is not an array', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: 'de',
        buckets: { json: { include: ['a.json'] } },
      })).toThrow('target_locales must be a non-empty array');
    });

    it('should throw when buckets is empty', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: {},
      })).toThrow('buckets must be a non-empty object');
    });

    it('should throw when buckets is missing', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
      })).toThrow('buckets must be a non-empty object');
    });

    it('should throw when bucket is missing include', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: {} },
      })).toThrow('bucket "json" must have a non-empty include array');
    });

    it('should throw when bucket include is empty', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: [] } },
      })).toThrow('bucket "json" must have a non-empty include array');
    });

    it('should preserve translation block through validation', () => {
      const raw = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['locales/en.json'] } },
        translation: { formality: 'more', glossary: 'auto' },
      };

      const result = validateSyncConfig(raw);
      expect(result.translation).toEqual({ formality: 'more', glossary: 'auto' });
    });

    it('should preserve tms block through validation', () => {
      const raw = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['locales/en.json'] } },
        tms: { enabled: true, server: 'https://example.com', project_id: 'test' },
      };

      const result = validateSyncConfig(raw);
      expect(result.tms).toEqual({ enabled: true, server: 'https://example.com', project_id: 'test' });
    });

    it('should preserve validation, sync, and ignore blocks', () => {
      const raw = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['locales/en.json'] } },
        validation: { check_placeholders: true, fail_on_error: false },
        sync: { concurrency: 10, batch_size: 25 },
        ignore: ['*.bak', 'tmp/**'],
      };

      const result = validateSyncConfig(raw);
      expect(result.validation).toEqual({ check_placeholders: true, fail_on_error: false });
      expect(result.sync).toEqual({ concurrency: 10, batch_size: 25 });
      expect(result.ignore).toEqual(['*.bak', 'tmp/**']);
    });

    describe('sync.limits', () => {
      const baseConfig = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      };

      it('accepts valid limits within the hard-max ceiling', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          sync: {
            concurrency: 5,
            batch_size: 50,
            limits: {
              max_entries_per_file: 50_000,
              max_file_bytes: 8 * 1024 * 1024,
              max_depth: 48,
            },
          },
        });
        expect(result.sync?.limits).toEqual({
          max_entries_per_file: 50_000,
          max_file_bytes: 8 * 1024 * 1024,
          max_depth: 48,
        });
      });

      it('accepts omitted or partial limits blocks', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: { concurrency: 5, batch_size: 50 },
          }),
        ).not.toThrow();
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: { concurrency: 5, batch_size: 50, limits: { max_depth: 16 } },
          }),
        ).not.toThrow();
      });

      it('rejects max_entries_per_file above the 100_000 ceiling with ConfigError', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: {
              concurrency: 5,
              batch_size: 50,
              limits: { max_entries_per_file: 150_000 },
            },
          }),
        ).toThrow(ConfigError);
      });

      it('rejects max_file_bytes above the 10 MiB ceiling with ConfigError', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: {
              concurrency: 5,
              batch_size: 50,
              limits: { max_file_bytes: 20 * 1024 * 1024 },
            },
          }),
        ).toThrow(ConfigError);
      });

      it('rejects max_depth above the 64 ceiling with ConfigError', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: {
              concurrency: 5,
              batch_size: 50,
              limits: { max_depth: 128 },
            },
          }),
        ).toThrow(ConfigError);
      });

      it('rejects non-integer limit values with ConfigError', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: {
              concurrency: 5,
              batch_size: 50,
              limits: { max_depth: 16.5 },
            },
          }),
        ).toThrow(ConfigError);
      });

      it('rejects zero or negative limits with ConfigError', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: {
              concurrency: 5,
              batch_size: 50,
              limits: { max_depth: 0 },
            },
          }),
        ).toThrow(ConfigError);
      });

      it('rejects unknown keys inside sync.limits with ConfigError', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: {
              concurrency: 5,
              batch_size: 50,
              limits: { max_unknown: 10 },
            },
          }),
        ).toThrow(ConfigError);
      });

      it('rejects sync.limits that is not an object', () => {
        expect(() =>
          validateSyncConfig({
            ...baseConfig,
            sync: { concurrency: 5, batch_size: 50, limits: 'not an object' },
          }),
        ).toThrow(ConfigError);
      });
    });

    it('should throw when translation is a boolean instead of object', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        translation: true,
      })).toThrow(ConfigError);
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        translation: true,
      })).toThrow('translation must be an object');
    });

    it('should throw when translation is an array', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        translation: [1, 2],
      })).toThrow(ConfigError);
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        translation: [1, 2],
      })).toThrow('translation must be an object');
    });

    it('should throw when translation is null', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        translation: null,
      })).toThrow(ConfigError);
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        translation: null,
      })).toThrow('translation must be an object');
    });

    it('should throw when validation is a string instead of object', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        validation: 'invalid',
      })).toThrow(ConfigError);
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
        validation: 'invalid',
      })).toThrow('validation must be an object');
    });

    it('should accept valid target_path_pattern with {locale}', () => {
      const result = validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { android_xml: { include: ['res/values/strings.xml'], target_path_pattern: 'res/values-{locale}/strings.xml' } },
      });
      expect(result.buckets['android_xml']!.target_path_pattern).toBe('res/values-{locale}/strings.xml');
    });

    it('should throw when target_path_pattern is not a string', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'], target_path_pattern: 42 } },
      })).toThrow('target_path_pattern must be a string');
    });

    it('should throw when target_path_pattern lacks {locale}', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'], target_path_pattern: 'res/values/strings.xml' } },
      })).toThrow('target_path_pattern must contain {locale} placeholder');
    });

    it('should throw when target_path_pattern contains ".."', () => {
      expect(() => validateSyncConfig({
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'], target_path_pattern: '../{locale}/strings.xml' } },
      })).toThrow('target_path_pattern must not contain ".."');
    });

    describe('translation_memory_threshold validation', () => {
      const baseConfig = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      };

      it('should reject top-level translation_memory_threshold above 100', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory_threshold: 9999 },
        })).toThrow(ConfigError);
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory_threshold: 9999 },
        })).toThrow('translation.translation_memory_threshold must be an integer between 0 and 100, got: 9999');
      });

      it('should reject negative top-level translation_memory_threshold', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory_threshold: -1 },
        })).toThrow('translation.translation_memory_threshold must be an integer between 0 and 100, got: -1');
      });

      it('should reject non-integer top-level translation_memory_threshold', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory_threshold: 50.5 },
        })).toThrow('translation.translation_memory_threshold must be an integer between 0 and 100, got: 50.5');
      });

      it('should reject non-numeric top-level translation_memory_threshold', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory_threshold: 'abc' },
        })).toThrow('translation.translation_memory_threshold must be an integer between 0 and 100, got: abc');
      });

      it('should accept top-level translation_memory_threshold within range', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory_threshold: 75 },
        });
        expect(result.translation?.translation_memory_threshold).toBe(75);
      });

      it('should accept boundary value 0 for translation_memory_threshold', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory_threshold: 0 },
        });
        expect(result.translation?.translation_memory_threshold).toBe(0);
      });

      it('should reject per-locale translation_memory_threshold above 100 with locale key path', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: {
            locale_overrides: {
              de: { translation_memory_threshold: 200 },
            },
          },
        })).toThrow('translation.locale_overrides.de.translation_memory_threshold must be an integer between 0 and 100, got: 200');
      });

      it('should accept per-locale translation_memory_threshold within range', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          translation: {
            locale_overrides: {
              de: { translation_memory_threshold: 90 },
            },
          },
        });
        expect(result.translation?.locale_overrides?.['de']?.translation_memory_threshold).toBe(90);
      });

      it('should accept missing (undefined) translation_memory_threshold', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          translation: { glossary: 'my-glossary' },
        });
        expect(result.translation?.translation_memory_threshold).toBeUndefined();
      });
    });

    describe('translation_memory + model_type pairing validation', () => {
      const baseConfig = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      };

      it('should accept translation_memory without model_type', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory: 'my-tm' },
        });
        expect(result.translation?.translation_memory).toBe('my-tm');
      });

      it('should accept translation_memory with model_type: quality_optimized', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory: 'my-tm', model_type: 'quality_optimized' },
        });
        expect(result.translation?.model_type).toBe('quality_optimized');
      });

      it('should reject translation_memory with model_type: latency_optimized', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory: 'my-tm', model_type: 'latency_optimized' },
        })).toThrow(ConfigError);
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory: 'my-tm', model_type: 'latency_optimized' },
        })).toThrow(
          "translation.model_type must be 'quality_optimized' when translation_memory is set, got: latency_optimized",
        );
      });

      it('should reject translation_memory with model_type: prefer_quality_optimized', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: { translation_memory: 'my-tm', model_type: 'prefer_quality_optimized' },
        })).toThrow(
          "translation.model_type must be 'quality_optimized' when translation_memory is set, got: prefer_quality_optimized",
        );
      });

      it('should reject per-locale override with latency_optimized when TM set at top level', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: {
            translation_memory: 'my-tm',
            model_type: 'quality_optimized',
            locale_overrides: {
              de: { model_type: 'latency_optimized' },
            },
          },
        })).toThrow(
          "translation.locale_overrides.de.model_type must be 'quality_optimized' when translation_memory is set, got: latency_optimized",
        );
      });

      it('should reject per-locale override with latency_optimized when TM set in the same override', () => {
        expect(() => validateSyncConfig({
          ...baseConfig,
          translation: {
            model_type: 'quality_optimized',
            locale_overrides: {
              de: { translation_memory: 'de-tm', model_type: 'latency_optimized' },
            },
          },
        })).toThrow(
          "translation.locale_overrides.de.model_type must be 'quality_optimized' when translation_memory is set, got: latency_optimized",
        );
      });

      it('should accept model_type: latency_optimized when translation_memory is not set', () => {
        const result = validateSyncConfig({
          ...baseConfig,
          translation: { model_type: 'latency_optimized' },
        });
        expect(result.translation?.model_type).toBe('latency_optimized');
      });
    });

    describe('strict unknown-field rejection', () => {
      const baseConfig = {
        version: 1,
        source_locale: 'en',
        target_locales: ['de'],
        buckets: { json: { include: ['a.json'] } },
      };

      it('should reject unknown top-level field and name it in the error', () => {
        const raw = { ...baseConfig, target_locale: 'en' };
        expect(() => validateSyncConfig(raw)).toThrow(ConfigError);
        expect(() => validateSyncConfig(raw)).toThrow(/Unknown field "target_locale"/);
      });

      it('should suggest target_locales when user typed target_locale', () => {
        const raw = { ...baseConfig, target_locale: 'en' };
        try {
          validateSyncConfig(raw);
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).suggestion).toMatch(/target_locales/);
        }
      });

      it('should suggest buckets when user typed bucket', () => {
        const raw = {
          version: 1,
          source_locale: 'en',
          target_locales: ['de'],
          bucket: { json: { include: ['a.json'] } },
        };
        try {
          validateSyncConfig(raw);
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).message).toMatch(/Unknown field "bucket"/);
          expect((err as ConfigError).suggestion).toMatch(/buckets/);
        }
      });

      it('should suggest translation when user typed translate', () => {
        const raw = { ...baseConfig, translate: { formality: 'more' } };
        try {
          validateSyncConfig(raw);
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).message).toMatch(/Unknown field "translate"/);
          expect((err as ConfigError).suggestion).toMatch(/translation/);
        }
      });

      it('should reject unknown bucket-level field with bucket path in context', () => {
        const raw = {
          ...baseConfig,
          buckets: { json: { includes: ['a.json'] } },
        };
        expect(() => validateSyncConfig(raw)).toThrow(ConfigError);
        expect(() => validateSyncConfig(raw)).toThrow(/Unknown field "includes"/);
        expect(() => validateSyncConfig(raw)).toThrow(/buckets\.json/);
      });

      it('should suggest include when user typed includes at bucket level', () => {
        const raw = {
          ...baseConfig,
          buckets: { json: { includes: ['a.json'] } },
        };
        try {
          validateSyncConfig(raw);
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).suggestion).toMatch(/\binclude\b/);
        }
      });

      it('should reject unknown translation field', () => {
        const raw = {
          ...baseConfig,
          translation: { formalness: 'more' },
        };
        expect(() => validateSyncConfig(raw)).toThrow(ConfigError);
        expect(() => validateSyncConfig(raw)).toThrow(/Unknown field "formalness"/);
        expect(() => validateSyncConfig(raw)).toThrow(/translation/);
      });

      it('should reject unknown tms field and suggest api_key for apikey typo', () => {
        const raw = {
          ...baseConfig,
          tms: {
            enabled: true,
            server: 'https://example.com',
            project_id: 'test',
            apikey: 'secret',
          },
        };
        try {
          validateSyncConfig(raw);
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).message).toMatch(/Unknown field "apikey"/);
          expect((err as ConfigError).message).toMatch(/tms/);
          expect((err as ConfigError).suggestion).toMatch(/api_key/);
        }
      });

      it('should reject unknown field inside locale_overrides.<locale>', () => {
        const raw = {
          ...baseConfig,
          translation: {
            locale_overrides: {
              de: { formalness: 'more' },
            },
          },
        };
        expect(() => validateSyncConfig(raw)).toThrow(ConfigError);
        expect(() => validateSyncConfig(raw)).toThrow(/Unknown field "formalness"/);
        expect(() => validateSyncConfig(raw)).toThrow(/locale_overrides\.de/);
      });

      it('should reject unknown validation field', () => {
        const raw = {
          ...baseConfig,
          validation: { fail_on_missings: true },
        };
        expect(() => validateSyncConfig(raw)).toThrow(ConfigError);
        expect(() => validateSyncConfig(raw)).toThrow(/Unknown field "fail_on_missings"/);
      });

      it('should reject unknown sync-behavior field', () => {
        const raw = {
          ...baseConfig,
          sync: { concurrency: 5, batch_size: 50, maxchars: 1000 },
        };
        expect(() => validateSyncConfig(raw)).toThrow(ConfigError);
        expect(() => validateSyncConfig(raw)).toThrow(/Unknown field "maxchars"/);
      });

      it('should reject unknown context field', () => {
        const raw = {
          ...baseConfig,
          context: { enabled: true, scanpaths: ['src/**/*.ts'] },
        };
        expect(() => validateSyncConfig(raw)).toThrow(ConfigError);
        expect(() => validateSyncConfig(raw)).toThrow(/Unknown field "scanpaths"/);
      });

      it('should accept a fully-populated valid config with all known keys', () => {
        const raw = {
          version: 1,
          source_locale: 'en',
          target_locales: ['de', 'fr'],
          buckets: {
            json: {
              include: ['locales/en.json'],
              exclude: ['locales/en/_generated.json'],
              key_style: 'nested' as const,
              target_path_pattern: 'locales/{locale}.json',
            },
          },
          translation: {
            formality: 'more' as const,
            model_type: 'quality_optimized' as const,
            glossary: 'g',
            translation_memory: 'tm',
            translation_memory_threshold: 80,
            custom_instructions: ['be concise'],
            style_id: 's',
            instruction_templates: { button: 'short' },
            length_limits: { enabled: true, expansion_factors: { de: 1.3 } },
            locale_overrides: {
              de: {
                formality: 'more' as const,
                glossary: 'g-de',
                translation_memory: 'tm',
                translation_memory_threshold: 75,
                custom_instructions: ['tone'],
                style_id: 's-de',
                model_type: 'quality_optimized' as const,
              },
            },
          },
          context: {
            enabled: true,
            scan_paths: ['src/**/*.ts'],
            function_names: ['t'],
            context_lines: 3,
            overrides: { save: 'Save button' },
          },
          validation: {
            check_placeholders: true,
            fail_on_error: false,
            validate_after_sync: true,
            fail_on_missing: true,
            fail_on_stale: true,
          },
          sync: {
            concurrency: 5,
            batch_size: 50,
            max_characters: 100000,
            backup: true,
            batch: false,
          },
          ignore: ['*.bak'],
          tms: {
            enabled: true,
            server: 'https://example.com',
            project_id: 'test',
            api_key: 'secret',
            token: 'bearer',
            auto_push: false,
            auto_pull: false,
            require_review: ['de'],
            timeout_ms: 30000,
          },
        };
        expect(() => validateSyncConfig(raw)).not.toThrow();
      });
    });

    describe('ConfigError suggestion contract', () => {
      const malformedConfigs: ReadonlyArray<{ label: string; raw: unknown }> = [
        { label: 'non-object root', raw: 'not-an-object' },
        { label: 'null root', raw: null },
        { label: 'array root', raw: [] },
        {
          label: 'missing version',
          raw: { source_locale: 'en', target_locales: ['de'], buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'wrong version',
          raw: { version: 2, source_locale: 'en', target_locales: ['de'], buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'missing source_locale',
          raw: { version: 1, target_locales: ['de'], buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'source_locale with path separator',
          raw: { version: 1, source_locale: 'en/US', target_locales: ['de'], buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'target_locales not array',
          raw: { version: 1, source_locale: 'en', target_locales: 'de', buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'target_locales contains non-string',
          raw: { version: 1, source_locale: 'en', target_locales: [42], buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'target locale with path traversal',
          raw: { version: 1, source_locale: 'en', target_locales: ['../evil'], buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'target_locales contains source_locale',
          raw: { version: 1, source_locale: 'en', target_locales: ['en'], buckets: { json: { include: ['a.json'] } } },
        },
        {
          label: 'missing buckets',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'] },
        },
        {
          label: 'empty buckets object',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: {} },
        },
        {
          label: 'bucket not an object',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: 'oops' } },
        },
        {
          label: 'bucket missing include',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: {} } },
        },
        {
          label: 'bucket include contains non-string',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: { include: [42] } } },
        },
        {
          label: 'target_path_pattern wrong type',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: { include: ['a.json'], target_path_pattern: 42 } } },
        },
        {
          label: 'target_path_pattern missing {locale}',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: { include: ['a.json'], target_path_pattern: 'res/strings.xml' } } },
        },
        {
          label: 'target_path_pattern with ..',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: { include: ['a.json'], target_path_pattern: '../{locale}/strings.xml' } } },
        },
        {
          label: 'translation block not an object',
          raw: { version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: { include: ['a.json'] } }, translation: true },
        },
        {
          label: 'translation_memory_threshold out of range',
          raw: {
            version: 1,
            source_locale: 'en',
            target_locales: ['de'],
            buckets: { json: { include: ['a.json'] } },
            translation: { translation_memory_threshold: 9999 },
          },
        },
        {
          label: 'translation_memory + incompatible model_type',
          raw: {
            version: 1,
            source_locale: 'en',
            target_locales: ['de'],
            buckets: { json: { include: ['a.json'] } },
            translation: { translation_memory: 'tm', model_type: 'latency_optimized' },
          },
        },
      ];

      it.each(malformedConfigs)('every ConfigError from $label includes a suggestion', ({ raw }) => {
        let caught: unknown;
        try {
          validateSyncConfig(raw);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ConfigError);
        const err = caught as ConfigError;
        expect(typeof err.suggestion).toBe('string');
        expect((err.suggestion ?? '').length).toBeGreaterThan(0);
      });

      it('suggestion for missing source_locale mentions source_locale', () => {
        try {
          validateSyncConfig({ version: 1, target_locales: ['de'], buckets: { json: { include: ['a.json'] } } });
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).suggestion).toMatch(/source_locale/);
        }
      });

      it('suggestion for bucket missing include mentions include', () => {
        try {
          validateSyncConfig({ version: 1, source_locale: 'en', target_locales: ['de'], buckets: { json: {} } });
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).suggestion).toMatch(/include/);
        }
      });

      it('suggestion for target_path_pattern missing placeholder mentions {locale}', () => {
        try {
          validateSyncConfig({
            version: 1,
            source_locale: 'en',
            target_locales: ['de'],
            buckets: { json: { include: ['a.json'], target_path_pattern: 'res/strings.xml' } },
          });
          fail('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as ConfigError).suggestion).toMatch(/\{locale\}/);
        }
      });
    });
  });

  describe('loadSyncConfig', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-load-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should load and parse a valid YAML config', async () => {
      const configPath = path.join(FIXTURES_DIR, 'valid.yaml');
      const result = await loadSyncConfig(undefined, { configPath });

      expect(result.version).toBe(1);
      expect(result.source_locale).toBe('en');
      expect(result.target_locales).toEqual(['de', 'fr']);
      expect(result.buckets['json']?.include).toEqual(['locales/en.json']);
      expect(result.configPath).toBe(configPath);
      expect(result.projectRoot).toBe(path.dirname(configPath));
    });

    it('should throw ConfigError when file is not found', async () => {
      await expect(
        loadSyncConfig(tmpDir),
      ).rejects.toThrow(ConfigError);
    });

    it('should throw ConfigError when configPath override points to missing file', async () => {
      await expect(
        loadSyncConfig(undefined, { configPath: '/nonexistent/path/.deepl-sync.yaml' }),
      ).rejects.toThrow(ConfigError);
    });

    it('should throw ConfigError with exit code 7 for malformed YAML', async () => {
      const badYaml = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(badYaml, '{{{{invalid yaml');

      await expect(
        loadSyncConfig(tmpDir),
      ).rejects.toThrow(ConfigError);

      try {
        await loadSyncConfig(tmpDir);
        fail('expected loadSyncConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err).not.toBeInstanceOf(ValidationError);
        expect((err as ConfigError).exitCode).toBe(7);
        expect((err as ConfigError).message).toContain('Failed to parse YAML');
      }
    });

    it('should use configPath override when provided', async () => {
      const configPath = path.join(FIXTURES_DIR, 'minimal.yaml');
      const result = await loadSyncConfig('/some/other/dir', { configPath });

      expect(result.source_locale).toBe('en');
      expect(result.configPath).toBe(configPath);
    });

    it('should merge overrides into the resolved config', async () => {
      const configPath = path.join(FIXTURES_DIR, 'valid.yaml');
      const overrides = { frozen: true, dryRun: true, configPath };
      const result = await loadSyncConfig(undefined, overrides);

      expect(result.overrides.frozen).toBe(true);
      expect(result.overrides.dryRun).toBe(true);
    });

    it('should load multi-bucket config', async () => {
      const configPath = path.join(FIXTURES_DIR, 'multi-bucket.yaml');
      const result = await loadSyncConfig(undefined, { configPath });

      expect(Object.keys(result.buckets)).toEqual(['json', 'yaml']);
      expect(result.buckets['yaml']?.include).toEqual(['config/*.yaml', 'i18n/*.yml']);
    });

    it('should merge formality CLI override into existing translation block', async () => {
      const configYaml = `version: 1
source_locale: en
target_locales: [de]
buckets:
  json:
    include: ['locales/en.json']
translation:
  glossary: my-glossary
`;
      const configPath = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, configYaml);

      const result = await loadSyncConfig(tmpDir, { formality: 'more' });
      expect(result.translation?.formality).toBe('more');
      expect(result.translation?.glossary).toBe('my-glossary');
    });

    it('should create translation block when CLI override needs it', async () => {
      const configPath = path.join(FIXTURES_DIR, 'valid.yaml');
      const result = await loadSyncConfig(undefined, { configPath, formality: 'less' });
      expect(result.translation?.formality).toBe('less');
    });

    it('should merge glossary CLI override into translation block', async () => {
      const configPath = path.join(FIXTURES_DIR, 'valid.yaml');
      const result = await loadSyncConfig(undefined, { configPath, glossary: 'my-glossary' });
      expect(result.translation?.glossary).toBe('my-glossary');
    });

    it('should merge modelType CLI override into translation block', async () => {
      const configPath = path.join(FIXTURES_DIR, 'valid.yaml');
      const result = await loadSyncConfig(undefined, { configPath, modelType: 'quality_optimized' });
      expect(result.translation?.model_type).toBe('quality_optimized');
    });

    it('should merge context CLI override into context block', async () => {
      const configPath = path.join(FIXTURES_DIR, 'valid.yaml');
      const result = await loadSyncConfig(undefined, { configPath, context: true });
      expect(result.context?.enabled).toBe(true);
    });
  });

  describe('applyCliOverrides', () => {
    const baseConfig = (): SyncConfig => ({
      version: 1,
      source_locale: 'en',
      target_locales: ['de'],
      buckets: { json: { include: ['locales/en.json'] } },
    });

    it('should accept a localeFilter whose entries are all in target_locales', () => {
      const config = baseConfig();
      config.target_locales = ['de', 'fr'];
      expect(() => applyCliOverrides(config, { localeFilter: ['de', 'fr'] })).not.toThrow();
    });

    it('should throw ConfigError naming the offending and configured locales', () => {
      const config = baseConfig();
      config.target_locales = ['de', 'fr'];
      expect(() => applyCliOverrides(config, { localeFilter: ['es'] })).toThrow(ConfigError);
      expect(() => applyCliOverrides(config, { localeFilter: ['es'] })).toThrow(/es/);
      expect(() => applyCliOverrides(config, { localeFilter: ['es'] })).toThrow(/de, fr/);
    });

    it('should report every unconfigured locale in a mixed filter', () => {
      const config = baseConfig();
      config.target_locales = ['de', 'fr'];
      expect(() => applyCliOverrides(config, { localeFilter: ['de', 'es', 'zz'] })).toThrow(
        /es, zz/,
      );
    });

    it('should merge formality into existing translation block', () => {
      const config = baseConfig();
      config.translation = { glossary: 'g' };
      const result = applyCliOverrides(config, { formality: 'more' });
      expect(result.translation?.formality).toBe('more');
      expect(result.translation?.glossary).toBe('g');
    });

    it('should create translation block when only formality override is supplied', () => {
      const result = applyCliOverrides(baseConfig(), { formality: 'less' });
      expect(result.translation?.formality).toBe('less');
    });

    it('should merge glossary into translation block', () => {
      const result = applyCliOverrides(baseConfig(), { glossary: 'my-g' });
      expect(result.translation?.glossary).toBe('my-g');
    });

    it('should merge modelType into translation block', () => {
      const result = applyCliOverrides(baseConfig(), { modelType: 'quality_optimized' });
      expect(result.translation?.model_type).toBe('quality_optimized');
    });

    it('should merge context enabled into context block', () => {
      const result = applyCliOverrides(baseConfig(), { context: true });
      expect(result.context?.enabled).toBe(true);
    });

    it('should preserve existing context block when overriding enabled', () => {
      const config = baseConfig();
      config.context = { enabled: false, scan_paths: ['src/**/*.ts'] };
      const result = applyCliOverrides(config, { context: true });
      expect(result.context?.enabled).toBe(true);
      expect(result.context?.scan_paths).toEqual(['src/**/*.ts']);
    });

    it('should merge batch flag into existing sync block', () => {
      const config = baseConfig();
      config.sync = { concurrency: 3, batch_size: 25 };
      const result = applyCliOverrides(config, { batch: false });
      expect(result.sync?.batch).toBe(false);
      expect(result.sync?.concurrency).toBe(3);
      expect(result.sync?.batch_size).toBe(25);
    });

    it('should create a sync block with defaults when batch override needs it', () => {
      const result = applyCliOverrides(baseConfig(), { batch: true });
      expect(result.sync?.batch).toBe(true);
      expect(result.sync?.concurrency).toBe(5);
      expect(result.sync?.batch_size).toBe(50);
    });

    it('should be a no-op when no overrides are supplied', () => {
      const config = baseConfig();
      config.translation = { formality: 'default' };
      const result = applyCliOverrides(config, {});
      expect(result.translation?.formality).toBe('default');
    });

    it('should reject model_type override that breaks translation_memory compatibility', () => {
      const config = baseConfig();
      config.translation = { translation_memory: 'tm-1', model_type: 'quality_optimized' };
      expect(() =>
        applyCliOverrides(config, { modelType: 'latency_optimized' }),
      ).toThrow(ConfigError);
    });

    it('should accept model_type override when translation_memory is not set', () => {
      const result = applyCliOverrides(baseConfig(), { modelType: 'latency_optimized' });
      expect(result.translation?.model_type).toBe('latency_optimized');
    });
  });

  describe('inline TMS credential warning', () => {
    let tmpDir: string;
    let originalIsTTY: boolean | undefined;
    let originalApiKey: string | undefined;
    let originalToken: string | undefined;
    let stderrSpy: jest.SpyInstance;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-tms-warn-'));
      originalIsTTY = process.stderr.isTTY;
      originalApiKey = process.env['TMS_API_KEY'];
      originalToken = process.env['TMS_TOKEN'];
      delete process.env['TMS_API_KEY'];
      delete process.env['TMS_TOKEN'];
      stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
      if (originalApiKey !== undefined) process.env['TMS_API_KEY'] = originalApiKey;
      if (originalToken !== undefined) process.env['TMS_TOKEN'] = originalToken;
      stderrSpy.mockRestore();
    });

    const writeConfig = (extra: string): string => {
      const configYaml = `version: 1
source_locale: en
target_locales: [de]
buckets:
  json:
    include: ['locales/en.json']
tms:
  server: https://tms.example.com
  project_id: demo
${extra}
`;
      const configPath = path.join(tmpDir, SYNC_CONFIG_FILENAME);
      fs.writeFileSync(configPath, configYaml);
      return configPath;
    };

    it('emits a stderr warning when tms.api_key is inlined and stderr is not a TTY', async () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
      writeConfig('  api_key: secret-key');

      await loadSyncConfig(tmpDir);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(writes).toMatch(/TMS_API_KEY/);
      expect(writes).toMatch(/\.deepl-sync\.yaml/);
    });

    it('emits a stderr warning when tms.token is inlined and stderr is not a TTY', async () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
      writeConfig('  token: secret-token');

      await loadSyncConfig(tmpDir);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(writes).toMatch(/TMS_TOKEN/);
    });

    it('still emits the warning when stderr is a TTY', async () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
      writeConfig('  api_key: secret-key');

      await loadSyncConfig(tmpDir);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(writes).toMatch(/TMS_API_KEY/);
    });

    it('does not emit the warning when tms.api_key is absent', async () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
      writeConfig('  enabled: false');

      await loadSyncConfig(tmpDir);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(writes).not.toMatch(/TMS_API_KEY/);
      expect(writes).not.toMatch(/TMS_TOKEN/);
    });

    it('does not emit the warning when TMS_API_KEY env var is already set', async () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
      process.env['TMS_API_KEY'] = 'env-key';
      writeConfig('  api_key: secret-key');

      await loadSyncConfig(tmpDir);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(writes).not.toMatch(/TMS_API_KEY/);
    });
  });

  describe('error message terminal sanitization', () => {
    it('replaces control chars in unknown-field key before rendering in ConfigError', () => {
      expect.assertions(4);
      const evil = 'evil\x1b[31mkey\x00';
      try {
        validateSyncConfig({
          version: 1,
          source_locale: 'en',
          target_locales: ['de'],
          buckets: { json: { include: ['a.json'] } },
          [evil]: 1,
        });
        throw new Error('expected ConfigError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const msg = (err as ConfigError).message;
        expect(msg).not.toContain('\x1b');
        expect(msg).not.toContain('\x00');
        expect(msg).toContain('?');
      }
    });

    it('replaces zero-width codepoints in unknown-field key before rendering in ConfigError', () => {
      expect.assertions(2);
      const evil = 'foo\u200bbar';
      try {
        validateSyncConfig({
          version: 1,
          source_locale: 'en',
          target_locales: ['de'],
          buckets: { json: { include: ['a.json'] } },
          [evil]: 1,
        });
        throw new Error('expected ConfigError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const msg = (err as ConfigError).message;
        expect(msg).not.toContain('\u200b');
      }
    });

    it('replaces control chars in source_locale echo', () => {
      expect.assertions(2);
      try {
        validateSyncConfig({
          version: 1,
          source_locale: 'en\x1b/US',
          target_locales: ['de'],
          buckets: { json: { include: ['a.json'] } },
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as ConfigError).message).not.toContain('\x1b');
      }
    });

    it('replaces control chars in target_locale echo', () => {
      expect.assertions(2);
      try {
        validateSyncConfig({
          version: 1,
          source_locale: 'en',
          target_locales: ['de\x00/evil'],
          buckets: { json: { include: ['a.json'] } },
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as ConfigError).message).not.toContain('\x00');
      }
    });

    it('replaces control chars in bucket-name echo for malformed bucket', () => {
      expect.assertions(2);
      try {
        validateSyncConfig({
          version: 1,
          source_locale: 'en',
          target_locales: ['de'],
          buckets: { 'evil\x1bname': null },
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as ConfigError).message).not.toContain('\x1b');
      }
    });
  });
});

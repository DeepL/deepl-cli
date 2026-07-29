import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';

jest.mock('fast-glob', () => {
  const mockFg = jest.fn().mockResolvedValue([]);
  return {
    __esModule: true,
    default: mockFg,
  };
});

import fg from 'fast-glob';
import {
  detectI18nFiles,
  generateSyncConfig,
  writeSyncConfig,
  configExists,
  resolveInitConfigPath,
} from '../../../src/sync/sync-init';

const mockFg = fg as jest.MockedFunction<typeof fg>;

describe('sync-init', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `deepl-sync-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    mockFg.mockReset();
    mockFg.mockResolvedValue([]);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('detectI18nFiles', () => {
    it('should find JSON files in locales/en.json', async () => {
      const localesDir = path.join(testDir, 'locales');
      fs.mkdirSync(localesDir, { recursive: true });
      fs.writeFileSync(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ hello: 'Hello', world: 'World' }),
      );

      mockFg.mockImplementation(async (patterns, _options) => {
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];
        if (patternArray.includes('locales/en.json')) {
          return ['locales/en.json'];
        }
        return [];
      });

      const result = await detectI18nFiles(testDir);

      expect(result.length).toBeGreaterThanOrEqual(1);
      const jsonProject = result.find((p) => p.format === 'json');
      expect(jsonProject).toBeDefined();
      expect(jsonProject!.sourceLocale).toBe('en');
      expect(jsonProject!.keyCount).toBe(2);
    });

    it('should find YAML files', async () => {
      const localesDir = path.join(testDir, 'locales');
      fs.mkdirSync(localesDir, { recursive: true });
      fs.writeFileSync(
        path.join(localesDir, 'en.yaml'),
        YAML.stringify({ greeting: 'Hello', farewell: 'Goodbye', thanks: 'Thank you' }),
      );

      mockFg.mockImplementation(async (patterns, _options) => {
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];
        if (patternArray.includes('locales/en.yaml')) {
          return ['locales/en.yaml'];
        }
        return [];
      });

      const result = await detectI18nFiles(testDir);

      const yamlProject = result.find((p) => p.format === 'yaml');
      expect(yamlProject).toBeDefined();
      expect(yamlProject!.sourceLocale).toBe('en');
      expect(yamlProject!.keyCount).toBe(3);
    });

    it('should detect Android XML using the documented bucket key', async () => {
      const resDir = path.join(testDir, 'res', 'values');
      fs.mkdirSync(resDir, { recursive: true });
      fs.writeFileSync(path.join(resDir, 'strings.xml'), '<resources><string name="app_name">App</string></resources>');

      mockFg.mockImplementation(async (patterns, _options) => {
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];
        if (patternArray.includes('res/values/strings.xml')) {
          return ['res/values/strings.xml'];
        }
        return [];
      });

      const result = await detectI18nFiles(testDir);

      const androidProject = result.find((p) => p.format === 'android_xml');
      expect(androidProject).toBeDefined();
      expect(androidProject!.pattern).toBe('res/values/strings.xml');
      expect(androidProject!.targetPathPattern).toBe('res/values-{locale}/strings.xml');
    });

    it('should detect iOS strings using the documented bucket key', async () => {
      const iosDir = path.join(testDir, 'en.lproj');
      fs.mkdirSync(iosDir, { recursive: true });
      fs.writeFileSync(path.join(iosDir, 'Localizable.strings'), '"greeting" = "Hello";');

      mockFg.mockImplementation(async (patterns, _options) => {
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];
        if (patternArray.includes('*.lproj/Localizable.strings')) {
          return ['en.lproj/Localizable.strings'];
        }
        return [];
      });

      const result = await detectI18nFiles(testDir);

      const iosProject = result.find((p) => p.format === 'ios_strings');
      expect(iosProject).toBeDefined();
      expect(iosProject!.pattern).toBe('en.lproj/Localizable.strings');
      expect(iosProject!.targetPathPattern).toBeUndefined();
    });

    it('should detect XLIFF projects', async () => {
      const localeDir = path.join(testDir, 'src', 'locale');
      fs.mkdirSync(localeDir, { recursive: true });
      fs.writeFileSync(path.join(localeDir, 'messages.xlf'), '<xliff version="1.2"></xliff>');

      mockFg.mockImplementation(async (patterns, _options) => {
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];
        if (patternArray.includes('src/locale/messages.xlf')) {
          return ['src/locale/messages.xlf'];
        }
        return [];
      });

      const result = await detectI18nFiles(testDir);

      const xliffProject = result.find((p) => p.format === 'xliff');
      expect(xliffProject).toBeDefined();
      expect(xliffProject!.pattern).toBe('src/locale/messages.xlf');
      expect(xliffProject!.targetPathPattern).toBe('src/locale/messages.{locale}.xlf');
    });

    it('should return empty array when no i18n files found', async () => {
      mockFg.mockResolvedValue([]);

      const result = await detectI18nFiles(testDir);

      expect(result).toEqual([]);
    });

    describe('Rails auto-detect', () => {
      it('detects Rails canonical layout (config/locales/en.yml)', async () => {
        const railsDir = path.join(testDir, 'config', 'locales');
        fs.mkdirSync(railsDir, { recursive: true });
        fs.writeFileSync(
          path.join(railsDir, 'en.yml'),
          'en:\n  greeting: "Hello"\n  farewell: "Goodbye"\n',
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('config/locales/en.yml') ? ['config/locales/en.yml'] : [];
        });

        const result = await detectI18nFiles(testDir);
        const rails = result.find((p) => p.format === 'yaml');
        expect(rails).toBeDefined();
        expect(rails!.pattern).toBe('config/locales/en.yml');
        expect(rails!.keyCount).toBe(2);
      });

      it('preserves the `.yml` extension in the generated bucket pattern', async () => {
        // A `locales/en.yml` match must generate a `.yml` bucket pattern; a
        // `.yaml` pattern would not match the file at sync time.
        fs.mkdirSync(path.join(testDir, 'locales'), { recursive: true });
        fs.writeFileSync(path.join(testDir, 'locales', 'en.yml'), 'greeting: Hello\n');

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('locales/en.yml') ? ['locales/en.yml'] : [];
        });

        const result = await detectI18nFiles(testDir);
        const yaml = result.find((p) => p.format === 'yaml');
        expect(yaml?.pattern).toBe('locales/en.yml');
      });
    });

    describe('Xcode String Catalog auto-detect', () => {
      it('detects Xcode layout (Resources/Localizable.xcstrings)', async () => {
        const resDir = path.join(testDir, 'Resources');
        fs.mkdirSync(resDir, { recursive: true });
        fs.writeFileSync(
          path.join(resDir, 'Localizable.xcstrings'),
          JSON.stringify({
            sourceLanguage: 'en',
            strings: { hi: { localizations: { en: { stringUnit: { state: 'translated', value: 'Hi' } } } } },
          }),
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('Resources/Localizable.xcstrings')
            ? ['Resources/Localizable.xcstrings']
            : [];
        });

        const result = await detectI18nFiles(testDir);
        const xc = result.find((p) => p.format === 'xcstrings');
        expect(xc).toBeDefined();
        expect(xc!.pattern).toBe('Resources/Localizable.xcstrings');
        // Multi-locale: no target_path_pattern (same file is the target).
        expect(xc!.targetPathPattern).toBeUndefined();
      });

      it('detects root-level `Localizable.xcstrings`', async () => {
        fs.writeFileSync(
          path.join(testDir, 'Localizable.xcstrings'),
          JSON.stringify({ sourceLanguage: 'en', strings: {} }),
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('Localizable.xcstrings') ? ['Localizable.xcstrings'] : [];
        });

        const result = await detectI18nFiles(testDir);
        expect(result.find((p) => p.format === 'xcstrings')?.pattern).toBe(
          'Localizable.xcstrings',
        );
      });
    });

    describe('go-i18n TOML auto-detect', () => {
      it('detects `locales/en.toml` layout', async () => {
        fs.mkdirSync(path.join(testDir, 'locales'), { recursive: true });
        fs.writeFileSync(
          path.join(testDir, 'locales', 'en.toml'),
          '[greeting]\nother = "Hello"\n',
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('locales/en.toml') ? ['locales/en.toml'] : [];
        });

        const result = await detectI18nFiles(testDir);
        const toml = result.find((p) => p.format === 'toml');
        expect(toml).toBeDefined();
        expect(toml!.pattern).toBe('locales/en.toml');
      });
    });

    describe('Java Spring properties auto-detect', () => {
      it('detects canonical Maven/Gradle layout (src/main/resources/messages_en.properties)', async () => {
        const springDir = path.join(testDir, 'src', 'main', 'resources');
        fs.mkdirSync(springDir, { recursive: true });
        fs.writeFileSync(
          path.join(springDir, 'messages_en.properties'),
          'welcome=Welcome\ngreeting=Hello\n',
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('src/main/resources/messages_en.properties')
            ? ['src/main/resources/messages_en.properties']
            : [];
        });

        const result = await detectI18nFiles(testDir);
        const props = result.find((p) => p.format === 'properties');
        expect(props).toBeDefined();
        expect(props!.pattern).toBe('src/main/resources/messages_en.properties');
        expect(props!.keyCount).toBe(2);
      });
    });

    describe('Laravel auto-detect', () => {
      it('detects Laravel 9+ layout (lang/en/*.php with composer.json)', async () => {
        fs.writeFileSync(path.join(testDir, 'composer.json'), '{}');
        const langEn = path.join(testDir, 'lang', 'en');
        fs.mkdirSync(langEn, { recursive: true });
        fs.writeFileSync(
          path.join(langEn, 'messages.php'),
          `<?php return ['greeting' => 'Hello'];`,
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          if (arr.includes('lang/en/*.php')) return ['lang/en/messages.php'];
          return [];
        });

        const result = await detectI18nFiles(testDir);
        const laravel = result.find((p) => p.format === 'laravel_php');
        expect(laravel).toBeDefined();
        expect(laravel!.sourceLocale).toBe('en');
        expect(laravel!.pattern).toBe('lang/en/*.php');
        expect(laravel!.keyCount).toBe(1);
      });

      it('detects Laravel ≤8 / Lumen layout (resources/lang/en/*.php with composer.json)', async () => {
        fs.writeFileSync(path.join(testDir, 'composer.json'), '{}');
        const langEn = path.join(testDir, 'resources', 'lang', 'en');
        fs.mkdirSync(langEn, { recursive: true });
        fs.writeFileSync(
          path.join(langEn, 'messages.php'),
          `<?php return ['greeting' => 'Hello', 'farewell' => 'Goodbye'];`,
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          if (arr.includes('resources/lang/en/*.php')) {
            return ['resources/lang/en/messages.php'];
          }
          return [];
        });

        const result = await detectI18nFiles(testDir);
        const laravel = result.find((p) => p.format === 'laravel_php');
        expect(laravel).toBeDefined();
        expect(laravel!.pattern).toBe('resources/lang/en/*.php');
        expect(laravel!.keyCount).toBe(2);
      });

      it('does NOT detect when lang/ files exist but composer.json is absent', async () => {
        const langEn = path.join(testDir, 'lang', 'en');
        fs.mkdirSync(langEn, { recursive: true });
        fs.writeFileSync(
          path.join(langEn, 'messages.php'),
          `<?php return ['greeting' => 'Hello'];`,
        );

        // Even if fg WOULD match, the requires-gate should skip the glob entirely.
        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          if (arr.includes('lang/en/*.php')) return ['lang/en/messages.php'];
          return [];
        });

        const result = await detectI18nFiles(testDir);
        expect(result.find((p) => p.format === 'laravel_php')).toBeUndefined();
      });

      it('does NOT detect when composer.json exists but no lang files match', async () => {
        fs.writeFileSync(path.join(testDir, 'composer.json'), '{}');
        mockFg.mockResolvedValue([]);

        const result = await detectI18nFiles(testDir);
        expect(result.find((p) => p.format === 'laravel_php')).toBeUndefined();
      });

      it('does not parse composer.json (filesystem-only marker)', async () => {
        // An unreadable composer.json must still count as "present" — the
        // detector checks existence, never content.
        const composerPath = path.join(testDir, 'composer.json');
        fs.writeFileSync(composerPath, 'not valid json at all }{');
        const langEn = path.join(testDir, 'lang', 'en');
        fs.mkdirSync(langEn, { recursive: true });
        fs.writeFileSync(
          path.join(langEn, 'messages.php'),
          `<?php return ['greeting' => 'Hello'];`,
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          if (arr.includes('lang/en/*.php')) return ['lang/en/messages.php'];
          return [];
        });

        const result = await detectI18nFiles(testDir);
        expect(result.find((p) => p.format === 'laravel_php')).toBeDefined();
      });
    });

    describe('JSON nested-over-flat precedence', () => {
      it('prefers dir-per-locale when both layouts coexist', async () => {
        const flatDir = path.join(testDir, 'locales');
        fs.mkdirSync(flatDir, { recursive: true });
        fs.writeFileSync(path.join(flatDir, 'en.json'), JSON.stringify({ legacy: 'Legacy' }));
        const nestedDir = path.join(flatDir, 'en');
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(path.join(nestedDir, 'common.json'), JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye' }));

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          if (arr.includes('locales/en/*.json')) return ['locales/en/common.json'];
          if (arr.includes('locales/en.json')) return ['locales/en.json'];
          return [];
        });

        const result = await detectI18nFiles(testDir);
        const jsonProjects = result.filter((p) => p.format === 'json');
        expect(jsonProjects.length).toBe(2);
        // The init wizard reads `detected[0]` — dir-per-locale must come first.
        expect(result[0]!.format).toBe('json');
        expect(result[0]!.pattern).toBe('locales/en/*.json');
      });

      it('falls back to flat when only flat is present', async () => {
        const flatDir = path.join(testDir, 'locales');
        fs.mkdirSync(flatDir, { recursive: true });
        fs.writeFileSync(path.join(flatDir, 'en.json'), JSON.stringify({ greeting: 'Hello' }));

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          if (arr.includes('locales/en.json')) return ['locales/en.json'];
          return [];
        });

        const result = await detectI18nFiles(testDir);
        const json = result.find((p) => p.format === 'json');
        expect(json).toBeDefined();
        expect(json!.pattern).toBe('locales/en.json');
      });
    });

    describe('Symfony XLIFF auto-detect', () => {
      it('detects translations/messages.en.xlf as xliff with Symfony target template', async () => {
        const translationsDir = path.join(testDir, 'translations');
        fs.mkdirSync(translationsDir, { recursive: true });
        fs.writeFileSync(
          path.join(translationsDir, 'messages.en.xlf'),
          '<?xml version="1.0"?><xliff version="1.2"><file source-language="en"><body></body></file></xliff>',
        );

        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          if (arr.includes('translations/messages.en.xlf')) return ['translations/messages.en.xlf'];
          return [];
        });

        const result = await detectI18nFiles(testDir);
        const symfony = result.find(
          (p) => p.format === 'xliff' && p.pattern === 'translations/messages.en.xlf',
        );
        expect(symfony).toBeDefined();
        expect(symfony!.targetPathPattern).toBe('translations/messages.{locale}.xlf');
      });
    });

    // detectI18nFiles counts keys through the FormatRegistry rather than
    // inline JSON/YAML parsers, so the "init" wizard shows an accurate key
    // tally for all supported formats.
    describe('keyCount for all supported formats', () => {
      it('counts keys in Android XML strings.xml', async () => {
        const resDir = path.join(testDir, 'res', 'values');
        fs.mkdirSync(resDir, { recursive: true });
        fs.writeFileSync(
          path.join(resDir, 'strings.xml'),
          '<resources>' +
            '<string name="app_name">App</string>' +
            '<string name="hello">Hello</string>' +
            '<string name="bye">Bye</string>' +
            '</resources>',
        );
        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('res/values/strings.xml') ? ['res/values/strings.xml'] : [];
        });

        const result = await detectI18nFiles(testDir);
        const android = result.find((p) => p.format === 'android_xml');
        expect(android?.keyCount).toBe(3);
      });

      it('counts keys in iOS Localizable.strings', async () => {
        const iosDir = path.join(testDir, 'en.lproj');
        fs.mkdirSync(iosDir, { recursive: true });
        fs.writeFileSync(
          path.join(iosDir, 'Localizable.strings'),
          '"greeting" = "Hello";\n"farewell" = "Bye";\n',
        );
        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('*.lproj/Localizable.strings')
            ? ['en.lproj/Localizable.strings']
            : [];
        });

        const result = await detectI18nFiles(testDir);
        const ios = result.find((p) => p.format === 'ios_strings');
        expect(ios?.keyCount).toBe(2);
      });

      it('counts keys in ARB', async () => {
        // pubspec.yaml is required by the ARB detector (Flutter-exclusive
        // format gate).
        fs.writeFileSync(path.join(testDir, 'pubspec.yaml'), 'name: app\n');
        const l10nDir = path.join(testDir, 'l10n');
        fs.mkdirSync(l10nDir, { recursive: true });
        fs.writeFileSync(
          path.join(l10nDir, 'app_en.arb'),
          JSON.stringify({
            '@@locale': 'en',
            hello: 'Hello',
            bye: 'Bye',
            thanks: 'Thanks',
          }),
        );
        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('l10n/app_en.arb') ? ['l10n/app_en.arb'] : [];
        });

        const result = await detectI18nFiles(testDir);
        const arb = result.find((p) => p.format === 'arb');
        expect(arb?.keyCount).toBe(3);
      });

      it('does NOT detect ARB when pubspec.yaml is absent (Flutter-gate)', async () => {
        // ARB files without a pubspec.yaml are almost certainly not a
        // Flutter project; the tightened detector skips them.
        const l10nDir = path.join(testDir, 'l10n');
        fs.mkdirSync(l10nDir, { recursive: true });
        fs.writeFileSync(
          path.join(l10nDir, 'app_en.arb'),
          JSON.stringify({ hello: 'Hello' }),
        );

        // Even if fg WOULD match, the requires-gate should skip the glob.
        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('l10n/app_en.arb') ? ['l10n/app_en.arb'] : [];
        });

        const result = await detectI18nFiles(testDir);
        expect(result.find((p) => p.format === 'arb')).toBeUndefined();
      });

      it('counts keys in PO', async () => {
        const poDir = path.join(testDir, 'locale', 'en', 'LC_MESSAGES');
        fs.mkdirSync(poDir, { recursive: true });
        fs.writeFileSync(
          path.join(poDir, 'messages.po'),
          'msgid ""\nmsgstr ""\n\n' +
            'msgid "hello"\nmsgstr "Hello"\n\n' +
            'msgid "bye"\nmsgstr "Bye"\n',
        );
        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('locale/en/LC_MESSAGES/*.po')
            ? ['locale/en/LC_MESSAGES/messages.po']
            : [];
        });

        const result = await detectI18nFiles(testDir);
        const po = result.find((p) => p.format === 'po');
        // PO parser counts header metadata as its own entry, so 2 msgid keys
        // surface as 3 extracted entries.
        expect(po?.keyCount).toBeGreaterThan(0);
        expect(po?.keyCount).toBe(3);
      });

      it('counts keys in XLIFF', async () => {
        const localeDir = path.join(testDir, 'src', 'locale');
        fs.mkdirSync(localeDir, { recursive: true });
        fs.writeFileSync(
          path.join(localeDir, 'messages.xlf'),
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<xliff version="1.2">\n' +
            '  <file source-language="en" datatype="plaintext" original="src">\n' +
            '    <body>\n' +
            '      <trans-unit id="hello"><source>Hello</source></trans-unit>\n' +
            '      <trans-unit id="bye"><source>Bye</source></trans-unit>\n' +
            '    </body>\n' +
            '  </file>\n' +
            '</xliff>',
        );
        mockFg.mockImplementation(async (patterns) => {
          const arr = Array.isArray(patterns) ? patterns : [patterns];
          return arr.includes('src/locale/messages.xlf') ? ['src/locale/messages.xlf'] : [];
        });

        const result = await detectI18nFiles(testDir);
        const xliff = result.find((p) => p.format === 'xliff');
        expect(xliff?.keyCount).toBe(2);
      });
    });
  });

  describe('generateSyncConfig', () => {
    it('should produce valid YAML with correct structure', () => {
      const content = generateSyncConfig({
        sourceLocale: 'en',
        targetLocales: ['de', 'fr'],
        format: 'json',
        pattern: 'locales/en.json',
      });

      const parsed = YAML.parse(content) as {
        version: number;
        source_locale: string;
        target_locales: string[];
        buckets: Record<string, { include: string[]; target_path_pattern?: string }>;
      };

      expect(parsed.version).toBe(1);
      expect(parsed.source_locale).toBe('en');
      expect(parsed.target_locales).toEqual(['de', 'fr']);
      expect(Object.keys(parsed.buckets)).toHaveLength(1);
      expect(parsed.buckets['json']).toBeDefined();
      expect(parsed.buckets['json']!.include).toContain('locales/en.json');
      expect(parsed.buckets['json']!.target_path_pattern).toBeUndefined();
    });

    it('should include target_path_pattern when provided', () => {
      const content = generateSyncConfig({
        sourceLocale: 'en',
        targetLocales: ['de'],
        format: 'android_xml',
        pattern: 'res/values/strings.xml',
        targetPathPattern: 'res/values-{locale}/strings.xml',
      });

      const parsed = YAML.parse(content) as {
        buckets: Record<string, { include: string[]; target_path_pattern?: string }>;
      };

      expect(parsed.buckets['android_xml']).toBeDefined();
      expect(parsed.buckets['android_xml']!.include).toContain('res/values/strings.xml');
      expect(parsed.buckets['android_xml']!.target_path_pattern).toBe('res/values-{locale}/strings.xml');
    });

    it('should write concrete include pattern for yaml format', () => {
      const content = generateSyncConfig({
        sourceLocale: 'en',
        targetLocales: ['es'],
        format: 'yaml',
        pattern: 'i18n/en.yaml',
      });

      const parsed = YAML.parse(content) as {
        buckets: Record<string, { include: string[] }>;
      };

      expect(parsed.buckets['yaml']).toBeDefined();
      expect(parsed.buckets['yaml']!.include).toContain('i18n/en.yaml');
    });
  });

  describe('configExists', () => {
    it('should return true when config file exists', () => {
      fs.writeFileSync(path.join(testDir, '.deepl-sync.yaml'), 'version: 1\n');

      expect(configExists(path.join(testDir, '.deepl-sync.yaml'))).toBe(true);
    });

    it('should return false when config file does not exist', () => {
      expect(configExists(path.join(testDir, '.deepl-sync.yaml'))).toBe(false);
    });
  });

  describe('resolveInitConfigPath', () => {
    it('should default to .deepl-sync.yaml in the cwd', () => {
      expect(resolveInitConfigPath(testDir)).toBe(path.join(testDir, '.deepl-sync.yaml'));
    });

    it('should honor an explicit path with a custom basename', () => {
      expect(resolveInitConfigPath(testDir, 'nested/custom.yaml')).toBe(
        path.join(testDir, 'nested', 'custom.yaml'),
      );
    });

    it('should leave an absolute explicit path untouched', () => {
      const abs = path.join(testDir, 'abs', 'custom.yaml');
      expect(resolveInitConfigPath(testDir, abs)).toBe(abs);
    });
  });

  describe('writeSyncConfig', () => {
    it('should write config file and return path', async () => {
      const content = 'version: 1\nsource_locale: en\n';
      const configPath = await writeSyncConfig(
        path.join(testDir, '.deepl-sync.yaml'),
        content,
      );

      expect(configPath).toBe(path.join(testDir, '.deepl-sync.yaml'));
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(content);
    });

    it('should leave no temp sibling behind and keep the previous config on write failure', async () => {
      const configPath = path.join(testDir, '.deepl-sync.yaml');
      fs.writeFileSync(configPath, 'version: 1\nsource_locale: en\n', 'utf-8');

      const renameSpy = jest
        .spyOn(fs.promises, 'rename')
        .mockRejectedValue(new Error('rename failed'));
      try {
        await expect(
          writeSyncConfig(configPath, 'version: 1\nsource_locale: de\n'),
        ).rejects.toThrow('rename failed');
      } finally {
        renameSpy.mockRestore();
      }

      expect(fs.readFileSync(configPath, 'utf-8')).toBe('version: 1\nsource_locale: en\n');
      expect(fs.readdirSync(testDir).filter(name => name.includes('.tmp.'))).toEqual([]);
    });

    it('should create missing parent directories', async () => {
      const target = path.join(testDir, 'deep', 'nested', 'custom.yaml');
      const configPath = await writeSyncConfig(target, 'version: 1\n');

      expect(configPath).toBe(target);
      expect(fs.existsSync(target)).toBe(true);
    });
  });

  describe('non-interactive generation', () => {
    it('should generate config from explicit options', () => {
      const content = generateSyncConfig({
        sourceLocale: 'en',
        targetLocales: ['de', 'fr', 'ja'],
        format: 'json',
        pattern: 'locales/en.json',
      });

      const parsed = YAML.parse(content) as {
        version: number;
        source_locale: string;
        target_locales: string[];
        buckets: Array<{ format: string }>;
      };

      expect(parsed.version).toBe(1);
      expect(parsed.source_locale).toBe('en');
      expect(parsed.target_locales).toEqual(['de', 'fr', 'ja']);
      expect((parsed.buckets as unknown as Record<string, unknown>)['json']).toBeDefined();
    });
  });
});

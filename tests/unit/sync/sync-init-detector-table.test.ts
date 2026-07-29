const micromatch = require('micromatch') as {
  isMatch: (paths: string | string[], patterns: string | string[]) => boolean;
};
import {
  DETECTION_PATTERNS,
  type DetectionPattern,
} from '../../../src/sync/sync-init';
import { resolveTargetPath } from '../../../src/sync/sync-utils';

/**
 * Table-driven detector harness.
 *
 * Each row pairs a DETECTION_PATTERNS entry with a realistic source-file
 * layout and asserts that:
 *   1. At least one glob in the entry matches the source file path.
 *   2. The entry's patternTemplate (resolved against {dir}/{locale}) produces
 *      a bucket pattern that itself matches the source file path — so sync
 *      at runtime won't point at a nonexistent file (e.g. a flat-layout
 *      fallback fabricating `locales/en/en.json`).
 *   3. `resolveTargetPath` produces a working target path for 2+ target
 *      locales. For `targetPathPattern` entries the template is consumed
 *      directly; for locale-in-path entries the regex substitution handles it.
 *
 * Negative rows carry one-line "why" comments explaining the auto-detect
 * drift they guard against.
 */

const TARGET_LOCALES = ['de', 'fr'] as const;

function findEntry(
  predicate: (p: DetectionPattern) => boolean,
): DetectionPattern {
  const entry = DETECTION_PATTERNS.find(predicate);
  if (!entry) throw new Error('No DETECTION_PATTERNS entry matched predicate');
  return entry;
}

function resolveBucketPattern(
  entry: DetectionPattern,
  sourceFile: string,
): { pattern: string; targetPathPattern?: string } {
  const dir = sourceFile.includes('/')
    ? sourceFile.substring(0, sourceFile.lastIndexOf('/'))
    : '.';
  const resolvedTemplate = entry.patternTemplate.replace('{dir}', dir);
  if (entry.multiLocale) {
    return { pattern: sourceFile };
  }
  if (entry.localeInPath) {
    return { pattern: resolvedTemplate.replace('{locale}', entry.sourceLocale) };
  }
  return { pattern: sourceFile, targetPathPattern: resolvedTemplate };
}

describe('DETECTION_PATTERNS table-driven harness', () => {
  describe('JSON', () => {
    it('flat layout: locales/en.json → bucket pattern matches source and target', () => {
      const entry = findEntry(
        (p) => p.format === 'json' && p.globs.includes('locales/en.json'),
      );
      const source = 'locales/en.json';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('locales/en.json');
      expect(micromatch.isMatch(source, pattern)).toBe(true);
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`locales/${target}.json`);
      }
    });

    it('i18n/en.json flat variant', () => {
      const entry = findEntry(
        (p) => p.format === 'json' && p.globs.includes('i18n/en.json'),
      );
      const source = 'i18n/en.json';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('i18n/en.json');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`i18n/${target}.json`);
      }
    });

    it('dir-per-locale layout: locales/en/*.json → glob bucket pattern', () => {
      const entry = findEntry(
        (p) => p.format === 'json' && p.globs.includes('locales/en/*.json'),
      );
      const source = 'locales/en/common.json';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      // Critical assertion: the bucket pattern must be a glob that matches
      // every namespaced JSON file, NOT a single fabricated
      // `locales/en/en.json` path that doesn't exist on disk.
      expect(pattern).toBe('locales/en/*.json');
      expect(micromatch.isMatch(source, pattern)).toBe(true);
      expect(micromatch.isMatch('locales/en/errors.json', pattern)).toBe(true);
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `locales/${target}/common.json`,
        );
      }
    });

    // Negative: bare-root en.json is not an i18next signal — i18next docs and
    // every shipped default config scope under `locales/` or `i18n/`. A
    // root-level `en.json` is almost always npm package metadata or config
    // data, not translations.
    it('does NOT match bare-root en.json', () => {
      const jsonEntries = DETECTION_PATTERNS.filter((p) => p.format === 'json');
      for (const entry of jsonEntries) {
        expect(micromatch.isMatch('en.json', entry.globs)).toBe(false);
      }
    });
  });

  describe('YAML .yaml extension', () => {
    it('locales/en.yaml → .yaml bucket pattern preserves extension', () => {
      const entry = findEntry(
        (p) => p.format === 'yaml' && p.globs.includes('locales/en.yaml'),
      );
      const source = 'locales/en.yaml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('locales/en.yaml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`locales/${target}.yaml`);
      }
    });

    it('Rails namespaced layout: config/locales/admin/en.yaml', () => {
      const entry = findEntry(
        (p) => p.format === 'yaml' && p.globs.includes('config/locales/**/en.yaml'),
      );
      const source = 'config/locales/admin/en.yaml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('config/locales/admin/en.yaml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `config/locales/admin/${target}.yaml`,
        );
      }
    });
  });

  describe('YAML .yml extension', () => {
    it('locales/en.yml → .yml bucket pattern preserves extension', () => {
      const entry = findEntry(
        (p) => p.format === 'yaml' && p.globs.includes('locales/en.yml'),
      );
      const source = 'locales/en.yml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('locales/en.yml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`locales/${target}.yml`);
      }
    });

    it('Rails canonical layout: config/locales/en.yml', () => {
      const entry = findEntry(
        (p) => p.format === 'yaml' && p.globs.includes('config/locales/en.yml'),
      );
      const source = 'config/locales/en.yml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('config/locales/en.yml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`config/locales/${target}.yml`);
      }
    });

    it('Rails namespaced layout: config/locales/admin/en.yml', () => {
      const entry = findEntry(
        (p) => p.format === 'yaml' && p.globs.includes('config/locales/**/en.yml'),
      );
      const source = 'config/locales/admin/en.yml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('config/locales/admin/en.yml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `config/locales/admin/${target}.yml`,
        );
      }
    });

    // Negative: `config/locales/de.yml` must NOT create a second Rails bucket —
    // it's a target-locale file, not a source. Only the source-locale glob
    // (`en.yml`) should trigger detection; target-locale files are discovered
    // at sync time via resolveTargetPath, not via a separate detection row.
    it('does NOT match config/locales/de.yml (target-locale file)', () => {
      const yamlEntries = DETECTION_PATTERNS.filter((p) => p.format === 'yaml');
      for (const entry of yamlEntries) {
        expect(micromatch.isMatch('config/locales/de.yml', entry.globs)).toBe(false);
      }
    });
  });

  describe('PO (gettext)', () => {
    it('Django/gettext layout: locale/en/LC_MESSAGES/messages.po', () => {
      const entry = findEntry((p) => p.format === 'po');
      const source = 'locale/en/LC_MESSAGES/messages.po';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('locale/en/LC_MESSAGES/*.po');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `locale/${target}/LC_MESSAGES/messages.po`,
        );
      }
    });
  });

  describe('Android XML', () => {
    it('canonical res/values/strings.xml + target_path_pattern', () => {
      const entry = findEntry((p) => p.format === 'android_xml');
      const source = 'res/values/strings.xml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern, targetPathPattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('res/values/strings.xml');
      expect(targetPathPattern).toBe('res/values-{locale}/strings.xml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target, targetPathPattern)).toBe(
          `res/values-${target}/strings.xml`,
        );
      }
    });
  });

  describe('iOS strings (.lproj only)', () => {
    it('en.lproj/Localizable.strings', () => {
      const entry = findEntry((p) => p.format === 'ios_strings');
      const source = 'en.lproj/Localizable.strings';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('en.lproj/Localizable.strings');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `${target}.lproj/Localizable.strings`,
        );
      }
    });

    // Negative: bare-root `*.strings` is intentionally not detected — Apple's
    // bundle model mandates `.lproj`, and a root-level `.strings` is almost
    // always intermediate build output. Layouts outside .lproj fall through
    // to the four-flag non-interactive init path.
    it('does NOT match bare-root Localizable.strings', () => {
      const entry = findEntry((p) => p.format === 'ios_strings');
      expect(micromatch.isMatch('Localizable.strings', entry.globs)).toBe(false);
      expect(micromatch.isMatch('build/Localizable.strings', entry.globs)).toBe(false);
    });
  });

  describe('ARB (Flutter)', () => {
    it('l10n/app_en.arb + generated target paths', () => {
      const entry = findEntry((p) => p.format === 'arb');
      const source = 'l10n/app_en.arb';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('l10n/app_en.arb');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`l10n/app_${target}.arb`);
      }
    });

    it('has pubspec.yaml marker', () => {
      const entry = findEntry((p) => p.format === 'arb');
      expect(entry.requires).toContain('pubspec.yaml');
    });
  });

  describe('XLIFF (canonical src/locale + Symfony translations)', () => {
    it('Angular canonical src/locale/messages.xlf', () => {
      const entry = findEntry(
        (p) => p.format === 'xliff' && p.globs.includes('src/locale/messages.xlf'),
      );
      const source = 'src/locale/messages.xlf';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern, targetPathPattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('src/locale/messages.xlf');
      expect(targetPathPattern).toBe('src/locale/messages.{locale}.xlf');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target, targetPathPattern)).toBe(
          `src/locale/messages.${target}.xlf`,
        );
      }
    });

    it('Symfony translations/messages.en.xlf', () => {
      const entry = findEntry(
        (p) => p.format === 'xliff' && p.globs.includes('translations/messages.en.xlf'),
      );
      const source = 'translations/messages.en.xlf';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern, targetPathPattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('translations/messages.en.xlf');
      expect(targetPathPattern).toBe('translations/messages.{locale}.xlf');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target, targetPathPattern)).toBe(
          `translations/messages.${target}.xlf`,
        );
      }
    });

    // Negative: bare-root `*.xlf` / `*.xliff` match no XLIFF entry — CAT-tool
    // dumps (Trados/memoQ/Xcode `.xcloc` extracts) are false-positive magnets.
    it('does NOT match bare-root *.xlf or *.xliff (any XLIFF entry)', () => {
      const xliffEntries = DETECTION_PATTERNS.filter((p) => p.format === 'xliff');
      for (const entry of xliffEntries) {
        expect(micromatch.isMatch('messages.xlf', entry.globs)).toBe(false);
        expect(micromatch.isMatch('export.xliff', entry.globs)).toBe(false);
        expect(micromatch.isMatch('trados-export/file.xlf', entry.globs)).toBe(false);
      }
    });
  });

  describe('Laravel PHP arrays', () => {
    it('Laravel 9+ lang/en/*.php', () => {
      const entry = findEntry((p) => p.format === 'laravel_php');
      const source = 'lang/en/messages.php';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('lang/en/*.php');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `lang/${target}/messages.php`,
        );
      }
    });

    it('Laravel ≤8 resources/lang/en/*.php', () => {
      const entry = findEntry((p) => p.format === 'laravel_php');
      const source = 'resources/lang/en/messages.php';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `resources/lang/${target}/messages.php`,
        );
      }
    });

    it('has composer.json marker', () => {
      const entry = findEntry((p) => p.format === 'laravel_php');
      expect(entry.requires).toContain('composer.json');
    });
  });

  describe('Xcode String Catalog', () => {
    it('root-level Localizable.xcstrings (multiLocale)', () => {
      const entry = findEntry((p) => p.format === 'xcstrings');
      const source = 'Localizable.xcstrings';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern, targetPathPattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('Localizable.xcstrings');
      expect(targetPathPattern).toBeUndefined();
      expect(entry.multiLocale).toBe(true);
    });

    it('Resources/Localizable.xcstrings', () => {
      const entry = findEntry((p) => p.format === 'xcstrings');
      const source = 'Resources/Localizable.xcstrings';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
    });
  });

  describe('go-i18n TOML', () => {
    it('locales/en.toml directory layout', () => {
      const entry = findEntry(
        (p) => p.format === 'toml' && p.globs.includes('locales/en.toml'),
      );
      const source = 'locales/en.toml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('locales/en.toml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`locales/${target}.toml`);
      }
    });

    it('active.en.toml root-level layout', () => {
      const entry = findEntry(
        (p) => p.format === 'toml' && p.globs.includes('active.en.toml'),
      );
      const source = 'active.en.toml';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('active.en.toml');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(`active.${target}.toml`);
      }
    });

    // Negative: `active.fr.toml` must NOT match the go-i18n active.en.toml
    // glob — detection is source-locale-anchored. Target-locale files are
    // derived from the template at sync time, not re-detected.
    it('does NOT match active.fr.toml when active.en.toml is the source signal', () => {
      const entry = findEntry(
        (p) => p.format === 'toml' && p.globs.includes('active.en.toml'),
      );
      expect(micromatch.isMatch('active.fr.toml', entry.globs)).toBe(false);
    });
  });

  describe('Java / Spring properties', () => {
    it('canonical src/main/resources/messages_en.properties', () => {
      const entry = findEntry((p) => p.format === 'properties');
      const source = 'src/main/resources/messages_en.properties';
      expect(micromatch.isMatch(source, entry.globs)).toBe(true);
      const { pattern } = resolveBucketPattern(entry, source);
      expect(pattern).toBe('src/main/resources/messages_en.properties');
      for (const target of TARGET_LOCALES) {
        expect(resolveTargetPath(source, 'en', target)).toBe(
          `src/main/resources/messages_${target}.properties`,
        );
      }
    });
  });

  describe('template-to-glob consistency', () => {
    // For every entry with localeInPath=true, the resolved bucket pattern
    // for the source locale must itself match the source file under the
    // entry's globs. This catches the class of bug where a
    // `{dir}/{locale}.json` template applied to a `locales/en/` dir produces
    // `locales/en/en.json`, which no bucket glob in the entry matches.
    const cases: Array<{ desc: string; format: string; source: string }> = [
      { desc: 'JSON flat', format: 'json', source: 'locales/en.json' },
      { desc: 'JSON dir-per-locale', format: 'json', source: 'locales/en/common.json' },
      { desc: 'YAML .yaml', format: 'yaml', source: 'locales/en.yaml' },
      { desc: 'YAML .yml', format: 'yaml', source: 'locales/en.yml' },
      { desc: 'Rails namespaced yml', format: 'yaml', source: 'config/locales/admin/en.yml' },
      { desc: 'PO', format: 'po', source: 'locale/en/LC_MESSAGES/messages.po' },
      { desc: 'iOS', format: 'ios_strings', source: 'en.lproj/Localizable.strings' },
      { desc: 'ARB', format: 'arb', source: 'l10n/app_en.arb' },
      { desc: 'Laravel', format: 'laravel_php', source: 'lang/en/messages.php' },
      { desc: 'go-i18n dir', format: 'toml', source: 'locales/en.toml' },
      { desc: 'go-i18n active.en.toml', format: 'toml', source: 'active.en.toml' },
      { desc: 'Spring', format: 'properties', source: 'src/main/resources/messages_en.properties' },
    ];

    it.each(cases)('$desc: resolved bucket pattern matches source under entry globs', ({ format, source }) => {
      const entry = DETECTION_PATTERNS.find(
        (p) => p.format === format && !p.multiLocale && micromatch.isMatch(source, p.globs),
      );
      expect(entry).toBeDefined();
      if (!entry) return;
      const { pattern } = resolveBucketPattern(entry, source);
      expect(micromatch.isMatch(source, pattern)).toBe(true);
    });
  });
});

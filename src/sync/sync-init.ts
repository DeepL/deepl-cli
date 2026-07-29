import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import fg from 'fast-glob';
import { SYNC_CONFIG_FILENAME } from './sync-config.js';
import { safeReadFileSync } from '../utils/safe-read-file.js';
import { atomicWriteFile } from '../utils/atomic-write.js';
import { createDefaultRegistry, type FormatRegistry } from '../formats/index.js';

export interface DetectedProject {
  format: string;
  sourceLocale: string;
  pattern: string;
  targetPathPattern?: string;
  keyCount: number;
}

export interface InitOptions {
  sourceLang?: string;
  targetLangs?: string;
  format?: string;
  filePath?: string;
  cwd?: string;
}

export interface DetectionPattern {
  globs: string[];
  /**
   * Optional filesystem-only markers that must all exist at the repo root
   * before the globs are evaluated. Used for ecosystems where the glob alone
   * is ambiguous (e.g., the `.php` files in `lang/` are a Laravel signal
   * only when `composer.json` is also present). Kept as plain existence
   * checks — never parsed — to match the rest of the filesystem-only
   * detector family (Rails, Django, Flutter, Angular) and avoid scope-creep
   * into dep-tree walking.
   */
  requires?: string[];
  format: string;
  sourceLocale: string;
  patternTemplate: string;
  localeInPath: boolean;
  /**
   * True for formats that store all locales in a single file (e.g.
   * `.xcstrings`). When set, the detected pattern is the source-of-truth
   * file path itself (no `target_path_pattern`) — the parser writes every
   * locale back into the same file. `localeInPath` is ignored when this
   * is true.
   */
  multiLocale?: boolean;
}

export const DETECTION_PATTERNS: DetectionPattern[] = [
  // JSON dir-per-locale layout (namespaced i18next, e.g. `locales/en/common.json`).
  // The template is a glob — not a single file path — because the locale directory
  // holds multiple namespaced files. `{locale}` substitutes the locale directory;
  // the basename is left as `*.json` to match every namespaced file.
  //
  // Ordered BEFORE the flat layout so that repos containing BOTH `locales/en.json`
  // (legacy/sample) AND `locales/en/*.json` (real source) pick dir-per-locale via
  // `detected[0]` in the init wizard. i18next, react-i18next, and next-i18next
  // default to the nested form; flat is usually a demo artifact.
  {
    globs: ['locales/en/*.json'],
    format: 'json',
    sourceLocale: 'en',
    patternTemplate: 'locales/{locale}/*.json',
    localeInPath: true,
  },
  // JSON flat layout — one file per locale at `locales/en.json` or `i18n/en.json`.
  // Split from the dir-per-locale layout above so the generated bucket pattern
  // doesn't fabricate a nonexistent `locales/en/en.json` path.
  {
    globs: ['locales/en.json', 'i18n/en.json'],
    format: 'json',
    sourceLocale: 'en',
    patternTemplate: '{dir}/{locale}.json',
    localeInPath: true,
  },
  // YAML is split by extension so the generated `include:` pattern keeps the
  // original suffix. A single-entry template with `.yaml` hardcoded would
  // emit `locales/en.yaml` even when the actual file is `locales/en.yml`,
  // breaking bucket matching at sync time.
  {
    globs: [
      'locales/en.yaml',
      'i18n/en.yaml',
      'config/locales/en.yaml',
      // Rails namespaced layout: engines and concerns split their translations
      // across `config/locales/<namespace>/en.yaml`. `**` matches zero or more
      // segments so the root canonical file is still covered.
      'config/locales/**/en.yaml',
    ],
    format: 'yaml',
    sourceLocale: 'en',
    patternTemplate: '{dir}/{locale}.yaml',
    localeInPath: true,
  },
  {
    globs: [
      'locales/en.yml',
      'i18n/en.yml',
      // Rails canonical layout. The auto regex substitution in
      // resolveTargetPath rewrites `config/locales/en.yml` → `config/locales/de.yml`.
      'config/locales/en.yml',
      // Rails namespaced layout (see the .yaml variant above).
      'config/locales/**/en.yml',
    ],
    format: 'yaml',
    sourceLocale: 'en',
    patternTemplate: '{dir}/{locale}.yml',
    localeInPath: true,
  },
  {
    globs: ['locale/en/LC_MESSAGES/*.po', '*.po'],
    format: 'po',
    sourceLocale: 'en',
    patternTemplate: 'locale/{locale}/LC_MESSAGES/*.po',
    localeInPath: true,
  },
  {
    globs: ['res/values/strings.xml'],
    format: 'android_xml',
    sourceLocale: 'en',
    patternTemplate: 'res/values-{locale}/strings.xml',
    localeInPath: false,
  },
  // iOS/macOS: the bare-root `*.strings` fallback is intentionally omitted.
  // Apple's bundle model mandates `.lproj` directories, and a root-level
  // `*.strings` is almost always intermediate build output or misconfiguration.
  // Projects with that layout fall through to the four-flag non-interactive
  // init path rather than getting a broken auto-detect.
  {
    globs: ['*.lproj/Localizable.strings'],
    format: 'ios_strings',
    sourceLocale: 'en',
    patternTemplate: '{locale}.lproj/Localizable.strings',
    localeInPath: true,
  },
  // ARB: Google invented ARB for Flutter and non-Flutter use is effectively nil.
  // Requiring `pubspec.yaml` tightens the broad `*_en.arb` fallback glob without
  // regressing any realistic workflow.
  {
    globs: ['l10n/app_en.arb', '*_en.arb'],
    requires: ['pubspec.yaml'],
    format: 'arb',
    sourceLocale: 'en',
    patternTemplate: 'l10n/app_{locale}.arb',
    localeInPath: true,
  },
  // XLIFF: bare-root `*.xlf` / `*.xliff` fallbacks are intentionally omitted —
  // root-level XLIFF is CAT-tool dump territory (Trados/memoQ/Xcode `.xcloc`
  // extracts) and a false-positive magnet. Canonical Angular layouts stay.
  {
    globs: ['src/locale/messages.xlf', 'src/locale/*.xlf', 'src/locale/*.xliff'],
    format: 'xliff',
    sourceLocale: 'en',
    patternTemplate: 'src/locale/messages.{locale}.xlf',
    localeInPath: false,
  },
  // Symfony XLIFF: `translations/messages.en.xlf` is the canonical layout for
  // Symfony's translation bundle. Distinct from Angular's `src/locale/`
  // convention.
  {
    globs: ['translations/messages.en.xlf'],
    format: 'xliff',
    sourceLocale: 'en',
    patternTemplate: 'translations/messages.{locale}.xlf',
    localeInPath: false,
  },
  // Laravel PHP arrays. Requires composer.json at root AND one of the canonical
  // lang directories — Laravel 9+ uses lang/{locale}/*.php, Laravel ≤8 and
  // Lumen use resources/lang/{locale}/*.php. `composer.json` is a plain
  // existence check (not parsed): Lumen, Laravel Zero, and legacy forks all
  // ship the same directory layout but vary the package name, so filesystem
  // evidence is more reliable than a package lookup. The auto regex
  // substitution in resolveTargetPath handles `lang/en/...` → `lang/de/...`
  // without a target_path_pattern.
  {
    globs: ['lang/en/*.php', 'resources/lang/en/*.php'],
    requires: ['composer.json'],
    format: 'laravel_php',
    sourceLocale: 'en',
    patternTemplate: '{dir}/*.php',
    localeInPath: true,
  },
  // Xcode String Catalog — multi-locale (all locales in one file). The same
  // file is the target for every locale; no target_path_pattern needed.
  {
    globs: ['Localizable.xcstrings', 'Resources/Localizable.xcstrings', '*.xcstrings'],
    format: 'xcstrings',
    sourceLocale: 'en',
    patternTemplate: '',
    localeInPath: false,
    multiLocale: true,
  },
  // go-i18n TOML. Common layouts are `locales/en.toml` or `i18n/en.toml`.
  {
    globs: ['locales/en.toml', 'i18n/en.toml'],
    format: 'toml',
    sourceLocale: 'en',
    patternTemplate: '{dir}/{locale}.toml',
    localeInPath: true,
  },
  // go-i18n root-level `active.{locale}.toml`. The filename itself encodes the
  // locale; template is hardcoded rather than `{dir}`-derived because the
  // basename pattern is specific to this layout.
  {
    globs: ['active.en.toml'],
    format: 'toml',
    sourceLocale: 'en',
    patternTemplate: 'active.{locale}.toml',
    localeInPath: true,
  },
  // Java / Spring properties. Canonical Maven/Gradle layout is
  // `src/main/resources/messages_en.properties`; the filename suffix encodes
  // the locale so resolveTargetPath rewrites `messages_en` → `messages_de`.
  {
    globs: ['src/main/resources/messages_en.properties'],
    format: 'properties',
    sourceLocale: 'en',
    patternTemplate: '{dir}/messages_{locale}.properties',
    localeInPath: true,
  },
];

const PACKAGE_JSON_HINTS: Record<string, string> = {
  'i18next': 'json',
  'react-intl': 'json',
  'react-i18next': 'json',
  'next-intl': 'json',
  'vue-i18n': 'json',
  'ngx-translate': 'json',
  '@angular/localize': 'xliff',
  'gettext-parser': 'po',
  'flutter_localizations': 'arb',
};

export function detectFromPackageJson(rootDir: string): string | undefined {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    // SECURITY: reject symlinks. A hostile repo's package.json -> arbitrary
    // file would be JSON-parsed and the CLI would act on whatever dependency
    // hints it found there.
    const content = safeReadFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dep, format] of Object.entries(PACKAGE_JSON_HINTS)) {
      if (dep in allDeps) return format;
    }
  } catch { /* no package.json or parse error */ }
  return undefined;
}

export async function detectI18nFiles(rootDir: string): Promise<DetectedProject[]> {
  const detected: DetectedProject[] = [];
  let registry: FormatRegistry | undefined;

  for (const pattern of DETECTION_PATTERNS) {
    if (pattern.requires) {
      const allMarkersPresent = pattern.requires.every((marker) =>
        fs.existsSync(path.join(rootDir, marker)),
      );
      if (!allMarkersPresent) continue;
    }
    const matches = await fg(pattern.globs, {
      cwd: rootDir,
      absolute: false,
    });

    if (matches.length > 0) {
      const firstMatch = matches[0]!;
      let keyCount = 0;

      try {
        const fullPath = path.join(rootDir, firstMatch);
        // SECURITY: reject symlinks. The first-match read is best-effort key
        // counting; a symlink target would give misleading counts and could
        // expose unrelated file content in extractor error messages.
        const content = safeReadFileSync(fullPath, 'utf-8');
        registry ??= await createDefaultRegistry();
        const parser = registry.getParser(path.extname(firstMatch));
        if (parser) {
          keyCount = parser.extract(content).length;
        }
      } catch {
        // Count remains 0 on parse failure or symlink rejection.
      }

      const dir = path.dirname(firstMatch);
      const resolvedTemplate = pattern.patternTemplate.replace('{dir}', dir);

      if (pattern.multiLocale) {
        // Same file holds every locale; no target_path_pattern to emit.
        detected.push({
          format: pattern.format,
          sourceLocale: pattern.sourceLocale,
          pattern: firstMatch,
          keyCount,
        });
      } else if (pattern.localeInPath) {
        detected.push({
          format: pattern.format,
          sourceLocale: pattern.sourceLocale,
          pattern: resolvedTemplate.replace('{locale}', pattern.sourceLocale),
          keyCount,
        });
      } else {
        detected.push({
          format: pattern.format,
          sourceLocale: pattern.sourceLocale,
          pattern: firstMatch,
          targetPathPattern: resolvedTemplate,
          keyCount,
        });
      }
    }
  }

  return detected;
}

export function generateSyncConfig(opts: {
  sourceLocale: string;
  targetLocales: string[];
  format: string;
  pattern: string;
  targetPathPattern?: string;
}): string {
  const bucket: Record<string, unknown> = {
    include: [opts.pattern],
  };
  if (opts.targetPathPattern) {
    bucket['target_path_pattern'] = opts.targetPathPattern;
  }
  const config = {
    version: 1,
    source_locale: opts.sourceLocale,
    target_locales: opts.targetLocales,
    buckets: {
      [opts.format]: bucket,
    },
  };

  return YAML.stringify(config);
}

/**
 * Resolve the config file `deepl sync init` should create. `--sync-config`
 * names the file itself (any basename, matching what `loadSyncConfig` accepts),
 * so its directory becomes the project root that detection and the generated
 * globs are relative to.
 */
export function resolveInitConfigPath(cwd: string, configPath?: string): string {
  return configPath ? path.resolve(cwd, configPath) : path.join(cwd, SYNC_CONFIG_FILENAME);
}

export async function writeSyncConfig(configPath: string, content: string): Promise<string> {
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await atomicWriteFile(configPath, content, 'utf-8');
  return configPath;
}

export function configExists(configPath: string): boolean {
  return fs.existsSync(configPath);
}

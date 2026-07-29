import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { ConfigError } from '../utils/errors.js';
import { safeReadFileSync } from '../utils/safe-read-file.js';
import { sanitizeForTerminal } from '../utils/control-chars.js';
import type { SyncConfig, SyncBucketConfig, SyncTranslationSettings, SyncValidationSettings, SyncBehavior, SyncTmsConfig } from './types.js';
import { HARD_MAX_SYNC_LIMITS } from './types.js';
import type { Formality } from '../types/common.js';

export const SYNC_CONFIG_FILENAME = '.deepl-sync.yaml';

// Loose BCP-47 matcher. Accepts plain codes (`de`, `ja`), script/region
// subtags (`zh-Hans`, `pt-BR`), and multi-subtag variants (`en-US-POSIX`).
// Each subtag is 2-8 alphanumeric chars; case is not enforced because
// operators commonly type codes in whatever case they remember. Locale codes
// are interpolated into target file paths, so anything outside this shape is
// rejected rather than merely denylisted.
export const LOCALE_CODE_RE = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*$/;

// Directories a target_path_pattern must never resolve into: writing there
// lets a translated-locale name become VCS metadata or CI workflow code.
const FORBIDDEN_TARGET_SEGMENTS: ReadonlySet<string> = new Set(['.git', '.github']);

export interface SyncConfigOverrides {
  frozen?: boolean;
  dryRun?: boolean;
  force?: boolean;
  localeFilter?: string[];
  formality?: string;
  glossary?: string;
  modelType?: string;
  context?: boolean;
  batch?: boolean;
  concurrency?: number;
  batchSize?: number;
  configPath?: string;
}

export interface ResolvedSyncConfig extends SyncConfig {
  configPath: string;
  projectRoot: string;
  overrides: SyncConfigOverrides;
}

// The upward walk stops at the first directory containing `.git` (after
// checking that directory itself) so a config planted in an ancestor outside
// the repository is never silently adopted as projectRoot.
export function findSyncConfigFile(startDir: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (true) {
    const candidate = path.join(current, SYNC_CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (fs.existsSync(path.join(current, '.git'))) {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current || current === root) {
      return null;
    }
    current = parent;
  }
}

const KNOWN_TOP_LEVEL_KEYS: readonly string[] = [
  'version',
  'source_locale',
  'target_locales',
  'buckets',
  'translation',
  'context',
  'validation',
  'sync',
  'tms',
  'ignore',
];

const KNOWN_BUCKET_KEYS: readonly string[] = [
  'include',
  'exclude',
  'key_style',
  'target_path_pattern',
];

const KNOWN_TRANSLATION_KEYS: readonly string[] = [
  'formality',
  'model_type',
  'glossary',
  'translation_memory',
  'translation_memory_threshold',
  'custom_instructions',
  'style_id',
  'locale_overrides',
  'instruction_templates',
  'length_limits',
];

const KNOWN_LENGTH_LIMITS_KEYS: readonly string[] = [
  'enabled',
  'expansion_factors',
];

const KNOWN_LOCALE_OVERRIDE_KEYS: readonly string[] = [
  'formality',
  'glossary',
  'translation_memory',
  'translation_memory_threshold',
  'custom_instructions',
  'style_id',
  'model_type',
];

const KNOWN_CONTEXT_KEYS: readonly string[] = [
  'enabled',
  'scan_paths',
  'function_names',
  'context_lines',
  'overrides',
];

const KNOWN_VALIDATION_KEYS: readonly string[] = [
  'check_placeholders',
  'fail_on_error',
  'validate_after_sync',
  'fail_on_missing',
  'fail_on_stale',
];

const KNOWN_SYNC_BEHAVIOR_KEYS: readonly string[] = [
  'concurrency',
  'batch_size',
  'max_characters',
  'backup',
  'batch',
  'max_scan_files',
  'bak_sweep_max_age_seconds',
  'limits',
];

const KNOWN_SYNC_LIMITS_KEYS: readonly string[] = [
  'max_entries_per_file',
  'max_file_bytes',
  'max_depth',
  'max_source_files',
];

const KNOWN_TMS_KEYS: readonly string[] = [
  'enabled',
  'server',
  'project_id',
  'api_key',
  'token',
  'auto_push',
  'auto_pull',
  'require_review',
  'timeout_ms',
  'push_concurrency',
];

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

function findClosestKey(key: string, known: readonly string[]): string | null {
  const threshold = Math.max(1, Math.ceil(key.length / 3));
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of known) {
    const d = levenshtein(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  if (best !== null && bestDist <= threshold) {
    return best;
  }
  return null;
}

function assertOnlyKnownKeys(
  obj: Record<string, unknown>,
  knownKeys: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(obj)) {
    if (knownKeys.includes(key)) continue;
    const suggestion = findClosestKey(key, knownKeys);
    const safeKey = sanitizeForTerminal(key);
    const hint = suggestion
      ? `Did you mean "${suggestion}"? Remove or rename "${safeKey}" in ${context}.`
      : `Remove "${safeKey}" from ${context}, or check .deepl-sync.yaml schema documentation.`;
    throw new ConfigError(
      `Unknown field "${safeKey}" in ${context}`,
      hint,
    );
  }
}

function validateTmThreshold(value: unknown, keyPath: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
    throw new ConfigError(
      `${keyPath} must be an integer between 0 and 100, got: ${String(value)}`,
      `Set ${keyPath} to an integer between 0 and 100 in .deepl-sync.yaml.`,
    );
  }
}

function validateTmModelType(
  translation: Record<string, unknown>,
  keyPath: string,
  tmInherited: boolean,
): void {
  const hasTm = tmInherited || translation['translation_memory'] !== undefined;
  if (!hasTm) return;
  const mt = translation['model_type'];
  if (mt !== undefined && mt !== 'quality_optimized') {
    throw new ConfigError(
      `${keyPath}.model_type must be 'quality_optimized' when translation_memory is set, got: ${String(mt)}`,
      `Set ${keyPath}.model_type: quality_optimized or remove translation_memory.`,
    );
  }
}

export function validateSyncConfig(raw: unknown): SyncConfig {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(
      'Sync config must be a YAML object',
      'Ensure .deepl-sync.yaml contains a top-level mapping (key: value pairs).',
    );
  }

  const obj = raw as Record<string, unknown>;

  assertOnlyKnownKeys(obj, KNOWN_TOP_LEVEL_KEYS, '.deepl-sync.yaml top level');

  if (obj['version'] === undefined) {
    throw new ConfigError(
      'Sync config missing required field: version',
      'Add version: 1 at the top of .deepl-sync.yaml.',
    );
  }
  if (obj['version'] !== 1) {
    throw new ConfigError(
      `Unsupported sync config version: ${String(obj['version'])} (expected 1)`,
      'Set version: 1 in .deepl-sync.yaml.',
    );
  }

  if (obj['source_locale'] === undefined || typeof obj['source_locale'] !== 'string' || obj['source_locale'].trim() === '') {
    throw new ConfigError(
      'Sync config missing required field: source_locale',
      'Add source_locale: <code> to .deepl-sync.yaml (e.g., source_locale: en).',
    );
  }
  if (!LOCALE_CODE_RE.test(obj['source_locale'])) {
    throw new ConfigError(
      `Invalid source locale "${sanitizeForTerminal(obj['source_locale'])}": must be a BCP-47 style code (letters, digits, hyphens; no path separators or "..")`,
      'Set source_locale in .deepl-sync.yaml to a plain code like "en" or "en-US".',
    );
  }

  if (!Array.isArray(obj['target_locales']) || obj['target_locales'].length === 0) {
    throw new ConfigError(
      'Sync config target_locales must be a non-empty array of strings',
      'Add target_locales: [<code>, ...] to .deepl-sync.yaml (e.g., [de, fr]).',
    );
  }
  for (const locale of obj['target_locales']) {
    if (typeof locale !== 'string') {
      throw new ConfigError(
        'Sync config target_locales must be a non-empty array of strings',
        'Ensure every entry in target_locales is a quoted string locale code.',
      );
    }
    if (!LOCALE_CODE_RE.test(locale)) {
      throw new ConfigError(
        `Invalid target locale "${sanitizeForTerminal(locale)}": must be a BCP-47 style code (letters, digits, hyphens; no path separators or "..")`,
        'Set entries in target_locales to plain codes like "de" or "fr-CA".',
      );
    }
  }

  if ((obj['target_locales'] as string[]).includes(obj['source_locale'])) {
    throw new ConfigError(
      'target_locales must not contain source_locale',
      'Remove the source_locale value from target_locales in .deepl-sync.yaml.',
    );
  }

  if (obj['buckets'] === undefined || typeof obj['buckets'] !== 'object' || obj['buckets'] === null || Array.isArray(obj['buckets'])) {
    throw new ConfigError(
      'Sync config buckets must be a non-empty object',
      'Add a buckets: mapping to .deepl-sync.yaml with at least one named bucket.',
    );
  }

  const buckets = obj['buckets'] as Record<string, unknown>;
  if (Object.keys(buckets).length === 0) {
    throw new ConfigError(
      'Sync config buckets must be a non-empty object',
      'Define at least one bucket under buckets: in .deepl-sync.yaml.',
    );
  }

  for (const [name, bucket] of Object.entries(buckets)) {
    const safeName = sanitizeForTerminal(name);
    if (bucket === null || bucket === undefined || typeof bucket !== 'object' || Array.isArray(bucket)) {
      throw new ConfigError(
        `Sync config bucket "${safeName}" must be an object`,
        `Define buckets.${safeName} as a mapping with at least an include: list.`,
      );
    }
    const b = bucket as Record<string, unknown>;
    assertOnlyKnownKeys(b, KNOWN_BUCKET_KEYS, `buckets.${safeName}`);
    if (!Array.isArray(b['include']) || b['include'].length === 0) {
      throw new ConfigError(
        `Sync config bucket "${safeName}" must have a non-empty include array`,
        `Add a non-empty include: glob list under buckets.${safeName} in .deepl-sync.yaml.`,
      );
    }
    for (const inc of b['include']) {
      if (typeof inc !== 'string') {
        throw new ConfigError(
          `Sync config bucket "${safeName}" include must contain only strings`,
          `Ensure every entry in buckets.${safeName}.include is a quoted glob string.`,
        );
      }
      // Containment must be enforced here, not only in the `sync init` wizard
      // (sync-init-validate.ts) which already rejects the same input: these
      // globs feed both the file walk and the stale-.bak sweep, and the sweep
      // deletes and re-creates files under whatever root it is handed.
      if (inc.split(/[/\\]/).some((segment) => segment === '..')) {
        throw new ConfigError(
          `Sync config bucket "${safeName}" include entry "${inc}" contains a ".." traversal segment`,
          `Use globs relative to the project root without traversal segments in buckets.${safeName}.include.`,
        );
      }
      if (path.isAbsolute(inc)) {
        throw new ConfigError(
          `Sync config bucket "${safeName}" include entry "${inc}" must be relative to the project root`,
          `Replace the absolute path in buckets.${safeName}.include with a path relative to the project root.`,
        );
      }
    }
    if (b['target_path_pattern'] !== undefined) {
      if (typeof b['target_path_pattern'] !== 'string') {
        throw new ConfigError(
          `Sync config bucket "${safeName}" target_path_pattern must be a string`,
          `Quote buckets.${safeName}.target_path_pattern as a string with {locale}.`,
        );
      }
      if (!b['target_path_pattern'].includes('{locale}')) {
        throw new ConfigError(
          `Sync config bucket "${safeName}" target_path_pattern must contain {locale} placeholder`,
          `Include the {locale} placeholder in buckets.${safeName}.target_path_pattern.`,
        );
      }
      if (b['target_path_pattern'].includes('..')) {
        throw new ConfigError(
          `Sync config bucket "${safeName}" target_path_pattern must not contain ".."`,
          `Remove ".." from buckets.${safeName}.target_path_pattern in .deepl-sync.yaml.`,
        );
      }
      const forbidden = b['target_path_pattern']
        .split(/[/\\]/)
        .find(seg => FORBIDDEN_TARGET_SEGMENTS.has(seg.toLowerCase()));
      if (forbidden) {
        throw new ConfigError(
          `Sync config bucket "${safeName}" target_path_pattern must not write into "${forbidden}/"`,
          `Point buckets.${safeName}.target_path_pattern at a locale directory outside ${forbidden}/.`,
        );
      }
    }
  }

  for (const block of ['translation', 'validation', 'sync', 'tms'] as const) {
    if (obj[block] !== undefined && (typeof obj[block] !== 'object' || Array.isArray(obj[block]) || obj[block] === null)) {
      throw new ConfigError(
        `Sync config ${block} must be an object`,
        `Define ${block}: as a mapping in .deepl-sync.yaml, or remove it.`,
      );
    }
  }

  if (obj['translation'] !== undefined) {
    assertOnlyKnownKeys(obj['translation'] as Record<string, unknown>, KNOWN_TRANSLATION_KEYS, 'translation');
    const tr = obj['translation'] as Record<string, unknown>;
    if (tr['length_limits'] !== undefined && typeof tr['length_limits'] === 'object' && tr['length_limits'] !== null && !Array.isArray(tr['length_limits'])) {
      assertOnlyKnownKeys(tr['length_limits'] as Record<string, unknown>, KNOWN_LENGTH_LIMITS_KEYS, 'translation.length_limits');
    }
    const overrides = tr['locale_overrides'];
    if (overrides !== undefined && typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)) {
      for (const [locale, ov] of Object.entries(overrides as Record<string, unknown>)) {
        if (ov !== null && typeof ov === 'object' && !Array.isArray(ov)) {
          assertOnlyKnownKeys(
            ov as Record<string, unknown>,
            KNOWN_LOCALE_OVERRIDE_KEYS,
            `translation.locale_overrides.${locale}`,
          );
        }
      }
    }
  }
  if (obj['validation'] !== undefined) {
    assertOnlyKnownKeys(obj['validation'] as Record<string, unknown>, KNOWN_VALIDATION_KEYS, 'validation');
  }
  if (obj['sync'] !== undefined) {
    assertOnlyKnownKeys(obj['sync'] as Record<string, unknown>, KNOWN_SYNC_BEHAVIOR_KEYS, 'sync');
    const syncBlock = obj['sync'] as Record<string, unknown>;
    if (syncBlock['concurrency'] !== undefined) {
      const c = syncBlock['concurrency'];
      if (!Number.isInteger(c) || (c as number) <= 0) {
        throw new ConfigError(
          `sync.concurrency must be a positive integer, got: ${String(c)}`,
          'Set sync.concurrency to a positive integer in .deepl-sync.yaml (default 5).',
        );
      }
    }
    if (syncBlock['max_scan_files'] !== undefined) {
      const m = syncBlock['max_scan_files'];
      if (!Number.isInteger(m) || (m as number) <= 0) {
        throw new ConfigError(
          `sync.max_scan_files must be a positive integer, got: ${String(m)}`,
          'Set sync.max_scan_files to a positive integer in .deepl-sync.yaml (default 50000).',
        );
      }
    }
    if (syncBlock['bak_sweep_max_age_seconds'] !== undefined) {
      const s = syncBlock['bak_sweep_max_age_seconds'];
      if (!Number.isInteger(s) || (s as number) <= 0) {
        throw new ConfigError(
          `sync.bak_sweep_max_age_seconds must be a positive integer (seconds), got: ${String(s)}`,
          'Set sync.bak_sweep_max_age_seconds to a positive integer in .deepl-sync.yaml (default 300).',
        );
      }
    }
    if (syncBlock['limits'] !== undefined) {
      if (
        typeof syncBlock['limits'] !== 'object' ||
        syncBlock['limits'] === null ||
        Array.isArray(syncBlock['limits'])
      ) {
        throw new ConfigError(
          'sync.limits must be an object mapping cap names to positive integers.',
          'See docs/SYNC.md for valid keys: max_entries_per_file, max_file_bytes, max_depth, max_source_files.',
        );
      }
      const limits = syncBlock['limits'] as Record<string, unknown>;
      assertOnlyKnownKeys(limits, KNOWN_SYNC_LIMITS_KEYS, 'sync.limits');
      for (const key of KNOWN_SYNC_LIMITS_KEYS) {
        const raw = limits[key];
        if (raw === undefined) continue;
        if (!Number.isInteger(raw) || (raw as number) <= 0) {
          throw new ConfigError(
            `sync.limits.${key} must be a positive integer, got: ${String(raw)}`,
            `Set sync.limits.${key} to a positive integer in .deepl-sync.yaml.`,
          );
        }
        const hardMax = HARD_MAX_SYNC_LIMITS[key as keyof typeof HARD_MAX_SYNC_LIMITS];
        if ((raw as number) > hardMax) {
          throw new ConfigError(
            `sync.limits.${key} exceeds the hard ceiling of ${hardMax} (got: ${String(raw)}).`,
            'Lower the value in .deepl-sync.yaml. The hard ceiling protects the parser from stack-overflow and memory-exhaustion edge cases.',
          );
        }
      }
    }
  }
  if (obj['tms'] !== undefined) {
    assertOnlyKnownKeys(obj['tms'] as Record<string, unknown>, KNOWN_TMS_KEYS, 'tms');
  }
  if (obj['context'] !== undefined && typeof obj['context'] === 'object' && obj['context'] !== null && !Array.isArray(obj['context'])) {
    assertOnlyKnownKeys(obj['context'] as Record<string, unknown>, KNOWN_CONTEXT_KEYS, 'context');
  }

  const tmsBlock = obj['tms'] as Record<string, unknown> | undefined;
  if (tmsBlock?.['timeout_ms'] !== undefined) {
    const t = tmsBlock['timeout_ms'];
    if (!Number.isInteger(t) || (t as number) <= 0) {
      throw new ConfigError(
        `tms.timeout_ms must be a positive integer (milliseconds), got: ${String(t)}`,
        'Set tms.timeout_ms to a positive integer in .deepl-sync.yaml (default 30000).',
      );
    }
  }
  if (tmsBlock?.['push_concurrency'] !== undefined) {
    const c = tmsBlock['push_concurrency'];
    if (!Number.isInteger(c) || (c as number) <= 0) {
      throw new ConfigError(
        `tms.push_concurrency must be a positive integer, got: ${String(c)}`,
        'Set tms.push_concurrency to a positive integer in .deepl-sync.yaml (default 10).',
      );
    }
  }

  const t = obj['translation'] as Record<string, unknown> | undefined;
  if (t) {
    validateTmThreshold(t['translation_memory_threshold'], 'translation.translation_memory_threshold');
    validateTmModelType(t, 'translation', false);
    const topLevelTm = t['translation_memory'] !== undefined;
    const overrides = t['locale_overrides'] as Record<string, Record<string, unknown>> | undefined;
    if (overrides) {
      for (const [locale, ov] of Object.entries(overrides)) {
        validateTmThreshold(
          ov['translation_memory_threshold'],
          `translation.locale_overrides.${locale}.translation_memory_threshold`,
        );
        validateTmModelType(ov, `translation.locale_overrides.${locale}`, topLevelTm);
      }
    }
  }

  return {
    version: obj['version'],
    source_locale: obj['source_locale'],
    target_locales: obj['target_locales'] as string[],
    buckets: obj['buckets'] as Record<string, SyncBucketConfig>,
    ...(obj['translation'] !== undefined && { translation: obj['translation'] as SyncTranslationSettings }),
    ...(obj['validation'] !== undefined && { validation: obj['validation'] as SyncValidationSettings }),
    ...(obj['sync'] !== undefined && { sync: obj['sync'] as SyncBehavior }),
    ...(Array.isArray(obj['ignore']) && { ignore: obj['ignore'] as string[] }),
    ...(obj['tms'] !== undefined && { tms: obj['tms'] as SyncTmsConfig }),
    ...(obj["context"] !== undefined && { context: typeof obj["context"] === "boolean" ? { enabled: obj["context"] } : obj["context"] as { enabled: boolean } }),
  };
}

// Single source of truth for merging CLI overrides (--locale, --formality,
// --glossary, --model-type, --scan-context, --batch/--no-batch) into a loaded
// SyncConfig. All guards that cross the YAML-vs-CLI layer boundary live here
// so they cannot be bypassed by callers that assemble the config elsewhere.
// --locale is a filter over target_locales, not a specifier, so a value
// outside target_locales is a ConfigError rather than a silent no-op.
export function applyCliOverrides(
  config: SyncConfig,
  overrides: SyncConfigOverrides,
): SyncConfig {
  if (overrides.localeFilter !== undefined) {
    const unconfigured = overrides.localeFilter.filter(
      (locale) => !config.target_locales.includes(locale),
    );
    if (unconfigured.length > 0) {
      throw new ConfigError(
        `--locale ${unconfigured.join(', ')} not in target_locales (configured: ${config.target_locales.join(', ')})`,
        'Pass only locales listed in target_locales, or add the locale to target_locales in .deepl-sync.yaml.',
      );
    }
  }
  if (overrides.formality !== undefined) {
    config.translation = config.translation ?? {};
    config.translation.formality = overrides.formality as Formality;
  }
  if (overrides.glossary !== undefined) {
    config.translation = config.translation ?? {};
    config.translation.glossary = overrides.glossary;
  }
  if (overrides.modelType !== undefined) {
    config.translation = config.translation ?? {};
    config.translation.model_type = overrides.modelType as SyncTranslationSettings['model_type'];
    if (config.translation.translation_memory !== undefined
      && config.translation.model_type !== 'quality_optimized') {
      throw new ConfigError(
        `--model-type ${overrides.modelType} is incompatible with translation_memory (requires quality_optimized)`,
        'Pass --model-type quality_optimized, or remove translation_memory from .deepl-sync.yaml.',
      );
    }
  }
  if (overrides.context !== undefined) {
    if (config.context) {
      config.context.enabled = overrides.context;
    } else {
      config.context = { enabled: overrides.context };
    }
  }
  if (overrides.batch !== undefined) {
    if (config.sync) {
      config.sync.batch = overrides.batch;
    } else {
      config.sync = { concurrency: 5, batch_size: 50, batch: overrides.batch };
    }
  }
  return config;
}

export async function loadSyncConfig(
  startDir?: string,
  overrides: SyncConfigOverrides = {},
): Promise<ResolvedSyncConfig> {
  let configPath: string;

  if (overrides.configPath) {
    configPath = path.resolve(overrides.configPath);
    if (!fs.existsSync(configPath)) {
      throw new ConfigError(
        `Sync config file not found: ${configPath}`,
        'Check the --config path, or create .deepl-sync.yaml at that location.',
      );
    }
  } else {
    const found = findSyncConfigFile(startDir ?? process.cwd());
    if (!found) {
      throw new ConfigError(
        `No ${SYNC_CONFIG_FILENAME} found in ${startDir ?? process.cwd()} or any parent directory`,
        "Run 'deepl sync init' to create one, or create .deepl-sync.yaml manually.",
      );
    }
    configPath = found;
  }

  // SECURITY: reject symlinks (a hostile .deepl-sync.yaml -> ~/.ssh/id_rsa
  // would otherwise be YAML-parsed and surfaced verbatim in ConfigError
  // messages on stderr).
  const content = safeReadFileSync(configPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Failed to parse YAML in ${configPath}: ${message}`,
      'Fix the YAML syntax in .deepl-sync.yaml (check indentation, quoting, and braces).',
    );
  }

  const config = applyCliOverrides(validateSyncConfig(parsed), overrides);
  warnOnInlineTmsCredentials(config.tms);

  return {
    ...config,
    configPath,
    projectRoot: path.dirname(configPath),
    overrides,
  };
}

// Emit a security warning whenever a user has put TMS credentials directly
// in .deepl-sync.yaml instead of the recommended env vars. Writes directly
// to stderr (no TTY gate) so the warning survives on CI and piped contexts.
// Runs at config load so every sync subcommand warns, not just the ones
// that resolve TMS credentials in tms-client.ts.
function warnOnInlineTmsCredentials(tms: SyncTmsConfig | undefined): void {
  if (!tms) return;
  if (tms.api_key && !process.env['TMS_API_KEY']) {
    process.stderr.write(
      'Warning: TMS api_key is set in .deepl-sync.yaml. Use the TMS_API_KEY env var instead to avoid committing secrets.\n',
    );
  }
  if (tms.token && !process.env['TMS_TOKEN']) {
    process.stderr.write(
      'Warning: TMS token is set in .deepl-sync.yaml. Use the TMS_TOKEN env var instead to avoid committing secrets.\n',
    );
  }
}

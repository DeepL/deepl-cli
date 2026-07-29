/**
 * Validation and locale-choice helpers for `deepl sync init`.
 *
 * Keeps register-sync.ts lean and makes the non-interactive input
 * validation independently unit-testable. The canonical list of
 * DeepL-supported target locales is sourced from
 * {@link ../data/language-registry.ts}.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ValidationError } from '../utils/errors.js';
import { getTargetLanguages } from '../data/language-registry.js';
import { LOCALE_CODE_RE } from './sync-config.js';

export interface SyncInitFlagValidation {
  sourceLocale: string;
  targetLocales: string;
  filePath: string;
  cwd?: string;
}

export interface SyncInitValidationResult {
  sourceLocale: string;
  targetLocales: string[];
  warnings: string[];
}

export interface TargetLocaleChoice {
  name: string;
  value: string;
  checked?: boolean;
}

// Pre-checked subset. These are the locales most sync users pick first;
// everything else in the registry remains available but unchecked so the
// wizard does not silently bill for 30+ locales on a bare [Enter].
const DEFAULT_CHECKED: ReadonlySet<string> = new Set([
  'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt-br', 'zh',
]);

export function validateSyncInitFlags(flags: SyncInitFlagValidation): SyncInitValidationResult {
  const warnings: string[] = [];

  const rawTargets = flags.targetLocales.split(',').map((l) => l.trim()).filter((l) => l.length > 0);
  if (rawTargets.length === 0) {
    throw new ValidationError(
      '--target-locales is empty after parsing.',
      'Provide at least one target locale, e.g. --target-locales de,fr,ja',
    );
  }

  const source = flags.sourceLocale.trim();
  const sourceLc = source.toLowerCase();
  const seen = new Map<string, string>();
  for (const code of rawTargets) {
    if (code.toLowerCase() === sourceLc) {
      throw new ValidationError(
        `--source-locale "${source}" also appears in --target-locales ("${code}").`,
        `Remove "${code}" from --target-locales; it's the source locale.`,
      );
    }
    const lc = code.toLowerCase();
    if (seen.has(lc)) {
      const first = seen.get(lc)!;
      throw new ValidationError(
        `Duplicate target locale in --target-locales: "${first}" and "${code}".`,
        'Each target locale must appear at most once.',
      );
    }
    if (!LOCALE_CODE_RE.test(code)) {
      throw new ValidationError(
        `Malformed locale code in --target-locales: "${code}".`,
        'Use a BCP-47 style code, e.g. "de", "ja", "pt-BR", "zh-Hans".',
      );
    }
    seen.set(lc, code);
  }

  const filePath = flags.filePath;
  if (filePath.split(/[/\\]/).some((seg) => seg === '..')) {
    throw new ValidationError(
      `--path "${filePath}" contains a ".." traversal segment.`,
      'Use a path relative to the project root without traversal segments.',
    );
  }

  const hasGlobMeta = /[*?[\]{}]/.test(filePath);
  if (!hasGlobMeta) {
    const cwd = flags.cwd ?? process.cwd();
    const abs = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    if (!fs.existsSync(abs)) {
      warnings.push(
        `--path "${filePath}" does not exist yet; the config will still be written. ` +
        `Make sure the source file is present before running "deepl sync".`,
      );
    }
  }

  return {
    sourceLocale: source,
    targetLocales: rawTargets,
    warnings,
  };
}

export function buildTargetLocaleChoices(): TargetLocaleChoice[] {
  return getTargetLanguages().map((entry) => {
    const choice: TargetLocaleChoice = {
      name: `${entry.name} (${entry.code})`,
      value: entry.code,
    };
    if (DEFAULT_CHECKED.has(entry.code)) {
      choice.checked = true;
    }
    return choice;
  });
}

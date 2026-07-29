import type { Command } from 'commander';
import { DeepLCLIError } from '../../../utils/errors.js';
import { ExitCode, exitCodeForError } from '../../../utils/exit-codes.js';

/**
 * Commander routes an invocation-line --format to the nearest command that
 * declares it. When both the parent `sync` command and a subcommand declare
 * --format, the parent wins if --format appears before the subcommand name
 * (e.g. `deepl sync --format json status`). Subcommand handlers should prefer
 * the parent's value when it is stronger than their own default ("text").
 */
export function resolveFormat(
  opts: { format?: string },
  command: Command,
): string | undefined {
  const parentFormat = command.parent?.opts()['format'] as string | undefined;
  if (parentFormat && parentFormat !== 'text' && opts.format === 'text') {
    return parentFormat;
  }
  return opts.format;
}

/**
 * Resolve --locale across parent (`sync`) and subcommand scopes so a
 * subcommand narrows regardless of where the flag sits on the invocation
 * line. Subcommand value wins; otherwise fall back to the parent's.
 *
 * Without positional options, commander keeps matching the parent's flags
 * after the subcommand name, so `deepl sync status --locale de` binds `de` to
 * the parent `sync` command and leaves the subcommand's own store undefined.
 */
export function resolveLocale(
  opts: { locale?: string },
  command: Command,
): string | undefined {
  if (opts.locale !== undefined) return opts.locale;
  return command.parent?.opts()['locale'] as string | undefined;
}

/**
 * Resolve --sync-config across parent (`sync`) and subcommand scopes. Same
 * parent/child binding rule as {@link resolveLocale}: a subcommand that reads
 * only its own store silently falls back to the auto-detected config.
 */
export function resolveSyncConfig(
  opts: { syncConfig?: string },
  command: Command,
): string | undefined {
  if (opts.syncConfig !== undefined) return opts.syncConfig;
  return command.parent?.opts()['syncConfig'] as string | undefined;
}

/**
 * Split a resolved --locale value into the comma-separated filter list that
 * `loadSyncConfig` validates against `target_locales`.
 */
export function parseLocaleFilter(locale: string | undefined): string[] | undefined {
  if (!locale) return undefined;
  return locale.split(',').map((l) => l.trim());
}

/**
 * JSON error envelope shape emitted on stderr when --format json is set and
 * a command fails. Shared across every `deepl sync` subcommand so script
 * consumers can parse failures with one schema.
 *
 * @see tests/helpers/assert-error-envelope.ts for the canonical validator.
 */
export interface SyncJsonErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    suggestion?: string;
  };
  exitCode: number;
}

/**
 * Canonical success envelope for `sync init --format json`. Other subcommands
 * emit their own typed success payloads; init ships a minimal `ok:true` +
 * `created:{...}` so bootstrap scripts can confirm the config was written.
 */
export interface SyncInitJsonSuccessEnvelope {
  ok: true;
  created: {
    configPath: string;
    sourceLocale: string;
    targetLocales: string[];
    keys?: number;
  };
}

// eslint-disable-next-line no-control-regex -- intentional: strip control chars from error messages before emitting envelope
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g;

function sanitizeMessage(message: string): string {
  return message.replace(CONTROL_CHAR_RE, '');
}

/**
 * Serialize an error to the canonical envelope on stderr and exit with the
 * error's typed exit code. Shared by every subcommand that honors
 * --format json for machine-readable failures.
 */
export function emitJsonErrorAndExit(
  error: unknown,
  overrideExitCode?: number,
): never {
  const err = error instanceof Error ? error : new Error(String(error));
  const code = err instanceof DeepLCLIError ? err.name : 'UnknownError';
  const exitCode = overrideExitCode ?? (
    err instanceof DeepLCLIError ? err.exitCode : exitCodeForError(err)
  );
  const envelope: SyncJsonErrorEnvelope = {
    ok: false,
    error: {
      code,
      message: sanitizeMessage(err.message),
      ...(err instanceof DeepLCLIError && err.suggestion
        ? { suggestion: sanitizeMessage(err.suggestion) }
        : {}),
    },
    exitCode,
  };
  process.stderr.write(JSON.stringify(envelope) + '\n');
  process.exit(exitCode);
}

/**
 * Serialize the canonical success envelope for `sync init --format json` to
 * stdout and exit 0. Only `init` uses this helper today; other subcommands
 * have richer payloads and write them directly.
 */
export function emitJsonInitSuccessAndExit(
  payload: SyncInitJsonSuccessEnvelope['created'],
): never {
  const envelope: SyncInitJsonSuccessEnvelope = {
    ok: true,
    created: payload,
  };
  process.stdout.write(JSON.stringify(envelope) + '\n');
  process.exit(ExitCode.Success);
}

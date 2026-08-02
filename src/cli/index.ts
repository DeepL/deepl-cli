#!/usr/bin/env node

/**
 * DeepL CLI Entry Point
 * Main command-line interface
 */

import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute, extname } from 'path';
import { ConfigService } from '../storage/config.js';
import { createCacheServiceGetter, resolveCacheOptions } from './cache-loader.js';
import { resolvePaths } from '../utils/paths.js';
import type { DeepLClient } from '../api/deepl-client.js';
import { Logger } from '../utils/logger.js';
import { AuthError, DeepLCLIError } from '../utils/errors.js';
import { ExitCode, getExitCodeFromError } from '../utils/exit-codes.js';
import { isSymlink } from '../utils/safe-read-file.js';
import { setNoInput } from '../utils/confirm.js';
import { registerAuth } from './commands/register-auth.js';
import { registerUsage } from './commands/register-usage.js';
import { registerLanguages } from './commands/register-languages.js';
import { registerTranslate } from './commands/register-translate.js';
import { registerWatch } from './commands/register-watch.js';
import { registerWrite } from './commands/register-write.js';
import { registerCorrect } from './commands/register-correct.js';
import { registerConfig } from './commands/register-config.js';
import { registerCache } from './commands/register-cache.js';
import { registerGlossary } from './commands/register-glossary.js';
import { registerTm } from './commands/register-tm.js';
import { registerHooks } from './commands/register-hooks.js';
import { registerSync } from './commands/register-sync.js';
import { registerStyleRules } from './commands/register-style-rules.js';
import { registerAdmin } from './commands/register-admin.js';
import { registerCompletion } from './commands/register-completion.js';
import { registerVoice } from './commands/register-voice.js';
import { registerInit } from './commands/register-init.js';
import { registerDetect } from './commands/register-detect.js';
import { registerDescribe } from './commands/register-describe.js';
import { validateApiUrl } from '../utils/validate-url.js';
import { resolveEndpoint } from '../utils/resolve-endpoint.js';
import { installSignalExit } from '../utils/signal-exit.js';
import { assertSupportedNodeVersion } from './node-version-check.js';

assertSupportedNodeVersion();

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
  version: string;
};
const { version } = packageJson;

// Initialize services
const paths = resolvePaths();

// Create config service - can be overridden by --config flag
let configService = new ConfigService(paths.configFile);

// HTTP transport overrides from --timeout / --max-retries, applied to every
// client the commands construct.
let httpOptions: { timeout?: number; maxRetries?: number } = {};

const getCacheService = createCacheServiceGetter(() =>
  resolveCacheOptions(configService, paths.cacheFile),
);

/**
 * Handle error and exit with appropriate exit code
 */
function handleError(error: unknown): never {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  const exitCode =
    error instanceof Error
      ? getExitCodeFromError(error)
      : ExitCode.GeneralError;

  Logger.error(chalk.red('Error:'), errorMessage);

  if (error instanceof DeepLCLIError && error.suggestion) {
    Logger.error(chalk.yellow('Suggestion:'), error.suggestion);
  }

  process.exit(exitCode);
}

/**
 * Parse an integer CLI option, exiting with InvalidInput when it is not a
 * whole number at or above `min`.
 */
function parseIntOption(raw: string, flag: string, min: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    Logger.error(
      chalk.red(`Error: ${flag} must be an integer >= ${min} (got "${raw}")`)
    );
    process.exit(ExitCode.InvalidInput);
  }
  return value;
}

/**
 * Create DeepL client with API key from config or env
 */
async function createDeepLClient(
  overrideBaseUrl?: string
): Promise<DeepLClient> {
  const apiKey = configService.getValue<string>('auth.apiKey');
  const envKey = process.env['DEEPL_API_KEY'];

  const key = apiKey ?? envKey;

  if (!key) {
    // Routed through handleError so the remediation survives --quiet, which
    // suppresses Logger.warn entirely.
    handleError(new AuthError('API key not set'));
  }

  const configBaseUrl = configService.getValue<string>('api.baseUrl');
  const usePro = configService.getValue<boolean>('api.usePro');
  const baseUrl = resolveEndpoint({
    apiKey: key,
    configBaseUrl,
    usePro,
    apiUrlOverride: overrideBaseUrl,
  });

  if (baseUrl) {
    const { validateApiUrl } = await import('../utils/validate-url.js');
    validateApiUrl(baseUrl);
  }

  const { DeepLClient: Client } = await import('../api/deepl-client.js');
  return new Client(key, { baseUrl, usePro, ...httpOptions });
}

// Create program
const program = new Command();
program.showSuggestionAfterError(true);

program
  .name('deepl')
  .description(
    'DeepL CLI - Next-generation translation tool powered by DeepL API'
  )
  .version(version)
  .option(
    '-q, --quiet',
    'Suppress all non-essential output (errors and results only)'
  )
  .option(
    '-v, --verbose',
    'Show extra information (source language, timing, cache status)'
  )
  .option('-c, --config <file>', 'Use alternate configuration file')
  .option(
    '--no-input',
    'Disable all interactive prompts (abort instead of prompting)'
  )
  .option(
    '--timeout <ms>',
    'HTTP request timeout in milliseconds (default: 30000)'
  )
  .option(
    '--max-retries <n>',
    'Maximum automatic retries for retryable requests (default: 3)'
  )
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();

    // Handle --config flag - reinitialize config service with custom path
    // SECURITY: Validate path to prevent traversal attacks
    if (options['config']) {
      const customConfigPath = options['config'] as string;

      // Resolve to absolute path (handles both relative and absolute paths)
      // resolve() automatically normalizes and resolves '..' sequences safely
      const safePath = isAbsolute(customConfigPath)
        ? resolve(customConfigPath)
        : resolve(process.cwd(), customConfigPath);

      // SECURITY: Require .json extension to prevent overwriting arbitrary files
      if (extname(safePath).toLowerCase() !== '.json') {
        Logger.error(
          chalk.red('Error: --config path must have a .json extension')
        );
        process.exit(ExitCode.InvalidInput);
      }

      // SECURITY: Reject symlinks to prevent path traversal
      if (isSymlink(safePath)) {
        Logger.error(chalk.red('Error: --config path must not be a symlink'));
        process.exit(ExitCode.InvalidInput);
      }

      configService = new ConfigService(safePath);
    }

    // Set quiet mode before any command runs
    if (options['quiet']) {
      Logger.setQuiet(true);
    }

    // Set verbose mode: --verbose flag takes precedence over config
    if (options['verbose']) {
      Logger.setVerbose(true);
    } else {
      const configVerbose = configService.getValue<boolean>('output.verbose');
      if (configVerbose === true) {
        Logger.setVerbose(true);
      }
    }

    // Disable colors if output.color is false in config, or if NO_COLOR is set
    // (https://no-color.org). chalk auto-detects NO_COLOR but we set level=0
    // explicitly so the signal is unambiguous across both chalk paths and the
    // separate `isColorEnabled()` path in utils/formatters.ts.
    const colorEnabled = configService.getValue<boolean>('output.color');
    if (colorEnabled === false || 'NO_COLOR' in process.env) {
      chalk.level = 0;
    }

    // Set non-interactive mode
    if (options['input'] === false) {
      setNoInput(true);
    }

    httpOptions = {
      ...(options['timeout'] !== undefined && {
        timeout: parseIntOption(options['timeout'] as string, '--timeout', 1),
      }),
      ...(options['maxRetries'] !== undefined && {
        maxRetries: parseIntOption(
          options['maxRetries'] as string,
          '--max-retries',
          0
        ),
      }),
    };
  });

/**
 * Get raw API key and client options without constructing a client.
 * Used by VoiceClient which needs direct access to create its own client.
 */
function getApiKeyAndOptions(): {
  apiKey: string;
  options: import('../api/http-client.js').DeepLClientOptions;
} {
  const apiKey = configService.getValue<string>('auth.apiKey');
  const envKey = process.env['DEEPL_API_KEY'];
  const key = apiKey ?? envKey;

  if (!key) {
    // Routed through handleError so the remediation survives --quiet, which
    // suppresses Logger.warn entirely.
    handleError(new AuthError('API key not set'));
  }

  const configBaseUrl = configService.getValue<string>('api.baseUrl');
  const usePro = configService.getValue<boolean>('api.usePro');
  const baseUrl = resolveEndpoint({ apiKey: key, configBaseUrl, usePro });
  if (baseUrl) {
    validateApiUrl(baseUrl);
  }

  return { apiKey: key, options: { baseUrl, ...httpOptions } };
}

// Shared dependencies passed to register functions
// Use a getter for configService because the preAction hook may reassign it
const deps = {
  getConfigService: () => configService,
  getCacheService,
  createDeepLClient,
  getApiKeyAndOptions,
  getHttpOptions: () => httpOptions,
  handleError,
};

// Register all command groups, organized by help category
program.commandsGroup('Core Commands:');
registerTranslate(program, deps);
registerWrite(program, deps);
registerCorrect(program, deps);
registerVoice(program, deps);

program.commandsGroup('Resources:');
registerGlossary(program, deps);
registerTm(program, deps);

program.commandsGroup('Workflow:');
registerWatch(program, deps);
registerSync(program, deps);
registerHooks(program, deps);

program.commandsGroup('Configuration:');
registerInit(program, deps);
registerAuth(program, deps);
registerConfig(program, deps);
registerCache(program, deps);
registerStyleRules(program, deps);

program.commandsGroup('Information:');
registerUsage(program, deps);
registerLanguages(program, deps);
registerDetect(program, deps);
registerCompletion(program, deps);

program.commandsGroup('Administration:');
registerAdmin(program, deps);

registerDescribe(program, deps);

// Commander exits 1 on parse errors (unknown command/option, invalid choice,
// missing argument) by default; route them through the catch around
// parseAsync instead so every command level exits with InvalidInput.
// Subcommands registered via addCommand() do not inherit exitOverride, so
// apply it to the whole tree.
function applyExitOverride(command: Command): void {
  command.exitOverride();
  for (const sub of command.commands) {
    applyExitOverride(sub);
  }
}
applyExitOverride(program);

// Show Getting Started hint when no API key is configured
const savedApiKey = configService.getValue<string>('auth.apiKey');
const envApiKey = process.env['DEEPL_API_KEY'];
if (!savedApiKey && !envApiKey) {
  program.addHelpText(
    'beforeAll',
    chalk.yellow('Getting Started: Run deepl init to set up your API key.\n')
  );
}

// Did-you-mean suggestion for unknown commands
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from(
    { length: m + 1 },
    () => Array(n + 1).fill(0) as number[]
  );
  for (let i = 0; i <= m; i++) {
    dp[i]![0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

program.on('command:*', (operands: string[]) => {
  const unknown = operands[0];
  if (!unknown) {
    program.outputHelp();
    process.exit(0);
    return;
  }

  // Hidden commands are internal surface, so they are never suggested. An
  // alias match resolves to the command it aliases, which is the name the
  // user is looking for.
  const candidates = program
    .createHelp()
    .visibleCommands(program)
    .flatMap((cmd) => [cmd.name(), ...cmd.aliases()].map((name) => ({ name, target: cmd.name() })));

  let bestMatch = '';
  let bestDistance = Infinity;
  for (const { name, target } of candidates) {
    // A typed prefix is a stronger signal than edit distance: "tr" is 2 edits
    // from both "tm" and "translate", but only one of them was being typed.
    const d = name.startsWith(unknown) ? 0 : levenshtein(unknown, name);
    if (d < bestDistance) {
      bestDistance = d;
      bestMatch = target;
    }
  }

  Logger.error(chalk.red(`Unknown command: ${unknown}`));

  const maxDistance = Math.max(2, Math.floor(unknown.length / 2));
  if (bestMatch && bestDistance <= maxDistance) {
    Logger.error(chalk.yellow(`Did you mean: deepl ${bestMatch}?`));
  }

  Logger.error('');
  Logger.error(`Run ${chalk.bold('deepl --help')} to see available commands.`);
  process.exit(ExitCode.InvalidInput);
});

// Own process termination on signals, so no component's cleanup handler has to
// call process.exit() and thereby preempt the others.
installSignalExit();

// Show help and exit 0 if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// Parse arguments. Commander propagates non-CommanderError throws from option
// coercers (e.g. --tm-threshold) uncaught, so route DeepLCLIError subclasses
// through handleError here — otherwise pre-handler validation crashes with a
// stack trace instead of the documented exit code.
try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof DeepLCLIError) {
    handleError(error);
  } else if (error instanceof CommanderError) {
    // Commander has already printed the message (or help/version output).
    // exitCode 0 covers --help and --version; everything else is a parse
    // error and maps to the documented InvalidInput code.
    process.exit(error.exitCode === 0 ? 0 : ExitCode.InvalidInput);
  } else {
    throw error;
  }
}

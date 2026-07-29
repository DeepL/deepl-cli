import { Command, Option } from 'commander';
import chalk from 'chalk';
import { Logger } from '../../../utils/logger.js';
import { ValidationError, ConfigError } from '../../../utils/errors.js';
import type { ServiceDeps } from '../service-factory.js';
import {
  emitJsonErrorAndExit,
  emitJsonInitSuccessAndExit,
  resolveFormat,
  resolveSyncConfig,
} from './sync-options.js';
import { ExitCode } from '../../../utils/exit-codes.js';

interface InitOptions {
  sourceLocale?: string;
  targetLocales?: string;
  fileFormat?: string;
  path?: string;
  syncConfig?: string;
  format?: string;
}


export function registerSyncInit(
  parent: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Command {
  // Choices are filled in lazily so registration does not load every format
  // parser (yaml, smol-toml, ...) on unrelated CLI invocations. The
  // preSubcommand hook runs before the subcommand parses its options, so
  // validation and help output are unaffected.
  const fileFormatOption = new Option('--file-format <type>', 'File format');
  const cmd = parent
    .command('init')
    .description('Initialize .deepl-sync.yaml configuration')
    .option('--source-locale <code>', 'Source locale')
    .option('--target-locales <codes>', 'Target locales (comma-separated)')
    .addOption(fileFormatOption)
    .option('--path <pattern>', 'Source file pattern')
    .addOption(
      new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'),
    )
    .option('--sync-config <path>', 'Path to .deepl-sync.yaml')
    .action((options: InitOptions, command: Command) => handleSyncInit(options, command, deps));

  parent.hook('preSubcommand', async (_thisCommand, actionCommand) => {
    if (actionCommand === cmd && fileFormatOption.argChoices === undefined) {
      const { SUPPORTED_FORMAT_KEYS } = await import('../../../formats/index.js');
      fileFormatOption.choices([...SUPPORTED_FORMAT_KEYS]);
    }
  });

  return cmd;
}

interface InitSuccessPayload {
  configPath: string;
  sourceLocale: string;
  targetLocales: string[];
  keys?: number;
}

function emitInitSuccess(
  format: string | undefined,
  payload: InitSuccessPayload,
): void {
  if (format === 'json') {
    emitJsonInitSuccessAndExit(payload);
  }
  Logger.output(chalk.green(`Created ${payload.configPath}`));
}

async function handleSyncInit(
  options: InitOptions,
  command: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Promise<void> {
  const { handleError } = deps;
  options.format = resolveFormat(options, command);
  try {
    const { configExists, detectI18nFiles, generateSyncConfig, resolveInitConfigPath, writeSyncConfig } =
      await import('../../../sync/sync-init.js');
    const pathMod = await import('path');

    const targetConfigPath = resolveInitConfigPath(
      process.cwd(),
      resolveSyncConfig(options, command),
    );
    const cwd = pathMod.dirname(targetConfigPath);
    const displayPath = pathMod.relative(process.cwd(), targetConfigPath) || targetConfigPath;

    if (configExists(targetConfigPath)) {
      if (options.format === 'json') {
        // Already-present config is not an error per se, but scripted
        // bootstrap flows need a non-ok envelope to branch on.
        const envelope = {
          ok: false,
          error: {
            code: 'ConfigError',
            message: `Config file ${displayPath} already exists.`,
            suggestion:
              'Remove or rename the existing config file, or edit it directly.',
          },
          exitCode: ExitCode.ConfigError,
        };
        process.stderr.write(JSON.stringify(envelope) + '\n');
        process.exit(ExitCode.ConfigError);
      }
      Logger.warn(chalk.yellow(`Config file ${displayPath} already exists.`));
      return;
    }

    if (options.sourceLocale && options.targetLocales && options.fileFormat && options.path) {
      const { validateSyncInitFlags } = await import(
        '../../../sync/sync-init-validate.js'
      );
      const validated = validateSyncInitFlags({
        sourceLocale: options.sourceLocale,
        targetLocales: options.targetLocales,
        filePath: options.path,
        cwd,
      });
      for (const warning of validated.warnings) {
        Logger.warn(chalk.yellow(warning));
      }
      const content = generateSyncConfig({
        sourceLocale: validated.sourceLocale,
        targetLocales: validated.targetLocales,
        format: options.fileFormat,
        pattern: options.path,
      });
      const configPath = await writeSyncConfig(targetConfigPath, content);
      emitInitSuccess(options.format, {
        configPath,
        sourceLocale: validated.sourceLocale,
        targetLocales: validated.targetLocales,
      });
      return;
    }

    const partialFlags = [
      options.sourceLocale && '--source-locale',
      options.targetLocales && '--target-locales',
      options.fileFormat && '--file-format',
      options.path && '--path',
    ].filter(Boolean) as string[];
    if (partialFlags.length > 0) {
      Logger.warn(
        `Partial flags provided (${partialFlags.join(', ')}); all of --source-locale, --target-locales, --file-format, and --path are required for non-interactive mode. Falling back to detection.`,
      );
    }

    const detected = await detectI18nFiles(cwd);
    if (detected.length === 0) {
      const noFilesError = new ConfigError(
        'No i18n files detected. No config created. Re-run with all four flags: --source-locale <locale> --target-locales <list> --file-format <format> --path <glob>',
        'Re-run with --source-locale <locale> --target-locales <list> --file-format <format> --path <glob>',
      );
      if (options.format === 'json') {
        emitJsonErrorAndExit(noFilesError);
      }
      Logger.info(noFilesError.message);
      process.exit(ExitCode.ConfigError);
    }

    if (!process.stdin.isTTY) {
      throw new ValidationError(
        'All four flags (--source-locale, --target-locales, --file-format, --path) are required when stdin is not a TTY.',
        'Provide all four flags for non-interactive use (CI, piped shells), or run in an interactive terminal.',
      );
    }

    const project = detected[0]!;
    Logger.info(`Detected ${project.format} project (${project.keyCount} keys)`);

    const { input, checkbox } = await import('@inquirer/prompts');
    const { buildTargetLocaleChoices } = await import(
      '../../../sync/sync-init-validate.js'
    );
    const sourceLocale =
      options.sourceLocale ??
      (await input({
        message: 'Source locale:',
        default: project.sourceLocale,
      }));

    const targetLocales = options.targetLocales
      ? options.targetLocales.split(',').map((l) => l.trim())
      : await checkbox({
          message: 'Target locales:',
          choices: buildTargetLocaleChoices(),
          pageSize: 15,
        });

    const content = generateSyncConfig({
      sourceLocale,
      targetLocales,
      format: options.fileFormat ?? project.format,
      pattern: options.path ?? project.pattern,
      targetPathPattern: options.path ? undefined : project.targetPathPattern,
    });
    const configPath = await writeSyncConfig(targetConfigPath, content);
    emitInitSuccess(options.format, {
      configPath,
      sourceLocale,
      targetLocales,
      keys: project.keyCount,
    });
  } catch (error) {
    if (options.format === 'json') {
      emitJsonErrorAndExit(error);
    }
    handleError(error);
  }
}

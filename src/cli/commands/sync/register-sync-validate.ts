import { Command, Option } from 'commander';
import chalk from 'chalk';
import { Logger } from '../../../utils/logger.js';
import { ExitCode } from '../../../utils/exit-codes.js';
import type { ServiceDeps } from '../service-factory.js';
import {
  emitJsonErrorAndExit,
  parseLocaleFilter,
  resolveFormat,
  resolveLocale,
  resolveSyncConfig,
} from './sync-options.js';

interface ValidateOptions {
  locale?: string;
  format?: string;
  syncConfig?: string;
}

export function registerSyncValidate(
  parent: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Command {
  return parent
    .command('validate')
    .description('Validate translations for quality issues')
    .option('--locale <locales>', 'Filter by locale (comma-separated)')
    .addOption(
      new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'),
    )
    .option('--sync-config <path>', 'Path to .deepl-sync.yaml')
    .action((options: ValidateOptions, command: Command) =>
      handleSyncValidate(options, command, deps),
    );
}

async function handleSyncValidate(
  options: ValidateOptions,
  command: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Promise<void> {
  options.format = resolveFormat(options, command);
  try {
    const { loadSyncConfig } = await import('../../../sync/sync-config.js');
    const { createDefaultRegistry } = await import('../../../formats/index.js');
    const { validateTranslations } = await import('../../../sync/sync-validate.js');

    const localeFilter = parseLocaleFilter(resolveLocale(options, command));
    const config = await loadSyncConfig(process.cwd(), {
      configPath: resolveSyncConfig(options, command),
      localeFilter,
    });

    if (localeFilter) {
      config.target_locales = config.target_locales.filter((l: string) =>
        localeFilter.includes(l),
      );
    }

    const registry = await createDefaultRegistry();
    const result = await validateTranslations(config, registry);

    if (options.format === 'json') {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      Logger.output(`Checked ${result.totalChecked} translations\n`);
      if (result.issues.length === 0) {
        Logger.output(chalk.green('All translations passed validation.'));
      } else {
        for (const issue of result.issues) {
          const icon = issue.severity === 'error' ? chalk.red('ERROR') : chalk.yellow('WARN');
          Logger.output(
            `  ${icon}  ${issue.locale}/${issue.key}: ${issue.issues.map((i) => i.message).join(', ')}`,
          );
        }
        Logger.output(`\n${result.errors} error(s), ${result.warnings} warning(s)`);
      }
    }

    if (result.errors > 0) {
      process.exit(ExitCode.CheckFailed);
    }
  } catch (error) {
    if (options.format === 'json') {
      emitJsonErrorAndExit(error);
    }
    deps.handleError(error);
  }
}

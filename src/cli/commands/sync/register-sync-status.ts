import { Command, Option } from 'commander';
import { Logger } from '../../../utils/logger.js';
import type { ServiceDeps } from '../service-factory.js';
import {
  emitJsonErrorAndExit,
  parseLocaleFilter,
  resolveFormat,
  resolveLocale,
  resolveSyncConfig,
} from './sync-options.js';

interface StatusOptions {
  locale?: string;
  format?: string;
  syncConfig?: string;
}

export function registerSyncStatus(
  parent: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Command {
  return parent
    .command('status')
    .description('Show translation coverage status')
    .option('--locale <locales>', 'Filter by locale (comma-separated)')
    .addOption(
      new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'),
    )
    .option('--sync-config <path>', 'Path to .deepl-sync.yaml')
    .action((options: StatusOptions, command: Command) =>
      handleSyncStatus(options, command, deps),
    );
}

async function handleSyncStatus(
  options: StatusOptions,
  command: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Promise<void> {
  options.format = resolveFormat(options, command);
  try {
    const { loadSyncConfig } = await import('../../../sync/sync-config.js');
    const { createDefaultRegistry } = await import('../../../formats/index.js');
    const { computeSyncStatus } = await import('../../../sync/sync-status.js');

    const localeFilter = parseLocaleFilter(resolveLocale(options, command));
    const config = await loadSyncConfig(process.cwd(), {
      configPath: resolveSyncConfig(options, command),
      localeFilter,
    });
    const registry = await createDefaultRegistry();
    const status = await computeSyncStatus(config, registry);

    const locales = localeFilter
      ? status.locales.filter((l) => localeFilter.includes(l.locale))
      : status.locales;

    if (options.format === 'json') {
      process.stdout.write(JSON.stringify({ ...status, locales }, null, 2) + '\n');
    } else {
      const skippedSuffix = status.skippedKeys > 0
        ? `, ${status.skippedKeys} skipped (pipe pluralization)`
        : '';
      Logger.output(`Source: ${status.sourceLocale} (${status.totalKeys} keys${skippedSuffix})\n`);
      for (const locale of locales) {
        const bar = `${'#'.repeat(Math.floor(locale.coverage / 5))}${'.'.repeat(
          20 - Math.floor(locale.coverage / 5),
        )}`;
        Logger.output(
          `  ${locale.locale}  [${bar}] ${locale.coverage}%  (${locale.missing} missing, ${locale.outdated} outdated)`,
        );
      }
    }
  } catch (error) {
    if (options.format === 'json') {
      emitJsonErrorAndExit(error);
    }
    deps.handleError(error);
  }
}

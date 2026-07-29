import { Command, Option } from 'commander';
import { Logger } from '../../../utils/logger.js';
import { ValidationError } from '../../../utils/errors.js';
import type { ServiceDeps } from '../service-factory.js';
import {
  emitJsonErrorAndExit,
  parseLocaleFilter,
  resolveFormat,
  resolveLocale,
  resolveSyncConfig,
} from './sync-options.js';

interface ExportOptions {
  locale?: string;
  output?: string;
  overwrite?: boolean;
  syncConfig?: string;
  format?: string;
}

export function registerSyncExport(
  parent: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Command {
  return parent
    .command('export')
    .description('Export source strings to XLIFF for CAT tool handoff')
    .option('--locale <locales>', 'Filter by locale (comma-separated)')
    .option('--output <path>', 'Write to file instead of stdout')
    // Named --overwrite (not --force) because `deepl sync --force` already
    // exists as a cost-cap bypass on the parent command.
    .option('--overwrite', 'Overwrite existing --output file')
    .addOption(
      new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'),
    )
    .option('--sync-config <path>', 'Path to .deepl-sync.yaml')
    .action((options: ExportOptions, command: Command) =>
      handleSyncExport(options, command, deps),
    );
}

async function handleSyncExport(
  options: ExportOptions,
  command: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Promise<void> {
  options.format = resolveFormat(options, command);
  try {
    const { loadSyncConfig } = await import('../../../sync/sync-config.js');
    const { createDefaultRegistry } = await import('../../../formats/index.js');
    const { exportTranslations } = await import('../../../sync/sync-export.js');
    const { assertPathWithinRoot } = await import('../../../sync/sync-utils.js');
    const pathMod = await import('path');
    const fsMod = await import('fs');

    const localeFilter = parseLocaleFilter(resolveLocale(options, command));
    const config = await loadSyncConfig(process.cwd(), {
      configPath: resolveSyncConfig(options, command),
      localeFilter,
    });
    const registry = await createDefaultRegistry();
    const result = await exportTranslations(config, registry, { localeFilter });

    if (options.output) {
      const absOutput = pathMod.resolve(config.projectRoot, options.output);
      assertPathWithinRoot(absOutput, config.projectRoot);
      if (fsMod.existsSync(absOutput) && !options.overwrite) {
        throw new ValidationError(
          `Refusing to overwrite existing file ${options.output}. Use --overwrite to overwrite.`,
        );
      }
      await fsMod.promises.mkdir(pathMod.dirname(absOutput), { recursive: true });
      await fsMod.promises.writeFile(absOutput, result.content, 'utf-8');
      Logger.info(
        `Exported ${result.keys} keys from ${result.files} file(s) to ${options.output}`,
      );
    } else {
      process.stdout.write(result.content);
    }
  } catch (error) {
    if (options.format === 'json') {
      emitJsonErrorAndExit(error);
    }
    deps.handleError(error);
  }
}

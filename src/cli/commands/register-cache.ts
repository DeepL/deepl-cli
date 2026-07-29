import { Command, Option } from 'commander';
import chalk from 'chalk';
import type { ConfigService } from '../../storage/config.js';
import type { CacheService } from '../../storage/cache.js';
import { Logger } from '../../utils/logger.js';
import { ConfigError } from '../../utils/errors.js';

export function registerCache(
  program: Command,
  deps: {
    getConfigService: () => ConfigService;
    getCacheService: () => Promise<CacheService | undefined>;
    handleError: (error: unknown) => never;
  },
): void {
  const { getConfigService, getCacheService, handleError } = deps;

  async function requireCacheService(): Promise<CacheService> {
    const cacheService = await getCacheService();
    if (!cacheService) {
      throw new ConfigError(
        'Cache backend is unavailable, so cache commands cannot run.',
        'Reinstall the CLI, or run it with the Node.js version it was installed with.',
      );
    }
    return cacheService;
  }

  program
    .command('cache')
    .description('Manage translation cache')
    .addHelpText('after', `
Examples:
  $ deepl cache stats
  $ deepl cache clear --yes
  $ deepl cache clear --dry-run
  $ deepl cache enable --max-size 500M
  $ deepl cache disable
`)
    .addCommand(
      new Command('stats')
        .description('Show cache statistics')
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json', 'table']).default('text'))
        .action(async (options: { format?: string }) => {
          try {
            const { CacheCommand } = await import('./cache.js');
            const cacheCommand = new CacheCommand(await requireCacheService(), getConfigService());
            const stats = await cacheCommand.stats();
            if (options.format === 'json') {
              Logger.output(JSON.stringify(stats, null, 2));
            } else if (options.format === 'table') {
              if (!process.stdout.isTTY) {
                Logger.warn('WARN  --format table is not supported in non-TTY output; falling back to plain text');
                Logger.output(cacheCommand.formatStats(stats));
              } else {
                Logger.output(cacheCommand.formatStatsTable(stats));
              }
            } else {
              Logger.output(cacheCommand.formatStats(stats));
            }
          } catch (error) {
            handleError(error);

          }
        })
    )
    .addCommand(
      new Command('clear')
        .description('Clear all cached translations')
        .option('-y, --yes', 'Skip confirmation prompt')
        .option('--dry-run', 'Show cache stats that would be cleared without performing the operation')
        .action(async (options: { yes?: boolean; dryRun?: boolean }) => {
          try {
            if (options.dryRun) {
              const { CacheCommand } = await import('./cache.js');
              const cacheCommand = new CacheCommand(await requireCacheService(), getConfigService());
              const stats = await cacheCommand.stats();
              const totalSizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
              const lines = [
                chalk.yellow('[dry-run] No cache entries will be cleared.'),
                chalk.yellow(`[dry-run] Would clear ${stats.entries} cached entries (${totalSizeMB} MB)`),
                chalk.yellow(`[dry-run] Cache status: ${stats.enabled ? 'enabled' : 'disabled'}`),
              ];
              Logger.output(lines.join('\n'));
              return;
            }

            if (!options.yes) {
              const { confirm } = await import('../../utils/confirm.js');
              const confirmed = await confirm({ message: 'Clear all cached translations?' });
              if (!confirmed) {
                Logger.info('Aborted.');
                return;
              }
            }

            const { CacheCommand } = await import('./cache.js');
            const cacheCommand = new CacheCommand(await requireCacheService(), getConfigService());
            await cacheCommand.clear();
            Logger.success(chalk.green('\u2713 Cache cleared successfully'));
          } catch (error) {
            handleError(error);

          }
        })
    )
    .addCommand(
      new Command('enable')
        .description('Enable translation cache')
        .option('--max-size <size>', 'Maximum cache size (e.g., 100M, 1G, 500MB)')
        .action(async (options: { maxSize?: string }) => {
          try {
            let maxSizeBytes: number | undefined;

            if (options.maxSize) {
              const { parseSize } = await import('../../utils/parse-size.js');
              maxSizeBytes = parseSize(options.maxSize);
            }

            const { CacheCommand } = await import('./cache.js');
            const cacheCommand = new CacheCommand(await requireCacheService(), getConfigService());
            await cacheCommand.enable(maxSizeBytes);
            Logger.success(chalk.green('\u2713 Cache enabled'));

            if (maxSizeBytes !== undefined) {
              const { formatSize } = await import('../../utils/parse-size.js');
              Logger.info(chalk.gray(`Max size: ${formatSize(maxSizeBytes)}`));
            }
          } catch (error) {
            handleError(error);

          }
        })
    )
    .addCommand(
      new Command('disable')
        .description('Disable translation cache')
        .action(async () => {
          try {
            const { CacheCommand } = await import('./cache.js');
            const cacheCommand = new CacheCommand(await requireCacheService(), getConfigService());
            await cacheCommand.disable();
            Logger.success(chalk.green('\u2713 Cache disabled'));
          } catch (error) {
            handleError(error);

          }
        })
    );
}

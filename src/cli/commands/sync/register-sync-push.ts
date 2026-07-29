import { Command, Option } from 'commander';
import { Logger } from '../../../utils/logger.js';
import { ConfigError } from '../../../utils/errors.js';
import type { ServiceDeps } from '../service-factory.js';
import {
  emitJsonErrorAndExit,
  parseLocaleFilter,
  resolveFormat,
  resolveLocale,
  resolveSyncConfig,
} from './sync-options.js';

interface PushOptions {
  locale?: string;
  syncConfig?: string;
  format?: string;
}

export function registerSyncPush(
  parent: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Command {
  return parent
    .command('push')
    .description('Push translations to a TMS for human review')
    .option('--locale <locales>', 'Filter by locale (comma-separated)')
    .addOption(
      new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'),
    )
    .option('--sync-config <path>', 'Path to .deepl-sync.yaml')
    .addHelpText(
      'after',
      `
Requires TMS integration. Add a tms: block to .deepl-sync.yaml:

  tms:
    enabled: true
    server: https://tms.example.com
    project_id: my-project

Credentials: prefer the TMS_API_KEY (or TMS_TOKEN) env var over inlining
'api_key'/'token' in the YAML. See docs/SYNC.md#tms-rest-contract for the
full field list and REST contract.
`,
    )
    .action((options: PushOptions, command: Command) => handleSyncPush(options, command, deps));
}

async function handleSyncPush(
  options: PushOptions,
  command: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Promise<void> {
  options.format = resolveFormat(options, command);
  try {
    const { loadSyncConfig } = await import('../../../sync/sync-config.js');
    const { createTmsClient } = await import('../../../sync/tms-client.js');
    const { createDefaultRegistry } = await import('../../../formats/index.js');
    const { pushTranslations, formatSkippedSummary } = await import('../../../sync/sync-tms.js');

    const localeFilter = parseLocaleFilter(resolveLocale(options, command));
    const config = await loadSyncConfig(process.cwd(), {
      configPath: resolveSyncConfig(options, command),
      localeFilter,
    });
    if (!config.tms?.enabled) {
      throw new ConfigError(
        'TMS integration not configured',
        'Add a "tms:" block with "enabled: true" to .deepl-sync.yaml',
      );
    }

    const client = createTmsClient(config.tms);

    const registry = await createDefaultRegistry();
    const result = await pushTranslations(config, client, registry, { localeFilter });
    if (options.format === 'json') {
      process.stdout.write(JSON.stringify({ ok: true, pushed: result.pushed, skipped: result.skipped }) + '\n');
    } else {
      Logger.info(`Pushed ${result.pushed} translations to TMS${formatSkippedSummary(result.skipped)}`);
    }
  } catch (error) {
    if (options.format === 'json') {
      emitJsonErrorAndExit(error);
    }
    deps.handleError(error);
  }
}

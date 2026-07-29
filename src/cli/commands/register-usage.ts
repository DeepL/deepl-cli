import { Option, type Command } from 'commander';
import { Logger } from '../../utils/logger.js';
import { createUsageCommand, type CreateDeepLClient } from './service-factory.js';

export function registerUsage(
  program: Command,
  deps: {
    createDeepLClient: CreateDeepLClient;
    handleError: (error: unknown) => never;
  },
): void {
  const { createDeepLClient, handleError } = deps;

  program
    .command('usage')
    .description('Show API usage statistics')
    .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json', 'table']).default('text'))
    .addHelpText('after', `
Examples:
  $ deepl usage
  $ deepl usage --format json
  $ deepl usage --format table
`)
    .action(async (options: { format?: string }) => {
      try {
        const usageCommand = await createUsageCommand(createDeepLClient);

        const usage = await usageCommand.getUsage();
        if (options.format === 'json') {
          Logger.output(JSON.stringify(usage, null, 2));
        } else if (options.format === 'table') {
          if (!process.stdout.isTTY) {
            Logger.warn('WARN  --format table is not supported in non-TTY output; falling back to plain text');
            Logger.output(usageCommand.formatUsage(usage));
          } else {
            Logger.output(usageCommand.formatUsageTable(usage));
          }
        } else {
          Logger.output(usageCommand.formatUsage(usage));
        }
      } catch (error) {
        handleError(error);
      }
    });
}

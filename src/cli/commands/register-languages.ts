import { Option, type Command } from 'commander';
import chalk from 'chalk';
import type { ConfigService } from '../../storage/config.js';
import { Logger } from '../../utils/logger.js';
import { createLanguagesCommand, type CreateDeepLClient } from './service-factory.js';

export function registerLanguages(
  program: Command,
  deps: {
    getConfigService: () => ConfigService;
    createDeepLClient: CreateDeepLClient;
    handleError: (error: unknown) => never;
  },
): void {
  const { getConfigService, createDeepLClient, handleError } = deps;

  program
    .command('languages')
    .description('List supported source and target languages')
    .option('-s, --source', 'Show only source languages')
    .option('--target', 'Show only target languages')
    .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json', 'table']).default('text'))
    .addHelpText('after', `
Examples:
  $ deepl languages
  $ deepl languages --source
  $ deepl languages --target
  $ deepl languages --format json
  $ deepl languages --format table
`)
    .action(async (options: { source?: boolean; target?: boolean; format?: string }) => {
      try {
        const apiKey = getConfigService().getValue<string>('auth.apiKey');
        const envKey = process.env['DEEPL_API_KEY'];
        const hasApiKey = !!(apiKey ?? envKey);

        let client = null;
        if (hasApiKey) {
          client = await createDeepLClient();
        } else {
          Logger.warn(chalk.yellow('Note: No API key configured. Showing local language registry only.'));
          Logger.warn(chalk.yellow('Run: deepl auth set-key <your-api-key> for API-verified names.\n'));
        }

        const languagesCommand = await createLanguagesCommand(client);

        if (options.format === 'json') {
          if (options.source && !options.target) {
            const sourceLanguages = await languagesCommand.getSourceLanguages();
            Logger.output(JSON.stringify(sourceLanguages, null, 2));
          } else if (options.target && !options.source) {
            const targetLanguages = await languagesCommand.getTargetLanguages();
            Logger.output(JSON.stringify(targetLanguages, null, 2));
          } else {
            const [sourceLanguages, targetLanguages] = await Promise.all([
              languagesCommand.getSourceLanguages(),
              languagesCommand.getTargetLanguages(),
            ]);
            Logger.output(JSON.stringify({ source: sourceLanguages, target: targetLanguages }, null, 2));
          }
          return;
        }

        const useTable = options.format === 'table';
        if (useTable && !process.stdout.isTTY) {
          Logger.warn('WARN  --format table is not supported in non-TTY output; falling back to plain text');
        }
        const wantTable = useTable && process.stdout.isTTY;

        let output: string;
        if (options.source && !options.target) {
          const sourceLanguages = await languagesCommand.getSourceLanguages();
          output = wantTable
            ? languagesCommand.formatLanguagesTable(sourceLanguages, 'source')
            : languagesCommand.formatLanguages(sourceLanguages, 'source');
        } else if (options.target && !options.source) {
          const targetLanguages = await languagesCommand.getTargetLanguages();
          output = wantTable
            ? languagesCommand.formatLanguagesTable(targetLanguages, 'target')
            : languagesCommand.formatLanguages(targetLanguages, 'target');
        } else {
          const [sourceLanguages, targetLanguages] = await Promise.all([
            languagesCommand.getSourceLanguages(),
            languagesCommand.getTargetLanguages(),
          ]);
          output = wantTable
            ? languagesCommand.formatAllLanguagesTable(sourceLanguages, targetLanguages)
            : languagesCommand.formatAllLanguages(sourceLanguages, targetLanguages);
        }

        Logger.output(output);
      } catch (error) {
        handleError(error);
      }
    });
}

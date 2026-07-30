import { Command } from 'commander';
import chalk from 'chalk';
import type { ConfigService } from '../../storage/config.js';
import type { DeepLClientOptions } from '../../api/http-client.js';
import { Logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';

export function registerAuth(
  program: Command,
  deps: {
    getConfigService: () => ConfigService;
    getHttpOptions?: () => DeepLClientOptions;
    handleError: (error: unknown) => never;
  },
): void {
  const { getConfigService, getHttpOptions, handleError } = deps;

  program
    .command('auth')
    .description('Manage DeepL API authentication')
    .addHelpText('after', `
Examples:
  $ echo "YOUR_API_KEY" | deepl auth set-key --from-stdin
  $ deepl auth set-key --from-stdin < ~/.deepl-api-key
  $ deepl auth set-key YOUR_API_KEY
  $ deepl auth show
  $ deepl auth clear

Note: Prefer --from-stdin over passing the key as an argument.
Command arguments are visible to other users via process listings.
`)
    .addCommand(
      new Command('set-key')
        .description('Set your DeepL API key')
        .argument('[api-key]', 'Your DeepL API key (or pipe via stdin)')
        .option('--from-stdin', 'Read API key from stdin')
        .option('--no-verify', 'Store the key without validating it against the API (for offline or proxied networks)')
        .action(async (apiKey: string | undefined, opts: { fromStdin?: boolean; verify?: boolean }) => {
          try {
            let key = apiKey;
            if (apiKey && !opts.fromStdin) {
              Logger.warn('Passing API key as argument is deprecated (visible in ps). Use --from-stdin instead.');
            }
            if (opts.fromStdin === true || !key) {
              if (process.stdin.isTTY && !key) {
                handleError(new ValidationError('API key required: provide as argument or use --from-stdin'));
                return;
              }
              const MAX_STDIN_BYTES = 131072; // 128KB
              const chunks: Buffer[] = [];
              let totalBytes = 0;
              for await (const chunk of process.stdin) {
                const buf = chunk as Buffer;
                totalBytes += buf.length;
                if (totalBytes > MAX_STDIN_BYTES) {
                  throw new ValidationError('Input exceeds maximum size of 128KB');
                }
                chunks.push(buf);
              }
              key = Buffer.concat(chunks).toString('utf-8').trim();
            }
            const { AuthCommand } = await import('./auth.js');
            const authCommand = new AuthCommand(getConfigService(), getHttpOptions?.());
            await authCommand.setKey(key, { verify: opts.verify });
            Logger.success(
              chalk.green(
                opts.verify === false
                  ? '\u2713 API key saved without validation'
                  : '\u2713 API key saved and validated successfully',
              ),
            );
          } catch (error) {
            handleError(error);

          }
        })
    )
    .addCommand(
      new Command('show')
        .description('Show current API key (masked)')
        .action(async () => {
          try {
            const { AuthCommand } = await import('./auth.js');
            const authCommand = new AuthCommand(getConfigService());
            const key = await authCommand.getKey();
            if (key) {
              const masked = key.substring(0, 4) + '...' + key.substring(key.length - 4);
              Logger.output(chalk.blue('API Key:'), masked);
            } else {
              Logger.output(chalk.yellow('No API key set'));
            }
          } catch (error) {
            handleError(error);

          }
        })
    )
    .addCommand(
      new Command('clear')
        .description('Remove stored API key')
        .action(async () => {
          try {
            const { AuthCommand } = await import('./auth.js');
            const authCommand = new AuthCommand(getConfigService());
            await authCommand.clearKey();
            Logger.success(chalk.green('\u2713 API key removed'));
          } catch (error) {
            handleError(error);

          }
        })
    );
}

import { Command } from 'commander';
import type { ConfigService } from '../../storage/config.js';
import type { DeepLClientOptions } from '../../api/http-client.js';
import { isNoInput } from '../../utils/confirm.js';
import { ValidationError, AuthError } from '../../utils/errors.js';

export function registerInit(
  program: Command,
  deps: {
    getConfigService: () => ConfigService;
    getHttpOptions?: () => DeepLClientOptions;
    handleError: (error: unknown) => never;
  },
): void {
  const { getConfigService, getHttpOptions, handleError } = deps;

  program
    .command('init')
    .description('Interactive setup wizard for first-time configuration')
    .addHelpText('after', `
Examples:
  $ deepl init
`)
    .action(async () => {
      try {
        if (isNoInput() || !process.stdin.isTTY) {
          throw new ValidationError('init is not supported in non-interactive mode. Use deepl auth set-key <your-api-key> to configure authentication.');
        }
        const { InitCommand } = await import('./init.js');
        const initCommand = new InitCommand(getConfigService(), getHttpOptions?.());
        await initCommand.run();
      } catch (error) {
        if (error instanceof Error && error.message.includes('Authentication failed')) {
          handleError(new AuthError('Invalid API key: Authentication failed with DeepL API'));
        }
        handleError(error);
      }
    });
}

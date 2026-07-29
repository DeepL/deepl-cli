import { ConfigService } from '../../storage/config.js';
import type { DeepLClientOptions } from '../../api/http-client.js';
import { Logger } from '../../utils/logger.js';
import { resolveEndpoint } from '../../utils/resolve-endpoint.js';

const COMMON_TARGET_LANGUAGES = [
  { name: 'German (DE)', value: 'de' },
  { name: 'Spanish (ES)', value: 'es' },
  { name: 'French (FR)', value: 'fr' },
  { name: 'Italian (IT)', value: 'it' },
  { name: 'Japanese (JA)', value: 'ja' },
  { name: 'Dutch (NL)', value: 'nl' },
  { name: 'Polish (PL)', value: 'pl' },
  { name: 'Portuguese - Brazilian (PT-BR)', value: 'pt-br' },
  { name: 'Russian (RU)', value: 'ru' },
  { name: 'Chinese (ZH)', value: 'zh' },
  { name: 'English - American (EN-US)', value: 'en-us' },
  { name: 'English - British (EN-GB)', value: 'en-gb' },
  { name: 'Skip (set later)', value: '' },
] as const;

export class InitCommand {
  private config: ConfigService;
  private httpOptions: DeepLClientOptions;

  constructor(config: ConfigService, httpOptions: DeepLClientOptions = {}) {
    this.config = config;
    this.httpOptions = httpOptions;
  }

  async run(): Promise<void> {
    const { password, select } = await import('@inquirer/prompts');
    Logger.output("Welcome to DeepL CLI! Let's get you set up.\n");

    const apiKey = await password({
      message: 'Enter your DeepL API key:',
      mask: true,
      validate: (value: string) => {
        if (!value.trim())
          return 'API key is required. Get one at https://www.deepl.com/pro-api';
        return true;
      },
    });

    Logger.output('\nValidating API key...');

    const { DeepLClient } = await import('../../api/deepl-client.js');
    const configBaseUrl = this.config.getValue<string>('api.baseUrl');
    const usePro = this.config.getValue<boolean>('api.usePro');
    const baseUrl = resolveEndpoint({
      apiKey: apiKey.trim(),
      configBaseUrl,
      usePro,
    });
    const client = new DeepLClient(apiKey.trim(), { ...this.httpOptions, baseUrl });
    await client.getUsage();

    this.config.set('auth.apiKey', apiKey.trim());
    Logger.output('API key validated and saved.\n');

    const targetLang = await select({
      message: 'Choose a default target language:',
      choices: [...COMMON_TARGET_LANGUAGES],
    });

    if (targetLang) {
      this.config.set('defaults.targetLangs', [targetLang]);
      Logger.output(`\nDefault target language set to: ${targetLang}`);
    }

    Logger.output('\n---');
    Logger.output("You're all set! Here are some commands to get started:\n");
    Logger.output('  deepl translate "Hello world" --to es    Translate text');
    Logger.output('  deepl write "Check this text" --to en    Improve writing');
    Logger.output('  deepl glossary list                      List glossaries');
    Logger.output('  deepl usage                              Check API usage');
    Logger.output(
      '  deepl --help                             See all commands'
    );
    Logger.output('');
  }
}

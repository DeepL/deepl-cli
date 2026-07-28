import type { DeepLClient } from '../../api/deepl-client.js';
import type { ConfigService } from '../../storage/config.js';
import type { CacheService } from '../../storage/cache.js';
import type { DeepLClientOptions } from '../../api/http-client.js';
import type { GlossaryCommand } from './glossary.js';
import type { TmCommand } from './tm.js';
import type { AdminCommand } from './admin.js';
import type { WriteCommand } from './write.js';
import type { StyleRulesCommand } from './style-rules.js';
import type { UsageCommand } from './usage.js';
import type { TranslateCommand } from './translate.js';
import type { WatchCommand } from './watch.js';
import type { VoiceCommand } from './voice.js';
import type { DetectCommand } from './detect.js';
import type { LanguagesCommand } from './languages.js';
import type { SyncCommand } from './sync-command.js';

export type CreateDeepLClient = (overrideBaseUrl?: string) => Promise<DeepLClient>;
export type GetApiKeyAndOptions = () => { apiKey: string; options: DeepLClientOptions };

export interface ServiceDeps {
  createDeepLClient: CreateDeepLClient;
  getApiKeyAndOptions: GetApiKeyAndOptions;
  getConfigService: () => ConfigService;
  getCacheService: () => Promise<CacheService | undefined>;
  handleError: (error: unknown) => never;
}

export async function createGlossaryCommand(
  createDeepLClient: CreateDeepLClient,
): Promise<GlossaryCommand> {
  const client = await createDeepLClient();
  const { GlossaryService } = await import('../../services/glossary.js');
  const { GlossaryCommand: GlossaryCmd } = await import('./glossary.js');
  const glossaryService = new GlossaryService(client);
  return new GlossaryCmd(glossaryService);
}

export async function createTmCommand(
  createDeepLClient: CreateDeepLClient,
): Promise<TmCommand> {
  const client = await createDeepLClient();
  const { TmCommand: TmCmd } = await import('./tm.js');
  return new TmCmd(client);
}

export async function createAdminCommand(
  createDeepLClient: CreateDeepLClient,
  getApiKeyAndOptions?: GetApiKeyAndOptions,
): Promise<AdminCommand> {
  const client = await createDeepLClient();
  const { AdminService } = await import('../../services/admin.js');
  const { AdminCommand: AdminCmd } = await import('./admin.js');
  const adminService = new AdminService(client, getApiKeyAndOptions);
  return new AdminCmd(adminService);
}

export async function createWriteCommand(
  deps: Pick<ServiceDeps, 'createDeepLClient' | 'getConfigService' | 'getCacheService'>,
): Promise<WriteCommand> {
  const client = await deps.createDeepLClient();
  const { WriteService } = await import('../../services/write.js');
  const { WriteCommand: WriteCmd } = await import('./write.js');
  const configService = deps.getConfigService();
  const writeService = new WriteService(client, configService, await deps.getCacheService());
  return new WriteCmd(writeService);
}

export async function createStyleRulesCommand(
  createDeepLClient: CreateDeepLClient,
): Promise<StyleRulesCommand> {
  const client = await createDeepLClient();
  const { StyleRulesService } = await import('../../services/style-rules.js');
  const { StyleRulesCommand: StyleRulesCmd } = await import('./style-rules.js');
  const styleRulesService = new StyleRulesService(client);
  return new StyleRulesCmd(styleRulesService);
}

export async function createUsageCommand(
  createDeepLClient: CreateDeepLClient,
): Promise<UsageCommand> {
  const client = await createDeepLClient();
  const { UsageService } = await import('../../services/usage.js');
  const { UsageCommand: UsageCmd } = await import('./usage.js');
  const usageService = new UsageService(client);
  return new UsageCmd(usageService);
}

export async function createTranslateCommand(
  deps: Pick<ServiceDeps, 'createDeepLClient' | 'getConfigService' | 'getCacheService'>,
  overrideBaseUrl?: string,
): Promise<TranslateCommand> {
  const client = await deps.createDeepLClient(overrideBaseUrl);
  const { TranslationService } = await import('../../services/translation.js');
  const { DocumentTranslationService } = await import('../../services/document-translation.js');
  const { GlossaryService } = await import('../../services/glossary.js');
  const { TranslateCommand: TranslateCmd } = await import('./translate.js');
  const configService = deps.getConfigService();
  const translationService = new TranslationService(client, configService, await deps.getCacheService());
  const documentTranslationService = new DocumentTranslationService(client);
  const glossaryService = new GlossaryService(client);
  return new TranslateCmd(translationService, documentTranslationService, glossaryService, configService);
}

export async function createWatchCommand(
  deps: Pick<ServiceDeps, 'createDeepLClient' | 'getConfigService' | 'getCacheService'>,
): Promise<WatchCommand> {
  const client = await deps.createDeepLClient();
  const { TranslationService } = await import('../../services/translation.js');
  const { GlossaryService } = await import('../../services/glossary.js');
  const { WatchCommand: WatchCmd } = await import('./watch.js');
  const translationService = new TranslationService(client, deps.getConfigService(), await deps.getCacheService());
  const glossaryService = new GlossaryService(client);
  return new WatchCmd(translationService, glossaryService);
}

export async function createDetectCommand(
  createDeepLClient: CreateDeepLClient,
): Promise<DetectCommand> {
  const client = await createDeepLClient();
  const { DetectService } = await import('../../services/detect.js');
  const { DetectCommand: DetectCmd } = await import('./detect.js');
  const detectService = new DetectService(client);
  return new DetectCmd(detectService);
}

export async function createLanguagesCommand(
  client: DeepLClient | null,
): Promise<LanguagesCommand> {
  const { LanguagesService } = await import('../../services/languages.js');
  const { LanguagesCommand: LanguagesCmd } = await import('./languages.js');
  const languagesService = new LanguagesService(client);
  return new LanguagesCmd(languagesService);
}

export async function createVoiceCommand(
  getApiKeyAndOptions: GetApiKeyAndOptions,
): Promise<VoiceCommand> {
  const { apiKey, options } = getApiKeyAndOptions();
  if (options.baseUrl) {
    const { validateApiUrl } = await import('../../utils/validate-url.js');
    validateApiUrl(options.baseUrl);
  }
  const { VoiceClient } = await import('../../api/voice-client.js');
  const { VoiceService } = await import('../../services/voice.js');
  const { VoiceCommand: VoiceCmd } = await import('./voice.js');
  const voiceClient = new VoiceClient(apiKey, options);
  const voiceService = new VoiceService(voiceClient);
  return new VoiceCmd(voiceService);
}

export async function createSyncCommand(
  deps: Pick<ServiceDeps, 'createDeepLClient' | 'getConfigService' | 'getCacheService'>,
): Promise<SyncCommand> {
  const client = await deps.createDeepLClient();
  const { TranslationService } = await import('../../services/translation.js');
  const { GlossaryService } = await import('../../services/glossary.js');
  const { SyncService } = await import('../../sync/sync-service.js');
  const { SyncCommand: SyncCmd } = await import('./sync-command.js');
  const { createDefaultRegistry } = await import('../../formats/index.js');

  const configService = deps.getConfigService();
  const translationService = new TranslationService(client, configService, await deps.getCacheService());
  const glossaryService = new GlossaryService(client);
  const formatRegistry = await createDefaultRegistry();
  const syncService = new SyncService(translationService, glossaryService, formatRegistry);
  return new SyncCmd(syncService);
}

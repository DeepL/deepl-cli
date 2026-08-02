/**
 * Type-safe mock factories for test files.
 *
 * Usage:
 *   import { createMockDeepLClient, createMockConfigService } from '../helpers/mock-factories';
 *
 *   const mockClient = createMockDeepLClient({ translate: jest.fn().mockResolvedValue(...) });
 *
 * Each factory returns a jest.Mocked<T> with every public method stubbed as a jest.fn().
 * Pass a Partial override object to customise individual methods.
 */

import type { DeepLClient } from '../../src/api/deepl-client';
import type { VoiceClient } from '../../src/api/voice-client';
import type { TranslationService } from '../../src/services/translation';
import type { GlossaryService } from '../../src/services/glossary';
import type { DocumentTranslationService } from '../../src/services/document-translation';
import type { FileTranslationService } from '../../src/services/file-translation';
import type { WatchService } from '../../src/services/watch';
import type { WriteService } from '../../src/services/write';
import type { VoiceService } from '../../src/services/voice';
import type { AdminService } from '../../src/services/admin';
import type { UsageService } from '../../src/services/usage';
import type { StyleRulesService } from '../../src/services/style-rules';
import type { DetectService } from '../../src/services/detect';
import type { LanguagesService } from '../../src/services/languages';
import type { ConfigService } from '../../src/storage/config';
import type { CacheService } from '../../src/storage/cache';

// ---------------------------------------------------------------------------
// Helper type: picks only function-typed keys from T
// ---------------------------------------------------------------------------
type MockShape<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: jest.Mock;
};

// ---------------------------------------------------------------------------
// Unconfigured-mock guard: critical methods default to throwing so that tests
// which never supply explicit behavior do not silently pass against empty
// strings / empty arrays. Callers override on a per-test basis with
// `.mockResolvedValue(...)` or by passing the method in the factory overrides.
// ---------------------------------------------------------------------------
function unconfiguredAsync(methodName: string): jest.Mock {
  return jest.fn().mockImplementation(() => {
    return Promise.reject(
      new Error(
        `mock: ${methodName} was called without an explicit override. ` +
          `Supply a mockResolvedValue or factory override so the assertion is non-vacuous.`,
      ),
    );
  });
}

// ---------------------------------------------------------------------------
// DeepLClient
// ---------------------------------------------------------------------------
function deepLClientDefaults(): MockShape<DeepLClient> {
  return {
    translate: unconfiguredAsync('DeepLClient.translate'),
    translateBatch: unconfiguredAsync('DeepLClient.translateBatch'),
    getUsage: jest.fn().mockResolvedValue({ character: { count: 0, limit: 0 } }),
    getSupportedLanguages: jest.fn().mockResolvedValue([]),
    listTranslationMemories: jest.fn().mockResolvedValue([]),
    getGlossaryLanguages: jest.fn().mockResolvedValue([]),
    createGlossary: jest.fn().mockResolvedValue(null),
    listGlossaries: jest.fn().mockResolvedValue([]),
    getGlossary: jest.fn().mockResolvedValue(null),
    deleteGlossary: jest.fn().mockResolvedValue(undefined),
    getGlossaryEntries: jest.fn().mockResolvedValue(''),
    updateGlossaryEntries: jest.fn().mockResolvedValue(undefined),
    replaceGlossaryDictionary: jest.fn().mockResolvedValue(undefined),
    updateGlossary: jest.fn().mockResolvedValue(undefined),
    renameGlossary: jest.fn().mockResolvedValue(undefined),
    deleteGlossaryDictionary: jest.fn().mockResolvedValue(undefined),
    uploadDocument: jest.fn().mockResolvedValue({ documentId: '', documentKey: '' }),
    getDocumentStatus: jest.fn().mockResolvedValue({ status: 'done' }),
    downloadDocument: jest.fn().mockResolvedValue(Buffer.alloc(0)),
    improveText: jest.fn().mockResolvedValue([]),
    correctText: jest.fn().mockResolvedValue([]),
    getStyleRules: jest.fn().mockResolvedValue([]),
    createStyleRule: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 1,
      creationTime: 'c', updatedTime: 'u',
    }),
    getStyleRule: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 1,
      creationTime: 'c', updatedTime: 'u',
    }),
    updateStyleRule: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 2,
      creationTime: 'c', updatedTime: 'u',
    }),
    deleteStyleRule: jest.fn().mockResolvedValue(undefined),
    replaceConfiguredRules: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 2,
      creationTime: 'c', updatedTime: 'u',
      configuredRules: {}, customInstructions: [],
    }),
    createCustomInstruction: jest.fn().mockResolvedValue({ label: 'mock', prompt: 'mock' }),
    getCustomInstruction: jest.fn().mockResolvedValue({ label: 'mock', prompt: 'mock' }),
    updateCustomInstruction: jest.fn().mockResolvedValue({ label: 'mock', prompt: 'mock' }),
    deleteCustomInstruction: jest.fn().mockResolvedValue(undefined),
    listApiKeys: jest.fn().mockResolvedValue([]),
    createApiKey: jest.fn().mockResolvedValue({ keyId: '', label: '', creationTime: '', isDeactivated: false }),
    deactivateApiKey: jest.fn().mockResolvedValue(undefined),
    renameApiKey: jest.fn().mockResolvedValue(undefined),
    setApiKeyLimit: jest.fn().mockResolvedValue(undefined),
    getAdminUsage: jest.fn().mockResolvedValue({ totalUsage: {}, startDate: '', endDate: '', entries: [] }),
    destroy: jest.fn(),
  };
}

export function createMockDeepLClient(
  overrides: Partial<MockShape<DeepLClient>> = {},
): jest.Mocked<DeepLClient> {
  return { ...deepLClientDefaults(), ...overrides } as unknown as jest.Mocked<DeepLClient>;
}

// ---------------------------------------------------------------------------
// ConfigService
// ---------------------------------------------------------------------------
function configServiceDefaults(): MockShape<ConfigService> & { getDefaults: jest.Mock } {
  return {
    get: jest.fn().mockReturnValue({}),
    getValue: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    has: jest.fn().mockReturnValue(false),
    delete: jest.fn(),
    clear: jest.fn(),
    getDefaults: jest.fn().mockReturnValue({}),
  };
}

export function createMockConfigService(
  overrides: Partial<ReturnType<typeof configServiceDefaults>> = {},
): jest.Mocked<ConfigService> {
  return { ...configServiceDefaults(), ...overrides } as unknown as jest.Mocked<ConfigService>;
}

// ---------------------------------------------------------------------------
// CacheService
// ---------------------------------------------------------------------------
function cacheServiceDefaults(): MockShape<CacheService> {
  return {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    clear: jest.fn(),
    stats: jest.fn().mockReturnValue({ entries: 0, totalSize: 0, maxSize: 1024 * 1024 * 1024, enabled: true }),
    enable: jest.fn(),
    disable: jest.fn(),
    setMaxSize: jest.fn(),
    close: jest.fn(),
    forceCleanup: jest.fn(),
  };
}

export function createMockCacheService(
  overrides: Partial<MockShape<CacheService>> = {},
): jest.Mocked<CacheService> {
  return { ...cacheServiceDefaults(), ...overrides } as unknown as jest.Mocked<CacheService>;
}

// ---------------------------------------------------------------------------
// TranslationService
// ---------------------------------------------------------------------------
function translationServiceDefaults(): MockShape<TranslationService> {
  return {
    translate: unconfiguredAsync('TranslationService.translate'),
    translateBatch: unconfiguredAsync('TranslationService.translateBatch'),
    translateToMultiple: unconfiguredAsync('TranslationService.translateToMultiple'),
    listTranslationMemories: jest.fn().mockResolvedValue([]),
    getUsage: jest.fn().mockResolvedValue({ character: { count: 0, limit: 0 } }),
    getSupportedLanguages: jest.fn().mockResolvedValue([]),
  };
}

export function createMockTranslationService(
  overrides: Partial<MockShape<TranslationService>> = {},
): jest.Mocked<TranslationService> {
  return { ...translationServiceDefaults(), ...overrides } as unknown as jest.Mocked<TranslationService>;
}

// ---------------------------------------------------------------------------
// GlossaryService
// ---------------------------------------------------------------------------
function glossaryServiceDefaults(): MockShape<GlossaryService> {
  return {
    createGlossary: jest.fn().mockResolvedValue(null),
    createGlossaryFromTSV: jest.fn().mockResolvedValue(null),
    listGlossaries: jest.fn().mockResolvedValue([]),
    getGlossary: jest.fn().mockResolvedValue(null),
    getGlossaryByName: jest.fn().mockResolvedValue(null),
    resolveGlossaryId: jest.fn().mockRejectedValue(new Error('Glossary not found')),
    deleteGlossary: jest.fn().mockResolvedValue(undefined),
    getGlossaryEntries: jest.fn().mockResolvedValue({}),
    getGlossaryLanguages: jest.fn().mockResolvedValue([]),
    addEntry: jest.fn().mockResolvedValue(null),
    updateEntry: jest.fn().mockResolvedValue(null),
    removeEntry: jest.fn().mockResolvedValue(null),
    updateGlossary: jest.fn().mockResolvedValue(undefined),
    renameGlossary: jest.fn().mockResolvedValue(undefined),
    replaceGlossaryDictionary: jest.fn().mockResolvedValue(undefined),
    deleteGlossaryDictionary: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockGlossaryService(
  overrides: Partial<MockShape<GlossaryService>> = {},
): jest.Mocked<GlossaryService> {
  return { ...glossaryServiceDefaults(), ...overrides } as unknown as jest.Mocked<GlossaryService>;
}

// ---------------------------------------------------------------------------
// DocumentTranslationService
// ---------------------------------------------------------------------------
function documentTranslationServiceDefaults(): MockShape<DocumentTranslationService> {
  return {
    translateDocument: jest.fn().mockResolvedValue({ success: true, outputPath: '/output.pdf' }),
    isDocumentSupported: jest.fn().mockReturnValue(false),
    getSupportedFileTypes: jest.fn().mockReturnValue(['.pdf', '.docx', '.pptx']),
  };
}

export function createMockDocumentTranslationService(
  overrides: Partial<MockShape<DocumentTranslationService>> = {},
): jest.Mocked<DocumentTranslationService> {
  return { ...documentTranslationServiceDefaults(), ...overrides } as unknown as jest.Mocked<DocumentTranslationService>;
}

// ---------------------------------------------------------------------------
// FileTranslationService
// ---------------------------------------------------------------------------
function fileTranslationServiceDefaults(): MockShape<FileTranslationService> {
  return {
    translateFile: jest.fn().mockResolvedValue(undefined),
    translateFileToMultiple: unconfiguredAsync('FileTranslationService.translateFileToMultiple'),
    getSupportedFileTypes: jest.fn().mockReturnValue(['.txt', '.md', '.json', '.yaml', '.yml']),
    isSupportedFile: jest.fn().mockReturnValue(true),
  };
}

export function createMockFileTranslationService(
  overrides: Partial<MockShape<FileTranslationService>> = {},
): jest.Mocked<FileTranslationService> {
  return { ...fileTranslationServiceDefaults(), ...overrides } as unknown as jest.Mocked<FileTranslationService>;
}

// ---------------------------------------------------------------------------
// WatchService
// ---------------------------------------------------------------------------
function watchServiceDefaults(): Record<string, jest.Mock> {
  return {
    watch: jest.fn().mockReturnValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getStats: jest.fn().mockReturnValue({ isWatching: false, filesWatched: 0, translationsCount: 0, errorsCount: 0 }),
    isWatching: jest.fn().mockReturnValue(false),
    handleFileChange: jest.fn(),
  };
}

export function createMockWatchService(
  overrides: Partial<Record<string, jest.Mock>> = {},
): jest.Mocked<WatchService> {
  return { ...watchServiceDefaults(), ...overrides } as unknown as jest.Mocked<WatchService>;
}

// ---------------------------------------------------------------------------
// WriteService
// ---------------------------------------------------------------------------
function writeServiceDefaults(): MockShape<WriteService> {
  return {
    improve: unconfiguredAsync('WriteService.improve'),
    getBestImprovement: unconfiguredAsync('WriteService.getBestImprovement'),
    correct: unconfiguredAsync('WriteService.correct'),
    getBestCorrection: unconfiguredAsync('WriteService.getBestCorrection'),
  };
}

export function createMockWriteService(
  overrides: Partial<MockShape<WriteService>> = {},
): jest.Mocked<WriteService> {
  return { ...writeServiceDefaults(), ...overrides } as unknown as jest.Mocked<WriteService>;
}

// ---------------------------------------------------------------------------
// VoiceClient
// ---------------------------------------------------------------------------
function voiceClientDefaults(): Record<string, jest.Mock> {
  return {
    createSession: jest.fn(),
    createWebSocket: jest.fn(),
    sendAudioChunk: jest.fn(),
    sendEndOfSource: jest.fn(),
    reconnectSession: jest.fn(),
  };
}

export function createMockVoiceClient(
  overrides: Partial<Record<string, jest.Mock>> = {},
): jest.Mocked<VoiceClient> {
  return { ...voiceClientDefaults(), ...overrides } as unknown as jest.Mocked<VoiceClient>;
}

// ---------------------------------------------------------------------------
// VoiceService
// ---------------------------------------------------------------------------
function voiceServiceDefaults(): MockShape<VoiceService> {
  return {
    translateFile: jest.fn().mockResolvedValue({ sessionId: '', source: { lang: '', text: '', segments: [] }, targets: [] }),
    translateStdin: jest.fn().mockResolvedValue({ sessionId: '', source: { lang: '', text: '', segments: [] }, targets: [] }),
    detectContentType: jest.fn().mockReturnValue(undefined),
    validateOptions: jest.fn(),
    cancel: jest.fn(),
  };
}

export function createMockVoiceService(
  overrides: Partial<MockShape<VoiceService>> = {},
): jest.Mocked<VoiceService> {
  return { ...voiceServiceDefaults(), ...overrides } as unknown as jest.Mocked<VoiceService>;
}

// ---------------------------------------------------------------------------
// AdminService
// ---------------------------------------------------------------------------
function adminServiceDefaults(): MockShape<AdminService> {
  return {
    listApiKeys: jest.fn().mockResolvedValue([]),
    createApiKey: jest.fn().mockResolvedValue({ keyId: '', label: '', creationTime: '', isDeactivated: false }),
    deactivateApiKey: jest.fn().mockResolvedValue(undefined),
    renameApiKey: jest.fn().mockResolvedValue(undefined),
    setApiKeyLimit: jest.fn().mockResolvedValue(undefined),
    getAdminUsage: jest.fn().mockResolvedValue({ totalUsage: {}, startDate: '', endDate: '', entries: [] }),
  };
}

export function createMockAdminService(
  overrides: Partial<MockShape<AdminService>> = {},
): jest.Mocked<AdminService> {
  return { ...adminServiceDefaults(), ...overrides } as unknown as jest.Mocked<AdminService>;
}

// ---------------------------------------------------------------------------
// UsageService
// ---------------------------------------------------------------------------
function usageServiceDefaults(): MockShape<UsageService> {
  return {
    getUsage: jest.fn().mockResolvedValue({ characterCount: 0, characterLimit: 0 }),
  };
}

export function createMockUsageService(
  overrides: Partial<MockShape<UsageService>> = {},
): jest.Mocked<UsageService> {
  return { ...usageServiceDefaults(), ...overrides } as unknown as jest.Mocked<UsageService>;
}

// ---------------------------------------------------------------------------
// StyleRulesService
// ---------------------------------------------------------------------------
function styleRulesServiceDefaults(): MockShape<StyleRulesService> {
  return {
    getStyleRules: jest.fn().mockResolvedValue([]),
    createStyleRule: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 1,
      creationTime: 'c', updatedTime: 'u',
    }),
    getStyleRule: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 1,
      creationTime: 'c', updatedTime: 'u',
    }),
    updateStyleRule: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 2,
      creationTime: 'c', updatedTime: 'u',
    }),
    deleteStyleRule: jest.fn().mockResolvedValue(undefined),
    replaceConfiguredRules: jest.fn().mockResolvedValue({
      styleId: 'mock-id', name: 'mock', language: 'en', version: 2,
      creationTime: 'c', updatedTime: 'u',
      configuredRules: {}, customInstructions: [],
    }),
    createCustomInstruction: jest.fn().mockResolvedValue({ label: 'mock', prompt: 'mock' }),
    getCustomInstruction: jest.fn().mockResolvedValue({ label: 'mock', prompt: 'mock' }),
    updateCustomInstruction: jest.fn().mockResolvedValue({ label: 'mock', prompt: 'mock' }),
    deleteCustomInstruction: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockStyleRulesService(
  overrides: Partial<MockShape<StyleRulesService>> = {},
): jest.Mocked<StyleRulesService> {
  return { ...styleRulesServiceDefaults(), ...overrides } as unknown as jest.Mocked<StyleRulesService>;
}

// ---------------------------------------------------------------------------
// DetectService
// ---------------------------------------------------------------------------
function detectServiceDefaults(): MockShape<DetectService> {
  return {
    detect: jest.fn().mockResolvedValue({ detectedLanguage: 'en', languageName: 'English' }),
  };
}

export function createMockDetectService(
  overrides: Partial<MockShape<DetectService>> = {},
): jest.Mocked<DetectService> {
  return { ...detectServiceDefaults(), ...overrides } as unknown as jest.Mocked<DetectService>;
}

// ---------------------------------------------------------------------------
// LanguagesService
// ---------------------------------------------------------------------------
function languagesServiceDefaults(): MockShape<LanguagesService> & { hasClient: jest.Mock } {
  return {
    getSupportedLanguages: jest.fn().mockResolvedValue([]),
    hasClient: jest.fn().mockReturnValue(true),
  };
}

export function createMockLanguagesService(
  overrides: Partial<ReturnType<typeof languagesServiceDefaults>> = {},
): jest.Mocked<LanguagesService> {
  return { ...languagesServiceDefaults(), ...overrides } as unknown as jest.Mocked<LanguagesService>;
}

/**
 * Tests for service-factory.ts and register-* files:
 *   register-auth, register-usage, register-completion, register-style-rules
 */

 

import { Command } from 'commander';

// ── Mock chalk ──────────────────────────────────────────────────────────────
jest.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const obj: Record<string, unknown> & { level: number } = {
    level: 3,
    red: passthrough,
    green: passthrough,
    blue: passthrough,
    yellow: passthrough,
    gray: passthrough,
    bold: passthrough,
  };
  return { __esModule: true, default: obj };
});

// ── Mock Logger ─────────────────────────────────────────────────────────────
jest.mock('../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    output: jest.fn(),
    shouldShowSpinner: jest.fn(() => false),
    setQuiet: jest.fn(),
    isQuiet: jest.fn(() => false),
  },
}));

// ── Stable mock fn references ───────────────────────────────────────────────
const mockSetKey = jest.fn();
const mockGetKey = jest.fn();
const mockClearKey = jest.fn();
const mockUsageGetUsage = jest.fn();
const mockUsageFormatUsage = jest.fn();
const mockStyleRulesList = jest.fn();
const mockStyleRulesFormatList = jest.fn();
const mockStyleRulesFormatJson = jest.fn();
const mockCompletionGenerate = jest.fn();

const mockGlossaryServiceObj = { name: 'glossary-svc' };
const mockAdminServiceObj = { name: 'admin-svc' };
const mockUsageServiceObj = { name: 'usage-svc' };
const mockStyleRulesServiceObj = { name: 'style-rules-svc' };
const mockWriteServiceObj = { name: 'write-svc' };
const mockTranslationServiceObj = { name: 'translation-svc' };
const mockDocTranslationServiceObj = { name: 'doc-translation-svc' };
const mockGlossaryCmdObj = { name: 'glossary-cmd' };
const mockAdminCmdObj = { name: 'admin-cmd' };
const mockWriteCmdObj = { name: 'write-cmd' };
const mockTranslateCmdObj = { name: 'translate-cmd' };
const mockWatchCmdObj = { name: 'watch-cmd' };
const mockVoiceClientObj = { name: 'voice-client' };
const mockVoiceServiceObj = { name: 'voice-svc' };
const mockVoiceCmdObj = { name: 'voice-cmd' };

// ── Mock all dynamic-imported modules ───────────────────────────────────────
jest.mock('../../src/services/glossary', () => ({
  GlossaryService: jest.fn(),
}));
jest.mock('../../src/services/write', () => ({
  WriteService: jest.fn(),
}));
jest.mock('../../src/services/translation', () => ({
  TranslationService: jest.fn(),
}));
jest.mock('../../src/services/document-translation', () => ({
  DocumentTranslationService: jest.fn(),
}));
jest.mock('../../src/cli/commands/glossary', () => ({
  GlossaryCommand: jest.fn(),
}));
jest.mock('../../src/cli/commands/admin', () => ({
  AdminCommand: jest.fn(),
}));
jest.mock('../../src/cli/commands/write', () => ({
  WriteCommand: jest.fn(),
}));
jest.mock('../../src/cli/commands/translate', () => ({
  TranslateCommand: jest.fn(),
}));
jest.mock('../../src/cli/commands/watch', () => ({
  WatchCommand: jest.fn(),
}));
jest.mock('../../src/api/voice-client', () => ({
  VoiceClient: jest.fn(),
}));
jest.mock('../../src/services/voice', () => ({
  VoiceService: jest.fn(),
}));
jest.mock('../../src/cli/commands/voice', () => ({
  VoiceCommand: jest.fn(),
}));
jest.mock('../../src/services/admin', () => ({
  AdminService: jest.fn(),
}));
jest.mock('../../src/services/usage', () => ({
  UsageService: jest.fn(),
}));
jest.mock('../../src/services/style-rules', () => ({
  StyleRulesService: jest.fn(),
}));
jest.mock('../../src/cli/commands/style-rules', () => ({
  StyleRulesCommand: jest.fn(),
}));
jest.mock('../../src/cli/commands/usage', () => ({
  UsageCommand: jest.fn(),
}));
jest.mock('../../src/cli/commands/auth', () => ({
  AuthCommand: jest.fn(),
}));
jest.mock('../../src/cli/commands/completion', () => ({
  CompletionCommand: jest.fn(),
}));

import { Logger } from '../../src/utils/logger';
const mockLogger = Logger as jest.Mocked<typeof Logger>;

/**
 * Re-establish all mock implementations.
 * Must be called in every beforeEach because jest config has resetMocks: true.
 */
function resetAllMockImplementations() {
  // Logger
  (Logger.shouldShowSpinner as jest.Mock).mockReturnValue(false);
  (Logger.isQuiet as jest.Mock).mockReturnValue(false);

  // Auth mock functions
  mockSetKey.mockResolvedValue(undefined);
  mockGetKey.mockResolvedValue('abcd-1234-5678-wxyz');
  mockClearKey.mockResolvedValue(undefined);

  // Usage mock functions
  mockUsageGetUsage.mockResolvedValue({ characterCount: 100, characterLimit: 500000 });
  mockUsageFormatUsage.mockReturnValue('Usage: 100/500000');

  // Style rules mock functions
  mockStyleRulesList.mockResolvedValue([]);
  mockStyleRulesFormatList.mockReturnValue('no rules');
  mockStyleRulesFormatJson.mockReturnValue('[]');

  // Completion mock function
  mockCompletionGenerate.mockReturnValue('# completion script');

  // Service constructors
  const { GlossaryService } = require('../../src/services/glossary');
  GlossaryService.mockImplementation(() => mockGlossaryServiceObj);

  const { WriteService } = require('../../src/services/write');
  WriteService.mockImplementation(() => mockWriteServiceObj);

  const { TranslationService } = require('../../src/services/translation');
  TranslationService.mockImplementation(() => mockTranslationServiceObj);

  const { DocumentTranslationService } = require('../../src/services/document-translation');
  DocumentTranslationService.mockImplementation(() => mockDocTranslationServiceObj);

  const { AdminService } = require('../../src/services/admin');
  AdminService.mockImplementation(() => mockAdminServiceObj);

  const { UsageService } = require('../../src/services/usage');
  UsageService.mockImplementation(() => mockUsageServiceObj);

  const { StyleRulesService } = require('../../src/services/style-rules');
  StyleRulesService.mockImplementation(() => mockStyleRulesServiceObj);

  // Command constructors
  const { GlossaryCommand } = require('../../src/cli/commands/glossary');
  GlossaryCommand.mockImplementation(() => mockGlossaryCmdObj);

  const { AdminCommand } = require('../../src/cli/commands/admin');
  AdminCommand.mockImplementation(() => mockAdminCmdObj);

  const { WriteCommand } = require('../../src/cli/commands/write');
  WriteCommand.mockImplementation(() => mockWriteCmdObj);

  const { TranslateCommand } = require('../../src/cli/commands/translate');
  TranslateCommand.mockImplementation(() => mockTranslateCmdObj);

  const { WatchCommand } = require('../../src/cli/commands/watch');
  WatchCommand.mockImplementation(() => mockWatchCmdObj);

  const { VoiceClient } = require('../../src/api/voice-client');
  VoiceClient.mockImplementation(() => mockVoiceClientObj);

  const { VoiceService } = require('../../src/services/voice');
  VoiceService.mockImplementation(() => mockVoiceServiceObj);

  const { VoiceCommand } = require('../../src/cli/commands/voice');
  VoiceCommand.mockImplementation(() => mockVoiceCmdObj);

  const { StyleRulesCommand } = require('../../src/cli/commands/style-rules');
  StyleRulesCommand.mockImplementation(() => ({
    list: mockStyleRulesList,
    formatStyleRulesList: mockStyleRulesFormatList,
    formatStyleRulesJson: mockStyleRulesFormatJson,
  }));

  const { UsageCommand } = require('../../src/cli/commands/usage');
  UsageCommand.mockImplementation(() => ({
    getUsage: mockUsageGetUsage,
    formatUsage: mockUsageFormatUsage,
  }));

  const { AuthCommand } = require('../../src/cli/commands/auth');
  AuthCommand.mockImplementation(() => ({
    setKey: mockSetKey,
    getKey: mockGetKey,
    clearKey: mockClearKey,
  }));

  const { CompletionCommand } = require('../../src/cli/commands/completion');
  CompletionCommand.mockImplementation(() => ({
    generate: mockCompletionGenerate,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. service-factory.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('service-factory', () => {
  const mockClient = { getUsage: jest.fn(), getStyleRules: jest.fn() };
  const mockConfigService = {
    get: jest.fn().mockReturnValue({}),
    getValue: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    has: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    getDefaults: jest.fn().mockReturnValue({}),
  };
  const mockCacheService = {};
  let createDeepLClient: jest.Mock;

  beforeEach(() => {
    resetAllMockImplementations();
    createDeepLClient = jest.fn().mockResolvedValue(mockClient);
  });

  it('createGlossaryCommand should create client, GlossaryService, and GlossaryCommand', async () => {
    const { createGlossaryCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createGlossaryCommand(createDeepLClient);

    expect(createDeepLClient).toHaveBeenCalledWith();
    const { GlossaryService } = require('../../src/services/glossary');
    expect(GlossaryService).toHaveBeenCalledWith(mockClient);
    const { GlossaryCommand } = require('../../src/cli/commands/glossary');
    expect(GlossaryCommand).toHaveBeenCalledWith(mockGlossaryServiceObj);
    expect(cmd).toBe(mockGlossaryCmdObj);
  });

  it('createAdminCommand should create client, AdminService, and AdminCommand', async () => {
    const { createAdminCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createAdminCommand(createDeepLClient);

    expect(createDeepLClient).toHaveBeenCalledWith();
    const { AdminService } = require('../../src/services/admin');
    expect(AdminService).toHaveBeenCalledWith(mockClient, undefined);
    const { AdminCommand } = require('../../src/cli/commands/admin');
    expect(AdminCommand).toHaveBeenCalledWith(mockAdminServiceObj);
    expect(cmd).toBe(mockAdminCmdObj);
  });

  it('createWriteCommand should create client, WriteService, and WriteCommand', async () => {
    const { createWriteCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createWriteCommand({
      createDeepLClient,
      getConfigService: () => mockConfigService as any,
      getCacheService: () => Promise.resolve(mockCacheService) as any,
    });

    expect(createDeepLClient).toHaveBeenCalledWith();
    const { WriteService } = require('../../src/services/write');
    expect(WriteService).toHaveBeenCalledWith(mockClient, mockConfigService, mockCacheService);
    const { WriteCommand } = require('../../src/cli/commands/write');
    expect(WriteCommand).toHaveBeenCalledWith(mockWriteServiceObj);
    expect(cmd).toBe(mockWriteCmdObj);
  });

  it('createStyleRulesCommand should create client, StyleRulesService, and StyleRulesCommand', async () => {
    const { createStyleRulesCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createStyleRulesCommand(createDeepLClient);

    expect(createDeepLClient).toHaveBeenCalledWith();
    const { StyleRulesService } = require('../../src/services/style-rules');
    expect(StyleRulesService).toHaveBeenCalledWith(mockClient);
    const { StyleRulesCommand } = require('../../src/cli/commands/style-rules');
    expect(StyleRulesCommand).toHaveBeenCalledWith(mockStyleRulesServiceObj);
    expect(cmd).toHaveProperty('list');
  });

  it('createUsageCommand should create client, UsageService, and UsageCommand', async () => {
    const { createUsageCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createUsageCommand(createDeepLClient);

    expect(createDeepLClient).toHaveBeenCalledWith();
    const { UsageService } = require('../../src/services/usage');
    expect(UsageService).toHaveBeenCalledWith(mockClient);
    const { UsageCommand } = require('../../src/cli/commands/usage');
    expect(UsageCommand).toHaveBeenCalledWith(mockUsageServiceObj);
    expect(cmd).toHaveProperty('getUsage');
  });

  it('createTranslateCommand should wire up all translation dependencies', async () => {
    const getConfigService = jest.fn().mockReturnValue(mockConfigService);
    const getCacheService = jest.fn().mockResolvedValue(mockCacheService);

    const { createTranslateCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createTranslateCommand({
      createDeepLClient,
      getConfigService,
      getCacheService,
    });

    expect(createDeepLClient).toHaveBeenCalledWith(undefined);
    expect(getConfigService).toHaveBeenCalled();
    expect(getCacheService).toHaveBeenCalled();
    const { TranslationService } = require('../../src/services/translation');
    expect(TranslationService).toHaveBeenCalledWith(mockClient, mockConfigService, mockCacheService);
    const { DocumentTranslationService } = require('../../src/services/document-translation');
    expect(DocumentTranslationService).toHaveBeenCalledWith(mockClient);
    const { GlossaryService } = require('../../src/services/glossary');
    expect(GlossaryService).toHaveBeenCalledWith(mockClient);
    const { TranslateCommand } = require('../../src/cli/commands/translate');
    expect(TranslateCommand).toHaveBeenCalledWith(
      mockTranslationServiceObj,
      mockDocTranslationServiceObj,
      mockGlossaryServiceObj,
      mockConfigService,
    );
    expect(cmd).toBe(mockTranslateCmdObj);
  });

  it('createTranslateCommand should forward overrideBaseUrl', async () => {
    const { createTranslateCommand } = await import('../../src/cli/commands/service-factory');
    await createTranslateCommand(
      {
        createDeepLClient,
        getConfigService: jest.fn().mockReturnValue(mockConfigService),
        getCacheService: jest.fn().mockResolvedValue(mockCacheService),
      },
      'http://localhost:9999',
    );

    expect(createDeepLClient).toHaveBeenCalledWith('http://localhost:9999');
  });

  it('createWatchCommand should wire up translation and glossary services', async () => {
    const getConfigService = jest.fn().mockReturnValue(mockConfigService);
    const getCacheService = jest.fn().mockResolvedValue(mockCacheService);

    const { createWatchCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createWatchCommand({
      createDeepLClient,
      getConfigService,
      getCacheService,
    });

    expect(createDeepLClient).toHaveBeenCalledWith();
    const { TranslationService } = require('../../src/services/translation');
    expect(TranslationService).toHaveBeenCalledWith(mockClient, mockConfigService, mockCacheService);
    const { GlossaryService } = require('../../src/services/glossary');
    expect(GlossaryService).toHaveBeenCalledWith(mockClient);
    const { WatchCommand } = require('../../src/cli/commands/watch');
    expect(WatchCommand).toHaveBeenCalledWith(mockTranslationServiceObj, mockGlossaryServiceObj);
    expect(cmd).toBe(mockWatchCmdObj);
  });

  it('createVoiceCommand should wire up VoiceClient, VoiceService, and VoiceCommand', async () => {
    const getApiKeyAndOptions = jest.fn().mockReturnValue({ apiKey: 'test-key', options: { usePro: true } });
    const { createVoiceCommand } = await import('../../src/cli/commands/service-factory');
    const cmd = await createVoiceCommand(getApiKeyAndOptions);

    expect(getApiKeyAndOptions).toHaveBeenCalled();
    const { VoiceClient } = require('../../src/api/voice-client');
    expect(VoiceClient).toHaveBeenCalledWith('test-key', { usePro: true });
    const { VoiceService } = require('../../src/services/voice');
    expect(VoiceService).toHaveBeenCalledWith(mockVoiceClientObj);
    const { VoiceCommand } = require('../../src/cli/commands/voice');
    expect(VoiceCommand).toHaveBeenCalledWith(mockVoiceServiceObj);
    expect(cmd).toBe(mockVoiceCmdObj);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. register-auth.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('registerAuth', () => {
  const mockConfigService = {
    get: jest.fn(),
    getValue: jest.fn(),
    set: jest.fn(),
    has: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    getDefaults: jest.fn(),
  };

  let program: Command;
  let handleError: jest.Mock;
  let getConfigService: jest.Mock;

  beforeEach(() => {
    resetAllMockImplementations();

    program = new Command();
    program.exitOverride();
    handleError = jest.fn((err: unknown) => {
      throw err;
    });
    getConfigService = jest.fn().mockReturnValue(mockConfigService);
  });

  async function loadAndRegister() {
    const { registerAuth } = await import('../../src/cli/commands/register-auth');
    registerAuth(program, { getConfigService, handleError } as any);
  }

  it('should register auth command with set-key, show, and clear subcommands', async () => {
    await loadAndRegister();

    const authCmd = program.commands.find((c) => c.name() === 'auth');
    expect(authCmd).toBeInstanceOf(Command);

    const subNames = authCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('set-key');
    expect(subNames).toContain('show');
    expect(subNames).toContain('clear');
  });

  it('auth show should display masked key on stdout when key exists', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'auth', 'show']);

    expect(mockLogger.output).toHaveBeenCalled();
    const call = mockLogger.output.mock.calls[0]!;
    expect(call[1]).toContain('abcd');
    expect(call[1]).toContain('wxyz');
  });

  it('auth show should display "No API key set" when key is null', async () => {
    mockGetKey.mockResolvedValue(null);

    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'auth', 'show']);

    expect(mockLogger.output).toHaveBeenCalledWith(expect.stringContaining('No API key set'));
  });

  it('auth set-key should save and report success', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'auth', 'set-key', 'my-api-key-12345']);

    expect(mockSetKey).toHaveBeenCalledWith('my-api-key-12345', { verify: true });
    expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining('API key saved'));
  });

  it('auth set-key should call handleError on failure', async () => {
    const setKeyError = new Error('Validation failed');
    mockSetKey.mockRejectedValue(setKeyError);

    await loadAndRegister();
    await expect(
      program.parseAsync(['node', 'test', 'auth', 'set-key', 'bad-key']),
    ).rejects.toThrow('Validation failed');

    expect(handleError).toHaveBeenCalledWith(setKeyError);
  });

  it('auth clear should remove key and report success', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'auth', 'clear']);

    expect(mockClearKey).toHaveBeenCalled();
    expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining('API key removed'));
  });

  it('auth clear should call handleError on failure', async () => {
    const clearError = new Error('Config write failure');
    mockClearKey.mockRejectedValue(clearError);

    await loadAndRegister();
    await expect(
      program.parseAsync(['node', 'test', 'auth', 'clear']),
    ).rejects.toThrow('Config write failure');

    expect(handleError).toHaveBeenCalledWith(clearError);
  });

  it('auth show should call handleError on failure', async () => {
    const showError = new Error('Read failure');
    mockGetKey.mockRejectedValue(showError);

    await loadAndRegister();
    await expect(
      program.parseAsync(['node', 'test', 'auth', 'show']),
    ).rejects.toThrow('Read failure');

    expect(handleError).toHaveBeenCalledWith(showError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. register-usage.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('registerUsage', () => {
  let program: Command;
  let handleError: jest.Mock;
  let createDeepLClient: jest.Mock;

  beforeEach(() => {
    resetAllMockImplementations();

    program = new Command();
    program.exitOverride();
    handleError = jest.fn((err: unknown) => {
      throw err;
    });
    createDeepLClient = jest.fn().mockResolvedValue({});
  });

  async function loadAndRegister() {
    const { registerUsage } = await import('../../src/cli/commands/register-usage');
    registerUsage(program, { createDeepLClient, handleError } as any);
  }

  it('usage should fetch and display formatted output', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'usage']);

    expect(mockUsageGetUsage).toHaveBeenCalled();
    expect(mockUsageFormatUsage).toHaveBeenCalledWith({ characterCount: 100, characterLimit: 500000 });
    expect(mockLogger.output).toHaveBeenCalledWith('Usage: 100/500000');
  });

  it('usage should call handleError on failure', async () => {
    const usageError = new Error('API unavailable');
    mockUsageGetUsage.mockRejectedValue(usageError);

    await loadAndRegister();
    await expect(
      program.parseAsync(['node', 'test', 'usage']),
    ).rejects.toThrow('API unavailable');

    expect(handleError).toHaveBeenCalledWith(usageError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. register-completion.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('registerCompletion', () => {
  let program: Command;
  let handleError: jest.Mock;

  beforeEach(() => {
    resetAllMockImplementations();

    program = new Command();
    program.exitOverride();
    handleError = jest.fn((err: unknown) => {
      throw err;
    });
  });

  async function loadAndRegister() {
    const { registerCompletion } = await import('../../src/cli/commands/register-completion');
    registerCompletion(program, { handleError } as any);
  }

  it.each(['bash', 'zsh', 'fish'])('should generate completion script for %s', async (shell) => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'completion', shell]);

    expect(mockCompletionGenerate).toHaveBeenCalledWith(shell);
    expect(mockLogger.output).toHaveBeenCalledWith('# completion script');
  });

  it('should handle case-insensitive shell names', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'completion', 'BASH']);

    expect(mockCompletionGenerate).toHaveBeenCalledWith('bash');
    expect(mockLogger.output).toHaveBeenCalledWith('# completion script');
  });

  it('should call handleError for unsupported shell', async () => {
    await loadAndRegister();
    await expect(
      program.parseAsync(['node', 'test', 'completion', 'powershell']),
    ).rejects.toThrow('Unsupported shell');

    expect(handleError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Unsupported shell') }),
    );
  });

  it('should mention supported shells in error for unsupported shell', async () => {
    expect.assertions(3);
    await loadAndRegister();

    try {
      await program.parseAsync(['node', 'test', 'completion', 'ksh']);
    } catch {
      // expected
    }

    const errorArg = handleError.mock.calls[0][0] as Error;
    expect(errorArg.message).toContain('bash');
    expect(errorArg.message).toContain('zsh');
    expect(errorArg.message).toContain('fish');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. register-style-rules.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('registerStyleRules', () => {
  let program: Command;
  let handleError: jest.Mock;
  let createDeepLClient: jest.Mock;

  beforeEach(() => {
    resetAllMockImplementations();

    program = new Command();
    program.exitOverride();
    handleError = jest.fn((err: unknown) => {
      throw err;
    });
    createDeepLClient = jest.fn().mockResolvedValue({});
  });

  async function loadAndRegister() {
    const { registerStyleRules } = await import('../../src/cli/commands/register-style-rules');
    registerStyleRules(program, { createDeepLClient, handleError } as any);
  }

  it('style-rules list should display plain text by default', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'style-rules', 'list']);

    expect(mockStyleRulesList).toHaveBeenCalled();
    expect(mockStyleRulesFormatList).toHaveBeenCalledWith([]);
    expect(mockLogger.output).toHaveBeenCalledWith('no rules');
  });

  it('style-rules list --format json should display JSON output', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'style-rules', 'list', '--format', 'json']);

    expect(mockStyleRulesList).toHaveBeenCalled();
    expect(mockStyleRulesFormatJson).toHaveBeenCalledWith([]);
    expect(mockLogger.output).toHaveBeenCalledWith('[]');
  });

  it('style-rules list --detailed should pass detailed option', async () => {
    await loadAndRegister();
    await program.parseAsync(['node', 'test', 'style-rules', 'list', '--detailed']);

    expect(mockStyleRulesList).toHaveBeenCalledWith(
      expect.objectContaining({ detailed: true }),
    );
  });

  it('style-rules list should pass pagination options', async () => {
    await loadAndRegister();
    await program.parseAsync([
      'node', 'test', 'style-rules', 'list',
      '--page', '2',
      '--page-size', '10',
    ]);

    expect(mockStyleRulesList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });

  it('style-rules list should call handleError on failure', async () => {
    const apiError = new Error('Pro API required');
    mockStyleRulesList.mockRejectedValue(apiError);

    await loadAndRegister();
    await expect(
      program.parseAsync(['node', 'test', 'style-rules', 'list']),
    ).rejects.toThrow('Pro API required');

    expect(handleError).toHaveBeenCalledWith(apiError);
  });
});

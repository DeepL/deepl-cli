/**
 * Tests for the init setup wizard.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import nock from 'nock';
import { ConfigService } from '../../src/storage/config';

const mockInput = jest.fn<Promise<string>, []>();
const mockPassword = jest.fn<Promise<string>, [unknown]>();
const mockSelect = jest.fn<Promise<string>, []>();

jest.mock('@inquirer/prompts', () => ({
  input: (...args: unknown[]) => mockInput(...(args as [])),
  password: (...args: unknown[]) => mockPassword(...(args as [unknown])),
  select: (...args: unknown[]) => mockSelect(...(args as [])),
}));

describe('InitCommand', () => {
  let testConfigDir: string;
  let configService: ConfigService;
  const baseUrl = 'https://api.deepl.com';

  beforeEach(() => {
    testConfigDir = path.join(os.tmpdir(), `.deepl-cli-test-init-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testConfigDir, { recursive: true });
    const configPath = path.join(testConfigDir, 'config.json');
    configService = new ConfigService(configPath);
    nock.cleanAll();
    mockInput.mockReset();
    mockPassword.mockReset();
    mockSelect.mockReset();
  });

  afterEach(() => {
    nock.cleanAll();
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it('should save API key after validation', async () => {
    mockPassword.mockResolvedValueOnce('test-api-key-123');
    mockSelect.mockResolvedValueOnce('');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    expect(configService.getValue('auth.apiKey')).toBe('test-api-key-123');
  });

  it('should save default target language when selected', async () => {
    mockPassword.mockResolvedValueOnce('test-api-key-123');
    mockSelect.mockResolvedValueOnce('de');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    expect(configService.getValue('defaults.targetLangs')).toEqual(['de']);
  });

  it('should not set target language when Skip is selected', async () => {
    mockPassword.mockResolvedValueOnce('test-api-key-123');
    mockSelect.mockResolvedValueOnce('');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    expect(configService.getValue('defaults.targetLangs')).toEqual([]);
  });

  it('should throw on invalid API key', async () => {
    mockPassword.mockResolvedValueOnce('bad-key');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(403, { message: 'Forbidden' });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await expect(cmd.run()).rejects.toThrow('Authentication failed');
  });

  it('should trim whitespace from API key', async () => {
    mockPassword.mockResolvedValueOnce('  test-api-key-123  ');
    mockSelect.mockResolvedValueOnce('');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    expect(configService.getValue('auth.apiKey')).toBe('test-api-key-123');
  });

  it('should prompt for the API key with a masked password prompt', async () => {
    mockPassword.mockResolvedValueOnce('test-api-key-123');
    mockSelect.mockResolvedValueOnce('');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    expect(mockPassword).toHaveBeenCalledWith(
      expect.objectContaining({ mask: true })
    );
    expect(mockInput).not.toHaveBeenCalled();
  });

  it('should reject blank input in the API key prompt validation', async () => {
    mockPassword.mockResolvedValueOnce('test-api-key-123');
    mockSelect.mockResolvedValueOnce('');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    const promptConfig = mockPassword.mock.calls[0]?.[0] as {
      validate?: (value: string) => string | boolean;
    };
    expect(promptConfig.validate?.('   ')).toMatch(/API key is required/);
    expect(promptConfig.validate?.('valid-key')).toBe(true);
  });

  it('should apply HTTP client options to the key-validation client', async () => {
    mockPassword.mockResolvedValueOnce('test-api-key-123');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(503, { message: 'Service unavailable' })
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService, { maxRetries: 0 });

    // With maxRetries: 0 the first 503 is fatal; the default retry policy
    // would have retried into the queued 200 and succeeded.
    await expect(cmd.run()).rejects.toThrow();
    expect(configService.getValue('auth.apiKey')).toBeUndefined();
  });

  it('should validate :fx key against api-free.deepl.com', async () => {
    mockPassword.mockResolvedValueOnce('test-init-key:fx');
    mockSelect.mockResolvedValueOnce('');

    const scope = nock('https://api-free.deepl.com')
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    expect(scope.isDone()).toBe(true);
    expect(configService.getValue('auth.apiKey')).toBe('test-init-key:fx');
  });
});

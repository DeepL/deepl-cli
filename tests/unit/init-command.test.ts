/**
 * Tests for the init setup wizard.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import nock from 'nock';
import { ConfigService } from '../../src/storage/config';

const mockInput = jest.fn<Promise<string>, []>();
const mockSelect = jest.fn<Promise<string>, []>();

jest.mock('@inquirer/prompts', () => ({
  input: (...args: unknown[]) => mockInput(...(args as [])),
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
    mockSelect.mockReset();
  });

  afterEach(() => {
    nock.cleanAll();
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it('should save API key after validation', async () => {
    mockInput.mockResolvedValueOnce('test-api-key-123');
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
    mockInput.mockResolvedValueOnce('test-api-key-123');
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
    mockInput.mockResolvedValueOnce('test-api-key-123');
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
    mockInput.mockResolvedValueOnce('bad-key');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(403, { message: 'Forbidden' });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await expect(cmd.run()).rejects.toThrow('Authentication failed');
  });

  it('should trim whitespace from API key', async () => {
    mockInput.mockResolvedValueOnce('  test-api-key-123  ');
    mockSelect.mockResolvedValueOnce('');

    nock(baseUrl)
      .get('/v2/usage')
      .reply(200, { character_count: 0, character_limit: 500000 });

    const { InitCommand } = await import('../../src/cli/commands/init');
    const cmd = new InitCommand(configService);
    await cmd.run();

    expect(configService.getValue('auth.apiKey')).toBe('test-api-key-123');
  });

  it('should validate :fx key against api-free.deepl.com', async () => {
    mockInput.mockResolvedValueOnce('test-init-key:fx');
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

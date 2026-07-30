/**
 * Tests for register-init command registration
 */

import { Command } from 'commander';
import { registerInit } from '../../src/cli/commands/register-init';
import { InitCommand } from '../../src/cli/commands/init';
import type { ConfigService } from '../../src/storage/config';

jest.mock('../../src/cli/commands/init', () => ({
  InitCommand: jest.fn(),
}));

describe('registerInit', () => {
  const realIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    (InitCommand as jest.Mock).mockImplementation(() => ({
      run: jest.fn().mockResolvedValue(undefined),
    }));
    // The wizard requires an interactive terminal; jest workers have none, so
    // the tests that reach it declare one explicitly.
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    process.stdin.isTTY = realIsTTY;
  });

  it('should have the correct description', () => {
    const program = new Command();
    const deps = {
      getConfigService: jest.fn(),
      handleError: jest.fn() as jest.Mock & ((error: unknown) => never),
    };

    registerInit(program, deps);

    const initCmd = program.commands.find((cmd) => cmd.name() === 'init');
    expect(initCmd?.description()).toContain('setup wizard');
  });

  it('should thread getHttpOptions into InitCommand', async () => {
    const program = new Command();
    program.exitOverride();
    const configService = {} as ConfigService;

    registerInit(program, {
      getConfigService: () => configService,
      getHttpOptions: () => ({ timeout: 42, maxRetries: 2 }),
      handleError: ((error: unknown) => { throw error; }),
    });

    await program.parseAsync(['node', 'deepl', 'init']);

    expect(InitCommand).toHaveBeenCalledWith(configService, { timeout: 42, maxRetries: 2 });
  });

  it('should construct InitCommand without options when getHttpOptions is absent', async () => {
    const program = new Command();
    program.exitOverride();
    const configService = {} as ConfigService;

    registerInit(program, {
      getConfigService: () => configService,
      handleError: ((error: unknown) => { throw error; }),
    });

    await program.parseAsync(['node', 'deepl', 'init']);

    expect(InitCommand).toHaveBeenCalledWith(configService, undefined);
  });

  it('should refuse to start the wizard when stdin is not a terminal', async () => {
    process.stdin.isTTY = false;
    const program = new Command();
    program.exitOverride();
    const handleError = jest.fn() as jest.Mock & ((error: unknown) => never);

    registerInit(program, {
      getConfigService: () => ({}) as ConfigService,
      handleError,
    });

    await program.parseAsync(['node', 'deepl', 'init']);

    expect(InitCommand).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('not supported in non-interactive mode'),
      }),
    );
  });
});

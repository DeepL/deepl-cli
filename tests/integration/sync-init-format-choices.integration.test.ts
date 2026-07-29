/**
 * Integration test: asserts that the `--file-format` choices on
 * `deepl sync init` match the canonical format keys exposed by the default
 * {@link FormatRegistry}. The choices are populated lazily (via a
 * preSubcommand hook) so startup does not load every format parser; these
 * tests dispatch the subcommand and then verify parity and enforcement.
 */

import { Command } from 'commander';
import { registerSync } from '../../src/cli/commands/register-sync';
import {
  SUPPORTED_FORMAT_KEYS,
  createDefaultRegistry,
} from '../../src/formats';
import type { ServiceDeps } from '../../src/cli/commands/service-factory';

function makeDeps(): ServiceDeps {
  const handleError = jest.fn();
  return {
    createDeepLClient: jest.fn(),
    getApiKeyAndOptions: jest.fn(),
    getConfigService: jest.fn(),
    getCacheService: jest.fn(),
    handleError: handleError as unknown as ServiceDeps['handleError'],
  };
}

function findFileFormatChoices(program: Command): readonly string[] | undefined {
  const syncCmd = program.commands.find((c) => c.name() === 'sync');
  const initCmd = syncCmd?.commands.find((c) => c.name() === 'init');
  const fileFormatOpt = initCmd?.options.find((o) => o.long === '--file-format');
  return fileFormatOpt?.argChoices;
}

function buildProgram(capture?: { out: string[] }): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => capture?.out.push(str),
    writeErr: () => {},
  });
  registerSync(program, makeDeps());
  return program;
}

describe('deepl sync init --file-format choices mirror the format registry', () => {
  it('populates exactly the canonical SUPPORTED_FORMAT_KEYS once the subcommand dispatches', async () => {
    const capture = { out: [] as string[] };
    const program = buildProgram(capture);

    await expect(
      program.parseAsync(['sync', 'init', '--help'], { from: 'user' })
    ).rejects.toMatchObject({ code: 'commander.helpDisplayed' });

    const choices = findFileFormatChoices(program);
    expect(choices).toBeDefined();
    expect([...choices!].sort()).toEqual([...SUPPORTED_FORMAT_KEYS].sort());

    const help = capture.out.join('');
    expect(help).toContain('--file-format');
    expect(help).toContain('json');
  });

  it('matches the config keys of every parser the registry loads', async () => {
    const program = buildProgram();
    await expect(
      program.parseAsync(['sync', 'init', '--help'], { from: 'user' })
    ).rejects.toMatchObject({ code: 'commander.helpDisplayed' });

    const choices = findFileFormatChoices(program);
    const registry = await createDefaultRegistry();
    expect([...choices!].sort()).toEqual(registry.getFormatKeys().sort());
  });

  it('rejects a --file-format value outside the registry keys', async () => {
    const program = buildProgram();
    await expect(
      program.parseAsync(['sync', 'init', '--file-format', 'bogus'], { from: 'user' })
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
  });
});

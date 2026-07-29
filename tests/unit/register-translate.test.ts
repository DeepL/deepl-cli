jest.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const mockChalk: Record<string, unknown> & { level: number } = {
    level: 3,
    red: passthrough,
    green: passthrough,
    blue: passthrough,
    yellow: passthrough,
    gray: passthrough,
    bold: passthrough,
  };
  return { __esModule: true, default: mockChalk };
});

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    success: jest.fn(),
    output: jest.fn(),
    error: jest.fn(),
  },
}));

import { Command, Option } from 'commander';
import { registerTranslate } from '../../src/cli/commands/register-translate';
import { ValidationError } from '../../src/utils/errors';

type Deps = {
  handleError: jest.Mock;
  getConfigService: jest.Mock;
  getApiKeyOrThrow: jest.Mock;
};

function setupProgram(): { program: Command; deps: Deps } {
  const program = new Command();
  const deps: Deps = {
    handleError: jest.fn(),
    getConfigService: jest.fn().mockReturnValue({
      getValue: jest.fn().mockReturnValue(undefined),
    }),
    getApiKeyOrThrow: jest.fn(),
  };
  registerTranslate(program, deps as unknown as Parameters<typeof registerTranslate>[1]);
  return { program, deps };
}

function getOption(program: Command, long: string): Option {
  const translateCmd = program.commands.find(c => c.name() === 'translate')!;
  return translateCmd.options.find(o => o.long === long)!;
}

describe('registerTranslate', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  describe('alias', () => {
    it('registers t as an alias of translate', () => {
      const translateCmd = program.commands.find(c => c.name() === 'translate')!;
      expect(translateCmd.aliases()).toContain('t');
    });

    it('shows the alias in help output', () => {
      const translateCmd = program.commands.find(c => c.name() === 'translate')!;
      let helpOutput = '';
      translateCmd.configureOutput({ writeOut: (str: string) => { helpOutput += str; } });
      translateCmd.outputHelp();
      expect(helpOutput).toContain('translate|t');
    });
  });

  describe('--output-format option', () => {
    it('should only accept docx as a valid choice', () => {
      const translateCmd = program.commands.find(c => c.name() === 'translate')!;
      const outputFormatOpt = translateCmd.options.find(o => o.long === '--output-format')!;
      expect(outputFormatOpt.argChoices).toEqual(['docx']);
    });

    it('should have correct help example showing PDF to DOCX conversion', () => {
      const translateCmd = program.commands.find(c => c.name() === 'translate')!;
      let helpOutput = '';
      translateCmd.configureOutput({ writeOut: (str: string) => { helpOutput += str; } });
      translateCmd.outputHelp();
      expect(helpOutput).toContain('report.pdf --to de --output-format docx');
      expect(helpOutput).not.toContain('report.docx --to de --output-format pdf');
    });
  });

  describe('translation-memory flag registration', () => {
    it('registers --translation-memory with the expected synopsis', () => {
      const opt = getOption(program, '--translation-memory');
      expect(opt).toBeDefined();
      expect(opt.description).toContain('forces quality_optimized model');
    });

    it('registers --tm-threshold with the expected synopsis', () => {
      const opt = getOption(program, '--tm-threshold');
      expect(opt).toBeDefined();
      expect(opt.description).toContain('requires --translation-memory');
      expect(opt.description).toContain('default 75');
    });
  });

  describe('--tm-threshold strict coercer', () => {
    const coercerOf = (p: Command): (raw: string) => number => {
      const opt = getOption(p, '--tm-threshold');
      const parseArg = (opt as unknown as {
        parseArg: (raw: string, prev: number) => number;
      }).parseArg;
      return (raw: string) => parseArg(raw, 0);
    };

    it.each([
      ['0', 0],
      ['100', 100],
      ['-1', -1],
      ['101', 101],
      ['80', 80],
    ])('accepts integer string %s and parses to %s', (raw, expected) => {
      expect(coercerOf(program)(raw)).toBe(expected);
    });

    it.each([
      ['80abc'],
      ['0x40'],
      ['1e2'],
      ['50.5'],
      [''],
      ['abc'],
    ])('rejects non-integer string %p with ValidationError', (raw) => {
      expect(() => coercerOf(program)(raw)).toThrow(ValidationError);
    });
  });

  describe('action-handler validation (before dry-run)', () => {
    const baseArgs = (extra: string[]): string[] =>
      ['node', 'cli', 'translate', 'hello', '--to', 'de', '--dry-run', ...extra];

    it('orphan --tm-threshold throws ValidationError (exit 6)', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs(['--tm-threshold', '80']));
      expect(deps.handleError).toHaveBeenCalledTimes(1);
      const err = deps.handleError.mock.calls[0]![0] as ValidationError;
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toContain('--tm-threshold requires --translation-memory');
      expect(err.exitCode).toBe(6);
    });

    it('rejects threshold 101 via range guard (exit 6 with suggestion)', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs(['--translation-memory', 'my-tm', '--tm-threshold', '101']));
      expect(deps.handleError).toHaveBeenCalledTimes(1);
      const err = deps.handleError.mock.calls[0]![0] as ValidationError;
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toContain('got: 101');
      expect(err.suggestion).toBe(
        'Use a value between 0 and 100, or omit --tm-threshold to use the default (75).',
      );
    });

    it('rejects threshold -1 via range guard', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs(['--translation-memory', 'my-tm', '--tm-threshold', '-1']));
      expect(deps.handleError).toHaveBeenCalledTimes(1);
      const err = deps.handleError.mock.calls[0]![0] as ValidationError;
      expect(err.message).toContain('got: -1');
    });

    it('accepts threshold 0 (boundary)', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs(['--translation-memory', 'my-tm', '--tm-threshold', '0']));
      expect(deps.handleError).not.toHaveBeenCalled();
    });

    it('accepts threshold 100 (boundary)', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs(['--translation-memory', 'my-tm', '--tm-threshold', '100']));
      expect(deps.handleError).not.toHaveBeenCalled();
    });

    it('rejects --translation-memory with --model-type latency_optimized', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs([
        '--translation-memory', 'my-tm',
        '--model-type', 'latency_optimized',
      ]));
      expect(deps.handleError).toHaveBeenCalledTimes(1);
      const err = deps.handleError.mock.calls[0]![0] as ValidationError;
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toContain('requires quality_optimized model type');
      expect(err.suggestion).toContain('Remove --model-type');
    });

    it('rejects --translation-memory with --model-type prefer_quality_optimized', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs([
        '--translation-memory', 'my-tm',
        '--model-type', 'prefer_quality_optimized',
      ]));
      expect(deps.handleError).toHaveBeenCalledTimes(1);
      const err = deps.handleError.mock.calls[0]![0] as ValidationError;
      expect(err.message).toContain('requires quality_optimized model type');
    });

    it('accepts --translation-memory with --model-type quality_optimized', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs([
        '--translation-memory', 'my-tm',
        '--model-type', 'quality_optimized',
      ]));
      expect(deps.handleError).not.toHaveBeenCalled();
    });

    it('accepts --translation-memory alone (no --model-type)', async () => {
      const { program: p, deps } = setupProgram();
      await p.parseAsync(baseArgs(['--translation-memory', 'my-tm']));
      expect(deps.handleError).not.toHaveBeenCalled();
    });
  });

  describe('dry-run block', () => {
    const Logger = jest.requireMock('../../src/utils/logger').Logger as {
      output: jest.Mock;
    };

    beforeEach(() => {
      Logger.output.mockClear();
    });

    it('emits translation-memory, threshold, and forced-model lines when TM set', async () => {
      const { program: p } = setupProgram();
      await p.parseAsync([
        'node', 'cli', 'translate', 'hello',
        '--to', 'de', '--dry-run',
        '--translation-memory', 'my-tm',
        '--tm-threshold', '80',
      ]);
      const out = Logger.output.mock.calls.map(c => c[0]).join('\n');
      expect(out).toContain('[dry-run] Translation memory: my-tm');
      expect(out).toContain('[dry-run] Match threshold: 80');
      expect(out).toContain('[dry-run] Model: quality_optimized (forced by --translation-memory)');
    });

    it('uses default threshold 75 when --tm-threshold not provided', async () => {
      const { program: p } = setupProgram();
      await p.parseAsync([
        'node', 'cli', 'translate', 'hello',
        '--to', 'de', '--dry-run',
        '--translation-memory', 'my-tm',
      ]);
      const out = Logger.output.mock.calls.map(c => c[0]).join('\n');
      expect(out).toContain('[dry-run] Match threshold: 75');
    });

    it('does not emit translation-memory lines when flag absent', async () => {
      const { program: p } = setupProgram();
      await p.parseAsync([
        'node', 'cli', 'translate', 'hello',
        '--to', 'de', '--dry-run',
      ]);
      const out = Logger.output.mock.calls.map(c => c[0]).join('\n');
      expect(out).not.toContain('[dry-run] Translation memory');
      expect(out).not.toContain('[dry-run] Match threshold');
    });
  });
});

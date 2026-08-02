import { Command } from 'commander';

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

const mockExistsSync = jest.fn().mockReturnValue(false);
jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

const mockWriteFile = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/utils/atomic-write', () => ({
  atomicWriteFile: (...args: unknown[]) => mockWriteFile(...args),
  atomicWriteFileSync: jest.fn(),
}));

const mockWriteCommand = {
  improve: jest.fn(),
  improveFile: jest.fn(),
  checkText: jest.fn(),
  checkFile: jest.fn(),
  autoFixFile: jest.fn(),
  improveWithDiff: jest.fn(),
  improveFileWithDiff: jest.fn(),
  improveInteractive: jest.fn(),
  improveFileInteractive: jest.fn(),
};

const mockCreateWriteCommand = jest.fn();
jest.mock('../../src/cli/commands/service-factory', () => ({
  createWriteCommand: (...args: unknown[]) => mockCreateWriteCommand(...args),
}));

import { registerCorrect } from '../../src/cli/commands/register-correct';
import { ValidationError } from '../../src/utils/errors';
import { Logger } from '../../src/utils/logger';

describe('registerCorrect', () => {
  let program: Command;
  const handleError = jest.fn() as jest.Mock & ((error: unknown) => never);
  let createDeepLClient: jest.Mock;
  let getConfigService: jest.Mock;
  let getCacheService: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    mockCreateWriteCommand.mockResolvedValue(mockWriteCommand);
    program = new Command();
    program.exitOverride();
    createDeepLClient = jest.fn();
    getConfigService = jest.fn();
    getCacheService = jest.fn();
    registerCorrect(program, { createDeepLClient, getConfigService, getCacheService, handleError });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  describe('registration', () => {
    it('registers correct with c as an alias', () => {
      const correctCmd = program.commands.find(c => c.name() === 'correct')!;
      expect(correctCmd).toBeDefined();
      expect(correctCmd.aliases()).toContain('c');
    });

    it('does not register --style or --tone', () => {
      const correctCmd = program.commands.find(c => c.name() === 'correct')!;
      const longFlags = correctCmd.options.map(o => o.long);
      expect(longFlags).not.toContain('--style');
      expect(longFlags).not.toContain('--tone');
      expect(longFlags).toEqual(expect.arrayContaining(['--lang', '--check', '--fix', '--diff']));
    });

    it('rejects --style as an unknown option', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'correct', 'Hello', '--style', 'business'])
      ).rejects.toThrow(/unknown option/i);
    });
  });

  describe('action dispatch', () => {
    it('runs improve with correct: true', async () => {
      mockWriteCommand.improve.mockResolvedValue('This is a test.');
      await program.parseAsync(['node', 'test', 'correct', 'This is an test.']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'This is an test.',
        expect.objectContaining({ correct: true, style: undefined, tone: undefined }),
      );
      expect(Logger.output).toHaveBeenCalledWith('This is a test.');
    });

    it('dispatches the c alias to the correct action', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'c', 'Hello']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ correct: true }),
      );
    });

    it('normalizes --lang casing to the canonical code', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'correct', 'Hello', '--lang', 'EN-us']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'en-US' }),
      );
    });

    it('accepts --to as an alias of --lang', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'correct', 'Hello', '--to', 'de']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'de' }),
      );
    });
  });

  describe('validation', () => {
    it('rejects an invalid language code', async () => {
      await program.parseAsync(['node', 'test', 'correct', 'Hello', '--lang', 'invalid']);
      expect(handleError).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(mockWriteCommand.improve).not.toHaveBeenCalled();
    });

    it('rejects conflicting --to and --lang values', async () => {
      await program.parseAsync(['node', 'test', 'correct', 'Hello', '--to', 'de', '--lang', 'fr']);
      expect(handleError).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('requires a file path for --fix', async () => {
      mockExistsSync.mockReturnValue(false);
      await program.parseAsync(['node', 'test', 'correct', 'not-a-file', '--fix']);
      expect(handleError).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('--check', () => {
    it('sets exit code 8 and reports correction needed', async () => {
      mockWriteCommand.checkText.mockResolvedValue({ needsImprovement: true, changes: 2 });
      await program.parseAsync(['node', 'test', 'correct', 'This is an test.', '--check']);
      expect(mockWriteCommand.checkText).toHaveBeenCalledWith(
        'This is an test.',
        expect.objectContaining({ correct: true }),
      );
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('needs correction'));
      expect(process.exitCode).toBe(8);
    });

    it('exits clean when no corrections are needed', async () => {
      mockWriteCommand.checkText.mockResolvedValue({ needsImprovement: false, changes: 0 });
      await program.parseAsync(['node', 'test', 'correct', 'This is a test.', '--check']);
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Text looks good'));
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('--fix', () => {
    it('reports corrected file on fix', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.autoFixFile.mockResolvedValue({ fixed: true, filePath: '/tmp/f.txt', changes: 3 });
      await program.parseAsync(['node', 'test', 'correct', 'f.txt', '--fix']);
      expect(mockWriteCommand.autoFixFile).toHaveBeenCalledWith(
        'f.txt',
        expect.objectContaining({ correct: true }),
      );
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('File corrected'));
    });

    it('reports when no corrections are needed', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.autoFixFile.mockResolvedValue({ fixed: false, filePath: '/tmp/f.txt', changes: 0 });
      await program.parseAsync(['node', 'test', 'correct', 'f.txt', '--fix']);
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('No corrections needed'));
    });
  });
});

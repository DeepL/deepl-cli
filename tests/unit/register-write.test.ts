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

import { registerWrite } from '../../src/cli/commands/register-write';
import { Logger } from '../../src/utils/logger';

describe('registerWrite', () => {
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
    registerWrite(program, { createDeepLClient, getConfigService, getCacheService, handleError });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  describe('alias', () => {
    it('registers w as an alias of write', () => {
      const writeCmd = program.commands.find(c => c.name() === 'write')!;
      expect(writeCmd.aliases()).toContain('w');
    });

    it('dispatches w to the write action', async () => {
      mockWriteCommand.improve.mockResolvedValue('Improved text');
      await program.parseAsync(['node', 'test', 'w', 'Hello world']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith('Hello world', expect.any(Object));
      expect(Logger.output).toHaveBeenCalledWith('Improved text');
    });
  });

  describe('basic improve (text)', () => {
    it('should improve text and output result', async () => {
      mockWriteCommand.improve.mockResolvedValue('Improved text');
      await program.parseAsync(['node', 'test', 'write', 'Hello world']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith('Hello world', expect.any(Object));
      expect(Logger.output).toHaveBeenCalledWith('Improved text');
    });

    it('should pass lang option via --lang', async () => {
      mockWriteCommand.improve.mockResolvedValue('Hallo');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--lang', 'de']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'de' }),
      );
    });

    it('should pass style option', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--style', 'business']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ style: 'business' }),
      );
    });

    it('should pass tone option', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--tone', 'friendly']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ tone: 'friendly' }),
      );
    });

    it('should map -l short flag to --lang', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '-l', 'en-US']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'en-US' }),
      );
    });

    it('should accept --to as a long-only alias of --lang', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--to', 'de']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'de' }),
      );
    });

    it('should accept --to and --lang when they carry the same value', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--to', 'de', '--lang', 'de']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'de' }),
      );
      expect(handleError).not.toHaveBeenCalled();
    });

    it('should reject --to and --lang when they carry different values', async () => {
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--to', 'de', '--lang', 'fr']);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Cannot specify both --to and --lang with different values'),
        }),
      );
    });

    it('should NOT bind -t to --to on write (reserved for translate)', async () => {
      // write does not own -t; commander should leave it unparsed or reject it,
      // not treat it as an alias for --to. If this test starts passing with
      // lang='en', it means we accidentally bound -t here.
      await program.parseAsync(['node', 'test', 'write', 'Hello', '-t', 'en']).catch(() => undefined);
      expect(mockWriteCommand.improve).not.toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'en' }),
      );
    });

    it('should accept --tone as long flag only', async () => {
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--tone', 'friendly']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ tone: 'friendly' }),
      );
    });
  });

  describe('validation', () => {
    it('should reject invalid language code', async () => {
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--lang', 'xx']);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Invalid language code') }),
      );
    });

    it.each(['ja', 'ko', 'zh', 'zh-Hans'])('should accept new target language %s', async (lang) => {
      mockCreateWriteCommand.mockResolvedValue(mockWriteCommand);
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--lang', lang]);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang }),
      );
      expect(handleError).not.toHaveBeenCalled();
    });

    // `deepl languages` prints lowercase codes and `translate --to` lowercases
    // before validating, so write rejecting them made the CLI's own output
    // unusable with the command documented as consistent with translate.
    it.each([
      ['en-us', 'en-US'],
      ['en-US', 'en-US'],
      ['EN-US', 'en-US'],
      ['pt-br', 'pt-BR'],
      ['zh-hans', 'zh-Hans'],
      ['DE', 'de'],
    ])('should accept --lang %s and normalize it to %s', async (input, canonical) => {
      mockCreateWriteCommand.mockResolvedValue(mockWriteCommand);
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--lang', input]);
      expect(handleError).not.toHaveBeenCalled();
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: canonical }),
      );
    });

    it('should accept the same casing via --to as via --lang', async () => {
      mockCreateWriteCommand.mockResolvedValue(mockWriteCommand);
      mockWriteCommand.improve.mockResolvedValue('ok');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--to', 'pt-br']);
      expect(handleError).not.toHaveBeenCalled();
      expect(mockWriteCommand.improve).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ lang: 'pt-BR' }),
      );
    });

    it('should reject both --style and --tone', async () => {
      await program.parseAsync([
        'node', 'test', 'write', 'Hello', '--style', 'business', '--tone', 'friendly',
      ]);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Cannot specify both') }),
      );
    });

    it('should reject invalid style value', async () => {
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--style', 'fancy']);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Invalid writing style: fancy') }),
      );
    });

    it('should accept all valid style values', async () => {
      const validStyles = ['default', 'simple', 'business', 'academic', 'casual', 'prefer_simple', 'prefer_business', 'prefer_academic', 'prefer_casual'];
      for (const style of validStyles) {
        jest.clearAllMocks();
        mockCreateWriteCommand.mockResolvedValue(mockWriteCommand);
        mockWriteCommand.improve.mockResolvedValue('ok');
        await program.parseAsync(['node', 'test', 'write', 'Hello', '--style', style]);
        expect(handleError).not.toHaveBeenCalled();
      }
    });

    it('should reject invalid tone value', async () => {
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--tone', 'angry']);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Invalid tone: angry') }),
      );
    });

    it('should accept all valid tone values', async () => {
      const validTones = ['default', 'enthusiastic', 'friendly', 'confident', 'diplomatic', 'prefer_enthusiastic', 'prefer_friendly', 'prefer_confident', 'prefer_diplomatic'];
      for (const tone of validTones) {
        jest.clearAllMocks();
        mockCreateWriteCommand.mockResolvedValue(mockWriteCommand);
        mockWriteCommand.improve.mockResolvedValue('ok');
        await program.parseAsync(['node', 'test', 'write', 'Hello', '--tone', tone]);
        expect(handleError).not.toHaveBeenCalled();
      }
    });

    it('should warn when --backup is used without --fix', async () => {
      mockWriteCommand.improve.mockResolvedValue('Improved text');
      await program.parseAsync(['node', 'test', 'write', 'Some text', '--backup']);
      expect(Logger.warn).toHaveBeenCalledWith('--backup has no effect without --fix');
    });

    it('should reject unsupported format', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'write', 'Hello', '--format', 'table']),
      ).rejects.toThrow(/invalid.*Allowed choices are text, json/);
    });

    it('should reject unknown format values', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'write', 'Hello', '--format', 'xml']),
      ).rejects.toThrow(/invalid.*Allowed choices are text, json/);
    });

    it('should accept json format', async () => {
      mockWriteCommand.improve.mockResolvedValue('{"result": "ok"}');
      await program.parseAsync(['node', 'test', 'write', 'Hello', '--format', 'json']);
      expect(handleError).not.toHaveBeenCalled();
      expect(mockWriteCommand.improve).toHaveBeenCalled();
    });
  });

  describe('file input (existsSync returns true)', () => {
    it('should improve file content', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.improveFile.mockResolvedValue('Improved file text');
      await program.parseAsync(['node', 'test', 'write', 'file.txt']);
      expect(mockWriteCommand.improveFile).toHaveBeenCalledWith('file.txt', expect.any(Object));
      expect(Logger.output).toHaveBeenCalledWith('Improved file text');
    });
  });

  describe('--check mode', () => {
    it('should set exitCode 8 when text needs improvement', async () => {
      mockWriteCommand.checkText.mockResolvedValue({ needsImprovement: true, changes: 3 });
      await program.parseAsync(['node', 'test', 'write', 'bad text', '--check']);
      expect(mockWriteCommand.checkText).toHaveBeenCalledWith('bad text', expect.any(Object));
      expect(Logger.warn).toHaveBeenCalled();
      expect(process.exitCode).toBe(8);
    });

    it('should not set exitCode when text is clean', async () => {
      mockWriteCommand.checkText.mockResolvedValue({ needsImprovement: false, changes: 0 });
      await program.parseAsync(['node', 'test', 'write', 'good text', '--check']);
      expect(Logger.success).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('should check file when path exists', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.checkFile.mockResolvedValue({ needsImprovement: true, changes: 2 });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '--check']);
      expect(mockWriteCommand.checkFile).toHaveBeenCalledWith('file.txt', expect.any(Object));
      expect(Logger.info).toHaveBeenCalled();
      expect(process.exitCode).toBe(8);
    });

    it('should return normally without calling process.exit()', async () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
      mockWriteCommand.checkText.mockResolvedValue({ needsImprovement: true, changes: 1 });
      await program.parseAsync(['node', 'test', 'write', 'text', '--check']);
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  describe('--fix mode', () => {
    it('should error when input is not a file', async () => {
      await program.parseAsync(['node', 'test', 'write', 'not-a-file', '--fix']);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('--fix requires a file path') }),
      );
    });

    it('should fix file and report success', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.autoFixFile.mockResolvedValue({ fixed: true, changes: 5, backupPath: 'file.txt.bak' });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '--fix']);
      expect(mockWriteCommand.autoFixFile).toHaveBeenCalledWith('file.txt', expect.any(Object));
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('File improved'));
      expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('Backup'));
    });

    it('should report no improvements needed', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.autoFixFile.mockResolvedValue({ fixed: false, changes: 0 });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '--fix']);
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('No improvements needed'));
    });

    it('should pass backup option', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.autoFixFile.mockResolvedValue({ fixed: true, changes: 1 });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '--fix', '--backup']);
      expect(mockWriteCommand.autoFixFile).toHaveBeenCalledWith(
        'file.txt',
        expect.objectContaining({ createBackup: true }),
      );
    });
  });

  describe('--diff mode', () => {
    it('should show diff for text input', async () => {
      mockWriteCommand.improveWithDiff.mockResolvedValue({
        original: 'old',
        improved: 'new',
        diff: '-old\n+new',
      });
      await program.parseAsync(['node', 'test', 'write', 'some text', '--diff']);
      expect(mockWriteCommand.improveWithDiff).toHaveBeenCalledWith('some text', expect.any(Object));
      expect(Logger.output).toHaveBeenCalledWith(expect.stringContaining('Original'));
    });

    it('should show diff for file input', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.improveFileWithDiff.mockResolvedValue({
        original: 'old',
        improved: 'new',
        diff: '-old\n+new',
      });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '--diff']);
      expect(mockWriteCommand.improveFileWithDiff).toHaveBeenCalledWith('file.txt', expect.any(Object));
    });
  });

  describe('--interactive mode', () => {
    const originalStdinIsTTY = process.stdin.isTTY;

    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: true,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalStdinIsTTY,
        configurable: true,
        writable: true,
      });
    });

    it('should run interactive mode for text', async () => {
      mockWriteCommand.improveInteractive.mockResolvedValue('selected text');
      await program.parseAsync(['node', 'test', 'write', 'some text', '-i']);
      expect(mockWriteCommand.improveInteractive).toHaveBeenCalledWith('some text', expect.any(Object));
      expect(Logger.output).toHaveBeenCalledWith('selected text');
    });

    it('should run interactive mode for file', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.improveFileInteractive.mockResolvedValue({ selected: 'improved' });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '-i']);
      expect(mockWriteCommand.improveFileInteractive).toHaveBeenCalledWith('file.txt', expect.any(Object));
      expect(Logger.output).toHaveBeenCalledWith('improved');
    });

    it('should write to output file in interactive file mode', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.improveFileInteractive.mockResolvedValue({ selected: 'improved' });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '-i', '-o', 'out.txt']);
      expect(mockWriteFile).toHaveBeenCalledWith('out.txt', 'improved', 'utf-8');
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Saved to out.txt'));
    });

    it('should write in-place in interactive file mode', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteCommand.improveFileInteractive.mockResolvedValue({ selected: 'improved' });
      await program.parseAsync(['node', 'test', 'write', 'file.txt', '-i', '--in-place']);
      expect(mockWriteFile).toHaveBeenCalledWith('file.txt', 'improved', 'utf-8');
    });

    it('should reject --interactive when stdin is not a TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
        writable: true,
      });
      await program.parseAsync(['node', 'test', 'write', 'some text', '-i']);
      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('--interactive requires an interactive terminal'),
        }),
      );
      expect(mockWriteCommand.improveInteractive).not.toHaveBeenCalled();
    });
  });

  describe('--output with text input', () => {
    it('should write result to output file when --output is specified with text input', async () => {
      mockWriteCommand.improve.mockResolvedValue('Improved text');
      await program.parseAsync(['node', 'test', 'write', 'Hello world', '-o', '/tmp/out.txt']);
      expect(mockWriteCommand.improve).toHaveBeenCalledWith('Hello world', expect.any(Object));
      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/out.txt', 'Improved text', 'utf-8');
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Saved to /tmp/out.txt'));
    });

    it('should still output to stdout when --output is not specified with text input', async () => {
      mockWriteCommand.improve.mockResolvedValue('Improved text');
      await program.parseAsync(['node', 'test', 'write', 'Hello world']);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(Logger.output).toHaveBeenCalledWith('Improved text');
    });
  });

  describe('error handling', () => {
    it('should call handleError on unexpected errors', async () => {
      mockWriteCommand.improve.mockRejectedValue(new Error('API error'));
      await program.parseAsync(['node', 'test', 'write', 'Hello']);
      expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'API error' }));
    });
  });
});

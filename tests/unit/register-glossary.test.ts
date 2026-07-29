 
import { Command } from 'commander';
import { registerGlossary } from '../../src/cli/commands/register-glossary';
import { createGlossaryCommand } from '../../src/cli/commands/service-factory';
import { Logger } from '../../src/utils/logger';

jest.mock('../../src/cli/commands/service-factory', () => ({
  createGlossaryCommand: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  Logger: {
    success: jest.fn(),
    output: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/utils/confirm', () => ({
  confirm: jest.fn(),
}));

jest.mock('chalk', () => ({
  default: {
    green: (t: string) => t,
    yellow: (t: string) => t,
  },
  green: (t: string) => t,
  yellow: (t: string) => t,
}));

import * as realFs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockCreateGlossaryCommand = createGlossaryCommand as jest.MockedFunction<typeof createGlossaryCommand>;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  const handleError = jest.fn((error: unknown) => {
    throw error;
  }) as any;
  const createDeepLClient = jest.fn();
  registerGlossary(program, { createDeepLClient, handleError });
  return { program, handleError, createDeepLClient };
}

function makeMockGlossaryCmd() {
  return {
    create: jest.fn(),
    list: jest.fn(),
    show: jest.fn(),
    entries: jest.fn(),
    delete: jest.fn(),
    listLanguages: jest.fn(),
    addEntry: jest.fn(),
    updateEntry: jest.fn(),
    removeEntry: jest.fn(),
    rename: jest.fn(),
    update: jest.fn(),
    replaceDictionary: jest.fn(),
    deleteDictionary: jest.fn(),
    formatGlossaryInfo: jest.fn().mockReturnValue('glossary-info'),
    formatGlossaryList: jest.fn().mockReturnValue('glossary-list'),
    formatEntries: jest.fn().mockReturnValue('entries-output'),
    formatLanguagePairs: jest.fn().mockReturnValue('language-pairs'),
  };
}

describe('registerGlossary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('glossary create', () => {
    it('should create a glossary and output info', async () => {
      const mock = makeMockGlossaryCmd();
      mock.create.mockResolvedValue({ id: '1', name: 'test' });
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'create', 'my-terms', 'en', 'de', 'terms.tsv']);

      expect(mock.create).toHaveBeenCalledWith('my-terms', 'en', ['de'], 'terms.tsv');
      expect(Logger.output).toHaveBeenCalledWith(expect.stringContaining('Glossary created successfully'));
      expect(mock.formatGlossaryInfo).toHaveBeenCalledWith({ id: '1', name: 'test' });
      expect(Logger.output).toHaveBeenCalledWith('glossary-info');
    });

    it('should split comma-separated target languages', async () => {
      const mock = makeMockGlossaryCmd();
      mock.create.mockResolvedValue({ id: '2', name: 'multi' });
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'create', 'my-terms', 'en', 'de,fr,es', 'terms.tsv']);

      expect(mock.create).toHaveBeenCalledWith('my-terms', 'en', ['de', 'fr', 'es'], 'terms.tsv');
    });

    it('should trim whitespace from comma-separated target languages', async () => {
      const mock = makeMockGlossaryCmd();
      mock.create.mockResolvedValue({ id: '3', name: 'trimmed' });
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'create', 'my-terms', 'en', 'de, fr, es', 'terms.tsv']);

      expect(mock.create).toHaveBeenCalledWith('my-terms', 'en', ['de', 'fr', 'es'], 'terms.tsv');
    });

    it('should handle single target language without comma', async () => {
      const mock = makeMockGlossaryCmd();
      mock.create.mockResolvedValue({ id: '1', name: 'single' });
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'create', 'my-terms', 'en', 'de', 'terms.tsv']);

      expect(mock.create).toHaveBeenCalledWith('my-terms', 'en', ['de'], 'terms.tsv');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('create failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'create', 'name', 'en', 'de', 'file.tsv'])
      ).rejects.toThrow('create failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary list', () => {
    it('should list glossaries and output formatted list', async () => {
      const mock = makeMockGlossaryCmd();
      mock.list.mockResolvedValue([{ id: '1' }]);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'list']);

      expect(mock.list).toHaveBeenCalled();
      expect(mock.formatGlossaryList).toHaveBeenCalledWith([{ id: '1' }]);
      expect(Logger.output).toHaveBeenCalledWith('glossary-list');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('list failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'list'])
      ).rejects.toThrow('list failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary show', () => {
    it('should show glossary details', async () => {
      const mock = makeMockGlossaryCmd();
      mock.show.mockResolvedValue({ id: '1', name: 'test' });
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'show', 'my-terms']);

      expect(mock.show).toHaveBeenCalledWith('my-terms');
      expect(mock.formatGlossaryInfo).toHaveBeenCalledWith({ id: '1', name: 'test' });
      expect(Logger.output).toHaveBeenCalledWith('glossary-info');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('show failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'show', 'my-terms'])
      ).rejects.toThrow('show failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary entries', () => {
    it('should show glossary entries', async () => {
      const mock = makeMockGlossaryCmd();
      mock.entries.mockResolvedValue([['hello', 'hallo']]);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'entries', 'my-terms']);

      expect(mock.entries).toHaveBeenCalledWith('my-terms', undefined);
      expect(mock.formatEntries).toHaveBeenCalledWith([['hello', 'hallo']]);
      expect(Logger.output).toHaveBeenCalledWith('entries-output');
    });

    it('should pass --target-lang option', async () => {
      const mock = makeMockGlossaryCmd();
      mock.entries.mockResolvedValue([]);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'entries', 'my-terms', '--target-lang', 'de']);

      expect(mock.entries).toHaveBeenCalledWith('my-terms', 'de');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('entries failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'entries', 'my-terms'])
      ).rejects.toThrow('entries failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary delete', () => {
    it('should delete with --yes flag (skip confirmation)', async () => {
      const mock = makeMockGlossaryCmd();
      mock.delete.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'delete', 'my-terms', '--yes']);

      expect(mock.delete).toHaveBeenCalledWith('my-terms');
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should output dry-run message with --dry-run flag', async () => {
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'delete', 'my-terms', '--dry-run']);

      expect(Logger.output).toHaveBeenCalled();
      const outputArg = (Logger.output as jest.Mock).mock.calls[0][0] as string;
      expect(outputArg).toContain('[dry-run]');
      expect(outputArg).toContain('my-terms');
      expect(mockCreateGlossaryCommand).not.toHaveBeenCalled();
    });

    it('should abort when user declines confirmation', async () => {
      const { confirm } = require('../../src/utils/confirm');
      (confirm as jest.Mock).mockResolvedValue(false);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'delete', 'my-terms']);

      expect(Logger.info).toHaveBeenCalledWith('Aborted.');
      expect(mockCreateGlossaryCommand).not.toHaveBeenCalled();
    });

    it('should delete when user confirms', async () => {
      const { confirm } = require('../../src/utils/confirm');
      (confirm as jest.Mock).mockResolvedValue(true);
      const mock = makeMockGlossaryCmd();
      mock.delete.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'delete', 'my-terms']);

      expect(confirm).toHaveBeenCalled();
      expect(mock.delete).toHaveBeenCalledWith('my-terms');
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should call handleError on failure', async () => {
      const error = new Error('delete failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'delete', 'my-terms', '--yes'])
      ).rejects.toThrow('delete failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary languages', () => {
    it('should list supported language pairs', async () => {
      const mock = makeMockGlossaryCmd();
      mock.listLanguages.mockResolvedValue([{ source: 'en', target: 'de' }]);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'languages']);

      expect(mock.listLanguages).toHaveBeenCalled();
      expect(mock.formatLanguagePairs).toHaveBeenCalledWith([{ source: 'en', target: 'de' }]);
      expect(Logger.output).toHaveBeenCalledWith('language-pairs');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('languages failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'languages'])
      ).rejects.toThrow('languages failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary add-entry', () => {
    it('should add an entry to a glossary', async () => {
      const mock = makeMockGlossaryCmd();
      mock.addEntry.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'add-entry', 'my-terms', 'hello', 'hallo']);

      expect(mock.addEntry).toHaveBeenCalledWith('my-terms', 'hello', 'hallo', undefined);
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should pass --target-lang option', async () => {
      const mock = makeMockGlossaryCmd();
      mock.addEntry.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'add-entry', 'my-terms', 'hello', 'hallo', '--target-lang', 'de']);

      expect(mock.addEntry).toHaveBeenCalledWith('my-terms', 'hello', 'hallo', 'de');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('add-entry failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'add-entry', 'my-terms', 'hello', 'hallo'])
      ).rejects.toThrow('add-entry failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary update-entry', () => {
    it('should update an entry in a glossary', async () => {
      const mock = makeMockGlossaryCmd();
      mock.updateEntry.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'update-entry', 'my-terms', 'hello', 'hi']);

      expect(mock.updateEntry).toHaveBeenCalledWith('my-terms', 'hello', 'hi', undefined);
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should pass --target-lang option', async () => {
      const mock = makeMockGlossaryCmd();
      mock.updateEntry.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'update-entry', 'my-terms', 'hello', 'hi', '--target-lang', 'de']);

      expect(mock.updateEntry).toHaveBeenCalledWith('my-terms', 'hello', 'hi', 'de');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('update-entry failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'update-entry', 'my-terms', 'hello', 'hi'])
      ).rejects.toThrow('update-entry failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary remove-entry', () => {
    it('should remove an entry from a glossary', async () => {
      const mock = makeMockGlossaryCmd();
      mock.removeEntry.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'remove-entry', 'my-terms', 'hello']);

      expect(mock.removeEntry).toHaveBeenCalledWith('my-terms', 'hello', undefined);
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should pass --target-lang option', async () => {
      const mock = makeMockGlossaryCmd();
      mock.removeEntry.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'remove-entry', 'my-terms', 'hello', '--target-lang', 'de']);

      expect(mock.removeEntry).toHaveBeenCalledWith('my-terms', 'hello', 'de');
    });

    it('should call handleError on failure', async () => {
      const error = new Error('remove-entry failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'remove-entry', 'my-terms', 'hello'])
      ).rejects.toThrow('remove-entry failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary rename', () => {
    it('should rename a glossary', async () => {
      const mock = makeMockGlossaryCmd();
      mock.rename.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'rename', 'old-name', 'new-name']);

      expect(mock.rename).toHaveBeenCalledWith('old-name', 'new-name');
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should call handleError on failure', async () => {
      const error = new Error('rename failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'rename', 'old-name', 'new-name'])
      ).rejects.toThrow('rename failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary update', () => {
    let tmpDir: string;
    let tsvFile: string;
    let emptyFile: string;

    beforeEach(() => {
      tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'deepl-glossary-test-'));
      tsvFile = path.join(tmpDir, 'entries.tsv');
      emptyFile = path.join(tmpDir, 'empty.tsv');
      realFs.writeFileSync(tsvFile, 'hello\thola\nworld\tmundo\n', 'utf-8');
      realFs.writeFileSync(emptyFile, '\n', 'utf-8');
    });

    afterEach(() => {
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should error when neither --name nor --file is provided', async () => {
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms'])
      ).rejects.toThrow('At least one of --name or --file (with --target-lang) must be provided');
      expect(handleError).toHaveBeenCalled();
    });

    it('should error when --file is provided without --target-lang', async () => {
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms', '--file', tsvFile])
      ).rejects.toThrow('--target-lang is required when using --file');
      expect(handleError).toHaveBeenCalled();
    });

    it('should error when file does not exist', async () => {
      const { program, handleError } = makeProgram();
      const missing = path.join(tmpDir, 'missing.tsv');

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms', '--file', missing, '--target-lang', 'de'])
      ).rejects.toThrow(`File not found: ${missing}`);
      expect(handleError).toHaveBeenCalled();
    });

    it('should error when file has no valid entries', async () => {
      const mock = makeMockGlossaryCmd();
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms', '--file', emptyFile, '--target-lang', 'de'])
      ).rejects.toThrow('No valid entries found in file');
      expect(handleError).toHaveBeenCalled();
    });

    it('should update with --name only', async () => {
      const mock = makeMockGlossaryCmd();
      mock.update.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms', '--name', 'new-name']);

      expect(mock.update).toHaveBeenCalledWith('my-terms', { name: 'new-name' });
      expect(Logger.success).toHaveBeenCalled();
      const successMsg = (Logger.success as jest.Mock).mock.calls[0][0];
      expect(successMsg).toContain('renamed');
    });

    it('should update with --file and --target-lang only', async () => {
      const mock = makeMockGlossaryCmd();
      mock.update.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms', '--file', tsvFile, '--target-lang', 'de']);

      expect(mock.update).toHaveBeenCalledWith('my-terms', expect.objectContaining({
        dictionaries: [expect.objectContaining({
          targetLang: 'de',
        })],
      }));
      expect(Logger.success).toHaveBeenCalled();
      const successMsg = (Logger.success as jest.Mock).mock.calls[0][0];
      expect(successMsg).toContain('dictionary updated');
    });

    it('should update with both --name and --file/--target-lang', async () => {
      const mock = makeMockGlossaryCmd();
      mock.update.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms', '--name', 'new-name', '--file', tsvFile, '--target-lang', 'de']);

      expect(mock.update).toHaveBeenCalledWith('my-terms', expect.objectContaining({
        name: 'new-name',
        dictionaries: [expect.objectContaining({
          targetLang: 'de',
        })],
      }));
      expect(Logger.success).toHaveBeenCalled();
      const successMsg = (Logger.success as jest.Mock).mock.calls[0][0];
      expect(successMsg).toContain('renamed');
      expect(successMsg).toContain('dictionary updated');
    });

    it('should call handleError on update failure', async () => {
      const error = new Error('update failed');
      const mock = makeMockGlossaryCmd();
      mock.update.mockRejectedValue(error);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'update', 'my-terms', '--name', 'new'])
      ).rejects.toThrow('update failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary replace-dictionary', () => {
    it('should replace a dictionary from file', async () => {
      const mock = makeMockGlossaryCmd();
      mock.replaceDictionary.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'replace-dictionary', 'my-terms', 'de', 'new.tsv']);

      expect(mock.replaceDictionary).toHaveBeenCalledWith('my-terms', 'de', 'new.tsv');
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should call handleError on failure', async () => {
      const error = new Error('replace failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'replace-dictionary', 'my-terms', 'de', 'new.tsv'])
      ).rejects.toThrow('replace failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('glossary delete-dictionary', () => {
    it('should delete dictionary with --yes flag', async () => {
      const mock = makeMockGlossaryCmd();
      mock.deleteDictionary.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'delete-dictionary', 'my-terms', 'de', '--yes']);

      expect(mock.deleteDictionary).toHaveBeenCalledWith('my-terms', 'de');
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should abort when user declines confirmation', async () => {
      const { confirm } = require('../../src/utils/confirm');
      (confirm as jest.Mock).mockResolvedValue(false);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'delete-dictionary', 'my-terms', 'de']);

      expect(Logger.info).toHaveBeenCalledWith('Aborted.');
      expect(mockCreateGlossaryCommand).not.toHaveBeenCalled();
    });

    it('should delete when user confirms', async () => {
      const { confirm } = require('../../src/utils/confirm');
      (confirm as jest.Mock).mockResolvedValue(true);
      const mock = makeMockGlossaryCmd();
      mock.deleteDictionary.mockResolvedValue(undefined);
      mockCreateGlossaryCommand.mockResolvedValue(mock as any);
      const { program } = makeProgram();

      await program.parseAsync(['node', 'test', 'glossary', 'delete-dictionary', 'my-terms', 'de']);

      expect(confirm).toHaveBeenCalled();
      expect(mock.deleteDictionary).toHaveBeenCalledWith('my-terms', 'de');
      expect(Logger.success).toHaveBeenCalled();
    });

    it('should call handleError on failure', async () => {
      const error = new Error('delete-dict failed');
      mockCreateGlossaryCommand.mockRejectedValue(error);
      const { program, handleError } = makeProgram();

      await expect(
        program.parseAsync(['node', 'test', 'glossary', 'delete-dictionary', 'my-terms', 'de', '--yes'])
      ).rejects.toThrow('delete-dict failed');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });
});

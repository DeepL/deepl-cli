/**
 * Tests for Glossary Command
 */

 

import { GlossaryCommand } from '../../src/cli/commands/glossary';
import { GlossaryService } from '../../src/services/glossary';
import { GlossaryInfo } from '../../src/types/glossary.js';
import { GlossaryLanguagePair } from '../../src/types/index.js';
import * as fs from 'fs';
import { createMockGlossaryService } from '../helpers/mock-factories';

// Mock dependencies
jest.mock('../../src/services/glossary');
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    lstatSync: jest.fn(),
  };
});

describe('GlossaryCommand', () => {
  let mockGlossaryService: jest.Mocked<GlossaryService>;
  let glossaryCommand: GlossaryCommand;

  const mockGlossary: GlossaryInfo = {
    glossary_id: '123-456-789',
    name: 'Tech Terms',
    source_lang: 'en',
    target_langs: ['es'],
    dictionaries: [{
      source_lang: 'en',
      target_lang: 'es',
      entry_count: 10,
    }],
    creation_time: '2024-01-15T10:30:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockGlossaryService = createMockGlossaryService({
      createGlossary: jest.fn().mockResolvedValue(mockGlossary),
      createGlossaryFromTSV: jest.fn().mockResolvedValue(mockGlossary),
      listGlossaries: jest.fn().mockResolvedValue([mockGlossary]),
      getGlossary: jest.fn().mockResolvedValue(mockGlossary),
      getGlossaryByName: jest.fn().mockResolvedValue(mockGlossary),
      deleteGlossary: jest.fn().mockResolvedValue(undefined),
      getGlossaryEntries: jest.fn().mockResolvedValue({ hello: 'hola', world: 'mundo' }),
      getGlossaryLanguages: jest.fn().mockResolvedValue([]),
      addEntry: jest.fn().mockResolvedValue(mockGlossary),
      updateEntry: jest.fn().mockResolvedValue(mockGlossary),
      removeEntry: jest.fn().mockResolvedValue(mockGlossary),
      renameGlossary: jest.fn().mockResolvedValue(mockGlossary),
    });

    glossaryCommand = new GlossaryCommand(mockGlossaryService);
  });

  describe('create()', () => {
    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('hello\thola\nworld\tmundo');
      (fs.lstatSync as jest.Mock).mockReturnValue({ isSymbolicLink: () => false });
    });

    it('should create glossary from TSV file', async () => {
      const result = await glossaryCommand.create('Tech Terms', 'en', ['es'], '/path/to/glossary.tsv');

      expect(result).toEqual(mockGlossary);
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/glossary.tsv');
      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/glossary.tsv', 'utf-8');
      expect(mockGlossaryService.createGlossaryFromTSV).toHaveBeenCalledWith(
        'Tech Terms',
        'en',
        ['es'],
        'hello\thola\nworld\tmundo'
      );
    });

    it('should throw error if file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        glossaryCommand.create('Tech Terms', 'en', ['es'], '/path/to/missing.tsv')
      ).rejects.toThrow('File not found');
    });

    it('should include file path in file-not-found error', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        glossaryCommand.create('Tech Terms', 'en', ['es'], '/specific/path.tsv')
      ).rejects.toThrow('File not found: /specific/path.tsv');
    });

    it('should handle glossary service errors', async () => {
      (mockGlossaryService.createGlossaryFromTSV as jest.Mock).mockRejectedValueOnce(
        new Error('Invalid glossary format')
      );

      await expect(
        glossaryCommand.create('Tech Terms', 'en', ['es'], '/path/to/glossary.tsv')
      ).rejects.toThrow('Invalid glossary format');
    });

    it('should reject symlinks for security', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.lstatSync as jest.Mock).mockReturnValue({ isSymbolicLink: () => true });

      await expect(
        glossaryCommand.create('Tech Terms', 'en', ['es'], '/path/to/symlink.tsv')
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should support multiple target languages', async () => {
      const result = await glossaryCommand.create('Multi Terms', 'en', ['es', 'fr', 'de'], '/path/to/glossary.tsv');

      expect(result).toEqual(mockGlossary);
      expect(mockGlossaryService.createGlossaryFromTSV).toHaveBeenCalledWith(
        'Multi Terms',
        'en',
        ['es', 'fr', 'de'],
        'hello\thola\nworld\tmundo'
      );
    });
  });

  describe('list()', () => {
    it('should list all glossaries', async () => {
      const result = await glossaryCommand.list();

      expect(result).toEqual([mockGlossary]);
      expect(mockGlossaryService.listGlossaries).toHaveBeenCalled();
    });

    it('should return empty array when no glossaries exist', async () => {
      (mockGlossaryService.listGlossaries as jest.Mock).mockResolvedValueOnce([]);

      const result = await glossaryCommand.list();

      expect(result).toEqual([]);
    });
  });

  describe('show()', () => {
    it('should get glossary by ID', async () => {
      const result = await glossaryCommand.show('123-456-789');

      expect(result).toEqual(mockGlossary);
      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
    });

    it('should fallback to get by name if ID fails', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(
        new Error('Not found')
      );

      const result = await glossaryCommand.show('Tech Terms');

      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(result).toEqual(mockGlossary);
    });

    it('should throw error if glossary not found by ID or name', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(
        new Error('Not found')
      );
      (mockGlossaryService.getGlossaryByName as jest.Mock).mockResolvedValueOnce(null);

      await expect(glossaryCommand.show('NonExistent')).rejects.toThrow('Glossary not found');
    });
  });

  describe('delete()', () => {
    it('should delete glossary by ID', async () => {
      await glossaryCommand.delete('123-456-789');

      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.deleteGlossary).toHaveBeenCalledWith('123-456-789');
    });

    it('should delete glossary by name', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(
        new Error('Not found')
      );

      await glossaryCommand.delete('Tech Terms');

      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.deleteGlossary).toHaveBeenCalledWith('123-456-789');
    });

    it('should propagate error when glossary not found for deletion', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));
      (mockGlossaryService.getGlossaryByName as jest.Mock).mockResolvedValueOnce(null);

      await expect(glossaryCommand.delete('NonExistent')).rejects.toThrow('Glossary not found');
    });

    it('should handle delete service errors', async () => {
      (mockGlossaryService.deleteGlossary as jest.Mock).mockRejectedValueOnce(
        new Error('Permission denied')
      );

      await expect(glossaryCommand.delete('123-456-789')).rejects.toThrow('Permission denied');
    });
  });

  describe('entries()', () => {
    it('should get glossary entries', async () => {
      const result = await glossaryCommand.entries('123-456-789');

      expect(result).toEqual({ hello: 'hola', world: 'mundo' });
      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.getGlossaryEntries).toHaveBeenCalledWith('123-456-789', 'en', 'es');
    });

    it('should get entries with explicit target language', async () => {
      const multilingualGlossary: GlossaryInfo = {
        glossary_id: 'multi-123',
        name: 'Multi Terms',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          { source_lang: 'en', target_lang: 'es', entry_count: 5 },
          { source_lang: 'en', target_lang: 'fr', entry_count: 3 },
        ],
        creation_time: '2024-01-15T10:30:00Z',
      };
      (mockGlossaryService.getGlossary as jest.Mock).mockResolvedValueOnce(multilingualGlossary);

      const result = await glossaryCommand.entries('multi-123', 'fr');

      expect(result).toEqual({ hello: 'hola', world: 'mundo' });
      expect(mockGlossaryService.getGlossaryEntries).toHaveBeenCalledWith('multi-123', 'en', 'fr');
    });

    it('should get entries by glossary name', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));

      const result = await glossaryCommand.entries('Tech Terms');

      expect(result).toEqual({ hello: 'hola', world: 'mundo' });
      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.getGlossaryEntries).toHaveBeenCalledWith('123-456-789', 'en', 'es');
    });
  });

  describe('listLanguages()', () => {
    it('should list supported glossary language pairs', async () => {
      const mockPairs = [
        { sourceLang: 'en', targetLang: 'es' },
        { sourceLang: 'de', targetLang: 'en' },
      ];
      (mockGlossaryService.getGlossaryLanguages as jest.Mock).mockResolvedValue(mockPairs);

      const result = await glossaryCommand.listLanguages();

      expect(result).toEqual(mockPairs);
      expect(mockGlossaryService.getGlossaryLanguages).toHaveBeenCalled();
    });
  });

  describe('addEntry()', () => {
    it('should add entry to glossary by ID', async () => {
      (mockGlossaryService.addEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.addEntry('123-456-789', 'hello', 'hola');

      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.addEntry).toHaveBeenCalledWith('123-456-789', 'en', 'es', 'hello', 'hola');
    });

    it('should add entry to glossary by name', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));
      (mockGlossaryService.addEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.addEntry('Tech Terms', 'hello', 'hola');

      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.addEntry).toHaveBeenCalledWith('123-456-789', 'en', 'es', 'hello', 'hola');
    });

    it('should add entry with explicit target language for multilingual glossary', async () => {
      const multilingualGlossary: GlossaryInfo = {
        glossary_id: 'multi-123',
        name: 'Multi Terms',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          { source_lang: 'en', target_lang: 'es', entry_count: 5 },
          { source_lang: 'en', target_lang: 'fr', entry_count: 3 },
        ],
        creation_time: '2024-01-15T10:30:00Z',
      };
      (mockGlossaryService.getGlossary as jest.Mock).mockResolvedValueOnce(multilingualGlossary);
      (mockGlossaryService.addEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.addEntry('multi-123', 'hello', 'bonjour', 'fr');

      expect(mockGlossaryService.addEntry).toHaveBeenCalledWith('multi-123', 'en', 'fr', 'hello', 'bonjour');
    });

    it('should handle addEntry service errors', async () => {
      (mockGlossaryService.addEntry as jest.Mock).mockRejectedValueOnce(
        new Error('Entry already exists')
      );

      await expect(
        glossaryCommand.addEntry('123-456-789', 'hello', 'hola')
      ).rejects.toThrow('Entry already exists');
    });
  });

  describe('updateEntry()', () => {
    it('should update entry in glossary by ID', async () => {
      (mockGlossaryService.updateEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.updateEntry('123-456-789', 'hello', 'hola updated');

      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.updateEntry).toHaveBeenCalledWith('123-456-789', 'en', 'es', 'hello', 'hola updated');
    });

    it('should update entry in glossary by name', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));
      (mockGlossaryService.updateEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.updateEntry('Tech Terms', 'hello', 'hola updated');

      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.updateEntry).toHaveBeenCalledWith('123-456-789', 'en', 'es', 'hello', 'hola updated');
    });

    it('should update entry with explicit target language for multilingual glossary', async () => {
      const multilingualGlossary: GlossaryInfo = {
        glossary_id: 'multi-123',
        name: 'Multi Terms',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          { source_lang: 'en', target_lang: 'es', entry_count: 5 },
          { source_lang: 'en', target_lang: 'fr', entry_count: 3 },
        ],
        creation_time: '2024-01-15T10:30:00Z',
      };
      (mockGlossaryService.getGlossary as jest.Mock).mockResolvedValueOnce(multilingualGlossary);
      (mockGlossaryService.updateEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.updateEntry('multi-123', 'hello', 'bonjour updated', 'fr');

      expect(mockGlossaryService.updateEntry).toHaveBeenCalledWith('multi-123', 'en', 'fr', 'hello', 'bonjour updated');
    });
  });

  describe('removeEntry()', () => {
    it('should remove entry from glossary by ID', async () => {
      (mockGlossaryService.removeEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.removeEntry('123-456-789', 'hello');

      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.removeEntry).toHaveBeenCalledWith('123-456-789', 'en', 'es', 'hello');
    });

    it('should remove entry from glossary by name', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));
      (mockGlossaryService.removeEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.removeEntry('Tech Terms', 'hello');

      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.removeEntry).toHaveBeenCalledWith('123-456-789', 'en', 'es', 'hello');
    });

    it('should remove entry with explicit target language for multilingual glossary', async () => {
      const multilingualGlossary: GlossaryInfo = {
        glossary_id: 'multi-123',
        name: 'Multi Terms',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          { source_lang: 'en', target_lang: 'es', entry_count: 5 },
          { source_lang: 'en', target_lang: 'fr', entry_count: 3 },
        ],
        creation_time: '2024-01-15T10:30:00Z',
      };
      (mockGlossaryService.getGlossary as jest.Mock).mockResolvedValueOnce(multilingualGlossary);
      (mockGlossaryService.removeEntry as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.removeEntry('multi-123', 'hello', 'fr');

      expect(mockGlossaryService.removeEntry).toHaveBeenCalledWith('multi-123', 'en', 'fr', 'hello');
    });
  });

  describe('rename()', () => {
    it('should rename glossary by ID', async () => {
      (mockGlossaryService.renameGlossary as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.rename('123-456-789', 'New Name');

      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.renameGlossary).toHaveBeenCalledWith('123-456-789', 'New Name');
    });

    it('should rename glossary by name', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));
      (mockGlossaryService.renameGlossary as jest.Mock).mockResolvedValue(undefined);

      await glossaryCommand.rename('Tech Terms', 'New Name');

      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.renameGlossary).toHaveBeenCalledWith('123-456-789', 'New Name');
    });

    it('should handle rename errors', async () => {
      (mockGlossaryService.renameGlossary as jest.Mock).mockRejectedValueOnce(
        new Error('New name must be different from current name')
      );

      await expect(
        glossaryCommand.rename('123-456-789', 'Tech Terms')
      ).rejects.toThrow('New name must be different from current name');
    });
  });

  describe('formatGlossaryInfo()', () => {
    it('should format glossary info for display', () => {
      const result = glossaryCommand.formatGlossaryInfo(mockGlossary);

      expect(result).toContain('Name: Tech Terms');
      expect(result).toContain('ID: 123-456-789');
      expect(result).toContain('Source language: EN');
      expect(result).toContain('Target languages: ES');
      expect(result).toContain('Total entries: 10');
      expect(result).toContain('Type: Single target');
    });

    it('should format multilingual glossary info with language pairs', () => {
      const multilingualGlossary: GlossaryInfo = {
        glossary_id: 'multi-123',
        name: 'Multi Terms',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          { source_lang: 'en', target_lang: 'es', entry_count: 5 },
          { source_lang: 'en', target_lang: 'fr', entry_count: 3 },
        ],
        creation_time: '2024-01-15T10:30:00Z',
      };

      const result = glossaryCommand.formatGlossaryInfo(multilingualGlossary);

      expect(result).toContain('Name: Multi Terms');
      expect(result).toContain('Target languages: ES, FR');
      expect(result).toContain('Type: Multilingual');
      expect(result).toContain('Total entries: 8');
      expect(result).toContain('Language pairs:');
      expect(result).toContain('EN → ES: 5 entries');
      expect(result).toContain('EN → FR: 3 entries');
    });

    it('should include creation time as a locale-independent ISO timestamp', () => {
      const result = glossaryCommand.formatGlossaryInfo(mockGlossary);

      expect(result).toContain('Created: 2024-01-15T10:30:00.000Z');
    });

    it('should fall back to the raw creation time when it is unparseable', () => {
      const result = glossaryCommand.formatGlossaryInfo({
        ...mockGlossary,
        creation_time: 'not-a-date',
      });

      expect(result).toContain('Created: not-a-date');
    });

    it('should sanitize control characters in the glossary name', () => {
      const hostileGlossary: GlossaryInfo = {
        ...mockGlossary,
        name: '\u001b[31mEvil\u0007 Terms',
      };

      const result = glossaryCommand.formatGlossaryInfo(hostileGlossary);

      expect(result).not.toContain('\u001b');
      expect(result).not.toContain('\u0007');
      expect(result).toContain('Name: ?[31mEvil? Terms');
    });
  });

  describe('formatGlossaryList()', () => {
    it('should format glossary list for display', () => {
      const result = glossaryCommand.formatGlossaryList([mockGlossary]);

      expect(result).toContain('Tech Terms');
      expect(result).toContain('(en→es)');
      expect(result).toContain('10 entries');
    });

    it('should show empty message when no glossaries', () => {
      const result = glossaryCommand.formatGlossaryList([]);

      expect(result).toBe('No glossaries found');
    });

    it('should format multilingual glossary with target count', () => {
      const multilingualGlossary: GlossaryInfo = {
        glossary_id: 'multi-123',
        name: 'Multi Terms',
        source_lang: 'en',
        target_langs: ['es', 'fr', 'de'],
        dictionaries: [
          { source_lang: 'en', target_lang: 'es', entry_count: 5 },
          { source_lang: 'en', target_lang: 'fr', entry_count: 3 },
          { source_lang: 'en', target_lang: 'de', entry_count: 4 },
        ],
        creation_time: '2024-01-15T10:30:00Z',
      };

      const result = glossaryCommand.formatGlossaryList([multilingualGlossary]);

      expect(result).toContain('Multi Terms');
      expect(result).toContain('(en→3 targets)');
      expect(result).toContain('12 entries');
    });

    it('should format list with multiple glossaries', () => {
      const secondGlossary: GlossaryInfo = {
        glossary_id: 'second-456',
        name: 'Medical Terms',
        source_lang: 'de',
        target_langs: ['en'],
        dictionaries: [
          { source_lang: 'de', target_lang: 'en', entry_count: 20 },
        ],
        creation_time: '2024-02-01T08:00:00Z',
      };

      const result = glossaryCommand.formatGlossaryList([mockGlossary, secondGlossary]);

      expect(result).toContain('Tech Terms');
      expect(result).toContain('Medical Terms');
      expect(result).toContain('(de→en)');
      expect(result).toContain('20 entries');
    });

    it('should sanitize control characters in glossary names', () => {
      const hostileGlossary: GlossaryInfo = {
        ...mockGlossary,
        name: '\u001b]0;pwned\u0007Innocent',
      };

      const result = glossaryCommand.formatGlossaryList([hostileGlossary]);

      expect(result).not.toContain('\u001b');
      expect(result).not.toContain('\u0007');
      expect(result).toContain('?]0;pwned?Innocent');
    });
  });

  describe('replaceDictionary()', () => {
    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('hello\thola\nworld\tmundo');
      (fs.lstatSync as jest.Mock).mockReturnValue({ isSymbolicLink: () => false });
      mockGlossaryService.replaceGlossaryDictionary = jest.fn().mockResolvedValue(undefined);
    });

    it('should replace dictionary entries from file', async () => {
      await glossaryCommand.replaceDictionary('123-456-789', 'es', '/path/to/glossary.tsv');

      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/glossary.tsv');
      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.replaceGlossaryDictionary).toHaveBeenCalledWith(
        '123-456-789',
        'en',
        'es',
        'hello\thola\nworld\tmundo'
      );
    });

    it('should throw error if file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        glossaryCommand.replaceDictionary('123-456-789', 'es', '/path/to/missing.tsv')
      ).rejects.toThrow('File not found: /path/to/missing.tsv');
    });

    it('should reject symlinks for security', async () => {
      (fs.lstatSync as jest.Mock).mockReturnValue({ isSymbolicLink: () => true });

      await expect(
        glossaryCommand.replaceDictionary('123-456-789', 'es', '/path/to/symlink.tsv')
      ).rejects.toThrow('Symlinks are not supported for security reasons');
    });

    it('should resolve glossary by name for replaceDictionary', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));

      await glossaryCommand.replaceDictionary('Tech Terms', 'es', '/path/to/glossary.tsv');

      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.replaceGlossaryDictionary).toHaveBeenCalledWith(
        '123-456-789',
        'en',
        'es',
        'hello\thola\nworld\tmundo'
      );
    });
  });

  describe('deleteDictionary()', () => {
    beforeEach(() => {
      mockGlossaryService.deleteGlossaryDictionary = jest.fn().mockResolvedValue(undefined);
    });

    it('should delete dictionary by glossary ID and target language', async () => {
      await glossaryCommand.deleteDictionary('123-456-789', 'es');

      expect(mockGlossaryService.getGlossary).toHaveBeenCalledWith('123-456-789');
      expect(mockGlossaryService.deleteGlossaryDictionary).toHaveBeenCalledWith(
        '123-456-789',
        'en',
        'es'
      );
    });

    it('should delete dictionary by glossary name and target language', async () => {
      (mockGlossaryService.getGlossary as jest.Mock).mockRejectedValueOnce(new Error('Not found'));

      await glossaryCommand.deleteDictionary('Tech Terms', 'es');

      expect(mockGlossaryService.getGlossaryByName).toHaveBeenCalledWith('Tech Terms');
      expect(mockGlossaryService.deleteGlossaryDictionary).toHaveBeenCalledWith(
        '123-456-789',
        'en',
        'es'
      );
    });

    it('should handle delete dictionary service errors', async () => {
      mockGlossaryService.deleteGlossaryDictionary = jest.fn().mockRejectedValueOnce(
        new Error('Dictionary not found')
      );

      await expect(
        glossaryCommand.deleteDictionary('123-456-789', 'fr')
      ).rejects.toThrow('Dictionary not found');
    });
  });

  describe('formatEntries()', () => {
    it('should format entries for display', () => {
      const entries = { hello: 'hola', world: 'mundo' };

      const result = glossaryCommand.formatEntries(entries);

      expect(result).toContain('hello → hola');
      expect(result).toContain('world → mundo');
    });

    it('should show empty message when no entries', () => {
      const result = glossaryCommand.formatEntries({});

      expect(result).toBe('No entries found');
    });
  });

  describe('formatLanguagePairs()', () => {
    it('should format language pairs for display', () => {
      const pairs: GlossaryLanguagePair[] = [
        { sourceLang: 'en', targetLang: 'es' },
        { sourceLang: 'de', targetLang: 'en' },
        { sourceLang: 'fr', targetLang: 'de' },
      ];

      const result = glossaryCommand.formatLanguagePairs(pairs);

      expect(result).toContain('en → es');
      expect(result).toContain('de → en');
      expect(result).toContain('fr → de');
    });

    it('should show empty message when no language pairs available', () => {
      const result = glossaryCommand.formatLanguagePairs([]);

      expect(result).toBe('No language pairs available');
    });

    it('should format single language pair', () => {
      const pairs: GlossaryLanguagePair[] = [
        { sourceLang: 'en', targetLang: 'de' },
      ];

      const result = glossaryCommand.formatLanguagePairs(pairs);

      expect(result).toBe('en → de');
    });
  });

  describe('--format json output', () => {
    it('should produce valid JSON for glossary list', async () => {
      const glossaries = await glossaryCommand.list();
      const json = JSON.stringify(glossaries, null, 2);
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('glossary_id');
      expect(parsed[0]).toHaveProperty('name');
      expect(parsed[0]).toHaveProperty('source_lang');
      expect(parsed[0]).toHaveProperty('target_langs');
    });

    it('should produce valid JSON for glossary show', async () => {
      const glossary = await glossaryCommand.show('123-456-789');
      const json = JSON.stringify(glossary, null, 2);
      const parsed = JSON.parse(json);
      expect(parsed.glossary_id).toBe('123-456-789');
      expect(parsed.name).toBe('Tech Terms');
      expect(parsed.source_lang).toBe('en');
      expect(parsed.target_langs).toEqual(['es']);
    });

    it('should produce valid JSON for glossary entries', async () => {
      const entries = await glossaryCommand.entries('123-456-789');
      const json = JSON.stringify(entries, null, 2);
      const parsed = JSON.parse(json);
      expect(parsed).toEqual({ hello: 'hola', world: 'mundo' });
    });

    it('should produce valid JSON for empty glossary list', async () => {
      (mockGlossaryService.listGlossaries as jest.Mock).mockResolvedValueOnce([]);
      const glossaries = await glossaryCommand.list();
      const json = JSON.stringify(glossaries, null, 2);
      const parsed = JSON.parse(json);
      expect(parsed).toEqual([]);
    });

    it('should produce valid JSON for multilingual glossary', async () => {
      const multiGlossary: GlossaryInfo = {
        glossary_id: 'multi-123',
        name: 'Multi Terms',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          { source_lang: 'en', target_lang: 'es', entry_count: 5 },
          { source_lang: 'en', target_lang: 'fr', entry_count: 3 },
        ],
        creation_time: '2024-01-15T10:30:00Z',
      };
      (mockGlossaryService.getGlossary as jest.Mock).mockResolvedValueOnce(multiGlossary);

      const glossary = await glossaryCommand.show('multi-123');
      const json = JSON.stringify(glossary, null, 2);
      const parsed = JSON.parse(json);
      expect(parsed.target_langs).toEqual(['es', 'fr']);
      expect(parsed.dictionaries).toHaveLength(2);
    });
  });
});

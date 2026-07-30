/**
 * Tests for Glossary Service
 */

import { GlossaryService } from '../../src/services/glossary';
import { DeepLClient } from '../../src/api/deepl-client';
import { ConfigError, ValidationError } from '../../src/utils/errors';
import { createMockDeepLClient } from '../helpers/mock-factories';

// Mock DeepLClient
jest.mock('../../src/api/deepl-client');

describe('GlossaryService', () => {
  let glossaryService: GlossaryService;
  let mockDeepLClient: jest.Mocked<DeepLClient>;

  beforeEach(() => {
    mockDeepLClient = createMockDeepLClient();

    glossaryService = new GlossaryService(mockDeepLClient);
  });

  describe('initialization', () => {
    it('should create a GlossaryService instance', () => {
      expect(glossaryService).toBeInstanceOf(GlossaryService);
    });
  });

  describe('createGlossary()', () => {
    it('should create a glossary from entries', async () => {
      const entries = {
        'API': 'API',
        'REST': 'REST',
        'Hello': 'Hola',
      };

      mockDeepLClient.createGlossary.mockResolvedValue({
        glossary_id: 'test-glossary-123',
        name: 'tech-terms',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      const result = await glossaryService.createGlossary(
        'tech-terms',
        'en',
        ['es'],
        entries
      );

      expect(result.glossary_id).toBe('test-glossary-123');
      expect(result.name).toBe('tech-terms');
      expect(result.dictionaries[0]?.entry_count).toBe(3);
      expect(mockDeepLClient.createGlossary).toHaveBeenCalledWith(
        'tech-terms',
        'en',
        ['es'],
        'API\tAPI\nREST\tREST\nHello\tHola'
      );
    });

    it('should handle empty entries', async () => {
      await expect(
        glossaryService.createGlossary('empty', 'en', ['es'], {})
      ).rejects.toThrow('Glossary entries cannot be empty');
    });

    it('should validate glossary name', async () => {
      await expect(
        glossaryService.createGlossary('', 'en', ['es'], { test: 'test' })
      ).rejects.toThrow('Glossary name is required');
    });
  });

  describe('createGlossaryFromTSV()', () => {
    it('should create glossary from TSV string', async () => {
      const tsv = 'API\tAPI\nREST\tREST\nHello\tHola';

      mockDeepLClient.createGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'test',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      const result = await glossaryService.createGlossaryFromTSV(
        'test',
        'en',
        ['es'],
        tsv
      );

      expect(result.dictionaries[0]?.entry_count).toBe(3);
    });

    it('should handle CSV format', async () => {
      const csv = 'API,API\nREST,REST\nHello,Hola';

      mockDeepLClient.createGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'test',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      const result = await glossaryService.createGlossaryFromTSV(
        'test',
        'en',
        ['es'],
        csv
      );

      expect(result.dictionaries[0]?.entry_count).toBe(3);
    });

    it('should skip empty lines', async () => {
      const tsv = 'API\tAPI\n\nREST\tREST\n\nHello\tHola';

      mockDeepLClient.createGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'test',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      const result = await glossaryService.createGlossaryFromTSV(
        'test',
        'en',
        ['es'],
        tsv
      );

      expect(result.dictionaries[0]?.entry_count).toBe(3);
    });
  });

  describe('listGlossaries()', () => {
    it('should return list of glossaries', async () => {
      mockDeepLClient.listGlossaries.mockResolvedValue([
        {
          glossary_id: 'gloss-1',
          name: 'tech-terms',
          source_lang: 'en',
          target_langs: ['es'],
          dictionaries: [{
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          }],
          creation_time: '2024-01-01T00:00:00Z',
        },
        {
          glossary_id: 'gloss-2',
          name: 'legal-terms',
          source_lang: 'en',
          target_langs: ['de'],
          dictionaries: [{
            source_lang: 'en',
            target_lang: 'de',
            entry_count: 25,
          }],
          creation_time: '2024-01-02T00:00:00Z',
        },
      ]);

      const glossaries = await glossaryService.listGlossaries();

      expect(glossaries).toHaveLength(2);
      expect(glossaries[0]?.name).toBe('tech-terms');
      expect(glossaries[1]?.name).toBe('legal-terms');
    });

    it('should return empty array when no glossaries exist', async () => {
      mockDeepLClient.listGlossaries.mockResolvedValue([]);

      const glossaries = await glossaryService.listGlossaries();

      expect(glossaries).toHaveLength(0);
    });
  });

  describe('getGlossary()', () => {
    it('should get glossary by ID', async () => {
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'tech-terms',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 10,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      const glossary = await glossaryService.getGlossary('test-123');

      expect(glossary.glossary_id).toBe('test-123');
      expect(glossary.name).toBe('tech-terms');
      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('test-123');
    });

    it('should throw error for non-existent glossary', async () => {
      mockDeepLClient.getGlossary.mockRejectedValue(
        new Error('Glossary not found')
      );

      await expect(
        glossaryService.getGlossary('non-existent')
      ).rejects.toThrow('Glossary not found');
    });
  });

  describe('getGlossaryByName()', () => {
    it('should find glossary by name', async () => {
      mockDeepLClient.listGlossaries.mockResolvedValue([
        {
          glossary_id: 'test-123',
          name: 'tech-terms',
          source_lang: 'en',
          target_langs: ['es'],
          dictionaries: [{
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          }],
          creation_time: '2024-01-01T00:00:00Z',
        },
      ]);

      const glossary = await glossaryService.getGlossaryByName('tech-terms');

      expect(glossary?.glossary_id).toBe('test-123');
      expect(glossary?.name).toBe('tech-terms');
    });

    it('should return null for non-existent name', async () => {
      mockDeepLClient.listGlossaries.mockResolvedValue([]);

      const glossary = await glossaryService.getGlossaryByName('non-existent');

      expect(glossary).toBeNull();
    });

    it('should warn when the matched glossary itself has empty dictionaries', async () => {
      const { Logger } = await import('../../src/utils/logger.js');
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      try {
        mockDeepLClient.listGlossaries.mockResolvedValue([
          {
            glossary_id: 'empty-123',
            name: 'still-processing',
            source_lang: 'en',
            target_langs: [],
            dictionaries: [],
            creation_time: '2024-01-01T00:00:00Z',
          },
        ]);

        const glossary = await glossaryService.getGlossaryByName('still-processing');

        expect(glossary?.glossary_id).toBe('empty-123');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('empty dictionaries'));
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('resolveGlossaryId()', () => {
    it('should return UUID directly when given a valid glossary ID', async () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

      const result = await glossaryService.resolveGlossaryId(uuid);

      expect(result).toBe(uuid);
      expect(mockDeepLClient.listGlossaries).not.toHaveBeenCalled();
    });

    it('should look up glossary by name when given a non-UUID string', async () => {
      mockDeepLClient.listGlossaries.mockResolvedValue([
        {
          glossary_id: 'found-glossary-id',
          name: 'tech-terms',
          source_lang: 'en',
          target_langs: ['es'],
          dictionaries: [{
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          }],
          creation_time: '2024-01-01T00:00:00Z',
        },
      ]);

      const result = await glossaryService.resolveGlossaryId('tech-terms');

      expect(result).toBe('found-glossary-id');
      expect(mockDeepLClient.listGlossaries).toHaveBeenCalled();
    });

    it('should throw ConfigError when glossary name is not found', async () => {
      mockDeepLClient.listGlossaries.mockResolvedValue([]);

      await expect(
        glossaryService.resolveGlossaryId('non-existent-glossary')
      ).rejects.toThrow('Glossary "non-existent-glossary" not found');
    });

    it('should handle case-sensitive UUID matching', async () => {
      const uppercaseUuid = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';

      const result = await glossaryService.resolveGlossaryId(uppercaseUuid);

      expect(result).toBe(uppercaseUuid);
      expect(mockDeepLClient.listGlossaries).not.toHaveBeenCalled();
    });

    it('should emit a verbose log with resolved glossary name -> UUID after name lookup', async () => {
      mockDeepLClient.listGlossaries.mockResolvedValue([
        {
          glossary_id: 'resolved-glossary-id',
          name: 'tech-terms',
          source_lang: 'en',
          target_langs: ['es'],
          dictionaries: [{ source_lang: 'en', target_lang: 'es', entry_count: 1 }],
          creation_time: '2024-01-01T00:00:00Z',
        },
      ]);
      const { Logger } = jest.requireActual('../../src/utils/logger');
      const spy = jest.spyOn(Logger, 'verbose').mockImplementation(() => {});

      await glossaryService.resolveGlossaryId('tech-terms');

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Resolved glossary "tech-terms" -> resolved-glossary-id')
      );
      spy.mockRestore();
    });

    describe('session-scoped cache', () => {
      const TECH_TERMS = {
        glossary_id: 'resolved-glossary-id',
        name: 'tech-terms',
        source_lang: 'en' as const,
        target_langs: ['es' as const],
        dictionaries: [{ source_lang: 'en' as const, target_lang: 'es' as const, entry_count: 1 }],
        creation_time: '2024-01-01T00:00:00Z',
      };

      it('calls listGlossaries exactly once across repeat resolutions of the same name', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);

        const first = await glossaryService.resolveGlossaryId('tech-terms');
        const second = await glossaryService.resolveGlossaryId('tech-terms');
        const third = await glossaryService.resolveGlossaryId('tech-terms');

        expect(first).toBe('resolved-glossary-id');
        expect(second).toBe('resolved-glossary-id');
        expect(third).toBe('resolved-glossary-id');
        expect(mockDeepLClient.listGlossaries).toHaveBeenCalledTimes(1);
      });

      it('emits a cache-hit verbose log on repeat resolutions', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);
        const { Logger } = jest.requireActual('../../src/utils/logger');
        const spy = jest.spyOn(Logger, 'verbose').mockImplementation(() => {});

        await glossaryService.resolveGlossaryId('tech-terms');
        spy.mockClear();
        await glossaryService.resolveGlossaryId('tech-terms');

        expect(spy).toHaveBeenCalledWith(
          expect.stringContaining('Glossary cache hit: "tech-terms" -> resolved-glossary-id'),
        );
        spy.mockRestore();
      });

      it('invalidates the cache on createGlossary so a stale name→id does not linger', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);
        mockDeepLClient.createGlossary.mockResolvedValue({
          ...TECH_TERMS,
          glossary_id: 'new-glossary-id',
        });

        await glossaryService.resolveGlossaryId('tech-terms');
        await glossaryService.createGlossary('other', 'en', ['es'], { a: 'b' });
        await glossaryService.resolveGlossaryId('tech-terms');

        expect(mockDeepLClient.listGlossaries).toHaveBeenCalledTimes(2);
      });

      it('invalidates the cache on deleteGlossary', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);
        mockDeepLClient.deleteGlossary.mockResolvedValue(undefined);

        await glossaryService.resolveGlossaryId('tech-terms');
        await glossaryService.deleteGlossary('resolved-glossary-id');
        await glossaryService.resolveGlossaryId('tech-terms');

        expect(mockDeepLClient.listGlossaries).toHaveBeenCalledTimes(2);
      });

      it('UUID fast-path does not populate or consult the cache', async () => {
        const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

        await glossaryService.resolveGlossaryId(uuid);
        await glossaryService.resolveGlossaryId(uuid);

        expect(mockDeepLClient.listGlossaries).not.toHaveBeenCalled();
      });
    });

    describe('shared list cache', () => {
      const TECH_TERMS = {
        glossary_id: 'resolved-glossary-id',
        name: 'tech-terms',
        source_lang: 'en' as const,
        target_langs: ['es' as const],
        dictionaries: [{ source_lang: 'en' as const, target_lang: 'es' as const, entry_count: 1 }],
        creation_time: '2024-01-01T00:00:00Z',
      };

      it('getGlossaryByName consults the session list cache so N successive lookups issue 1 list call', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);

        const first = await glossaryService.getGlossaryByName('tech-terms');
        const second = await glossaryService.getGlossaryByName('tech-terms');
        const third = await glossaryService.getGlossaryByName('tech-terms');

        expect(first?.glossary_id).toBe('resolved-glossary-id');
        expect(second?.glossary_id).toBe('resolved-glossary-id');
        expect(third?.glossary_id).toBe('resolved-glossary-id');
        expect(mockDeepLClient.listGlossaries).toHaveBeenCalledTimes(1);
      });

      it('resolveGlossaryId and getGlossaryByName share the list cache (one call total)', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);

        await glossaryService.resolveGlossaryId('tech-terms');
        const resolved = await glossaryService.getGlossaryByName('tech-terms');

        expect(resolved?.glossary_id).toBe('resolved-glossary-id');
        expect(mockDeepLClient.listGlossaries).toHaveBeenCalledTimes(1);
      });

      it('list cache expires after the TTL window, forcing a fresh list call', async () => {
        jest.useFakeTimers();
        try {
          mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);

          await glossaryService.getGlossaryByName('tech-terms');
          jest.advanceTimersByTime(61_000);
          await glossaryService.getGlossaryByName('tech-terms');

          expect(mockDeepLClient.listGlossaries).toHaveBeenCalledTimes(2);
        } finally {
          jest.useRealTimers();
        }
      });

      it('createGlossary invalidates the list cache so getGlossaryByName re-fetches', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([TECH_TERMS]);
        mockDeepLClient.createGlossary.mockResolvedValue({
          ...TECH_TERMS,
          glossary_id: 'fresh-id',
          name: 'brand-new',
        });

        await glossaryService.getGlossaryByName('tech-terms');
        await glossaryService.createGlossary('brand-new', 'en', ['es'], { a: 'b' });
        await glossaryService.getGlossaryByName('tech-terms');

        expect(mockDeepLClient.listGlossaries).toHaveBeenCalledTimes(2);
      });
    });

    describe('API-returned name trust boundary', () => {
      const cleanGlossary = {
        glossary_id: 'clean-id',
        name: 'prod-gloss',
        source_lang: 'en' as const,
        target_langs: ['es' as const],
        dictionaries: [{ source_lang: 'en' as const, target_lang: 'es' as const, entry_count: 1 }],
        creation_time: '2024-01-01T00:00:00Z',
      };

      it('treats a glossary whose name contains a zero-width space as non-existent (silent skip)', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([
          { ...cleanGlossary, glossary_id: 'poisoned-id', name: 'prod-gloss\u200B' },
        ]);

        await expect(
          glossaryService.resolveGlossaryId('prod-gloss\u200B'),
        ).rejects.toThrow(/not found/);
      });

      it('treats a glossary whose name contains an ASCII control char as non-existent (silent skip)', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([
          { ...cleanGlossary, glossary_id: 'poisoned-id', name: 'prod-gloss\x00' },
        ]);

        await expect(
          glossaryService.resolveGlossaryId('prod-gloss\x00'),
        ).rejects.toThrow(/not found/);
      });

      it('throws ConfigError with a UUID-disambiguation hint when two glossaries share the same name', async () => {
        expect.assertions(3);
        mockDeepLClient.listGlossaries.mockResolvedValue([
          { ...cleanGlossary, glossary_id: 'first-id', name: 'shared' },
          { ...cleanGlossary, glossary_id: 'second-id', name: 'shared' },
        ]);

        let thrown: unknown;
        try {
          await glossaryService.resolveGlossaryId('shared');
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(ConfigError);
        const err = thrown as ConfigError;
        expect(err.message).toMatch(/Multiple glossaries share the name/);
        expect(err.suggestion).toMatch(/UUID/);
      });

      it('does not echo raw control chars from the caller input into the error message', async () => {
        expect.assertions(3);
        mockDeepLClient.listGlossaries.mockResolvedValue([]);
        const dirty = 'bad\x07name';

        let thrown: unknown;
        try {
          await glossaryService.resolveGlossaryId(dirty);
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(ConfigError);
        const err = thrown as ConfigError;
        expect(err.message).not.toContain('\x07');
        expect(err.message).toContain('badname');
      });

      it('legit unambiguous name still resolves even when a filtered sibling exists', async () => {
        mockDeepLClient.listGlossaries.mockResolvedValue([
          { ...cleanGlossary, glossary_id: 'legit-id', name: 'prod-gloss' },
          { ...cleanGlossary, glossary_id: 'poisoned-id', name: 'prod-gloss\x00' },
        ]);

        const resolved = await glossaryService.resolveGlossaryId('prod-gloss');

        expect(resolved).toBe('legit-id');
      });
    });
  });

  describe('deleteGlossary()', () => {
    it('should delete glossary by ID', async () => {
      mockDeepLClient.deleteGlossary.mockResolvedValue(undefined);

      await glossaryService.deleteGlossary('test-123');

      expect(mockDeepLClient.deleteGlossary).toHaveBeenCalledWith('test-123');
    });

    it('should throw error when deleting non-existent glossary', async () => {
      mockDeepLClient.deleteGlossary.mockRejectedValue(
        new Error('Glossary not found')
      );

      await expect(
        glossaryService.deleteGlossary('non-existent')
      ).rejects.toThrow('Glossary not found');
    });
  });

  describe('getGlossaryEntries()', () => {
    it('should get glossary entries', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue(
        'API\tAPI\nREST\tREST\nHello\tHola'
      );

      const entries = await glossaryService.getGlossaryEntries('test-123', 'en', 'es');

      expect(entries).toEqual({
        API: 'API',
        REST: 'REST',
        Hello: 'Hola',
      });
      expect(mockDeepLClient.getGlossaryEntries).toHaveBeenCalledWith('test-123', 'en', 'es');
    });

    it('should handle empty glossary', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('');

      const entries = await glossaryService.getGlossaryEntries('test-123', 'en', 'es');

      expect(entries).toEqual({});
      expect(mockDeepLClient.getGlossaryEntries).toHaveBeenCalledWith('test-123', 'en', 'es');
    });
  });

  describe('entriesToTSV()', () => {
    it('should convert entries object to TSV format', () => {
      const entries = {
        API: 'API',
        REST: 'REST',
        Hello: 'Hola',
      };

      const tsv = GlossaryService.entriesToTSV(entries);

      expect(tsv).toBe('API\tAPI\nREST\tREST\nHello\tHola');
    });

    it('should handle empty entries', () => {
      const tsv = GlossaryService.entriesToTSV({});
      expect(tsv).toBe('');
    });
  });

  describe('tsvToEntries()', () => {
    it('should convert TSV to entries object', () => {
      const tsv = 'API\tAPI\nREST\tREST\nHello\tHola';

      const entries = GlossaryService.tsvToEntries(tsv);

      expect(entries).toEqual({
        API: 'API',
        REST: 'REST',
        Hello: 'Hola',
      });
    });

    it('should handle CSV format', () => {
      const csv = 'API,API\nREST,REST\nHello,Hola';

      const entries = GlossaryService.tsvToEntries(csv);

      expect(entries).toEqual({
        API: 'API',
        REST: 'REST',
        Hello: 'Hola',
      });
    });

    it('should skip invalid lines', () => {
      const tsv = 'API\tAPI\nINVALID\nREST\tREST';

      const entries = GlossaryService.tsvToEntries(tsv);

      expect(entries).toEqual({
        API: 'API',
        REST: 'REST',
      });
    });

    it('should handle CSV with quoted commas (Issue #5)', () => {
      // CSV standard: commas inside quotes should not split fields
      const csv = '"hello, world",hola mundo\n"goodbye, friend",adiós amigo';

      const entries = GlossaryService.tsvToEntries(csv);

      expect(entries).toEqual({
        'hello, world': 'hola mundo',
        'goodbye, friend': 'adiós amigo',
      });
    });

    it('should handle CSV with escaped quotes inside quoted fields (Issue #5)', () => {
      // CSV standard: quotes inside quotes are escaped by doubling them
      const csv = '"say ""hello""","di ""hola"""';

      const entries = GlossaryService.tsvToEntries(csv);

      expect(entries).toEqual({
        'say "hello"': 'di "hola"',
      });
    });

    it('should handle CSV with mixed quoted and unquoted fields (Issue #5)', () => {
      const csv = 'API,API\n"hello, world",hola\nREST,REST';

      const entries = GlossaryService.tsvToEntries(csv);

      expect(entries).toEqual({
        API: 'API',
        'hello, world': 'hola',
        REST: 'REST',
      });
    });

    it('should handle CSV with whitespace around quoted fields (Issue #5)', () => {
      // Whitespace outside quotes is typically preserved in CSV
      const csv = ' "hello, world" , hola mundo ';

      const entries = GlossaryService.tsvToEntries(csv);

      // After trimming quotes and whitespace
      expect(entries).toEqual({
        'hello, world': 'hola mundo',
      });
    });

    describe('dialect selection', () => {
      it('should not tab-split a quoted CSV field in a CSV file', () => {
        const csv = 'API,API\n"tab\there,inside",valor';

        const entries = GlossaryService.tsvToEntries(csv);

        // Tab-splitting the second line would have produced the garbage key
        // '"tab' with value 'here,inside",valor'.
        expect(Object.keys(entries)).toEqual(['API']);
      });

      it('should skip an entry whose parsed field contains a tab or newline', () => {
        const csv = 'API,API\n"bad\tterm",valor\nHello,Hola';

        const entries = GlossaryService.tsvToEntries(csv);

        expect(entries).toEqual({ API: 'API', Hello: 'Hola' });
      });

      it('should keep parsing a TSV file as TSV when a later value contains commas', () => {
        const tsv = 'API\tAPI\nHello\tHola, mundo';

        const entries = GlossaryService.tsvToEntries(tsv);

        expect(entries).toEqual({
          API: 'API',
          Hello: 'Hola, mundo',
        });
      });
    });
  });

  describe('addEntry()', () => {
    it('should add a new entry to glossary', async () => {
      // Mock getting existing entries
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI\nREST\tREST');

      // Mock updating glossary entries
      mockDeepLClient.updateGlossaryEntries.mockResolvedValue(undefined);

      await glossaryService.addEntry('test-123', 'en', 'es', 'Hello', 'Hola');

      expect(mockDeepLClient.getGlossaryEntries).toHaveBeenCalledWith('test-123', 'en', 'es');
      expect(mockDeepLClient.updateGlossaryEntries).toHaveBeenCalledWith(
        'test-123',
        'en',
        'es',
        'API\tAPI\nREST\tREST\nHello\tHola'
      );
    });

    it('should throw error if entry already exists', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI\nREST\tREST');

      await expect(
        glossaryService.addEntry('test-123', 'en', 'es', 'API', 'Interface')
      ).rejects.toThrow('Entry "API" already exists in glossary');
    });

    it('should validate source text is not empty', async () => {
      await expect(
        glossaryService.addEntry('test-123', 'en', 'es', '', 'target')
      ).rejects.toThrow('Source text cannot be empty');
    });

    it('should validate target text is not empty', async () => {
      await expect(
        glossaryService.addEntry('test-123', 'en', 'es', 'source', '')
      ).rejects.toThrow('Target text cannot be empty');
    });

    it('should reject source text containing a tab', async () => {
      await expect(
        glossaryService.addEntry('test-123', 'en', 'es', 'Col\tumn', 'Columna')
      ).rejects.toThrow(ValidationError);
      await expect(
        glossaryService.addEntry('test-123', 'en', 'es', 'Col\tumn', 'Columna')
      ).rejects.toThrow(/tab/i);
      expect(mockDeepLClient.updateGlossaryEntries).not.toHaveBeenCalled();
    });

    it('should reject target text containing a newline', async () => {
      await expect(
        glossaryService.addEntry('test-123', 'en', 'es', 'Line', 'Lí\nnea')
      ).rejects.toThrow(/newline/i);
      expect(mockDeepLClient.updateGlossaryEntries).not.toHaveBeenCalled();
    });

    it('should reject source text containing a carriage return', async () => {
      await expect(
        glossaryService.addEntry('test-123', 'en', 'es', 'Line\r', 'Línea')
      ).rejects.toThrow(/carriage return/i);
    });
  });

  describe('updateEntry()', () => {
    it('should update an existing entry', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI\nREST\tREST');
      mockDeepLClient.updateGlossaryEntries.mockResolvedValue(undefined);

      await glossaryService.updateEntry('test-123', 'en', 'es', 'API', 'Interface');

      expect(mockDeepLClient.getGlossaryEntries).toHaveBeenCalledWith('test-123', 'en', 'es');
      expect(mockDeepLClient.updateGlossaryEntries).toHaveBeenCalledWith(
        'test-123',
        'en',
        'es',
        'API\tInterface\nREST\tREST'
      );
    });

    it('should throw error if entry does not exist', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI\nREST\tREST');

      await expect(
        glossaryService.updateEntry('test-123', 'en', 'es', 'NonExistent', 'target')
      ).rejects.toThrow('Entry "NonExistent" not found in glossary');
    });

    it('should validate source text is not empty', async () => {
      await expect(
        glossaryService.updateEntry('test-123', 'en', 'es', '', 'target')
      ).rejects.toThrow('Source text cannot be empty');
    });

    it('should validate target text is not empty', async () => {
      await expect(
        glossaryService.updateEntry('test-123', 'en', 'es', 'source', '')
      ).rejects.toThrow('Target text cannot be empty');
    });

    it('should reject a new target text containing a tab', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI');

      await expect(
        glossaryService.updateEntry('test-123', 'en', 'es', 'API', 'Inter\tface')
      ).rejects.toThrow(/tab/i);
      expect(mockDeepLClient.updateGlossaryEntries).not.toHaveBeenCalled();
    });

    it('should reject a new target text containing a newline', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI');

      await expect(
        glossaryService.updateEntry('test-123', 'en', 'es', 'API', 'Inter\nface')
      ).rejects.toThrow(/newline/i);
    });
  });

  describe('removeEntry()', () => {
    it('should remove an entry from glossary', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI\nREST\tREST\nHello\tHola');
      mockDeepLClient.updateGlossaryEntries.mockResolvedValue(undefined);

      await glossaryService.removeEntry('test-123', 'en', 'es', 'Hello');

      expect(mockDeepLClient.getGlossaryEntries).toHaveBeenCalledWith('test-123', 'en', 'es');
      expect(mockDeepLClient.updateGlossaryEntries).toHaveBeenCalledWith(
        'test-123',
        'en',
        'es',
        'API\tAPI\nREST\tREST'
      );
    });

    it('should throw error if entry does not exist', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI\nREST\tREST');

      await expect(
        glossaryService.removeEntry('test-123', 'en', 'es', 'NonExistent')
      ).rejects.toThrow('Entry "NonExistent" not found in glossary');
    });

    it('should validate source text is not empty', async () => {
      await expect(
        glossaryService.removeEntry('test-123', 'en', 'es', '')
      ).rejects.toThrow('Source text cannot be empty');
    });

    it('should throw error if removing would leave glossary empty', async () => {
      mockDeepLClient.getGlossaryEntries.mockResolvedValue('API\tAPI');

      await expect(
        glossaryService.removeEntry('test-123', 'en', 'es', 'API')
      ).rejects.toThrow('Cannot remove last entry from glossary. Delete the glossary instead.');
    });
  });

  describe('updateGlossary()', () => {
    it('should update glossary name only', async () => {
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'old-name',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      mockDeepLClient.updateGlossary.mockResolvedValue(undefined);

      await glossaryService.updateGlossary('test-123', { name: 'new-name' });

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('test-123');
      expect(mockDeepLClient.updateGlossary).toHaveBeenCalledWith('test-123', { name: 'new-name' });
    });

    it('should update dictionaries only', async () => {
      mockDeepLClient.updateGlossary.mockResolvedValue(undefined);

      await glossaryService.updateGlossary('test-123', {
        dictionaries: [{
          sourceLang: 'en',
          targetLang: 'es',
          entries: { Hello: 'Hola' },
        }],
      });

      expect(mockDeepLClient.updateGlossary).toHaveBeenCalledWith('test-123', {
        dictionaries: [{
          source_lang: 'EN',
          target_lang: 'ES',
          entries: 'Hello\tHola',
          entries_format: 'tsv',
        }],
      });
    });

    it('should combine name and dictionaries in a single call', async () => {
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'old-name',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      mockDeepLClient.updateGlossary.mockResolvedValue(undefined);

      await glossaryService.updateGlossary('test-123', {
        name: 'new-name',
        dictionaries: [{
          sourceLang: 'en',
          targetLang: 'es',
          entries: { Hello: 'Hola', World: 'Mundo' },
        }],
      });

      expect(mockDeepLClient.updateGlossary).toHaveBeenCalledWith('test-123', {
        name: 'new-name',
        dictionaries: [{
          source_lang: 'EN',
          target_lang: 'ES',
          entries: 'Hello\tHola\nWorld\tMundo',
          entries_format: 'tsv',
        }],
      });
    });

    it('should throw when neither name nor dictionaries provided', async () => {
      await expect(
        glossaryService.updateGlossary('test-123', {})
      ).rejects.toThrow('At least one of name or dictionaries must be provided');
    });

    it('should validate new name is not empty', async () => {
      await expect(
        glossaryService.updateGlossary('test-123', { name: '' })
      ).rejects.toThrow('New glossary name cannot be empty');
    });

    it('should validate new name is different from current name', async () => {
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'same-name',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      await expect(
        glossaryService.updateGlossary('test-123', { name: 'same-name' })
      ).rejects.toThrow('New name must be different from current name');
    });

    it('should handle API errors', async () => {
      mockDeepLClient.getGlossary.mockRejectedValue(
        new Error('Glossary not found')
      );

      await expect(
        glossaryService.updateGlossary('test-123', { name: 'new-name' })
      ).rejects.toThrow('Glossary not found');
    });
  });

  describe('renameGlossary()', () => {
    it('should delegate to updateGlossary with name', async () => {
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'old-name',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      mockDeepLClient.updateGlossary.mockResolvedValue(undefined);

      await glossaryService.renameGlossary('test-123', 'new-name');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('test-123');
      expect(mockDeepLClient.updateGlossary).toHaveBeenCalledWith('test-123', { name: 'new-name' });
    });

    it('should validate new name is not empty', async () => {
      await expect(
        glossaryService.renameGlossary('test-123', '')
      ).rejects.toThrow('New glossary name cannot be empty');
    });

    it('should validate new name is different from current name', async () => {
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'test-123',
        name: 'same-name',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [{
          source_lang: 'en',
          target_lang: 'es',
          entry_count: 3,
        }],
        creation_time: '2024-01-01T00:00:00Z',
      });

      await expect(
        glossaryService.renameGlossary('test-123', 'same-name')
      ).rejects.toThrow('New name must be different from current name');
    });

    it('should handle API errors', async () => {
      mockDeepLClient.getGlossary.mockRejectedValue(
        new Error('Glossary not found')
      );

      await expect(
        glossaryService.renameGlossary('test-123', 'new-name')
      ).rejects.toThrow('Glossary not found');
    });
  });

  describe('deleteGlossaryDictionary()', () => {
    it('should delete a dictionary from a multilingual glossary', async () => {
      // Mock a multilingual glossary with 3 dictionaries
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'multi-gloss-123',
        name: 'multi-glossary',
        source_lang: 'en',
        target_langs: ['es', 'fr', 'de'],
        dictionaries: [
          {
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          },
          {
            source_lang: 'en',
            target_lang: 'fr',
            entry_count: 12,
          },
          {
            source_lang: 'en',
            target_lang: 'de',
            entry_count: 8,
          },
        ],
        creation_time: '2024-01-01T00:00:00Z',
      });

      mockDeepLClient.deleteGlossaryDictionary.mockResolvedValue(undefined);

      await glossaryService.deleteGlossaryDictionary('multi-gloss-123', 'en', 'fr');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('multi-gloss-123');
      expect(mockDeepLClient.deleteGlossaryDictionary).toHaveBeenCalledWith(
        'multi-gloss-123',
        'en',
        'fr'
      );
    });

    it('should throw error when deleting dictionary from single-language glossary', async () => {
      // Mock a single-language glossary
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'single-gloss-123',
        name: 'single-glossary',
        source_lang: 'en',
        target_langs: ['es'],
        dictionaries: [
          {
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          },
        ],
        creation_time: '2024-01-01T00:00:00Z',
      });

      await expect(
        glossaryService.deleteGlossaryDictionary('single-gloss-123', 'en', 'es')
      ).rejects.toThrow('Cannot delete dictionary from single-language glossary. Delete the entire glossary instead.');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('single-gloss-123');
      expect(mockDeepLClient.deleteGlossaryDictionary).not.toHaveBeenCalled();
    });

    it('should throw error when deleting last dictionary from multilingual glossary', async () => {
      // Mock a glossary that has 2 target_langs but only 1 remaining dictionary
      // (e.g., after deleting other dictionaries)
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'last-dict-123',
        name: 'last-dict-glossary',
        source_lang: 'en',
        target_langs: ['es', 'fr'], // Still marked as multilingual
        dictionaries: [
          {
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          },
        ],
        creation_time: '2024-01-01T00:00:00Z',
      });

      await expect(
        glossaryService.deleteGlossaryDictionary('last-dict-123', 'en', 'es')
      ).rejects.toThrow('Cannot delete last dictionary from glossary. Delete the entire glossary instead.');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('last-dict-123');
      expect(mockDeepLClient.deleteGlossaryDictionary).not.toHaveBeenCalled();
    });

    it('should throw error when specified dictionary does not exist in glossary', async () => {
      // Mock a multilingual glossary without the requested dictionary
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'multi-gloss-123',
        name: 'multi-glossary',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          {
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          },
          {
            source_lang: 'en',
            target_lang: 'fr',
            entry_count: 12,
          },
        ],
        creation_time: '2024-01-01T00:00:00Z',
      });

      await expect(
        glossaryService.deleteGlossaryDictionary('multi-gloss-123', 'en', 'de')
      ).rejects.toThrow('Dictionary en-de not found in glossary');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('multi-gloss-123');
      expect(mockDeepLClient.deleteGlossaryDictionary).not.toHaveBeenCalled();
    });

    it('should handle case-insensitive language code matching', async () => {
      // Mock a multilingual glossary - API might return uppercase codes
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'multi-gloss-123',
        name: 'multi-glossary',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          {
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          },
          {
            source_lang: 'en',
            target_lang: 'fr',
            entry_count: 12,
          },
        ],
        creation_time: '2024-01-01T00:00:00Z',
      } as any); // Cast to any to allow runtime uppercase comparison test

      // Override dictionaries with uppercase for case-insensitivity test
      const glossaryResponse = {
        glossary_id: 'multi-gloss-123',
        name: 'multi-glossary',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          {
            source_lang: 'EN',
            target_lang: 'ES',
            entry_count: 10,
          },
          {
            source_lang: 'EN',
            target_lang: 'FR',
            entry_count: 12,
          },
        ],
        creation_time: '2024-01-01T00:00:00Z',
      };

      mockDeepLClient.getGlossary.mockResolvedValue(glossaryResponse as any);
      mockDeepLClient.deleteGlossaryDictionary.mockResolvedValue(undefined);

      // Request with lowercase codes should still match uppercase dictionary entries
      await glossaryService.deleteGlossaryDictionary('multi-gloss-123', 'en', 'fr');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('multi-gloss-123');
      expect(mockDeepLClient.deleteGlossaryDictionary).toHaveBeenCalledWith(
        'multi-gloss-123',
        'en',
        'fr'
      );
    });

    it('should handle API errors from getGlossary', async () => {
      mockDeepLClient.getGlossary.mockRejectedValue(
        new Error('Glossary not found')
      );

      await expect(
        glossaryService.deleteGlossaryDictionary('non-existent', 'en', 'es')
      ).rejects.toThrow('Glossary not found');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('non-existent');
      expect(mockDeepLClient.deleteGlossaryDictionary).not.toHaveBeenCalled();
    });

    it('should handle API errors from deleteGlossaryDictionary', async () => {
      // Mock a valid multilingual glossary
      mockDeepLClient.getGlossary.mockResolvedValue({
        glossary_id: 'multi-gloss-123',
        name: 'multi-glossary',
        source_lang: 'en',
        target_langs: ['es', 'fr'],
        dictionaries: [
          {
            source_lang: 'en',
            target_lang: 'es',
            entry_count: 10,
          },
          {
            source_lang: 'en',
            target_lang: 'fr',
            entry_count: 12,
          },
        ],
        creation_time: '2024-01-01T00:00:00Z',
      });

      mockDeepLClient.deleteGlossaryDictionary.mockRejectedValue(
        new Error('Dictionary deletion failed')
      );

      await expect(
        glossaryService.deleteGlossaryDictionary('multi-gloss-123', 'en', 'fr')
      ).rejects.toThrow('Dictionary deletion failed');

      expect(mockDeepLClient.getGlossary).toHaveBeenCalledWith('multi-gloss-123');
      expect(mockDeepLClient.deleteGlossaryDictionary).toHaveBeenCalledWith(
        'multi-gloss-123',
        'en',
        'fr'
      );
    });
  });

  describe('replaceGlossaryDictionary()', () => {
    it('should replace dictionary entries via PUT', async () => {
      mockDeepLClient.replaceGlossaryDictionary.mockResolvedValue(undefined);

      await glossaryService.replaceGlossaryDictionary(
        'glossary-123', 'en', 'es', 'hello\thola\nworld\tmundo'
      );

      expect(mockDeepLClient.replaceGlossaryDictionary).toHaveBeenCalledWith(
        'glossary-123', 'en', 'es', 'hello\thola\nworld\tmundo'
      );
    });

    it('should reject empty TSV content', async () => {
      await expect(
        glossaryService.replaceGlossaryDictionary('glossary-123', 'en', 'es', '')
      ).rejects.toThrow('No valid entries found');
    });

    it('should reject TSV with only invalid lines', async () => {
      await expect(
        glossaryService.replaceGlossaryDictionary('glossary-123', 'en', 'es', 'invalid-no-tab')
      ).rejects.toThrow('No valid entries found');
    });

    it('should handle API errors', async () => {
      mockDeepLClient.replaceGlossaryDictionary.mockRejectedValue(
        new Error('API error')
      );

      await expect(
        glossaryService.replaceGlossaryDictionary(
          'glossary-123', 'en', 'es', 'hello\thola'
        )
      ).rejects.toThrow('API error');
    });
  });
});

/**
 * Tests for GlossaryClient
 * Covers all glossary CRUD operations
 */

import { GlossaryClient } from '../../src/api/glossary-client.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GlossaryClient', () => {
  let client: GlossaryClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      request: jest.fn(),
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);

    client = new GlossaryClient('test-api-key');
  });

  afterAll(() => {
    client.destroy();
  });

  describe('constructor', () => {
    it('should create a GlossaryClient instance', () => {
      expect(client).toBeInstanceOf(GlossaryClient);
    });

    it('should throw error for empty API key', () => {
      expect(() => new GlossaryClient('')).toThrow('API key is required');
    });
  });

  describe('getGlossaryLanguages()', () => {
    it('should return supported glossary language pairs', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          supported_languages: [
            { source_lang: 'EN', target_lang: 'DE' },
            { source_lang: 'EN', target_lang: 'FR' },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await client.getGlossaryLanguages();

      expect(result).toEqual([
        { sourceLang: 'en', targetLang: 'de' },
        { sourceLang: 'en', targetLang: 'fr' },
      ]);
    });

    it('should handle API errors', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Forbidden' }, headers: {} },
        message: 'Forbidden',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.getGlossaryLanguages()).rejects.toThrow();
    });
  });

  describe('createGlossary()', () => {
    it('should create a glossary successfully', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          glossary_id: 'g-123',
          name: 'My Glossary',
          dictionaries: [
            { source_lang: 'en', target_lang: 'de', entry_count: 2 },
          ],
          creation_time: '2024-01-01T00:00:00Z',
        },
        status: 200,
        headers: {},
      });

      const result = await client.createGlossary(
        'My Glossary',
        'en',
        ['de'],
        'hello\tHallo\nworld\tWelt'
      );

      expect(result.glossary_id).toBe('g-123');
      expect(result.name).toBe('My Glossary');
    });

    it('should throw ValidationError for empty target languages', async () => {
      await expect(
        client.createGlossary('Test', 'en', [], 'entries')
      ).rejects.toThrow('At least one target language is required');
    });

    it('should support multiple target languages', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          glossary_id: 'g-456',
          name: 'Multi',
          dictionaries: [
            { source_lang: 'en', target_lang: 'de', entry_count: 1 },
            { source_lang: 'en', target_lang: 'fr', entry_count: 1 },
          ],
          creation_time: '2024-01-01T00:00:00Z',
        },
        status: 200,
        headers: {},
      });

      const result = await client.createGlossary(
        'Multi',
        'en',
        ['de', 'fr'],
        'hello\tHallo'
      );

      expect(result.dictionaries).toHaveLength(2);
    });

    it('should handle API errors', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 400, data: { message: 'Bad request' }, headers: {} },
        message: 'Bad request',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.createGlossary('Test', 'en', ['de'], 'entries')
      ).rejects.toThrow();
    });
  });

  describe('listGlossaries()', () => {
    it('should return list of glossaries', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          glossaries: [
            {
              glossary_id: 'g-1',
              name: 'Glossary 1',
              dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 5 }],
              creation_time: '2024-01-01T00:00:00Z',
            },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await client.listGlossaries();

      expect(result).toHaveLength(1);
      expect(result[0]!.glossary_id).toBe('g-1');
    });

    it('should not warn about unrelated empty-dictionary glossaries during list scans', async () => {
      const { Logger } = await import('../../src/utils/logger.js');
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      try {
        mockAxiosInstance.request.mockResolvedValue({
          data: {
            glossaries: [
              {
                glossary_id: 'g-empty',
                name: 'Still Processing',
                dictionaries: [],
                creation_time: '2024-01-01T00:00:00Z',
              },
            ],
          },
          status: 200,
          headers: {},
        });

        const result = await client.listGlossaries();

        expect(result).toHaveLength(1);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should return empty array when no glossaries', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: { glossaries: [] },
        status: 200,
        headers: {},
      });

      const result = await client.listGlossaries();

      expect(result).toEqual([]);
    });

    it('should handle missing glossaries field', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {},
        status: 200,
        headers: {},
      });

      const result = await client.listGlossaries();

      expect(result).toEqual([]);
    });

    it('suffixes thrown errors with the [listGlossaries] method context', async () => {
      expect.assertions(2);
      const axiosError = Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Invalid API key' }, headers: {} },
        config: {},
      });
      mockAxiosInstance.request.mockRejectedValue(axiosError);

      let thrown: unknown;
      try {
        await client.listGlossaries();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/\[listGlossaries\]$/);
    });
  });

  describe('getGlossary()', () => {
    it('should return a single glossary', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          glossary_id: 'g-123',
          name: 'Test',
          dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 3 }],
          creation_time: '2024-01-01T00:00:00Z',
        },
        status: 200,
        headers: {},
      });

      const result = await client.getGlossary('g-123');

      expect(result.glossary_id).toBe('g-123');
    });

    it('should throw for invalid glossary ID format', async () => {
      await expect(client.getGlossary('invalid id!')).rejects.toThrow('Invalid glossary ID format');
    });
  });

  describe('deleteGlossary()', () => {
    it('should delete a glossary', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: undefined,
        status: 204,
        headers: {},
      });

      await expect(client.deleteGlossary('g-123')).resolves.toBeUndefined();
    });

    it('should throw for invalid glossary ID format', async () => {
      await expect(client.deleteGlossary('bad id!')).rejects.toThrow('Invalid glossary ID format');
    });
  });

  describe('getGlossaryEntries()', () => {
    it('should return entries string', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          dictionaries: [{
            source_lang: 'en',
            target_lang: 'de',
            entries: 'hello\tHallo\nworld\tWelt',
            entries_format: 'tsv',
          }],
        },
        status: 200,
        headers: {},
      });

      const result = await client.getGlossaryEntries('g-123', 'en', 'de');

      expect(result).toBe('hello\tHallo\nworld\tWelt');
    });

    it('should return empty string when no dictionaries', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: { dictionaries: [] },
        status: 200,
        headers: {},
      });

      const result = await client.getGlossaryEntries('g-123', 'en', 'de');

      expect(result).toBe('');
    });

    it('should throw for invalid glossary ID format', async () => {
      await expect(
        client.getGlossaryEntries('bad!', 'en', 'de')
      ).rejects.toThrow('Invalid glossary ID format');
    });
  });

  describe('updateGlossaryEntries()', () => {
    it('should update entries', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: undefined,
        status: 200,
        headers: {},
      });

      await expect(
        client.updateGlossaryEntries('g-123', 'en', 'de', 'new\tNeu')
      ).resolves.toBeUndefined();
    });

    it('should throw for invalid ID', async () => {
      await expect(
        client.updateGlossaryEntries('bad!', 'en', 'de', 'data')
      ).rejects.toThrow('Invalid glossary ID format');
    });
  });

  describe('replaceGlossaryDictionary()', () => {
    it('should replace dictionary', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: undefined,
        status: 200,
        headers: {},
      });

      await expect(
        client.replaceGlossaryDictionary('g-123', 'en', 'de', 'replaced\tErsetzt')
      ).resolves.toBeUndefined();
    });
  });

  describe('updateGlossary()', () => {
    it('should update glossary name', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: undefined,
        status: 200,
        headers: {},
      });

      await expect(
        client.updateGlossary('g-123', { name: 'New Name' })
      ).resolves.toBeUndefined();
    });

    it('should throw when no updates provided', async () => {
      await expect(
        client.updateGlossary('g-123', {})
      ).rejects.toThrow('At least one of name or dictionaries must be provided');
    });

    it('should throw for invalid glossary ID', async () => {
      await expect(
        client.updateGlossary('bad!', { name: 'Test' })
      ).rejects.toThrow('Invalid glossary ID format');
    });
  });

  describe('renameGlossary()', () => {
    it('should rename glossary', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: undefined,
        status: 200,
        headers: {},
      });

      await expect(
        client.renameGlossary('g-123', 'Renamed')
      ).resolves.toBeUndefined();
    });
  });

  describe('deleteGlossaryDictionary()', () => {
    it('should delete a dictionary', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: undefined,
        status: 204,
        headers: {},
      });

      await expect(
        client.deleteGlossaryDictionary('g-123', 'en', 'de')
      ).resolves.toBeUndefined();
    });

    it('should throw for invalid glossary ID', async () => {
      await expect(
        client.deleteGlossaryDictionary('bad!', 'en', 'de')
      ).rejects.toThrow('Invalid glossary ID format');
    });
  });
});

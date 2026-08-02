/**
 * Tests for WriteClient
 * Covers improveText with success/error cases
 */

import { WriteClient } from '../../src/api/write-client.js';
import { HttpClient } from '../../src/api/http-client.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WriteClient', () => {
  let client: WriteClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      request: jest.fn(),
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);

    client = new WriteClient('test-api-key');
    jest.spyOn(HttpClient.prototype, 'sleep' as any).mockResolvedValue(undefined);
  });

  afterAll(() => {
    client.destroy();
  });

  describe('constructor', () => {
    it('should create a WriteClient instance', () => {
      expect(client).toBeInstanceOf(WriteClient);
    });

    it('should throw error for empty API key', () => {
      expect(() => new WriteClient('')).toThrow('API key is required');
    });

    it('should use Free API URL by default', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api-free.deepl.com',
        }),
      );
    });

    it('should allow baseUrl override', () => {
      new WriteClient('test-key', { baseUrl: 'https://custom.example.com' });
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.example.com',
        }),
      );
    });
  });

  describe('improveText()', () => {
    it('should improve text successfully', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [
            {
              text: 'This is an improved sentence.',
              target_language: 'en-US',
              detected_source_language: 'en',
            },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await client.improveText('This is a sentence.', {});

      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('This is an improved sentence.');
      expect(result[0]!.targetLanguage).toBe('en-US');
      expect(result[0]!.detectedSourceLanguage).toBe('en');
    });

    it('should pass targetLang option', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [
            { text: 'Improved', target_language: 'en-GB' },
          ],
        },
        status: 200,
        headers: {},
      });

      await client.improveText('Test', { targetLang: 'en-GB' });

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/v2/write/rephrase',
        }),
      );
    });

    it('should pass writingStyle option', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [
            { text: 'Formal text', target_language: 'en-US' },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await client.improveText('casual text', {
        writingStyle: 'business',
      });

      expect(result).toHaveLength(1);
    });

    it('should pass tone option', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [
            { text: 'Friendly text', target_language: 'en-US' },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await client.improveText('text', {
        tone: 'friendly',
      });

      expect(result).toHaveLength(1);
    });

    it('should throw NetworkError when no improvements returned', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: { improvements: [] },
        status: 200,
        headers: {},
      });

      await expect(
        client.improveText('Test', {})
      ).rejects.toThrow('No improvements returned');
    });

    it('should throw NetworkError when improvements field is missing', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {},
        status: 200,
        headers: {},
      });

      await expect(
        client.improveText('Test', {})
      ).rejects.toThrow('No improvements returned');
    });

    it('should handle 403 auth error', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Forbidden' }, headers: {} },
        message: 'Forbidden',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.improveText('Test', {})
      ).rejects.toThrow();
    });

    it('should handle 429 rate limit error', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 429, data: { message: 'Too many requests' }, headers: {} },
        message: 'Rate limited',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.improveText('Test', {})
      ).rejects.toThrow();
    });

    it('should handle 503 service unavailable', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 503, data: { message: 'Unavailable' }, headers: {} },
        message: 'Service unavailable',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.improveText('Test', {})
      ).rejects.toThrow();
    });

    it('should append docs hint on 400 when writingStyle was sent', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 400, data: { message: "Style 'business' is not supported for 'ja'" }, headers: {} },
        message: 'Bad request',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.improveText('Test', { targetLang: 'ja', writingStyle: 'business' })
      ).rejects.toThrow(/See https:\/\/github\.com\/DeepL\/deepl-cli\/blob\/main\/docs\/API\.md#write for supported target language \/ style \/ tone combinations/);
    });

    it('should append docs hint on 400 when tone was sent', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 400, data: { message: "Tone 'friendly' is not supported for 'ko'" }, headers: {} },
        message: 'Bad request',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.improveText('Test', { targetLang: 'ko', tone: 'friendly' })
      ).rejects.toThrow(/See https:\/\/github\.com\/DeepL\/deepl-cli\/blob\/main\/docs\/API\.md#write for supported target language \/ style \/ tone combinations/);
    });

    it('should NOT append docs hint on 400 when neither style nor tone was sent', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 400, data: { message: 'Generic bad request' }, headers: {} },
        message: 'Bad request',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.improveText('Test', { targetLang: 'ja' })
      ).rejects.not.toThrow(/See https:\/\/github\.com\/DeepL\/deepl-cli/);
    });
  });

  describe('correctText()', () => {
    it('should correct text successfully', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [
            {
              text: 'This is a test.',
              target_language: 'en-US',
              detected_source_language: 'en',
            },
          ],
        },
        status: 200,
        headers: {},
      });

      const result = await client.correctText('This is an test.', {});

      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('This is a test.');
      expect(result[0]!.targetLanguage).toBe('en-US');
      expect(result[0]!.detectedSourceLanguage).toBe('en');
    });

    it('should POST to /v2/write/correct', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [{ text: 'Corrected', target_language: 'en-GB' }],
        },
        status: 200,
        headers: {},
      });

      await client.correctText('Test', { targetLang: 'en-GB' });

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/v2/write/correct',
        }),
      );
    });

    it('should send target_lang and never style or tone params', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [{ text: 'Corrected', target_language: 'en-US' }],
        },
        status: 200,
        headers: {},
      });

      await client.correctText('Test', { targetLang: 'en-US' });

      const body = mockAxiosInstance.request.mock.calls[0][0].data as string;
      expect(body).toContain('target_lang=en-US');
      expect(body).not.toContain('writing_style');
      expect(body).not.toContain('tone');
    });

    it('should omit target_lang when not specified (auto-detect)', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          improvements: [{ text: 'Corrected', target_language: 'de' }],
        },
        status: 200,
        headers: {},
      });

      await client.correctText('Test', {});

      const body = mockAxiosInstance.request.mock.calls[0][0].data as string;
      expect(body).not.toContain('target_lang');
    });

    it('should throw NetworkError when no improvements returned', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: { improvements: [] },
        status: 200,
        headers: {},
      });

      await expect(
        client.correctText('Test', {})
      ).rejects.toThrow('No improvements returned');
    });

    it('should handle 403 auth error', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Forbidden' }, headers: {} },
        message: 'Forbidden',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.correctText('Test', {})
      ).rejects.toThrow();
    });

    it('should NOT append the style/tone docs hint on 400', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 400, data: { message: 'Generic bad request' }, headers: {} },
        message: 'Bad request',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        client.correctText('Test', { targetLang: 'ja' })
      ).rejects.not.toThrow(/See https:\/\/github\.com\/DeepL\/deepl-cli/);
    });
  });
});

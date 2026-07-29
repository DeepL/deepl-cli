/**
 * Tests for Detect Command
 */

 

import { DetectCommand } from '../../src/cli/commands/detect';
import { createMockDetectService } from '../helpers/mock-factories';

jest.mock('chalk', () => {
  const mockChalk = {
    bold: (text: string) => text,
    green: (text: string) => text,
    yellow: (text: string) => text,
    red: (text: string) => text,
    blue: (text: string) => text,
    gray: (text: string) => text,
    cyan: (text: string) => text,
  };
  return {
    __esModule: true,
    default: mockChalk,
  };
});

describe('DetectCommand', () => {
  let mockService: ReturnType<typeof createMockDetectService>;
  let detectCommand: DetectCommand;

  beforeEach(() => {
    jest.clearAllMocks();

    mockService = createMockDetectService({
      detect: jest.fn().mockResolvedValue({
        detectedLanguage: 'fr',
        languageName: 'French',
      }),
    });

    detectCommand = new DetectCommand(mockService);
  });

  describe('detect()', () => {
    it.each([
      { text: 'Bonjour le monde', code: 'fr', name: 'French' },
      { text: 'Hallo Welt', code: 'de', name: 'German' },
      { text: 'こんにちは世界', code: 'ja', name: 'Japanese' },
    ])('should detect $name ($code) from text', async ({ text, code, name }) => {
      mockService.detect = jest.fn().mockResolvedValue({
        detectedLanguage: code,
        languageName: name,
      });

      const result = await detectCommand.detect(text);

      expect(result.detectedLanguage).toBe(code);
      expect(result.languageName).toBe(name);
    });

    it('should delegate to service', async () => {
      await detectCommand.detect('Bonjour');

      expect(mockService.detect).toHaveBeenCalledWith('Bonjour');
    });

    it.each([
      { scenario: 'empty text', input: '' },
      { scenario: 'whitespace-only text', input: '   ' },
    ])('should throw error for $scenario', async ({ input }) => {
      mockService.detect = jest.fn().mockRejectedValue(
        new Error('Text cannot be empty. Provide text to detect language.')
      );

      await expect(detectCommand.detect(input)).rejects.toThrow(
        'Text cannot be empty'
      );
    });

    it('should throw error when API returns no detected language', async () => {
      mockService.detect = jest.fn().mockRejectedValue(
        new Error('Could not detect source language. The text may be too short or ambiguous.')
      );

      await expect(detectCommand.detect('x')).rejects.toThrow(
        'Could not detect source language'
      );
    });

    it('should handle API errors', async () => {
      mockService.detect = jest.fn().mockRejectedValue(
        new Error('API error')
      );

      await expect(detectCommand.detect('Bonjour')).rejects.toThrow('API error');
    });

    it('should handle authentication errors', async () => {
      mockService.detect = jest.fn().mockRejectedValue(
        new Error('Authentication failed: Invalid API key')
      );

      await expect(detectCommand.detect('Bonjour')).rejects.toThrow(
        'Authentication failed: Invalid API key'
      );
    });

    it('should handle quota exceeded errors', async () => {
      mockService.detect = jest.fn().mockRejectedValue(
        new Error('Quota exceeded')
      );

      await expect(detectCommand.detect('Bonjour')).rejects.toThrow(
        'Quota exceeded'
      );
    });

    it('should return language code as name when not in registry', async () => {
      mockService.detect = jest.fn().mockResolvedValue({
        detectedLanguage: 'xx',
        languageName: 'XX',
      });

      const result = await detectCommand.detect('Some text');

      expect(result.detectedLanguage).toBe('xx');
      expect(result.languageName).toBe('XX');
    });

    it('should detect extended languages', async () => {
      mockService.detect = jest.fn().mockResolvedValue({
        detectedLanguage: 'hi',
        languageName: 'Hindi',
      });

      const result = await detectCommand.detect('नमस्ते दुनिया');

      expect(result.detectedLanguage).toBe('hi');
      expect(result.languageName).toBe('Hindi');
    });
  });

  describe('formatPlain()', () => {
    it.each([
      { code: 'fr', name: 'French', expected: 'Detected language: French (fr)' },
      { code: 'de', name: 'German', expected: 'Detected language: German (de)' },
    ])('should format $name ($code) as plain text', ({ code, name, expected }) => {
      const output = detectCommand.formatPlain({
        detectedLanguage: code as any,
        languageName: name,
      });

      expect(output).toBe(expected);
    });
  });

  describe('formatJson()', () => {
    it.each([
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
    ])('should format $name ($code) as valid JSON', ({ code, name }) => {
      const output = detectCommand.formatJson({
        detectedLanguage: code as any,
        languageName: name,
      });

      const parsed = JSON.parse(output);
      expect(parsed).toEqual({
        detected_language: code,
        language_name: name,
      });
    });

    it('should produce pretty-printed JSON', () => {
      const output = detectCommand.formatJson({
        detectedLanguage: 'ja',
        languageName: 'Japanese',
      });

      expect(output).toContain('\n');
      expect(output).toContain('  ');
    });
  });
});

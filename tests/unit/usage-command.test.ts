/**
 * Tests for Usage Command
 */

 

import { UsageCommand } from '../../src/cli/commands/usage';
import { createMockUsageService } from '../helpers/mock-factories';

// Mock chalk to avoid ESM issues in tests
jest.mock('chalk', () => {
  const mockChalk = {
    bold: (text: string) => text,
    green: (text: string) => text,
    yellow: (text: string) => text,
    red: (text: string) => text,
    blue: (text: string) => text,
    gray: (text: string) => text,
  };
  return {
    __esModule: true,
    default: mockChalk,
  };
});

describe('UsageCommand', () => {
  let mockService: ReturnType<typeof createMockUsageService>;
  let usageCommand: UsageCommand;

  beforeEach(() => {
    jest.clearAllMocks();

    mockService = createMockUsageService({
      getUsage: jest.fn().mockResolvedValue({
        characterCount: 123456,
        characterLimit: 500000,
      }),
    });

    usageCommand = new UsageCommand(mockService);
  });

  describe('getUsage()', () => {
    it('should retrieve usage statistics from DeepL API', async () => {
      const usage = await usageCommand.getUsage();

      expect(mockService.getUsage).toHaveBeenCalled();
      expect(usage).toEqual({
        characterCount: 123456,
        characterLimit: 500000,
      });
    });

    it('should calculate usage percentage', async () => {
      const usage = await usageCommand.getUsage();
      const percentage = (usage.characterCount / usage.characterLimit) * 100;

      expect(percentage).toBeCloseTo(24.69, 1);
    });

    it('should handle zero limit gracefully', async () => {
      mockService.getUsage = jest.fn().mockResolvedValue({
        characterCount: 0,
        characterLimit: 0,
      });

      const usage = await usageCommand.getUsage();

      expect(usage.characterCount).toBe(0);
      expect(usage.characterLimit).toBe(0);
    });

    it('should handle API errors', async () => {
      mockService.getUsage = jest.fn().mockRejectedValue(new Error('API error'));

      await expect(usageCommand.getUsage()).rejects.toThrow('API error');
    });

    it('should handle authentication errors', async () => {
      mockService.getUsage = jest.fn().mockRejectedValue(
        new Error('Authentication failed: Invalid API key')
      );

      await expect(usageCommand.getUsage()).rejects.toThrow('Authentication failed: Invalid API key');
    });

    it('should handle quota exceeded errors', async () => {
      mockService.getUsage = jest.fn().mockRejectedValue(
        new Error('Quota exceeded: Character limit reached')
      );

      await expect(usageCommand.getUsage()).rejects.toThrow('Quota exceeded: Character limit reached');
    });
  });

  describe('formatUsage()', () => {
    it('should format usage statistics with colors', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 123456,
        characterLimit: 500000,
      });

      expect(formatted).toContain('Character Usage:');
      expect(formatted).toContain('123,456');
      expect(formatted).toContain('500,000');
      expect(formatted).toContain('24.7%');
    });

    it('should show warning for high usage (>80%)', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 450000,
        characterLimit: 500000,
      });

      expect(formatted).toContain('90.0%');
    });

    it('should format remaining characters', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 123456,
        characterLimit: 500000,
      });

      expect(formatted).toContain('Remaining:');
      expect(formatted).toContain('376,544');
    });

    it('should handle zero limit display', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 0,
        characterLimit: 0,
      });

      expect(formatted).toContain('0');
    });

    it('should display billing period when available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        startTime: '2025-04-24T14:58:02Z',
        endTime: '2025-05-24T14:58:02Z',
      });

      expect(formatted).toContain('Billing Period:');
      expect(formatted).toContain('2025-04-24');
      expect(formatted).toContain('2025-05-24');
    });

    it('should display per-product breakdown when available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        products: [
          { productType: 'translate', characterCount: 900000, apiKeyCharacterCount: 880000 },
          { productType: 'write', characterCount: 1250000, apiKeyCharacterCount: 1000000 },
        ],
      });

      expect(formatted).toContain('Product Breakdown:');
      expect(formatted).toContain('translate');
      expect(formatted).toContain('900,000');
      expect(formatted).toContain('write');
      expect(formatted).toContain('1,250,000');
    });

    it('should display API key-level usage when available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        apiKeyCharacterCount: 1880000,
        apiKeyCharacterLimit: 0,
      });

      expect(formatted).toContain('API Key Usage:');
      expect(formatted).toContain('1,880,000');
    });

    it('should display full Pro response with all fields', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        apiKeyCharacterCount: 1880000,
        apiKeyCharacterLimit: 0,
        startTime: '2025-04-24T14:58:02Z',
        endTime: '2025-05-24T14:58:02Z',
        products: [
          { productType: 'translate', characterCount: 900000, apiKeyCharacterCount: 880000 },
          { productType: 'write', characterCount: 1250000, apiKeyCharacterCount: 1000000 },
        ],
      });

      expect(formatted).toContain('Character Usage:');
      expect(formatted).toContain('Billing Period:');
      expect(formatted).toContain('Product Breakdown:');
      expect(formatted).toContain('API Key Usage:');
    });

    it('should omit Pro sections for Free API response', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 123456,
        characterLimit: 500000,
      });

      expect(formatted).not.toContain('Billing Period:');
      expect(formatted).not.toContain('Product Breakdown:');
      expect(formatted).not.toContain('API Key Usage:');
    });

    it('should display account unit usage when available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        accountUnitCount: 50000,
        accountUnitLimit: 200000,
      });

      expect(formatted).toContain('Account Unit Usage:');
      expect(formatted).toContain('50,000');
      expect(formatted).toContain('200,000 units');
    });

    it('should display API key unit usage when available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        apiKeyUnitCount: 10000,
        apiKeyUnitLimit: 0,
      });

      expect(formatted).toContain('API Key Unit Usage:');
      expect(formatted).toContain('10,000');
      expect(formatted).toContain('unlimited units');
    });

    it('should prefer unit counts over character counts for API key display', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        apiKeyCharacterCount: 1880000,
        apiKeyCharacterLimit: 0,
        apiKeyUnitCount: 10000,
        apiKeyUnitLimit: 50000,
      });

      expect(formatted).toContain('API Key Unit Usage:');
      expect(formatted).not.toContain('API Key Usage:');
    });

    it('should fall back to character counts when unit counts are absent', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        apiKeyCharacterCount: 1880000,
        apiKeyCharacterLimit: 0,
      });

      expect(formatted).toContain('API Key Usage:');
      expect(formatted).not.toContain('API Key Unit Usage:');
    });

    it('should display product unit counts when available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        products: [
          {
            productType: 'translate',
            characterCount: 900000,
            apiKeyCharacterCount: 880000,
            unitCount: 5000,
            apiKeyUnitCount: 4500,
          },
        ],
      });

      expect(formatted).toContain('Product Breakdown:');
      expect(formatted).toContain('translate: 5,000 units (API key: 4,500 units)');
    });

    it('should show unlimited for zero API key character limit', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        apiKeyCharacterCount: 1880000,
        apiKeyCharacterLimit: 0,
      });

      expect(formatted).toContain('unlimited');
    });

    it('should display API key usage with per-product breakdown', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        products: [
          { productType: 'translate', characterCount: 900000, apiKeyCharacterCount: 880000 },
        ],
      });

      expect(formatted).toContain('880,000');
    });

    it('should display speech-to-text usage when available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        speechToTextMillisecondsCount: 3661000,
        speechToTextMillisecondsLimit: 36000000,
      });

      expect(formatted).toContain('Speech-to-Text Usage:');
      expect(formatted).toContain('1h 1m 1s');
      expect(formatted).toContain('10h 0m 0s');
      expect(formatted).toContain('10.2%');
    });

    it('should show warning for high speech-to-text usage', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 100,
        characterLimit: 500000,
        speechToTextMillisecondsCount: 30000000,
        speechToTextMillisecondsLimit: 36000000,
      });

      expect(formatted).toContain('Speech-to-Text Usage:');
      expect(formatted).toContain('83.3%');
      expect(formatted).toContain('Warning: You are approaching your speech-to-text limit');
    });

    it('should format zero speech-to-text usage in seconds, not milliseconds', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 100,
        characterLimit: 500000,
        speechToTextMillisecondsCount: 0,
        speechToTextMillisecondsLimit: 36000000,
      });

      expect(formatted).toContain('Speech-to-Text Usage:');
      expect(formatted).toContain('0s');
      expect(formatted).not.toContain('0ms');
    });

    it('should omit speech-to-text section when not available', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 123456,
        characterLimit: 500000,
      });

      expect(formatted).not.toContain('Speech-to-Text Usage:');
    });

    it('should format product with milliseconds billing unit', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        products: [
          { productType: 'translate', characterCount: 900000, apiKeyCharacterCount: 880000 },
          { productType: 'speech_to_text', characterCount: 3661000, apiKeyCharacterCount: 3661000, billingUnit: 'milliseconds' },
        ],
      });

      expect(formatted).toContain('Product Breakdown:');
      expect(formatted).toContain('translate: 900,000 characters');
      expect(formatted).toContain('speech_to_text: 1h 1m 1s');
    });

    it('should format product with minutes billing unit as a duration', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 0,
        characterLimit: 20000000,
        products: [
          {
            productType: 'speechToText',
            characterCount: 0,
            apiKeyCharacterCount: 0,
            apiKeyUnitCount: 1463,
            billingUnit: 'minutes',
          },
        ],
      });

      expect(formatted).toContain('speech_to_text: 24h 23m 0s (API key: 24h 23m 0s)');
      expect(formatted).not.toContain('speech_to_text: 0 characters');
    });

    it('should prefer unitCount over apiKeyUnitCount for minutes-billed totals', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 0,
        characterLimit: 20000000,
        products: [
          {
            productType: 'speechToText',
            characterCount: 0,
            apiKeyCharacterCount: 0,
            unitCount: 120,
            apiKeyUnitCount: 60,
            billingUnit: 'minutes',
          },
        ],
      });

      expect(formatted).toContain('speech_to_text: 2h 0m 0s (API key: 1h 0m 0s)');
    });

    it('should render camelCase product types with the documented snake_case names', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 0,
        characterLimit: 20000000,
        products: [
          { productType: 'textTranslation', characterCount: 900000, apiKeyCharacterCount: 880000 },
        ],
      });

      expect(formatted).toContain('text_translation: 900,000 characters');
      expect(formatted).not.toContain('textTranslation');
    });

    it('should display full Pro response with speech-to-text', () => {
      const formatted = usageCommand.formatUsage({
        characterCount: 2150000,
        characterLimit: 20000000,
        apiKeyCharacterCount: 1880000,
        apiKeyCharacterLimit: 0,
        speechToTextMillisecondsCount: 120000,
        speechToTextMillisecondsLimit: 36000000,
        startTime: '2025-04-24T14:58:02Z',
        endTime: '2025-05-24T14:58:02Z',
        products: [
          { productType: 'translate', characterCount: 900000, apiKeyCharacterCount: 880000 },
          { productType: 'speech_to_text', characterCount: 120000, apiKeyCharacterCount: 120000, billingUnit: 'milliseconds' },
        ],
      });

      expect(formatted).toContain('Character Usage:');
      expect(formatted).toContain('Speech-to-Text Usage:');
      expect(formatted).toContain('Billing Period:');
      expect(formatted).toContain('API Key Usage:');
      expect(formatted).toContain('Product Breakdown:');
    });
  });

  describe('formatUsageTable', () => {
    it('should render Resource/Used/Limit/Usage columns with the Characters row', () => {
      const result = usageCommand.formatUsageTable({
        characterCount: 250000,
        characterLimit: 500000,
      });
      expect(result).toContain('Resource');
      expect(result).toContain('Used');
      expect(result).toContain('Limit');
      expect(result).toContain('Usage');
      expect(result).toContain('Characters');
      expect(result).toContain('250,000');
      expect(result).toContain('500,000');
      expect(result).toContain('50.0%');
    });

    it('should report unlimited when characterLimit is zero', () => {
      const result = usageCommand.formatUsageTable({
        characterCount: 100,
        characterLimit: 0,
      });
      expect(result).toContain('unlimited');
      expect(result).toContain('—'); // pct() returns em-dash when limit=0
    });

    it('should add API key, account-unit, and STT rows when those fields are present', () => {
      const result = usageCommand.formatUsageTable({
        characterCount: 100,
        characterLimit: 500,
        accountUnitCount: 5,
        accountUnitLimit: 10,
        apiKeyUnitCount: 2,
        apiKeyUnitLimit: 4,
        speechToTextMillisecondsCount: 60000,
        speechToTextMillisecondsLimit: 600000,
      });
      expect(result).toContain('Account units');
      expect(result).toContain('API key units');
      expect(result).toContain('Speech-to-text');
    });

    it('should append a Product Breakdown table when products are present', () => {
      const result = usageCommand.formatUsageTable({
        characterCount: 1000,
        characterLimit: 10000,
        products: [
          { productType: 'translate', characterCount: 900, apiKeyCharacterCount: 800 },
          {
            productType: 'speech_to_text',
            characterCount: 120000,
            apiKeyCharacterCount: 120000,
            billingUnit: 'milliseconds',
          },
        ],
      });
      expect(result).toContain('Product Breakdown:');
      expect(result).toContain('translate');
      expect(result).toContain('speech_to_text');
    });

    it('should render minutes-billed products as durations with snake_case names', () => {
      const result = usageCommand.formatUsageTable({
        characterCount: 1000,
        characterLimit: 10000,
        products: [
          {
            productType: 'speechToText',
            characterCount: 0,
            apiKeyCharacterCount: 0,
            apiKeyUnitCount: 1463,
            billingUnit: 'minutes',
          },
        ],
      });
      expect(result).toContain('speech_to_text');
      expect(result).toContain('24h 23m 0s');
      expect(result).not.toContain('speechToText');
    });
  });
});

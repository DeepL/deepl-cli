import {
  CUSTOM_INSTRUCTION_LOCALES,
  supportsCustomInstructions,
  DEFAULT_INSTRUCTION_TEMPLATES,
  generateElementInstruction,
  mergeInstructions,
  DEFAULT_EXPANSION_FACTORS,
  LENGTH_CONSTRAINED_ELEMENTS,
  generateLengthInstruction,
  MAX_INSTRUCTIONS,
  MAX_INSTRUCTION_LENGTH,
} from '../../../src/sync/sync-instructions';
import { Logger } from '../../../src/utils/logger';

describe('sync-instructions', () => {
  // -------------------------------------------------------------------
  // supportsCustomInstructions
  // -------------------------------------------------------------------
  describe('supportsCustomInstructions', () => {
    it.each(['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'zh'])(
      'should return true for supported base locale %s',
      (locale) => {
        expect(supportsCustomInstructions(locale)).toBe(true);
      },
    );

    it.each(['DE', 'EN'])('should handle uppercase locale %s', (locale) => {
      expect(supportsCustomInstructions(locale)).toBe(true);
    });

    it.each(['en-US', 'en-GB', 'EN-US', 'zh-Hans', 'zh-Hant', 'ZH-HANT'])(
      'should handle regional variant %s',
      (locale) => {
        expect(supportsCustomInstructions(locale)).toBe(true);
      },
    );

    it.each(['ar', 'he', 'pt-BR', 'nl', 'ru', 'tr', 'pl'])(
      'should return false for unsupported locale %s',
      (locale) => {
        expect(supportsCustomInstructions(locale)).toBe(false);
      },
    );

    it('should return false for empty string', () => {
      expect(supportsCustomInstructions('')).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // CUSTOM_INSTRUCTION_LOCALES
  // -------------------------------------------------------------------
  describe('CUSTOM_INSTRUCTION_LOCALES', () => {
    it('should contain exactly 8 supported base locales', () => {
      expect(CUSTOM_INSTRUCTION_LOCALES.size).toBe(8);
    });

    it('should include all expected locales', () => {
      for (const locale of ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'zh']) {
        expect(CUSTOM_INSTRUCTION_LOCALES.has(locale)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------
  // DEFAULT_INSTRUCTION_TEMPLATES
  // -------------------------------------------------------------------
  describe('DEFAULT_INSTRUCTION_TEMPLATES', () => {
    it('should contain 16 element types', () => {
      expect(Object.keys(DEFAULT_INSTRUCTION_TEMPLATES).length).toBe(16);
    });

    it('should include button template', () => {
      expect(DEFAULT_INSTRUCTION_TEMPLATES['button']).toBe(
        'Keep translation concise, maximum 3 words.',
      );
    });
  });

  // -------------------------------------------------------------------
  // generateElementInstruction
  // -------------------------------------------------------------------
  describe('generateElementInstruction', () => {
    it('should return the default instruction for a known element type', () => {
      expect(generateElementInstruction('button')).toBe(
        'Keep translation concise, maximum 3 words.',
      );
    });

    it('should return the correct instruction for each default template', () => {
      for (const [element, expected] of Object.entries(DEFAULT_INSTRUCTION_TEMPLATES)) {
        expect(generateElementInstruction(element)).toBe(expected);
      }
    });

    it('should return undefined for null elementType', () => {
      expect(generateElementInstruction(null)).toBeUndefined();
    });

    it('should return undefined for undefined elementType', () => {
      expect(generateElementInstruction(undefined)).toBeUndefined();
    });

    it('should return undefined for unknown element type', () => {
      expect(generateElementInstruction('div')).toBeUndefined();
      expect(generateElementInstruction('span')).toBeUndefined();
    });

    it('should use user templates to override defaults', () => {
      const userTemplates = { button: 'Max 2 words.' };
      expect(generateElementInstruction('button', userTemplates)).toBe('Max 2 words.');
    });

    it('should allow user templates for types not in defaults', () => {
      const userTemplates = { div: 'Keep it short.' };
      expect(generateElementInstruction('div', userTemplates)).toBe('Keep it short.');
    });

    it('should not affect other types when user overrides one', () => {
      const userTemplates = { button: 'Max 2 words.' };
      expect(generateElementInstruction('a', userTemplates)).toBe(
        DEFAULT_INSTRUCTION_TEMPLATES['a'],
      );
    });
  });

  // -------------------------------------------------------------------
  // mergeInstructions
  // -------------------------------------------------------------------
  describe('mergeInstructions', () => {
    it('should return user instructions only when no auto instruction', () => {
      expect(mergeInstructions(['instruction1'], undefined)).toEqual(['instruction1']);
    });

    it('should return auto instruction only when no user instructions', () => {
      expect(mergeInstructions(undefined, 'auto instruction')).toEqual(['auto instruction']);
    });

    it('should append auto instruction after user instructions', () => {
      expect(mergeInstructions(['user1', 'user2'], 'auto')).toEqual(['user1', 'user2', 'auto']);
    });

    it('should return undefined when both inputs are undefined', () => {
      expect(mergeInstructions(undefined, undefined)).toBeUndefined();
    });

    it('should append auto instruction to empty array', () => {
      expect(mergeInstructions([], 'auto')).toEqual(['auto']);
    });

    it('should preserve empty strings in user instructions', () => {
      expect(mergeInstructions(['', 'valid'], undefined)).toEqual(['', 'valid']);
    });

    it('should return empty array contents when user passes empty array and no auto', () => {
      expect(mergeInstructions([], undefined)).toBeUndefined();
    });

    it('should handle multiple user instructions with auto', () => {
      expect(mergeInstructions(['a', 'b', 'c'], 'auto')).toEqual(['a', 'b', 'c', 'auto']);
    });

    it('should cap at MAX_INSTRUCTIONS when more than 5 instructions provided', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
      const instructions = ['a', 'b', 'c', 'd', 'e', 'f'];
      const result = mergeInstructions(instructions, undefined);
      expect(result).toHaveLength(MAX_INSTRUCTIONS);
      expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds maximum'));
      warnSpy.mockRestore();
    });

    it('should truncate instructions longer than MAX_INSTRUCTION_LENGTH', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
      const longInstruction = 'x'.repeat(MAX_INSTRUCTION_LENGTH + 500);
      const result = mergeInstructions([longInstruction], undefined);
      expect(result).toHaveLength(1);
      expect(result![0]).toHaveLength(MAX_INSTRUCTION_LENGTH);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
      warnSpy.mockRestore();
    });

    it('should both truncate and cap when needed', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
      const instructions = Array.from({ length: 7 }, (_, i) => 'y'.repeat(MAX_INSTRUCTION_LENGTH + i + 1));
      const result = mergeInstructions(instructions, undefined);
      expect(result).toHaveLength(MAX_INSTRUCTIONS);
      expect(result!.every(i => i.length === MAX_INSTRUCTION_LENGTH)).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      warnSpy.mockRestore();
    });

    it('should not warn when instructions are within limits', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
      const result = mergeInstructions(['short', 'also short'], 'auto');
      expect(result).toEqual(['short', 'also short', 'auto']);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------
  // length-aware instructions
  // -------------------------------------------------------------------
  describe('DEFAULT_EXPANSION_FACTORS', () => {
    it('should contain expected locales', () => {
      expect(DEFAULT_EXPANSION_FACTORS['de']).toBe(1.3);
      expect(DEFAULT_EXPANSION_FACTORS['ja']).toBe(0.5);
      expect(DEFAULT_EXPANSION_FACTORS['ko']).toBe(0.7);
    });
  });

  describe('LENGTH_CONSTRAINED_ELEMENTS', () => {
    it('should contain exactly 6 elements', () => {
      expect(LENGTH_CONSTRAINED_ELEMENTS.size).toBe(6);
    });

    it.each(['button', 'th', 'label', 'option', 'input', 'title'])(
      'should include %s',
      (element) => {
        expect(LENGTH_CONSTRAINED_ELEMENTS.has(element)).toBe(true);
      },
    );

    it.each(['a', 'h1', 'h2', 'p', 'div'])(
      'should not include %s',
      (element) => {
        expect(LENGTH_CONSTRAINED_ELEMENTS.has(element)).toBe(false);
      },
    );
  });

  describe('generateLengthInstruction', () => {
    it('should calculate correct max for button "Save" in DE', () => {
      // ceil(4 * 1.3 * 1.1) = ceil(5.72) = 6
      const result = generateLengthInstruction('Save', 'button', 'de');
      expect(result).toBe('Keep translation under 6 characters.');
    });

    it('should calculate correct max for button "Get started" in JA', () => {
      // "Get started" = 11 chars, ceil(11 * 0.5 * 1.1) = ceil(6.05) = 7
      const result = generateLengthInstruction('Get started', 'button', 'ja');
      expect(result).toBe('Keep translation under 7 characters.');
    });

    it('should return undefined for non-length-constrained element', () => {
      expect(generateLengthInstruction('Click here', 'p', 'de')).toBeUndefined();
      expect(generateLengthInstruction('Heading', 'div', 'de')).toBeUndefined();
    });

    it('should return undefined for null elementType', () => {
      expect(generateLengthInstruction('text', null, 'de')).toBeUndefined();
    });

    it('should return undefined for undefined elementType', () => {
      expect(generateLengthInstruction('text', undefined, 'de')).toBeUndefined();
    });

    it('should return undefined for locale without expansion factor', () => {
      expect(generateLengthInstruction('Save', 'button', 'sv')).toBeUndefined();
    });

    it('should return undefined when calculated max is below 5 chars', () => {
      // 1 char * 0.5 * 1.1 = 0.55 → ceil = 1 → < 5 → undefined
      expect(generateLengthInstruction('X', 'button', 'ja')).toBeUndefined();
    });

    it('should allow user config to override default expansion factor', () => {
      const config = { expansion_factors: { de: 2.0 } };
      // ceil(4 * 2.0 * 1.1) = ceil(8.8) = 9
      const result = generateLengthInstruction('Save', 'button', 'de', config);
      expect(result).toBe('Keep translation under 9 characters.');
    });

    it('should handle case-insensitive locale matching', () => {
      const result = generateLengthInstruction('Save', 'button', 'DE');
      expect(result).toBe('Keep translation under 6 characters.');
    });

    it('should extract base locale from regional variant', () => {
      // pt-br has factor 1.25, but as a full match; also test 'es-419' → base 'es' = 1.25
      const result = generateLengthInstruction('Submit', 'button', 'es-419');
      // ceil(6 * 1.25 * 1.1) = ceil(8.25) = 9
      expect(result).toBe('Keep translation under 9 characters.');
    });
  });
});

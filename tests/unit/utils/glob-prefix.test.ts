import { extractGlobLiteralPrefix } from '../../../src/utils/glob-prefix';
import { ConfigError } from '../../../src/utils/errors';

describe('extractGlobLiteralPrefix', () => {
  describe('clean patterns', () => {
    it('extracts prefix up to the first wildcard segment', () => {
      expect(extractGlobLiteralPrefix('src/locales/**/*.json')).toBe('src/locales');
    });

    it('returns empty prefix for top-level wildcard pattern', () => {
      expect(extractGlobLiteralPrefix('**/*.ts')).toBe('');
    });

    it('handles nested literal segments with brace at the end', () => {
      expect(extractGlobLiteralPrefix('src/app/{foo,bar}/*.json')).toBe('src/app');
    });

    it('returns the whole pattern when no wildcards are present', () => {
      expect(extractGlobLiteralPrefix('src/app/routes.ts')).toBe('src/app/routes.ts');
    });

    it('preserves a leading dot-segment literal', () => {
      expect(extractGlobLiteralPrefix('./src/**/*.ts')).toBe('./src');
    });

    it('stops at the first segment containing ? (single char wildcard)', () => {
      expect(extractGlobLiteralPrefix('src/page?.tsx')).toBe('src');
    });

    it('stops at the first segment containing a character class', () => {
      expect(extractGlobLiteralPrefix('src/[a-z]*/*.ts')).toBe('src');
    });

    it('stops at the first extglob segment', () => {
      expect(extractGlobLiteralPrefix('src/@(foo|bar)/*.ts')).toBe('src');
    });

    it('treats a segment with escaped wildcard as literal', () => {
      expect(extractGlobLiteralPrefix('src/\\*literal/**/*.ts')).toBe('src/\\*literal');
    });

    it('preserves an absolute-style prefix within the project root when all literal', () => {
      expect(extractGlobLiteralPrefix('src/locales/en/**.json')).toBe('src/locales/en');
    });
  });

  describe('path-traversal rejection', () => {
    it('rejects a leading parent-directory segment', () => {
      expect(() => extractGlobLiteralPrefix('../sensitive/**')).toThrow(ConfigError);
    });

    it('rejects a mid-pattern parent-directory segment', () => {
      expect(() => extractGlobLiteralPrefix('src/../etc/**')).toThrow(ConfigError);
    });

    it('rejects brace-expansion containing parent-directory', () => {
      expect(() => extractGlobLiteralPrefix('{..,src}/**/*.json')).toThrow(ConfigError);
    });

    it('rejects nested brace-expansion containing parent-directory', () => {
      expect(() => extractGlobLiteralPrefix('src/{app,..}/**')).toThrow(ConfigError);
    });

    it('rejects extglob containing parent-directory', () => {
      expect(() => extractGlobLiteralPrefix('@(..)/**')).toThrow(ConfigError);
    });

    it('rejects extglob alternation containing parent-directory', () => {
      expect(() => extractGlobLiteralPrefix('src/+(foo|..)/**')).toThrow(ConfigError);
    });

    it('rejects bare ".." pattern', () => {
      expect(() => extractGlobLiteralPrefix('..')).toThrow(ConfigError);
    });

    it('rejects trailing "/.." segment', () => {
      expect(() => extractGlobLiteralPrefix('src/..')).toThrow(ConfigError);
    });

    it('does not reject filenames that merely contain ".." as substring', () => {
      expect(extractGlobLiteralPrefix('src/foo..bar/**')).toBe('src/foo..bar');
    });

    it('includes the offending pattern in the error message', () => {
      expect.assertions(2);
      let caught: unknown = null;
      try {
        extractGlobLiteralPrefix('{..,src}/**');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as Error).message).toContain('{..,src}/**');
    });
  });
});

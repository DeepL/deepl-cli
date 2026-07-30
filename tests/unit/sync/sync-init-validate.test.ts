import {
  validateSyncInitFlags,
  buildTargetLocaleChoices,
} from '../../../src/sync/sync-init-validate';
import { ValidationError } from '../../../src/utils/errors';

describe('sync-init-validate', () => {
  describe('validateSyncInitFlags', () => {
    const base = {
      sourceLocale: 'en',
      targetLocales: 'de,fr',
      filePath: 'locales/en.json',
    };

    it('accepts valid flags', () => {
      expect(() => validateSyncInitFlags(base)).not.toThrow();
    });

    it('rejects source locale appearing in target-locales (case-insensitive)', () => {
      expect.assertions(4);
      expect(() => validateSyncInitFlags({ ...base, targetLocales: 'de,EN,fr' }))
        .toThrow(ValidationError);
      try {
        validateSyncInitFlags({ ...base, targetLocales: 'de,EN,fr' });
      } catch (e) {
        const err = e as ValidationError;
        expect(err.message).toMatch(/EN/);
        expect(err.message.toLowerCase()).toContain('source');
        expect(err.suggestion).toBeDefined();
      }
    });

    it('rejects duplicate target-locales (case-insensitive)', () => {
      expect.assertions(3);
      expect(() => validateSyncInitFlags({ ...base, targetLocales: 'de,fr,DE' }))
        .toThrow(ValidationError);
      try {
        validateSyncInitFlags({ ...base, targetLocales: 'de,fr,DE' });
      } catch (e) {
        const err = e as ValidationError;
        expect(err.message.toLowerCase()).toContain('duplicate');
        expect(err.message.toLowerCase()).toContain('de');
      }
    });

    it('rejects empty target-locales after splitting', () => {
      expect(() => validateSyncInitFlags({ ...base, targetLocales: ' , , ' }))
        .toThrow(ValidationError);
      expect(() => validateSyncInitFlags({ ...base, targetLocales: '' }))
        .toThrow(ValidationError);
    });

    it('rejects malformed locale codes', () => {
      expect(() => validateSyncInitFlags({ ...base, targetLocales: 'de,xx_YY' }))
        .toThrow(ValidationError);
      expect(() => validateSyncInitFlags({ ...base, targetLocales: 'de,123' }))
        .toThrow(ValidationError);
      expect(() => validateSyncInitFlags({ ...base, targetLocales: 'de,' + 'x'.repeat(30) }))
        .toThrow(ValidationError);
    });

    it('accepts BCP-47 style codes including script subtags', () => {
      expect(() => validateSyncInitFlags({ ...base, targetLocales: 'zh-Hans,pt-BR' }))
        .not.toThrow();
      expect(() => validateSyncInitFlags({ ...base, targetLocales: 'en-US-POSIX' }))
        .not.toThrow();
    });

    it('rejects path traversal in --path', () => {
      expect(() => validateSyncInitFlags({ ...base, filePath: '../etc/passwd' }))
        .toThrow(ValidationError);
      expect(() => validateSyncInitFlags({ ...base, filePath: 'locales/../../../etc' }))
        .toThrow(ValidationError);
    });

    it('allows missing source-path file but returns a warning', () => {
      const result = validateSyncInitFlags({
        sourceLocale: 'en',
        targetLocales: 'de',
        filePath: 'locales/does-not-exist.json',
        cwd: '/tmp/nonexistent-' + Date.now(),
      });
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.toLowerCase().includes('not'))).toBe(true);
    });

    it('does not warn when --path exists', () => {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const os = require('os') as typeof import('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-init-validate-'));
      try {
        fs.mkdirSync(path.join(tmp, 'locales'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'locales', 'en.json'), '{}');
        const result = validateSyncInitFlags({
          sourceLocale: 'en',
          targetLocales: 'de',
          filePath: 'locales/en.json',
          cwd: tmp,
        });
        expect(result.warnings).toEqual([]);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('accepts glob patterns containing * for --path without warning', () => {
      const result = validateSyncInitFlags({
        sourceLocale: 'en',
        targetLocales: 'de',
        filePath: 'locales/**/*.json',
      });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('buildTargetLocaleChoices', () => {
    it('returns the full DeepL target-locale set (>= 20 entries)', () => {
      const choices = buildTargetLocaleChoices();
      expect(choices.length).toBeGreaterThanOrEqual(20);
    });

    it('includes common locales that were missing from the old 5-language set', () => {
      const choices = buildTargetLocaleChoices();
      const values = choices.map(c => c.value);
      expect(values).toContain('it');
      expect(values).toContain('ko');
      expect(values).toContain('nl');
      expect(values).toContain('pl');
      expect(values).toContain('ru');
      expect(values).toContain('pt-br');
    });

    it('pre-checks top common locales (de, es, fr, it, ja, ko, pt-br, zh)', () => {
      const choices = buildTargetLocaleChoices();
      const checked = choices.filter(c => c.checked).map(c => c.value);
      for (const code of ['de', 'es', 'fr', 'it', 'ja', 'ko', 'pt-br', 'zh']) {
        expect(checked).toContain(code);
      }
    });

    it('uses display names that include the language and code', () => {
      const choices = buildTargetLocaleChoices();
      const de = choices.find(c => c.value === 'de');
      expect(de).toBeDefined();
      expect(de!.name).toContain('German');
      expect(de!.name).toContain('de');
    });
  });
});

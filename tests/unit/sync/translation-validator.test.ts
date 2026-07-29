import {
  validateTranslation,
  validateBatch,
} from '../../../src/sync/translation-validator';

describe('translation-validator', () => {
  describe('validateTranslation', () => {
    describe('placeholders', () => {
      it('should pass when {name} is preserved', () => {
        const result = validateTranslation('key', 'Hello {name}', 'Hallo {name}');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should error when {name} is missing in translation', () => {
        const result = validateTranslation('key', 'Hello {name}', 'Hallo');
        expect(result.severity).toBe('error');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]?.check).toBe('placeholders');
        expect(result.issues[0]?.severity).toBe('error');
        expect(result.issues[0]?.message).toContain('{name}');
      });

      it('should pass when {{count}} is preserved', () => {
        const result = validateTranslation('key', 'You have {{count}} items', 'Sie haben {{count}} Artikel');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should error when ${var} is missing in translation', () => {
        const result = validateTranslation('key', 'Value is ${var}', 'Wert ist');
        expect(result.severity).toBe('error');
        const issue = result.issues.find((i) => i.severity === 'error');
        expect(issue?.message).toContain('${var}');
      });

      it('should pass when %s and %d are preserved', () => {
        const result = validateTranslation('key', 'Hello %s, you have %d items', 'Hallo %s, Sie haben %d Artikel');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should error when %1$s is missing in translation', () => {
        const result = validateTranslation('key', 'Hello %1$s from %2$s', 'Hallo');
        expect(result.severity).toBe('error');
        const issue = result.issues.find((i) => i.severity === 'error');
        expect(issue?.message).toContain('%1$s');
      });

      it('should warn when extra placeholder exists in translation', () => {
        const result = validateTranslation('key', 'Hello', 'Hallo {extra}');
        expect(result.severity).toBe('warn');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]?.severity).toBe('warn');
        expect(result.issues[0]?.message).toContain('{extra}');
      });

      it('should detect one missing {count} when source has two and translation has one', () => {
        const result = validateTranslation('key', '{count} of {count}', '{count}');
        expect(result.severity).toBe('error');
        const issue = result.issues.find((i) => i.severity === 'error');
        expect(issue?.message).toContain('{count}');
        const missing = issue?.message.match(/\{count\}/g) ?? [];
        expect(missing).toHaveLength(1);
      });

      it('should extract {{name}} as a single placeholder, not also {name}', () => {
        const result = validateTranslation('key', '{{name}} hello', '{{name}} hallo');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should extract both %1$s and %2$d as separate placeholders', () => {
        const result = validateTranslation('key', '%1$s costs %2$d', '%1$s kostet %2$d');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should detect Unicode placeholder {名前}', () => {
        const result = validateTranslation('key', 'Hello {名前}', 'Hallo');
        expect(result.severity).toBe('error');
        const issue = result.issues.find((i) => i.severity === 'error');
        expect(issue?.message).toContain('{名前}');
      });
    });

    describe('ICU-aware placeholders', () => {
      it('should not report plural branch bodies as placeholders', () => {
        const source = '{count, plural, one {# item} other {# items}}';
        const translation = '{count, plural, one {Artikel} other {Artikel}}';
        const result = validateTranslation('key', source, translation);
        const phIssues = result.issues.filter((i) => i.check === 'placeholders');
        expect(phIssues).toHaveLength(0);
      });

      it('should not report select branch bodies as placeholders', () => {
        const source = '{gender, select, male {He} female {She} other {They}}';
        const translation = '{gender, select, male {Er} female {Sie} other {Sie}}';
        const result = validateTranslation('key', source, translation);
        const phIssues = result.issues.filter((i) => i.check === 'placeholders');
        expect(phIssues).toHaveLength(0);
      });

      it('should still error when a placeholder inside a branch is dropped', () => {
        const source = '{count, plural, one {{name} has # item} other {{name} has # items}}';
        const translation = '{count, plural, one {hat # Artikel} other {hat # Artikel}}';
        const result = validateTranslation('key', source, translation);
        const issue = result.issues.find((i) => i.check === 'placeholders' && i.severity === 'error');
        expect(issue).toBeDefined();
        expect(issue!.message).toContain('{name}');
      });

      it('should pass when placeholders inside branches are preserved', () => {
        const source = '{count, plural, one {{name} has # item} other {{name} has # items}}';
        const translation = '{count, plural, one {{name} hat # Artikel} other {{name} hat # Artikel}}';
        const result = validateTranslation('key', source, translation);
        const phIssues = result.issues.filter((i) => i.check === 'placeholders');
        expect(phIssues).toHaveLength(0);
      });

      it('should warn when a branch gains an extra placeholder', () => {
        const source = '{count, plural, one {# item} other {# items}}';
        const translation = '{count, plural, one {{extra} Artikel} other {Artikel}}';
        const result = validateTranslation('key', source, translation);
        const issue = result.issues.find((i) => i.check === 'placeholders');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('warn');
        expect(issue!.message).toContain('{extra}');
      });
    });

    describe('ICU brackets', () => {
      it('should pass when ICU brackets are balanced', () => {
        const source = '{count, plural, one {# item} other {# items}}';
        const translation = '{count, plural, one {# Artikel} other {# Artikel}}';
        const result = validateTranslation('key', source, translation);
        expect(result.issues.filter((i) => i.check === 'icu-brackets')).toHaveLength(0);
      });

      it('should error when ICU closing bracket is missing', () => {
        const source = '{count, plural, one {# item} other {# items}}';
        const translation = '{count, plural, one {# Artikel} other {# Artikel}';
        const result = validateTranslation('key', source, translation);
        const icuIssues = result.issues.filter((i) => i.check === 'icu-brackets');
        expect(icuIssues).toHaveLength(1);
        expect(icuIssues[0]?.severity).toBe('error');
      });

      it('should handle nested ICU select/plural correctly', () => {
        const source = '{gender, select, male {{count, plural, one {He has # item} other {He has # items}}} female {{count, plural, one {She has # item} other {She has # items}}} other {They have # items}}';
        const translation = '{gender, select, male {{count, plural, one {Er hat # Artikel} other {Er hat # Artikel}}} female {{count, plural, one {Sie hat # Artikel} other {Sie hat # Artikel}}} other {Sie haben # Artikel}}';
        const result = validateTranslation('key', source, translation);
        const icuIssues = result.issues.filter((i) => i.check === 'icu-brackets');
        expect(icuIssues).toHaveLength(0);
      });

      it('should not flag non-ICU text with braces', () => {
        const result = validateTranslation('key', 'Hello {name}', 'Hallo {name}');
        const icuIssues = result.issues.filter((i) => i.check === 'icu-brackets');
        expect(icuIssues).toHaveLength(0);
      });
    });

    describe('HTML tags', () => {
      it('should pass when <b>text</b> tags are matched', () => {
        const result = validateTranslation('key', '<b>Hello</b> world', '<b>Hallo</b> Welt');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should warn when </b> is missing in translation', () => {
        const result = validateTranslation('key', '<b>Hello</b> world', '<b>Hallo Welt');
        expect(result.severity).toBe('warn');
        const htmlIssues = result.issues.filter((i) => i.check === 'html-tags');
        expect(htmlIssues).toHaveLength(1);
        expect(htmlIssues[0]?.severity).toBe('warn');
        expect(htmlIssues[0]?.message).toContain('</b>');
      });

      it('should pass when self-closing <br/> is preserved', () => {
        const result = validateTranslation('key', 'Line 1<br/>Line 2', 'Zeile 1<br/>Zeile 2');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });
    });

    describe('edge cases', () => {
      it('should pass for empty strings', () => {
        const result = validateTranslation('key', '', '');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should pass when there are no placeholders', () => {
        const result = validateTranslation('key', 'Hello world', 'Hallo Welt');
        expect(result.severity).toBe('pass');
        expect(result.issues).toHaveLength(0);
      });

      it('should set severity to worst issue level', () => {
        const result = validateTranslation(
          'key',
          'Hello {name} <b>bold</b>',
          'Hallo <b>fett',
        );
        expect(result.severity).toBe('error');
      });

      it('should include key, source, and translation in result', () => {
        const result = validateTranslation('my.key', 'source', 'translated');
        expect(result.key).toBe('my.key');
        expect(result.source).toBe('source');
        expect(result.translation).toBe('translated');
      });
    });
  });

  describe('validateBatch', () => {
    it('should validate all entries and return results', () => {
      const entries = [
        { key: 'a', source: 'Hello {name}', translation: 'Hallo {name}' },
        { key: 'b', source: 'Hello {name}', translation: 'Hallo' },
        { key: 'c', source: 'plain text', translation: 'einfacher Text' },
      ];

      const results = validateBatch(entries);
      expect(results).toHaveLength(3);
      expect(results[0]?.severity).toBe('pass');
      expect(results[1]?.severity).toBe('error');
      expect(results[2]?.severity).toBe('pass');
    });

    it('should return empty array for empty input', () => {
      const results = validateBatch([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('untranslated detection', () => {
    it('should warn when translation is identical to source', () => {
      const result = validateTranslation('key', 'Hello world', 'Hello world');
      const issue = result.issues.find(i => i.check === 'untranslated');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warn');
    });

    it('should not warn when translation differs from source', () => {
      const result = validateTranslation('key', 'Hello world', 'Hallo Welt');
      const issue = result.issues.find(i => i.check === 'untranslated');
      expect(issue).toBeUndefined();
    });

    it('should not warn for single-character strings', () => {
      const result = validateTranslation('key', '!', '!');
      const issue = result.issues.find(i => i.check === 'untranslated');
      expect(issue).toBeUndefined();
    });
  });

  describe('length ratio', () => {
    it('should warn when translation exceeds 150% of source length', () => {
      const source = 'Short text here';
      const translation = 'This is a very much longer translation that far exceeds the original';
      const result = validateTranslation('key', source, translation);
      const issue = result.issues.find(i => i.check === 'length-ratio');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warn');
      expect(issue!.message).toMatch(/\d+%/);
    });

    it('should not warn when translation is within 150% of source', () => {
      const result = validateTranslation('key', 'Hello world', 'Hallo Welt!');
      const issue = result.issues.find(i => i.check === 'length-ratio');
      expect(issue).toBeUndefined();
    });

    it('should not warn for short source strings', () => {
      const result = validateTranslation('key', 'OK', 'Einverstanden');
      const issue = result.issues.find(i => i.check === 'length-ratio');
      expect(issue).toBeUndefined();
    });
  });
});

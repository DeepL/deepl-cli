import fg from 'fast-glob';
import {
  buildKeyPatterns,
  buildTemplateLiteralPatterns,
  templateToGlobPattern,
  extractContextFromSource,
  extractTemplateLiteralMatches,
  resolveTemplatePatterns,
  synthesizeContext,
  extractAllKeyContexts,
  keyPathToContext,
  sectionContextKey,
  sectionToContext,
  extractElementType,
  DEFAULT_FUNCTION_NAMES,
  ContextMatch,
  TemplatePatternMatch,
} from '../../../src/sync/sync-context';

jest.mock('fast-glob');
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
    },
  };
});

import * as fs from 'fs';

const mockFastGlob = fg as jest.MockedFunction<typeof fg>;
const mockReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;

describe('sync-context', () => {
  describe('buildKeyPatterns', () => {
    it('should return a regex for each function name', () => {
      const patterns = buildKeyPatterns(['t', 'i18n.t']);
      expect(patterns).toHaveLength(2);
      patterns.forEach((p) => expect(p).toBeInstanceOf(RegExp));
    });

    it('should produce global regexes', () => {
      const patterns = buildKeyPatterns(['t']);
      expect(patterns[0]!.flags).toContain('g');
    });
  });

  describe('extractContextFromSource', () => {
    it('should match t() calls', () => {
      const source = `const label = t('greeting');`;
      const matches = extractContextFromSource(source, 'app.ts', ['t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe('greeting');
      expect(matches[0]!.matchedFunction).toBe('t');
      expect(matches[0]!.line).toBe(1);
    });

    it('should match i18n.t() calls', () => {
      const source = `i18n.t('welcome_message')`;
      const matches = extractContextFromSource(source, 'app.ts', ['i18n.t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe('welcome_message');
      expect(matches[0]!.matchedFunction).toBe('i18n.t');
    });

    it('should match $t() calls', () => {
      const source = `{{ $t('save') }}`;
      const matches = extractContextFromSource(source, 'comp.vue', ['$t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe('save');
      expect(matches[0]!.matchedFunction).toBe('$t');
    });

    it('should match intl.formatMessage() calls', () => {
      const source = `intl.formatMessage({ id: 'items_count' })`;
      const matches = extractContextFromSource(source, 'app.tsx', ['intl.formatMessage'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe('items_count');
      expect(matches[0]!.matchedFunction).toBe('intl.formatMessage');
    });

    it('should handle dotted keys like nav.home.title', () => {
      const source = `t('nav.home.title')`;
      const matches = extractContextFromSource(source, 'nav.ts', ['t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe('nav.home.title');
    });

    it('should return empty array when no matches found', () => {
      const source = `const x = 42;\nconsole.log(x);`;
      const matches = extractContextFromSource(source, 'math.ts', DEFAULT_FUNCTION_NAMES, 0);
      expect(matches).toHaveLength(0);
    });

    it('should find multiple matches on the same line', () => {
      const source = `const a = t('hello'), b = t('world');`;
      const matches = extractContextFromSource(source, 'multi.ts', ['t'], 0);
      expect(matches).toHaveLength(2);
      expect(matches[0]!.key).toBe('hello');
      expect(matches[1]!.key).toBe('world');
    });

    it('should find matches across multiple lines', () => {
      const source = `t('line1')\nt('line2')\nt('line3')`;
      const matches = extractContextFromSource(source, 'multi.ts', ['t'], 0);
      expect(matches).toHaveLength(3);
      expect(matches[0]!.line).toBe(1);
      expect(matches[1]!.line).toBe(2);
      expect(matches[2]!.line).toBe(3);
    });

    it('should include surrounding code with configurable context lines', () => {
      const source = `line1\nline2\nt('key')\nline4\nline5`;
      const matches = extractContextFromSource(source, 'ctx.ts', ['t'], 1);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.surroundingCode).toBe("line2\nt('key')\nline4");
    });

    it('should clamp context at start of file', () => {
      const source = `t('first_line')\nline2\nline3`;
      const matches = extractContextFromSource(source, 'start.ts', ['t'], 2);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.surroundingCode).toBe("t('first_line')\nline2\nline3");
    });

    it('should clamp context at end of file', () => {
      const source = `line1\nline2\nt('last_line')`;
      const matches = extractContextFromSource(source, 'end.ts', ['t'], 2);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.surroundingCode).toBe("line1\nline2\nt('last_line')");
    });

    it('should not match t() when preceded by a dot (method call)', () => {
      const source = `obj.t('not_a_key')`;
      const matches = extractContextFromSource(source, 'method.ts', ['t'], 0);
      expect(matches).toHaveLength(0);
    });

    it('should not match t() when preceded by a word character', () => {
      const source = `ият('not_a_key')`;
      const matches = extractContextFromSource(source, 'method.ts', ['t'], 0);
      expect(matches).toHaveLength(0);
    });

    it('should match t() with additional arguments after the key', () => {
      const source = `t('key_with_args', { count: 5 })`;
      const matches = extractContextFromSource(source, 'args.ts', ['t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe('key_with_args');
    });

    it('should match keys with double quotes', () => {
      const source = `t("double_quoted")`;
      const matches = extractContextFromSource(source, 'quotes.ts', ['t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe('double_quoted');
    });

    it('should use correct file path in matches', () => {
      const source = `t('test')`;
      const matches = extractContextFromSource(source, 'src/components/Header.tsx', ['t'], 0);
      expect(matches[0]!.filePath).toBe('src/components/Header.tsx');
    });
  });

  describe('synthesizeContext', () => {
    function makeMatch(overrides: Partial<ContextMatch> = {}): ContextMatch {
      return {
        key: 'test_key',
        filePath: 'app.ts',
        line: 10,
        surroundingCode: 'const x = t("test_key");',
        matchedFunction: 't',
        ...overrides,
      };
    }

    it('should return empty string for empty array', () => {
      expect(synthesizeContext([])).toBe('');
    });

    it('should format a single match', () => {
      const result = synthesizeContext([makeMatch()]);
      expect(result).toContain('Used as t() in app.ts:10');
      expect(result).toContain('const x = t("test_key");');
    });

    it('should format multiple matches', () => {
      const matches = [
        makeMatch({ filePath: 'a.ts', line: 1 }),
        makeMatch({ filePath: 'b.ts', line: 2 }),
      ];
      const result = synthesizeContext(matches);
      expect(result).toContain('a.ts:1');
      expect(result).toContain('b.ts:2');
    });

    it('should cap displayed locations at 3', () => {
      const matches = [
        makeMatch({ filePath: 'a.ts', line: 1 }),
        makeMatch({ filePath: 'b.ts', line: 2 }),
        makeMatch({ filePath: 'c.ts', line: 3 }),
        makeMatch({ filePath: 'd.ts', line: 4 }),
        makeMatch({ filePath: 'e.ts', line: 5 }),
      ];
      const result = synthesizeContext(matches);
      expect(result).toContain('a.ts:1');
      expect(result).toContain('b.ts:2');
      expect(result).toContain('c.ts:3');
      expect(result).not.toContain('d.ts:4');
      expect(result).not.toContain('e.ts:5');
      expect(result).toContain('...and 2 more occurrence(s)');
    });

    it('should cap total string at 1000 characters', () => {
      const longCode = 'x'.repeat(500);
      const matches = [
        makeMatch({ surroundingCode: longCode, filePath: 'a.ts' }),
        makeMatch({ surroundingCode: longCode, filePath: 'b.ts' }),
        makeMatch({ surroundingCode: longCode, filePath: 'c.ts' }),
      ];
      const result = synthesizeContext(matches);
      expect(result.length).toBeLessThanOrEqual(1000);
      expect(result).toMatch(/\.\.\.$/);
    });

    it('should not truncate when within limit', () => {
      const result = synthesizeContext([makeMatch()]);
      expect(result).not.toMatch(/\.\.\.$/);
    });
  });

  describe('extractAllKeyContexts', () => {
    it('should aggregate keys from multiple files', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/a.ts', '/project/src/b.ts']);

      mockReadFile.mockImplementation((filePath: unknown) => {
        if (String(filePath).includes('a.ts')) return Promise.resolve(`t('shared_key')`);
        if (String(filePath).includes('b.ts')) return Promise.resolve(`t('shared_key')\nt('unique_key')`);
        return Promise.resolve('');
      });

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
      });

      expect(keyContexts.size).toBe(2);
      expect(keyContexts.get('shared_key')!.occurrences).toBe(2);
      expect(keyContexts.get('unique_key')!.occurrences).toBe(1);
    });

    it('should skip unreadable files gracefully', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/good.ts', '/project/src/bad.ts']);

      mockReadFile.mockImplementation((filePath: unknown) => {
        if (String(filePath).includes('bad.ts')) return Promise.reject(new Error('EACCES'));
        return Promise.resolve(`t('found')`);
      });

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
      });

      expect(keyContexts.size).toBe(1);
      expect(keyContexts.has('found')).toBe(true);
    });

    it('should return empty map when no files match', async () => {
      mockFastGlob.mockResolvedValue([]);

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
      });

      expect(keyContexts.size).toBe(0);
    });

    it('should use custom function names when provided', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/app.ts']);

      mockReadFile.mockResolvedValue(`myTranslate('custom_key')`);

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
        functionNames: ['myTranslate'],
      });

      expect(keyContexts.size).toBe(1);
      expect(keyContexts.has('custom_key')).toBe(true);
    });

    it('should use default function names when not specified', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/app.ts']);

      mockReadFile.mockResolvedValue(`t('default_fn')`);

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
      });

      expect(keyContexts.has('default_fn')).toBe(true);
    });

    it('should pass correct glob options', async () => {
      mockFastGlob.mockResolvedValue([]);

      await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
      });

      expect(mockFastGlob).toHaveBeenCalledWith(
        ['/project/src/**/*.ts'],
        expect.objectContaining({
          cwd: '/project',
          absolute: true,
          onlyFiles: true,
        }),
      );
    });

    it('should generate context strings for each key', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/app.ts']);

      mockReadFile.mockResolvedValue(`const label = t('greeting');`);

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
      });

      const ctx = keyContexts.get('greeting');
      expect(ctx).toBeDefined();
      expect(ctx!.context).toContain('Used as t()');
      expect(ctx!.context).toContain('greeting');
    });

    it('should return template patterns from template literal t() calls', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/app.tsx']);

      mockReadFile.mockResolvedValue('const x = t(`features.${key}.title`);');

      const { templatePatterns } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.tsx'],
        rootDir: '/project',
      });

      expect(templatePatterns).toHaveLength(1);
      expect(templatePatterns[0]!.pattern).toBe('features.${key}.title');
      expect(templatePatterns[0]!.matchedFunction).toBe('t');
    });

    describe('scan_paths traversal guard', () => {
      it('should skip a scan_path with a leading parent-directory segment', async () => {
        mockFastGlob.mockResolvedValue([]);

        await extractAllKeyContexts({
          scanPaths: ['../sensitive/**/*.ts'],
          rootDir: '/project',
        });

        expect(mockFastGlob).toHaveBeenCalledWith([], expect.any(Object));
      });

      it('should skip a scan_path with an absolute path outside the project root', async () => {
        mockFastGlob.mockResolvedValue([]);

        await extractAllKeyContexts({
          scanPaths: ['/etc/**/*.conf'],
          rootDir: '/project',
        });

        expect(mockFastGlob).toHaveBeenCalledWith([], expect.any(Object));
      });

      it('should skip a scan_path that smuggles ".." through brace expansion', async () => {
        mockFastGlob.mockResolvedValue([]);

        await extractAllKeyContexts({
          scanPaths: ['{..,src}/**/*.ts'],
          rootDir: '/project',
        });

        expect(mockFastGlob).toHaveBeenCalledWith([], expect.any(Object));
      });

      it('should skip a scan_path that smuggles ".." through an extglob', async () => {
        mockFastGlob.mockResolvedValue([]);

        await extractAllKeyContexts({
          scanPaths: ['@(..)/**/*.ts'],
          rootDir: '/project',
        });

        expect(mockFastGlob).toHaveBeenCalledWith([], expect.any(Object));
      });

      it('should skip a scan_path with mid-pattern ".." segment', async () => {
        mockFastGlob.mockResolvedValue([]);

        await extractAllKeyContexts({
          scanPaths: ['src/../etc/**'],
          rootDir: '/project',
        });

        expect(mockFastGlob).toHaveBeenCalledWith([], expect.any(Object));
      });

      it('should still forward a safe scan_path alongside a rejected one', async () => {
        mockFastGlob.mockResolvedValue([]);

        await extractAllKeyContexts({
          scanPaths: ['src/**/*.ts', '{..,src}/**/*.ts'],
          rootDir: '/project',
        });

        expect(mockFastGlob).toHaveBeenCalledWith(['/project/src/**/*.ts'], expect.any(Object));
      });
    });
  });

  describe('buildTemplateLiteralPatterns', () => {
    it('should return a regex for each non-intl function name', () => {
      const patterns = buildTemplateLiteralPatterns(['t', 'i18n.t', 'intl.formatMessage']);
      expect(patterns).toHaveLength(2);
      patterns.forEach((p) => expect(p).toBeInstanceOf(RegExp));
    });

    it('should produce global regexes', () => {
      const patterns = buildTemplateLiteralPatterns(['t']);
      expect(patterns[0]!.flags).toContain('g');
    });

    it('should exclude intl.formatMessage', () => {
      const patterns = buildTemplateLiteralPatterns(['intl.formatMessage']);
      expect(patterns).toHaveLength(0);
    });
  });

  describe('templateToGlobPattern', () => {
    it('should replace single interpolation with *', () => {
      expect(templateToGlobPattern('nav.${key}')).toBe('nav.*');
    });

    it('should replace interpolation in middle', () => {
      expect(templateToGlobPattern('features.${key}.title')).toBe('features.*.title');
    });

    it('should replace multiple interpolations', () => {
      expect(templateToGlobPattern('pricing.${tier}.features.${fi}')).toBe('pricing.*.features.*');
    });

    it('should pass through strings with no interpolations', () => {
      expect(templateToGlobPattern('simple.key')).toBe('simple.key');
    });

    it('should handle complex interpolation expressions', () => {
      expect(templateToGlobPattern('items.${i + 1}.label')).toBe('items.*.label');
    });
  });

  describe('extractTemplateLiteralMatches', () => {
    it('should match t() calls with template literals', () => {
      const source = 'const x = t(`nav.${key}`);';
      const matches = extractTemplateLiteralMatches(source, 'app.tsx', ['t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.pattern).toBe('nav.${key}');
      expect(matches[0]!.matchedFunction).toBe('t');
      expect(matches[0]!.line).toBe(1);
    });

    it('should match i18n.t() with template literals', () => {
      const source = 'i18n.t(`section.${name}`)';
      const matches = extractTemplateLiteralMatches(source, 'app.tsx', ['i18n.t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.pattern).toBe('section.${name}');
    });

    it('should match $t() with template literals', () => {
      const source = '{{ $t(`items.${idx}`) }}';
      const matches = extractTemplateLiteralMatches(source, 'comp.vue', ['$t'], 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.pattern).toBe('items.${idx}');
    });

    it('should not match when preceded by a dot', () => {
      const source = 'obj.t(`nav.${key}`)';
      const matches = extractTemplateLiteralMatches(source, 'app.tsx', ['t'], 0);
      expect(matches).toHaveLength(0);
    });

    it('should ignore template literals without interpolation', () => {
      const source = 't(`static.key`)';
      const matches = extractTemplateLiteralMatches(source, 'app.tsx', ['t'], 0);
      expect(matches).toHaveLength(0);
    });

    it('should include surrounding code context', () => {
      const source = 'line1\nline2\nt(`nav.${key}`)\nline4\nline5';
      const matches = extractTemplateLiteralMatches(source, 'app.tsx', ['t'], 1);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.surroundingCode).toBe('line2\nt(`nav.${key}`)\nline4');
    });

    it('should find multiple matches', () => {
      const source = 't(`a.${x}`)\nt(`b.${y}`)';
      const matches = extractTemplateLiteralMatches(source, 'app.tsx', ['t'], 0);
      expect(matches).toHaveLength(2);
      expect(matches[0]!.pattern).toBe('a.${x}');
      expect(matches[1]!.pattern).toBe('b.${y}');
    });

    it('should return empty array when no template literals found', () => {
      const source = "t('static_key')";
      const matches = extractTemplateLiteralMatches(source, 'app.tsx', ['t'], 0);
      expect(matches).toHaveLength(0);
    });
  });

  describe('resolveTemplatePatterns', () => {
    function makeTemplateMatch(pattern: string, overrides: Partial<TemplatePatternMatch> = {}): TemplatePatternMatch {
      return {
        pattern,
        filePath: 'app.tsx',
        line: 10,
        surroundingCode: `t(\`${pattern}\`)`,
        matchedFunction: 't',
        ...overrides,
      };
    }

    it('should match known keys against a single-wildcard pattern', () => {
      const patterns = [makeTemplateMatch('features.${key}.title')];
      const knownKeys = ['features.a.title', 'features.b.title', 'other.key'];
      const result = resolveTemplatePatterns(patterns, knownKeys);
      expect(result.size).toBe(2);
      expect(result.has('features.a.title')).toBe(true);
      expect(result.has('features.b.title')).toBe(true);
      expect(result.has('other.key')).toBe(false);
    });

    it('should match known keys against a multi-wildcard pattern', () => {
      const patterns = [makeTemplateMatch('pricing.${tier}.features.${fi}')];
      const knownKeys = ['pricing.free.features.0', 'pricing.pro.features.1', 'pricing.heading'];
      const result = resolveTemplatePatterns(patterns, knownKeys);
      expect(result.size).toBe(2);
      expect(result.has('pricing.free.features.0')).toBe(true);
      expect(result.has('pricing.pro.features.1')).toBe(true);
    });

    it('should not match across segment boundaries', () => {
      const patterns = [makeTemplateMatch('nav.${key}')];
      const knownKeys = ['nav.home', 'nav.sub.deep', 'navigation.other'];
      const result = resolveTemplatePatterns(patterns, knownKeys);
      expect(result.size).toBe(1);
      expect(result.has('nav.home')).toBe(true);
      expect(result.has('nav.sub.deep')).toBe(false);
      expect(result.has('navigation.other')).toBe(false);
    });

    it('should return empty map when no patterns match', () => {
      const patterns = [makeTemplateMatch('missing.${x}')];
      const knownKeys = ['found.key', 'other.key'];
      const result = resolveTemplatePatterns(patterns, knownKeys);
      expect(result.size).toBe(0);
    });

    it('should aggregate matches from multiple template patterns', () => {
      const patterns = [
        makeTemplateMatch('a.${x}', { filePath: 'comp1.tsx', line: 5 }),
        makeTemplateMatch('a.${y}', { filePath: 'comp2.tsx', line: 10 }),
      ];
      const knownKeys = ['a.foo'];
      const result = resolveTemplatePatterns(patterns, knownKeys);
      expect(result.size).toBe(1);
      expect(result.get('a.foo')).toHaveLength(2);
    });

    it('should produce ContextMatch objects with correct fields', () => {
      const patterns = [makeTemplateMatch('nav.${key}', { filePath: 'Navbar.tsx', line: 15 })];
      const result = resolveTemplatePatterns(patterns, ['nav.home']);
      const matches = result.get('nav.home')!;
      expect(matches[0]!.key).toBe('nav.home');
      expect(matches[0]!.filePath).toBe('Navbar.tsx');
      expect(matches[0]!.line).toBe(15);
      expect(matches[0]!.matchedFunction).toBe('t');
    });

    it('should collapse 1000 duplicate patterns to the same result as a single entry', () => {
      const DUPS = 1_000;
      const knownKeys = ['features.a.title', 'features.b.title', 'other.key'];

      const canonical = makeTemplateMatch('features.${k}.title', { filePath: 'comp.tsx', line: 1 });
      const dupPatterns = Array.from({ length: DUPS }, () => ({ ...canonical }));
      dupPatterns.push(makeTemplateMatch('other.${x}', { filePath: 'other.tsx', line: 1 }));

      const singlePattern = [canonical];
      singlePattern.push(makeTemplateMatch('other.${x}', { filePath: 'other.tsx', line: 1 }));

      const resultSingle = resolveTemplatePatterns(singlePattern, knownKeys);
      const resultDup = resolveTemplatePatterns(dupPatterns, knownKeys);

      expect(resultDup.has('features.a.title')).toBe(true);
      expect(resultDup.has('features.b.title')).toBe(true);
      expect(resultDup.has('other.key')).toBe(true);

      const singleCtx = synthesizeContext(resultSingle.get('features.a.title')!, { key: 'features.a.title' });
      const dupCtx = synthesizeContext(resultDup.get('features.a.title')!, { key: 'features.a.title' });
      expect(dupCtx).toBe(singleCtx);
    });

    it('should not throw on a pattern containing an unbalanced group metacharacter', () => {
      const patterns = [makeTemplateMatch('item(${i}')];
      expect(() => resolveTemplatePatterns(patterns, ['item(1', 'item.a'])).not.toThrow();
    });

    it('should not throw on a pattern containing an unbalanced character class', () => {
      const patterns = [makeTemplateMatch('a[${i}')];
      expect(() => resolveTemplatePatterns(patterns, ['a[0', 'ab'])).not.toThrow();
    });

    it('should match regex metacharacters in patterns literally', () => {
      const patterns = [makeTemplateMatch('a[${i}')];
      const result = resolveTemplatePatterns(patterns, ['a[0', 'a0', 'ab']);
      expect(result.has('a[0')).toBe(true);
      expect(result.has('a0')).toBe(false);
      expect(result.has('ab')).toBe(false);
    });

    it('should treat + and ? in patterns as literal characters', () => {
      const patterns = [makeTemplateMatch('count+?.${x}')];
      const result = resolveTemplatePatterns(patterns, ['count+?.a', 'count.a', 'coun.a']);
      expect(result.has('count+?.a')).toBe(true);
      expect(result.has('count.a')).toBe(false);
      expect(result.has('coun.a')).toBe(false);
    });
  });

  describe('DEFAULT_FUNCTION_NAMES', () => {
    it('should include common i18n function names', () => {
      expect(DEFAULT_FUNCTION_NAMES).toContain('t');
      expect(DEFAULT_FUNCTION_NAMES).toContain('i18n.t');
      expect(DEFAULT_FUNCTION_NAMES).toContain('$t');
      expect(DEFAULT_FUNCTION_NAMES).toContain('intl.formatMessage');
    });
  });

  describe('keyPathToContext', () => {
    it('should produce context for cta role', () => {
      expect(keyPathToContext('pricing.free.cta')).toBe('Call-to-action in the pricing > free section.');
    });

    it('should produce context for title role', () => {
      expect(keyPathToContext('nav.features.title')).toBe('Title in the nav > features section.');
    });

    it('should produce context for heading role', () => {
      expect(keyPathToContext('page.heading')).toBe('Heading in the page section.');
    });

    it('should produce context for description role', () => {
      expect(keyPathToContext('settings.notifications.email.description')).toBe(
        'Description in the settings > notifications > email section.',
      );
    });

    it('should produce context for placeholder role', () => {
      expect(keyPathToContext('form.name.placeholder')).toBe('Placeholder in the form > name section.');
    });

    it('should produce context for tooltip role', () => {
      expect(keyPathToContext('dashboard.tooltip')).toBe('Tooltip in the dashboard section.');
    });

    it('should produce context for save role', () => {
      expect(keyPathToContext('buttons.save')).toBe('Save action in the buttons section.');
    });

    it('should produce context for quote role', () => {
      expect(keyPathToContext('testimonials.items.0.quote')).toBe('Quote in the testimonials > items section.');
    });

    it('should handle compound segments with modifier suffix', () => {
      expect(keyPathToContext('hero.cta_primary')).toBe('Primary call-to-action in the hero section.');
    });

    it('should return empty string for single-segment key', () => {
      expect(keyPathToContext('greeting')).toBe('');
    });

    it('should return empty string for single recognized role alone', () => {
      expect(keyPathToContext('title')).toBe('');
    });

    it('should skip numeric segments in the section path', () => {
      expect(keyPathToContext('items.0.label')).toBe('Label in the items section.');
    });

    it('should handle deeply nested keys (4+ levels)', () => {
      expect(keyPathToContext('a.b.c.d.title')).toBe('Title in the a > b > c > d section.');
    });

    it('should capitalize unknown role segments', () => {
      expect(keyPathToContext('errors.generic')).toBe('Generic in the errors section.');
    });

    it('should handle underscored unknown segments', () => {
      expect(keyPathToContext('settings.dark_mode')).toBe('Dark mode in the settings section.');
    });

    it('should return empty string for empty input', () => {
      expect(keyPathToContext('')).toBe('');
    });

    it('should return empty for key with only numeric parent', () => {
      expect(keyPathToContext('0.title')).toBe('');
    });

    it('should produce context for two-segment key with known role', () => {
      expect(keyPathToContext('nav.features')).toBe('Features in the nav section.');
    });

    it('should honor NUL separator for YAML-style flattened keys', () => {
      expect(keyPathToContext('nav\0features\0title')).toBe('Title in the nav > features section.');
    });

    it('should treat a literal dot as part of a single NUL-separated segment', () => {
      expect(keyPathToContext('app\0version.major')).toBe('Version.major in the app section.');
    });
  });

  describe('sectionContextKey', () => {
    it('should return parent segments for dot-separated keys', () => {
      expect(sectionContextKey('nav.title')).toBe('nav');
      expect(sectionContextKey('a.b.c')).toBe('a.b');
    });

    it('should return empty string for single-segment dot keys', () => {
      expect(sectionContextKey('title')).toBe('');
    });

    it('should use NUL separator when key contains NUL', () => {
      expect(sectionContextKey('nav\0title')).toBe('nav');
      expect(sectionContextKey('a\0b\0c')).toBe('a\0b');
    });

    it('should treat a literal dot inside a NUL-separated key as part of one segment', () => {
      expect(sectionContextKey('app\0version.major')).toBe('app');
    });

    it('should return empty string for a flat key with a literal dot (no NUL)', () => {
      expect(sectionContextKey('version.major')).toBe('version');
    });

    it('should not split a flat YAML key with literal dot into two sections when using NUL form', () => {
      expect(sectionContextKey('version.major')).not.toBe('version.major');
      expect(sectionContextKey('version.major')).toBe('version');
    });

    it('should skip numeric segments in NUL-separated keys', () => {
      expect(sectionContextKey('items\x000\x00label')).toBe('items');
    });
  });

  describe('sectionToContext', () => {
    it('should format dot-separated section keys', () => {
      expect(sectionToContext('nav.features')).toBe('Used in the nav > features section.');
    });

    it('should format NUL-separated section keys', () => {
      expect(sectionToContext('nav\0features')).toBe('Used in the nav > features section.');
    });

    it('should return empty string for empty section key', () => {
      expect(sectionToContext('')).toBe('');
    });
  });

  describe('extractElementType', () => {
    it('should extract button element', () => {
      expect(extractElementType('<button>Click</button>')).toBe('button');
    });

    it('should extract h2 element with className', () => {
      expect(extractElementType('<h2 className="heading">Title</h2>')).toBe('h2');
    });

    it('should extract th element', () => {
      expect(extractElementType('<th>Status</th>')).toBe('th');
    });

    it('should extract self-closing input', () => {
      expect(extractElementType('<input placeholder="search" />')).toBe('input');
    });

    it('should extract self-closing textarea', () => {
      expect(extractElementType('<textarea />')).toBe('textarea');
    });

    it('should extract button with complex JSX attributes', () => {
      expect(extractElementType('<button onClick={handleClick} disabled={true}>Save</button>')).toBe('button');
    });

    it('should return null when no recognized element found', () => {
      expect(extractElementType("const label = t('key');")).toBeNull();
    });

    it('should return null for PascalCase React component', () => {
      expect(extractElementType('<Button>Save</Button>')).toBeNull();
    });

    it('should return last match when multiple elements present', () => {
      expect(extractElementType('<div><span>text</span><button>click</button></div>')).toBe('button');
    });

    it('should handle multiline JSX', () => {
      const code = `<button\n  className="btn"\n  onClick={handler}\n>\n  {t('save')}\n</button>`;
      expect(extractElementType(code)).toBe('button');
    });

    it('should not match elements inside HTML comments', () => {
      expect(extractElementType('<!-- <button>old</button> -->\n<div>content</div>')).toBeNull();
    });

    it('should extract anchor element', () => {
      expect(extractElementType('<a href="/home">Home</a>')).toBe('a');
    });
  });

  describe('synthesizeContext with key option', () => {
    function makeMatch(overrides: Partial<ContextMatch> = {}): ContextMatch {
      return {
        key: 'test_key',
        filePath: 'app.ts',
        line: 10,
        surroundingCode: 'const x = t("test_key");',
        matchedFunction: 't',
        ...overrides,
      };
    }

    it('should behave identically when called without options', () => {
      const matches = [makeMatch()];
      const withoutOptions = synthesizeContext(matches);
      const withEmptyOptions = synthesizeContext(matches, {});
      expect(withoutOptions).toBe(withEmptyOptions);
    });

    it('should prepend key path context when key is provided', () => {
      const matches = [makeMatch()];
      const result = synthesizeContext(matches, { key: 'nav.home' });
      expect(result).toMatch(/^Home in the nav section\./);
      expect(result).toContain('Used as t()');
    });

    it('should behave identically when key path returns empty', () => {
      const matches = [makeMatch()];
      const withSingleKey = synthesizeContext(matches, { key: 'x' });
      const without = synthesizeContext(matches);
      expect(withSingleKey).toBe(without);
    });
  });

  describe('KeyContext.elementType population', () => {
    it('should populate elementType from first match surrounding code', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/app.tsx']);
      mockReadFile.mockResolvedValue(`<button>{t('actions.save')}</button>`);

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.tsx'],
        rootDir: '/project',
      });

      const ctx = keyContexts.get('actions.save');
      expect(ctx).toBeDefined();
      expect(ctx!.elementType).toBe('button');
    });

    it('should set elementType to null when no element in surrounding code', async () => {
      mockFastGlob.mockResolvedValue(['/project/src/app.ts']);
      mockReadFile.mockResolvedValue(`const label = t('greeting');`);

      const { keyContexts } = await extractAllKeyContexts({
        scanPaths: ['src/**/*.ts'],
        rootDir: '/project',
      });

      const ctx = keyContexts.get('greeting');
      expect(ctx).toBeDefined();
      expect(ctx!.elementType).toBeNull();
    });
  });
});

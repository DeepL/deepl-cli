/**
 * Tests that bucket `include` globs cannot escape the project root.
 *
 * An include glob's literal prefix becomes the root of the stale `.bak` sweep,
 * which recurses without further containment checks: it deletes old `*.bak`
 * files and re-creates any file whose `.bak` exists while the live file is
 * missing or empty. A `..`-bearing glob would therefore reach outside the
 * project, so `include` must reject `..` the same way `target_path_pattern`
 * does.
 */

import { validateSyncConfig } from '../../../src/sync/sync-config';

function configWithInclude(include: string[]): Record<string, unknown> {
  return {
    version: 1,
    source_locale: 'en',
    target_locales: ['de'],
    buckets: { json: { include, target_path_pattern: 'locales/{locale}.json' } },
  };
}

describe('bucket include containment', () => {
  it.each([
    ['parent traversal', '../secrets/*.json'],
    ['deep traversal', '../../../../../../**/*.json'],
    ['traversal in the middle', 'locales/../../*.json'],
    ['absolute path', '/etc/*.json'],
  ])('should reject %s', (_label, glob) => {
    expect(() => validateSyncConfig(configWithInclude([glob]))).toThrow();
  });

  it('should reject a traversing entry even when other entries are fine', () => {
    expect(() =>
      validateSyncConfig(configWithInclude(['locales/en.json', '../../etc/*.json'])),
    ).toThrow();
  });

  it('should name the offending bucket and glob in the error', () => {
    expect(() => validateSyncConfig(configWithInclude(['../evil/*.json']))).toThrow(
      /include/i,
    );
  });

  it.each([
    ['a simple relative glob', 'locales/*.json'],
    ['a recursive glob', 'src/**/locales/*.json'],
    ['an exact relative path', 'locales/en.json'],
    ['a brace expansion', 'locales/{en,de}.json'],
    ['a leading ./', './locales/*.json'],
    ['a dotfile directory', '.config/locales/*.json'],
  ])('should accept %s', (_label, glob) => {
    expect(() => validateSyncConfig(configWithInclude([glob]))).not.toThrow();
  });

  it('should still reject a non-string include entry', () => {
    expect(() =>
      validateSyncConfig(configWithInclude([42 as unknown as string])),
    ).toThrow();
  });

  it('should still reject an empty include array', () => {
    expect(() => validateSyncConfig(configWithInclude([]))).toThrow();
  });
});

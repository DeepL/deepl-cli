/**
 * Tests that bucket `include` globs cannot escape the project root.
 *
 * `include` entries were validated only as non-empty strings, while
 * `target_path_pattern` a few lines later explicitly rejected `..`. The
 * unvalidated glob's literal prefix was then resolved and handed to the stale
 * `.bak` sweep, which recursed with no containment check — deleting every old
 * `*.bak` it found and *re-creating* any file whose `.bak` existed while the
 * live file was missing or empty. Verified reachable: with
 * `include: "../../../../../../**\/*.json"` the sweep root became `/var`, an
 * out-of-root `.bak` was deleted and its sibling resurrected. The sweep runs
 * even under `--dry-run`, and its errors were swallowed silently.
 *
 * The `sync init` wizard already rejected this exact input; the check simply
 * did not exist on the config-load path.
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

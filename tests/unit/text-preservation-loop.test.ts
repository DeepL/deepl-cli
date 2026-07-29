/**
 * Tests that placeholder restoration terminates.
 *
 * restorePlaceholders looped `while (restored.includes(placeholder))`,
 * re-running a single `replace` each pass. When the preserved original itself
 * contained the placeholder token, every pass re-inserted it: the guard never
 * went false and the string grew by the original's length forever.
 *
 * `preserveVariables`' pattern is `/\{[\p{L}\p{N}_]+\}/u`, which matches
 * `{__VAR_0__}` because underscores and digits are in the class — so a locale
 * file containing a token of that shape triggers it, and because variable
 * preservation runs unconditionally and restoration also runs on cached
 * results, it hangs with no API call at all.
 */

import { preserveVariables, preserveCodeBlocks, restorePlaceholders } from '../../src/utils/text-preservation';

describe('restorePlaceholders termination', () => {
  it('should terminate when the original contains its own placeholder token', () => {
    const map = new Map<string, string>();
    const preserved = preserveVariables('{__VAR_0__}', map);

    const restored = restorePlaceholders(preserved, map);

    expect(restored).toBe('{__VAR_0__}');
  });

  it('should terminate for a code block containing its own token', () => {
    const map = new Map<string, string>();
    const source = 'Run `__CODE_0__` first';
    const preserved = preserveCodeBlocks(source, map);

    const restored = restorePlaceholders(preserved, map);

    expect(restored).toBe(source);
  });

  it('should not grow the string beyond the original length', () => {
    const map = new Map<string, string>();
    const source = '{__VAR_0__} and {__VAR_1__}';
    const preserved = preserveVariables(source, map);

    const restored = restorePlaceholders(preserved, map);

    expect(restored.length).toBe(source.length);
  });

  it('should restore ordinary placeholders correctly', () => {
    const map = new Map<string, string>();
    const preserved = preserveVariables('Hello {name}, you have {count} items', map);

    const restored = restorePlaceholders(preserved, map);

    expect(restored).toBe('Hello {name}, you have {count} items');
  });

  it('should restore every occurrence of a repeated placeholder', () => {
    const map = new Map<string, string>([['__VAR_0__', '{name}']]);

    const restored = restorePlaceholders('__VAR_0__ and __VAR_0__ again', map);

    expect(restored).toBe('{name} and {name} again');
  });

  it('should leave text without placeholders untouched', () => {
    expect(restorePlaceholders('plain text', new Map())).toBe('plain text');
  });

  it('should not treat a $-sequence in the original as a replacement pattern', () => {
    // A naive String.replace would interpret $& / $1 in the replacement.
    const map = new Map<string, string>([['__VAR_0__', '$& $1 $$']]);

    const restored = restorePlaceholders('x __VAR_0__ y', map);

    expect(restored).toBe('x $& $1 $$ y');
  });
});

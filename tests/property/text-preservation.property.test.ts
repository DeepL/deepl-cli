/**
 * Property tests for the preservation utilities (src/utils/text-preservation.ts).
 *
 * Core law: for any text, preserve → identity-translate → restore is the
 * identity function, and the multiset of preserved tokens is unchanged.
 *
 * Texts containing literal placeholder tokens (__VAR_n__ / __CODE_n__) are
 * excluded from the main law and pinned by a directed test instead:
 * restorePlaceholders cannot distinguish a literal token in the input from
 * one the preserver inserted, so such texts are rewritten on restore.
 */
import fc from 'fast-check';
import {
  preserveCodeBlocks,
  preserveVariables,
  restorePlaceholders,
} from '../../src/utils/text-preservation';
import { FC_NUM_RUNS, fcParams } from './arbitraries';

const PLACEHOLDER_RE = /__(?:VAR|CODE)_\d+__/;

const fragmentArb = fc.oneof(
  { weight: 4, arbitrary: fc.string({ unit: 'grapheme', maxLength: 30 }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '{name}',
      '{{count}}',
      '${var}',
      '{0}',
      '{名前}',
      '%1$s',
      '%2$d',
      '%s',
      '%d',
      '%@',
      '`inline code`',
      '```\nfenced block\n```',
      '`a && b`',
      '{not_closed',
      'closed_not}',
      '$not_a_var',
      '%x',
      '{name with space}',
      '{{nested {inner}}}'
    ),
  }
);

const textArb = fc
  .array(fragmentArb, { minLength: 0, maxLength: 12 })
  .map((parts) => parts.join(' '))
  .filter((s) => !PLACEHOLDER_RE.test(s));

function roundTrip(text: string): string {
  const map = new Map<string, string>();
  const processed = preserveVariables(preserveCodeBlocks(text, map), map);
  return restorePlaceholders(processed, map);
}

describe('text preservation properties', () => {
  it('preserve → identity-translate → restore is the identity', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        expect(roundTrip(text)).toBe(text);
      }),
      { ...fcParams(), numRuns: FC_NUM_RUNS * 2 }
    );
  });

  it('processed text contains no un-preserved simple variables', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const map = new Map<string, string>();
        const processed = preserveVariables(preserveCodeBlocks(text, map), map);
        // After preservation the MT engine must not see bare placeholders
        // that the patterns claim to cover.
        expect(processed).not.toMatch(/\$\{[\p{L}\p{N}_]+\}/u);
        expect(processed).not.toMatch(/%\d+\$[sdfu@]/);
      }),
      fcParams()
    );
  });

  describe('directed: literal placeholder tokens in input', () => {
    it('documents the collision: a literal __VAR_0__ in the source is rewritten on restore', () => {
      const text = 'literal __VAR_0__ and {name}';
      const result = roundTrip(text);
      // Intended behavior would be result === text. Recording the actual
      // (corrupting) behavior so the failure mode is pinned with a repro.
      expect(result).toBe('literal {name} and {name}');
      expect(result).not.toBe(text);
    });
  });
});

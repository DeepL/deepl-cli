/**
 * Shared fast-check arbitraries for the property suite.
 *
 * Translation values are grapheme-based (no lone surrogates) with a pool of
 * adversarial constants mixed in: format syntax, entities, quotes, RTL,
 * astral characters, combining marks, placeholder patterns.
 *
 * Control characters other than \n and \t are excluded: they are invalid in
 * XML 1.0 and questionable input for every format, so they would only add
 * invalid-input noise to the run.
 */
import fc from 'fast-check';

export const NASTY_STRINGS: readonly string[] = [
  'Hello 😀 world', // astral / surrogate pair
  'café', // combining acute (NFD-style)
  'café', // precomposed (NFC)
  'שלום עולם', // RTL Hebrew
  'ثم شرب القهوة', // RTL Arabic
  '日本語のテキスト',
  'Türkçe İstanbul ı',
  'Terms & Conditions',
  '5 < 10 && 10 > 5',
  '<b>bold</b> <i>it</i>',
  ']]>',
  '"double" and \'single\' quotes',
  'back\\slash \\n literal',
  '{name} has {{count}} items',
  '${var} and %1$s and %s and %@',
  'line one\nline two',
  'tab\there',
  '  leading and trailing  ',
  "it''s '{'quoted'}' ICU",
  'key=value # hash ; semi : colon',
  'msgid "injected"',
  '<?php echo "hi"; ?>',
  '[section] toml = "like"',
  '- yaml: like',
  '=0 one other',
];

// eslint-disable-next-line no-control-regex -- excluding control chars is the point
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

/** A single translation value: never empty, no control chars beyond \n \t. */
export const translationArb: fc.Arbitrary<string> = fc
  .oneof(
    {
      weight: 3,
      arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 60 }),
    },
    { weight: 2, arbitrary: fc.constantFrom(...NASTY_STRINGS) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.constantFrom(...NASTY_STRINGS),
          fc.string({ unit: 'grapheme', maxLength: 20 })
        )
        .map(([nasty, tail]) => `${nasty}${tail}`),
    }
  )
  .filter((s) => s.length > 0 && !CONTROL_CHARS_RE.test(s));

/** Exactly `n` translation values. */
export function translationsArb(n: number): fc.Arbitrary<string[]> {
  return fc.array(translationArb, { minLength: n, maxLength: n });
}

export const FC_NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 200);

/**
 * Common fc.assert parameters. Replay a recorded failure with:
 *   FC_SEED=<seed> FC_PATH=<path> npx jest tests/property -t '<test name>'
 */
export function fcParams(): fc.Parameters<unknown> {
  const params: fc.Parameters<unknown> = { numRuns: FC_NUM_RUNS };
  if (process.env['FC_SEED']) {
    params.seed = Number(process.env['FC_SEED']);
  }
  if (process.env['FC_PATH']) {
    params.path = process.env['FC_PATH'];
    params.endOnFailure = true;
  }
  return params;
}

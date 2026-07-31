/**
 * Property tests for ICU MessageFormat preservation (src/utils/icu-preservation.ts).
 *
 * reassemble canonicalizes whitespace by design, so the laws are
 * extract-level, not byte-level:
 *   I1  non-ICU strings pass through byte-identical
 *   I2  parse → reassemble(identity) → parse preserves segment texts
 *   I3  the canonicalized form is a fixed point of another identity cycle
 *   I4  reassemble throws on a wrong translation count
 */
import fc from 'fast-check';
import { parseIcu } from '../../src/utils/icu-preservation';
import { fcParams } from './arbitraries';

const ICU_DETECT_RE = /\{\s*[\w]+\s*,\s*(?:plural|select|selectordinal)\s*,/;

/**
 * Leaf prose: no braces (would change nesting), no ICU-significant lone
 * apostrophe. Per ICU quoting, `'` immediately before `{`, `}`, or `#`
 * opens a quoted span — a leaf ending in `'` sits right before the branch's
 * closing `}` and swallows it, making the whole message legitimately
 * malformed. That is generator noise, not a parser defect (verified: the
 * parser falls back safely on such input).
 */
const leafArb = fc
  .string({ unit: 'grapheme', maxLength: 25 })
  .filter(
    (s) =>
      !s.includes('{') &&
      !s.includes('}') &&
      !/'(?=#|$)/.test(s) &&
      !ICU_DETECT_RE.test(s)
  );

const varNameArb = fc.constantFrom('count', 'gender', 'n', 'item_type', 'x2');

const pluralSelectorsArb = fc
  .uniqueArray(
    fc.constantFrom('=0', '=1', 'zero', 'one', 'two', 'few', 'many'),
    {
      minLength: 0,
      maxLength: 3,
    }
  )
  .map((sels) => [...sels, 'other']);

const selectSelectorsArb = fc
  .uniqueArray(fc.constantFrom('male', 'female', 'red', 'blue'), {
    minLength: 0,
    maxLength: 2,
  })
  .map((sels) => [...sels, 'other']);

interface IcuNode {
  varName: string;
  keyword: 'plural' | 'select' | 'selectordinal';
  branches: Array<{ selector: string; content: string | IcuNode }>;
}

function renderNode(node: IcuNode): string {
  const branches = node.branches
    .map((b) => {
      const inner =
        typeof b.content === 'string' ? b.content : renderNode(b.content);
      return `${b.selector} {${inner}}`;
    })
    .join(' ');
  return `{${node.varName}, ${node.keyword}, ${branches}}`;
}

const icuNodeArb: fc.Arbitrary<IcuNode> = fc.letrec<{ node: IcuNode }>(
  (tie) => ({
    node: fc
      .record({
        varName: varNameArb,
        keyword: fc.constantFrom('plural', 'select', 'selectordinal'),
        selectors: fc.oneof(pluralSelectorsArb, selectSelectorsArb),
        leaves: fc.array(leafArb, { minLength: 8, maxLength: 8 }),
        nestAt: fc.option(fc.nat(3), { nil: undefined }),
        nested: fc.option(
          tie('node').map((n) => n),
          { nil: undefined, depthSize: 'small' }
        ),
      })
      .map(({ varName, keyword, selectors, leaves, nestAt, nested }) => {
        const branches: IcuNode['branches'] = selectors.map((selector, i) => ({
          selector,
          content: leaves[i] ?? '',
        }));
        // Nested ICU is only supported when the branch content IS a full block.
        if (nested && nestAt !== undefined && nestAt < branches.length) {
          branches[nestAt]!.content = nested;
        }
        return { varName, keyword, branches };
      }),
  })
).node;

const icuMessageArb = fc
  .tuple(leafArb, icuNodeArb, leafArb)
  .map(([prefix, node, suffix]) => `${prefix}${renderNode(node)}${suffix}`);

const nonIcuArb = fc
  .string({ unit: 'grapheme', maxLength: 60 })
  .filter((s) => !ICU_DETECT_RE.test(s));

describe('ICU preservation properties', () => {
  it('I1: non-ICU strings pass through reassemble byte-identical', () => {
    fc.assert(
      fc.property(nonIcuArb, (text) => {
        const r = parseIcu(text);
        expect(r.isIcu).toBe(false);
        expect(r.reassemble([])).toBe(text);
      }),
      fcParams()
    );
  });

  it('I2+I3: identity reassembly preserves segment texts and reaches a fixed point', () => {
    fc.assert(
      fc.property(icuMessageArb, (message) => {
        const r1 = parseIcu(message);
        expect(r1.isIcu).toBe(true);

        const texts1 = r1.segments.map((s) => s.text);
        const rebuilt = r1.reassemble(texts1);

        const r2 = parseIcu(rebuilt);
        expect(r2.isIcu).toBe(true);
        expect(r2.segments.map((s) => s.text)).toEqual(texts1);

        // I3: canonical form is stable under another identity cycle
        const rebuilt2 = r2.reassemble(r2.segments.map((s) => s.text));
        expect(rebuilt2).toBe(rebuilt);
      }),
      fcParams()
    );
  });

  it('I4: reassemble throws on wrong translation count', () => {
    fc.assert(
      fc.property(icuMessageArb, (message) => {
        const r = parseIcu(message);
        expect(r.isIcu).toBe(true);
        expect(() =>
          r.reassemble([...r.segments.map((s) => s.text), 'extra'])
        ).toThrow(/expected \d+ translations/);
      }),
      fcParams()
    );
  });
});

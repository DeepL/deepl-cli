/**
 * Tests ICU preservation for messages with text around the ICU block.
 *
 * Detection must not be `^`-anchored: text before the block would leave the
 * string unrecognised as ICU, sending raw ICU syntax to the MT engine as prose.
 * The engine then translates the keyword and selectors —
 *
 *   in  You have {count, plural, one {# item} other {# items}} in your cart.
 *   out Sie haben {count, Plural, ein {# item} weiteres {# items}} in Ihrem Warenkorb.
 *
 * leaving a message with no valid format type and no `other` branch.
 */

import { parseIcu } from '../../src/utils/icu-preservation';

describe('ICU with surrounding text', () => {
  const LEADING = 'You have {count, plural, one {# item} other {# items}} in your cart.';

  it('should recognise a message with leading text as ICU', () => {
    expect(parseIcu(LEADING).isIcu).toBe(true);
  });

  it('should expose the surrounding prose as translatable segments', () => {
    const result = parseIcu(LEADING);

    const texts = result.segments.map((s) => s.text);
    expect(texts).toContain('# item');
    expect(texts).toContain('# items');
    // The prose around the block must be translated too, not left in English.
    expect(texts.some((t) => t.includes('You have'))).toBe(true);
    expect(texts.some((t) => t.includes('in your cart'))).toBe(true);
  });

  it('should reassemble with the ICU structure intact', () => {
    const result = parseIcu(LEADING);
    const translated = result.segments.map((s) => `[de]${s.text}`);

    const out = result.reassemble(translated);

    // Keyword and selectors must survive verbatim.
    expect(out).toContain('plural,');
    expect(out).toMatch(/\bone\s*\{/);
    expect(out).toMatch(/\bother\s*\{/);
    expect(out).toContain('count');
    expect(out).not.toContain('Plural');
  });

  it('should round-trip an identity translation unchanged', () => {
    const result = parseIcu(LEADING);

    const out = result.reassemble(result.segments.map((s) => s.text));

    expect(out).toBe(LEADING);
  });

  it('should still handle a bare ICU block at position 0', () => {
    const bare = '{count, plural, one {# item} other {# items}}';
    const result = parseIcu(bare);

    expect(result.isIcu).toBe(true);
    expect(result.reassemble(result.segments.map((s) => s.text))).toBe(bare);
  });

  it('should still handle trailing text only', () => {
    const trailing = '{count, plural, one {# item} other {# items}} remaining';
    const result = parseIcu(trailing);

    expect(result.isIcu).toBe(true);
    expect(result.reassemble(result.segments.map((s) => s.text))).toBe(trailing);
  });

  it('should not treat an ordinary string as ICU', () => {
    expect(parseIcu('Just a normal sentence.').isIcu).toBe(false);
    expect(parseIcu('A brace { but no ICU').isIcu).toBe(false);
  });

  it('should not treat a plain variable placeholder as ICU', () => {
    expect(parseIcu('Hello {name}, welcome').isIcu).toBe(false);
  });

  it('should throw rather than emit empty branches on a length mismatch', () => {
    const result = parseIcu(LEADING);

    // Fewer translations than segments must throw rather than emit `one {}` —
    // an empty plural branch renders nothing for that category.
    expect(() => result.reassemble(['only-one'])).toThrow();
  });
});

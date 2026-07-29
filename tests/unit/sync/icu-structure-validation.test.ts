/**
 * Tests that ICU structural damage is detected.
 *
 * Brace counts and nesting depth are identical before and after an MT engine
 * translates the format keyword, the selectors, or the argument name
 * (`plural` → `Plural`, `one` → `ein`, `other` → `weiteres`), so validation
 * must inspect those tokens directly. Otherwise a message with no valid format
 * type and no fallback branch returns `pass` and `fail_on_error` never trips.
 */

import { validateTranslation } from '../../../src/sync/translation-validator';

const SOURCE = '{count, plural, one {# item} other {# items}}';

function severityOf(source: string, translation: string): string {
  return validateTranslation('item_count', source, translation).severity;
}

describe('ICU structure validation', () => {
  it('should pass an intact translation', () => {
    expect(severityOf(SOURCE, '{count, plural, one {# Artikel} other {# Artikel}}')).toBe('pass');
  });

  it('should flag a translated format keyword', () => {
    expect(severityOf(SOURCE, '{count, Plural, one {# Artikel} other {# Artikel}}')).not.toBe(
      'pass',
    );
  });

  it('should flag translated plural selectors', () => {
    expect(severityOf(SOURCE, '{count, plural, eins {# Artikel} andere {# Artikel}}')).not.toBe(
      'pass',
    );
  });

  it('should flag a translated argument name', () => {
    // The app passes `count`; renaming it breaks variable binding entirely.
    expect(severityOf(SOURCE, '{Anzahl, plural, one {# Artikel} other {# Artikel}}')).not.toBe(
      'pass',
    );
  });

  it('should flag the full live-API corruption', () => {
    const asReturnedByEngine = '{count, Plural, ein {# item} weiteres {# items}}';

    expect(severityOf(SOURCE, asReturnedByEngine)).not.toBe('pass');
  });

  it('should flag a dropped selector branch', () => {
    expect(severityOf(SOURCE, '{count, plural, one {# Artikel}}')).not.toBe('pass');
  });

  it('should tolerate reordered selectors', () => {
    // Order is not semantically meaningful in ICU.
    expect(severityOf(SOURCE, '{count, plural, other {# Artikel} one {# Artikel}}')).toBe('pass');
  });

  it('should not flag an ordinary non-ICU translation', () => {
    expect(severityOf('Hello world', 'Hallo Welt')).toBe('pass');
  });

  it('should handle a message with surrounding prose', () => {
    const source = 'You have {count, plural, one {# item} other {# items}} in your cart.';
    const good = 'Sie haben {count, plural, one {# Artikel} other {# Artikel}} im Warenkorb.';
    const bad = 'Sie haben {count, Plural, ein {# Artikel} weiteres {# Artikel}} im Warenkorb.';

    expect(severityOf(source, good)).toBe('pass');
    expect(severityOf(source, bad)).not.toBe('pass');
  });
});

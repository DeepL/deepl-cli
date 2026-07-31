/**
 * Directed demonstration (not a property).
 *
 * TranslationService.generateCacheKey hashes the raw text without Unicode
 * normalization, so NFC and NFD encodings of the same visible string produce
 * two cache entries — and therefore two billable API calls.
 *
 * generateCacheKey reads nothing from `this`, so it is invoked via the
 * prototype without constructing the service.
 */
import { TranslationService } from '../../src/services/translation';

type KeyFn = (text: string, options: { targetLang: string }) => string;

const generateCacheKey = (
  TranslationService.prototype as unknown as { generateCacheKey: KeyFn }
).generateCacheKey;

describe('translation cache key normalization', () => {
  it('documents that NFC and NFD of the same visible string produce distinct keys', () => {
    const nfc = 'café'.normalize('NFC');
    const nfd = 'café'.normalize('NFD');
    expect(nfc).not.toBe(nfd); // different code points
    expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC')); // same visible string

    const keyNfc = generateCacheKey.call(null, nfc, { targetLang: 'de' });
    const keyNfd = generateCacheKey.call(null, nfd, { targetLang: 'de' });

    // Current behavior: two entries for one visible string. Whether this is
    // a bug or intentional exact-input keying is a policy decision.
    expect(keyNfc).not.toBe(keyNfd);
  });
});

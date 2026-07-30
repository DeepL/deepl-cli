/**
 * Tests for Translation Memory resolver service.
 */

import {
  resolveTranslationMemoryId,
  sanitizeForError,
  TranslationMemoryLister,
} from '../../src/services/translation-memory';
import { ConfigError } from '../../src/utils/errors';
import type { TranslationMemory } from '../../src/types/index';

const UUID = '11111111-2222-3333-4444-555555555555';

const makeTm = (overrides: Partial<TranslationMemory> = {}): TranslationMemory => ({
  translation_memory_id: UUID,
  name: 'my-tm',
  source_language: 'en',
  target_languages: ['de'],
  ...overrides,
});

const makeClient = (tms: TranslationMemory[] = []): jest.Mocked<TranslationMemoryLister> => ({
  listTranslationMemories: jest.fn().mockResolvedValue(tms),
});

describe('sanitizeForError', () => {
  it('strips ASCII control characters (\\x00-\\x1f and \\x7f)', () => {
    const dirty = `foo\x00bar\x07baz\x1fqux\x7fend`;
    expect(sanitizeForError(dirty)).toBe('foobarbazquxend');
  });

  it('clamps input to 80 characters after stripping controls', () => {
    const input = 'x'.repeat(100);
    const out = sanitizeForError(input);
    expect(out).toHaveLength(80);
    expect(out).toBe('x'.repeat(80));
  });

  it('returns clean short input unchanged', () => {
    expect(sanitizeForError('my-tm')).toBe('my-tm');
  });
});

describe('resolveTranslationMemoryId', () => {
  describe('UUID path', () => {
    it('returns UUID unchanged without calling the API', async () => {
      const client = makeClient();
      const cache = new Map<string, string>();

      const id = await resolveTranslationMemoryId(client, UUID, cache);

      expect(id).toBe(UUID);
      expect(client.listTranslationMemories).toHaveBeenCalledTimes(0);
    });

    it('returns mixed-case UUID unchanged (regex is case-insensitive)', async () => {
      const client = makeClient();
      const cache = new Map<string, string>();
      const upper = UUID.toUpperCase();

      const id = await resolveTranslationMemoryId(client, upper, cache);

      expect(id).toBe(upper);
      expect(client.listTranslationMemories).toHaveBeenCalledTimes(0);
    });

    it('skips pair validation on UUID path even when expected does not match', async () => {
      const client = makeClient();
      const cache = new Map<string, string>();

      const id = await resolveTranslationMemoryId(client, UUID, cache, {
        from: 'fr',
        targets: ['it'],
      });

      expect(id).toBe(UUID);
      expect(client.listTranslationMemories).toHaveBeenCalledTimes(0);
    });
  });

  describe('cache behavior', () => {
    it('returns cached UUID without re-fetching', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>([['my-tm', UUID]]);

      const id = await resolveTranslationMemoryId(client, 'my-tm', cache);

      expect(id).toBe(UUID);
      expect(client.listTranslationMemories).toHaveBeenCalledTimes(0);
    });

    it('populates cache on first name resolution and reuses it on the second call', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();

      const first = await resolveTranslationMemoryId(client, 'my-tm', cache);
      const second = await resolveTranslationMemoryId(client, 'my-tm', cache);

      expect(first).toBe(UUID);
      expect(second).toBe(UUID);
      expect(client.listTranslationMemories).toHaveBeenCalledTimes(1);
      expect(cache.get('my-tm')).toBe(UUID);
    });

    it('re-runs pair-check when same TM name is requested with a different expected pair (cache does not bypass validation)', async () => {
      const client = makeClient([makeTm({ source_language: 'en', target_languages: ['de'] })]);
      const cache = new Map<string, string>();

      const first = await resolveTranslationMemoryId(client, 'my-tm', cache, {
        from: 'en', targets: ['de'],
      });
      expect(first).toBe(UUID);

      await expect(
        resolveTranslationMemoryId(client, 'my-tm', cache, {
          from: 'en', targets: ['fr'],
        })
      ).rejects.toThrow('does not support the requested language pair');
    });

    it('reuses cached UUID when the same name + same pair is requested twice (no extra list call)', async () => {
      const client = makeClient([makeTm({ source_language: 'en', target_languages: ['de'] })]);
      const cache = new Map<string, string>();

      const first = await resolveTranslationMemoryId(client, 'my-tm', cache, {
        from: 'en', targets: ['de'],
      });
      const second = await resolveTranslationMemoryId(client, 'my-tm', cache, {
        from: 'en', targets: ['de'],
      });

      expect(first).toBe(UUID);
      expect(second).toBe(UUID);
      expect(client.listTranslationMemories).toHaveBeenCalledTimes(1);
    });
  });

  describe('API-returned name trust boundary', () => {
    it('treats a TM whose name contains ASCII control chars as non-existent (silent skip)', async () => {
      const poisonedTm = makeTm({
        translation_memory_id: '22222222-2222-3333-4444-555555555555',
        name: 'prod-tm\x00',
      });
      const client = makeClient([poisonedTm]);
      const cache = new Map<string, string>();

      await expect(
        resolveTranslationMemoryId(client, 'prod-tm\x00', cache, { from: 'en', targets: ['de'] }),
      ).rejects.toThrow(/not found/);
    });

    it('treats a TM whose name contains zero-width codepoints as non-existent (silent skip)', async () => {
      const homoglyphTm = makeTm({
        translation_memory_id: '22222222-2222-3333-4444-555555555555',
        name: 'prod-tm\u200B',
      });
      const client = makeClient([homoglyphTm]);
      const cache = new Map<string, string>();

      await expect(
        resolveTranslationMemoryId(client, 'prod-tm\u200B', cache, { from: 'en', targets: ['de'] }),
      ).rejects.toThrow(/not found/);
    });

    it('throws ConfigError when two TMs share the same exact name (no first-create-wins)', async () => {
      const first = makeTm({ translation_memory_id: UUID, name: 'shared' });
      const second = makeTm({ translation_memory_id: '22222222-2222-3333-4444-555555555555', name: 'shared' });
      const client = makeClient([first, second]);
      const cache = new Map<string, string>();

      await expect(
        resolveTranslationMemoryId(client, 'shared', cache, { from: 'en', targets: ['de'] }),
      ).rejects.toThrow(/Multiple translation memories share the name/);
    });

    it('legit unambiguous name still resolves cleanly (no false positive)', async () => {
      const client = makeClient([makeTm({ translation_memory_id: UUID, name: 'my-tm' })]);
      const cache = new Map<string, string>();

      const resolved = await resolveTranslationMemoryId(client, 'my-tm', cache, {
        from: 'en', targets: ['de'],
      });

      expect(resolved).toBe(UUID);
    });

    it('filter + dedup coexist: legit TM resolves even when a filtered sibling exists', async () => {
      const legit = makeTm({ translation_memory_id: UUID, name: 'prod-tm' });
      const filteredSibling = makeTm({
        translation_memory_id: '22222222-2222-3333-4444-555555555555',
        name: 'prod-tm\x00',
      });
      const client = makeClient([legit, filteredSibling]);
      const cache = new Map<string, string>();

      const resolved = await resolveTranslationMemoryId(client, 'prod-tm', cache, {
        from: 'en', targets: ['de'],
      });

      expect(resolved).toBe(UUID);
    });
  });

  describe('verbose logging', () => {
    it('emits a verbose log with resolved TM name -> UUID after name lookup', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();
      const { Logger } = jest.requireActual('../../src/utils/logger');
      const spy = jest.spyOn(Logger, 'verbose').mockImplementation(() => {});

      await resolveTranslationMemoryId(client, 'my-tm', cache);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining(`Resolved translation memory "my-tm" -> ${UUID}`)
      );
      spy.mockRestore();
    });

    it('emits a verbose log on cache hit for TM name', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();
      const { Logger } = jest.requireActual('../../src/utils/logger');
      const spy = jest.spyOn(Logger, 'verbose').mockImplementation(() => {});

      await resolveTranslationMemoryId(client, 'my-tm', cache);
      spy.mockClear();
      await resolveTranslationMemoryId(client, 'my-tm', cache);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining(`Translation memory cache hit: "my-tm" -> ${UUID}`)
      );
      spy.mockRestore();
    });
  });

  describe('name-not-found', () => {
    it('throws ConfigError with the verbatim suggestion', async () => {
      expect.assertions(4);
      const client = makeClient([]);
      const cache = new Map<string, string>();

      let thrown: unknown;
      try {
        await resolveTranslationMemoryId(client, 'missing-tm', cache);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConfigError);
      const err = thrown as ConfigError;
      expect(err.message).toBe('Translation memory "missing-tm" not found');
      expect(err.suggestion).toBe(
        'Pass the UUID directly, or check your translation memories on the DeepL dashboard.',
      );
      expect(err.exitCode).toBe(7);
    });

    it('sanitizes control chars and clamps to 80 chars in the error message', async () => {
      expect.assertions(2);
      const client = makeClient([]);
      const cache = new Map<string, string>();
      const dirty = `bad\x07${'x'.repeat(100)}`;
      const expectedName = `bad${'x'.repeat(77)}`;

      let thrown: unknown;
      try {
        await resolveTranslationMemoryId(client, dirty, cache);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConfigError);
      expect((thrown as ConfigError).message).toBe(
        `Translation memory "${expectedName}" not found`,
      );
    });
  });

  describe('pair validation (name path)', () => {
    it('accepts when source and target match (case-insensitive)', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();

      const id = await resolveTranslationMemoryId(client, 'my-tm', cache, {
        from: 'en',
        targets: ['de'],
      });

      expect(id).toBe(UUID);
    });

    it('throws ConfigError when source language mismatches', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();

      await expect(
        resolveTranslationMemoryId(client, 'my-tm', cache, {
          from: 'fr',
          targets: ['de'],
        }),
      ).rejects.toBeInstanceOf(ConfigError);
    });

    it('throws ConfigError when target language mismatches', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();

      await expect(
        resolveTranslationMemoryId(client, 'my-tm', cache, {
          from: 'en',
          targets: ['fr'],
        }),
      ).rejects.toBeInstanceOf(ConfigError);
    });

    it('throws ConfigError when any target in a multi-target list mismatches', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();

      await expect(
        resolveTranslationMemoryId(client, 'my-tm', cache, {
          from: 'en',
          targets: ['de', 'fr'],
        }),
      ).rejects.toBeInstanceOf(ConfigError);
    });

    it('does not cache the resolved id when pair validation fails', async () => {
      const client = makeClient([makeTm()]);
      const cache = new Map<string, string>();

      await expect(
        resolveTranslationMemoryId(client, 'my-tm', cache, {
          from: 'fr',
          targets: ['de'],
        }),
      ).rejects.toBeInstanceOf(ConfigError);

      expect(cache.has('my-tm')).toBe(false);
    });
  });
});

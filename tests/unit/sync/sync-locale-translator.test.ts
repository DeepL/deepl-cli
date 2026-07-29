import { LocaleTranslator } from '../../../src/sync/sync-locale-translator';
import type { LocaleTranslatorContext } from '../../../src/sync/sync-locale-translator';
import type { ResolvedSyncConfig } from '../../../src/sync/sync-config';
import type { SyncDiff } from '../../../src/sync/types';
import type { KeyContext } from '../../../src/sync/sync-context';
import type { FormatParser } from '../../../src/formats/format';
import type { TranslationOptions } from '../../../src/types/api';
import { createMockTranslationService } from '../../helpers/mock-factories';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    mkdir: jest.fn(),
    copyFile: jest.fn(),
  },
}));

jest.mock('../../../src/utils/atomic-write', () => ({
  atomicWriteFile: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

jest.mock('../../../src/sync/sync-utils', () => ({
  resolveTargetPath: jest.fn(),
  assertPathWithinRoot: jest.fn(),
}));

jest.mock('../../../src/sync/translation-validator', () => ({
  validateBatch: jest.fn(),
}));

import * as fs from 'fs';
import { atomicWriteFile } from '../../../src/utils/atomic-write';
import { resolveTargetPath, assertPathWithinRoot } from '../../../src/sync/sync-utils';
import { validateBatch } from '../../../src/sync/translation-validator';

const mockReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;
const mockMkdir = fs.promises.mkdir as jest.MockedFunction<typeof fs.promises.mkdir>;
const mockAtomicWriteFile = atomicWriteFile as jest.MockedFunction<typeof atomicWriteFile>;
const mockResolveTargetPath = resolveTargetPath as jest.MockedFunction<typeof resolveTargetPath>;
const mockAssertPathWithinRoot = assertPathWithinRoot as jest.MockedFunction<typeof assertPathWithinRoot>;
const mockValidateBatch = validateBatch as jest.MockedFunction<typeof validateBatch>;

beforeEach(() => {
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockMkdir.mockResolvedValue(undefined);
  mockAtomicWriteFile.mockResolvedValue(undefined);
  mockResolveTargetPath.mockReturnValue('locales/de.json');
  mockAssertPathWithinRoot.mockReturnValue(undefined);
  mockValidateBatch.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTranslationResult(text: string, billedCharacters = text.length) {
  return { text, billedCharacters, detectedSourceLanguage: 'en' as const };
}

function makeDiff(key: string, value: string, metadata?: Record<string, unknown>): SyncDiff {
  return { key, value, status: 'new' as const, metadata };
}

function makeConfig(overrides: Partial<ResolvedSyncConfig> = {}): ResolvedSyncConfig {
  return {
    version: 1,
    source_locale: 'en',
    target_locales: ['de'],
    buckets: {},
    projectRoot: '/project',
    configPath: '/project/.deepl-sync.yaml',
    overrides: {},
    translation: {},
    validation: { validate_after_sync: false },
    ...overrides,
  };
}

function makeParser(): FormatParser {
  return {
    name: 'JSON',
    configKey: 'json',
    extensions: ['.json'],
    extract: jest.fn().mockReturnValue([]),
    reconstruct: jest.fn().mockReturnValue('{}'),
  };
}

function makeCtx(
  diffs: SyncDiff[],
  keyContexts: Map<string, KeyContext>,
  locale = 'de',
): LocaleTranslatorContext {
  return {
    locale,
    relPath: 'locales/en.json',
    content: '{}',
    parser: makeParser(),
    diffs,
    toTranslate: diffs.filter(d => d.status === 'new'),
    fileLockEntries: {},
    existingTargetEntries: new Map(),
    keyContexts,
    localeGlossaryIds: new Map(),
    localeTmIds: new Map(),
    bucketConfig: { include: ['locales/en.json'] },
    isMultiLocale: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers for capturing translateBatch calls
// ---------------------------------------------------------------------------
type CapturedCall = { texts: string[]; opts: TranslationOptions };

function captureTranslateBatch(returnTexts: string[]): {
  mock: ReturnType<typeof createMockTranslationService>;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  let callIndex = 0;
  const mock = createMockTranslationService({
    translateBatch: jest.fn().mockImplementation((texts: string[], opts: TranslationOptions) => {
      calls.push({ texts: [...texts], opts: { ...opts } });
      const start = callIndex;
      callIndex += texts.length;
      return Promise.resolve(texts.map((_, i) => makeTranslationResult(returnTexts[start + i] ?? `translated-${start + i}`)));
    }),
  });
  return { mock, calls };
}

function makeTranslator(
  svc: ReturnType<typeof createMockTranslationService>,
  config: ResolvedSyncConfig,
  forceBatch?: boolean,
): LocaleTranslator {
  return new LocaleTranslator(
    svc,
    new Set<string>(),
    config,
    undefined,
    undefined,
    forceBatch,
    undefined,
  );
}

// ---------------------------------------------------------------------------
// 1. Path A: plain batch — no context, no custom_instructions
// ---------------------------------------------------------------------------
describe('LocaleTranslator', () => {
  describe('Path A — plain batch', () => {
    it('should call translateBatch without context or custom_instructions', async () => {
      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello'), makeDiff('farewell', 'Goodbye')];
      const { mock, calls } = captureTranslateBatch(['Hallo', 'Tschüss']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(calls).toHaveLength(1);
      expect(calls[0]!.opts.context).toBeUndefined();
      expect(calls[0]!.opts.customInstructions).toBeUndefined();
    });

    it('should include all plain-batch keys in a single translateBatch call', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('key.a', 'Alpha'),
        makeDiff('key.b', 'Beta'),
        makeDiff('key.c', 'Gamma'),
      ];
      const { mock, calls } = captureTranslateBatch(['A', 'B', 'C']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(calls).toHaveLength(1);
      expect(calls[0]!.texts).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Path B1: section-batched context
  // ---------------------------------------------------------------------------
  describe('Path B1 — section-batched context', () => {
    it('should send context field but no custom_instructions for keys with section context', async () => {
      const config = makeConfig();
      // Keys sharing a section parent ("nav") trigger section batching.
      const diffs = [
        makeDiff('nav.home', 'Home'),
        makeDiff('nav.about', 'About'),
        makeDiff('other.key', 'Other'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['nav.home', { key: 'nav.home', context: 'Navigation link', occurrences: 1, elementType: null }],
        ['nav.about', { key: 'nav.about', context: 'Navigation link', occurrences: 1, elementType: null }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Startseite', 'Über uns', 'Andere']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      // Path A call (other.key)
      const plainCall = calls.find(c => c.opts.context === undefined);
      expect(plainCall).toBeDefined();
      expect(plainCall!.opts.customInstructions).toBeUndefined();

      // Path B1 call (nav.*)
      const contextCall = calls.find(c => c.opts.context !== undefined && c.opts.context !== '');
      expect(contextCall).toBeDefined();
      expect(contextCall!.opts.context).toMatch(/nav/i);
      expect(contextCall!.opts.customInstructions).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Path B2: per-key context (--no-batch / forceBatch=false)
  // ---------------------------------------------------------------------------
  describe('Path B2 — per-key context (forceBatch=false)', () => {
    it('should call translateBatch per key with context but no custom_instructions', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('btn.save', 'Save'),
        makeDiff('btn.cancel', 'Cancel'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['btn.save', { key: 'btn.save', context: 'Save button label', occurrences: 1, elementType: null }],
        ['btn.cancel', { key: 'btn.cancel', context: 'Cancel button label', occurrences: 1, elementType: null }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Speichern', 'Abbrechen']);
      // forceBatch=false → per-key (--no-batch mode)
      await makeTranslator(mock, config, false).translate(makeCtx(diffs, keyContexts));

      // Each context key gets its own call
      const contextCalls = calls.filter(c => c.opts.context && c.opts.context !== '');
      expect(contextCalls).toHaveLength(2);
      for (const call of contextCalls) {
        expect(call.opts.context).toBeTruthy();
        expect(call.opts.customInstructions).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Path C: element instruction — custom_instructions specific to element type
  // ---------------------------------------------------------------------------
  describe('Path C — element instruction batch', () => {
    it('should send custom_instructions containing element-specific text for button keys', async () => {
      const config = makeConfig();
      const diffs = [makeDiff('cta.submit', 'Submit'), makeDiff('nav.home', 'Home')];
      const keyContexts = new Map<string, KeyContext>([
        ['cta.submit', { key: 'cta.submit', context: '', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Absenden', 'Startseite']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      const instructionCall = calls.find(c =>
        Array.isArray(c.opts.customInstructions) && c.opts.customInstructions.length > 0,
      );
      expect(instructionCall).toBeDefined();
      expect(instructionCall!.opts.customInstructions).toEqual(
        expect.arrayContaining([expect.stringMatching(/concise|maximum 3 words/i)]),
      );
      expect(instructionCall!.opts.context).toBeUndefined();
    });

    it('should send element-type-specific instructions for anchor (a) elements', async () => {
      const config = makeConfig();
      // Need 2+ keys to trigger the three-way partition (single key uses fast path)
      const diffs = [makeDiff('link.read_more', 'Read more'), makeDiff('plain.key', 'Plain')];
      const keyContexts = new Map<string, KeyContext>([
        ['link.read_more', { key: 'link.read_more', context: '', occurrences: 1, elementType: 'a' }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Mehr lesen', 'Schlicht']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      const instructionCall = calls.find(c =>
        Array.isArray(c.opts.customInstructions) && c.opts.customInstructions.length > 0,
      );
      expect(instructionCall).toBeDefined();
      expect(instructionCall!.opts.customInstructions).toEqual(
        expect.arrayContaining([expect.stringMatching(/link text|concise/i)]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Path C batch grouping — same element type shares one call; different types are separate
  // ---------------------------------------------------------------------------
  describe('Path C — batch grouping by element type', () => {
    it('should group keys with the same element type into a single translateBatch call', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('cta.save', 'Save'),
        makeDiff('cta.delete', 'Delete'),
        makeDiff('cta.submit', 'Submit'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['cta.save', { key: 'cta.save', context: '', occurrences: 1, elementType: 'button' }],
        ['cta.delete', { key: 'cta.delete', context: '', occurrences: 1, elementType: 'button' }],
        ['cta.submit', { key: 'cta.submit', context: '', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Speichern', 'Löschen', 'Absenden']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      const instructionCalls = calls.filter(c =>
        Array.isArray(c.opts.customInstructions) && c.opts.customInstructions.length > 0,
      );
      expect(instructionCalls).toHaveLength(1);
      expect(instructionCalls[0]!.texts).toHaveLength(3);
    });

    it('should make separate translateBatch calls for different element types', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('cta.save', 'Save'),
        makeDiff('heading.title', 'Welcome'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['cta.save', { key: 'cta.save', context: '', occurrences: 1, elementType: 'button' }],
        ['heading.title', { key: 'heading.title', context: '', occurrences: 1, elementType: 'h1' }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Speichern', 'Willkommen']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      const instructionCalls = calls.filter(c =>
        Array.isArray(c.opts.customInstructions) && c.opts.customInstructions.length > 0,
      );
      expect(instructionCalls).toHaveLength(2);
      const instructions = instructionCalls.map(c => c.opts.customInstructions!.join(' '));
      expect(instructions.some(i => /3 words/i.test(i))).toBe(true); // button
      expect(instructions.some(i => /heading|impactful/i.test(i))).toBe(true); // h1
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Plural slots routed correctly through Path A (new Set(batchIndices) flow)
  // ---------------------------------------------------------------------------
  describe('plural slots — Set(batchIndices) routing', () => {
    it('should include plural slot texts in the plain batch when primary key is a plain key', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('item_count', '1 item', {
          msgid_plural: '%d items',
        }),
      ];
      const { mock, calls } = captureTranslateBatch(['1 Element', '%d Elemente']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      // The plain batch call should contain both the singular and plural text.
      // %d is preserved as a placeholder token by preserveVariables, so we
      // only assert on length and a substring that survives preservation.
      const batchCall = calls.find(c => c.opts.context === undefined);
      expect(batchCall).toBeDefined();
      expect(batchCall!.texts).toHaveLength(2);
      expect(batchCall!.texts[0]).toContain('item');
      expect(batchCall!.texts[1]).toContain('items');
    });

    it('should route plural slot texts through Path C when primary key has an element type', async () => {
      const config = makeConfig();
      // Two diffs to trigger the three-way partition; only btn.count has a plural slot
      const diffs = [
        makeDiff('btn.count', '1 click', { msgid_plural: '%d clicks' }),
        makeDiff('plain.other', 'Other text'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['btn.count', { key: 'btn.count', context: '', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock, calls } = captureTranslateBatch(['1 Klick', '%d Klicks', 'Anderer Text']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      const instructionCall = calls.find(c =>
        Array.isArray(c.opts.customInstructions) && c.opts.customInstructions.length > 0,
      );
      expect(instructionCall).toBeDefined();
      // Both plural forms (singular + plural slot) should be in the instruction batch
      expect(instructionCall!.texts).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Mutation canary: Path C regresses if generateElementInstruction returns undefined
  // ---------------------------------------------------------------------------
  describe('mutation canary — generateElementInstruction', () => {
    it('should FAIL if generateElementInstruction always returns undefined (Path C regression)', async () => {
      // Explicit canary: asserts that a key with elementType='button'
      // receives custom_instructions in its translation call. The three-way partition only
      // activates with 2+ keys, so we include a plain key alongside the button key.
      //
      // If generateElementInstruction were mutated to return undefined, Path C keys fall
      // through to the plain batch, custom_instructions is absent, and this assertion fails.
      const config = makeConfig();
      const diffs = [
        makeDiff('cta.ok', 'OK'),
        makeDiff('plain.text', 'Some text'), // ensures three-way partition activates
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['cta.ok', { key: 'cta.ok', context: '', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock, calls } = captureTranslateBatch(['OK', 'Irgendein Text']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      // The button key must have been translated with custom_instructions (Path C).
      // If generateElementInstruction returns undefined the key falls to Path A and
      // both keys are batched together WITHOUT custom_instructions — canary fires.
      const instructionCall = calls.find(c =>
        Array.isArray(c.opts.customInstructions) && c.opts.customInstructions.length > 0,
      );
      expect(instructionCall).toBeDefined();
      expect(instructionCall!.opts.customInstructions).toEqual(
        expect.arrayContaining([expect.stringMatching(/concise|3 words/i)]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Translation memory / glossary wiring
  // ---------------------------------------------------------------------------
  describe('translation memory and glossary wiring', () => {
    it('should propagate translationMemoryId to every translateBatch call', async () => {
      const TM_ID = 'tm-abc-123';
      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello'), makeDiff('farewell', 'Goodbye')];
      const { mock, calls } = captureTranslateBatch(['Hallo', 'Tschüss']);
      const translator = new LocaleTranslator(
        mock,
        new Set<string>(),
        config,
        undefined,
        TM_ID,
        undefined,
        undefined,
      );

      await translator.translate(makeCtx(diffs, new Map()));

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.opts.translationMemoryId).toBe(TM_ID);
      }
    });

    it('should propagate glossaryId to every translateBatch call', async () => {
      const GLOSSARY_ID = 'gl-xyz-456';
      const config = makeConfig();
      const diffs = [makeDiff('term.api', 'API')];
      const { mock, calls } = captureTranslateBatch(['API']);
      const translator = new LocaleTranslator(
        mock,
        new Set<string>(),
        config,
        GLOSSARY_ID,
        undefined,
        undefined,
        undefined,
      );

      await translator.translate(makeCtx(diffs, new Map()));

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.opts.glossaryId).toBe(GLOSSARY_ID);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Single-key fast path with context
  // ---------------------------------------------------------------------------
  describe('single-key fast path with context', () => {
    it('should attach context to the sole key and record it in contextSentKeys', async () => {
      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const keyContexts = new Map<string, KeyContext>([
        ['greeting', { key: 'greeting', context: 'Homepage hero line', occurrences: 1, elementType: null }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Hallo']);

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      expect(calls).toHaveLength(1);
      expect(calls[0]!.opts.context).toBe('Homepage hero line');
      expect(result.contextSentKeys.has('greeting')).toBe(true);
    });

    it('should skip context tracking when forceBatch=true even with a single key', async () => {
      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const keyContexts = new Map<string, KeyContext>([
        ['greeting', { key: 'greeting', context: 'Irrelevant in force-batch mode', occurrences: 1, elementType: null }],
      ]);
      const { mock } = captureTranslateBatch(['Hallo']);

      const result = await makeTranslator(mock, config, true).translate(makeCtx(diffs, keyContexts));

      expect(result.contextSentKeys.has('greeting')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Validation counters
  // ---------------------------------------------------------------------------
  describe('validation counters', () => {
    it('should tally warnings and errors from validateBatch when validation is enabled', async () => {
      mockValidateBatch.mockReturnValueOnce([
        {
          key: 'a', source: 'Alpha', translation: 'A', severity: 'warn',
          issues: [{ check: 'placeholder', severity: 'warn', message: 'warning' }],
        },
        {
          key: 'b', source: 'Beta', translation: 'B', severity: 'error',
          issues: [
            { check: 'placeholder', severity: 'error', message: 'error1' },
            { check: 'placeholder', severity: 'error', message: 'error2' },
          ],
        },
      ]);

      const config = makeConfig({
        validation: { validate_after_sync: true, check_placeholders: true },
      });
      const diffs = [makeDiff('a', 'Alpha'), makeDiff('b', 'Beta')];
      const { mock } = captureTranslateBatch(['A', 'B']);

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(result.validationWarnings).toBe(1);
      expect(result.validationErrors).toBe(2);
    });

    it('should skip validation when validate_after_sync is false', async () => {
      const config = makeConfig({
        validation: { validate_after_sync: false },
      });
      const diffs = [makeDiff('a', 'Alpha')];
      const { mock } = captureTranslateBatch(['A']);

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(mockValidateBatch).not.toHaveBeenCalled();
      expect(result.validationWarnings).toBe(0);
      expect(result.validationErrors).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Failure bookkeeping — null translation results
  // ---------------------------------------------------------------------------
  describe('failure bookkeeping', () => {
    it('should count null translation results as failed, not translated', async () => {
      const config = makeConfig();
      const diffs = [makeDiff('a', 'Alpha'), makeDiff('b', 'Beta')];
      // translateBatch returns null for the second entry
      const mock = createMockTranslationService({
        translateBatch: jest.fn().mockResolvedValue([
          makeTranslationResult('A'),
          null,
        ]),
      });

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(result.fileResult.translated).toBe(1);
      expect(result.fileResult.failed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Current-key handling — existing target translations are preserved
  // ---------------------------------------------------------------------------
  describe('current-key handling', () => {
    it('should preserve existing target translations for "current" diffs', async () => {
      const config = makeConfig();
      const diffs: SyncDiff[] = [
        { key: 'new_key', value: 'New value', status: 'new' },
        { key: 'existing_key', value: 'Old value', status: 'current' },
      ];
      const { mock } = captureTranslateBatch(['Neuer Wert']);

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        existingTargetEntries: new Map([
          ['de', new Map([['existing_key', 'Alter Wert (prior translation)']])],
        ]),
      };

      const result = await makeTranslator(mock, config).translate(ctx);

      expect(result.targetEntries.get('existing_key')).toBe('Alter Wert (prior translation)');
      expect(result.targetEntries.get('new_key')).toBe('Neuer Wert');
    });

    // A lockfile entry with no corresponding target content means the file was
    // deleted or emptied, so the key must be translated again rather than
    // falling back to the SOURCE text.
    it('should re-translate a current key whose lockfile entry has no target content', async () => {
      const config = makeConfig();
      const diffs: SyncDiff[] = [
        { key: 'a', value: 'Alpha', status: 'new' },
        { key: 'b', value: 'Beta', status: 'current' },
      ];
      const { mock } = captureTranslateBatch(['A', 'B-übersetzt']);

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        existingTargetEntries: new Map(), // no existing translation
        fileLockEntries: {
          b: {
            source_hash: 'h',
            source_text: 'Beta',
            translations: { de: { hash: 'th', translated_at: '2026-04-23T00:00:00Z', status: 'translated' } },
          },
        },
      };

      const result = await makeTranslator(mock, config).translate(ctx);

      expect(result.targetEntries.get('b')).not.toBe('Beta');
      expect(result.targetEntries.get('b')).toBe('B-übersetzt');
    });
  });

  // ---------------------------------------------------------------------------
  // 13. New-locale bootstrap — current keys with no prior translation get re-translated
  // ---------------------------------------------------------------------------
  describe('new-locale bootstrap', () => {
    it('should translate current keys that lack a translation for this locale', async () => {
      const config = makeConfig();
      const diffs: SyncDiff[] = [
        { key: 'existing_key', value: 'Existing value', status: 'current' },
      ];
      const { mock, calls } = captureTranslateBatch(['Existierender Wert']);

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        existingTargetEntries: new Map(), // no existing target translations
        fileLockEntries: {}, // no prior lock entry for this locale
      };
      ctx.toTranslate = []; // nothing in the "new/changed" set

      const result = await makeTranslator(mock, config).translate(ctx);

      // New-locale branch translates the untranslatedCurrentKeys set.
      const newLocaleCall = calls.find(c => c.texts.includes('Existing value'));
      expect(newLocaleCall).toBeDefined();
      expect(result.targetEntries.get('existing_key')).toBe('Existierender Wert');
      expect(result.successfulKeys).toContain('existing_key');
      expect(result.fileResult.translated).toBe(1);
    });

    it('should restore preservation placeholders in the new-locale translation result', async () => {
      const config = makeConfig();
      const diffs: SyncDiff[] = [
        { key: 'welcome', value: 'Hello, {name}!', status: 'current' },
      ];
      // Mock the translateBatch so the second call (for new-locale keys) returns
      // a string that contains the protected placeholder token — the restoration
      // path at line ~475 converts it back to {name}.
      let callIdx = 0;
      const mock = createMockTranslationService({
        translateBatch: jest.fn().mockImplementation((texts: string[]) => {
          callIdx++;
          if (callIdx === 1) return Promise.resolve([]);
          return Promise.resolve(
            texts.map((t) => makeTranslationResult(t.replace(/Hello/i, 'Hallo'))),
          );
        }),
      });

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        existingTargetEntries: new Map(),
        fileLockEntries: {},
      };
      ctx.toTranslate = [];

      const result = await makeTranslator(mock, config).translate(ctx);

      // Placeholder {name} must round-trip through the preservation map.
      expect(result.targetEntries.get('welcome')).toMatch(/\{name\}/);
      expect(result.targetEntries.get('welcome')).toMatch(/Hallo/);
    });

    it('should fall back to source text when the new-locale translateBatch returns null', async () => {
      const config = makeConfig();
      const diffs: SyncDiff[] = [
        { key: 'existing_key', value: 'Existing value', status: 'current' },
      ];
      const mock = createMockTranslationService({
        translateBatch: jest.fn().mockResolvedValue([null]),
      });

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        existingTargetEntries: new Map(),
        fileLockEntries: {},
      };
      ctx.toTranslate = [];

      const result = await makeTranslator(mock, config).translate(ctx);

      expect(result.targetEntries.get('existing_key')).toBe('Existing value');
      expect(result.fileResult.failed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Target-file handling — read existing target + backup
  // ---------------------------------------------------------------------------
  describe('target-file handling', () => {
    it('should use the existing target file content as the reconstruction template when available', async () => {
      const existingTarget = '{"prior_key":"Vorheriger Wert"}';
      mockReadFile.mockResolvedValueOnce(existingTarget);

      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);
      const parser = makeParser();

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        parser,
      };
      ctx.content = '{}'; // source content

      await makeTranslator(mock, config).translate(ctx);

      // reconstruct should have been called with the existing target content as the template
      expect(parser.reconstruct).toHaveBeenCalledWith(existingTarget, expect.any(Array));
    });

    it('should create a .deepl.bak copy of the existing target when the target exists and backup is not disabled', async () => {
      mockReadFile.mockResolvedValueOnce('{"prior":"X"}');
      const copyFileSpy = fs.promises.copyFile as jest.MockedFunction<typeof fs.promises.copyFile>;
      copyFileSpy.mockResolvedValueOnce(undefined);

      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(copyFileSpy).toHaveBeenCalled();
      const copyArgs = copyFileSpy.mock.calls[0]!;
      expect(String(copyArgs[1])).toMatch(/\.deepl\.bak$/);
    });

    it('should skip the backup when sync.backup is explicitly false', async () => {
      mockReadFile.mockResolvedValueOnce('{"prior":"X"}');
      const copyFileSpy = fs.promises.copyFile as jest.MockedFunction<typeof fs.promises.copyFile>;
      copyFileSpy.mockResolvedValueOnce(undefined);

      const config = makeConfig({
        sync: { backup: false },
      } as Partial<ResolvedSyncConfig>);
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(copyFileSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 6b. Plural slots in three-way partition Path A (multiple diffs, primary in batch)
  // ---------------------------------------------------------------------------
  describe('plural slots — Path A inside three-way partition', () => {
    it('should include plural slot texts in the plain batch when multiple diffs partition to Path A', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('item_count', '1 item', { msgid_plural: '%d items' }),
        makeDiff('greeting', 'Hello'),
      ];
      const { mock, calls } = captureTranslateBatch(['1 Element', '%d Elemente', 'Hallo']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      // The three-way-partition batch should contain the singular text, the plural
      // text (slot), and the second plain key. Single plain batch call.
      const batchCall = calls.find(c => c.opts.context === undefined);
      expect(batchCall).toBeDefined();
      expect(batchCall!.texts.length).toBeGreaterThanOrEqual(3);
    });

    it('should include plural slot texts in the section-context batch (Path B1)', async () => {
      const config = makeConfig();
      // Two keys under the same section with plurals on one; both share section context
      const diffs = [
        makeDiff('nav.count', '1 link', { msgid_plural: '%d links' }),
        makeDiff('nav.home', 'Home'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['nav.count', { key: 'nav.count', context: 'Navigation count', occurrences: 1, elementType: null }],
        ['nav.home', { key: 'nav.home', context: 'Navigation link', occurrences: 1, elementType: null }],
      ]);
      const { mock, calls } = captureTranslateBatch(['1 Link', '%d Links', 'Startseite']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      const sectionCall = calls.find(c => c.opts.context !== undefined && c.opts.context !== '');
      expect(sectionCall).toBeDefined();
      expect(sectionCall!.texts.length).toBeGreaterThanOrEqual(3);
    });

    it('should track instructionSentKeys for section-batched keys that also have an elementType (Path B1)', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('cta.save', 'Save'),
        makeDiff('cta.cancel', 'Cancel'),
      ];
      // Context AND elementType on the same keys — both get section-batched AND
      // contribute to instructionGroupCounts.
      const keyContexts = new Map<string, KeyContext>([
        ['cta.save', { key: 'cta.save', context: 'Call-to-action row', occurrences: 1, elementType: 'button' }],
        ['cta.cancel', { key: 'cta.cancel', context: 'Call-to-action row', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock } = captureTranslateBatch(['Speichern', 'Abbrechen']);

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      expect(result.instructionSentKeys.has('cta.save')).toBe(true);
      expect(result.instructionSentKeys.has('cta.cancel')).toBe(true);
      expect(result.instructionGroupCounts.get('button')).toBe(2);
    });

    it('should track instructionSentKeys for per-key context keys that also have an elementType (Path B2)', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('btn.save', 'Save'),
        makeDiff('btn.cancel', 'Cancel'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['btn.save', { key: 'btn.save', context: 'Save button label', occurrences: 1, elementType: 'button' }],
        ['btn.cancel', { key: 'btn.cancel', context: 'Cancel button label', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock } = captureTranslateBatch(['Speichern', 'Abbrechen']);

      // forceBatch=false → Path B2
      const result = await makeTranslator(mock, config, false).translate(makeCtx(diffs, keyContexts));

      expect(result.instructionSentKeys.has('btn.save')).toBe(true);
      expect(result.instructionSentKeys.has('btn.cancel')).toBe(true);
      expect(result.instructionGroupCounts.get('button')).toBe(2);
    });

    it('should include plural slot texts in per-key context calls (Path B2, forceBatch=false)', async () => {
      const config = makeConfig();
      const diffs = [
        makeDiff('btn.count', '1 click', { msgid_plural: '%d clicks' }),
        makeDiff('btn.cancel', 'Cancel'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['btn.count', { key: 'btn.count', context: 'Click counter label', occurrences: 1, elementType: null }],
        ['btn.cancel', { key: 'btn.cancel', context: 'Cancel button label', occurrences: 1, elementType: null }],
      ]);
      const { mock, calls } = captureTranslateBatch(['1 Klick', '%d Klicks', 'Abbrechen']);

      await makeTranslator(mock, config, false).translate(makeCtx(diffs, keyContexts));

      // The per-key call for btn.count should include both singular and plural.
      const pluralKeyCall = calls.find(c =>
        c.opts.context === 'Click counter label' && c.texts.length === 2,
      );
      expect(pluralKeyCall).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 16. Config context overrides — single-key and multi-key paths
  // ---------------------------------------------------------------------------
  describe('config.context.overrides wiring', () => {
    it('should use config.context.overrides for a single key when it is set', async () => {
      const config = makeConfig({
        context: { overrides: { greeting: 'Override context text' } },
      } as unknown as Partial<ResolvedSyncConfig>);
      const diffs = [makeDiff('greeting', 'Hello')];
      // keyContexts has a different context — the override should win.
      const keyContexts = new Map<string, KeyContext>([
        ['greeting', { key: 'greeting', context: 'Auto-extracted context', occurrences: 1, elementType: null }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Hallo']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      expect(calls[0]!.opts.context).toBe('Override context text');
    });

    it('should route override keys through per-key (Path B2) in the three-way partition', async () => {
      const config = makeConfig({
        context: { overrides: { 'nav.home': 'Override for home link' } },
      } as unknown as Partial<ResolvedSyncConfig>);
      const diffs = [
        makeDiff('nav.home', 'Home'),
        makeDiff('nav.about', 'About'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['nav.home', { key: 'nav.home', context: 'Auto context', occurrences: 1, elementType: null }],
        ['nav.about', { key: 'nav.about', context: 'Auto context', occurrences: 1, elementType: null }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Startseite', 'Über uns']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts));

      // Override key goes through per-key batch with its specific context.
      const overrideCall = calls.find(c => c.opts.context === 'Override for home link');
      expect(overrideCall).toBeDefined();
      expect(overrideCall!.texts).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 17. Android plurals — mismatch between value and plurals array
  // ---------------------------------------------------------------------------
  describe('android plurals — no matching entry', () => {
    it('should not throw when the plurals array has no entry whose value matches diff.value', async () => {
      const config = makeConfig();
      const diffs: SyncDiff[] = [
        {
          key: 'items',
          value: 'original',
          status: 'new',
          metadata: {
            plurals: [
              { quantity: 'one', value: 'unrelated-a' },
              { quantity: 'other', value: 'unrelated-b' },
            ],
          },
        },
      ];
      const { mock } = captureTranslateBatch(['Original-DE', 'A-DE', 'B-DE']);

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      // Sync proceeds — primary entry translated, no crash on the missing-primary branch.
      expect(result.targetEntries.get('items')).toBe('Original-DE');
    });
  });

  // ---------------------------------------------------------------------------
  // 18. Context-path for locales without custom-instruction support
  // ---------------------------------------------------------------------------
  describe('context paths with unsupported locale', () => {
    it('should section-batch (Path B1) without adding instruction tracking for an unsupported locale', async () => {
      const config = makeConfig({ target_locales: ['nl'] });
      const diffs = [
        makeDiff('cta.save', 'Save'),
        makeDiff('cta.cancel', 'Cancel'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['cta.save', { key: 'cta.save', context: 'Call-to-action row', occurrences: 1, elementType: 'button' }],
        ['cta.cancel', { key: 'cta.cancel', context: 'Call-to-action row', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock } = captureTranslateBatch(['Opslaan', 'Annuleren']);

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts, 'nl'));

      // 'nl' does not support custom instructions, so even though elementType is
      // present, instructionSentKeys stays empty in Path B1.
      expect(result.instructionSentKeys.size).toBe(0);
      expect(result.instructionGroupCounts.size).toBe(0);
    });

    it('should per-key (Path B2) without adding instruction tracking for an unsupported locale', async () => {
      const config = makeConfig({ target_locales: ['nl'] });
      const diffs = [
        makeDiff('btn.save', 'Save'),
        makeDiff('btn.cancel', 'Cancel'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        ['btn.save', { key: 'btn.save', context: 'Save button label', occurrences: 1, elementType: 'button' }],
        ['btn.cancel', { key: 'btn.cancel', context: 'Cancel button label', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock } = captureTranslateBatch(['Opslaan', 'Annuleren']);

      const result = await makeTranslator(mock, config, false).translate(makeCtx(diffs, keyContexts, 'nl'));

      expect(result.instructionSentKeys.size).toBe(0);
      expect(result.instructionGroupCounts.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 19. Results without billedCharacters — charactersBilled aggregation
  // ---------------------------------------------------------------------------
  describe('results without billed characters', () => {
    it('should aggregate charactersBilled=0 when translation results omit billedCharacters', async () => {
      const config = makeConfig();
      const diffs = [makeDiff('a', 'Alpha'), makeDiff('b', 'Beta')];
      const mock = createMockTranslationService({
        translateBatch: jest.fn().mockResolvedValue([
          { text: 'A', detectedSourceLanguage: 'en' }, // no billedCharacters
          { text: 'B', detectedSourceLanguage: 'en' },
        ]),
      });

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(result.charactersBilled).toBe(0);
      expect(result.billedPerKey.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 20. Empty existing target content — treat as missing
  // ---------------------------------------------------------------------------
  describe('existing target with whitespace-only content', () => {
    it('should treat a target file whose content is whitespace as effectively empty', async () => {
      // Existing target file exists but is whitespace-only — the translator
      // should fall back to the source content as the reconstruction template.
      mockReadFile.mockResolvedValueOnce('   \n  ');

      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);
      const parser = makeParser();

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        parser,
      };
      ctx.content = '{}'; // source content used as fallback template

      await makeTranslator(mock, config).translate(ctx);

      // reconstruct sees the source content as the template (whitespace target discarded).
      expect(parser.reconstruct).toHaveBeenCalledWith('{}', expect.any(Array));
    });
  });

  // ---------------------------------------------------------------------------
  // 14a. Containment ordering — assertPathWithinRoot runs before any target I/O
  // ---------------------------------------------------------------------------
  describe('target-file handling — containment ordering', () => {
    it('should assert containment before reading the target or writing the backup', async () => {
      const order: string[] = [];
      mockAssertPathWithinRoot.mockImplementation(() => { order.push('assert'); });
      mockReadFile.mockImplementation(() => { order.push('read'); return Promise.resolve('{"prior":"X"}'); });
      const copyFileSpy = fs.promises.copyFile as jest.MockedFunction<typeof fs.promises.copyFile>;
      copyFileSpy.mockImplementation(() => { order.push('copy'); return Promise.resolve(); });

      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      expect(order).toContain('assert');
      expect(order).toContain('read');
      expect(order).toContain('copy');
      expect(order.indexOf('assert')).toBeLessThan(order.indexOf('read'));
      expect(order.indexOf('assert')).toBeLessThan(order.indexOf('copy'));
    });

    it('should neither read the target nor write a backup when containment fails', async () => {
      mockAssertPathWithinRoot.mockImplementation(() => {
        throw new Error('Target path escapes project root: /evil/de.json');
      });
      const copyFileSpy = fs.promises.copyFile as jest.MockedFunction<typeof fs.promises.copyFile>;

      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);

      await expect(
        makeTranslator(mock, config).translate(makeCtx(diffs, new Map())),
      ).rejects.toThrow(/escapes project root/);
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(copyFileSpy).not.toHaveBeenCalled();
      expect(mockAtomicWriteFile).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 14b. Backup failure handling — Logger.warn, sync continues
  // ---------------------------------------------------------------------------
  describe('target-file handling — backup failure', () => {
    it('should warn and continue when .bak copyFile rejects', async () => {
      mockReadFile.mockResolvedValueOnce('{"prior":"X"}');
      const copyFileSpy = fs.promises.copyFile as jest.MockedFunction<typeof fs.promises.copyFile>;
      copyFileSpy.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);

      // Should not throw; backup failure is logged, sync proceeds.
      await expect(
        makeTranslator(mock, config).translate(makeCtx(diffs, new Map())),
      ).resolves.toBeDefined();
      expect(copyFileSpy).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 14c. Locale without instruction support — falls through to plain batch
  // ---------------------------------------------------------------------------
  describe('locales without custom-instruction support', () => {
    it('should fall through to plain batch for elementType-tagged keys when locale is unsupported', async () => {
      const config = makeConfig({ target_locales: ['nl'] });
      const diffs = [
        makeDiff('cta.save', 'Save'),
        makeDiff('plain.key', 'Plain'),
      ];
      const keyContexts = new Map<string, KeyContext>([
        // cta.save has elementType but 'nl' does not support instructions
        ['cta.save', { key: 'cta.save', context: '', occurrences: 1, elementType: 'button' }],
      ]);
      const { mock, calls } = captureTranslateBatch(['Opslaan', 'Eenvoudig']);

      await makeTranslator(mock, config).translate(makeCtx(diffs, keyContexts, 'nl'));

      // No call should carry customInstructions because 'nl' is unsupported.
      const instructionCall = calls.find(c =>
        Array.isArray(c.opts.customInstructions) && c.opts.customInstructions.length > 0,
      );
      expect(instructionCall).toBeUndefined();
      // Both keys land in a single plain batch.
      expect(calls).toHaveLength(1);
      expect(calls[0]!.texts).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 14d. Android-plurals metadata round-trip
  // ---------------------------------------------------------------------------
  describe('android-plurals metadata', () => {
    it('should write the translated text back into the matching plurals entry by value', async () => {
      const config = makeConfig();
      const diffs: SyncDiff[] = [
        {
          key: 'items',
          value: '1 item',
          status: 'new',
          metadata: {
            plurals: [
              { quantity: 'one', value: '1 item' },
              { quantity: 'other', value: '%d items' },
            ],
          },
        },
      ];
      const { mock } = captureTranslateBatch(['1 Element']);

      const result = await makeTranslator(mock, config).translate(makeCtx(diffs, new Map()));

      // targetEntries reflects the translation for the primary key
      expect(result.targetEntries.get('items')).toBe('1 Element');
    });
  });

  // ---------------------------------------------------------------------------
  // 15. Multi-locale reconstruct — locale argument passed through
  // ---------------------------------------------------------------------------
  describe('multi-locale reconstruct', () => {
    it('should pass locale as the third reconstruct() argument when isMultiLocale is true', async () => {
      const config = makeConfig();
      const diffs = [makeDiff('greeting', 'Hello')];
      const { mock } = captureTranslateBatch(['Hallo']);
      const parser = makeParser();

      const ctx: LocaleTranslatorContext = {
        ...makeCtx(diffs, new Map()),
        parser,
        isMultiLocale: true,
      };

      await makeTranslator(mock, config).translate(ctx);

      expect(parser.reconstruct).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 'de');
    });
  });
});

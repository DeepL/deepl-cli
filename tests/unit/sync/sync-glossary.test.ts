import { SyncGlossaryManager } from '../../../src/sync/sync-glossary';
import type { SyncGlossaryManagerOptions } from '../../../src/sync/sync-glossary';
import { GlossaryService } from '../../../src/services/glossary';
import type { GlossaryInfo } from '../../../src/types/index';
import { Logger } from '../../../src/utils/logger';
import { createMockGlossaryService } from '../../helpers/mock-factories';

/** Mirror what a DeepL glossary returns after entries survive a TSV round trip. */
function roundTrip(entries: Record<string, string>): Record<string, string> {
  return GlossaryService.tsvToEntries(GlossaryService.entriesToTSV(entries));
}

function repeated(source: string, target: string, prefix: string): {
  sourceEntries: Map<string, string>;
  localeEntries: Map<string, string>;
} {
  const sourceEntries = new Map<string, string>();
  const localeEntries = new Map<string, string>();
  for (let i = 0; i < 3; i++) {
    sourceEntries.set(`${prefix}${i}`, source);
    localeEntries.set(`${prefix}${i}`, target);
  }
  return { sourceEntries, localeEntries };
}

describe('SyncGlossaryManager', () => {
  function createManager(
    overrides: Partial<SyncGlossaryManagerOptions> = {},
  ): { manager: SyncGlossaryManager; glossaryService: ReturnType<typeof createMockGlossaryService> } {
    const glossaryService = createMockGlossaryService();
    const manager = new SyncGlossaryManager({
      sourceLocale: 'en',
      targetLocales: ['de', 'fr'],
      glossaryService,
      ...overrides,
    });
    return { manager, glossaryService };
  }

  describe('extractTerms', () => {
    it('should identify terms appearing 3+ times with consistent translation', () => {
      const { manager } = createManager();

      const sourceEntries = new Map([
        ['page.title', 'Save'],
        ['dialog.ok', 'Save'],
        ['menu.save', 'Save'],
      ]);

      const targetEntries = new Map([
        ['de', new Map([
          ['page.title', 'Speichern'],
          ['dialog.ok', 'Speichern'],
          ['menu.save', 'Speichern'],
        ])],
      ]);

      const result = manager.extractTerms(sourceEntries, targetEntries);

      expect(result.get('de')).toEqual({ Save: 'Speichern' });
    });

    it('should ignore terms with inconsistent translations across keys', () => {
      const { manager } = createManager();

      const sourceEntries = new Map([
        ['key1', 'Open'],
        ['key2', 'Open'],
        ['key3', 'Open'],
      ]);

      const targetEntries = new Map([
        ['de', new Map([
          ['key1', 'Öffnen'],
          ['key2', 'Offen'],
          ['key3', 'Öffnen'],
        ])],
      ]);

      const result = manager.extractTerms(sourceEntries, targetEntries);

      expect(result.has('de')).toBe(false);
    });

    it('should ignore long strings (>50 chars)', () => {
      const { manager } = createManager();

      const longString = 'A'.repeat(51);
      const sourceEntries = new Map([
        ['key1', longString],
        ['key2', longString],
        ['key3', longString],
      ]);

      const targetEntries = new Map([
        ['de', new Map([
          ['key1', 'Lang'],
          ['key2', 'Lang'],
          ['key3', 'Lang'],
        ])],
      ]);

      const result = manager.extractTerms(sourceEntries, targetEntries);

      expect(result.has('de')).toBe(false);
    });

    it('should handle empty input', () => {
      const { manager } = createManager();

      const result = manager.extractTerms(new Map(), new Map());

      expect(result.size).toBe(0);
    });

    it('should handle multiple target locales independently', () => {
      const { manager } = createManager();

      const sourceEntries = new Map([
        ['a', 'Yes'],
        ['b', 'Yes'],
        ['c', 'Yes'],
      ]);

      const targetEntries = new Map([
        ['de', new Map([
          ['a', 'Ja'],
          ['b', 'Ja'],
          ['c', 'Ja'],
        ])],
        ['fr', new Map([
          ['a', 'Oui'],
          ['b', 'Oui'],
          ['c', 'Oui'],
        ])],
      ]);

      const result = manager.extractTerms(sourceEntries, targetEntries);

      expect(result.get('de')).toEqual({ Yes: 'Ja' });
      expect(result.get('fr')).toEqual({ Yes: 'Oui' });
    });
  });

  describe('extractTerms term validation', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('should skip a term whose target translation is empty', () => {
      const { manager } = createManager();
      const { sourceEntries, localeEntries } = repeated('OK', '', 'k');

      const result = manager.extractTerms(sourceEntries, new Map([['de', localeEntries]]));

      expect(result.has('de')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('k0'));
    });

    it('should skip a term whose target translation is whitespace-only', () => {
      const { manager } = createManager();
      const { sourceEntries, localeEntries } = repeated('OK', '   ', 'k');

      const result = manager.extractTerms(sourceEntries, new Map([['de', localeEntries]]));

      expect(result.has('de')).toBe(false);
    });

    it('should skip a term whose source is empty', () => {
      const { manager } = createManager();
      const { sourceEntries, localeEntries } = repeated('', 'Leer', 'k');

      const result = manager.extractTerms(sourceEntries, new Map([['de', localeEntries]]));

      expect(result.has('de')).toBe(false);
    });

    it('should skip a term whose source contains a tab', () => {
      const { manager } = createManager();
      const { sourceEntries, localeEntries } = repeated('Col\tumn', 'Spalte', 'k');

      const result = manager.extractTerms(sourceEntries, new Map([['de', localeEntries]]));

      expect(result.has('de')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('k0'));
    });

    it('should skip a multi-line source string instead of uploading a wrong mapping', () => {
      const { manager } = createManager();
      const { sourceEntries, localeEntries } = repeated(
        'Are you sure?\nThis cannot be undone.',
        'Sicher?',
        'k',
      );

      const result = manager.extractTerms(sourceEntries, new Map([['de', localeEntries]]));

      expect(result.has('de')).toBe(false);
    });

    it('should skip a term whose target contains a newline or carriage return', () => {
      const { manager } = createManager();
      const withNewline = repeated('Save', 'Spei\nchern', 'a');
      const withCr = repeated('Open', 'Öff\rnen', 'b');

      const sourceEntries = new Map([...withNewline.sourceEntries, ...withCr.sourceEntries]);
      const localeEntries = new Map([...withNewline.localeEntries, ...withCr.localeEntries]);

      const result = manager.extractTerms(sourceEntries, new Map([['de', localeEntries]]));

      expect(result.has('de')).toBe(false);
    });

    it('should keep clean terms alongside skipped ones', () => {
      const { manager } = createManager();
      const clean = repeated('Save', 'Speichern', 'a');
      const dirty = repeated('Bad\tterm', 'Schlecht', 'b');

      const sourceEntries = new Map([...clean.sourceEntries, ...dirty.sourceEntries]);
      const localeEntries = new Map([...clean.localeEntries, ...dirty.localeEntries]);

      const result = manager.extractTerms(sourceEntries, new Map([['de', localeEntries]]));

      expect(result.get('de')).toEqual({ Save: 'Speichern' });
    });
  });

  describe('syncGlossaries', () => {
    it('should create new glossary when none exists', async () => {
      const { manager, glossaryService } = createManager({ targetLocales: ['de'] });

      glossaryService.getGlossaryByName.mockResolvedValue(null);
      glossaryService.createGlossary.mockResolvedValue({
        glossary_id: 'new-id-1',
        name: 'deepl-sync-en-de',
        source_lang: 'en',
        target_langs: ['de'],
        dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 1 }],
        creation_time: '2026-01-01T00:00:00Z',
      });

      const sourceEntries = new Map([
        ['k1', 'OK'],
        ['k2', 'OK'],
        ['k3', 'OK'],
      ]);
      const targetEntries = new Map([
        ['de', new Map([['k1', 'OK'], ['k2', 'OK'], ['k3', 'OK']])],
      ]);

      const result = await manager.syncGlossaries(sourceEntries, targetEntries);

      expect(glossaryService.createGlossary).toHaveBeenCalledWith(
        'deepl-sync-en-de',
        'en',
        ['de'],
        { OK: 'OK' },
      );
      expect(result).toEqual({ 'en-de': 'new-id-1' });
    });

    it('should update existing glossary with new terms', async () => {
      const { manager, glossaryService } = createManager({ targetLocales: ['de'] });

      glossaryService.getGlossaryByName.mockResolvedValue({
        glossary_id: 'existing-id',
        name: 'deepl-sync-en-de',
        source_lang: 'en',
        target_langs: ['de'],
        dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 1 }],
        creation_time: '2026-01-01T00:00:00Z',
      });
      glossaryService.getGlossaryEntries.mockResolvedValue({ Hello: 'Hallo' });

      const sourceEntries = new Map([
        ['k1', 'Hello'],
        ['k2', 'Hello'],
        ['k3', 'Hello'],
        ['k4', 'Save'],
        ['k5', 'Save'],
        ['k6', 'Save'],
      ]);
      const targetEntries = new Map([
        ['de', new Map([
          ['k1', 'Hallo'],
          ['k2', 'Hallo'],
          ['k3', 'Hallo'],
          ['k4', 'Speichern'],
          ['k5', 'Speichern'],
          ['k6', 'Speichern'],
        ])],
      ]);

      const result = await manager.syncGlossaries(sourceEntries, targetEntries);

      expect(glossaryService.updateGlossary).toHaveBeenCalledTimes(1);
      expect(glossaryService.updateGlossary).toHaveBeenCalledWith(
        'existing-id',
        {
          dictionaries: [{
            sourceLang: 'en',
            targetLang: 'de',
            entries: { Hello: 'Hallo', Save: 'Speichern' },
          }],
        },
      );
      expect(glossaryService.addEntry).not.toHaveBeenCalled();
      expect(glossaryService.removeEntry).not.toHaveBeenCalled();
      expect(result).toEqual({ 'en-de': 'existing-id' });
    });

    it('issues a single batched dictionary update per locale regardless of add/remove count', async () => {
      const { manager, glossaryService } = createManager({ targetLocales: ['de'] });

      glossaryService.getGlossaryByName.mockResolvedValue({
        glossary_id: 'existing-id',
        name: 'deepl-sync-en-de',
        source_lang: 'en',
        target_langs: ['de'],
        dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 5 }],
        creation_time: '2026-01-01T00:00:00Z',
      });

      const obsolete: Record<string, string> = {
        Gone1: 'Weg1',
        Gone2: 'Weg2',
        Gone3: 'Weg3',
        Gone4: 'Weg4',
        Gone5: 'Weg5',
      };
      glossaryService.getGlossaryEntries.mockResolvedValue(obsolete);

      const newTerms: Array<[string, string]> = Array.from({ length: 10 }, (_, i) => [
        `Term${i}`,
        `Term${i}DE`,
      ]);

      const sourceEntries = new Map<string, string>();
      const deLocale = new Map<string, string>();
      let keyCounter = 0;
      for (const [src, tgt] of newTerms) {
        for (let k = 0; k < 3; k++) {
          const key = `k${keyCounter++}`;
          sourceEntries.set(key, src);
          deLocale.set(key, tgt);
        }
      }
      const targetEntries = new Map([['de', deLocale]]);

      await manager.syncGlossaries(sourceEntries, targetEntries);

      expect(glossaryService.addEntry).not.toHaveBeenCalled();
      expect(glossaryService.removeEntry).not.toHaveBeenCalled();
      expect(glossaryService.updateGlossary).toHaveBeenCalledTimes(1);
      const [, payload] = glossaryService.updateGlossary.mock.calls[0] as [string, {
        dictionaries: Array<{ sourceLang: string; targetLang: string; entries: Record<string, string> }>;
      }];
      expect(payload.dictionaries).toHaveLength(1);
      expect(payload.dictionaries[0]?.entries).toEqual(Object.fromEntries(newTerms));
      for (const stale of Object.keys(obsolete)) {
        expect(payload.dictionaries[0]?.entries[stale]).toBeUndefined();
      }
    });

    it('skips the dictionary update call when the target terms are identical to current entries', async () => {
      const { manager, glossaryService } = createManager({ targetLocales: ['de'] });

      glossaryService.getGlossaryByName.mockResolvedValue({
        glossary_id: 'existing-id',
        name: 'deepl-sync-en-de',
        source_lang: 'en',
        target_langs: ['de'],
        dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 1 }],
        creation_time: '2026-01-01T00:00:00Z',
      });
      glossaryService.getGlossaryEntries.mockResolvedValue({ Hello: 'Hallo' });

      const sourceEntries = new Map([
        ['k1', 'Hello'],
        ['k2', 'Hello'],
        ['k3', 'Hello'],
      ]);
      const targetEntries = new Map([
        ['de', new Map([
          ['k1', 'Hallo'],
          ['k2', 'Hallo'],
          ['k3', 'Hallo'],
        ])],
      ]);

      await manager.syncGlossaries(sourceEntries, targetEntries);

      expect(glossaryService.updateGlossary).not.toHaveBeenCalled();
      expect(glossaryService.addEntry).not.toHaveBeenCalled();
      expect(glossaryService.removeEntry).not.toHaveBeenCalled();
    });

    it('should skip locale with no terms', async () => {
      const { manager, glossaryService } = createManager({ targetLocales: ['de'] });

      const sourceEntries = new Map([['k1', 'Unique']]);
      const targetEntries = new Map([
        ['de', new Map([['k1', 'Einzigartig']])],
      ]);

      const result = await manager.syncGlossaries(sourceEntries, targetEntries);

      expect(glossaryService.createGlossary).not.toHaveBeenCalled();
      expect(glossaryService.getGlossaryByName).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    describe('idempotency', () => {
      /**
       * Run syncGlossaries twice against a service that stores what was
       * uploaded and returns it the way the API does — through a TSV round trip.
       */
      async function syncTwice(
        sourceEntries: Map<string, string>,
        localeEntries: Map<string, string>,
      ): Promise<{ glossaryService: ReturnType<typeof createMockGlossaryService> }> {
        const { manager, glossaryService } = createManager({ targetLocales: ['de'] });
        const info: GlossaryInfo = {
          glossary_id: 'gid-1',
          name: 'deepl-sync-en-de',
          source_lang: 'en',
          target_langs: ['de'],
          dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 1 }],
          creation_time: '2026-01-01T00:00:00Z',
        };

        let stored: Record<string, string> | null = null;
        glossaryService.getGlossaryByName.mockImplementation(async () => (stored ? info : null));
        glossaryService.createGlossary.mockImplementation(async (_n, _s, _t, entries) => {
          stored = roundTrip(entries);
          return info;
        });
        glossaryService.getGlossaryEntries.mockImplementation(async () => stored ?? {});
        glossaryService.updateGlossary.mockResolvedValue(undefined);

        const targetEntries = new Map([['de', localeEntries]]);
        await manager.syncGlossaries(sourceEntries, targetEntries);
        await manager.syncGlossaries(sourceEntries, targetEntries);

        return { glossaryService };
      }

      it('should create once and never update when the source terms are unchanged', async () => {
        const { sourceEntries, localeEntries } = repeated('Save', 'Speichern', 'k');

        const { glossaryService } = await syncTwice(sourceEntries, localeEntries);

        expect(glossaryService.createGlossary).toHaveBeenCalledTimes(1);
        expect(glossaryService.updateGlossary).toHaveBeenCalledTimes(0);
      });

      it('should not re-upload when a term differs only by surrounding whitespace', async () => {
        const { sourceEntries, localeEntries } = repeated('Save ', 'Speichern', 'k');

        const { glossaryService } = await syncTwice(sourceEntries, localeEntries);

        expect(glossaryService.createGlossary).toHaveBeenCalledTimes(1);
        expect(glossaryService.updateGlossary).toHaveBeenCalledTimes(0);
      });
    });

    describe('per-locale failure isolation', () => {
      it('should keep syncing other locales and name the failing locale in the warning', async () => {
        const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        try {
          const { manager, glossaryService } = createManager({ targetLocales: ['de', 'fr'] });

          glossaryService.getGlossaryByName.mockResolvedValue(null);
          glossaryService.createGlossary.mockImplementation(async (name) => {
            if (name === 'deepl-sync-en-de') {
              throw new Error('glossary rejected by API');
            }
            const info: GlossaryInfo = {
              glossary_id: 'fr-id',
              name,
              source_lang: 'en',
              target_langs: ['fr'],
              dictionaries: [{ source_lang: 'en', target_lang: 'fr', entry_count: 1 }],
              creation_time: '2026-01-01T00:00:00Z',
            };
            return info;
          });

          const { sourceEntries, localeEntries } = repeated('Yes', 'Ja', 'k');
          const targetEntries = new Map([
            ['de', localeEntries],
            ['fr', new Map([...localeEntries].map(([k]) => [k, 'Oui'] as [string, string]))],
          ]);

          const result = await manager.syncGlossaries(sourceEntries, targetEntries);

          expect(result).toEqual({ 'en-fr': 'fr-id' });
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('de'));
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('glossary rejected by API'));
        } finally {
          warnSpy.mockRestore();
        }
      });
    });
  });

  describe('getProjectGlossary', () => {
    it('should return ID when found via getGlossaryByName', async () => {
      const { manager, glossaryService } = createManager();

      glossaryService.getGlossaryByName.mockResolvedValue({
        glossary_id: 'found-id',
        name: 'deepl-sync-en-de',
        source_lang: 'en',
        target_langs: ['de'],
        dictionaries: [{ source_lang: 'en', target_lang: 'de', entry_count: 5 }],
        creation_time: '2026-01-01T00:00:00Z',
      });

      const result = await manager.getProjectGlossary('de');

      expect(glossaryService.getGlossaryByName).toHaveBeenCalledWith('deepl-sync-en-de');
      expect(result).toBe('found-id');
    });

    it('should return null when not found', async () => {
      const { manager, glossaryService } = createManager();

      glossaryService.getGlossaryByName.mockResolvedValue(null);

      const result = await manager.getProjectGlossary('de');

      expect(result).toBeNull();
    });
  });

  describe('getGlossaryName', () => {
    it('should return correct convention string', () => {
      const { manager } = createManager({ sourceLocale: 'en' });

      expect(manager.getGlossaryName('de')).toBe('deepl-sync-en-de');
      expect(manager.getGlossaryName('fr')).toBe('deepl-sync-en-fr');
      expect(manager.getGlossaryName('pt-br')).toBe('deepl-sync-en-pt-br');
    });
  });
});

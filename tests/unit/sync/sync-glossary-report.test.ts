import { generateGlossaryReport } from '../../../src/sync/sync-glossary-report';
import type { TargetTranslationIndex } from '../../../src/sync/sync-glossary-report';
import type { SyncLockFile } from '../../../src/sync/types';

function makeLockFile(entries: SyncLockFile['entries'] = {}): SyncLockFile {
  return {
    _comment: 'test',
    version: 1,
    generated_at: '2026-01-01T00:00:00Z',
    source_locale: 'en',
    entries,
    stats: { total_keys: 0, total_translations: 0, last_sync: '2026-01-01T00:00:00Z' },
  };
}

function translated(hash: string) {
  return { hash, translated_at: '2026-01-01T00:00:00Z', status: 'translated' as const };
}

function index(
  spec: Record<string, Record<string, Record<string, string>>>,
): TargetTranslationIndex {
  const result: TargetTranslationIndex = new Map();
  for (const [file, locales] of Object.entries(spec)) {
    const localeMap = new Map<string, Map<string, string>>();
    for (const [locale, keys] of Object.entries(locales)) {
      localeMap.set(locale, new Map(Object.entries(keys)));
    }
    result.set(file, localeMap);
  }
  return result;
}

describe('generateGlossaryReport()', () => {
  it('should report no inconsistencies when the same source text is translated identically', () => {
    const lock = makeLockFile({
      'en/common.json': {
        greeting: { source_hash: 'abc123', source_text: 'Hello', translations: { de: translated('h1') } },
      },
      'en/other.json': {
        greeting2: { source_hash: 'abc123', source_text: 'Hello', translations: { de: translated('h1') } },
      },
    });

    const report = generateGlossaryReport(
      lock,
      index({
        'en/common.json': { de: { greeting: 'Hallo' } },
        'en/other.json': { de: { greeting2: 'Hallo' } },
      }),
    );

    expect(report.totalTerms).toBe(1);
    expect(report.inconsistencies).toHaveLength(0);
    expect(report.missingTargets).toHaveLength(0);
  });

  it('should detect an inconsistency when the same source text has different translations', () => {
    const lock = makeLockFile({
      'en/common.json': {
        greeting: { source_hash: 'abc123', source_text: 'Hello', translations: { de: translated('h1') } },
      },
      'en/other.json': {
        welcome: { source_hash: 'abc123', source_text: 'Hello', translations: { de: translated('h1') } },
      },
    });

    const report = generateGlossaryReport(
      lock,
      index({
        'en/common.json': { de: { greeting: 'Hallo' } },
        'en/other.json': { de: { welcome: 'Guten Tag' } },
      }),
    );

    expect(report.inconsistencies).toHaveLength(1);
    expect(report.inconsistencies[0]).toEqual({
      sourceText: 'Hello',
      locale: 'de',
      translations: expect.arrayContaining(['Hallo', 'Guten Tag']),
      files: expect.arrayContaining(['en/common.json', 'en/other.json']),
    });
  });

  it('should return zero terms and no inconsistencies for empty lock file', () => {
    const report = generateGlossaryReport(makeLockFile({}));

    expect(report.totalTerms).toBe(0);
    expect(report.inconsistencies).toHaveLength(0);
    expect(report.missingTargets).toHaveLength(0);
  });

  it('should populate files array correctly for multiple files with same source text', () => {
    const lock = makeLockFile({
      'file-a.json': {
        key1: { source_hash: 'h1', source_text: 'Save', translations: { de: translated('h') } },
      },
      'file-b.json': {
        key2: { source_hash: 'h1', source_text: 'Save', translations: { de: translated('h') } },
      },
      'file-c.json': {
        key3: { source_hash: 'h1', source_text: 'Save', translations: { de: translated('h') } },
      },
    });

    const report = generateGlossaryReport(
      lock,
      index({
        'file-a.json': { de: { key1: 'Speichern' } },
        'file-b.json': { de: { key2: 'Speichern' } },
        'file-c.json': { de: { key3: 'Sichern' } },
      }),
    );

    expect(report.totalTerms).toBe(1);
    expect(report.inconsistencies).toHaveLength(1);
    expect(report.inconsistencies[0]!.files).toEqual(
      expect.arrayContaining(['file-a.json', 'file-b.json', 'file-c.json']),
    );
    expect(report.inconsistencies[0]!.files).toHaveLength(3);
  });

  it('surfaces actual translated text (not hashes) when a target-translation index is provided', () => {
    const lock = makeLockFile({
      'en/common.json': {
        greeting: { source_hash: 'h', source_text: 'Dashboard', translations: { de: translated('de-v1') } },
      },
      'en/admin.json': {
        header: { source_hash: 'h', source_text: 'Dashboard', translations: { de: translated('de-v2') } },
      },
    });

    const report = generateGlossaryReport(
      lock,
      index({
        'en/common.json': { de: { greeting: 'Armaturenbrett' } },
        'en/admin.json': { de: { header: 'Dashboard' } },
      }),
    );

    expect(report.inconsistencies).toHaveLength(1);
    const inc = report.inconsistencies[0]!;
    expect(inc.sourceText).toBe('Dashboard');
    expect(inc.locale).toBe('de');
    expect(inc.translations).toEqual(expect.arrayContaining(['Armaturenbrett', 'Dashboard']));
    expect(inc.translations).not.toContain('de-v1');
    expect(inc.translations).not.toContain('de-v2');
  });

  describe('unreadable targets', () => {
    it('reports a missing locale file instead of inventing an inconsistency', () => {
      const lock = makeLockFile({
        'en/common.json': {
          greeting: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('de-hashA') } },
        },
        'en/other.json': {
          greeting2: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('de-hashB') } },
        },
      });

      // en/other.json has no de file yet.
      const report = generateGlossaryReport(
        lock,
        index({ 'en/common.json': { de: { greeting: 'Hallo' } } }),
      );

      expect(report.inconsistencies).toHaveLength(0);
      expect(report.missingTargets).toEqual([{ filePath: 'en/other.json', locale: 'de' }]);
    });

    it('never emits a lock hash as a translation string', () => {
      const lock = makeLockFile({
        'en/common.json': {
          greeting: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('de-hashA') } },
        },
        'en/other.json': {
          greeting2: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('de-hashB') } },
        },
      });

      const report = generateGlossaryReport(
        lock,
        index({ 'en/common.json': { de: { greeting: 'Hallo' } } }),
      );

      const allTranslations = report.inconsistencies.flatMap(inc => inc.translations);
      expect(allTranslations).not.toContain('de-hashA');
      expect(allTranslations).not.toContain('de-hashB');
    });

    it('still detects divergence among the readable targets of a group', () => {
      const lock = makeLockFile({
        'a.json': { k1: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('x') } } },
        'b.json': { k2: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('x') } } },
        'c.json': { k3: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('x') } } },
      });

      const report = generateGlossaryReport(
        lock,
        index({
          'a.json': { de: { k1: 'Hallo' } },
          'b.json': { de: { k2: 'Servus' } },
        }),
      );

      expect(report.inconsistencies).toHaveLength(1);
      expect(report.inconsistencies[0]!.translations).toEqual(
        expect.arrayContaining(['Hallo', 'Servus']),
      );
      expect(report.inconsistencies[0]!.files).toEqual(['a.json', 'b.json']);
      expect(report.missingTargets).toEqual([{ filePath: 'c.json', locale: 'de' }]);
    });

    it('reports every unreadable target once per file and locale', () => {
      const lock = makeLockFile({
        'a.json': {
          k1: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('x'), fr: translated('x') } },
          k2: { source_hash: 'h2', source_text: 'Bye', translations: { de: translated('y') } },
        },
      });

      const report = generateGlossaryReport(lock, index({}));

      expect(report.missingTargets).toEqual([
        { filePath: 'a.json', locale: 'de' },
        { filePath: 'a.json', locale: 'fr' },
      ]);
    });

    it('treats an omitted index as every target being unreadable', () => {
      const lock = makeLockFile({
        'a.json': { k1: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('x') } } },
        'b.json': { k2: { source_hash: 'h', source_text: 'Hi', translations: { de: translated('y') } } },
      });

      const report = generateGlossaryReport(lock);

      expect(report.inconsistencies).toHaveLength(0);
      expect(report.missingTargets).toHaveLength(2);
    });
  });

  it('should count different source texts separately in totalTerms', () => {
    const lock = makeLockFile({
      'en/common.json': {
        greeting: { source_hash: 'h1', source_text: 'Hello', translations: { de: translated('hash1') } },
        farewell: { source_hash: 'h2', source_text: 'Goodbye', translations: { de: translated('hash2') } },
        save: { source_hash: 'h3', source_text: 'Save', translations: { de: translated('hash3') } },
      },
    });

    const report = generateGlossaryReport(
      lock,
      index({
        'en/common.json': { de: { greeting: 'Hallo', farewell: 'Auf Wiedersehen', save: 'Speichern' } },
      }),
    );

    expect(report.totalTerms).toBe(3);
    expect(report.inconsistencies).toHaveLength(0);
  });

  it('should ignore translations that have not reached the translated status', () => {
    const lock = makeLockFile({
      'a.json': {
        k1: {
          source_hash: 'h',
          source_text: 'Hi',
          translations: { de: { hash: 'x', translated_at: '2026-01-01T00:00:00Z', status: 'pending' } },
        },
      },
    });

    const report = generateGlossaryReport(lock, index({}));

    expect(report.inconsistencies).toHaveLength(0);
    expect(report.missingTargets).toHaveLength(0);
  });
});

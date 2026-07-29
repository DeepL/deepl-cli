import * as fs from 'fs';
import { hasConflictMarkers, resolveConflicts, resolveLockFile } from '../../../src/sync/sync-resolve';
import type { ResolveDecision } from '../../../src/sync/sync-resolve';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
      writeFile: jest.fn(),
    },
  };
});

const mockReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;
const mockWriteFile = fs.promises.writeFile as jest.MockedFunction<typeof fs.promises.writeFile>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hasConflictMarkers()', () => {
  it('should return true when content starts with <<<<<<< marker', () => {
    const content = '<<<<<<< HEAD\nsome content\n=======\nother content\n>>>>>>> branch';
    expect(hasConflictMarkers(content)).toBe(true);
  });

  it('should return true for bare <<<<<<< marker', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD')).toBe(true);
  });

  it('should return false for clean content without conflict markers', () => {
    const content = '{"entries": {}, "version": 1}';
    expect(hasConflictMarkers(content)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(hasConflictMarkers('')).toBe(false);
  });

  it('should return false when < characters appear but not seven in a row', () => {
    expect(hasConflictMarkers('<<<<<< not enough')).toBe(false);
  });

  it('should detect conflict markers after a newline', () => {
    const content = 'some preamble\n<<<<<<< HEAD\nconflict';
    expect(hasConflictMarkers(content)).toBe(true);
  });

  it('should return true when eight or more < characters start the string', () => {
    expect(hasConflictMarkers('<<<<<<<<<<<<< something')).toBe(true);
  });
});

describe('resolveConflicts()', () => {
  describe('JSON fragment merging with translated_at timestamps', () => {
    it('should take the side with a newer translated_at timestamp', () => {
      const content = [
        '{',
        '<<<<<<< HEAD',
        '  "greeting": { "source_hash": "abc123", "translated_at": "2025-01-01T00:00:00Z" }',
        '=======',
        '  "greeting": { "source_hash": "abc123", "translated_at": "2025-06-15T00:00:00Z" }',
        '>>>>>>> branch',
        '}',
      ].join('\n');

      const { resolved, mergeCount } = resolveConflicts(content);
      expect(mergeCount).toBe(1);
      const parsed = JSON.parse(resolved);
      expect(parsed.greeting.translated_at).toBe('2025-06-15T00:00:00Z');
    });

    it('should take the ours side when timestamps are equal', () => {
      const content = [
        '{',
        '<<<<<<< HEAD',
        '  "key": { "source_hash": "aaa", "translated_at": "2025-03-01T00:00:00Z" }',
        '=======',
        '  "key": { "source_hash": "bbb", "translated_at": "2025-03-01T00:00:00Z" }',
        '>>>>>>> branch',
        '}',
      ].join('\n');

      const { resolved } = resolveConflicts(content);
      const parsed = JSON.parse(resolved);
      expect(parsed.key.source_hash).toBe('aaa');
    });

    it('should merge keys present only on one side', () => {
      const content = [
        '{',
        '<<<<<<< HEAD',
        '  "alpha": { "source_hash": "a1", "translated_at": "2025-01-01T00:00:00Z" }',
        '=======',
        '  "beta": { "source_hash": "b1", "translated_at": "2025-02-01T00:00:00Z" }',
        '>>>>>>> branch',
        '}',
      ].join('\n');

      const { resolved } = resolveConflicts(content);
      const parsed = JSON.parse(resolved);
      expect(parsed.alpha).toBeDefined();
      expect(parsed.beta).toBeDefined();
    });

    it('should prefer theirs when only theirs has translated_at', () => {
      const content = [
        '{',
        '<<<<<<< HEAD',
        '  "item": { "source_hash": "h1" }',
        '=======',
        '  "item": { "source_hash": "h2", "translated_at": "2025-04-01T00:00:00Z" }',
        '>>>>>>> branch',
        '}',
      ].join('\n');

      const { resolved } = resolveConflicts(content);
      const parsed = JSON.parse(resolved);
      expect(parsed.item.translated_at).toBe('2025-04-01T00:00:00Z');
    });
  });

  describe('fallback to longer side when JSON does not parse', () => {
    it('should pick the longer side when neither side is valid JSON', () => {
      const content = [
        'before',
        '<<<<<<< HEAD',
        'short',
        '=======',
        'this is the longer text that should win',
        '>>>>>>> branch',
        'after',
      ].join('\n');

      const { resolved, mergeCount } = resolveConflicts(content);
      expect(mergeCount).toBe(1);
      expect(resolved).toContain('this is the longer text that should win');
      expect(resolved).not.toContain('short\n');
    });

    it('should pick ours when both sides have equal length', () => {
      const content = [
        '<<<<<<< HEAD',
        'aaa',
        '=======',
        'bbb',
        '>>>>>>> branch',
      ].join('\n');

      const { resolved } = resolveConflicts(content);
      expect(resolved).toContain('aaa');
    });

    it('should pick ours when ours is longer', () => {
      const content = [
        '<<<<<<< HEAD',
        'this is the longer ours side text',
        '=======',
        'short',
        '>>>>>>> branch',
      ].join('\n');

      const { resolved } = resolveConflicts(content);
      expect(resolved).toContain('this is the longer ours side text');
    });
  });

  describe('multiple conflict blocks', () => {
    it('should resolve all conflict blocks independently', () => {
      const content = [
        '{',
        '<<<<<<< HEAD',
        '  "first": { "source_hash": "f1", "translated_at": "2025-01-01T00:00:00Z" }',
        '=======',
        '  "first": { "source_hash": "f1", "translated_at": "2025-06-01T00:00:00Z" }',
        '>>>>>>> branch',
        ',',
        '<<<<<<< HEAD',
        '  "second": { "source_hash": "s1", "translated_at": "2025-08-01T00:00:00Z" }',
        '=======',
        '  "second": { "source_hash": "s1", "translated_at": "2025-03-01T00:00:00Z" }',
        '>>>>>>> branch',
        '}',
      ].join('\n');

      const { resolved, mergeCount } = resolveConflicts(content);
      expect(mergeCount).toBe(2);
      const parsed = JSON.parse(resolved);
      expect(parsed.first.translated_at).toBe('2025-06-01T00:00:00Z');
      expect(parsed.second.translated_at).toBe('2025-08-01T00:00:00Z');
    });

    it('should report correct mergeCount for three blocks', () => {
      const content = [
        '<<<<<<< HEAD',
        'a',
        '=======',
        'b',
        '>>>>>>> branch',
        '<<<<<<< HEAD',
        'c',
        '=======',
        'd',
        '>>>>>>> branch',
        '<<<<<<< HEAD',
        'e',
        '=======',
        'f',
        '>>>>>>> branch',
      ].join('\n');

      const { mergeCount } = resolveConflicts(content);
      expect(mergeCount).toBe(3);
    });
  });

  describe('content without conflicts', () => {
    it('should return content unchanged with mergeCount 0', () => {
      const content = '{"entries": {}, "version": 1}';
      const { resolved, mergeCount } = resolveConflicts(content);
      expect(resolved).toBe(content);
      expect(mergeCount).toBe(0);
    });
  });
});

describe('resolveLockFile()', () => {
  const lockPath = '/tmp/test-sync/.deepl-sync.lock.json';

  it('should read file with conflicts, resolve, and write back', async () => {
    // Both sides are complete JSON; the longer side wins via fallback
    const conflictContent = [
      '<<<<<<< HEAD',
      '{"greeting": {"source_hash": "abc", "translated_at": "2025-01-01T00:00:00Z"}}',
      '=======',
      '{"greeting": {"source_hash": "abc", "translated_at": "2025-06-01T00:00:00Z"}, "extra": true}',
      '>>>>>>> branch',
    ].join('\n');

    mockReadFile.mockResolvedValue(conflictContent);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await resolveLockFile(lockPath);

    expect(result.hadConflicts).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.entriesMerged).toBe(1);

    expect(mockReadFile).toHaveBeenCalledWith(lockPath, 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith(lockPath, expect.any(String), 'utf-8');

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.greeting.translated_at).toBe('2025-06-01T00:00:00Z');
    expect(parsed.extra).toBe(true);
  });

  it('should return hadConflicts=false for a clean file', async () => {
    const cleanContent = JSON.stringify({ entries: {}, version: 1 });
    mockReadFile.mockResolvedValue(cleanContent);

    const result = await resolveLockFile(lockPath);

    expect(result.hadConflicts).toBe(false);
    expect(result.resolved).toBe(false);
    expect(result.entriesMerged).toBe(0);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should return resolved=false when resolved content is not valid JSON', async () => {
    // Starts with <<<<<<< so hasConflictMarkers returns true,
    // but the resolved content won't be valid JSON
    const badConflict = [
      '<<<<<<< HEAD',
      'invalid ours',
      '=======',
      'invalid theirs that is longer',
      '>>>>>>> branch',
    ].join('\n');

    mockReadFile.mockResolvedValue(badConflict);

    const result = await resolveLockFile(lockPath);

    expect(result.hadConflicts).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.entriesMerged).toBe(0);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should return hadConflicts=false when file cannot be read', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await resolveLockFile(lockPath);

    expect(result.hadConflicts).toBe(false);
    expect(result.resolved).toBe(false);
    expect(result.entriesMerged).toBe(0);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should handle conflict where theirs side is longer and chosen via fallback', async () => {
    // When both sides have outer braces, fragment parsing fails and
    // the longer side is selected. The theirs side has an extra key making it longer.
    const content = [
      '<<<<<<< HEAD',
      '{"version": 1}',
      '=======',
      '{"version": 1, "source_locale": "en"}',
      '>>>>>>> branch',
    ].join('\n');

    mockReadFile.mockResolvedValue(content);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await resolveLockFile(lockPath);

    expect(result.hadConflicts).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.entriesMerged).toBe(1);

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.source_locale).toBe('en');
    expect(parsed.version).toBe(1);
  });
});

describe('per-entry decision report', () => {
  it('resolveConflicts returns per-key decisions with source and reason', () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "kept_ours": { "source_hash": "h1", "translated_at": "2026-04-20T09:33:15Z" },',
      '  "kept_theirs": { "source_hash": "h2", "translated_at": "2026-01-01T00:00:00Z" }',
      '=======',
      '  "kept_ours": { "source_hash": "h1", "translated_at": "2026-04-19T00:00:00Z" },',
      '  "kept_theirs": { "source_hash": "h2", "translated_at": "2026-04-20T08:12:03Z" }',
      '>>>>>>> branch',
      '}',
    ].join('\n');

    const { decisions } = resolveConflicts(content);
    expect(Array.isArray(decisions)).toBe(true);

    const byKey = new Map<string, ResolveDecision>(decisions.map((d) => [d.key, d]));

    const ours = byKey.get('kept_ours');
    expect(ours).toBeDefined();
    expect(ours!.source).toBe('ours');
    expect(ours!.reason).toContain('2026-04-20T09:33:15Z');

    const theirs = byKey.get('kept_theirs');
    expect(theirs).toBeDefined();
    expect(theirs!.source).toBe('theirs');
    expect(theirs!.reason).toContain('2026-04-20T08:12:03Z');
  });

  it('tags a decision as length-heuristic when JSON.parse fails without logging itself', () => {
    // The command layer prints the warning once from the decision; the
    // library must stay silent so it is not printed twice.
    const warnSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const content = [
        'prefix line',
        '<<<<<<< HEAD',
        '{"t"',
        '=======',
        '{"this side is visibly longer and therefore wins"}',
        '>>>>>>> branch',
        'suffix line',
      ].join('\n');

      const { decisions } = resolveConflicts(content, { file: 'locales/de/app.json' });

      const fallback = decisions.find((d) => d.source === 'length-heuristic');
      expect(fallback).toBeDefined();
      expect(fallback!.file).toBe('locales/de/app.json');
      expect(typeof fallback!.reason).toBe('string');
      expect(fallback!.reason.length).toBeGreaterThan(0);

      const warned = warnSpy.mock.calls.some((args) => {
        const joined = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        return /parse-error fallback/i.test(joined);
      });
      expect(warned).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('resolveLockFile returns decisions in its result', async () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "key_a": { "source_hash": "a", "translated_at": "2026-04-20T10:00:00Z" }',
      '=======',
      '  "key_a": { "source_hash": "a", "translated_at": "2026-04-19T10:00:00Z" }',
      '>>>>>>> branch',
      '}',
    ].join('\n');
    mockReadFile.mockResolvedValue(content);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await resolveLockFile('/tmp/test-sync/.deepl-sync.lock');
    expect(result.decisions).toBeDefined();
    expect(result.decisions!.length).toBeGreaterThan(0);
    const keyA = result.decisions!.find((d) => d.key === 'key_a');
    expect(keyA).toBeDefined();
    expect(keyA!.source).toBe('ours');
  });

  it('resolveLockFile in dry-run mode does not write the file', async () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "x": { "source_hash": "h", "translated_at": "2026-04-20T10:00:00Z" }',
      '=======',
      '  "x": { "source_hash": "h", "translated_at": "2026-04-19T00:00:00Z" }',
      '>>>>>>> branch',
      '}',
    ].join('\n');
    mockReadFile.mockResolvedValue(content);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await resolveLockFile('/tmp/test-sync/.deepl-sync.lock', { dryRun: true });
    expect(result.hadConflicts).toBe(true);
    expect(result.resolved).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(result.decisions).toBeDefined();
    expect(result.decisions!.length).toBeGreaterThan(0);
  });
});

describe('prototype pollution hardening', () => {
  afterEach(() => {
    // Canary: trip loud on any future cross-talk that leaks through the merge helpers.
    /* eslint-disable jest/no-standalone-expect */
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(((Object.prototype as unknown) as Record<string, unknown>)['polluted']).toBeUndefined();
    /* eslint-enable jest/no-standalone-expect */
    // Remove the key so a leak in one test cannot poison later ones.
    delete ((Object.prototype as unknown) as Record<string, unknown>)['polluted'];
  });

  it('should not pollute Object.prototype via __proto__ key in conflict fragment', () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "safe": { "source_hash": "a", "translated_at": "2026-04-20T00:00:00Z" }',
      '=======',
      '  "__proto__": { "polluted": true }',
      '>>>>>>> branch',
      '}',
    ].join('\n');

    resolveConflicts(content);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(((Object.prototype as unknown) as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('should not pollute Object.prototype via constructor.prototype in conflict fragment', () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "safe": { "source_hash": "a", "translated_at": "2026-04-20T00:00:00Z" }',
      '=======',
      '  "constructor": { "prototype": { "polluted": true } }',
      '>>>>>>> branch',
      '}',
    ].join('\n');

    resolveConflicts(content);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(((Object.prototype as unknown) as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('should not pollute Object.prototype when __proto__ appears on the ours side', () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "__proto__": { "polluted": true }',
      '=======',
      '  "safe": { "source_hash": "a", "translated_at": "2026-04-20T00:00:00Z" }',
      '>>>>>>> branch',
      '}',
    ].join('\n');

    resolveConflicts(content);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(((Object.prototype as unknown) as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('should not pollute Object.prototype via prototype key in conflict fragment', () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "safe": { "source_hash": "a", "translated_at": "2026-04-20T00:00:00Z" }',
      '=======',
      '  "prototype": { "polluted": true }',
      '>>>>>>> branch',
      '}',
    ].join('\n');

    resolveConflicts(content);

    expect(((Object.prototype as unknown) as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('should drop __proto__/constructor/prototype keys entirely from merged output', () => {
    const content = [
      '{',
      '<<<<<<< HEAD',
      '  "safe": { "source_hash": "a", "translated_at": "2026-04-20T00:00:00Z" }',
      '=======',
      '  "__proto__": { "polluted": true },',
      '  "constructor": { "polluted": true },',
      '  "prototype": { "polluted": true },',
      '  "legit": { "source_hash": "b", "translated_at": "2026-04-20T00:00:00Z" }',
      '>>>>>>> branch',
      '}',
    ].join('\n');

    const { resolved } = resolveConflicts(content);
    const parsed = JSON.parse(resolved);

    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'prototype')).toBe(false);
    expect(parsed.legit).toBeDefined();
    expect(parsed.safe).toBeDefined();
  });
});

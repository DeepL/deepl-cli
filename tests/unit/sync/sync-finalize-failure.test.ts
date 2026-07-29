/**
 * Tests that a locale which failed entirely is reported as a failure.
 *
 * A run fails when ANY file/locale failed completely, not only when all did.
 * Otherwise a run with one succeeded and one failed locale exits 0, leaving
 * the failed locale's file absent while CI goes green and `--auto-commit`
 * commits that state.
 */

import { finalizeSyncResult } from '../../../src/sync/sync-finalize';
import type { SyncFileResult } from '../../../src/sync/sync-service';

function fileResult(overrides: Partial<SyncFileResult>): SyncFileResult {
  return {
    file: 'locales/en.json',
    locale: 'de',
    translated: 0,
    failed: 0,
    skipped: 0,
    written: true,
    ...overrides,
  };
}

function finalize(fileResults: SyncFileResult[]) {
  return finalizeSyncResult({
    totalKeys: 2,
    newKeys: 2,
    staleKeys: 0,
    deletedKeys: 0,
    currentKeys: 0,
    totalCharsBilled: 10,
    fileResults,
    validationWarnings: 0,
    validationErrors: 0,
    estimatedCharacters: 10,
    effectiveLocaleCount: 2,
    dryRun: false,
    driftDetected: false,
    allContextSentKeys: new Set<string>(),
    allInstructionSentKeys: new Set<string>(),
    allInstructionGroupTotals: new Map<string, number>(),
  } as unknown as Parameters<typeof finalizeSyncResult>[0]);
}

describe('finalizeSyncResult failure reporting', () => {
  it('should report success when every locale succeeded', () => {
    const result = finalize([
      fileResult({ locale: 'de', translated: 2, written: true }),
      fileResult({ locale: 'fr', translated: 2, written: true }),
    ]);

    expect(result.success).toBe(true);
  });

  it('should not report success when one locale failed entirely', () => {
    const result = finalize([
      fileResult({ locale: 'de', translated: 2, written: true }),
      fileResult({ locale: 'fr', translated: 0, failed: 2, written: false }),
    ]);

    expect(result.success).toBe(false);
  });

  it('should not report success when every locale failed', () => {
    const result = finalize([
      fileResult({ locale: 'de', translated: 0, failed: 2, written: false }),
      fileResult({ locale: 'fr', translated: 0, failed: 2, written: false }),
    ]);

    expect(result.success).toBe(false);
  });

  it('should report success when a locale had nothing to do', () => {
    // translated 0 with no failures is an up-to-date locale, not a failure.
    const result = finalize([
      fileResult({ locale: 'de', translated: 0, failed: 0, skipped: 2, written: false }),
      fileResult({ locale: 'fr', translated: 2, written: true }),
    ]);

    expect(result.success).toBe(true);
  });

  it('should report success when a locale partly succeeded', () => {
    // docs/API.md:3056 scopes exit 12 to "at least one failed locale", so a
    // locale that translated some keys is not a failed locale — the file is
    // written and the per-key failures are reported in the summary.
    const result = finalize([
      fileResult({ locale: 'de', translated: 1, failed: 1, written: true }),
    ]);

    expect(result.success).toBe(true);
  });
});

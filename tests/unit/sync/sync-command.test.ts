import { SyncCommand } from '../../../src/cli/commands/sync-command';
import type { SyncService, SyncResult, SyncFileResult } from '../../../src/sync/sync-service';
import { Logger } from '../../../src/utils/logger';

const mockExecFile = jest.fn(
  (
    _cmd: string,
    _args: string[],
    _optsOrCb?: unknown,
    cbArg?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    const cb = typeof _optsOrCb === 'function'
      ? (_optsOrCb as (err: Error | null, result: { stdout: string; stderr: string }) => void)
      : cbArg;
    if (cb) cb(null, { stdout: '', stderr: '' });
  },
);

jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

/** NUL-separated "XY path" entries returned for `git status --porcelain -z`. */
let mockPorcelain = '';

const mockExistsSync = jest.fn((_p: string | URL) => false);
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return new Proxy(actual as object, {
    get(target, prop: string | symbol, receiver) {
      if (prop === 'existsSync') return mockExistsSync;
      return Reflect.get(target, prop, receiver);
    },
  });
});

const mockWatcherOn = jest.fn().mockReturnThis();
const mockWatcherClose = jest.fn().mockResolvedValue(undefined);
const mockWatch = jest.fn().mockReturnValue({
  on: mockWatcherOn,
  close: mockWatcherClose,
});

jest.mock('chokidar', () => ({
  watch: mockWatch,
}));

jest.mock('../../../src/sync/sync-config', () => ({
  loadSyncConfig: jest.fn(),
}));

const { loadSyncConfig: mockLoadSyncConfig } = require('../../../src/sync/sync-config') as { loadSyncConfig: jest.Mock };

const defaultSyncConfig = {
  version: 1,
  source_locale: 'en',
  target_locales: ['de'],
  buckets: { json: { include: ['locales/en.json'] } },
  configPath: '/test/.deepl-sync.yaml',
  projectRoot: '/test',
  overrides: {},
};

function makeResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    success: true,
    totalKeys: 10,
    newKeys: 2,
    staleKeys: 1,
    deletedKeys: 0,
    currentKeys: 7,
    totalCharactersBilled: 100,
    fileResults: [],
    validationWarnings: 0,
    validationErrors: 0,
    estimatedCharacters: 0,
    targetLocaleCount: 1,
    dryRun: false,
    frozen: false,
    driftDetected: false,
    lockUpdated: false,
    ...overrides,
  };
}

function createMockSyncService(result: SyncResult): jest.Mocked<SyncService> {
  return {
    sync: jest.fn().mockResolvedValue(result),
  } as unknown as jest.Mocked<SyncService>;
}

describe('SyncCommand', () => {
  let logInfoSpy: jest.SpyInstance;
  let logWarnSpy: jest.SpyInstance;
  let stdoutWriteSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLoadSyncConfig.mockResolvedValue({ ...defaultSyncConfig });
    logInfoSpy = jest.spyOn(Logger, 'info').mockImplementation(() => {});
    logWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    logInfoSpy.mockRestore();
    logWarnSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
  });

  describe('displayResult() via run()', () => {
    it('should mention dry run when dryRun is true', async () => {
      const result = makeResult({ dryRun: true });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true });

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput.toLowerCase()).toContain('dry-run');
    });

    it('should mention drift when driftDetected is true', async () => {
      const result = makeResult({ driftDetected: true, success: false });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput.toLowerCase()).toContain('drift');
    });

    it('should include new and deleted counts in drift message when both are nonzero', async () => {
      const result = makeResult({
        driftDetected: true,
        success: false,
        newKeys: 5,
        staleKeys: 0,
        deletedKeys: 2,
      });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput).toContain('Sync drift detected: 5 new, 2 deleted keys.');
    });

    it('should only mention nonzero categories in drift message', async () => {
      const result = makeResult({
        driftDetected: true,
        success: false,
        newKeys: 0,
        staleKeys: 0,
        deletedKeys: 3,
      });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput).toContain('Sync drift detected: 3 deleted keys.');
      expect(infoOutput).not.toMatch(/\bnew\b/);
      expect(infoOutput).not.toMatch(/\bstale\b/);
    });

    it('should output valid JSON to stdout when format is json', async () => {
        expect.assertions(4);
      const result = makeResult();
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ format: 'json' });

      const jsonCall = stdoutWriteSpy.mock.calls.find((c: unknown[]) => {
        try {
          JSON.parse(String(c[0]).trim());
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall![0]).trim()) as Record<string, unknown>;
      expect(parsed).toHaveProperty('ok');
      expect(parsed).toHaveProperty('totalKeys');
      expect(parsed).not.toHaveProperty('success');
    });

    it('should include cost estimate when characters are billed', async () => {
      const result = makeResult({ totalCharactersBilled: 500_000 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput).toContain('500,000 chars');
      expect(infoOutput).toMatch(/~?\$\d+\.\d+/);
    });

    it('should append Pro tier disclaimer to billed-chars cost estimate in text mode', async () => {
      const result = makeResult({ totalCharactersBilled: 500_000 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput).toContain('Pro tier estimate');
    });

    it('should append Pro tier disclaimer to dry-run estimated cost in text mode', async () => {
      const result = makeResult({ dryRun: true, estimatedCharacters: 300_000, totalCharactersBilled: 0 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true });

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput).toContain('Pro tier estimate');
    });

    it('should include estimatedCost in JSON output', async () => {
      const result = makeResult({ totalCharactersBilled: 1_000_000 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ format: 'json' });

      const jsonCall = stdoutWriteSpy.mock.calls.find((c: unknown[]) => {
        try { JSON.parse(String(c[0]).trim()); return true; } catch { return false; }
      });
      const parsed = JSON.parse(String(jsonCall![0]).trim()) as Record<string, unknown>;
      expect(parsed['estimatedCost']).toBe('~$25.00');
    });

    it('should include rateAssumption: "pro" in JSON output', async () => {
      const result = makeResult({ totalCharactersBilled: 1_000_000 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ format: 'json' });

      const jsonCall = stdoutWriteSpy.mock.calls.find((c: unknown[]) => {
        try { JSON.parse(String(c[0]).trim()); return true; } catch { return false; }
      });
      const parsed = JSON.parse(String(jsonCall![0]).trim()) as Record<string, unknown>;
      expect(parsed['rateAssumption']).toBe('pro');
    });

    it('should not embed Pro tier disclaimer in JSON estimatedCost field', async () => {
      const result = makeResult({ totalCharactersBilled: 1_000_000 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ format: 'json' });

      const jsonCall = stdoutWriteSpy.mock.calls.find((c: unknown[]) => {
        try { JSON.parse(String(c[0]).trim()); return true; } catch { return false; }
      });
      const parsed = JSON.parse(String(jsonCall![0]).trim()) as Record<string, unknown>;
      expect(String(parsed['estimatedCost'])).not.toContain('Pro tier estimate');
    });

    it('should display validation warnings when present', async () => {
      const result = makeResult({ validationWarnings: 3 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const warnOutput = logWarnSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(warnOutput).toContain('3');
      expect(warnOutput.toLowerCase()).toContain('warning');
    });

    it('should display validation errors when present', async () => {
      const result = makeResult({ validationErrors: 5 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const warnOutput = logWarnSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(warnOutput).toContain('5');
      expect(warnOutput.toLowerCase()).toContain('error');
    });
  });

  describe('--ci alias for --frozen', () => {
    it('should pass frozen=true to sync service when ci option is set', async () => {
      const result = makeResult({ frozen: true });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ ci: true });

      const syncCall = mockService.sync.mock.calls[0]!;
      const syncOptions = syncCall[1] as Record<string, unknown>;
      expect(syncOptions['frozen']).toBe(true);
    });

    it('should behave identically to --frozen', async () => {
      const resultFrozen = makeResult({ frozen: true, driftDetected: true, success: false });
      const resultCi = makeResult({ frozen: true, driftDetected: true, success: false });

      const mockServiceFrozen = createMockSyncService(resultFrozen);
      const mockServiceCi = createMockSyncService(resultCi);

      const frozenCommand = new SyncCommand(mockServiceFrozen);
      const ciCommand = new SyncCommand(mockServiceCi);

      const frozenResult = await frozenCommand.run({ frozen: true });
      const ciResult = await ciCommand.run({ ci: true });

      expect(frozenResult.driftDetected).toBe(ciResult.driftDetected);
      expect(frozenResult.frozen).toBe(ciResult.frozen);
      expect(frozenResult.success).toBe(ciResult.success);
    });
  });

  describe('display formatting', () => {
    it('should not show cost when zero characters billed', async () => {
      const result = makeResult({ totalCharactersBilled: 0 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput).not.toContain('$');
      expect(infoOutput).not.toContain('chars');
    });

    it('should show all key categories in summary', async () => {
      const result = makeResult({ newKeys: 3, staleKeys: 2, currentKeys: 10, deletedKeys: 1 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(infoOutput).toContain('3 new');
      expect(infoOutput).toContain('2 updated');
      expect(infoOutput).toContain('10 current');
      expect(infoOutput).toContain('1 deleted');
    });

    it('should pass flagForReview through to sync options', async () => {
      const result = makeResult();
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ flagForReview: true });

      const syncCall = mockService.sync.mock.calls[0]!;
      const syncOptions = syncCall[1] as Record<string, unknown>;
      expect(syncOptions['flagForReview']).toBe(true);
    });
  });

  describe('dry-run estimation display', () => {
    it('should display estimated characters and cost in dry-run', async () => {
      const result = makeResult({ dryRun: true, totalCharactersBilled: 0, estimatedCharacters: 4500, targetLocaleCount: 5 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true });

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('~4,500 chars');
      expect(infoOutput).toMatch(/~?\$\d+\.\d+/);
    });

    it('should not display estimation line when estimatedCharacters is 0', async () => {
      const result = makeResult({ dryRun: true, totalCharactersBilled: 0, estimatedCharacters: 0 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true });

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).not.toContain('This sync');
    });

    it('should show locale count in dry-run summary', async () => {
      const result = makeResult({ dryRun: true, totalCharactersBilled: 0, estimatedCharacters: 1000, targetLocaleCount: 3 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true });

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('across 3 languages');
    });

    it('should use singular "language" when targetLocaleCount is 1', async () => {
      const result = makeResult({ dryRun: true, totalCharactersBilled: 0, estimatedCharacters: 100, targetLocaleCount: 1 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true });

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('across 1 language');
      expect(infoOutput).not.toContain('languages');
    });

    it('should include estimatedCharacters in JSON dry-run output', async () => {
      const result = makeResult({ dryRun: true, totalCharactersBilled: 0, estimatedCharacters: 4500, targetLocaleCount: 5 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true, format: 'json' });

      const jsonCall = stdoutWriteSpy.mock.calls.find((c: unknown[]) => {
        try { JSON.parse(String(c[0]).trim()); return true; } catch { return false; }
      });
      const parsed = JSON.parse(String(jsonCall![0]).trim()) as Record<string, unknown>;
      expect(parsed['estimatedCharacters']).toBe(4500);
      expect(parsed['estimatedCost']).toBe('~$0.11');
    });
  });

  describe('per-locale progress display', () => {
    // Per-locale ticks are emitted only by the live renderProgress listener on
    // `locale-complete` events; there is no aggregated post-sync summary.
    // These tests exercise onProgress directly to verify the live tick format.
    function mockServiceWithProgress(
      events: Array<{ locale: string; file: string; translated: number; failed: number }>,
      result: SyncResult,
    ): jest.Mocked<SyncService> {
      return {
        sync: jest.fn().mockImplementation(async (_config, options) => {
          for (const e of events) {
            options?.onProgress?.({ type: 'locale-complete', ...e });
          }
          return result;
        }),
      } as unknown as jest.Mocked<SyncService>;
    }

    it('emits per-locale tick for each completed file', async () => {
      const fileResults: SyncFileResult[] = [
        { file: 'locales/de.json', locale: 'de', translated: 10, skipped: 0, failed: 0, written: true },
        { file: 'locales/fr.json', locale: 'fr', translated: 10, skipped: 0, failed: 0, written: true },
      ];
      const mockService = mockServiceWithProgress(
        [
          { locale: 'de', file: 'locales/de.json', translated: 10, failed: 0 },
          { locale: 'fr', file: 'locales/fr.json', translated: 10, failed: 0 },
        ],
        makeResult({ fileResults }),
      );
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('\u2713 de: 10/10');
      expect(infoOutput).toContain('\u2713 fr: 10/10');
    });

    it('emits a tick per file for multiple files in the same locale', async () => {
      const fileResults: SyncFileResult[] = [
        { file: 'locales/de.json', locale: 'de', translated: 5, skipped: 0, failed: 0, written: true },
        { file: 'messages/de.json', locale: 'de', translated: 3, skipped: 0, failed: 0, written: true },
      ];
      const mockService = mockServiceWithProgress(
        [
          { locale: 'de', file: 'locales/de.json', translated: 5, failed: 0 },
          { locale: 'de', file: 'messages/de.json', translated: 3, failed: 0 },
        ],
        makeResult({ fileResults }),
      );
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('\u2713 de: 5/5 keys (locales/de.json)');
      expect(infoOutput).toContain('\u2713 de: 3/3 keys (messages/de.json)');
    });

    it('shows failure indicator when a locale has failures', async () => {
      const fileResults: SyncFileResult[] = [
        { file: 'locales/de.json', locale: 'de', translated: 8, skipped: 0, failed: 2, written: true },
      ];
      const mockService = mockServiceWithProgress(
        [{ locale: 'de', file: 'locales/de.json', translated: 8, failed: 2 }],
        makeResult({ fileResults }),
      );
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('\u2717 de: 8/10');
    });

    it('should not display per-locale in dry-run mode', async () => {
      const result = makeResult({ dryRun: true, totalCharactersBilled: 0 });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ dryRun: true });

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).not.toMatch(/[✓✗]/);
      expect(infoOutput).not.toMatch(/\d+\/\d+/);
    });

    it('should not display per-locale when fileResults is empty', async () => {
      const result = makeResult({ fileResults: [] });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).not.toMatch(/\d+\/\d+/);
    });

    // The per-locale tick must fire exactly once per file+locale event — live
    // via renderProgress only, never also from an aggregated post-sync summary.
    it('emits each per-file-locale tick exactly once (no duplicate summary)', async () => {
      const fileResult: SyncFileResult = {
        file: 'locales/de.json',
        locale: 'de',
        translated: 10,
        skipped: 0,
        failed: 0,
        written: true,
      };
      const result = makeResult({ fileResults: [fileResult] });
      const mockService = {
        sync: jest.fn().mockImplementation(async (_config, options) => {
          options?.onProgress?.({
            type: 'locale-complete',
            locale: 'de',
            file: 'locales/de.json',
            translated: 10,
            failed: 0,
          });
          return result;
        }),
      } as unknown as jest.Mocked<SyncService>;
      const command = new SyncCommand(mockService);

      await command.run({});

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      const tickMatches = infoOutput.match(/\u2713 de:/g) ?? [];
      expect(tickMatches).toHaveLength(1);
    });
  });

  describe('--watch mode', () => {
    it('should accept watch and debounce options without error', async () => {
      const result = makeResult();
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      // run() with watch=false should complete normally (watch=true would block)
      const syncResult = await command.run({ watch: false, debounce: 300 });
      expect(syncResult.success).toBe(true);
      expect(mockService.sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('autoCommit', () => {
    const writtenFile: SyncFileResult = {
      file: 'locales/de.json',
      locale: 'de',
      translated: 5,
      skipped: 0,
      failed: 0,
      written: true,
    };

    const skippedFile: SyncFileResult = {
      file: 'locales/fr.json',
      locale: 'fr',
      translated: 0,
      skipped: 5,
      failed: 0,
      written: false,
    };

    beforeEach(() => {
      mockExecFile.mockReset();
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          optsOrCb?: unknown,
          cbArg?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          const cb = typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null, result: { stdout: string; stderr: string }) => void)
            : cbArg;
          let stdout = '';
          if (Array.isArray(args) && args[0] === 'rev-parse' && args[1] === '--git-dir') {
            stdout = '.git';
          }
          // Staging follows the dirty set, so a scenario that writes files must
          // report them here — git cannot show a clean tree after a write.
          if (Array.isArray(args) && args[0] === 'status') {
            stdout = mockPorcelain;
          }
          if (cb) cb(null, { stdout, stderr: '' });
        },
      );
      // Clean by default; tests expecting a commit declare their own dirt.
      mockPorcelain = '';
      mockExistsSync.mockReset();
      mockExistsSync.mockImplementation((p: string | URL) => {
        // Lockfile exists by default so autoCommit stages it when lockUpdated=true.
        return typeof p === 'string' && p.endsWith('.deepl-sync.lock');
      });
    });

    it('should call git add and git commit when autoCommit=true and files were written', async () => {
      mockPorcelain = ' M locales/de.json\0 M .deepl-sync.lock\0';
      const result = makeResult({
        fileResults: [writtenFile],
        lockUpdated: true,
      });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const calls = mockExecFile.mock.calls;
      const gitCalls = calls.map((c: unknown[]) => [c[0], c[1]]);

      expect(gitCalls).toContainEqual(['git', ['rev-parse', '--git-dir']]);
      expect(gitCalls).toContainEqual(['git', ['add', 'locales/de.json']]);
      expect(gitCalls).toContainEqual(['git', ['add', '.deepl-sync.lock']]);
      expect(gitCalls).toContainEqual(
        expect.arrayContaining([
          'git',
          expect.arrayContaining(['commit', '-m', expect.stringContaining('de')]),
        ]),
      );
    });

    it('should not stage .deepl-sync.lock when lockUpdated is false', async () => {
      // Untouched lockfile is not dirty, so it must not be staged.
      mockPorcelain = ' M locales/de.json\0';
      const result = makeResult({
        fileResults: [writtenFile],
        lockUpdated: false,
      });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const calls = mockExecFile.mock.calls;
      const gitCalls = calls.map((c: unknown[]) => [c[0], c[1]]);

      expect(gitCalls).toContainEqual(['git', ['add', 'locales/de.json']]);
      expect(gitCalls).not.toContainEqual(['git', ['add', '.deepl-sync.lock']]);
    });

    it('should pass cwd=config.projectRoot to every git invocation', async () => {
      mockPorcelain = ' M locales/de.json\0 M .deepl-sync.lock\0';
      const result = makeResult({ fileResults: [writtenFile], lockUpdated: true });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const gitInvocations = mockExecFile.mock.calls.filter(
        (c: unknown[]) => c[0] === 'git',
      );
      expect(gitInvocations.length).toBeGreaterThan(0);
      for (const call of gitInvocations) {
        const opts = call[2] as { cwd?: string };
        expect(opts).toBeDefined();
        expect(opts.cwd).toBe('/test');
      }
    });

    it('should stage multiple written files and include all locales in commit message', async () => {
      mockPorcelain = ' M locales/de.json\0 M locales/fr.json\0 M .deepl-sync.lock\0';
      const writtenFileFr: SyncFileResult = {
        file: 'locales/fr.json',
        locale: 'fr',
        translated: 3,
        skipped: 0,
        failed: 0,
        written: true,
      };
      const result = makeResult({
        fileResults: [writtenFile, writtenFileFr],
        lockUpdated: true,
      });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const calls = mockExecFile.mock.calls;
      const gitCalls = calls.map((c: unknown[]) => [c[0], c[1]]);

      expect(gitCalls).toContainEqual(['git', ['add', 'locales/de.json']]);
      expect(gitCalls).toContainEqual(['git', ['add', 'locales/fr.json']]);
      expect(gitCalls).toContainEqual(['git', ['add', '.deepl-sync.lock']]);

      const commitCall = calls.find(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('commit'),
      );
      expect(commitCall).toBeDefined();
      const commitMsg = (commitCall![1])[2];
      expect(commitMsg).toContain('de');
      expect(commitMsg).toContain('fr');
    });

    it('should log warning and skip when not a git repository', async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          optsOrCb?: unknown,
          cbArg?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          const cb = typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null, result: { stdout: string; stderr: string }) => void)
            : cbArg;
          if (Array.isArray(args) && args.includes('rev-parse')) {
            if (cb) cb(new Error('not a git repository'), { stdout: '', stderr: '' });
          } else {
            if (cb) cb(null, { stdout: '', stderr: '' });
          }
        },
      );

      const result = makeResult({ fileResults: [writtenFile] });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const warnOutput = logWarnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnOutput).toContain('Not a git repository');

      const addCalls = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('add'),
      );
      expect(addCalls).toHaveLength(0);
    });

    it('should not call git when no files were written', async () => {
      const result = makeResult({ fileResults: [skippedFile] });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const calls = mockExecFile.mock.calls;
      const addCalls = calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('add'),
      );
      const commitCalls = calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('commit'),
      );
      expect(addCalls).toHaveLength(0);
      expect(commitCalls).toHaveLength(0);
    });

    // Preflight runs even with nothing to commit; only staging and committing
    // are skipped.
    it('should run the preflight but not commit when fileResults is empty', async () => {
      const result = makeResult({ fileResults: [] });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const args = mockExecFile.mock.calls
        .filter((c: unknown[]) => Array.isArray(c[1]))
        .map((c: unknown[]) => (c[1] as string[]).join(' '));

      expect(args).toContain('symbolic-ref -q HEAD');
      expect(args.some((a) => a.startsWith('add '))).toBe(false);
      expect(args.some((a) => a.startsWith('commit '))).toBe(false);
    });

    it('should not call git when dryRun is true', async () => {
      const result = makeResult({ dryRun: true, fileResults: [writtenFile] });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true, dryRun: true });

      const addCalls = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('add'),
      );
      expect(addCalls).toHaveLength(0);
    });

    it('should not call git when driftDetected is true', async () => {
      const result = makeResult({ driftDetected: true, fileResults: [writtenFile] });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const addCalls = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('add'),
      );
      expect(addCalls).toHaveLength(0);
    });

    it('should log success message after committing', async () => {
      mockPorcelain = ' M locales/de.json\0 M .deepl-sync.lock\0';
      const result = makeResult({ fileResults: [writtenFile], lockUpdated: true });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ autoCommit: true });

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('Auto-committed');
      expect(infoOutput).toContain('2 file(s)');
    });
  });

  describe('watchAndSync', () => {
    // These are the heaviest tests in the file: each drives a full watch
    // lifecycle (chokidar setup, debounced change handling, SIGINT shutdown)
    // through fake timers, and the flush loops are CPU-bound. The raised
    // ceiling gives them headroom on shared CI cores without masking a hang —
    // a genuinely stuck setup fails fast with a diagnostic from
    // flushWatchSetup below.
    jest.setTimeout(30_000);

    const mockWatcher = { on: mockWatcherOn, close: mockWatcherClose };

    type ProcessOn = typeof process.on;

    beforeEach(() => {
      mockWatcherOn.mockReturnValue(mockWatcher);
      mockWatcherClose.mockResolvedValue(undefined);
      mockWatch.mockReturnValue(mockWatcher);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // Under fake timers, driving watchAndSync's setup chain forward requires
    // alternating microtask drains (`await Promise.resolve()`) with
    // zero-duration timer advances — timers advance queued macrotasks,
    // Promise.resolve drains microtask-only awaits.
    async function flushRound(): Promise<void> {
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(0);
    }

    // watchAndSync's setup order is: dynamic import of chokidar/path -> resolve
    // watch paths -> chokidar.watch() -> `await controller.sweepStaleBackups()`
    // -> attachDebouncedWatchLoop() -> `process.on('SIGINT', ...)`. The last two
    // run in one synchronous continuation, so `watcher.on` having been called
    // means the SIGINT handler is registered too. That makes mockWatcherOn an
    // observable readiness signal for the entire chain.
    //
    // Phase 1 waits for that signal rather than a fixed round count. chokidar
    // is jest-mocked so the dynamic imports resolve immediately; the genuinely
    // slow step is sweepStaleBackups, which performs real
    // fs.promises.readdir/stat I/O. A fixed budget would race
    // microsecond-scale loop iterations against millisecond-scale syscalls.
    //
    // Phase 2 then drains a fixed number of rounds. Most callers invoke this
    // helper again after emitting change events, to settle a debounced sync
    // cycle — those calls need the drain, not an early return, and readiness
    // is already true by then so phase 1 is a no-op for them. Every test in
    // this block settles within 5 rounds (measured); 25 keeps a 5x margin.
    const SETUP_READY_MAX_ROUNDS = 20_000;
    const SETTLE_ROUNDS = 25;

    async function flushWatchSetup(): Promise<void> {
      let rounds = 0;
      while (mockWatcherOn.mock.calls.length === 0) {
        if (rounds >= SETUP_READY_MAX_ROUNDS) {
          throw new Error(
            `watchAndSync setup did not attach watcher listeners within ${SETUP_READY_MAX_ROUNDS} ` +
              `flush rounds (chokidar.watch calls: ${mockWatch.mock.calls.length}). Either setup ` +
              `is genuinely hung, or this test exercises the early-return path where no watcher ` +
              `is created and should not call flushWatchSetup.`,
          );
        }
        await flushRound();
        rounds++;
      }

      for (let i = 0; i < SETTLE_ROUNDS; i++) {
        await flushRound();
      }
    }

    it('should create a chokidar watcher with bucket include patterns', async () => {
      const result = makeResult();
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      const sigintListeners: Array<() => void> = [];
      const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
        if (event === 'SIGINT') {
          sigintListeners.push(listener);
        }
        return process;
      }) as unknown as ProcessOn);

      const runPromise = command.run({ watch: true, debounce: 100 });

      await flushWatchSetup();

      for (const listener of sigintListeners) {
        listener();
      }

      await runPromise;

      processOnSpy.mockRestore();

      expect(mockWatch).toHaveBeenCalledTimes(1);
      const watchedPaths = mockWatch.mock.calls[0]![0] as string[];
      expect(watchedPaths.length).toBeGreaterThan(0);
      expect(watchedPaths[0]).toContain('locales/en.json');
    });

    it('should warn and skip when there are no watch paths', async () => {
      mockLoadSyncConfig.mockResolvedValue({
        ...defaultSyncConfig,
        buckets: {},
      });

      const result = makeResult();
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      await command.run({ watch: true });

      const warnOutput = logWarnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnOutput).toContain('No source files to watch');
      expect(mockWatch).not.toHaveBeenCalled();
    });

    it('fires --auto-commit on every watch cycle, not only the initial sync', async () => {
      mockExecFile.mockReset();
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          optsOrCb?: unknown,
          cbArg?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          const cb = typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null, result: { stdout: string; stderr: string }) => void)
            : cbArg;
          let stdout = '';
          if (Array.isArray(args) && args[0] === 'rev-parse' && args[1] === '--git-dir') {
            stdout = '.git';
          }
          // Staging follows the dirty set, so a scenario that writes files must
          // report them here — git cannot show a clean tree after a write.
          if (Array.isArray(args) && args[0] === 'status') {
            stdout = mockPorcelain;
          }
          if (cb) cb(null, { stdout, stderr: '' });
        },
      );
      mockExistsSync.mockReset();
      mockExistsSync.mockImplementation((p: string | URL) => {
        return typeof p === 'string' && p.endsWith('.deepl-sync.lock');
      });

      // Capture the debounced 'change'/'add' handlers installed by
      // attachDebouncedWatchLoop so we can drive watch cycles deterministically.
      const registeredHandlers: Array<(p?: string) => void> = [];
      mockWatcherOn.mockImplementation((event: string, handler: (p?: string) => void) => {
        if (event === 'change' || event === 'add') {
          registeredHandlers.push(handler);
        }
        return mockWatcher;
      });

      mockPorcelain = ' M locales/de.json\0 M .deepl-sync.lock\0';
      const result = makeResult({
        fileResults: [
          { file: 'locales/de.json', locale: 'de', translated: 5, skipped: 0, failed: 0, written: true },
        ],
        lockUpdated: true,
      });
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      const sigintListeners: Array<() => void> = [];
      const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
        if (event === 'SIGINT') sigintListeners.push(listener);
        return process;
      }) as unknown as ProcessOn);

      const runPromise = command.run({ watch: true, debounce: 50, autoCommit: true });

      await flushWatchSetup();

      // Baseline: the pre-watch initial sync should already have committed once.
      const commitsBefore = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('commit'),
      ).length;
      expect(commitsBefore).toBeGreaterThanOrEqual(1);

      // Trigger a watch cycle by firing one of the registered change handlers,
      // then advance timers past the debounce window and flush microtasks so
      // the queued sync + autoCommit pipeline runs to completion.
      expect(registeredHandlers.length).toBeGreaterThan(0);
      registeredHandlers[0]!();
      await jest.advanceTimersByTimeAsync(60);
      await flushWatchSetup();

      const commitsAfterFirstCycle = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('commit'),
      ).length;
      expect(commitsAfterFirstCycle).toBe(commitsBefore + 1);

      // Second cycle — an independent edit should produce another commit.
      registeredHandlers[0]!();
      await jest.advanceTimersByTimeAsync(60);
      await flushWatchSetup();

      const commitsAfterSecondCycle = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('commit'),
      ).length;
      expect(commitsAfterSecondCycle).toBe(commitsBefore + 2);

      for (const listener of sigintListeners) listener();
      await runPromise;

      processOnSpy.mockRestore();
    });

    it('returns SIGINT/SIGTERM listener counts to their baseline after shutdown', async () => {
      const result = makeResult();
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      const sigintBaseline = process.listenerCount('SIGINT');
      const sigtermBaseline = process.listenerCount('SIGTERM');

      // Don't mock process.on — the whole point is to observe real listener
      // churn across repeated invocations. Trigger shutdown by emitting the
      // signal to the real process emitter (listeners only react synchronously).
      const firstRun = command.run({ watch: true, debounce: 50 });
      await flushWatchSetup();
      // flushWatchSetup returns as soon as the watcher listeners attach, which
      // can precede the process.on('SIGINT', ...) call. Retry with a hard
      // ceiling so a missing listener fails loudly rather than as
      // "Expected: 1, Received: 0".
      for (let i = 0; i < 10 && process.listenerCount('SIGINT') === sigintBaseline; i++) {
        await flushWatchSetup();
      }
      expect(process.listenerCount('SIGINT')).toBe(sigintBaseline + 1);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBaseline + 1);

      process.emit('SIGINT');
      await firstRun;

      expect(process.listenerCount('SIGINT')).toBe(sigintBaseline);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBaseline);

      // Second invocation should also add exactly one listener, then remove it.
      const secondRun = command.run({ watch: true, debounce: 50 });
      await flushWatchSetup();
      for (let i = 0; i < 10 && process.listenerCount('SIGINT') === sigintBaseline; i++) {
        await flushWatchSetup();
      }
      expect(process.listenerCount('SIGINT')).toBe(sigintBaseline + 1);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBaseline + 1);

      process.emit('SIGTERM');
      await secondRun;

      expect(process.listenerCount('SIGINT')).toBe(sigintBaseline);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBaseline);
    });

    it('should log the number of watched patterns', async () => {
      const result = makeResult();
      const mockService = createMockSyncService(result);
      const command = new SyncCommand(mockService);

      const sigintListeners: Array<() => void> = [];
      const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
        if (event === 'SIGINT') {
          sigintListeners.push(listener);
        }
        return process;
      }) as unknown as ProcessOn);

      const runPromise = command.run({ watch: true, debounce: 100 });

      await flushWatchSetup();

      for (const listener of sigintListeners) {
        listener();
      }

      await runPromise;

      processOnSpy.mockRestore();

      const infoOutput = logInfoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(infoOutput).toContain('Watching');
      expect(infoOutput).toContain('pattern(s)');
    });

    // Watch mode caches the sync config across debounced change events —
    // config rarely changes during a session, so reloading per tick is wasted
    // work. The cache invalidates on SIGHUP or when .deepl-sync.yaml itself is
    // among the changed files.
    describe('config cache across watch ticks', () => {
      function captureChangeHandlers(): Array<(p?: string) => void> {
        const handlers: Array<(p?: string) => void> = [];
        mockWatcherOn.mockImplementation((event: string, handler: (p?: string) => void) => {
          if (event === 'change' || event === 'add') handlers.push(handler);
          return mockWatcher;
        });
        return handlers;
      }

      it('loads sync config exactly once across 3 consecutive change events', async () => {
        const result = makeResult();
        const mockService = createMockSyncService(result);
        const command = new SyncCommand(mockService);

        const handlers = captureChangeHandlers();

        const sigintListeners: Array<() => void> = [];
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
          if (event === 'SIGINT') sigintListeners.push(listener);
          return process;
        }) as unknown as ProcessOn);

        const runPromise = command.run({ watch: true, debounce: 50 });
        await flushWatchSetup();

        const initialLoads = mockLoadSyncConfig.mock.calls.length;
        expect(initialLoads).toBe(1); // pre-watch sync

        // Three debounced tick events — none touches the config file.
        expect(handlers.length).toBeGreaterThan(0);
        handlers[0]!('locales/en.json');
        await jest.advanceTimersByTimeAsync(60);
        await flushWatchSetup();

        handlers[0]!('locales/en.json');
        await jest.advanceTimersByTimeAsync(60);
        await flushWatchSetup();

        handlers[0]!('locales/en.json');
        await jest.advanceTimersByTimeAsync(60);
        await flushWatchSetup();

        expect(mockService.sync).toHaveBeenCalledTimes(4); // initial + 3 ticks
        // Cache hit: no extra config loads after the initial one.
        expect(mockLoadSyncConfig.mock.calls.length).toBe(initialLoads);

        for (const l of sigintListeners) l();
        await runPromise;
        processOnSpy.mockRestore();
      });

      it('reloads sync config when SIGHUP is received', async () => {
        const result = makeResult();
        const mockService = createMockSyncService(result);
        const command = new SyncCommand(mockService);

        const handlers = captureChangeHandlers();

        const signalListeners: Record<string, Array<() => void>> = {};
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
          (signalListeners[event] ??= []).push(listener);
          return process;
        }) as unknown as ProcessOn);

        const runPromise = command.run({ watch: true, debounce: 50 });
        await flushWatchSetup();
        // flushWatchSetup can return before watcher.on('change', ...) has
        // registered. Retry with a hard ceiling so a missing handler fails
        // loudly rather than as "handlers[0] is not a function".
        for (let i = 0; i < 10 && handlers.length === 0; i++) {
          await flushWatchSetup();
        }
        expect(handlers.length).toBeGreaterThan(0);

        const initialLoads = mockLoadSyncConfig.mock.calls.length;

        // First tick — uses cache.
        handlers[0]!('locales/en.json');
        await jest.advanceTimersByTimeAsync(60);
        await flushWatchSetup();
        expect(mockLoadSyncConfig.mock.calls.length).toBe(initialLoads);

        // SIGHUP invalidates the cache.
        expect(signalListeners['SIGHUP']?.length ?? 0).toBeGreaterThan(0);
        for (const l of signalListeners['SIGHUP'] ?? []) l();

        // Next tick must reload.
        handlers[0]!('locales/en.json');
        await jest.advanceTimersByTimeAsync(60);
        await flushWatchSetup();
        expect(mockLoadSyncConfig.mock.calls.length).toBe(initialLoads + 1);

        for (const l of signalListeners['SIGINT'] ?? []) l();
        await runPromise;
        processOnSpy.mockRestore();
      });

      it('reloads sync config when .deepl-sync.yaml is one of the changed files', async () => {
        const result = makeResult();
        const mockService = createMockSyncService(result);
        const command = new SyncCommand(mockService);

        const handlers = captureChangeHandlers();

        const sigintListeners: Array<() => void> = [];
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
          if (event === 'SIGINT') sigintListeners.push(listener);
          return process;
        }) as unknown as ProcessOn);

        const runPromise = command.run({ watch: true, debounce: 50 });
        await flushWatchSetup();

        const initialLoads = mockLoadSyncConfig.mock.calls.length;

        // Event carries the config-file path — the reload must fire.
        handlers[0]!('/test/.deepl-sync.yaml');
        await jest.advanceTimersByTimeAsync(60);
        await flushWatchSetup();

        expect(mockLoadSyncConfig.mock.calls.length).toBe(initialLoads + 1);

        // A subsequent unrelated tick is again served from cache.
        handlers[0]!('locales/en.json');
        await jest.advanceTimersByTimeAsync(60);
        await flushWatchSetup();
        expect(mockLoadSyncConfig.mock.calls.length).toBe(initialLoads + 1);

        for (const l of sigintListeners) l();
        await runPromise;
        processOnSpy.mockRestore();
      });

      it('includes the .deepl-sync.yaml config file itself in the watched paths', async () => {
        const result = makeResult();
        const mockService = createMockSyncService(result);
        const command = new SyncCommand(mockService);

        captureChangeHandlers();

        const sigintListeners: Array<() => void> = [];
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
          if (event === 'SIGINT') sigintListeners.push(listener);
          return process;
        }) as unknown as ProcessOn);

        const runPromise = command.run({ watch: true, debounce: 50 });
        await flushWatchSetup();

        const watchedPaths = mockWatch.mock.calls[0]![0] as string[];
        expect(watchedPaths).toContain('/test/.deepl-sync.yaml');

        for (const l of sigintListeners) l();
        await runPromise;
        processOnSpy.mockRestore();
      });
    });
  });
});

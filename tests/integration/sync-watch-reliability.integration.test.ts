import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.unmock('fast-glob');

import nock from 'nock';
import {
  createWatchController,
  type WatchEventSource,
} from '../../src/cli/commands/sync-command';
import { loadSyncConfig } from '../../src/sync/sync-config';
import { createSyncHarness, writeSyncConfig } from '../helpers/sync-harness';
import { DEEPL_FREE_API_URL } from '../helpers/nock-setup';

interface StubWatcher extends WatchEventSource {
  emit: (event: 'change' | 'add', file?: string) => void;
  close: jest.Mock<Promise<void>, []>;
}

function createStubWatcher(): StubWatcher {
  const listeners: Partial<Record<'change' | 'add', Array<(p?: string) => void>>> = {};
  return {
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
      return this;
    },
    emit(event, file) {
      for (const l of listeners[event] ?? []) l(file);
    },
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('watch mode reliability', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-watch-rel-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('event coalescing (bpah)', () => {
    it('queues a follow-up run when a change arrives during an in-flight sync', async () => {
      const inFlight = deferred<void>();
      const runSyncCalls: Array<() => void> = [];
      const runSync = jest.fn(async (_signal, _backups) => {
        const done = deferred<void>();
        runSyncCalls.push(done.resolve);
        if (runSyncCalls.length === 1) {
          inFlight.resolve();
        }
        await done.promise;
      });

      const watcher = createStubWatcher();
      const controller = createWatchController({
        watcher,
        runSync,
        projectRoot: tmpDir,
        staleBackupAgeMs: 5 * 60_000,
      });

      const first = controller.runOnce();
      await inFlight.promise;

      // second event fires while first is running — should NOT be dropped
      void controller.runOnce();

      // drain: resolve first sync
      runSyncCalls[0]!();
      await first;
      // wait a tick for the queued follow-up to start
      await Promise.resolve();
      await Promise.resolve();

      expect(runSync).toHaveBeenCalledTimes(2);
      // finish the queued follow-up
      runSyncCalls[1]!();
    });

    it('coalesces multiple events during a sync into a single follow-up run', async () => {
      const runSyncCalls: Array<() => void> = [];
      const firstStarted = deferred<void>();
      const runSync = jest.fn(async () => {
        const done = deferred<void>();
        runSyncCalls.push(done.resolve);
        if (runSyncCalls.length === 1) firstStarted.resolve();
        await done.promise;
      });

      const watcher = createStubWatcher();
      const controller = createWatchController({
        watcher,
        runSync,
        projectRoot: tmpDir,
        staleBackupAgeMs: 5 * 60_000,
      });

      const first = controller.runOnce();
      await firstStarted.promise;
      // three more events arrive during in-flight sync — expect only ONE follow-up
      void controller.runOnce();
      void controller.runOnce();
      void controller.runOnce();

      runSyncCalls[0]!();
      await first;
      await Promise.resolve();
      await Promise.resolve();

      expect(runSync).toHaveBeenCalledTimes(2);
      runSyncCalls[1]!();
    });
  });

  describe('.bak cleanup on SIGINT (79zz)', () => {
    it('removes .bak files even when runSync throws after registering them', async () => {
      const bakFile = path.join(tmpDir, 'messages.de.json.bak');
      const runSync = jest.fn(async (_signal, backups: Set<string>) => {
        fs.writeFileSync(bakFile, 'backup contents', 'utf-8');
        backups.add(bakFile);
        throw new Error('simulated SIGINT-interrupted translation');
      });

      const watcher = createStubWatcher();
      const controller = createWatchController({
        watcher,
        runSync,
        projectRoot: tmpDir,
        staleBackupAgeMs: 5 * 60_000,
      });

      await controller.runOnce();
      expect(fs.existsSync(bakFile)).toBe(false);
    });

    it('clears tracked backups from shutdown before the in-flight runSync returns', async () => {
      const bakFile = path.join(tmpDir, 'messages.de.json.bak');
      const holdRunSync = deferred<void>();
      const runSyncStarted = deferred<void>();
      const runSync = jest.fn(async (_signal, backups: Set<string>) => {
        fs.writeFileSync(bakFile, 'backup contents', 'utf-8');
        backups.add(bakFile);
        runSyncStarted.resolve();
        await holdRunSync.promise;
      });

      const watcher = createStubWatcher();
      const controller = createWatchController({
        watcher,
        runSync,
        projectRoot: tmpDir,
        staleBackupAgeMs: 5 * 60_000,
      });

      const running = controller.runOnce();
      await runSyncStarted.promise;
      // shutdown mid-flight should not wait for runSync to finish before
      // cleaning up the already-registered .bak file
      await controller.shutdown();
      expect(fs.existsSync(bakFile)).toBe(false);

      // let runSync finally resolve to keep the test from leaving a pending promise
      holdRunSync.resolve();
      await running;
    });

    it('sets cancellation flag on shutdown so in-flight runSync can abandon remaining locales', async () => {
      let observedSignal: { cancelled: boolean } | undefined;
      const signalVisible = deferred<void>();
      const runSync = jest.fn(async (signal: { cancelled: boolean }) => {
        observedSignal = signal;
        signalVisible.resolve();
        // long-running sync
        await new Promise(resolve => setTimeout(resolve, 20));
      });

      const watcher = createStubWatcher();
      const controller = createWatchController({
        watcher,
        runSync,
        projectRoot: tmpDir,
        staleBackupAgeMs: 5 * 60_000,
      });

      const running = controller.runOnce();
      await signalVisible.promise;
      expect(observedSignal?.cancelled).toBe(false);

      await controller.shutdown();
      expect(observedSignal?.cancelled).toBe(true);
      await running;
    });
  });

  describe('cancellation through SyncService (79zz)', () => {
    afterEach(() => {
      nock.cleanAll();
    });

    it('skips remaining locales once the cancellation signal is set', async () => {
      const harness = createSyncHarness({ parsers: ['json'] });
      try {
        writeSyncConfig(tmpDir, {
          targetLocales: ['de', 'fr', 'es'],
          buckets: { json: { include: ['locales/en.json'] } },
        });
        const sourceDir = path.join(tmpDir, 'locales');
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(
          path.join(sourceDir, 'en.json'),
          JSON.stringify({ hello: 'Hello' }),
          'utf-8',
        );

        const cancellationSignal = { cancelled: false };
        const callCounts: Record<string, number> = {};

        const matcher = (lang: string) =>
          nock(DEEPL_FREE_API_URL)
            .post('/v2/translate', (body: Record<string, unknown>) => body['target_lang'] === lang)
            .reply(200, () => {
              callCounts[lang] = (callCounts[lang] ?? 0) + 1;
              // once the first locale completes, signal cancellation
              cancellationSignal.cancelled = true;
              return { translations: [{ text: `${lang}-hello`, detected_source_language: 'EN', billed_characters: 5 }] };
            });

        matcher('DE');
        matcher('FR');
        matcher('ES');

        const config = await loadSyncConfig(tmpDir);
        await harness.syncService.sync(config, {
          cancellationSignal,
          concurrency: 1,
        });

        const totalCalls = Object.values(callCounts).reduce((a, b) => a + b, 0);
        expect(totalCalls).toBeLessThan(3);
      } finally {
        harness.cleanup();
      }
    });
  });

  describe('stale .bak sweep on startup (79zz)', () => {
    let errSpy: jest.SpyInstance;
    beforeEach(() => {
      errSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* silence Logger.warn */ });
    });
    afterEach(() => {
      errSpy.mockRestore();
    });

    it('removes stale .bak siblings older than the age threshold', async () => {
      const staleBak = path.join(tmpDir, 'locales', 'de.json.deepl.bak');
      fs.mkdirSync(path.dirname(staleBak), { recursive: true });
      fs.writeFileSync(staleBak, 'stale', 'utf-8');
      // backdate the mtime by 10 minutes
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(staleBak, tenMinAgo, tenMinAgo);

      const watcher = createStubWatcher();
      const controller = createWatchController({
        watcher,
        runSync: jest.fn(),
        projectRoot: tmpDir,
        staleBackupAgeMs: 5 * 60_000,
      });

      await controller.sweepStaleBackups();

      expect(fs.existsSync(staleBak)).toBe(false);
    });

    it('leaves fresh .bak siblings alone during startup sweep', async () => {
      const freshBak = path.join(tmpDir, 'locales', 'fr.json.deepl.bak');
      fs.mkdirSync(path.dirname(freshBak), { recursive: true });
      fs.writeFileSync(freshBak, 'fresh', 'utf-8');

      const watcher = createStubWatcher();
      const controller = createWatchController({
        watcher,
        runSync: jest.fn(),
        projectRoot: tmpDir,
        staleBackupAgeMs: 5 * 60_000,
      });

      await controller.sweepStaleBackups();
      expect(fs.existsSync(freshBak)).toBe(true);
    });
  });
});

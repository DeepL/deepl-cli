import * as fsSync from 'fs';
import { SyncService, type SyncResult, type SyncOptions, type SyncProgressEvent, type CancellationSignal } from '../../sync/sync-service.js';
import { loadSyncConfig, type SyncConfigOverrides, type ResolvedSyncConfig } from '../../sync/sync-config.js';
import { Logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { ExitCode } from '../../utils/exit-codes.js';
import { LOCK_FILE_NAME } from '../../sync/types.js';
import { sweepStaleBackups as sweepStaleBackupsImpl, DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS } from '../../sync/sync-bak-cleanup.js';
import { claimGracefulShutdown } from '../../utils/signal-exit.js';

export const STALE_BACKUP_AGE_MS = DEFAULT_BAK_SWEEP_MAX_AGE_SECONDS * 1000;

export interface CliSyncOptions {
  frozen?: boolean;
  ci?: boolean;
  dryRun?: boolean;
  force?: boolean;
  yes?: boolean;
  locale?: string;
  concurrency?: number;
  formality?: string;
  glossary?: string;
  modelType?: string;
  scanContext?: boolean;
  batch?: boolean;
  format?: string;
  syncConfig?: string;
  watch?: boolean;
  debounce?: number;
  flagForReview?: boolean;
  autoCommit?: boolean;
}

/**
 * Minimal file-watch event source: just the subset chokidar exposes that the
 * watch loop cares about. Making this explicit lets the integration test
 * plug in a stub and fire events deterministically under jest fake timers.
 */
export interface WatchEventSource {
  on(event: 'change' | 'add', listener: (path?: string) => void): unknown;
}

/**
 * Attach a debounced trigger to a file-watch source. Any 'change' or 'add'
 * event resets a single-shot timer; when the timer fires, `onChange` runs.
 * Returns a handle whose `clear()` cancels any pending timer — the watch
 * controller invokes it during shutdown so a queued "Change detected" log
 * line cannot print after "Stopping watch".
 */
export interface DebouncedWatchHandle {
  clear(): void;
}

export function attachDebouncedWatchLoop(opts: {
  watcher: WatchEventSource;
  onChange: (changedPaths: string[]) => void | Promise<void>;
  debounceMs: number;
}): DebouncedWatchHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let accumulated = new Set<string>();
  const trigger = (filePath?: string): void => {
    if (filePath) accumulated.add(filePath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const batch = Array.from(accumulated);
      accumulated = new Set();
      void opts.onChange(batch);
    }, opts.debounceMs);
  };
  opts.watcher.on('change', trigger);
  opts.watcher.on('add', trigger);
  return {
    clear(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      accumulated = new Set();
    },
  };
}

/**
 * Watch-mode run controller. Coalesces overlapping file-change events,
 * shares a cancellation flag with in-flight syncs, tracks each cycle's
 * `.bak` files so SIGINT during translation still cleans them up, and
 * sweeps stale `.bak` siblings at startup.
 */
export interface WatchController {
  runOnce(): Promise<void>;
  shutdown(): Promise<void>;
  sweepStaleBackups(): Promise<void>;
}

export interface WatchControllerDeps {
  watcher: { close(): Promise<void> | void };
  runSync: (signal: CancellationSignal, backupTracker: Set<string>) => Promise<void>;
  projectRoot: string;
  staleBackupAgeMs: number;
  /** Bucket include-glob map for scoped .bak sweep. When absent the sweep falls back to full-tree walk. */
  buckets?: Record<string, { include: string[] }>;
  /**
   * Optional hook invoked at the start of `shutdown()` so the outer loop can
   * cancel any pending debounce timer. Lets us guarantee that a "Change
   * detected" log line cannot print after "Stopping watch".
   */
  clearPendingDebounce?: () => void;
}

export function createWatchController(deps: WatchControllerDeps): WatchController {
  let syncing = false;
  let pendingRun = false;
  const cancellationSignal: CancellationSignal = { cancelled: false };
  const activeBackups = new Set<string>();

  async function cleanupTrackedBackups(): Promise<void> {
    if (activeBackups.size === 0) return;
    for (const bakPath of activeBackups) {
      try {
        await fsSync.promises.unlink(bakPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          Logger.warn(`Failed to remove backup ${bakPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    activeBackups.clear();
  }

  async function runOnce(): Promise<void> {
    if (syncing) {
      pendingRun = true;
      return;
    }
    syncing = true;
    try {
      await deps.runSync(cancellationSignal, activeBackups);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`Sync failed: ${msg}`);
    } finally {
      syncing = false;
      await cleanupTrackedBackups();
      if (pendingRun && !cancellationSignal.cancelled) {
        pendingRun = false;
        void runOnce();
      }
    }
  }

  async function shutdown(): Promise<void> {
    cancellationSignal.cancelled = true;
    pendingRun = false;
    if (deps.clearPendingDebounce) deps.clearPendingDebounce();
    try {
      await deps.watcher.close();
    } catch {
      /* swallow — we're shutting down */
    }
    await cleanupTrackedBackups();
  }

  async function sweepStaleBackups(): Promise<void> {
    await sweepStaleBackupsImpl(deps.projectRoot, deps.staleBackupAgeMs, deps.buckets);
  }

  return { runOnce, shutdown, sweepStaleBackups };
}

const PRO_RATE_PER_CHAR = 25 / 1_000_000; // $25 per 1M characters

function formatCostEstimate(characters: number): string {
  const cost = characters * PRO_RATE_PER_CHAR;
  if (cost < 0.01) return '<$0.01';
  return `~$${cost.toFixed(2)}`;
}

/**
 * Stable public shape emitted by `deepl sync --format json`.
 * Every field listed here is guaranteed stable across 1.x.
 * Internal SyncResult fields not listed here are intentionally omitted.
 */
export interface SyncJsonOutput {
  ok: boolean;
  totalKeys: number;
  translated: number;
  skipped: number;
  failed: number;
  targetLocaleCount: number;
  estimatedCharacters: number;
  estimatedCost?: string;
  rateAssumption: 'pro';
  dryRun: boolean;
  perLocale: Array<{ locale: string; translated: number; skipped: number; failed: number }>;
}

function projectToPublicShape(result: SyncResult, estimatedCost: string | undefined): SyncJsonOutput {
  const perLocale = result.fileResults.reduce<Map<string, { translated: number; skipped: number; failed: number }>>(
    (acc, fr) => {
      const existing = acc.get(fr.locale) ?? { translated: 0, skipped: 0, failed: 0 };
      existing.translated += fr.translated;
      existing.skipped += fr.skipped;
      existing.failed += fr.failed;
      acc.set(fr.locale, existing);
      return acc;
    },
    new Map(),
  );

  const totalTranslated = result.fileResults.reduce((sum, fr) => sum + fr.translated, 0);
  const totalSkipped = result.fileResults.reduce((sum, fr) => sum + fr.skipped, 0);
  const totalFailed = result.fileResults.reduce((sum, fr) => sum + fr.failed, 0);

  return {
    ok: result.success,
    totalKeys: result.totalKeys,
    translated: totalTranslated,
    skipped: totalSkipped,
    failed: totalFailed,
    targetLocaleCount: result.targetLocaleCount,
    estimatedCharacters: result.estimatedCharacters,
    ...(estimatedCost !== undefined ? { estimatedCost } : {}),
    rateAssumption: 'pro',
    dryRun: result.dryRun,
    perLocale: Array.from(perLocale.entries()).map(([locale, counts]) => ({ locale, ...counts })),
  };
}

export class SyncCommand {
  constructor(private readonly syncService: SyncService) {}

  async run(options: CliSyncOptions): Promise<SyncResult> {
    const frozen = options.frozen ?? options.ci;

    const overrides: SyncConfigOverrides = {
      frozen,
      dryRun: options.dryRun,
      force: options.force,
      localeFilter: options.locale ? options.locale.split(',').map(l => l.trim()) : undefined,
      formality: options.formality,
      glossary: options.glossary,
      modelType: options.modelType,
      context: options.scanContext,
      batch: options.batch,
      concurrency: options.concurrency,
      configPath: options.syncConfig,
    };

    const config = await loadSyncConfig(process.cwd(), overrides);

    const format = (options.format as 'text' | 'json') ?? 'text';

    const syncOptions: SyncOptions = {
      dryRun: options.dryRun,
      frozen,
      force: options.force,
      flagForReview: options.flagForReview,
      localeFilter: overrides.localeFilter,
      concurrency: options.concurrency,
      batch: options.batch,
      onProgress: (event) => this.renderProgress(event, format),
    };

    const result = await this.syncService.sync(config, syncOptions);
    this.displayResult(result, format);

    if (!result.success) {
      process.exitCode = ExitCode.PartialFailure;
    }

    if (options.autoCommit && result.success && !result.dryRun && !result.driftDetected) {
      await this.autoCommitTranslations(result, config);
    }

    if (options.watch) {
      await this.watchAndSync(config, syncOptions, options);
    }

    return result;
  }

  private async watchAndSync(
    config: ResolvedSyncConfig,
    syncOptions: SyncOptions,
    options: CliSyncOptions,
  ): Promise<void> {
    const chokidar = await import('chokidar');
    const { default: path } = await import('path');
    const debounceMs = options.debounce ?? 500;

    const watchPaths: string[] = [];
    for (const bucketConfig of Object.values(config.buckets)) {
      for (const pattern of bucketConfig.include) {
        watchPaths.push(path.resolve(config.projectRoot, pattern));
      }
    }

    if (watchPaths.length === 0) {
      Logger.warn('No source files to watch.');
      return;
    }

    // Also watch the .deepl-sync.yaml file itself so the cached config is
    // invalidated and reloaded when the user edits the config mid-session.
    const configPathResolved = path.resolve(config.configPath);
    if (!watchPaths.includes(configPathResolved)) {
      watchPaths.push(configPathResolved);
    }

    Logger.info(`Watching ${watchPaths.length} pattern(s) for changes (debounce: ${debounceMs}ms)...`);

    const watcher = chokidar.watch(watchPaths, {
      cwd: config.projectRoot,
      ignoreInitial: true,
      followSymlinks: false,
    });

    // Configurable stale-bak sweep age. Falls back to the hardcoded
    // STALE_BACKUP_AGE_MS when .deepl-sync.yaml doesn't set it.
    const configuredSweepSeconds = config.sync?.bak_sweep_max_age_seconds;
    const configuredSweepMs =
      configuredSweepSeconds !== undefined && configuredSweepSeconds > 0
        ? configuredSweepSeconds * 1000
        : STALE_BACKUP_AGE_MS;

    // Cache the validated config for the watch session. loadSyncConfig +
    // validateSyncConfig is ~O(file-read + YAML.parse + ajv-like checks);
    // running it on every debounced tick is wasted work since config rarely
    // changes during a watch session. The cache invalidates on SIGHUP or when
    // .deepl-sync.yaml itself is one of the changed files.
    let cachedConfig: ResolvedSyncConfig = config;
    const configFileName = path.basename(configPathResolved);

    const ensureFreshConfig = async (changedPaths: string[]): Promise<ResolvedSyncConfig> => {
      const configChanged = changedPaths.some((p) => {
        if (!p) return false;
        const resolved = path.isAbsolute(p) ? p : path.resolve(config.projectRoot, p);
        return resolved === configPathResolved || path.basename(p) === configFileName;
      });
      if (configChanged) {
        cachedConfig = await loadSyncConfig(process.cwd(), {
          configPath: options.syncConfig,
          localeFilter: syncOptions.localeFilter,
          formality: options.formality,
          glossary: options.glossary,
          modelType: options.modelType,
          context: options.scanContext,
          concurrency: options.concurrency,
        });
      }
      return cachedConfig;
    };

    const invalidateCache = async (): Promise<void> => {
      cachedConfig = await loadSyncConfig(process.cwd(), {
        configPath: options.syncConfig,
        localeFilter: syncOptions.localeFilter,
        formality: options.formality,
        glossary: options.glossary,
        modelType: options.modelType,
        context: options.scanContext,
        concurrency: options.concurrency,
      });
    };

    const debouncedHandle: { current?: DebouncedWatchHandle } = {};
    let pendingChangedPaths: string[] = [];
    const controller = createWatchController({
      watcher,
      projectRoot: config.projectRoot,
      staleBackupAgeMs: configuredSweepMs,
      buckets: config.buckets,
      clearPendingDebounce: () => debouncedHandle.current?.clear(),
      runSync: async (signal, backupTracker) => {
        const activeConfig = await ensureFreshConfig(pendingChangedPaths);
        pendingChangedPaths = [];
        const timestamp = new Date().toLocaleTimeString();
        Logger.info(`[${timestamp}] Change detected, syncing...`);
        const result = await this.syncService.sync(activeConfig, {
          ...syncOptions,
          cancellationSignal: signal,
          backupTracker,
        });
        this.displayResult(result, 'text');
        if (options.autoCommit && result.success && !result.dryRun && !result.driftDetected) {
          await this.autoCommitTranslations(result, activeConfig);
        }
      },
    });

    await controller.sweepStaleBackups();

    debouncedHandle.current = attachDebouncedWatchLoop({
      watcher,
      onChange: (changedPaths) => {
        pendingChangedPaths = changedPaths;
        return controller.runOnce();
      },
      debounceMs,
    });

    // Watch mode treats SIGINT/SIGTERM as its normal stop signal and shuts
    // down successfully, so the CLI's signal-exit must not force a failure code.
    claimGracefulShutdown();

    await new Promise<void>((resolve) => {
      const onStop = (): void => {
        Logger.info('\nStopping watch...');
        process.off('SIGINT', onStop);
        process.off('SIGTERM', onStop);
        process.off('SIGHUP', onHup);
        void controller.shutdown().then(resolve);
      };
      const onHup = (): void => {
        Logger.info('SIGHUP received — reloading sync config...');
        void invalidateCache().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          Logger.error(`Failed to reload config: ${msg}`);
        });
      };
      process.on('SIGINT', onStop);
      process.on('SIGTERM', onStop);
      process.on('SIGHUP', onHup);
    });
  }

  /**
   * Every relative path this config's buckets can write, mapped to its locale.
   * Source files come from the lockfile and are matched to their own bucket, so
   * one bucket's target_path_pattern cannot claim another bucket's output.
   */
  private async resolveOwnedTargetPaths(
    config: ResolvedSyncConfig,
  ): Promise<Map<string, string>> {
    const pathMod = await import('path');
    const { minimatch } = await import('minimatch');
    const { SyncLockManager } = await import('../../sync/sync-lock.js');
    const { resolveTargetPath } = await import('../../sync/sync-utils.js');

    const owned = new Map<string, string>();
    const lockManager = new SyncLockManager(pathMod.join(config.projectRoot, LOCK_FILE_NAME));
    const lockFile = await lockManager.read();
    const sourcePaths = Object.keys(lockFile.entries);

    for (const bucketConfig of Object.values(config.buckets)) {
      for (const sourcePath of sourcePaths) {
        if (!bucketConfig.include.some(pattern => minimatch(sourcePath, pattern))) continue;
        for (const locale of config.target_locales) {
          try {
            const targetPath = resolveTargetPath(
              sourcePath,
              config.source_locale,
              locale,
              bucketConfig.target_path_pattern,
            );
            owned.set(targetPath, locale);
          } catch {
            // No derivable target: the path does not carry the source locale.
          }
        }
      }
    }

    return owned;
  }

  private async autoCommitTranslations(result: SyncResult, config: ResolvedSyncConfig): Promise<void> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const execFileAsync = promisify(execFile);
    const cwd = config.projectRoot;

    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd });
    } catch {
      Logger.warn('Not a git repository — skipping auto-commit.');
      return;
    }

    const writtenFiles = result.fileResults
      .filter(r => r.written)
      .map(r => r.file);

    // Preflight: refuse to auto-commit in unsafe repo states, so unrelated work
    // is never bundled into the chore(i18n) commit and nothing lands on the
    // wrong ref. The checks run even when this sync wrote nothing, because a
    // refusal leaves translations on disk that are still owed a commit.
    //
    // Anything this config can write counts as expected, not only what this run
    // wrote: a translation from an earlier refusal belongs to the next commit
    // rather than being an unrelated modification.
    const ownedPaths = await this.resolveOwnedTargetPaths(config);
    const expectedStaged = new Set<string>([...writtenFiles, ...ownedPaths.keys(), LOCK_FILE_NAME]);

    // 1. In-progress rebase/merge/cherry-pick
    const gitDir = (await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd })).stdout.trim();
    const gitDirAbs = pathMod.isAbsolute(gitDir) ? gitDir : pathMod.join(cwd, gitDir);
    const inProgressMarkers: Array<{ path: string; label: string }> = [
      { path: 'rebase-apply', label: 'rebase (apply)' },
      { path: 'rebase-merge', label: 'rebase (merge)' },
      { path: 'MERGE_HEAD', label: 'merge' },
      { path: 'CHERRY_PICK_HEAD', label: 'cherry-pick' },
    ];
    for (const marker of inProgressMarkers) {
      if (fsMod.existsSync(pathMod.join(gitDirAbs, marker.path))) {
        throw new ValidationError(
          `Refusing to auto-commit: a ${marker.label} is in progress.`,
          'Complete or abort the in-progress operation (e.g. `git rebase --abort`), then re-run `deepl sync --auto-commit`.',
        );
      }
    }

    // 2. Detached HEAD
    try {
      await execFileAsync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd });
    } catch {
      throw new ValidationError(
        'Refusing to auto-commit: HEAD is detached (no branch to commit to).',
        'Check out a branch with `git checkout <branch>` before running `deepl sync --auto-commit`.',
      );
    }

    // 3. Dirty tree with unrelated modifications (or pre-existing staged files
    // that aren't part of this sync run).
    const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain', '-z'], { cwd });
    const unrelated: string[] = [];
    const dirtyOwned: string[] = [];
    if (porcelain.length > 0) {
      const parts = porcelain.split('\0').filter(Boolean);
      for (const part of parts) {
        // Each entry is "XY <path>" where XY is the two-char status code.
        // Rename entries ("R  old -> new") are emitted with a second NUL for
        // the rename source in -z mode; the outer split will already have
        // separated those, so `part` is "XY path" for the new name here.
        const statusCode = part.slice(0, 2);
        const filePath = part.slice(3);
        if (!filePath) continue;
        if (expectedStaged.has(filePath)) {
          dirtyOwned.push(filePath);
          continue;
        }
        // Untracked files with the exact target path are already filtered by
        // the expectedStaged check; everything else is unrelated.
        unrelated.push(`${filePath} (${statusCode.trim() || '??'})`);
      }
    }
    if (unrelated.length > 0) {
      const list = unrelated.join(', ');
      throw new ValidationError(
        `Refusing to auto-commit: working tree has unrelated modifications in: ${list}.`,
        'Commit or stash them first, then run `deepl sync --auto-commit` again.',
      );
    }

    // Dirt, not write records: a rewrite producing identical bytes has nothing
    // to commit, while a translation awaiting a commit does.
    const filesToStage = dirtyOwned;
    if (filesToStage.length === 0) return;

    for (const file of filesToStage) {
      await execFileAsync('git', ['add', file], { cwd });
    }

    const localeOf = new Map<string, string>(ownedPaths);
    for (const fileResult of result.fileResults) localeOf.set(fileResult.file, fileResult.locale);
    const locales = [...new Set(filesToStage.map(file => localeOf.get(file)).filter(Boolean))].join(', ');

    const msg = locales
      ? `chore(i18n): sync translations for ${locales}`
      : 'chore(i18n): sync translation lockfile';
    await execFileAsync('git', ['commit', '-m', msg], { cwd });
    Logger.info(`Auto-committed ${filesToStage.length} file(s): ${msg}`);
  }

  private renderProgress(event: SyncProgressEvent, format: 'text' | 'json'): void {
    if (Logger.isQuiet()) return;
    if (format === 'json') {
      Logger.info(JSON.stringify(event));
    } else if (event.type === 'locale-complete') {
      const total = event.translated + event.failed;
      if (total === 0) return;
      const icon = event.failed > 0 ? '\u2717' : '\u2713';
      Logger.info(`  ${icon} ${event.locale}: ${event.translated}/${total} keys (${event.file})`);
    }
    // key-translated events are silent in text mode
  }

  private displayResult(result: SyncResult, format: 'text' | 'json'): void {
    if (format === 'json') {
      const charSource = result.totalCharactersBilled || result.estimatedCharacters;
      const estimatedCost = charSource > 0 ? formatCostEstimate(charSource) : undefined;
      // Success JSON payload routed to stdout so `deepl sync --format json > out.json`
      // captures the final result. Progress events remain on stderr via Logger.info.
      process.stdout.write(JSON.stringify(projectToPublicShape(result, estimatedCost), null, 2) + '\n');
      return;
    }

    if (result.dryRun) {
      Logger.info('[dry-run] No translations performed.');
    }

    if (result.driftDetected) {
      const driftParts: string[] = [];
      if (result.newKeys > 0) driftParts.push(`${result.newKeys} new`);
      if (result.staleKeys > 0) driftParts.push(`${result.staleKeys} stale`);
      if (result.deletedKeys > 0) driftParts.push(`${result.deletedKeys} deleted`);
      const driftSummary = driftParts.length > 0 ? driftParts.join(', ') : 'no key-level diffs surfaced';
      Logger.info(`Sync drift detected: ${driftSummary} keys.`);
      return;
    }

    const parts: string[] = [];
    if (result.newKeys > 0) parts.push(`${result.newKeys} new`);
    if (result.staleKeys > 0) parts.push(`${result.staleKeys} updated`);
    if (result.currentKeys > 0) parts.push(`${result.currentKeys} current`);
    if (result.deletedKeys > 0) parts.push(`${result.deletedKeys} deleted`);

    const summary = parts.length > 0 ? parts.join(', ') : 'no changes';
    const localeInfo = result.dryRun && result.targetLocaleCount > 0
      ? ` across ${result.targetLocaleCount} language${result.targetLocaleCount === 1 ? '' : 's'}`
      : '';
    let chars = '';
    if (result.totalCharactersBilled > 0) {
      chars = ` (${result.totalCharactersBilled.toLocaleString()} chars, ${formatCostEstimate(result.totalCharactersBilled)} (Pro tier estimate))`;
    }

    Logger.info(`Sync complete: ${summary}${localeInfo}${chars}`);

    if (result.strategy) {
      const stratParts: string[] = [];
      if (result.strategy.context > 0) {
        stratParts.push(`context: ${result.strategy.context} keys`);
      }
      const instrEntries = Object.entries(result.strategy.instruction);
      if (instrEntries.length > 0) {
        const instrTotal = instrEntries.reduce((sum, [, n]) => sum + n, 0);
        const instrDetail = instrEntries.map(([elem, n]) => `${elem}: ${n}`).join(', ');
        stratParts.push(`instructions: ${instrTotal} keys (${instrDetail})`);
      }
      if (stratParts.length > 0) {
        Logger.info(`  ${stratParts.join(', ')}`);
      }
    }

    if (result.dryRun && result.estimatedCharacters > 0) {
      Logger.info(`This sync: ~${result.estimatedCharacters.toLocaleString()} chars, ${formatCostEstimate(result.estimatedCharacters)} (Pro tier estimate)`);
    }

    if (result.validationWarnings > 0) {
      Logger.warn(`${result.validationWarnings} validation warning(s)`);
    }
    if (result.validationErrors > 0) {
      Logger.warn(`${result.validationErrors} validation error(s)`);
    }
  }
}

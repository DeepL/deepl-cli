import { Command, Option } from 'commander';
import { Logger } from '../../../utils/logger.js';
import { SyncConflictError } from '../../../utils/errors.js';
import type { ServiceDeps } from '../service-factory.js';
import { emitJsonErrorAndExit, resolveFormat, resolveSyncConfig } from './sync-options.js';

interface ResolveOptions {
  syncConfig?: string;
  dryRun?: boolean;
  format?: string;
}

export function registerSyncResolve(
  parent: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Command {
  return parent
    .command('resolve')
    .description('Resolve git merge conflicts in .deepl-sync.lock')
    .addOption(
      new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'),
    )
    .option('--sync-config <path>', 'Path to .deepl-sync.yaml')
    .option('--dry-run', 'Preview the decision report without writing the lockfile')
    .action((options: ResolveOptions, command: Command) =>
      handleSyncResolve(options, command, deps),
    );
}

async function handleSyncResolve(
  options: ResolveOptions,
  command: Command,
  deps: Pick<ServiceDeps, 'handleError'>,
): Promise<void> {
  options.format = resolveFormat(options, command);
  // Commander routes --dry-run on the invocation line to the parent `sync`
  // command (which also defines --dry-run). Fall back to the parent's value.
  const parentDryRun = command.parent?.opts()['dryRun'] as boolean | undefined;
  const dryRun = options.dryRun ?? parentDryRun ?? false;
  try {
    const { loadSyncConfig } = await import('../../../sync/sync-config.js');
    const { LOCK_FILE_NAME } = await import('../../../sync/types.js');
    const { resolveLockFile } = await import('../../../sync/sync-resolve.js');
    const pathMod = await import('path');

    const config = await loadSyncConfig(process.cwd(), {
      configPath: resolveSyncConfig(options, command),
    });
    const lockPath = pathMod.join(config.projectRoot, LOCK_FILE_NAME);
    const result = await resolveLockFile(lockPath, { dryRun });

    if (!result.hadConflicts) {
      if (options.format === 'json') {
        process.stdout.write(JSON.stringify({ ok: true, resolved: 0, decisions: [] }) + '\n');
      } else {
        Logger.info('No merge conflicts found in lock file.');
      }
      return;
    }

    const decisions = result.decisions ?? [];
    const counts = { ours: 0, theirs: 0, lengthHeuristic: 0, unresolved: 0 };
    for (const d of decisions) {
      const label = d.file ? pathMod.relative(config.projectRoot, d.file) : '';
      const prefix = label ? `${label}:${d.key}` : d.key;
      if (d.source === 'length-heuristic') {
        counts.lengthHeuristic++;
        Logger.warn(`WARN  ${prefix} — parse-error fallback used, ${d.reason}`);
      } else if (d.source === 'unresolved') {
        counts.unresolved++;
        Logger.warn(`UNRESOLVED ${prefix} — ${d.reason}`);
      } else {
        if (d.source === 'ours') counts.ours++;
        else counts.theirs++;
        Logger.info(`Resolved ${prefix} (${d.reason})`);
      }
    }

    if (result.resolved) {
      if (options.format === 'json') {
        process.stdout.write(
          JSON.stringify({ ok: true, resolved: result.entriesMerged, decisions: decisions }) + '\n',
        );
      } else {
        const summaryParts = [
          `${counts.theirs} theirs`,
          `${counts.ours} ours`,
          `${counts.lengthHeuristic} length-heuristic`,
        ];
        if (counts.unresolved > 0) summaryParts.push(`${counts.unresolved} unresolved`);
        const dryRunSuffix = dryRun ? ' (dry-run: no files written)' : '';
        Logger.info(
          `Resolved ${result.entriesMerged} conflict${
            result.entriesMerged === 1 ? '' : 's'
          } (${summaryParts.join(', ')}).${dryRunSuffix} Run "deepl sync" to fill any gaps.`,
        );
      }
    } else {
      throw new SyncConflictError(
        'Could not automatically resolve lock file conflicts. Manual resolution required.',
        'Edit .deepl-sync.lock to resolve conflict markers manually, then run `deepl sync` to fill gaps.',
      );
    }
  } catch (error) {
    if (options.format === 'json') {
      emitJsonErrorAndExit(error);
    }
    deps.handleError(error);
  }
}

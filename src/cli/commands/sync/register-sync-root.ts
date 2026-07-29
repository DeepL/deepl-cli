import { Command, Option } from 'commander';
import { ExitCode } from '../../../utils/exit-codes.js';
import { ValidationError } from '../../../utils/errors.js';
import { createSyncCommand, type ServiceDeps } from '../service-factory.js';
import { emitJsonErrorAndExit } from './sync-options.js';
import { parsePositiveIntOption } from '../parse-int-option.js';

export function registerSyncRoot(program: Command, deps: ServiceDeps): Command {
  return program
    .command('sync')
    .description('Synchronize translation files using .deepl-sync.yaml config')
    .optionsGroup('Sync Mode:')
    .option('--frozen', 'Fail if any strings need translation (for CI)')
    .option('--ci', 'Alias for --frozen')
    .option('--dry-run', 'Show what would change without writing files or calling API')
    .option(
      '--force',
      'Retranslate all strings, ignoring the lock file. WARNING: also bypasses the sync.max_characters cost-cap preflight — this can rebill every translated key and incur unexpected API costs. Prefer --dry-run first to see the character estimate.',
    )
    .optionsGroup('Filtering:')
    .option('--locale <locales>', 'Limit to specific target locales (comma-separated)')
    .optionsGroup('Translation Quality:')
    .addOption(
      new Option('--formality <level>', 'Override formality level').choices([
        'default',
        'more',
        'less',
        'prefer_more',
        'prefer_less',
        'formal',
        'informal',
      ]),
    )
    .option('--glossary <name-or-id>', 'Override glossary for all buckets')
    .addOption(
      new Option('--model-type <type>', 'Override model type').choices([
        'quality_optimized',
        'prefer_quality_optimized',
        'latency_optimized',
      ]),
    )
    .option('--scan-context', 'Scan source code for context (key paths, HTML element types)')
    .option(
      '--no-scan-context',
      'Disable source-code context scanning for this run. Overrides context.enabled only; other context.* settings in .deepl-sync.yaml are preserved.',
    )
    .addOption(new Option('--context').hideHelp())
    .addOption(new Option('--no-context').hideHelp())
    .optionsGroup('Performance:')
    .option('--concurrency <number>', 'Max parallel locale translations (default: 5)', (v) =>
      parsePositiveIntOption(v, 'concurrency', 100))
    .option('--batch', 'Force batch mode (fastest, no context or instructions)')
    .option(
      '--no-batch',
      'Force per-key mode (slowest, individual context per key). Default: section-batched context',
    )
    .optionsGroup('Git:')
    .option('--auto-commit', 'Auto-commit translated files after sync')
    .optionsGroup('Review:')
    .option(
      '--flag-for-review',
      'Mark translations as machine_translated in lock file for human review',
    )
    .optionsGroup('Watch:')
    .option('--watch', 'Watch source files and auto-sync on changes')
    .option('--debounce <ms>', 'Debounce delay for watch mode (default: 500ms)', (v) =>
      parsePositiveIntOption(v, 'debounce', 600_000))
    .optionsGroup('Safety:')
    .option('-y, --yes', 'Skip --force confirmation prompt (required when CI=true)')
    .optionsGroup('Output:')
    .addOption(
      new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'),
    )
    .optionsGroup('Config:')
    .option('--sync-config <path>', 'Path to .deepl-sync.yaml (default: auto-detect)')
    .addHelpText(
      'after',
      `
First-time setup:
  $ deepl sync init                     Interactive wizard to create .deepl-sync.yaml
  $ deepl sync --dry-run                Preview what would be translated (no API calls)
  $ deepl sync                          Run the first sync
  $ deepl sync status                   Per-locale translation coverage

Everyday use:
  $ deepl sync                          Sync all configured translations
  $ deepl sync --dry-run                Preview changes
  $ deepl sync --frozen                 CI check: fail if drift detected (exit 10)
  $ deepl sync --locale de,fr           Only sync German and French
  $ deepl sync --force                  Retranslate everything — re-bills API and skips the sync.max_characters cost cap
  $ deepl sync --batch                  Force batch mode (fastest, no context)
  $ deepl sync --no-batch               Force per-key context (slower, max quality)
  $ deepl sync --watch                  Watch and auto-sync on changes

Translation memories:
  Configure TM via .deepl-sync.yaml (translation.translation_memory).
  Run \`deepl tm list\` to see available TMs.
`,
    )
    .action((options: Record<string, unknown>) => handleSyncRoot(options, deps));
}

async function handleSyncRoot(
  options: Record<string, unknown>,
  deps: ServiceDeps,
): Promise<void> {
  const { handleError } = deps;
  try {
    if (options['context'] !== undefined) {
      throw new ValidationError(
        '--context is not a `deepl sync` flag. `deepl translate --context "<text>"` takes a string (translation guidance); `deepl sync` uses a boolean to toggle source-code context scanning, which has been renamed to avoid confusion.',
        'Use --scan-context / --no-scan-context to control source-code context scanning.',
      );
    }
    const frozen =
      (options['frozen'] as boolean | undefined) ??
      (options['ci'] as boolean | undefined);
    if (frozen && options['force']) {
      throw new ValidationError('Cannot use --frozen and --force together');
    }
    if (frozen && options['watch']) {
      throw new ValidationError('Cannot use --frozen and --watch together');
    }
    if (options['watch'] && options['force']) {
      throw new ValidationError(
        'Cannot use --watch and --force together: --force with --watch creates an unbounded billing loop that retranslates every key on every file change.',
        'Run `deepl sync --force` once to retranslate, then use `deepl sync --watch` for ongoing change detection.',
      );
    }
    if (options['force'] && !options['yes']) {
      if (process.env['CI'] === 'true') {
        throw new ValidationError(
          'Cannot use --force in CI without --yes: add --yes to confirm intentional use and acknowledge the billing risk.',
        );
      }
      if (process.stdin.isTTY) {
        const { confirm } = await import('../../../utils/confirm.js');
        const confirmed = await confirm({
          message: 'Retranslate all keys and bypass cost cap?',
        });
        if (!confirmed) {
          process.exitCode = ExitCode.Success;
          return;
        }
      }
    }
    const syncCommand = await createSyncCommand(deps);
    const result = await syncCommand.run(options);
    if (result.driftDetected) {
      // Soft exit — set exitCode and return so in-flight writes / auto-commit
      // steps / the --watch event loop drain cleanly instead of being killed
      // mid-cycle. docs/API.md:2939 has promised this shape since 1.1.0.
      process.exitCode = ExitCode.SyncDrift;
      return;
    }
  } catch (error) {
    if (options['format'] === 'json') {
      emitJsonErrorAndExit(error);
    }
    handleError(error);
  }
}

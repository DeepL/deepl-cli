/**
 * Commander-tree snapshot test for `deepl sync` and its subcommands.
 *
 * This test guards against observable CLI shape changes. It walks
 * the commander tree produced by registerSync() and captures, for each
 * command: name, description, options (flags, description, default, choices,
 * negate), and nested subcommands. Any drift to the tree — a renamed flag,
 * dropped description, changed default — breaks this test.
 */

import { Command, Option } from 'commander';
import { registerSync } from '../../../src/cli/commands/register-sync';
import type { ServiceDeps } from '../../../src/cli/commands/service-factory';

interface OptionSnapshot {
  flags: string;
  description: string;
  defaultValue: unknown;
  negate: boolean;
  choices: readonly string[] | undefined;
  required: boolean;
  optional: boolean;
  variadic: boolean;
  mandatory: boolean;
}

interface CommandSnapshot {
  name: string;
  description: string;
  options: OptionSnapshot[];
  subcommands: CommandSnapshot[];
}

function snapshotOption(opt: Option): OptionSnapshot {
  return {
    flags: opt.flags,
    description: opt.description,
    defaultValue: opt.defaultValue,
    negate: opt.negate,
    choices: opt.argChoices,
    required: opt.required,
    optional: opt.optional,
    variadic: opt.variadic,
    mandatory: opt.mandatory,
  };
}

function snapshotCommand(cmd: Command): CommandSnapshot {
  const options = cmd.options
    .map((o) => snapshotOption(o))
    .sort((a, b) => a.flags.localeCompare(b.flags));
  const subcommands = cmd.commands
    .map((c) => snapshotCommand(c))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    name: cmd.name(),
    description: cmd.description(),
    options,
    subcommands,
  };
}

function buildSyncTree(): CommandSnapshot {
  const program = new Command();
  const deps: ServiceDeps = {
    createDeepLClient: jest.fn(),
    getApiKeyAndOptions: jest.fn(),
    getConfigService: jest.fn(),
    getCacheService: jest.fn(),
    handleError: jest.fn() as unknown as ServiceDeps['handleError'],
  };
  registerSync(program, deps);
  const syncCmd = program.commands.find((c) => c.name() === 'sync');
  if (!syncCmd) throw new Error('sync command not registered');
  return snapshotCommand(syncCmd);
}

describe('register-sync commander tree', () => {
  it('matches the hand-written expected tree (guards CLI shape)', () => {
    const actual = buildSyncTree();
    expect(actual).toEqual(EXPECTED);
  });

  it('registers exactly these subcommands', () => {
    const actual = buildSyncTree();
    const names = actual.subcommands.map((c) => c.name);
    expect(names).toEqual([
      'audit',
      'export',
      'glossary-report',
      'init',
      'pull',
      'push',
      'resolve',
      'status',
      'validate',
    ]);
  });

  it('keeps the hidden glossary-report rejector registered', () => {
    const program = new Command();
    const deps: ServiceDeps = {
      createDeepLClient: jest.fn(),
      getApiKeyAndOptions: jest.fn(),
      getConfigService: jest.fn(),
      getCacheService: jest.fn(),
      handleError: jest.fn() as unknown as ServiceDeps['handleError'],
    };
    registerSync(program, deps);
    const syncCmd = program.commands.find((c) => c.name() === 'sync');
    const legacy = syncCmd?.commands.find((c) => c.name() === 'glossary-report');
    expect(legacy).toBeDefined();
  });

  it('parent sync command has --format with text default', () => {
    const actual = buildSyncTree();
    const formatOpt = actual.options.find((o) => o.flags.includes('--format'));
    expect(formatOpt).toBeDefined();
    expect(formatOpt?.defaultValue).toBe('text');
    expect(formatOpt?.choices).toEqual(['text', 'json']);
  });

  it('every subcommand with --format has text default and text/json choices', () => {
    const actual = buildSyncTree();
    for (const sub of actual.subcommands) {
      const formatOpt = sub.options.find((o) => o.flags.includes('--format'));
      if (formatOpt) {
        expect(formatOpt.defaultValue).toBe('text');
        expect(formatOpt.choices).toEqual(['text', 'json']);
      }
    }
  });
});

// Options are stored sorted by flags for stable comparison.
const PARENT_DRY_RUN: OptionSnapshot = {
  flags: '--dry-run',
  description: 'Show what would change without writing files or calling API',
  defaultValue: undefined,
  negate: false,
  choices: undefined,
  required: false,
  optional: false,
  variadic: false,
  mandatory: false,
};

const RESOLVE_DRY_RUN: OptionSnapshot = {
  flags: '--dry-run',
  description: 'Preview the decision report without writing the lockfile',
  defaultValue: undefined,
  negate: false,
  choices: undefined,
  required: false,
  optional: false,
  variadic: false,
  mandatory: false,
};

const PARENT_SYNC_CONFIG_OPT: OptionSnapshot = {
  flags: '--sync-config <path>',
  description: 'Path to .deepl-sync.yaml (default: auto-detect)',
  defaultValue: undefined,
  negate: false,
  choices: undefined,
  required: true,
  optional: false,
  variadic: false,
  mandatory: false,
};

const SYNC_CONFIG_OPT: OptionSnapshot = {
  flags: '--sync-config <path>',
  description: 'Path to .deepl-sync.yaml',
  defaultValue: undefined,
  negate: false,
  choices: undefined,
  required: true,
  optional: false,
  variadic: false,
  mandatory: false,
};

const LOCALE_FILTER_OPT: OptionSnapshot = {
  flags: '--locale <locales>',
  description: 'Filter by locale (comma-separated)',
  defaultValue: undefined,
  negate: false,
  choices: undefined,
  required: true,
  optional: false,
  variadic: false,
  mandatory: false,
};

const FORMAT_OPT: OptionSnapshot = {
  flags: '--format <format>',
  description: 'Output format',
  defaultValue: 'text',
  negate: false,
  choices: ['text', 'json'],
  required: true,
  optional: false,
  variadic: false,
  mandatory: false,
};

const EXPECTED: CommandSnapshot = {
  name: 'sync',
  description: 'Synchronize translation files using .deepl-sync.yaml config',
  options: ([
    {
      flags: '--auto-commit',
      description: 'Auto-commit translated files after sync',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--batch',
      description: 'Force batch mode (fastest, no context or instructions)',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--ci',
      description: 'Alias for --frozen',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--concurrency <number>',
      description: 'Max parallel locale translations (default: 5)',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: true,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--context',
      description: '',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--debounce <ms>',
      description: 'Debounce delay for watch mode (default: 500ms)',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: true,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    PARENT_DRY_RUN,
    {
      flags: '--flag-for-review',
      description: 'Mark translations as machine_translated in lock file for human review',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--force',
      description:
        'Retranslate all strings, ignoring the lock file. WARNING: also bypasses the sync.max_characters cost-cap preflight — this can rebill every translated key and incur unexpected API costs. Prefer --dry-run first to see the character estimate.',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    FORMAT_OPT,
    {
      flags: '--formality <level>',
      description: 'Override formality level',
      defaultValue: undefined,
      negate: false,
      choices: ['default', 'more', 'less', 'prefer_more', 'prefer_less', 'formal', 'informal'],
      required: true,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--frozen',
      description: 'Fail if any strings need translation (for CI)',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--glossary <name-or-id>',
      description: 'Override glossary for all buckets',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: true,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--locale <locales>',
      description: 'Limit to specific target locales (comma-separated)',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: true,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--model-type <type>',
      description: 'Override model type',
      defaultValue: undefined,
      negate: false,
      choices: ['quality_optimized', 'prefer_quality_optimized', 'latency_optimized'],
      required: true,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--no-batch',
      description:
        'Force per-key mode (slowest, individual context per key). Default: section-batched context',
      defaultValue: undefined,
      negate: true,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--no-context',
      description: '',
      defaultValue: undefined,
      negate: true,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--no-scan-context',
      description:
        'Disable source-code context scanning for this run. Overrides context.enabled only; other context.* settings in .deepl-sync.yaml are preserved.',
      defaultValue: undefined,
      negate: true,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '--scan-context',
      description: 'Scan source code for context (key paths, HTML element types)',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    PARENT_SYNC_CONFIG_OPT,
    {
      flags: '--watch',
      description: 'Watch source files and auto-sync on changes',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
    {
      flags: '-y, --yes',
      description: 'Skip --force confirmation prompt (required when CI=true)',
      defaultValue: undefined,
      negate: false,
      choices: undefined,
      required: false,
      optional: false,
      variadic: false,
      mandatory: false,
    },
  ] as OptionSnapshot[]).sort((a, b) => a.flags.localeCompare(b.flags)),
  subcommands: [
    {
      name: 'audit',
      description:
        'Analyze translation consistency and detect terminology inconsistencies',
      options: [FORMAT_OPT, SYNC_CONFIG_OPT].sort((a, b) =>
        a.flags.localeCompare(b.flags),
      ),
      subcommands: [],
    },
    {
      name: 'export',
      description: 'Export source strings to XLIFF for CAT tool handoff',
      options: [
        FORMAT_OPT,
        LOCALE_FILTER_OPT,
        {
          flags: '--output <path>',
          description: 'Write to file instead of stdout',
          defaultValue: undefined,
          negate: false,
          choices: undefined,
          required: true,
          optional: false,
          variadic: false,
          mandatory: false,
        },
        {
          flags: '--overwrite',
          description: 'Overwrite existing --output file',
          defaultValue: undefined,
          negate: false,
          choices: undefined,
          required: false,
          optional: false,
          variadic: false,
          mandatory: false,
        },
        SYNC_CONFIG_OPT,
      ].sort((a, b) => a.flags.localeCompare(b.flags)),
      subcommands: [],
    },
    {
      name: 'glossary-report',
      description: '',
      options: [],
      subcommands: [],
    },
    {
      name: 'init',
      description: 'Initialize .deepl-sync.yaml configuration',
      options: [
        FORMAT_OPT,
        {
          flags: '--file-format <type>',
          description: 'File format',
          defaultValue: undefined,
          negate: false,
          // Populated lazily by a preSubcommand hook so registration does not
          // load the format parsers; parity with the registry is covered by
          // sync-init-format-choices.integration.test.ts.
          choices: undefined,
          required: true,
          optional: false,
          variadic: false,
          mandatory: false,
        },
        {
          flags: '--path <pattern>',
          description: 'Source file pattern',
          defaultValue: undefined,
          negate: false,
          choices: undefined,
          required: true,
          optional: false,
          variadic: false,
          mandatory: false,
        },
        {
          flags: '--source-locale <code>',
          description: 'Source locale',
          defaultValue: undefined,
          negate: false,
          choices: undefined,
          required: true,
          optional: false,
          variadic: false,
          mandatory: false,
        },
        SYNC_CONFIG_OPT,
        {
          flags: '--target-locales <codes>',
          description: 'Target locales (comma-separated)',
          defaultValue: undefined,
          negate: false,
          choices: undefined,
          required: true,
          optional: false,
          variadic: false,
          mandatory: false,
        },
      ].sort((a, b) => a.flags.localeCompare(b.flags)),
      subcommands: [],
    },
    {
      name: 'pull',
      description: 'Pull approved translations from a TMS',
      options: [FORMAT_OPT, LOCALE_FILTER_OPT, SYNC_CONFIG_OPT].sort((a, b) =>
        a.flags.localeCompare(b.flags),
      ),
      subcommands: [],
    },
    {
      name: 'push',
      description: 'Push translations to a TMS for human review',
      options: [FORMAT_OPT, LOCALE_FILTER_OPT, SYNC_CONFIG_OPT].sort((a, b) =>
        a.flags.localeCompare(b.flags),
      ),
      subcommands: [],
    },
    {
      name: 'resolve',
      description: 'Resolve git merge conflicts in .deepl-sync.lock',
      options: [
        FORMAT_OPT,
        RESOLVE_DRY_RUN,
        SYNC_CONFIG_OPT,
      ].sort((a, b) => a.flags.localeCompare(b.flags)),
      subcommands: [],
    },
    {
      name: 'status',
      description: 'Show translation coverage status',
      options: [FORMAT_OPT, LOCALE_FILTER_OPT, SYNC_CONFIG_OPT].sort((a, b) =>
        a.flags.localeCompare(b.flags),
      ),
      subcommands: [],
    },
    {
      name: 'validate',
      description: 'Validate translations for quality issues',
      options: [FORMAT_OPT, LOCALE_FILTER_OPT, SYNC_CONFIG_OPT].sort((a, b) =>
        a.flags.localeCompare(b.flags),
      ),
      subcommands: [],
    },
  ],
};

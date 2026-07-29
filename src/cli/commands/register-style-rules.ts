import { Command, Option } from 'commander';
import chalk from 'chalk';
import { Logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import type { ConfiguredRules, CreateCustomInstructionOptions, UpdateCustomInstructionOptions } from '../../types/index.js';
import { createStyleRulesCommand, type CreateDeepLClient } from './service-factory.js';

/**
 * Parse `--rules` into the configured-rules dictionary the API expects:
 * a two-level object of category → setting → value.
 * Example: `--rules '{"punctuation":{"quotation_mark":"use_guillemets"}}'`
 */
function parseRulesArg(input: string): ConfiguredRules {
  const trimmed = input.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new ValidationError(`--rules JSON is malformed: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(
      '--rules must be a JSON object of category → settings, e.g. \'{"punctuation":{"quotation_mark":"use_guillemets"}}\'',
    );
  }

  const result: ConfiguredRules = {};
  for (const [category, settings] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      throw new ValidationError(
        `--rules category "${category}" must map to an object of setting → value`,
      );
    }
    const inner: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new ValidationError(
          `--rules setting "${category}.${key}" must be a string`,
        );
      }
      inner[key] = value;
    }
    result[category] = inner;
  }
  return result;
}

export function registerStyleRules(
  program: Command,
  deps: {
    createDeepLClient: CreateDeepLClient;
    handleError: (error: unknown) => never;
  },
): void {
  const { createDeepLClient, handleError } = deps;

  program
    .command('style-rules')
    .description('Manage DeepL style rules (Pro API only)')
    .addHelpText('after', `
Examples:
  $ deepl style-rules list
  $ deepl style-rules list --detailed
  $ deepl style-rules list --format json
  $ deepl style-rules list --format table
  $ deepl style-rules list --page 2 --page-size 10
  $ deepl style-rules create --name "Corporate" --language en
  $ deepl style-rules show sr-abc123 --detailed
  $ deepl style-rules update sr-abc123 --name "Renamed"
  $ deepl style-rules update sr-abc123 --rules '{"punctuation":{"quotation_mark":"use_guillemets"}}'
  $ deepl style-rules delete sr-abc123 --yes
  $ deepl style-rules instructions sr-abc123
  $ deepl style-rules add-instruction sr-abc123 tone "Be formal"
  $ deepl style-rules update-instruction sr-abc123 tone "Be friendlier"
  $ deepl style-rules remove-instruction sr-abc123 tone --yes
`)
    .addCommand(
      new Command('list')
        .description('List all style rules')
        .option('--detailed', 'Show detailed information including configured rules and custom instructions')
        .option('--page <number>', 'Page number for pagination', parseInt)
        .option('--page-size <number>', 'Number of results per page (1-25)', parseInt)
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json', 'table']).default('text'))
        .action(async (options: {
          detailed?: boolean;
          page?: number;
          pageSize?: number;
          format?: string;
        }) => {
          try {
            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);

            const rules = await styleRulesCommand.list({
              detailed: options.detailed,
              page: options.page,
              pageSize: options.pageSize,
            });

            if (options.format === 'json') {
              Logger.output(styleRulesCommand.formatStyleRulesJson(rules));
            } else if (options.format === 'table') {
              if (!process.stdout.isTTY) {
                Logger.warn('WARN  --format table is not supported in non-TTY output; falling back to plain text');
                Logger.output(styleRulesCommand.formatStyleRulesList(rules));
              } else {
                Logger.output(styleRulesCommand.formatStyleRulesTable(rules));
              }
            } else {
              Logger.output(styleRulesCommand.formatStyleRulesList(rules));
            }
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('create')
        .description('Create a new style rule list')
        .requiredOption('--name <name>', 'Style rule list name')
        .requiredOption('--language <lang>', 'Target language (e.g. en, de, es)')
        .option('--rules <json>', 'Configured rules as a JSON object of category → settings (e.g. \'{"punctuation":{"quotation_mark":"use_guillemets"}}\')')
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
        .action(async (options: {
          name: string;
          language: string;
          rules?: string;
          format?: string;
        }) => {
          try {
            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);

            const createOpts: { name: string; language: string; configuredRules?: ConfiguredRules } = {
              name: options.name,
              language: options.language,
            };
            if (options.rules !== undefined) {
              createOpts.configuredRules = parseRulesArg(options.rules);
            }

            const rule = await styleRulesCommand.create(createOpts);
            if (options.format === 'json') {
              Logger.output(styleRulesCommand.formatStyleRuleJson(rule));
            } else {
              Logger.success(chalk.green(`\u2713 Style rule created: ${rule.styleId}`));
              Logger.output(styleRulesCommand.formatStyleRule(rule));
            }
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('show')
        .description('Show a single style rule list')
        .argument('<id>', 'Style rule ID')
        .option('--detailed', 'Include configured rules and custom instructions')
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
        .action(async (id: string, options: { detailed?: boolean; format?: string }) => {
          try {
            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);

            const rule = await styleRulesCommand.show(id, options.detailed ?? false);
            if (options.format === 'json') {
              Logger.output(styleRulesCommand.formatStyleRuleJson(rule));
            } else {
              Logger.output(styleRulesCommand.formatStyleRule(rule));
            }
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('update')
        .description('Update a style rule list (rename and/or replace configured rules)')
        .argument('<id>', 'Style rule ID')
        .option('--name <name>', 'New name')
        .option('--rules <json>', 'Replace configured rules with a JSON object of category → settings')
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
        .action(async (id: string, options: { name?: string; rules?: string; format?: string }) => {
          try {
            if (options.name === undefined && options.rules === undefined) {
              throw new ValidationError('Specify at least one of --name or --rules');
            }

            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);

            if (options.name !== undefined) {
              await styleRulesCommand.update(id, { name: options.name });
            }

            let finalRule;
            if (options.rules !== undefined) {
              finalRule = await styleRulesCommand.replaceRules(id, parseRulesArg(options.rules));
            } else {
              finalRule = await styleRulesCommand.show(id);
            }

            if (options.format === 'json') {
              Logger.output(styleRulesCommand.formatStyleRuleJson(finalRule));
            } else {
              Logger.success(chalk.green(`\u2713 Style rule updated: ${id}`));
              Logger.output(styleRulesCommand.formatStyleRule(finalRule));
            }
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('delete')
        .description('Delete a style rule list')
        .argument('<id>', 'Style rule ID')
        .option('-y, --yes', 'Skip confirmation prompt')
        .option('--dry-run', 'Show what would be deleted without performing the operation')
        .action(async (id: string, options: { yes?: boolean; dryRun?: boolean }) => {
          try {
            if (options.dryRun) {
              Logger.output(chalk.yellow(`[dry-run] No deletions will be performed.`));
              Logger.output(chalk.yellow(`[dry-run] Would delete style rule: "${id}"`));
              return;
            }

            if (!options.yes) {
              const { confirm } = await import('../../utils/confirm.js');
              const confirmed = await confirm({ message: `Delete style rule "${id}"?` });
              if (!confirmed) {
                Logger.info('Aborted.');
                return;
              }
            }

            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);
            await styleRulesCommand.delete(id);
            Logger.success(chalk.green(`\u2713 Style rule deleted: ${id}`));
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('instructions')
        .description('List custom instructions for a style rule')
        .argument('<style-id>', 'Style rule ID')
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json', 'table']).default('text'))
        .action(async (styleId: string, options: { format?: string }) => {
          try {
            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);
            const instructions = await styleRulesCommand.listInstructions(styleId);
            if (options.format === 'json') {
              Logger.output(styleRulesCommand.formatCustomInstructionJson(instructions));
            } else if (options.format === 'table') {
              if (!process.stdout.isTTY) {
                Logger.warn('WARN  --format table is not supported in non-TTY output; falling back to plain text');
                Logger.output(styleRulesCommand.formatCustomInstructionsList(instructions));
              } else {
                Logger.output(styleRulesCommand.formatCustomInstructionsTable(instructions));
              }
            } else {
              Logger.output(styleRulesCommand.formatCustomInstructionsList(instructions));
            }
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('add-instruction')
        .description('Add a custom instruction to a style rule')
        .argument('<style-id>', 'Style rule ID')
        .argument('<label>', 'Instruction label (unique within the style rule)')
        .argument('<prompt>', 'Instruction prompt text')
        .option('--source-language <lang>', 'Source language code (optional)')
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
        .action(async (
          styleId: string,
          label: string,
          prompt: string,
          options: { sourceLanguage?: string; format?: string },
        ) => {
          try {
            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);
            const createOpts: CreateCustomInstructionOptions = { label, prompt };
            if (options.sourceLanguage !== undefined) {
              createOpts.sourceLanguage = options.sourceLanguage;
            }
            const instruction = await styleRulesCommand.addInstruction(styleId, createOpts);
            if (options.format === 'json') {
              Logger.output(styleRulesCommand.formatCustomInstructionJson(instruction));
            } else {
              Logger.success(chalk.green(`\u2713 Instruction added: ${instruction.label}`));
              Logger.output(styleRulesCommand.formatCustomInstruction(instruction));
            }
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('update-instruction')
        .description('Update a custom instruction on a style rule')
        .argument('<style-id>', 'Style rule ID')
        .argument('<label>', 'Instruction label')
        .argument('<prompt>', 'New instruction prompt text')
        .option('--source-language <lang>', 'Source language code (optional)')
        .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
        .action(async (
          styleId: string,
          label: string,
          prompt: string,
          options: { sourceLanguage?: string; format?: string },
        ) => {
          try {
            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);
            const updateOpts: UpdateCustomInstructionOptions = { prompt };
            if (options.sourceLanguage !== undefined) {
              updateOpts.sourceLanguage = options.sourceLanguage;
            }
            const instruction = await styleRulesCommand.updateInstruction(styleId, label, updateOpts);
            if (options.format === 'json') {
              Logger.output(styleRulesCommand.formatCustomInstructionJson(instruction));
            } else {
              Logger.success(chalk.green(`\u2713 Instruction updated: ${instruction.label}`));
              Logger.output(styleRulesCommand.formatCustomInstruction(instruction));
            }
          } catch (error) {
            handleError(error);
          }
        })
    )
    .addCommand(
      new Command('remove-instruction')
        .description('Remove a custom instruction from a style rule')
        .argument('<style-id>', 'Style rule ID')
        .argument('<label>', 'Instruction label')
        .option('-y, --yes', 'Skip confirmation prompt')
        .option('--dry-run', 'Show what would be removed without performing the operation')
        .action(async (
          styleId: string,
          label: string,
          options: { yes?: boolean; dryRun?: boolean },
        ) => {
          try {
            if (options.dryRun) {
              Logger.output(chalk.yellow(`[dry-run] No removals will be performed.`));
              Logger.output(chalk.yellow(`[dry-run] Would remove instruction "${label}" from style rule "${styleId}"`));
              return;
            }

            if (!options.yes) {
              const { confirm } = await import('../../utils/confirm.js');
              const confirmed = await confirm({ message: `Remove instruction "${label}" from style rule "${styleId}"?` });
              if (!confirmed) {
                Logger.info('Aborted.');
                return;
              }
            }

            const styleRulesCommand = await createStyleRulesCommand(createDeepLClient);
            await styleRulesCommand.removeInstruction(styleId, label);
            Logger.success(chalk.green(`\u2713 Instruction removed: ${label}`));
          } catch (error) {
            handleError(error);
          }
        })
    );
}

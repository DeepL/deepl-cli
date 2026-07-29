import { type Command, Option } from 'commander';
import { existsSync } from 'fs';
import { atomicWriteFile } from '../../utils/atomic-write.js';
import chalk from 'chalk';
import type { WriteLanguage, WritingStyle, WriteTone } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';
import { ExitCode } from '../../utils/exit-codes.js';
import { isNoInput } from '../../utils/confirm.js';
import { ValidationError } from '../../utils/errors.js';
import { createWriteCommand, type ServiceDeps } from './service-factory.js';

const WRITE_LANGUAGES = ['de', 'en', 'en-GB', 'en-US', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'pt-BR', 'pt-PT', 'zh', 'zh-Hans'] as const;
const WRITE_STYLES = ['default', 'simple', 'business', 'academic', 'casual', 'prefer_simple', 'prefer_business', 'prefer_academic', 'prefer_casual'] as const;
const WRITE_TONES = ['default', 'enthusiastic', 'friendly', 'confident', 'diplomatic', 'prefer_enthusiastic', 'prefer_friendly', 'prefer_confident', 'prefer_diplomatic'] as const;

export function registerWrite(
  program: Command,
  deps: Pick<ServiceDeps, 'createDeepLClient' | 'getConfigService' | 'getCacheService' | 'handleError'>,
): void {
  const { handleError } = deps;

  program
    .command('write')
    .alias('w')
    .description('Improve text using DeepL Write API (grammar, style, tone)')
    .argument('[text]', 'Text to improve, file path, or read from stdin')
    .optionsGroup('Core Options:')
    .option('-l, --lang <language>', `Target language: ${WRITE_LANGUAGES.join(', ')} (auto-detect if omitted)`)
    .option('--to <language>', 'Alias of --lang — accepts the same language values. Provided for muscle-memory consistency with `deepl translate --to`.')
    .option('--style <style>', `Writing style: ${WRITE_STYLES.join(', ')}`)
    .option('--tone <tone>', `Tone: ${WRITE_TONES.join(', ')}`)
    .optionsGroup('Output Modes:')
    .option('-a, --alternatives', 'Show all alternative improvements')
    .option('-o, --output <file>', 'Write improved text to file')
    .option('--in-place', 'Edit file in place (use with file input)')
    .option('-i, --interactive', 'Interactive mode - choose from multiple suggestions')
    .option('-d, --diff', 'Show diff between original and improved text')
    .optionsGroup('Fix Operations:')
    .option('--check', 'Check if text needs improvement (exit 0 if clean, exit 8 if changes needed)')
    .option('--fix', 'Automatically fix file in place')
    .option('-b, --backup', 'Create backup file before fixing (use with --fix)')
    .optionsGroup('Advanced:')
    .option('--no-cache', 'Bypass cache for this request')
    .optionsGroup('Output:')
    .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
    .addHelpText('after', `
Examples:
  $ deepl write "Their going to the store" --lang en-US
  $ deepl write "Their going to the store" --to en-US      (--to is an alias of --lang)
  $ deepl write report.txt --check
  $ deepl write essay.md --fix --backup
  $ deepl write "Make this formal" --style business --lang en
  $ deepl write "Great news!" --tone diplomatic --lang en
  $ deepl write document.txt --diff
  $ deepl write article.md --interactive
  $ deepl write "Hello world" --alternatives
  $ deepl write report.txt --output improved.txt
  $ deepl write "Text here" --format json
`)
    .action(async (text: string | undefined, options: {
      lang?: string;
      to?: string;
      style?: string;
      tone?: string;
      alternatives?: boolean;
      output?: string;
      inPlace?: boolean;
      interactive?: boolean;
      diff?: boolean;
      check?: boolean;
      fix?: boolean;
      backup?: boolean;
      format?: string;
      cache?: boolean;
    }) => {
      try {
        if (options.to !== undefined && options.lang !== undefined && options.to !== options.lang) {
          throw new ValidationError(
            'Cannot specify both --to and --lang with different values. --to is an alias of --lang; pick one.',
          );
        }
        if (options.to !== undefined && options.lang === undefined) {
          options.lang = options.to;
        }

        if (!text) {
          const { readStdin } = await import('../../utils/read-stdin.js');
          const stdinText = await readStdin();
          if (!stdinText || stdinText.trim() === '') {
            throw new ValidationError('No input provided. Provide text as an argument, a file path, or pipe via stdin.');
          }
          text = stdinText;
        }

        if (options.lang && !(WRITE_LANGUAGES as readonly string[]).includes(options.lang)) {
          throw new ValidationError(`Invalid language code: ${options.lang}. Valid options: ${WRITE_LANGUAGES.join(', ')}`);
        }

        if (options.style && !(WRITE_STYLES as readonly string[]).includes(options.style)) {
          throw new ValidationError(`Invalid writing style: ${options.style}. Valid options: ${WRITE_STYLES.join(', ')}`);
        }

        if (options.tone && !(WRITE_TONES as readonly string[]).includes(options.tone)) {
          throw new ValidationError(`Invalid tone: ${options.tone}. Valid options: ${WRITE_TONES.join(', ')}`);
        }

        if (options.style && options.tone) {
          throw new ValidationError('Cannot specify both --style and --tone. Use one or the other.');
        }

        if (options.interactive && (isNoInput() || !process.stdin.isTTY)) {
          throw new ValidationError('--interactive requires an interactive terminal. Run without --interactive in CI or non-TTY environments, or pipe input via stdin.');
        }

        if (options.backup && !options.fix) {
          Logger.warn('--backup has no effect without --fix');
        }

        const writeCommand = await createWriteCommand(deps);

        const writeOptions = {
          lang: options.lang as WriteLanguage | undefined,
          style: options.style as WritingStyle | undefined,
          tone: options.tone as WriteTone | undefined,
          showAlternatives: options.alternatives,
          outputFile: options.output,
          inPlace: options.inPlace,
          createBackup: options.backup,
          format: options.format,
          noCache: options.cache === false,
        };

        if (options.check) {
          let needsImprovement: boolean;
          let changes = 0;

          if (existsSync(text)) {
            const result = await writeCommand.checkFile(text, writeOptions);
            needsImprovement = result.needsImprovement;
            changes = result.changes;
            Logger.info(chalk.gray(`File: ${text}`));
          } else {
            const result = await writeCommand.checkText(text, writeOptions);
            needsImprovement = result.needsImprovement;
            changes = result.changes;
          }

          if (needsImprovement) {
            Logger.warn(chalk.yellow(`\u26a0 Text needs improvement (${changes} potential changes)`));
            process.exitCode = ExitCode.CheckFailed;
          } else {
            Logger.success(chalk.green('\u2713 Text looks good'));
          }
          return;
        }

        if (options.fix) {
          if (!existsSync(text)) {
            throw new ValidationError('--fix requires a file path as input');
          }

          const result = await writeCommand.autoFixFile(text, writeOptions);

          if (result.fixed) {
            Logger.success(chalk.green('\u2713 File improved'));
            if (result.backupPath) {
              Logger.info(chalk.gray(`Backup: ${result.backupPath}`));
            }
            Logger.info(chalk.gray(`Changes: ${result.changes}`));
          } else {
            Logger.success(chalk.green('\u2713 No improvements needed'));
          }
          return;
        }

        if (options.diff) {
          let result: { original: string; improved: string; diff: string };

          if (existsSync(text)) {
            result = await writeCommand.improveFileWithDiff(text, writeOptions);
          } else {
            result = await writeCommand.improveWithDiff(text, writeOptions);
          }

          Logger.output(chalk.bold('Original:'));
          Logger.output(result.original);
          Logger.output();
          Logger.output(chalk.bold('Improved:'));
          Logger.output(result.improved);
          Logger.output();
          Logger.output(chalk.bold('Diff:'));
          Logger.output(result.diff);
          return;
        }

        if (options.interactive) {
          let result: string;

          if (existsSync(text)) {
            const interactiveResult = await writeCommand.improveFileInteractive(text, writeOptions);
            result = interactiveResult.selected;


            if (options.output || options.inPlace) {
              const outputPath = options.inPlace ? text : options.output!;
              await atomicWriteFile(outputPath, result, 'utf-8');
              Logger.success(chalk.green(`\u2713 Saved to ${outputPath}`));
            }
          } else {
            result = await writeCommand.improveInteractive(text, writeOptions);
          }

          Logger.output();
          Logger.output(chalk.bold('Selected improvement:'));
          Logger.output(result);
          return;
        }

        if (existsSync(text)) {
          const result = await writeCommand.improveFile(text, writeOptions);
          Logger.output(result);
          return;
        }

        const result = await writeCommand.improve(text, writeOptions);
        if (options.output) {
          await atomicWriteFile(options.output, result, 'utf-8');
          Logger.success(chalk.green(`\u2713 Saved to ${options.output}`));
        }
        Logger.output(result);
      } catch (error) {
        handleError(error);
      }
    });
}

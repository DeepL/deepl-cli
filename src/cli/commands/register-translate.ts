import * as fs from 'fs';
import { Command, Option } from 'commander';
import chalk from 'chalk';
import { Logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { createTranslateCommand, type ServiceDeps } from './service-factory.js';

export function registerTranslate(
  program: Command,
  deps: ServiceDeps,
): void {
  const { handleError } = deps;

  program
    .command('translate')
    .alias('t')
    .description('Translate text, files, or directories using DeepL API')
    .argument('[text]', 'Text, file path, or directory to translate (or read from stdin)')
    .optionsGroup('Core Options:')
    .option('-t, --to <language>', 'Target language(s), comma-separated for multiple (uses config default if omitted)')
    .option('-f, --from <language>', 'Source language (auto-detect if not specified)')
    .option('-o, --output <path>', 'Output file path or directory (required for file/directory translation)')
    .optionsGroup('Translation Quality:')
    .addOption(new Option('--formality <level>', 'Formality level (formal/informal are aliases for more/less)').choices(['default', 'more', 'less', 'prefer_more', 'prefer_less', 'formal', 'informal']))
    .option('--context <text>', 'Additional context to improve translation quality')
    .option('--glossary <name-or-id>', 'Use glossary by name or ID')
    .option(
      '--translation-memory <name-or-uuid>',
      'Use translation memory by name or UUID (forces quality_optimized model). Run "deepl tm list" to see available TMs.',
    )
    .option(
      '--tm-threshold <n>',
      'Minimum match score 0\u2013100 (default 75, requires --translation-memory)',
      (raw: string) => {
        if (!/^-?\d+$/.test(raw)) {
          throw new ValidationError(
            `--tm-threshold must be an integer, got: ${raw}`,
            'Example: --tm-threshold 80',
          );
        }
        return parseInt(raw, 10);
      },
    )
    .option('--custom-instruction <instruction>', 'Custom instruction for translation (repeatable, max 10, max 300 chars each)', (val: string, prev: string[]) => prev.concat([val]), [] as string[])
    .option('--style-id <uuid>', 'Style rule ID for translation (Pro API only, forces quality_optimized model)')
    .addOption(new Option('--model-type <type>', 'Model type').choices(['quality_optimized', 'prefer_quality_optimized', 'latency_optimized']))
    .optionsGroup('Preservation:')
    .option('--preserve-code', 'Preserve code blocks and variables during translation')
    .option('--preserve-formatting', 'Preserve line breaks and whitespace formatting')
    .addOption(new Option('--split-sentences <mode>', 'Sentence splitting (default: on)').choices(['on', 'off', 'nonewlines']))
    .optionsGroup('Document Options:')
    .addOption(new Option('--output-format <format>', 'Convert PDF to DOCX during translation (only supported conversion)').choices(['docx']))
    .option('--enable-minification', 'Enable document minification (PPTX/DOCX only, reduces file size)')
    .optionsGroup('XML/HTML Options:')
    .addOption(new Option('--tag-handling <mode>', 'Tag handling for XML/HTML').choices(['xml', 'html']))
    .addOption(new Option('--tag-handling-version <version>', 'Tag handling version (v2 improves structure handling, requires --tag-handling)').choices(['v1', 'v2']))
    .option('--outline-detection <bool>', 'Control automatic XML structure detection (true/false, default: true, requires --tag-handling xml)')
    .option('--splitting-tags <tags>', 'Comma-separated XML tags that split sentences (requires --tag-handling xml)')
    .option('--non-splitting-tags <tags>', 'Comma-separated XML tags that should not be used to split sentences (requires --tag-handling xml)')
    .option('--ignore-tags <tags>', 'Comma-separated XML tags with content to ignore (requires --tag-handling xml)')
    .optionsGroup('File/Directory Options:')
    .option('--no-recursive', 'Do not recurse into subdirectories')
    .option('--pattern <pattern>', 'Glob pattern for file filtering (e.g., "*.md")')
    .option('--concurrency <number>', 'Number of parallel translations (default: 5)', parseInt)
    .option('--dry-run', 'Show what would be translated without performing the operation')
    .optionsGroup('Output & Display:')
    .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json', 'table']).default('text'))
    .option('--show-billed-characters', 'Request and display actual billed character count for cost transparency')
    .optionsGroup('Advanced:')
    .option('--enable-beta-languages', 'Include beta languages that are not yet stable (forward-compatibility)')
    .option('--no-cache', 'Bypass cache for this translation (useful for testing)')
    .option('--api-url <url>', 'Custom API endpoint (e.g., https://api-free.deepl.com/v2 or internal test URLs)')
    .addHelpText('after', `
Examples:
  $ deepl translate "Hello world" --to es
  $ deepl translate README.md --to fr --output README.fr.md
  $ deepl translate ./docs --to de,es,fr --pattern "*.md"
  $ echo "Hello" | deepl translate --to ja
  $ deepl translate report.pdf --to de --output-format docx
  $ deepl translate "Hello" --to es --formality more --glossary my-glossary
  $ deepl translate page.html --to fr --tag-handling html
  $ deepl translate "Hello" --to es --custom-instruction "Use informal language"
  $ deepl translate ./docs --to es --dry-run
`)
    .action(async (text: string | undefined, options: {
      to?: string;
      from?: string;
      output?: string;
      formality?: string;
      outputFormat?: string;
      preserveCode?: boolean;
      preserveFormatting?: boolean;
      context?: string;
      splitSentences?: string;
      tagHandling?: string;
      modelType?: string;
      showBilledCharacters?: boolean;
      enableMinification?: boolean;
      outlineDetection?: string;
      splittingTags?: string;
      nonSplittingTags?: string;
      ignoreTags?: string;
      tagHandlingVersion?: string;
      recursive?: boolean;
      pattern?: string;
      concurrency?: number;
      glossary?: string;
      translationMemory?: string;
      tmThreshold?: number;
      customInstruction?: string[];
      styleId?: string;
      enableBetaLanguages?: boolean;
      format?: string;
      apiUrl?: string;
      dryRun?: boolean;
    }) => {
      try {
        if (!options.to) {
          const configService = deps.getConfigService();
          const targetLangs = configService.getValue<string[]>('defaults.targetLangs');
          if (targetLangs && targetLangs.length > 0) {
            options.to = targetLangs[0];
          } else {
            throw new ValidationError(
              'No target language specified.',
              'Use --to <lang>:   deepl translate "Hello" --to de\n  Set a default:     deepl init',
            );
          }
        }

        if (options.tmThreshold !== undefined && !options.translationMemory) {
          throw new ValidationError(
            '--tm-threshold requires --translation-memory',
            'Example: --translation-memory my-tm --tm-threshold 80',
          );
        }
        if (options.tmThreshold !== undefined) {
          const n = options.tmThreshold;
          if (n < 0 || n > 100) {
            throw new ValidationError(
              `--tm-threshold must be an integer between 0 and 100, got: ${n}`,
              'Use a value between 0 and 100, or omit --tm-threshold to use the default (75).',
            );
          }
        }
        if (
          options.translationMemory &&
          options.modelType &&
          options.modelType !== 'quality_optimized'
        ) {
          throw new ValidationError(
            '--translation-memory requires quality_optimized model type',
            'Remove --model-type or set --model-type quality_optimized',
          );
        }

        if (options.dryRun) {
          const targetLangs = options.to!.split(',').map(l => l.trim());
          const lines: string[] = [
            chalk.yellow('[dry-run] No translations will be performed.'),
          ];

          if (text) {
            const isDir = fs.existsSync(text) && fs.statSync(text).isDirectory();
            const isFile = !isDir && fs.existsSync(text) && fs.statSync(text).isFile();

            if (isDir) {
              lines.push(chalk.yellow(`[dry-run] Would translate directory: ${text}`));
              lines.push(chalk.yellow(`[dry-run] Output directory: ${options.output ?? '<required>'}`));
              if (options.pattern) {
                lines.push(chalk.yellow(`[dry-run] File pattern: ${options.pattern}`));
              }
              lines.push(chalk.yellow(`[dry-run] Recursive: ${options.recursive !== false}`));
            } else if (isFile) {
              lines.push(chalk.yellow(`[dry-run] Would translate file: ${text}`));
              lines.push(chalk.yellow(`[dry-run] Output: ${options.output ?? '<stdout>'}`));
            } else {
              lines.push(chalk.yellow(`[dry-run] Would translate text: "${text.length > 80 ? text.substring(0, 80) + '...' : text}"`));
            }
          } else {
            lines.push(chalk.yellow(`[dry-run] Would translate text from stdin`));
          }

          lines.push(chalk.yellow(`[dry-run] Target language(s): ${targetLangs.join(', ')}`));
          if (options.from) {
            lines.push(chalk.yellow(`[dry-run] Source language: ${options.from}`));
          }
          if (options.glossary) {
            lines.push(chalk.yellow(`[dry-run] Glossary: ${options.glossary}`));
          }
          if (options.translationMemory) {
            lines.push(chalk.yellow(`[dry-run] Translation memory: ${options.translationMemory}`));
            lines.push(chalk.yellow(`[dry-run] Match threshold: ${options.tmThreshold ?? 75}`));
            lines.push(chalk.yellow(`[dry-run] Model: quality_optimized (forced by --translation-memory)`));
          }
          if (options.formality) {
            lines.push(chalk.yellow(`[dry-run] Formality: ${options.formality}`));
          }

          Logger.output(lines.join('\n'));
          return;
        }

        const translateCommand = await createTranslateCommand(deps, options.apiUrl);

        let result: string;

        if (text !== undefined) {
          result = await translateCommand.translate(text, options as { to: string } & typeof options);
        } else {
          result = await translateCommand.translateFromStdin(options as { to: string } & typeof options);
        }

        Logger.output(result);
      } catch (error) {
        handleError(error);
      }
    });
}

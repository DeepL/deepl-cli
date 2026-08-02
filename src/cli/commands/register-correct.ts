import { type Command, Option } from 'commander';
import { createWriteAction, WRITE_LANGUAGES, type WriteDeps } from './register-write.js';

export function registerCorrect(
  program: Command,
  deps: WriteDeps,
): void {
  program
    .command('correct')
    .alias('c')
    .description('Correct spelling and grammar using DeepL Write API (no rewording)')
    .argument('[text]', 'Text to correct, file path, or read from stdin')
    .optionsGroup('Core Options:')
    .option('-l, --lang <language>', `Target language: ${WRITE_LANGUAGES.join(', ')} (auto-detect if omitted)`)
    .option('--to <language>', 'Alias of --lang — accepts the same language values. Provided for muscle-memory consistency with `deepl translate --to`.')
    .optionsGroup('Output Modes:')
    .option('-a, --alternatives', 'Show all alternative corrections')
    .option('-o, --output <file>', 'Write corrected text to file')
    .option('--in-place', 'Edit file in place (use with file input)')
    .option('-i, --interactive', 'Interactive mode - review the correction before accepting')
    .option('-d, --diff', 'Show diff between original and corrected text')
    .optionsGroup('Fix Operations:')
    .option('--check', 'Check if text needs correction (exit 0 if clean, exit 8 if corrections needed)')
    .option('--fix', 'Automatically fix file in place')
    .option('-b, --backup', 'Create backup file before fixing (use with --fix)')
    .optionsGroup('Advanced:')
    .option('--no-cache', 'Bypass cache for this request')
    .optionsGroup('Output:')
    .addOption(new Option('--format <format>', 'Output format').choices(['text', 'json']).default('text'))
    .addHelpText('after', `
Unlike \`deepl write\`, which may reword text for style, \`correct\` fixes
spelling and grammar only and leaves the wording alone.

Examples:
  $ deepl correct "This is an test."
  $ deepl correct "Their going to the store" --lang en-US
  $ deepl correct README.md --check
  $ deepl correct essay.md --fix --backup
  $ deepl correct document.txt --diff
  $ deepl correct report.txt --output corrected.txt
  $ cat notes.txt | deepl correct
  $ deepl c "quick proofread"                               (c is an alias of correct)
`)
    .action(createWriteAction(deps, 'correct'));
}

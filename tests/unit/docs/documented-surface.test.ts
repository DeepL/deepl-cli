/**
 * Checks every `deepl …` invocation in the user-facing docs against the CLI's
 * real surface, reported by the hidden `_describe` command, so a documented
 * command or flag that stops existing fails here rather than reaching a reader.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DescribedCommand {
  name: string;
  aliases: string[];
  options: { flags: string }[];
  commands: DescribedCommand[];
}

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI_ENTRY = path.join(ROOT, 'dist', 'cli', 'index.js');
const DOCS = ['README.md', 'docs/API.md', 'docs/SYNC.md', 'docs/TROUBLESHOOTING.md'];

/** Deliberate misspellings used to demonstrate did-you-mean suggestions. */
const TYPO_EXAMPLES = new Set(['transalte', 'translte', 'glossry', 'conifg', 'descibe']);

function longFlags(options: { flags: string }[]): string[] {
  return options.flatMap((option) => option.flags.match(/--[a-z0-9-]+/g) ?? []);
}

function describeSurface(): DescribedCommand {
  const raw = execFileSync(process.execPath, [CLI_ENTRY, '_describe', '--format', 'json'], {
    encoding: 'utf-8',
  });
  return JSON.parse(raw) as DescribedCommand;
}

describe('documented CLI surface', () => {
  let surface: DescribedCommand;
  let globalFlags: Set<string>;

  beforeAll(() => {
    surface = describeSurface();
    globalFlags = new Set([...longFlags(surface.options), '--help', '--version']);
  });

  function resolveCommand(tokens: string[]): DescribedCommand | undefined {
    let current: DescribedCommand | undefined = surface;
    for (const token of tokens) {
      current = current?.commands.find(
        (candidate) => candidate.name === token || candidate.aliases.includes(token),
      );
      if (!current) return undefined;
    }
    return current;
  }

  /** Command tokens are the words before the first flag or shell operator. */
  function commandTokens(invocation: string): string[] {
    const tokens: string[] = [];
    for (const token of invocation.split(/\s+/)) {
      if (token.startsWith('-') || /^[|&><$"'`]/.test(token)) break;
      tokens.push(token);
    }
    return tokens;
  }

  function invocations(markdown: string): string[] {
    return markdown
      .split('\n')
      .map((line) => line.replace(/^\s*[$>]\s*/, '').trim())
      .filter((line) => line.startsWith('deepl '))
      .map((line) => line.slice('deepl '.length));
  }

  describe.each(DOCS)('%s', (docPath) => {
    let documented: string[];

    beforeAll(() => {
      documented = invocations(fs.readFileSync(path.join(ROOT, docPath), 'utf-8'));
    });

    it('documents at least one invocation', () => {
      expect(documented.length).toBeGreaterThan(0);
    });

    it('references only commands the CLI provides', () => {
      const unknown = documented.filter((invocation) => {
        const tokens = commandTokens(invocation);
        if (tokens.length === 0 || TYPO_EXAMPLES.has(tokens[0]!)) return false;
        return resolveCommand(tokens) === undefined && resolveCommand([tokens[0]!]) === undefined;
      });

      expect(unknown).toEqual([]);
    });

    it('references only flags the CLI accepts', () => {
      const unknown: string[] = [];

      for (const invocation of documented) {
        const tokens = commandTokens(invocation);
        if (tokens.length === 0 || TYPO_EXAMPLES.has(tokens[0]!)) continue;

        const command = resolveCommand(tokens) ?? resolveCommand([tokens[0]!]);
        if (!command) continue;

        const accepted = new Set([...longFlags(command.options), ...globalFlags]);
        // A flag may belong to a subcommand named after the first flag-free
        // tokens, so accept anything the parent chain declares too.
        for (let depth = 1; depth < tokens.length; depth++) {
          const ancestor = resolveCommand(tokens.slice(0, depth));
          if (ancestor) longFlags(ancestor.options).forEach((flag) => accepted.add(flag));
        }

        for (const flag of invocation.match(/--[a-z0-9-]+/g) ?? []) {
          if (!accepted.has(flag)) {
            unknown.push(`${invocation}  ->  ${flag}`);
          }
        }
      }

      expect(unknown).toEqual([]);
    });
  });
});

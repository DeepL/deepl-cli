import { Command } from 'commander';
import { CompletionCommand } from '../../src/cli/commands/completion';

describe('CompletionCommand', () => {
  let program: Command;
  let completionCommand: CompletionCommand;

  beforeEach(() => {
    program = new Command();
    program
      .name('deepl')
      .description('DeepL CLI')
      .version('1.0.0')
      .option('-q, --quiet', 'Suppress output')
      .option('-c, --config <file>', 'Config file');

    program
      .command('translate')
      .alias('t')
      .description('Translate text or files')
      .option('-t, --to <lang>', 'Target language')
      .option('-f, --from <lang>', 'Source language');

    const authCmd = program
      .command('auth')
      .description('Manage authentication');
    authCmd
      .command('set-key')
      .description('Set API key');
    authCmd
      .command('show')
      .description('Show current API key');
    authCmd
      .command('clear')
      .description('Remove API key');

    const cacheCmd = program
      .command('cache')
      .description('Manage cache');
    cacheCmd
      .command('stats')
      .description('Show cache statistics');
    cacheCmd
      .command('clear')
      .description('Clear cached translations');

    completionCommand = new CompletionCommand(program);
  });

  describe('generate()', () => {
    it('should generate bash completion script', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('_deepl_completions');
      expect(script).toContain('complete -F _deepl_completions deepl');
    });

    it('should generate zsh completion script', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('#compdef deepl');
      expect(script).toContain('_deepl');
    });

    it('should generate fish completion script', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain('complete -c deepl');
    });
  });

  describe('bash completion', () => {
    it('should include top-level commands', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('translate');
      expect(script).toContain('auth');
      expect(script).toContain('cache');
    });

    it('should include global options', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('--quiet');
      expect(script).toContain('--config');
    });

    it('should include --help and --version in top-level completions', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('--help');
      expect(script).toContain('--version');
    });

    it('should include subcommands for auth', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('auth)');
      expect(script).toContain('set-key');
      expect(script).toContain('show');
    });

    it('should include subcommands for cache', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('cache)');
      expect(script).toContain('stats');
    });

    it('should include installation instructions', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('bash_completion');
      expect(script).toContain('source');
    });

    it('should use compgen for word matching', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('compgen -W');
      expect(script).toContain('COMPREPLY');
    });

    it('should handle top-level completion at cword 1', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('cword} -eq 1');
    });
  });

  describe('zsh completion', () => {
    it('should include #compdef directive', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('#compdef deepl');
    });

    it('should include top-level commands with descriptions', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('translate:Translate text or files');
      expect(script).toContain('auth:Manage authentication');
      expect(script).toContain('cache:Manage cache');
    });

    it('should include global options with descriptions', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('--quiet:Suppress output');
      expect(script).toContain('--config:Config file');
    });

    it('should include subcommand functions for commands with subcommands', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('_deepl_auth()');
      expect(script).toContain('_deepl_cache()');
    });

    it('should include subcommand descriptions', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('set-key:Set API key');
      expect(script).toContain('show:Show current API key');
      expect(script).toContain('clear:Remove API key');
      expect(script).toContain('stats:Show cache statistics');
    });

    it('should include state machine for argument dispatch', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('_arguments -C');
      expect(script).toContain('case $state in');
      expect(script).toContain('command)');
      expect(script).toContain('args)');
    });

    it('should include installation instructions', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain('fpath');
      expect(script).toContain('Installation');
    });
  });

  describe('fish completion', () => {
    it('should include top-level commands', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain("complete -c deepl -n '__fish_use_subcommand' -a 'translate'");
      expect(script).toContain("complete -c deepl -n '__fish_use_subcommand' -a 'auth'");
      expect(script).toContain("complete -c deepl -n '__fish_use_subcommand' -a 'cache'");
    });

    it('should include command descriptions', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain("'Translate text or files'");
      expect(script).toContain("'Manage authentication'");
      expect(script).toContain("'Manage cache'");
    });

    it('should include global options with long flags', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain("-l 'quiet'");
      expect(script).toContain("-l 'config'");
    });

    it('should include global options with short flags', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain("-s 'q'");
      expect(script).toContain("-s 'c'");
    });

    it('should include subcommands scoped to parent command', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain("__fish_seen_subcommand_from auth");
      expect(script).toContain("-a 'set-key'");
      expect(script).toContain("-a 'show'");
    });

    it('should disable file completions by default', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain('complete -c deepl -f');
    });

    it('should include installation instructions', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain('.config/fish/completions/deepl.fish');
    });
  });

  describe('edge cases', () => {
    it('should handle commands with no subcommands', () => {
      const simple = new Command();
      simple.name('deepl');
      simple.command('translate').description('Translate text');
      simple.command('languages').description('List languages');

      const cmd = new CompletionCommand(simple);
      const bash = cmd.generate('bash');
      expect(bash).toContain('translate');
      expect(bash).toContain('languages');
      expect(bash).not.toContain('translate)');
    });

    it('should handle program with no commands', () => {
      const empty = new Command();
      empty.name('deepl');

      const cmd = new CompletionCommand(empty);
      const bash = cmd.generate('bash');
      expect(bash).toContain('_deepl_completions');
      expect(bash).toContain('complete -F _deepl_completions deepl');
    });

    it('should handle descriptions with single quotes', () => {
      const p = new Command();
      p.name('deepl');
      const sub = p.command('test').description("It's a test command");
      sub.command('sub').description("It's a subcommand");

      const cmd = new CompletionCommand(p);

      const zsh = cmd.generate('zsh');
      expect(zsh).toContain('test');

      const fish = cmd.generate('fish');
      expect(fish).toContain('test');
    });

    it('should handle commands with options but no subcommands', () => {
      const p = new Command();
      p.name('deepl');
      p.command('translate')
        .description('Translate text')
        .option('--to <lang>', 'Target language');

      const cmd = new CompletionCommand(p);

      const bash = cmd.generate('bash');
      expect(bash).toContain('translate');

      const fish = cmd.generate('fish');
      expect(fish).toContain('translate');
    });

    it('should handle hyphenated command names in zsh functions', () => {
      const p = new Command();
      p.name('deepl');
      const sr = p.command('style-rules').description('Manage style rules');
      sr.command('list').description('List rules');

      const cmd = new CompletionCommand(p);
      const zsh = cmd.generate('zsh');
      expect(zsh).toContain('_deepl_style_rules()');
    });
  });

  describe('hidden commands', () => {
    // Hidden commands are internal surface; offering them in tab-completion
    // publishes them to end users.
    it.each(['bash', 'zsh', 'fish'] as const)('omits hidden commands from %s completions', (shell) => {
      const program = new Command();
      program.name('deepl');
      program.command('translate').description('Translate text');
      program.command('_internal', { hidden: true }).description('Internal');

      const script = new CompletionCommand(program).generate(shell);

      expect(script).toContain('translate');
      expect(script).not.toContain('_internal');
    });

    it('omits hidden subcommands', () => {
      const program = new Command();
      program.name('deepl');
      const sync = program.command('sync').description('Sync');
      sync.command('status').description('Status');
      sync.command('secret-report', { hidden: true }).description('Internal');

      const script = new CompletionCommand(program).generate('fish');

      expect(script).toContain('status');
      expect(script).not.toContain('secret-report');
    });
  });

  describe('command aliases', () => {
    it('bash: offers aliases as top-level completions', () => {
      const script = completionCommand.generate('bash');
      expect(script).toContain('compgen -W "translate t auth');
    });

    it('zsh: offers aliases with the aliased command description', () => {
      const script = completionCommand.generate('zsh');
      expect(script).toContain("'t:Translate text or files'");
    });

    it('fish: offers aliases with the aliased command description', () => {
      const script = completionCommand.generate('fish');
      expect(script).toContain("-a 't' -d 'Translate text or files'");
    });
  });
});

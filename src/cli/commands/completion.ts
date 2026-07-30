import type { Command } from 'commander';

export type ShellType = 'bash' | 'zsh' | 'fish';

export class CompletionCommand {
  private readonly program: Command;

  constructor(program: Command) {
    this.program = program;
  }

  generate(shell: ShellType): string {
    switch (shell) {
      case 'bash':
        return this.generateBash();
      case 'zsh':
        return this.generateZsh();
      case 'fish':
        return this.generateFish();
    }
  }

  /** Hidden commands are internal surface and must not be offered to users. */
  private visibleCommands(parent: Command): Command[] {
    return this.program.createHelp().visibleCommands(parent);
  }

  private getCommandTree(): Map<string, string[]> {
    const tree = new Map<string, string[]>();
    const topLevel: string[] = [];

    for (const cmd of this.visibleCommands(this.program)) {
      topLevel.push(cmd.name(), ...cmd.aliases());
      const subcommands = this.visibleCommands(cmd).map((sub) => sub.name());
      if (subcommands.length > 0) {
        tree.set(cmd.name(), subcommands);
      }
    }

    tree.set('__root__', topLevel);
    return tree;
  }

  private findCommand(name: string): Command | undefined {
    return this.program.commands.find((c) => c.name() === name || c.aliases().includes(name));
  }

  private getCommandOptions(cmdName: string): string[] {
    const cmd = this.findCommand(cmdName);
    if (!cmd) {
      return [];
    }
    return cmd.options.map((opt) => opt.long).filter((o): o is string => !!o);
  }

  private getGlobalOptions(): string[] {
    return [
      ...new Set(
        this.program.options
          .map((opt) => opt.long)
          .filter((o): o is string => !!o)
          .concat('--help', '--version'),
      ),
    ];
  }

  private generateBash(): string {
    const tree = this.getCommandTree();
    const topLevel = tree.get('__root__') ?? [];
    const globalOpts = this.getGlobalOptions();

    const subcommandCases: string[] = [];
    for (const [parent, subs] of tree.entries()) {
      if (parent === '__root__') {
        continue;
      }
      const cmdOpts = this.getCommandOptions(parent);
      const words = [...subs, ...cmdOpts].join(' ');
      subcommandCases.push(`        ${parent})\n            COMPREPLY=($(compgen -W "${words}" -- "\${cur}"))\n            return 0\n            ;;`);
    }

    const topLevelWords = [...topLevel, ...globalOpts].join(' ');

    return `# bash completion for deepl                                -*- shell-script -*-
#
# Installation:
#   deepl completion bash > /etc/bash_completion.d/deepl
#   # or
#   deepl completion bash >> ~/.bashrc
#   # then reload:
#   source ~/.bashrc

_deepl_completions()
{
    local cur prev words cword
    _init_completion || return

    # Top-level commands
    if [[ \${cword} -eq 1 ]]; then
        COMPREPLY=($(compgen -W "${topLevelWords}" -- "\${cur}"))
        return 0
    fi

    # Subcommand completions
    local cmd="\${words[1]}"
    case "\${cmd}" in
${subcommandCases.join('\n')}
        *)
            ;;
    esac

    return 0
}

complete -F _deepl_completions deepl
`;
  }

  private generateZsh(): string {
    const tree = this.getCommandTree();
    const topLevel = tree.get('__root__') ?? [];
    const globalOpts = this.getGlobalOptions();

    const subcommandFunctions: string[] = [];
    const subcommandDispatch: string[] = [];

    for (const [parent] of tree.entries()) {
      if (parent === '__root__') {
        continue;
      }
      const safeName = parent.replace(/-/g, '_');
      const cmdOpts = this.getCommandOptions(parent);
      const descriptions: string[] = [];

      const parentCmd = this.findCommand(parent);
      if (parentCmd) {
        for (const sub of this.visibleCommands(parentCmd)) {
          const desc = sub.description().replace(/'/g, "'\\''");
          descriptions.push(`'${sub.name()}:${desc}'`);
        }
        for (const opt of cmdOpts) {
          const optObj = parentCmd.options.find((o) => o.long === opt);
          const desc = optObj ? optObj.description.replace(/'/g, "'\\''") : '';
          descriptions.push(`'${opt}:${desc}'`);
        }
      }

      subcommandFunctions.push(`_deepl_${safeName}() {
    local -a subcmds
    subcmds=(
        ${descriptions.join('\n        ')}
    )
    _describe -t ${safeName}-commands '${parent} subcommand' subcmds
}`);

      subcommandDispatch.push(`        ${parent})\n            _deepl_${safeName}\n            ;;`);
    }

    const topLevelDescriptions: string[] = [];
    for (const cmdName of topLevel) {
      const cmd = this.findCommand(cmdName);
      const desc = cmd ? cmd.description().replace(/'/g, "'\\''") : '';
      topLevelDescriptions.push(`'${cmdName}:${desc}'`);
    }
    for (const opt of globalOpts) {
      const optObj = this.program.options.find((o) => o.long === opt);
      const desc = optObj ? optObj.description.replace(/'/g, "'\\''") : '';
      topLevelDescriptions.push(`'${opt}:${desc}'`);
    }

    const fpathRef = '${fpath[1]}';

    return `#compdef deepl
#
# Installation:
#   deepl completion zsh > "${fpathRef}/_deepl"
#   # or add to ~/.zshrc:
#   eval "$(deepl completion zsh)"
#   # then reload:
#   source ~/.zshrc

${subcommandFunctions.join('\n\n')}

_deepl() {
    local -a commands
    commands=(
        ${topLevelDescriptions.join('\n        ')}
    )

    _arguments -C \\
        '1:command:->command' \\
        '*::arg:->args'

    case $state in
        command)
            _describe -t commands 'deepl command' commands
            ;;
        args)
            case $words[1] in
${subcommandDispatch.join('\n')}
                *)
                    ;;
            esac
            ;;
    esac
}

_deepl "$@"
`;
  }

  private generateFish(): string {
    const tree = this.getCommandTree();
    const topLevel = tree.get('__root__') ?? [];
    const globalOpts = this.getGlobalOptions();

    const lines: string[] = [
      '# fish completion for deepl',
      '#',
      '# Installation:',
      '#   deepl completion fish > ~/.config/fish/completions/deepl.fish',
      '#   # or',
      '#   deepl completion fish | source',
      '',
      '# Disable file completions by default',
      'complete -c deepl -f',
      '',
    ];

    const noSubcmdCondition = '__fish_use_subcommand';

    for (const cmdName of topLevel) {
      const cmd = this.findCommand(cmdName);
      const desc = cmd ? cmd.description() : '';
      lines.push(`complete -c deepl -n '${noSubcmdCondition}' -a '${cmdName}' -d '${desc.replace(/'/g, "\\'")}'`);
    }

    for (const opt of globalOpts) {
      const optObj = this.program.options.find((o) => o.long === opt);
      const desc = optObj ? optObj.description : '';
      const longFlag = opt.replace(/^--/, '');
      const shortObj = this.program.options.find((o) => o.long === opt);
      const shortFlag = shortObj?.short?.replace(/^-/, '');
      let line = `complete -c deepl -n '${noSubcmdCondition}' -l '${longFlag}'`;
      if (shortFlag) {
        line += ` -s '${shortFlag}'`;
      }
      line += ` -d '${desc.replace(/'/g, "\\'")}'`;
      lines.push(line);
    }

    lines.push('');

    for (const [parent, subs] of tree.entries()) {
      if (parent === '__root__') {
        continue;
      }
      const parentCmd = this.findCommand(parent);
      const seenCondition = `__fish_seen_subcommand_from ${parent}`;
      const notSeenSub = subs.length > 0
        ? `; and not __fish_seen_subcommand_from ${subs.join(' ')}`
        : '';

      lines.push(`# ${parent} subcommands`);
      if (parentCmd) {
        for (const sub of this.visibleCommands(parentCmd)) {
          const desc = sub.description().replace(/'/g, "\\'");
          lines.push(`complete -c deepl -n '${seenCondition}${notSeenSub}' -a '${sub.name()}' -d '${desc}'`);
        }
      }

      const cmdOpts = this.getCommandOptions(parent);
      for (const opt of cmdOpts) {
        const optObj = parentCmd?.options.find((o) => o.long === opt);
        const desc = optObj ? optObj.description.replace(/'/g, "\\'") : '';
        const longFlag = opt.replace(/^--/, '');
        lines.push(`complete -c deepl -n '${seenCondition}' -l '${longFlag}' -d '${desc}'`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

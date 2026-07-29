/**
 * Hooks Command
 * Manages git hooks for translation workflow
 */

import chalk from 'chalk';
import { GitHooksService, HookType } from '../../services/git-hooks.js';
import { ValidationError } from '../../utils/errors.js';

export class HooksCommand {
  private gitHooksService: GitHooksService | null = null;

  constructor(gitDir?: string) {
    // Find git directory if not provided
    const gitDirectory = gitDir ?? GitHooksService.findGitRoot();

    if (!gitDirectory) {
      this.gitHooksService = null;
    } else {
      this.gitHooksService = new GitHooksService(gitDirectory);
    }
  }

  /**
   * Install a git hook
   */
  install(hookType: HookType): string {
    if (!this.gitHooksService) {
      throw new ValidationError('Not in a git repository. Run this command from within a git repository.');
    }

    const result = this.gitHooksService.install(hookType);

    const lines = [chalk.green(`✓ Installed ${hookType} hook`)];
    if (result?.hookPath) {
      lines.push(chalk.gray(`  Path: ${result.hookPath}`));
    }
    if (result?.backupPath) {
      lines.push(chalk.gray(`  Previous hook backed up to: ${result.backupPath}`));
    }

    return lines.join('\n');
  }

  /**
   * Uninstall a git hook
   */
  uninstall(hookType: HookType): string {
    if (!this.gitHooksService) {
      throw new ValidationError('Not in a git repository. Run this command from within a git repository.');
    }

    this.gitHooksService.uninstall(hookType);

    return chalk.green(`✓ Uninstalled ${hookType} hook`);
  }

  /**
   * Return raw hook status data (for JSON output)
   */
  listData(): Record<string, boolean> {
    if (!this.gitHooksService) {
      return {};
    }
    return this.gitHooksService.list();
  }

  /**
   * List all hooks and their status
   */
  list(): string {
    if (!this.gitHooksService) {
      return chalk.yellow('⚠️  Not in a git repository');
    }

    const status = this.gitHooksService.list();
    const lines = ['Git Hooks Status:', ''];

    for (const [hook, installed] of Object.entries(status)) {
      const icon = installed ? chalk.green('✓') : chalk.gray('✗');
      const text = installed ? chalk.green('installed') : chalk.gray('not installed');
      lines.push(`  ${icon} ${hook.padEnd(15)} ${text}`);
    }

    return lines.join('\n');
  }

  /**
   * Show hook path
   */
  showPath(hookType: HookType): string {
    if (!this.gitHooksService) {
      throw new ValidationError('Not in a git repository. Run this command from within a git repository.');
    }

    const hookPath = this.gitHooksService.getHookPath(hookType);
    return chalk.blue(`Hook path: ${hookPath}`);
  }
}

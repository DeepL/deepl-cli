/**
 * Integration Tests for git hooks directory resolution
 * Covers core.hooksPath repos, linked worktrees, submodules and backup safety
 * against real git repositories created in temp directories.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { GitHooksService } from '../../src/services/git-hooks.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '.');
}

describe('GitHooksService hooks directory resolution', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-hooks-res-')));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('core.hooksPath', () => {
    it('should install into the effective hooks path when core.hooksPath is set', () => {
      const repo = path.join(tmpRoot, 'husky-repo');
      initRepo(repo);
      fs.mkdirSync(path.join(repo, '.husky', '_'), { recursive: true });
      git(repo, 'config', 'core.hooksPath', '.husky/_');

      const service = new GitHooksService(path.join(repo, '.git'));
      service.install('pre-commit');

      expect(fs.existsSync(path.join(repo, '.husky', '_', 'pre-commit'))).toBe(true);
      expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    });

    it('should report the effective hooks path from getHookPath', () => {
      const repo = path.join(tmpRoot, 'husky-path');
      initRepo(repo);
      git(repo, 'config', 'core.hooksPath', '.husky/_');

      const service = new GitHooksService(path.join(repo, '.git'));

      expect(service.getHookPath('pre-push')).toBe(path.join(repo, '.husky', '_', 'pre-push'));
    });

    it('should have list() reflect hooks installed at the effective path', () => {
      const repo = path.join(tmpRoot, 'husky-list');
      initRepo(repo);
      git(repo, 'config', 'core.hooksPath', 'hooks-dir');

      const service = new GitHooksService(path.join(repo, '.git'));
      service.install('commit-msg');

      expect(fs.existsSync(path.join(repo, 'hooks-dir', 'commit-msg'))).toBe(true);
      expect(service.list()['commit-msg']).toBe(true);
      expect(service.isInstalled('commit-msg')).toBe(true);
    });

    it('should uninstall from the effective hooks path', () => {
      const repo = path.join(tmpRoot, 'husky-uninstall');
      initRepo(repo);
      git(repo, 'config', 'core.hooksPath', '.husky/_');

      const service = new GitHooksService(path.join(repo, '.git'));
      service.install('pre-commit');
      service.uninstall('pre-commit');

      expect(fs.existsSync(path.join(repo, '.husky', '_', 'pre-commit'))).toBe(false);
    });
  });

  describe('.git as a file', () => {
    it('should install into the shared hooks directory from a linked worktree', () => {
      const repo = path.join(tmpRoot, 'main-repo');
      initRepo(repo);
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
      const linked = path.join(tmpRoot, 'linked-wt');
      git(repo, 'worktree', 'add', '-q', linked, '-b', 'feature');

      const gitFile = path.join(linked, '.git');
      expect(fs.statSync(gitFile).isFile()).toBe(true);

      const service = new GitHooksService(gitFile);
      expect(() => service.install('pre-commit')).not.toThrow();

      expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true);
      expect(service.isInstalled('pre-commit')).toBe(true);
    });

    it('should install into the submodule git directory when .git is a pointer file', () => {
      const upstream = path.join(tmpRoot, 'upstream');
      initRepo(upstream);
      fs.writeFileSync(path.join(upstream, 'README.md'), '# upstream\n');
      git(upstream, 'add', '.');
      git(upstream, 'commit', '-q', '-m', 'init');

      const parent = path.join(tmpRoot, 'parent');
      initRepo(parent);
      git(parent, 'commit', '-q', '--allow-empty', '-m', 'init');
      git(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', upstream, 'sub');

      const subGitFile = path.join(parent, 'sub', '.git');
      expect(fs.statSync(subGitFile).isFile()).toBe(true);

      const service = new GitHooksService(subGitFile);
      expect(() => service.install('pre-commit')).not.toThrow();

      const expected = path.join(parent, '.git', 'modules', 'sub', 'hooks', 'pre-commit');
      expect(fs.existsSync(expected)).toBe(true);
      expect(service.isInstalled('pre-commit')).toBe(true);
    });
  });

  describe('backup safety', () => {
    it('should not clobber an existing .backup on repeat install', () => {
      const repo = path.join(tmpRoot, 'backup-repo');
      initRepo(repo);
      const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\n# original user hook\nexit 0\n');

      const service = new GitHooksService(path.join(repo, '.git'));
      const first = service.install('pre-commit');
      expect(first.backupPath).toBe(hookPath + '.backup');
      expect(fs.readFileSync(hookPath + '.backup', 'utf-8')).toContain('original user hook');

      // A third-party tool rewrites the hook, then deepl installs again.
      fs.writeFileSync(hookPath, '#!/bin/sh\n# husky wrapper\nexit 0\n');
      const second = service.install('pre-commit');

      expect(fs.readFileSync(hookPath + '.backup', 'utf-8')).toContain('original user hook');
      expect(second.backupPath).not.toBe(hookPath + '.backup');
      expect(second.backupPath).toBeTruthy();
      expect(fs.readFileSync(second.backupPath!, 'utf-8')).toContain('husky wrapper');
    });

    it('should report no backup path when no pre-existing hook is present', () => {
      const repo = path.join(tmpRoot, 'no-backup-repo');
      initRepo(repo);

      const service = new GitHooksService(path.join(repo, '.git'));
      const result = service.install('pre-push');

      expect(result.backupPath).toBeNull();
      expect(result.hookPath).toBe(path.join(repo, '.git', 'hooks', 'pre-push'));
    });

    it('should not create a backup when replacing an existing DeepL hook', () => {
      const repo = path.join(tmpRoot, 'reinstall-repo');
      initRepo(repo);

      const service = new GitHooksService(path.join(repo, '.git'));
      service.install('pre-commit');
      const second = service.install('pre-commit');

      expect(second.backupPath).toBeNull();
      expect(fs.existsSync(second.hookPath + '.backup')).toBe(false);
    });
  });

  describe('findGitRoot', () => {
    it('should resolve a relative start path without hanging', () => {
      const repo = path.join(tmpRoot, 'relative-repo');
      initRepo(repo);
      const originalCwd = process.cwd();
      process.chdir(repo);
      try {
        expect(GitHooksService.findGitRoot('.')).toBe(path.join(fs.realpathSync(repo), '.git'));
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

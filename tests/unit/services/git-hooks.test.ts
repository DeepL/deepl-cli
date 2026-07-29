/**
 * Tests for GitHooksService
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { GitHooksService } from '../../../src/services/git-hooks';

describe('GitHooksService', () => {
  let testGitDir: string;
  let testHooksDir: string;
  let gitHooksService: GitHooksService;

  beforeEach(() => {
    // Create temporary .git directory for testing
    testGitDir = path.join(os.tmpdir(), `.git-test-${Date.now()}`);
    testHooksDir = path.join(testGitDir, 'hooks');

    fs.mkdirSync(testGitDir, { recursive: true });

    gitHooksService = new GitHooksService(testGitDir);
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testGitDir)) {
      fs.rmSync(testGitDir, { recursive: true, force: true });
    }
  });

  describe('invalid hook type', () => {
    it.each([
      { method: 'install', invoke: (svc: any) => svc.install('invalid-hook') },
      { method: 'uninstall', invoke: (svc: any) => svc.uninstall('invalid-hook') },
      { method: 'isInstalled', invoke: (svc: any) => svc.isInstalled('invalid-hook') },
      { method: 'getHookPath', invoke: (svc: any) => svc.getHookPath('invalid-hook') },
      { method: 'generateHookContent', invoke: (svc: any) => svc.generateHookContent('invalid') },
      { method: 'verifyIntegrity', invoke: (svc: any) => svc.verifyIntegrity('invalid-hook') },
    ])('$method should throw error for invalid hook type', ({ invoke }) => {
      expect(() => invoke(gitHooksService)).toThrow('Invalid hook type');
    });
  });

  describe('constructor', () => {
    it('should create GitHooksService with valid git directory', () => {
      expect(gitHooksService).toBeInstanceOf(GitHooksService);
    });

    it('should throw error for non-existent git directory', () => {
      const nonExistentDir = path.join(os.tmpdir(), 'non-existent-git');

      expect(() => new GitHooksService(nonExistentDir)).toThrow('Git directory not found');
    });
  });

  describe('generated hook content', () => {
    // Generated hook content must only ever name the published package,
    // @deepl/cli — an unpublished name emits a broken install instruction
    // into every generated hook.
    const hookTypes = ['pre-commit', 'pre-push', 'commit-msg', 'post-commit'] as const;

    it.each(hookTypes)('%s output never references an unpublished package name', (hookType) => {
      gitHooksService.install(hookType);

      const content = fs.readFileSync(path.join(testHooksDir, hookType), 'utf-8');
      expect(content).not.toMatch(/install\s+-g\s+deepl-cli\b/);
      if (/npm install/.test(content)) {
        expect(content).toContain('npm install -g @deepl/cli');
      }
    });
  });

  describe('install()', () => {
    it('should install pre-commit hook', () => {
      gitHooksService.install('pre-commit');

      const hookPath = path.join(testHooksDir, 'pre-commit');
      expect(fs.existsSync(hookPath)).toBe(true);

      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toMatch(/# DeepL CLI Hook v1 \[sha256:[a-f0-9]{64}\]/);
      expect(content).toContain('pre-commit');
    });

    it('pre-commit hook invokes the CLI to validate translations', () => {
      gitHooksService.install('pre-commit');

      const content = fs.readFileSync(path.join(testHooksDir, 'pre-commit'), 'utf-8');
      expect(content).toContain('command -v deepl');
      expect(content).toContain('deepl sync validate');
      expect(content).toContain('.deepl-sync.yaml');
      // The former stub grepped staged .md/.txt files and always exited 0.
      expect(content).not.toContain('Translation check passed');
      expect(content).not.toMatch(/grep -E.*md\|txt/);
    });

    it('pre-commit hook blocks the commit when validation fails', () => {
      gitHooksService.install('pre-commit');

      const content = fs.readFileSync(path.join(testHooksDir, 'pre-commit'), 'utf-8');
      expect(content).toContain('exit 1');
    });

    it('should install pre-push hook', () => {
      gitHooksService.install('pre-push');

      const hookPath = path.join(testHooksDir, 'pre-push');
      expect(fs.existsSync(hookPath)).toBe(true);

      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toMatch(/# DeepL CLI Hook v1 \[sha256:[a-f0-9]{64}\]/);
      expect(content).toContain('pre-push');
    });

    it('should install commit-msg hook', () => {
      gitHooksService.install('commit-msg');

      const hookPath = path.join(testHooksDir, 'commit-msg');
      expect(fs.existsSync(hookPath)).toBe(true);

      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toMatch(/# DeepL CLI Hook v1 \[sha256:[a-f0-9]{64}\]/);
      expect(content).toContain('commit-msg');
      expect(content).toContain('commitlint');
    });

    it('should install post-commit hook', () => {
      gitHooksService.install('post-commit');

      const hookPath = path.join(testHooksDir, 'post-commit');
      expect(fs.existsSync(hookPath)).toBe(true);

      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toMatch(/# DeepL CLI Hook v1 \[sha256:[a-f0-9]{64}\]/);
      expect(content).toContain('post-commit');
      expect(content).toContain('Commit successful');
    });

    it('should make hook file executable', () => {
      gitHooksService.install('pre-commit');

      const hookPath = path.join(testHooksDir, 'pre-commit');
      const stats = fs.statSync(hookPath);

      // Check if file is executable (mode includes execute permission)
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });

    it('should create hooks directory if it does not exist', () => {
      expect(fs.existsSync(testHooksDir)).toBe(false);

      gitHooksService.install('pre-commit');

      expect(fs.existsSync(testHooksDir)).toBe(true);
    });

    it('should backup existing non-DeepL hook before installing', () => {
      // Create hooks directory
      fs.mkdirSync(testHooksDir, { recursive: true });

      // Write existing hook
      const hookPath = path.join(testHooksDir, 'pre-commit');
      const existingContent = '#!/bin/sh\necho "custom hook"';
      fs.writeFileSync(hookPath, existingContent);

      gitHooksService.install('pre-commit');

      // Check backup was created
      const backupPath = hookPath + '.backup';
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.readFileSync(backupPath, 'utf-8')).toBe(existingContent);

      // Check new hook was installed with versioned marker
      const newContent = fs.readFileSync(hookPath, 'utf-8');
      expect(newContent).toMatch(/# DeepL CLI Hook v1 \[sha256:[a-f0-9]{64}\]/);
    });

    it('should not backup existing DeepL hook', () => {
      fs.mkdirSync(testHooksDir, { recursive: true });

      // Install once
      gitHooksService.install('pre-commit');

      // Install again (re-install)
      gitHooksService.install('pre-commit');

      // No backup should be created
      const hookPath = path.join(testHooksDir, 'pre-commit');
      const backupPath = hookPath + '.backup';
      expect(fs.existsSync(backupPath)).toBe(false);
    });

  });

  describe('uninstall()', () => {
    beforeEach(() => {
      fs.mkdirSync(testHooksDir, { recursive: true });
    });

    it('should uninstall DeepL hook', () => {
      // Install hook first
      gitHooksService.install('pre-commit');

      const hookPath = path.join(testHooksDir, 'pre-commit');
      expect(fs.existsSync(hookPath)).toBe(true);

      // Uninstall
      gitHooksService.uninstall('pre-commit');

      expect(fs.existsSync(hookPath)).toBe(false);
    });

    it('should restore backup after uninstalling', () => {
      // Create custom hook
      const hookPath = path.join(testHooksDir, 'pre-commit');
      const customContent = '#!/bin/sh\necho "custom"';
      fs.writeFileSync(hookPath, customContent);

      // Install DeepL hook (creates backup)
      gitHooksService.install('pre-commit');

      // Uninstall (should restore backup)
      gitHooksService.uninstall('pre-commit');

      expect(fs.existsSync(hookPath)).toBe(true);
      expect(fs.readFileSync(hookPath, 'utf-8')).toBe(customContent);

      // Backup should be cleaned up
      const backupPath = hookPath + '.backup';
      expect(fs.existsSync(backupPath)).toBe(false);
    });

    it('should not error when uninstalling non-existent hook', () => {
      expect(() => gitHooksService.uninstall('pre-commit')).not.toThrow();
    });

    it('should throw error when trying to uninstall non-DeepL hook', () => {
      // Create custom hook
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\necho "custom"');

      expect(() => gitHooksService.uninstall('pre-commit')).toThrow(
        'Hook is not a DeepL CLI hook'
      );
    });

  });

  describe('isInstalled()', () => {
    beforeEach(() => {
      fs.mkdirSync(testHooksDir, { recursive: true });
    });

    it('should return true when DeepL hook is installed', () => {
      gitHooksService.install('pre-commit');

      expect(gitHooksService.isInstalled('pre-commit')).toBe(true);
    });

    it('should return false when hook does not exist', () => {
      expect(gitHooksService.isInstalled('pre-commit')).toBe(false);
    });

    it('should return false when non-DeepL hook exists', () => {
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\necho "custom"');

      expect(gitHooksService.isInstalled('pre-commit')).toBe(false);
    });

  });

  describe('list()', () => {
    beforeEach(() => {
      fs.mkdirSync(testHooksDir, { recursive: true });
    });

    it('should list installation status of all hooks', () => {
      const status = gitHooksService.list();

      expect(status).toHaveProperty('pre-commit');
      expect(status).toHaveProperty('pre-push');
      expect(status).toHaveProperty('commit-msg');
      expect(status).toHaveProperty('post-commit');
      expect(status['pre-commit']).toBe(false);
      expect(status['pre-push']).toBe(false);
      expect(status['commit-msg']).toBe(false);
      expect(status['post-commit']).toBe(false);
    });

    it('should show correct status when some hooks are installed', () => {
      gitHooksService.install('pre-commit');
      gitHooksService.install('commit-msg');

      const status = gitHooksService.list();

      expect(status['pre-commit']).toBe(true);
      expect(status['pre-push']).toBe(false);
      expect(status['commit-msg']).toBe(true);
      expect(status['post-commit']).toBe(false);
    });

    it('should show all installed when all hooks are installed', () => {
      gitHooksService.install('pre-commit');
      gitHooksService.install('pre-push');
      gitHooksService.install('commit-msg');
      gitHooksService.install('post-commit');

      const status = gitHooksService.list();

      expect(status['pre-commit']).toBe(true);
      expect(status['pre-push']).toBe(true);
      expect(status['commit-msg']).toBe(true);
      expect(status['post-commit']).toBe(true);
    });
  });

  describe('getHookPath()', () => {
    it('should return correct path for pre-commit hook', () => {
      const hookPath = gitHooksService.getHookPath('pre-commit');

      expect(hookPath).toBe(path.join(testHooksDir, 'pre-commit'));
    });

    it('should return correct path for pre-push hook', () => {
      const hookPath = gitHooksService.getHookPath('pre-push');

      expect(hookPath).toBe(path.join(testHooksDir, 'pre-push'));
    });

    it('should return correct path for commit-msg hook', () => {
      const hookPath = gitHooksService.getHookPath('commit-msg');

      expect(hookPath).toBe(path.join(testHooksDir, 'commit-msg'));
    });

    it('should return correct path for post-commit hook', () => {
      const hookPath = gitHooksService.getHookPath('post-commit');

      expect(hookPath).toBe(path.join(testHooksDir, 'post-commit'));
    });

  });

  describe('findGitRoot()', () => {
    let testDir: string;
    let testGitRoot: string;

    beforeEach(() => {
      // Create nested directory structure with .git
      testDir = path.join(os.tmpdir(), `git-root-test-${Date.now()}`);
      testGitRoot = path.join(testDir, '.git');
      fs.mkdirSync(path.join(testDir, 'nested', 'deep'), { recursive: true });
      fs.mkdirSync(testGitRoot);
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should find git root from current directory', () => {
      const gitRoot = GitHooksService.findGitRoot(testDir);

      expect(gitRoot).toBe(testGitRoot);
    });

    it('should find git root from nested directory', () => {
      const nestedDir = path.join(testDir, 'nested', 'deep');
      const gitRoot = GitHooksService.findGitRoot(nestedDir);

      expect(gitRoot).toBe(testGitRoot);
    });

    it('should return null when no git directory found', () => {
      const noGitDir = path.join(os.tmpdir(), `no-git-${Date.now()}`);
      fs.mkdirSync(noGitDir, { recursive: true });

      const gitRoot = GitHooksService.findGitRoot(noGitDir);

      expect(gitRoot).toBeNull();

      fs.rmSync(noGitDir, { recursive: true, force: true });
    });

    it('should use process.cwd() when no start path provided', () => {
      // This will return null or a valid path depending on test environment
      const gitRoot = GitHooksService.findGitRoot();

      // Just verify it doesn't throw
      expect(gitRoot === null || typeof gitRoot === 'string').toBe(true);
    });
  });

  describe('hook content generation', () => {
    const MARKER_PATTERN = /^# DeepL CLI Hook v(\d+) \[sha256:([a-f0-9]{64})\]$/m;

    it('should generate valid pre-commit hook content', () => {
      const content = (gitHooksService as any).generateHookContent('pre-commit');

      expect(content).toContain('#!/bin/sh');
      expect(content).toMatch(MARKER_PATTERN);
      expect(content).toContain('pre-commit');
      expect(content).toContain('deepl hooks uninstall pre-commit');
    });

    it('should generate valid pre-push hook content', () => {
      const content = (gitHooksService as any).generateHookContent('pre-push');

      expect(content).toContain('#!/bin/sh');
      expect(content).toMatch(MARKER_PATTERN);
      expect(content).toContain('pre-push');
      expect(content).toContain('deepl hooks uninstall pre-push');
    });

    it('should generate valid commit-msg hook content', () => {
      const content = (gitHooksService as any).generateHookContent('commit-msg');

      expect(content).toContain('#!/bin/sh');
      expect(content).toMatch(MARKER_PATTERN);
      expect(content).toContain('commit-msg');
      expect(content).toContain('commitlint');
      expect(content).toContain('COMMIT_MSG_FILE=$1');
      expect(content).toContain('deepl hooks uninstall commit-msg');
    });

    it('should generate valid post-commit hook content', () => {
      const content = (gitHooksService as any).generateHookContent('post-commit');

      expect(content).toContain('#!/bin/sh');
      expect(content).toMatch(MARKER_PATTERN);
      expect(content).toContain('post-commit');
      expect(content).toContain('Commit successful');
      expect(content).toContain('CHANGELOG.md');
      expect(content).toContain('deepl hooks uninstall post-commit');
    });

    it('should embed correct SHA-256 hash of the hook body', () => {
      const content = (gitHooksService as any).generateHookContent('pre-commit');
      const match = content.match(MARKER_PATTERN);
      expect(match).not.toBeNull();

      const embeddedHash = match![2];
      const body = GitHooksService.extractHookBody(content);
      const computedHash = GitHooksService.computeHash(body);

      expect(embeddedHash).toBe(computedHash);
    });

    it('should use marker version 1', () => {
      const content = (gitHooksService as any).generateHookContent('pre-commit');
      const match = content.match(MARKER_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1');
    });

    it('should produce consistent hash for same hook type', () => {
      const content1 = (gitHooksService as any).generateHookContent('pre-commit');
      const content2 = (gitHooksService as any).generateHookContent('pre-commit');
      expect(content1).toBe(content2);
    });

    it('should produce different hashes for different hook types', () => {
      const content1 = (gitHooksService as any).generateHookContent('pre-commit');
      const content2 = (gitHooksService as any).generateHookContent('pre-push');

      const hash1 = content1.match(MARKER_PATTERN)![2];
      const hash2 = content2.match(MARKER_PATTERN)![2];

      expect(hash1).not.toBe(hash2);
    });

  });

  describe('isDeepLHook()', () => {
    it('should identify legacy DeepL hook', () => {
      const deeplContent = '#!/bin/sh\n# DeepL CLI Hook\necho "test"';

      expect((gitHooksService as any).isDeepLHook(deeplContent)).toBe(true);
    });

    it('should identify versioned DeepL hook', () => {
      const hash = 'a'.repeat(64);
      const content = `#!/bin/sh\n# DeepL CLI Hook v1 [sha256:${hash}]\necho "test"`;

      expect((gitHooksService as any).isDeepLHook(content)).toBe(true);
    });

    it('should reject non-DeepL hook', () => {
      const customContent = '#!/bin/sh\necho "custom hook"';

      expect((gitHooksService as any).isDeepLHook(customContent)).toBe(false);
    });

    it('should match hook containing legacy marker as substring', () => {
      const content = '#!/bin/sh\n# DeepL CLI Hooks\necho "test"';

      expect((gitHooksService as any).isDeepLHook(content)).toBe(true);
    });
  });

  describe('computeHash()', () => {
    it('should return a 64-character hex string', () => {
      const hash = GitHooksService.computeHash('hello');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should match known SHA-256 value', () => {
      const expected = crypto.createHash('sha256').update('hello', 'utf-8').digest('hex');
      expect(GitHooksService.computeHash('hello')).toBe(expected);
    });

    it('should produce different hashes for different inputs', () => {
      const h1 = GitHooksService.computeHash('abc');
      const h2 = GitHooksService.computeHash('def');
      expect(h1).not.toBe(h2);
    });

    it('should produce consistent hashes for same input', () => {
      const h1 = GitHooksService.computeHash('test content');
      const h2 = GitHooksService.computeHash('test content');
      expect(h1).toBe(h2);
    });
  });

  describe('extractHookBody()', () => {
    it('should extract body after legacy marker', () => {
      const content = '#!/bin/sh\n# DeepL CLI Hook\necho "body"';
      const body = GitHooksService.extractHookBody(content);
      expect(body).toBe('echo "body"');
    });

    it('should extract body after versioned marker', () => {
      const hash = 'a'.repeat(64);
      const content = `#!/bin/sh\n# DeepL CLI Hook v1 [sha256:${hash}]\necho "body"`;
      const body = GitHooksService.extractHookBody(content);
      expect(body).toBe('echo "body"');
    });

    it('should return full content when no marker is found', () => {
      const content = '#!/bin/sh\necho "no marker"';
      const body = GitHooksService.extractHookBody(content);
      expect(body).toBe(content);
    });

    it('should handle multiline body correctly', () => {
      const hash = 'a'.repeat(64);
      const content = `#!/bin/sh\n# DeepL CLI Hook v1 [sha256:${hash}]\nline1\nline2\nline3`;
      const body = GitHooksService.extractHookBody(content);
      expect(body).toBe('line1\nline2\nline3');
    });
  });

  describe('verifyIntegrity()', () => {
    beforeEach(() => {
      fs.mkdirSync(testHooksDir, { recursive: true });
    });

    it('should return not-installed for missing hook', () => {
      const result = gitHooksService.verifyIntegrity('pre-commit');
      expect(result.installed).toBe(false);
      expect(result.markerVersion).toBeNull();
      expect(result.hashMatch).toBeNull();
    });

    it('should return not-installed for non-DeepL hook', () => {
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\necho "custom"');

      const result = gitHooksService.verifyIntegrity('pre-commit');
      expect(result.installed).toBe(false);
      expect(result.markerVersion).toBeNull();
    });

    it('should return legacy marker version for old-style hooks', () => {
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\n# DeepL CLI Hook\necho "old style"');

      const result = gitHooksService.verifyIntegrity('pre-commit');
      expect(result.installed).toBe(true);
      expect(result.markerVersion).toBe('legacy');
      expect(result.hashMatch).toBeNull();
      expect(result.expectedHash).toBeNull();
      expect(result.actualHash).toBeNull();
    });

    it('should verify integrity of freshly installed hook', () => {
      gitHooksService.install('pre-commit');

      const result = gitHooksService.verifyIntegrity('pre-commit');
      expect(result.installed).toBe(true);
      expect(result.markerVersion).toBe(1);
      expect(result.hashMatch).toBe(true);
      expect(result.expectedHash).toBe(result.actualHash);
    });

    it('should detect tampered hook body', () => {
      gitHooksService.install('pre-commit');

      const hookPath = path.join(testHooksDir, 'pre-commit');
      const content = fs.readFileSync(hookPath, 'utf-8');
      const tampered = content + '\necho "injected malicious code"';
      fs.writeFileSync(hookPath, tampered);

      const result = gitHooksService.verifyIntegrity('pre-commit');
      expect(result.installed).toBe(true);
      expect(result.markerVersion).toBe(1);
      expect(result.hashMatch).toBe(false);
      expect(result.expectedHash).not.toBe(result.actualHash);
    });

    it('should detect modified hook body (replaced content)', () => {
      gitHooksService.install('pre-commit');

      const hookPath = path.join(testHooksDir, 'pre-commit');
      const content = fs.readFileSync(hookPath, 'utf-8');
      const modified = content.replace('Validating translations', 'HACKED');
      fs.writeFileSync(hookPath, modified);

      const result = gitHooksService.verifyIntegrity('pre-commit');
      expect(result.installed).toBe(true);
      expect(result.hashMatch).toBe(false);
    });

    it('should verify integrity for all hook types', () => {
      const hookTypes: Array<'pre-commit' | 'pre-push' | 'commit-msg' | 'post-commit'> = [
        'pre-commit', 'pre-push', 'commit-msg', 'post-commit'
      ];

      for (const hookType of hookTypes) {
        gitHooksService.install(hookType);
        const result = gitHooksService.verifyIntegrity(hookType);
        expect(result.installed).toBe(true);
        expect(result.markerVersion).toBe(1);
        expect(result.hashMatch).toBe(true);
      }
    });

  });

  describe('backward compatibility', () => {
    beforeEach(() => {
      fs.mkdirSync(testHooksDir, { recursive: true });
    });

    it('should detect old-style marker as installed', () => {
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\n# DeepL CLI Hook\necho "old hook"');

      expect(gitHooksService.isInstalled('pre-commit')).toBe(true);
    });

    it('should allow uninstalling old-style hook', () => {
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\n# DeepL CLI Hook\necho "old hook"');

      gitHooksService.uninstall('pre-commit');
      expect(fs.existsSync(hookPath)).toBe(false);
    });

    it('should not backup old-style hook when reinstalling', () => {
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\n# DeepL CLI Hook\necho "old hook"');

      gitHooksService.install('pre-commit');

      const backupPath = hookPath + '.backup';
      expect(fs.existsSync(backupPath)).toBe(false);

      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toMatch(/# DeepL CLI Hook v1 \[sha256:[a-f0-9]{64}\]/);
    });

    it('should upgrade old-style hook to versioned format on reinstall', () => {
      const hookPath = path.join(testHooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\n# DeepL CLI Hook\necho "old hook"');

      gitHooksService.install('pre-commit');

      const result = gitHooksService.verifyIntegrity('pre-commit');
      expect(result.markerVersion).toBe(1);
      expect(result.hashMatch).toBe(true);
    });
  });
});

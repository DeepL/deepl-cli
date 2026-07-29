/**
 * Tests for HooksCommand
 */

import { HooksCommand } from '../../src/cli/commands/hooks';
import { GitHooksService } from '../../src/services/git-hooks';

// Mock chalk
jest.mock('chalk', () => ({
  default: {
    green: (text: string) => text,
    yellow: (text: string) => text,
    blue: (text: string) => text,
    gray: (text: string) => text,
    red: (text: string) => text,
  },
  green: (text: string) => text,
  yellow: (text: string) => text,
  blue: (text: string) => text,
  gray: (text: string) => text,
  red: (text: string) => text,
}));

// Mock the GitHooksService
jest.mock('../../src/services/git-hooks');

describe('HooksCommand', () => {
  let mockGitHooksService: jest.Mocked<GitHooksService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock service
    mockGitHooksService = {
      install: jest.fn(),
      uninstall: jest.fn(),
      list: jest.fn(),
      getHookPath: jest.fn(),
      isInstalled: jest.fn(),
    } as any;

    // Mock the constructor to return our mock service
    (GitHooksService as jest.MockedClass<typeof GitHooksService>).mockImplementation(
      () => mockGitHooksService
    );
  });

  describe('constructor', () => {
    it('should create HooksCommand with git directory', () => {
      const command = new HooksCommand('/path/to/.git');
      expect(GitHooksService).toHaveBeenCalledWith('/path/to/.git');
      expect(command).toBeInstanceOf(HooksCommand);
    });

    it('should find git root when no directory provided', () => {
      const mockFindGitRoot = jest.fn().mockReturnValue('/found/.git');
      (GitHooksService.findGitRoot as jest.Mock) = mockFindGitRoot;

      const command = new HooksCommand();
      expect(mockFindGitRoot).toHaveBeenCalled();
      expect(command).toBeInstanceOf(HooksCommand);
    });

    it('should handle case when not in git repository', () => {
      const mockFindGitRoot = jest.fn().mockReturnValue(null);
      (GitHooksService.findGitRoot as jest.Mock) = mockFindGitRoot;

      const command = new HooksCommand();
      expect(mockFindGitRoot).toHaveBeenCalled();
      expect(command).toBeInstanceOf(HooksCommand);
    });
  });

  describe('install()', () => {
    it('should install pre-commit hook', () => {
      mockGitHooksService.install.mockReturnValue({
        hookPath: '/path/to/.git/hooks/pre-commit',
        backupPath: null,
      });
      const command = new HooksCommand('/path/to/.git');

      const result = command.install('pre-commit');

      expect(mockGitHooksService.install).toHaveBeenCalledWith('pre-commit');
      expect(result).toContain('Installed pre-commit hook');
      expect(result).toContain('/path/to/.git/hooks/pre-commit');
    });

    it('should report the backup path when an existing hook was backed up', () => {
      mockGitHooksService.install.mockReturnValue({
        hookPath: '/path/to/.git/hooks/pre-commit',
        backupPath: '/path/to/.git/hooks/pre-commit.backup',
      });
      const command = new HooksCommand('/path/to/.git');

      const result = command.install('pre-commit');

      expect(result).toContain('backed up to: /path/to/.git/hooks/pre-commit.backup');
    });

    it('should install pre-push hook', () => {
      mockGitHooksService.install.mockReturnValue({
        hookPath: '/path/to/.git/hooks/pre-push',
        backupPath: null,
      });
      const command = new HooksCommand('/path/to/.git');

      const result = command.install('pre-push');

      expect(mockGitHooksService.install).toHaveBeenCalledWith('pre-push');
      expect(result).toContain('Installed pre-push hook');
    });

    it('should throw error when not in git repository', () => {
      const mockFindGitRoot = jest.fn().mockReturnValue(null);
      (GitHooksService.findGitRoot as jest.Mock) = mockFindGitRoot;

      const command = new HooksCommand();

      expect(() => command.install('pre-commit')).toThrow(
        'Not in a git repository'
      );
    });

    it('should propagate errors from GitHooksService', () => {
      mockGitHooksService.install.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const command = new HooksCommand('/path/to/.git');

      expect(() => command.install('pre-commit')).toThrow('Permission denied');
    });
  });

  describe('uninstall()', () => {
    it('should uninstall pre-commit hook', () => {
      mockGitHooksService.uninstall.mockReturnValue(undefined);
      const command = new HooksCommand('/path/to/.git');

      const result = command.uninstall('pre-commit');

      expect(mockGitHooksService.uninstall).toHaveBeenCalledWith('pre-commit');
      expect(result).toContain('Uninstalled pre-commit hook');
    });

    it('should uninstall pre-push hook', () => {
      mockGitHooksService.uninstall.mockReturnValue(undefined);
      const command = new HooksCommand('/path/to/.git');

      const result = command.uninstall('pre-push');

      expect(mockGitHooksService.uninstall).toHaveBeenCalledWith('pre-push');
      expect(result).toContain('Uninstalled pre-push hook');
    });

    it('should throw error when not in git repository', () => {
      const mockFindGitRoot = jest.fn().mockReturnValue(null);
      (GitHooksService.findGitRoot as jest.Mock) = mockFindGitRoot;

      const command = new HooksCommand();

      expect(() => command.uninstall('pre-commit')).toThrow(
        'Not in a git repository'
      );
    });

    it('should propagate errors from GitHooksService', () => {
      mockGitHooksService.uninstall.mockImplementation(() => {
        throw new Error('Hook not found');
      });
      const command = new HooksCommand('/path/to/.git');

      expect(() => command.uninstall('pre-commit')).toThrow('Hook not found');
    });
  });

  describe('list()', () => {
    it('should list hooks when both are installed', () => {
      mockGitHooksService.list.mockReturnValue({
        'pre-commit': true,
        'pre-push': true,
      });
      const command = new HooksCommand('/path/to/.git');

      const result = command.list();

      expect(mockGitHooksService.list).toHaveBeenCalled();
      expect(result).toContain('Git Hooks Status');
      expect(result).toContain('pre-commit');
      expect(result).toContain('pre-push');
      expect(result).toContain('installed');
    });

    it('should list hooks when none are installed', () => {
      mockGitHooksService.list.mockReturnValue({
        'pre-commit': false,
        'pre-push': false,
      });
      const command = new HooksCommand('/path/to/.git');

      const result = command.list();

      expect(result).toContain('Git Hooks Status');
      expect(result).toContain('pre-commit');
      expect(result).toContain('pre-push');
      expect(result).toContain('not installed');
    });

    it('should list hooks with mixed status', () => {
      mockGitHooksService.list.mockReturnValue({
        'pre-commit': true,
        'pre-push': false,
      });
      const command = new HooksCommand('/path/to/.git');

      const result = command.list();

      expect(result).toContain('Git Hooks Status');
      expect(result).toContain('pre-commit');
      expect(result).toContain('pre-push');
    });

    it('should show warning when not in git repository', () => {
      const mockFindGitRoot = jest.fn().mockReturnValue(null);
      (GitHooksService.findGitRoot as jest.Mock) = mockFindGitRoot;

      const command = new HooksCommand();
      const result = command.list();

      expect(result).toContain('Not in a git repository');
    });
  });

  describe('showPath()', () => {
    it('should show pre-commit hook path', () => {
      mockGitHooksService.getHookPath.mockReturnValue('/path/to/.git/hooks/pre-commit');
      const command = new HooksCommand('/path/to/.git');

      const result = command.showPath('pre-commit');

      expect(mockGitHooksService.getHookPath).toHaveBeenCalledWith('pre-commit');
      expect(result).toContain('Hook path:');
      expect(result).toContain('/path/to/.git/hooks/pre-commit');
    });

    it('should show pre-push hook path', () => {
      mockGitHooksService.getHookPath.mockReturnValue('/path/to/.git/hooks/pre-push');
      const command = new HooksCommand('/path/to/.git');

      const result = command.showPath('pre-push');

      expect(mockGitHooksService.getHookPath).toHaveBeenCalledWith('pre-push');
      expect(result).toContain('Hook path:');
      expect(result).toContain('/path/to/.git/hooks/pre-push');
    });

    it('should throw error when not in git repository', () => {
      const mockFindGitRoot = jest.fn().mockReturnValue(null);
      (GitHooksService.findGitRoot as jest.Mock) = mockFindGitRoot;

      const command = new HooksCommand();

      expect(() => command.showPath('pre-commit')).toThrow('Not in a git repository');
    });

    it('should propagate errors from GitHooksService', () => {
      mockGitHooksService.getHookPath.mockImplementation(() => {
        throw new Error('Invalid hook type');
      });
      const command = new HooksCommand('/path/to/.git');

      expect(() => command.showPath('pre-commit' as any)).toThrow('Invalid hook type');
    });
  });

  describe('listData()', () => {
    it('should return raw status object when hooks are installed', () => {
      mockGitHooksService.list.mockReturnValue({
        'pre-commit': true,
        'pre-push': false,
      });
      const command = new HooksCommand('/path/to/.git');

      const data = command.listData();

      expect(data).toEqual({
        'pre-commit': true,
        'pre-push': false,
      });
    });

    it('should return empty object when not in git repository', () => {
      const mockFindGitRoot = jest.fn().mockReturnValue(null);
      (GitHooksService.findGitRoot as jest.Mock) = mockFindGitRoot;

      const command = new HooksCommand();
      const data = command.listData();

      expect(data).toEqual({});
    });

    it('should produce valid parseable JSON', () => {
      mockGitHooksService.list.mockReturnValue({
        'pre-commit': true,
        'pre-push': true,
        'commit-msg': false,
        'post-commit': false,
      });
      const command = new HooksCommand('/path/to/.git');

      const data = command.listData();
      const json = JSON.stringify(data, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed['pre-commit']).toBe(true);
      expect(parsed['pre-push']).toBe(true);
      expect(parsed['commit-msg']).toBe(false);
      expect(parsed['post-commit']).toBe(false);
    });
  });
});

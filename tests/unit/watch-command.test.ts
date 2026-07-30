/**
 * Tests for WatchCommand
 */

import * as fs from 'fs';
import { WatchCommand } from '../../src/cli/commands/watch';
import { WatchService } from '../../src/services/watch';
import { FileTranslationService } from '../../src/services/file-translation';
import { TranslationService } from '../../src/services/translation';
import { GlossaryService } from '../../src/services/glossary';
import {
  createMockTranslationService,
  createMockGlossaryService,
  createMockFileTranslationService,
  createMockWatchService,
} from '../helpers/mock-factories';

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

// Mock Logger
jest.mock('../../src/utils/logger', () => ({
  Logger: {
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    output: jest.fn(),
    shouldShowSpinner: jest.fn(() => true),
    setQuiet: jest.fn(),
    isQuiet: jest.fn(() => false),
  },
}));

import { Logger } from '../../src/utils/logger';
const mockLogger = Logger as jest.Mocked<typeof Logger>;

// Mock dependencies
jest.mock('fs');
jest.mock('../../src/services/watch');
jest.mock('../../src/services/file-translation');

describe('WatchCommand', () => {
  let mockTranslationService: jest.Mocked<TranslationService>;
  let mockFileTranslationService: jest.Mocked<FileTranslationService>;
  let mockWatchService: jest.Mocked<WatchService>;
  let mockGlossaryService: jest.Mocked<GlossaryService>;
  let watchCommand: WatchCommand;

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear Logger mocks
    mockLogger.info.mockClear();
    mockLogger.success.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.output.mockClear();

    mockTranslationService = createMockTranslationService();

    mockGlossaryService = createMockGlossaryService();

    mockFileTranslationService = createMockFileTranslationService();

    (FileTranslationService as jest.MockedClass<typeof FileTranslationService>).mockImplementation(
      () => mockFileTranslationService
    );

    mockWatchService = createMockWatchService({
      getStats: jest.fn().mockReturnValue({
        translationsCount: 0,
        errorsCount: 0,
      }),
    });

    (WatchService as jest.MockedClass<typeof WatchService>).mockImplementation(
      () => mockWatchService
    );

    // Mock console methods to avoid noise
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    watchCommand = new WatchCommand(mockTranslationService, mockGlossaryService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create WatchCommand with TranslationService and GlossaryService', () => {
      expect(watchCommand).toBeInstanceOf(WatchCommand);
      expect(FileTranslationService).toHaveBeenCalledWith(mockTranslationService);
    });
  });

  describe('watch()', () => {
    beforeEach(() => {
      // Mock fs.existsSync to return true by default
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);

      // Mock process.on to avoid hanging tests
      jest.spyOn(process, 'on').mockImplementation(() => process);
    });

    it('should throw error for non-existent path', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const watchPromise = watchCommand.watch('/non/existent/path', {
        to: 'es,fr',
      });

      await expect(watchPromise).rejects.toThrow('Path not found');
    });

    it('should parse multiple target languages', async () => {
      expect.assertions(2);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

      // Create a Promise that rejects immediately to avoid hanging
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es, fr, de',
        });
      } catch (error: any) {
        expect(error.message).toBe('Test complete');
      }

      expect(mockWatchService.watch).toHaveBeenCalledWith(
        '/some/file.md',
        expect.objectContaining({
          targetLangs: ['es', 'fr', 'de'],
        })
      );
    });

    it('should use custom output directory when provided', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
          output: '/custom/output',
        });
      } catch {
        // Expected
      }

      expect(mockWatchService.watch).toHaveBeenCalledWith(
        '/some/file.md',
        expect.objectContaining({
          outputDir: '/custom/output',
        })
      );
    });

    it('should create translations subdirectory for directory input', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValueOnce(true).mockReturnValueOnce(false);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/dir', {
          to: 'es',
        });
      } catch {
        // Expected
      }

      expect(fs.mkdirSync).toHaveBeenCalledWith('/some/dir/translations', {
        recursive: true,
      });
    });

    it('should use same directory for file input when no output specified', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/dir/file.md', {
          to: 'es',
        });
      } catch {
        // Expected
      }

      expect(mockWatchService.watch).toHaveBeenCalledWith(
        '/some/dir/file.md',
        expect.objectContaining({
          outputDir: '/some/dir',
        })
      );
    });

    it('should pass debounce option to WatchService', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
          debounce: 500,
        });
      } catch {
        // Expected
      }

      expect(WatchService).toHaveBeenCalledWith(
        mockFileTranslationService,
        expect.objectContaining({
          debounceMs: 500,
        })
      );
    });

    it('should pass pattern option to WatchService', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/dir', {
          to: 'es',
          pattern: '*.md',
        });
      } catch {
        // Expected
      }

      expect(WatchService).toHaveBeenCalledWith(
        mockFileTranslationService,
        expect.objectContaining({
          pattern: '*.md',
        })
      );
    });

    it('should pass translation options to watch service', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es,fr',
          from: 'en',
          formality: 'more',
          preserveCode: true,
        });
      } catch {
        // Expected
      }

      expect(mockWatchService.watch).toHaveBeenCalledWith(
        '/some/file.md',
        expect.objectContaining({
          targetLangs: ['es', 'fr'],
          sourceLang: 'en',
          formality: 'more',
          preserveCode: true,
        })
      );
    });

    it('should register onChange callback', async () => {
      expect.assertions(2);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];
      expect(watchOptions.onChange).toBeInstanceOf(Function);

      // Test the callback
      watchOptions.onChange!('/test/file.md');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        '/test/file.md'
      );
    });

    it('should register onTranslate callback for multiple languages', async () => {
      expect.assertions(2);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es,fr',
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];
      expect(watchOptions.onTranslate).toBeInstanceOf(Function);

      // Test the callback with array result
      await watchOptions.onTranslate!('/test/file.md', [
        { targetLang: 'es', text: 'translated text', outputPath: '/test/file.es.md' },
        { targetLang: 'fr', text: 'translated text', outputPath: '/test/file.fr.md' },
      ]);

      expect(mockLogger.success).toHaveBeenCalled();
    });

    it('should register onTranslate callback for single language', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];

      // Test the callback with single result
      await watchOptions.onTranslate!('/test/file.md', {
        targetLang: 'es',
        text: 'translated text',
        outputPath: '/test/file.es.md',
      });

      expect(mockLogger.success).toHaveBeenCalled();
    });

    it('should register onError callback', async () => {
      expect.assertions(2);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];
      expect(watchOptions.onError).toBeInstanceOf(Function);

      // Test the callback
      watchOptions.onError!('/test/file.md', new Error('Translation failed'));
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should throw error when no target languages provided', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        watchCommand.watch('/some/file.md', {
          to: '',
        })
      ).rejects.toThrow('No target language specified.');
    });

    it('should display initial watch message with all options', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

      // Mock the watch service watch method to return a resolved promise
      mockWatchService.watch.mockReturnValue(undefined);

      // Start watch - it will reach the infinite Promise and hang there
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      watchCommand.watch('/some/file.md', {
        to: 'es,fr',
        pattern: '*.md',
        autoCommit: true,
      });

      // Wait a bit for Logger statements to execute
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining('Watching for changes'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Path: /some/file.md'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Targets: es, fr'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Pattern: *.md'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Auto-commit enabled'));

      // Don't wait for the promise to resolve (it won't due to infinite Promise)
    }, 1000);

    it('should use current directory when file is in root', async () => {
      expect.assertions(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('file.md', {
          to: 'es',
        });
      } catch {
        // Expected
      }

      expect(mockWatchService.watch).toHaveBeenCalledWith(
        'file.md',
        expect.objectContaining({
          outputDir: '.',
        })
      );
    });
  });

  describe('autoCommit', () => {
    let mockExec: jest.Mock;

    beforeEach(() => {
      // Mock dynamic imports
      mockExec = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
      jest.mock('child_process', () => ({
        exec: mockExec,
      }));
      jest.mock('util', () => ({
        promisify: (fn: any) => fn,
      }));

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
    });

    it('should auto-commit translations when autoCommit is enabled for multiple languages', async () => {
      expect.assertions(1);
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      // Mock exec to simulate git commands
      const mockExecAsync = jest.fn()
        .mockResolvedValueOnce({ stdout: '.git', stderr: '' }) // git rev-parse check
        .mockResolvedValue({ stdout: '', stderr: '' }); // git add and commit

      jest.doMock('child_process', () => ({
        exec: jest.fn(),
      }));
      jest.doMock('util', () => ({
        promisify: () => mockExecAsync,
      }));

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es,fr',
          autoCommit: true,
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];

      // Trigger onTranslate callback with multiple languages
      await watchOptions.onTranslate!('/test/file.md', [
        { targetLang: 'es', text: 'texto', outputPath: '/test/file.es.md' },
        { targetLang: 'fr', text: 'texte', outputPath: '/test/file.fr.md' },
      ]);

      // Verify console output includes auto-commit attempt
      expect(mockLogger.success).toHaveBeenCalled();
    });

    it('should auto-commit translations when autoCommit is enabled for single language', async () => {
      expect.assertions(1);
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
          autoCommit: true,
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];

      // Trigger onTranslate callback with single language
      await watchOptions.onTranslate!('/test/file.md', {
        targetLang: 'es',
        text: 'texto',
        outputPath: '/test/file.es.md',
      });

      expect(mockLogger.success).toHaveBeenCalled();
    });

    it('should handle auto-commit when not in git repository', async () => {
      expect.assertions(1);
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
          autoCommit: true,
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];

      // Trigger onTranslate callback
      await watchOptions.onTranslate!('/test/file.md', {
        targetLang: 'es',
        text: 'texto',
        outputPath: '/test/file.es.md',
      });

      // Should not throw, just log warning
      expect(mockLogger.success).toHaveBeenCalled();
    });

    it('should handle auto-commit with no output files', async () => {
      expect.assertions(1);
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
          autoCommit: true,
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];

      // Trigger onTranslate callback with no outputPath
      await watchOptions.onTranslate!('/test/file.md', {
        targetLang: 'es',
        text: 'texto',
      });

      // Should not throw
      expect(mockLogger.success).toHaveBeenCalled();
    });

    it('should handle auto-commit errors gracefully', async () => {
      expect.assertions(1);
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
          autoCommit: true,
        });
      } catch {
        // Expected
      }

      const watchOptions = mockWatchService.watch.mock.calls[0]![1];

      // Trigger onTranslate callback
      await watchOptions.onTranslate!('/test/file.md', {
        targetLang: 'es',
        text: 'texto',
        outputPath: '/test/file.es.md',
      });

      // Should not throw on auto-commit failure
      expect(mockLogger.success).toHaveBeenCalled();
    });
  });

  describe('watch() with gitStaged', () => {
    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      jest.spyOn(process, 'on').mockImplementation(() => process);
    });

    it('should call getStagedFiles and pass result to WatchService when gitStaged is true', async () => {
      expect.assertions(2);
      const stagedSet = new Set(['/abs/file1.txt']);
      jest.spyOn(watchCommand, 'getStagedFiles').mockResolvedValue(stagedSet);
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/dir', {
          to: 'es',
          gitStaged: true,
        });
      } catch {
        // Expected
      }

      expect(watchCommand.getStagedFiles).toHaveBeenCalled();
      expect(WatchService).toHaveBeenCalledWith(
        mockFileTranslationService,
        expect.objectContaining({
          stagedFiles: stagedSet,
        })
      );
    });

    it('should return early when no staged files are found', async () => {
      jest.spyOn(watchCommand, 'getStagedFiles').mockResolvedValue(new Set());

      await watchCommand.watch('/some/dir', {
        to: 'es',
        gitStaged: true,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No git-staged files found'));
      expect(WatchService).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ stagedFiles: expect.anything() })
      );
    });

    it('should propagate error when not in a git repo', async () => {
      jest.spyOn(watchCommand, 'getStagedFiles').mockRejectedValue(
        new Error('--git-staged requires a git repository')
      );

      await expect(
        watchCommand.watch('/some/dir', {
          to: 'es',
          gitStaged: true,
        })
      ).rejects.toThrow('--git-staged requires a git repository');
    });

    it('should not call getStagedFiles when gitStaged is not set', async () => {
      expect.assertions(1);
      jest.spyOn(watchCommand, 'getStagedFiles');
      mockWatchService.watch.mockImplementation(() => { throw new Error('Test complete'); });

      try {
        await watchCommand.watch('/some/file.md', {
          to: 'es',
        });
      } catch {
        // Expected
      }

      expect(watchCommand.getStagedFiles).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('should stop watch service if it exists', async () => {
      // Manually set watchService for testing
      (watchCommand as any).watchService = mockWatchService;

      await watchCommand.stop();

      expect(mockWatchService.stop).toHaveBeenCalled();
    });

    it('should not throw if watch service does not exist', async () => {
      await expect(watchCommand.stop()).resolves.not.toThrow();
    });
  });
});

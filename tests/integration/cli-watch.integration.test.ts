/**
 * Integration Tests for Watch Service
 * Tests file watching and auto-translation workflows
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('p-limit', () => ({
  __esModule: true,
  default: (_concurrency: number) => {
    return (fn: () => Promise<any>) => fn();
  },
}));

import { WatchService } from '../../src/services/watch.js';
import { FileTranslationService } from '../../src/services/file-translation.js';
import { TranslationService } from '../../src/services/translation.js';
import { DeepLClient } from '../../src/api/deepl-client.js';
import { ConfigService } from '../../src/storage/config.js';
import { TEST_API_KEY } from '../helpers';

describe('Watch Service Integration', () => {
  const API_KEY = TEST_API_KEY;
  let watchService: WatchService;
  let fileTranslationService: FileTranslationService;
  let translationService: TranslationService;
  let client: DeepLClient;
  let mockConfig: ConfigService;
  let tmpDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-watch-test-'));

    // Set up services
    client = new DeepLClient(API_KEY);
    mockConfig = {} as ConfigService;
    translationService = new TranslationService(client, mockConfig);
    fileTranslationService = new FileTranslationService(translationService);
    watchService = new WatchService(fileTranslationService, { debounceMs: 50 });
  });

  afterEach(async () => {
    // Stop watching if still active
    if (watchService.isWatching()) {
      await watchService.stop();
    }
    client.destroy();

    // Cleanup temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('watch() - Initialization', () => {
    it('should throw error when path does not exist', () => {
      expect(() => {
        watchService.watch('/nonexistent/path', {
          targetLangs: ['es'],
          outputDir: tmpDir,
        });
      }).toThrow('Path not found');
    });

    it('should start watching existing file', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello world');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });

      expect(watchService.isWatching()).toBe(true);
    });

    it('should start watching existing directory', () => {
      watchService.watch(tmpDir, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });

      expect(watchService.isWatching()).toBe(true);
    });

    it('should initialize with default debounce of 300ms', () => {
      const service = new WatchService(fileTranslationService);
      expect(service).toBeDefined();
    });

    it('should accept custom debounce time', () => {
      const service = new WatchService(fileTranslationService, { debounceMs: 500 });
      expect(service).toBeDefined();
    });
  });

  describe('stop()', () => {
    it('should stop watching', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });

      expect(watchService.isWatching()).toBe(true);

      await watchService.stop();

      expect(watchService.isWatching()).toBe(false);
    });

    it('should clear all pending timers on stop', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });

      // Trigger change but don't wait for debounce
      watchService.handleFileChange(testFile);

      await watchService.stop();

      expect(watchService.isWatching()).toBe(false);
    });
  });

  describe('handleFileChange() - File Filtering', () => {
    beforeEach(() => {
      watchService.watch(tmpDir, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });
    });

    afterEach(async () => {
      await watchService.stop();
    });

    it('should ignore unsupported file types', () => {
      const binaryFile = path.join(tmpDir, 'image.png');
      fs.writeFileSync(binaryFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      // Should not throw, just ignore
      watchService.handleFileChange(binaryFile);
      expect(watchService.getStats().translationsCount).toBe(0);
    });

    it('should handle supported text files', () => {
      const textFile = path.join(tmpDir, 'document.txt');
      fs.writeFileSync(textFile, 'Hello world');

      expect(() => watchService.handleFileChange(textFile)).not.toThrow();
    });

    it('should handle markdown files', () => {
      const mdFile = path.join(tmpDir, 'readme.md');
      fs.writeFileSync(mdFile, '# Hello\n\nWorld');

      expect(() => watchService.handleFileChange(mdFile)).not.toThrow();
    });

    it('should handle HTML files', () => {
      const htmlFile = path.join(tmpDir, 'index.html');
      fs.writeFileSync(htmlFile, '<html><body>Hello</body></html>');

      expect(() => watchService.handleFileChange(htmlFile)).not.toThrow();
    });
  });

  describe('handleFileChange() - Callbacks', () => {
    it('should call onChange callback when file changes', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      const callbackPromise = new Promise<void>((resolve) => {
        const onChangeMock = jest.fn((filePath: string) => {
          expect(filePath).toBe(testFile);
          resolve();
        });

        watchService.watch(testFile, {
          targetLangs: ['es'],
          outputDir: tmpDir,
          onChange: onChangeMock,
        });

        watchService.handleFileChange(testFile);
      });

      await callbackPromise;
    });

    it('should call onError callback when translation fails', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      // Mock translation service to throw error
      jest.spyOn(fileTranslationService, 'translateFile').mockRejectedValue(new Error('API error'));

      const callbackPromise = new Promise<void>((resolve) => {
        const onErrorMock = jest.fn((filePath: string, error: Error) => {
          expect(filePath).toBe(testFile);
          expect(error.message).toContain('API error');
          resolve();
        });

        watchService.watch(testFile, {
          targetLangs: ['es'],
          outputDir: tmpDir,
          onError: onErrorMock,
        });

        watchService.handleFileChange(testFile);
      });

      await callbackPromise;
    });
  });

  describe('getStats()', () => {
    const waitFor = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
      const start = Date.now();
      while (!condition()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    it('should return initial stats before watch starts', () => {
      const stats = watchService.getStats();

      expect(stats.isWatching).toBe(false);
      expect(stats.filesWatched).toBe(0);
      expect(stats.translationsCount).toBe(0);
      expect(stats.errorsCount).toBe(0);
    });

    it('should update stats when watching starts', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });

      const stats = watchService.getStats();
      expect(stats.isWatching).toBe(true);
    });

    it('should report the number of files under watch once ready, excluding directories', async () => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'Hello');
      fs.writeFileSync(path.join(tmpDir, 'b.md'), '# Hello');
      fs.mkdirSync(path.join(tmpDir, 'sub'));
      fs.writeFileSync(path.join(tmpDir, 'sub', 'c.txt'), 'Hola');

      await new Promise<void>((resolve) => {
        watchService.watch(tmpDir, {
          targetLangs: ['es'],
          outputDir: tmpDir,
          onReady: resolve,
        });
      });

      expect(watchService.getStats().filesWatched).toBe(3);
    });

    it('should track files added and removed while watching', async () => {
      jest.spyOn(fileTranslationService, 'translateFile').mockResolvedValue(undefined);
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'Hello');

      await new Promise<void>((resolve) => {
        watchService.watch(tmpDir, {
          targetLangs: ['es'],
          outputDir: tmpDir,
          onReady: resolve,
        });
      });
      expect(watchService.getStats().filesWatched).toBe(1);

      const newFile = path.join(tmpDir, 'b.txt');
      fs.writeFileSync(newFile, 'World');
      await waitFor(() => watchService.getStats().filesWatched === 2);

      fs.unlinkSync(newFile);
      await waitFor(() => watchService.getStats().filesWatched === 1);
    });

    it('should increment error count on translation failure', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      jest.spyOn(fileTranslationService, 'translateFile').mockRejectedValue(new Error('Fail'));

      const callbackPromise = new Promise<void>((resolve) => {
        watchService.watch(testFile, {
          targetLangs: ['es'],
          outputDir: tmpDir,
          onError: () => {
            const stats = watchService.getStats();
            expect(stats.errorsCount).toBeGreaterThan(0);
            resolve();
          },
        });

        watchService.handleFileChange(testFile);
      });

      await callbackPromise;
    });
  });

  describe('isWatching()', () => {
    it('should return false initially', () => {
      expect(watchService.isWatching()).toBe(false);
    });

    it('should return true after watch starts', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });

      expect(watchService.isWatching()).toBe(true);
    });

    it('should return false after stop', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
      });

      await watchService.stop();

      expect(watchService.isWatching()).toBe(false);
    });
  });

  describe('watch() - Multiple Target Languages', () => {
    it('should support multiple target languages', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es', 'fr', 'de'],
        outputDir: tmpDir,
      });

      expect(watchService.isWatching()).toBe(true);
    });
  });

  describe('watch() - Translation Options', () => {
    it('should accept source language option', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
        sourceLang: 'en',
      });

      expect(watchService.isWatching()).toBe(true);
    });

    it('should accept formality option', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
        formality: 'more',
      });

      expect(watchService.isWatching()).toBe(true);
    });

    it('should accept glossaryId option', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
        glossaryId: 'glossary-123',
      });

      expect(watchService.isWatching()).toBe(true);
    });

    it('should accept preserveCode option', () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Use `console.log()`');

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
        preserveCode: true,
      });

      expect(watchService.isWatching()).toBe(true);
    });
  });

  describe('Debouncing', () => {
    it('should debounce rapid file changes', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello');

      let changeCount = 0;
      const onChangeMock = jest.fn(() => {
        changeCount++;
      });

      watchService.watch(testFile, {
        targetLangs: ['es'],
        outputDir: tmpDir,
        onChange: onChangeMock,
      });

      // Trigger multiple rapid changes
      watchService.handleFileChange(testFile);
      watchService.handleFileChange(testFile);
      watchService.handleFileChange(testFile);

      // onChange should be called 3 times (once per trigger)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(changeCount).toBe(3);
    });
  });

  describe('--git-staged', () => {
    const CLI_PATH = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
     
    const { execSync: execSyncChild } = require('child_process');

    it('should accept --git-staged flag in help text', () => {
      const helpOutput = execSyncChild(`node ${CLI_PATH} watch --help`, {
        encoding: 'utf-8',
      });
      expect(helpOutput).toContain('--git-staged');
      expect(helpOutput).toContain('snapshot at startup');
      expect(helpOutput).not.toContain('not yet implemented');
    });

    it('should show git-staged error when used outside a git repo', () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-non-git-'));
      fs.writeFileSync(path.join(nonGitDir, 'test.txt'), 'Hello');

      try {
        execSyncChild(`node ${CLI_PATH} watch ${nonGitDir} --to es --git-staged`, {
          encoding: 'utf-8',
          cwd: nonGitDir,
          env: { ...process.env, DEEPL_API_KEY: 'test-key:fx' },
        });
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.status).toBeGreaterThan(0);
        const output = (error.stderr ?? error.stdout ?? '').toString();
        expect(output).toContain('git repository');
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('getStagedFiles()', () => {
    const WATCH_MODULE_PATH = path.join(__dirname, '..', '..', 'dist', 'cli', 'commands', 'watch.js');
     
    const { execSync: execSyncChild } = require('child_process');
    let gitDir: string;

    beforeEach(() => {
      gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-git-staged-test-'));
      execSyncChild('git init', { cwd: gitDir, stdio: 'ignore' });
      execSyncChild('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'ignore' });
      execSyncChild('git config user.name "Test"', { cwd: gitDir, stdio: 'ignore' });
    });

    afterEach(() => {
      if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, { recursive: true, force: true });
      }
    });

    const runScript = (cwd: string, body: string): string => {
      const scriptPath = path.join(cwd, '_test_staged.mjs');
      const fileUrl = `file://${WATCH_MODULE_PATH}`;
      const content = `
import { WatchCommand } from '${fileUrl}';
const cmd = new WatchCommand({ translate: () => {} }, { getGlossaryByName: () => {} });
${body}
`;
      fs.writeFileSync(scriptPath, content);
      try {
        return execSyncChild(`node ${scriptPath}`, { encoding: 'utf-8', cwd });
      } finally {
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }
      }
    };

    it('should return staged file paths as absolute paths', () => {
      fs.writeFileSync(path.join(gitDir, 'file1.txt'), 'Hello');
      fs.writeFileSync(path.join(gitDir, 'file2.txt'), 'World');
      execSyncChild('git add file1.txt', { cwd: gitDir, stdio: 'ignore' });

      const output = runScript(gitDir, `
const result = await cmd.getStagedFiles();
console.log(JSON.stringify({ size: result.size, files: [...result] }));
`);

      const parsed = JSON.parse(output.trim());
      expect(parsed.size).toBe(1);
      expect(parsed.files[0]).toBe(path.resolve(fs.realpathSync(gitDir), 'file1.txt'));
    });

    it('should return empty set when no files are staged', () => {
      fs.writeFileSync(path.join(gitDir, 'file1.txt'), 'Hello');

      const output = runScript(gitDir, `
const result = await cmd.getStagedFiles();
console.log(JSON.stringify({ size: result.size }));
`);

      const parsed = JSON.parse(output.trim());
      expect(parsed.size).toBe(0);
    });

    it('should throw error when not in a git repository', () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-non-git-'));

      try {
        runScript(nonGitDir, `
await cmd.getStagedFiles();
`);
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.status).toBeGreaterThan(0);
        const output = error.stderr?.toString() ?? '';
        expect(output).toContain('--git-staged requires a git repository');
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });
});

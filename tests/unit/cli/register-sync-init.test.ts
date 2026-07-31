/**
 * Unit tests for `deepl sync init`'s flag vocabulary.
 *
 * --source-locale / --target-locales are the only accepted spellings; the
 * --source-lang / --target-langs aliases are rejected outright rather than
 * silently accepted.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerSync } from '../../../src/cli/commands/register-sync';
import type { ServiceDeps } from '../../../src/cli/commands/service-factory';

function makeDeps(handleError: jest.Mock): ServiceDeps {
  return {
    createDeepLClient: jest.fn(),
    getApiKeyAndOptions: jest.fn(),
    getConfigService: jest.fn(),
    getCacheService: jest.fn(),
    handleError: handleError as unknown as ServiceDeps['handleError'],
  };
}

async function runSyncInit(argv: string[], deps: ServiceDeps): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSync(program, deps);
  await program.parseAsync(['node', 'deepl', 'sync', 'init', ...argv]);
}

describe('deepl sync init flag vocabulary', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stderrSpy: jest.SpyInstance;
  let stderrChunks: string[];
  let handleError: jest.Mock;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-init-vocab-'));
    fs.mkdirSync(path.join(tmpDir, 'locales'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'locales', 'en.json'), '{}');
    process.chdir(tmpDir);

    stderrChunks = [];
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: unknown): boolean => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      });

    handleError = jest.fn();
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function stderrText(): string {
    return stderrChunks.join('');
  }

  it('--source-locale and --target-locales succeed without a deprecation warning', async () => {
    const deps = makeDeps(handleError);
    await runSyncInit(
      [
        '--source-locale', 'en',
        '--target-locales', 'de,fr',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ],
      deps,
    );
    expect(handleError).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, '.deepl-sync.yaml'))).toBe(true);
    expect(stderrText()).not.toMatch(/\[deprecated\]/);
  });

  it.each([
    ['--source-lang', 'en'],
    ['--target-langs', 'de,fr'],
  ])('rejects the removed %s alias as an unknown option', async (flag, value) => {
    const deps = makeDeps(handleError);
    await expect(
      runSyncInit(
        [
          '--source-locale', 'en',
          '--target-locales', 'de,fr',
          '--file-format', 'json',
          '--path', 'locales/en.json',
          flag, value,
        ],
        deps,
      ),
    ).rejects.toThrow(new RegExp(`unknown option '${flag}'`));
    expect(fs.existsSync(path.join(tmpDir, '.deepl-sync.yaml'))).toBe(false);
  });

  it('no longer emits a deprecation warning for the canonical flags', async () => {
    const deps = makeDeps(handleError);
    await runSyncInit(
      [
        '--source-locale', 'en',
        '--target-locales', 'de',
        '--file-format', 'json',
        '--path', 'locales/en.json',
      ],
      deps,
    );
    expect(handleError).not.toHaveBeenCalled();
    const yaml = fs.readFileSync(path.join(tmpDir, '.deepl-sync.yaml'), 'utf-8');
    expect(yaml).toMatch(/source_locale:\s*en/);
    expect(stderrText()).not.toMatch(/\[deprecated\]/);
  });
});

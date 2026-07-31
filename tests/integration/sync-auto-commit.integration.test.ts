/**
 * Auto-commit preflight integration tests.
 *
 * These tests exercise `SyncCommand.run({ autoCommit: true })` against a real
 * git repository initialized in a temp dir. The preflight semantics are
 * git-specific (dirty tree detection, mid-rebase, detached HEAD) — mocking
 * git defeats the point.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.unmock('child_process');
jest.unmock('fast-glob');

import nock from 'nock';
import { SyncCommand } from '../../src/cli/commands/sync-command';
import { SyncService } from '../../src/sync/sync-service';
import { TranslationService } from '../../src/services/translation';
import { GlossaryService } from '../../src/services/glossary';
import { DeepLClient } from '../../src/api/deepl-client';
import { FormatRegistry } from '../../src/formats/index';
import { JsonFormatParser } from '../../src/formats/json';
import { ValidationError } from '../../src/utils/errors';
import { DEEPL_FREE_API_URL, TEST_API_KEY } from '../helpers/nock-setup';
import { createMockConfigService, createMockCacheService } from '../helpers/mock-factories';

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' });
}

function initRepo(cwd: string): void {
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
}

function createServices() {
  const client = new DeepLClient(TEST_API_KEY, { maxRetries: 0 });
  const mockConfig = createMockConfigService({
    get: jest.fn(() => ({
      auth: {},
      api: { baseUrl: '', usePro: false },
      defaults: { targetLangs: [], formality: 'default', preserveFormatting: false },
      cache: { enabled: false },
      output: { format: 'text', color: true },
      proxy: {},
    })),
    getValue: jest.fn(() => false),
  });
  const mockCache = createMockCacheService();
  const translationService = new TranslationService(client, mockConfig, mockCache);
  const glossaryService = new GlossaryService(client);
  const registry = new FormatRegistry();
  registry.register(new JsonFormatParser());
  const syncService = new SyncService(translationService, glossaryService, registry);
  return { client, syncService };
}

const SYNC_YAML = `version: 1
source_locale: en
target_locales:
  - de
buckets:
  json:
    include:
      - "locales/en.json"
`;

const SOURCE_JSON = JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n';

function seedTranslateMock(): nock.Scope {
  return nock(DEEPL_FREE_API_URL)
    .post('/v2/translate')
    .reply(200, {
      translations: [
        { text: 'Hallo', detected_source_language: 'EN', billed_characters: 5 },
      ],
    });
}

function seedRepo(tmpDir: string): void {
  initRepo(tmpDir);
  fs.writeFileSync(path.join(tmpDir, '.deepl-sync.yaml'), SYNC_YAML, 'utf-8');
  fs.mkdirSync(path.join(tmpDir, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'locales', 'en.json'), SOURCE_JSON, 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n', 'utf-8');
  git(tmpDir, ['add', '.']);
  git(tmpDir, ['commit', '-q', '-m', 'initial']);
}

const describeIfGit = gitAvailable() ? describe : describe.skip;

describeIfGit('SyncCommand auto-commit preflight', () => {
  let tmpDir: string;
  let client: DeepLClient;
  let syncService: SyncService;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-autocommit-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    const services = createServices();
    client = services.client;
    syncService = services.syncService;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    client.destroy();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    nock.cleanAll();
  });

  it('clean repo: auto-commit succeeds and stages only translation targets + lockfile', async () => {
    seedRepo(tmpDir);
    const scope = seedTranslateMock();

    const command = new SyncCommand(syncService);
    await command.run({ autoCommit: true });

    expect(scope.isDone()).toBe(true);

    const head = git(tmpDir, ['rev-parse', 'HEAD']);
    const firstCommit = git(tmpDir, ['rev-list', '--max-parents=0', 'HEAD']).trim();
    expect(head.trim()).not.toBe(firstCommit);

    const branch = git(tmpDir, ['symbolic-ref', '--short', 'HEAD']).trim();
    expect(branch).toBe('main');

    const changedFiles = git(tmpDir, ['show', '--name-only', '--pretty=format:', 'HEAD'])
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .sort();
    expect(changedFiles).toEqual(['.deepl-sync.lock', 'locales/de.json']);

    const msg = git(tmpDir, ['log', '-1', '--pretty=%s']).trim();
    expect(msg).toContain('chore(i18n)');
    expect(msg).toContain('de');
  });

  it('dirty tree with unrelated changes: auto-commit refused with ValidationError naming offending files', async () => {
    expect.assertions(5);
    seedRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# changed\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export {};\n', 'utf-8');
    const scope = seedTranslateMock();

    const command = new SyncCommand(syncService);

    await expect(command.run({ autoCommit: true })).rejects.toThrow(ValidationError);
    try {
      await command.run({ autoCommit: true });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/Refusing to auto-commit/i);
      expect(msg).toContain('README.md');
      expect(msg).toContain('src.ts');
    }

    scope.persist();
    nock.cleanAll();

    const headMsg = git(tmpDir, ['log', '-1', '--pretty=%s']).trim();
    expect(headMsg).toBe('initial');
  });

  it('mid-rebase state: auto-commit refused', async () => {
    expect.assertions(3);
    seedRepo(tmpDir);
    // Simulate a mid-rebase repo by writing the rebase-merge directory.
    const rebaseDir = path.join(tmpDir, '.git', 'rebase-merge');
    fs.mkdirSync(rebaseDir, { recursive: true });
    fs.writeFileSync(path.join(rebaseDir, 'head-name'), 'refs/heads/main\n', 'utf-8');
    seedTranslateMock();

    const command = new SyncCommand(syncService);
    await expect(command.run({ autoCommit: true })).rejects.toThrow(ValidationError);
    try {
      await command.run({ autoCommit: true });
    } catch (err) {
      expect((err as Error).message).toMatch(/Refusing to auto-commit/i);
      expect((err as Error).message).toMatch(/rebase|merge|cherry-pick|in progress/i);
    }
  });

  it('detached HEAD: auto-commit refused', async () => {
    expect.assertions(3);
    seedRepo(tmpDir);
    // Add a second commit then detach at the first.
    fs.writeFileSync(path.join(tmpDir, 'x.txt'), 'x\n', 'utf-8');
    git(tmpDir, ['add', 'x.txt']);
    git(tmpDir, ['commit', '-q', '-m', 'second']);
    const first = git(tmpDir, ['rev-list', '--max-parents=0', 'HEAD']).trim();
    git(tmpDir, ['checkout', '-q', first]);
    seedTranslateMock();

    const command = new SyncCommand(syncService);
    await expect(command.run({ autoCommit: true })).rejects.toThrow(ValidationError);
    try {
      await command.run({ autoCommit: true });
    } catch (err) {
      expect((err as Error).message).toMatch(/Refusing to auto-commit/i);
      expect((err as Error).message).toMatch(/HEAD is detached/i);
    }
  });

  // A refusal leaves translations on disk, so a retry has nothing new to
  // translate — and must still refuse rather than report success.
  it('retry after a refusal refuses again instead of reporting success', async () => {
    expect.assertions(4);
    seedRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# changed\n', 'utf-8');
    const scope = seedTranslateMock();
    scope.persist();

    const command = new SyncCommand(syncService);
    await expect(command.run({ autoCommit: true })).rejects.toThrow(ValidationError);

    // Written before the refusal, so the retry finds nothing to translate.
    expect(fs.existsSync(path.join(tmpDir, 'locales', 'de.json'))).toBe(true);

    await expect(command.run({ autoCommit: true })).rejects.toThrow(/Refusing to auto-commit/i);

    nock.cleanAll();
    expect(git(tmpDir, ['log', '-1', '--pretty=%s']).trim()).toBe('initial');
  });

  // A translation awaiting a commit is this sync's own output, not an unrelated
  // modification, so it is committed once the tree is otherwise clean.
  it('commits a translation left behind by an earlier refusal once the tree is otherwise clean', async () => {
    expect.assertions(4);
    seedRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# changed\n', 'utf-8');
    const scope = seedTranslateMock();
    scope.persist();

    const command = new SyncCommand(syncService);
    await expect(command.run({ autoCommit: true })).rejects.toThrow(ValidationError);
    expect(fs.existsSync(path.join(tmpDir, 'locales', 'de.json'))).toBe(true);

    // Deal with the unrelated change; the leftover translation remains.
    git(tmpDir, ['checkout', '--', 'README.md']);

    await command.run({ autoCommit: true });

    nock.cleanAll();
    expect(git(tmpDir, ['log', '-1', '--pretty=%s']).trim()).toContain('chore(i18n)');
    expect(git(tmpDir, ['status', '--porcelain']).trim()).toBe('');
  });

  // Watch mode runs this path once per trigger: each must refuse while a commit
  // is owed, and stay silent once nothing is.
  it('refuses consistently across repeated triggers and stays quiet when there is nothing to commit', async () => {
    expect.assertions(4);
    seedRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export {};\n', 'utf-8');
    const scope = seedTranslateMock();
    scope.persist();

    const command = new SyncCommand(syncService);
    await expect(command.run({ autoCommit: true })).rejects.toThrow(/Refusing to auto-commit/i);
    await expect(command.run({ autoCommit: true })).rejects.toThrow(/Refusing to auto-commit/i);

    // Nothing left to commit: neither throws nor commits.
    fs.unlinkSync(path.join(tmpDir, 'src.ts'));
    git(tmpDir, ['add', '-A']);
    git(tmpDir, ['commit', '-q', '-m', 'tidy']);

    await command.run({ autoCommit: true });

    nock.cleanAll();
    expect(git(tmpDir, ['log', '-1', '--pretty=%s']).trim()).toBe('tidy');
    expect(git(tmpDir, ['status', '--porcelain']).trim()).toBe('');
  });

  it('clean repo, no lockfile update: auto-commit does not fail staging a nonexistent lockfile', async () => {
    seedRepo(tmpDir);
    const scope = seedTranslateMock();

    // Run once to establish a lock file, then commit it ourselves so the next
    // sync finds nothing to do (no lock write, no file writes).
    const command = new SyncCommand(syncService);
    await command.run({ autoCommit: true });
    expect(scope.isDone()).toBe(true);

    // Delete the lockfile without committing its removal, then sync again.
    // The second sync must not stage .deepl-sync.lock when it wasn't produced.
    // To simulate the "no lockfile written" case cleanly, we re-run with
    // identical source — no diffs, no writes.
    // First ensure the tree is clean.
    git(tmpDir, ['status', '--porcelain']); // sanity

    // Second run: no API mocks needed since nothing to translate.
    const command2 = new SyncCommand(syncService);
    await expect(command2.run({ autoCommit: true })).resolves.toBeDefined();
    // HEAD should be the auto-commit from the first run; no new commit.
    const commitCount = git(tmpDir, ['rev-list', '--count', 'HEAD']).trim();
    expect(Number(commitCount)).toBe(2);
  });
});

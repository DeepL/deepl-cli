/**
 * Security integration tests: `sync export` must refuse to read source files
 * that resolve outside the configured project root.
 *
 * `followSymbolicLinks: false` in the bucket walker already prevents
 * fast-glob from traversing symlinks inside the project tree. But an
 * attacker who can influence `.deepl-sync.yaml` can still point a bucket's
 * `include` pattern at an absolute path outside the project (e.g.
 * `/etc/passwd` or a sibling repo containing secrets), and fast-glob will
 * happily resolve and return that absolute path. The export pipeline would
 * then read the file and embed its contents in the generated XLIFF.
 *
 * Every source file is root-anchored against `config.projectRoot` via
 * `assertPathWithinRoot`, matching the `--output` destination guard.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.unmock('fast-glob');

import { exportTranslations } from '../../src/sync/sync-export';
import { loadSyncConfig } from '../../src/sync/sync-config';
import { ValidationError } from '../../src/utils/errors';

import { createSyncHarness, writeSyncConfig } from '../helpers/sync-harness';

function writeJson(dir: string, relPath: string, obj: unknown): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

describe('sync export source-side path-traversal safety', () => {
  let projectDir: string;
  let outsideDir: string;
  let outsideSecret: string;
  let harness: ReturnType<typeof createSyncHarness>;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-export-traversal-proj-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-sync-export-traversal-secret-'));
    outsideSecret = path.join(outsideDir, 'secret.json');
    fs.writeFileSync(
      outsideSecret,
      JSON.stringify({ exfiltrated: 'TOP_SECRET_VALUE' }, null, 2),
      'utf-8',
    );
    harness = createSyncHarness({ parsers: ['json'] });
  });

  afterEach(() => {
    harness.cleanup();
    if (fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true, force: true });
    if (fs.existsSync(outsideDir)) fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('rejects an absolute include pattern at config load', async () => {
    writeJson(projectDir, 'locales/en.json', { greeting: 'Hello' });
    writeSyncConfig(projectDir, {
      targetLocales: ['de'],
      // Absolute include patterns bypass the cwd-anchored fast-glob search.
      buckets: { json: { include: [path.join(outsideDir, '*.json')] } },
    });

    // Containment is now enforced at the boundary, so such a config never
    // loads — the export-time guard below is the second line of defence.
    await expect(loadSyncConfig(projectDir)).rejects.toThrow(/relative to the project root/);
  });

  it('still rejects an out-of-root source file at export time', async () => {
    writeJson(projectDir, 'locales/en.json', { greeting: 'Hello' });
    writeSyncConfig(projectDir, {
      targetLocales: ['de'],
      buckets: { json: { include: ['locales/*.json'] } },
    });
    const config = await loadSyncConfig(projectDir);

    // Bypass config validation to prove the export pipeline guards
    // independently: defence in depth, in case a glob reaches it another way.
    const escaping = {
      ...config,
      buckets: { json: { include: [path.join(outsideDir, '*.json')] } },
    };

    await expect(exportTranslations(escaping, harness.registry)).rejects.toThrow(ValidationError);
    await expect(exportTranslations(escaping, harness.registry)).rejects.toThrow(
      /escapes project root/,
    );
  });

  it('does not embed outside-the-root file contents in the XLIFF output', async () => {
    writeJson(projectDir, 'locales/en.json', { greeting: 'Hello' });
    writeSyncConfig(projectDir, {
      targetLocales: ['de'],
      buckets: { json: { include: ['locales/*.json'] } },
    });

    const loaded = await loadSyncConfig(projectDir);
    // Escaping include injected past config validation, so this asserts the
    // export pipeline's own guard rather than the boundary check.
    const config = {
      ...loaded,
      buckets: { json: { include: [path.join(outsideDir, '*.json')] } },
    };

    let caught: unknown;
    let result: Awaited<ReturnType<typeof exportTranslations>> | undefined;
    try {
      result = await exportTranslations(config, harness.registry);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(result).toBeUndefined();
    // And make sure the secret never leaked into an XLIFF buffer.
    // (result is undefined, so this is belt-and-braces.)
    if (result !== undefined) {
      expect((result as { content: string }).content).not.toContain('TOP_SECRET_VALUE');
    }
  });

  it('allows source paths inside the project root', async () => {
    writeJson(projectDir, 'locales/en.json', { greeting: 'Hello' });
    writeSyncConfig(projectDir, {
      targetLocales: ['de'],
      buckets: { json: { include: ['locales/*.json'] } },
    });

    const config = await loadSyncConfig(projectDir);
    const result = await exportTranslations(config, harness.registry);

    expect(result.files).toBe(1);
    expect(result.keys).toBe(1);
    expect(result.content).toContain('<source>Hello</source>');
  });
});

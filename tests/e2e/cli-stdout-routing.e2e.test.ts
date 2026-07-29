/**
 * E2E Tests for stdout routing of primary command reports
 * The human-readable report of sync status/validate/audit/init and
 * auth show must land on stdout so shell redirection captures it;
 * diagnostics and progress stay on stderr.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createTestConfigDir, createTestDir } from '../helpers';

const CLI_PATH = path.join(process.cwd(), 'dist/cli/index.js');

describe('CLI stdout routing E2E', () => {
  const testConfig = createTestConfigDir('e2e-stdout-routing');
  const testFiles = createTestDir('e2e-stdout-routing-files');

  function runStdout(args: string, cwd: string = testFiles.path): string {
    // execSync returns stdout only; stderr is piped away separately.
    return execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      cwd,
      env: {
        ...process.env,
        DEEPL_CONFIG_DIR: testConfig.path,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
  }

  function writeSyncProject(): void {
    const yaml = [
      'version: 1',
      'source_locale: en',
      'target_locales:',
      '  - de',
      'buckets:',
      '  json:',
      '    include:',
      '      - "locales/en.json"',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(testFiles.path, '.deepl-sync.yaml'), yaml);
    const dir = path.join(testFiles.path, 'locales');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'en.json'),
      JSON.stringify({ greeting: 'Hello' }, null, 2) + '\n',
    );
    fs.writeFileSync(
      path.join(dir, 'de.json'),
      JSON.stringify({ greeting: 'Hallo' }, null, 2) + '\n',
    );
  }

  beforeAll(() => {
    writeSyncProject();
  });

  afterAll(() => {
    testConfig.cleanup();
    testFiles.cleanup();
  });

  it('sync status prints the coverage report on stdout', () => {
    const stdout = runStdout('sync status');

    expect(stdout).toContain('Source: en');
    expect(stdout).toContain('de');
  });

  it('sync validate prints the validation report on stdout', () => {
    const stdout = runStdout('sync validate');

    expect(stdout).toMatch(/Checked \d+ translations/);
  });

  it('sync audit prints the audit report on stdout', () => {
    const stdout = runStdout('sync audit');

    expect(stdout).toMatch(/Audit: \d+ unique source terms/);
  });

  it('sync init prints the created-config line on stdout', () => {
    const initDir = createTestDir('e2e-stdout-routing-init');
    try {
      const localesDir = path.join(initDir.path, 'locales');
      fs.mkdirSync(localesDir, { recursive: true });
      fs.writeFileSync(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ greeting: 'Hello' }) + '\n',
      );

      const stdout = runStdout(
        'sync init --source-locale en --target-locales de --file-format json --path "locales/en.json"',
        initDir.path,
      );

      expect(stdout).toContain('Created');
      expect(stdout).toContain('.deepl-sync.yaml');
    } finally {
      initDir.cleanup();
    }
  });

  it('auth show prints the masked key on stdout', () => {
    const authConfig = createTestConfigDir('e2e-stdout-routing-auth');
    try {
      fs.writeFileSync(
        path.join(authConfig.path, 'config.json'),
        JSON.stringify({ auth: { apiKey: 'abcd1234-5678-90ef-ghij-klmnopqrwxyz' } }),
      );
      const stdout = execSync(`node ${CLI_PATH} auth show`, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          DEEPL_CONFIG_DIR: authConfig.path,
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
      });

      expect(stdout).toContain('abcd');
      expect(stdout).toContain('wxyz');
    } finally {
      authConfig.cleanup();
    }
  });
});

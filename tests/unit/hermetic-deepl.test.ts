/**
 * Tests that the bare `deepl` command resolves to the test shim and executes
 * this tree's built CLI, so suites that shell out to `deepl` are independent
 * of any globally installed copy.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('hermetic deepl shim', () => {
  it('resolves `deepl` to the shim directory, ahead of any global install', () => {
    const resolved = execSync('command -v deepl', {
      encoding: 'utf-8',
      shell: '/bin/sh',
    }).trim();

    expect(resolved).toBe(path.join(process.env['DEEPL_CLI_TEST_SHIM']!, 'deepl'));
  });

  it('executes the built CLI from this tree', () => {
    const version = execSync('deepl --version', { encoding: 'utf-8' }).trim();
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { version: string };

    expect(version).toBe(pkg.version);
  });

  describe('credential isolation', () => {
    // A spawned CLI cannot be intercepted by nock, so an inherited real key
    // reaches the live API. These assert the suite never carries one.
    it.each(['DEEPL_API_KEY', 'TMS_API_KEY', 'TMS_TOKEN'])(
      'does not carry %s in the inherited environment',
      (name) => {
        expect(process.env[name]).toBeUndefined();
      },
    );

    it('points DEEPL_CONFIG_DIR at a temporary directory, not the real one', () => {
      const configDir = process.env['DEEPL_CONFIG_DIR'];

      expect(configDir).toBeDefined();
      expect(configDir!.startsWith(os.tmpdir())).toBe(true);
    });

    it('reports no API key to a bare spawned command', () => {
      const output = execSync('deepl auth show 2>&1 || true', {
        encoding: 'utf-8',
        shell: '/bin/sh',
      });

      expect(output).toMatch(/no api key|not set|not configured/i);
    });
  });
});

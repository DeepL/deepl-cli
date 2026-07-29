/**
 * Tests that the bare `deepl` command resolves to the test shim and executes
 * this tree's built CLI, so suites that shell out to `deepl` are independent
 * of any globally installed copy.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
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
});

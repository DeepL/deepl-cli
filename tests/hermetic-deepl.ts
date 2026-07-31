/**
 * Puts a `deepl` shim on PATH that execs this repo's built CLI, so tests that
 * shell out to the bare `deepl` command always run dist/cli/index.js — never a
 * globally installed copy, which may be absent (failing every such test with
 * "command not found") or a different version than the tree under test.
 *
 * The shim directory is created once per jest worker process and advertised
 * through DEEPL_CLI_TEST_SHIM so subsequent suites in the same worker reuse it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_ENTRY = path.join(process.cwd(), 'dist', 'cli', 'index.js');

export default function installHermeticDeepl(): void {
  const existing = process.env['DEEPL_CLI_TEST_SHIM'];
  if (existing && fs.existsSync(path.join(existing, 'deepl'))) return;

  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepl-cli-shim-'));
  fs.writeFileSync(path.join(shimDir, 'deepl'), `#!/bin/sh\nexec node "${CLI_ENTRY}" "$@"\n`, {
    mode: 0o755,
  });
  process.env['DEEPL_CLI_TEST_SHIM'] = shimDir;
  process.env['PATH'] = `${shimDir}${path.delimiter}${process.env['PATH'] ?? ''}`;
}

/**
 * Removes real credentials and the real config directory from the environment
 * the suite inherits.
 *
 * nock cannot intercept across a process boundary, so a spawned CLI holding a
 * working DEEPL_API_KEY reaches the live API and the real cache. Suites that
 * need a key pass one explicitly, which still overrides this.
 */
export function isolateCredentialEnvironment(): void {
  delete process.env['DEEPL_API_KEY'];
  delete process.env['TMS_API_KEY'];
  delete process.env['TMS_TOKEN'];

  process.env['DEEPL_CONFIG_DIR'] ??= fs.mkdtempSync(
    path.join(os.tmpdir(), 'deepl-cli-test-config-'),
  );
}

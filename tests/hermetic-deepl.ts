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

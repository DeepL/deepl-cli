/**
 * Fails fast when tests run without a current build. dist/ is gitignored and
 * `npm test` does not build, yet all three tiers execute dist/cli/index.js: a
 * missing build surfaces as hundreds of unrelated failures, and a stale one
 * silently tests different source than the tree holds.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const CLI_ENTRY = path.join(ROOT, 'dist', 'cli', 'index.js');
const SRC = path.join(ROOT, 'src');

function fail(reason: string, detail: string): never {
  throw new Error(
    ['', reason, '', detail, '', 'Run:', '', '  npm run build && npm test', ''].join('\n'),
  );
}

function newestModified(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory()
      ? newestModified(full)
      : fs.statSync(full).mtimeMs;
    if (mtime > newest) {
      newest = mtime;
    }
  }
  return newest;
}

export default function requireBuild(): void {
  if (!fs.existsSync(CLI_ENTRY)) {
    fail(
      'Tests require a build, but dist/cli/index.js does not exist.',
      `  Expected: ${CLI_ENTRY}\n\ndist/ is gitignored, so a fresh checkout or a pull has no built output.`,
    );
  }

  const builtAt = fs.statSync(CLI_ENTRY).mtimeMs;
  const sourceChangedAt = newestModified(SRC);

  if (sourceChangedAt > builtAt) {
    fail(
      'Tests require a current build, but src/ is newer than dist/.',
      'The suites execute dist/cli/index.js, so they would test the previously\nbuilt CLI and report results that do not describe your changes.',
    );
  }
}

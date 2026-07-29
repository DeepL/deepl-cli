/**
 * Fails fast with an actionable message when tests run without a build:
 * dist/ is gitignored and `npm test` does not build, yet all three test
 * tiers execute dist/cli/index.js, so a missing build otherwise surfaces
 * as hundreds of unrelated failures.
 */

import * as fs from 'fs';
import * as path from 'path';

const CLI_ENTRY = path.join(process.cwd(), 'dist', 'cli', 'index.js');

export default function requireBuild(): void {
  if (fs.existsSync(CLI_ENTRY)) return;

  throw new Error(
    [
      '',
      'Tests require a build, but dist/cli/index.js does not exist.',
      '',
      `  Expected: ${CLI_ENTRY}`,
      '',
      'Run:',
      '',
      '  npm run build && npm test',
      '',
      'dist/ is gitignored, so a fresh checkout or a pull has no built output.',
      'Note that a STALE dist is also a hazard: it makes the E2E suites test',
      'the previously built CLI rather than your current source.',
      '',
    ].join('\n'),
  );
}

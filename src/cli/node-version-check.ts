/**
 * Startup engine check. Runs before anything that can load node:sqlite so
 * unsupported runtimes get one clear line instead of an ExperimentalWarning
 * or a native-module crash.
 */

import { ExitCode } from '../utils/exit-codes.js';

export const MIN_NODE_MAJOR = 24;

/**
 * Return the error line for an unsupported Node.js version, or null when the
 * version is supported. Unparseable versions fail open.
 */
export function unsupportedNodeVersionMessage(
  version: string = process.versions.node,
): string | null {
  const major = Number(version.split('.')[0]);
  if (!Number.isInteger(major) || major >= MIN_NODE_MAJOR) {
    return null;
  }
  return `deepl requires Node.js >= ${MIN_NODE_MAJOR}, you are running v${version}. Upgrade Node.js to use the DeepL CLI.`;
}

export function assertSupportedNodeVersion(
  version: string = process.versions.node,
): void {
  const message = unsupportedNodeVersionMessage(version);
  if (message) {
    console.error(message);
    process.exit(ExitCode.InvalidInput);
  }
}

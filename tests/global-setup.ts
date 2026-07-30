import installHermeticDeepl, { isolateCredentialEnvironment } from './hermetic-deepl';

/**
 * Runs in the main jest process before workers spawn, so the shim's PATH entry
 * lands in the real environment every worker (and every CLI subprocess the
 * tests spawn) inherits. A setupFilesAfterEnv hook cannot do this: test code
 * sees a copied process.env, and mutations there never reach child processes
 * spawned without an explicit env.
 */
export default function globalSetup(): void {
  installHermeticDeepl();
  isolateCredentialEnvironment();
}

/**
 * Terminates the process on SIGINT/SIGTERM with the conventional signal exit
 * code, after every other listener has had its turn.
 *
 * Registering any SIGINT listener suppresses Node's default termination, so
 * something must exit explicitly. Doing it from a component's handler is
 * wrong: whichever component registers first wins, cutting short the cleanup
 * of everything registered later. This handler defers the exit with
 * setImmediate, so it terminates after the synchronous cleanup of all other
 * listeners regardless of registration order.
 */

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

let installed = false;
let gracefulOwner = false;

/**
 * Declares that the running command shuts itself down on a signal and will
 * exit on its own terms. A long-running command such as `sync --watch` treats
 * SIGTERM as its normal stop signal and completes successfully, so forcing a
 * signal exit code there would turn an orderly shutdown into a failure.
 */
export function claimGracefulShutdown(): void {
  gracefulOwner = true;
}

export function installSignalExit(): void {
  if (installed) return;
  installed = true;

  for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    process.on(signal as NodeJS.Signals, () => {
      if (gracefulOwner) return;
      setImmediate(() => process.exit(code));
    });
  }
}

/** Test seam: forget that the handlers were installed. */
export function resetSignalExitForTests(): void {
  installed = false;
  gracefulOwner = false;
}

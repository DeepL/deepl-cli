/**
 * Tests signal handling ownership.
 *
 * Termination belongs to the CLI entry point, not to individual services: a
 * service-level handler calling process.exit() runs before the sync engine's
 * own listener, which would report success (exit 0) on an interrupt and leak
 * the process lock. The entry point defers the exit so every other listener's
 * cleanup runs first.
 */

import {
  installSignalExit,
  claimGracefulShutdown,
  resetSignalExitForTests,
} from '../../src/utils/signal-exit';

describe('signal exit ownership', () => {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    resetSignalExitForTests();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    for (const signal of signals) process.removeAllListeners(signal);
    exitSpy.mockRestore();
    resetSignalExitForTests();
  });

  it.each(signals)('should register a %s listener', (signal) => {
    const before = process.listenerCount(signal);

    installSignalExit();

    expect(process.listenerCount(signal)).toBe(before + 1);
  });

  it('should be idempotent', () => {
    installSignalExit();
    const after = process.listenerCount('SIGINT');

    installSignalExit();

    expect(process.listenerCount('SIGINT')).toBe(after);
  });

  it('should exit 130 on SIGINT rather than 0', async () => {
    installSignalExit();

    process.emit('SIGINT');
    await new Promise((resolve) => setImmediate(resolve));

    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it('should exit 143 on SIGTERM', async () => {
    installSignalExit();

    process.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    expect(exitSpy).toHaveBeenCalledWith(143);
  });

  it('should not force an exit when a command owns its shutdown', async () => {
    // `sync --watch` stops successfully on SIGTERM; forcing 143 there would
    // turn an orderly shutdown into a reported failure.
    installSignalExit();
    claimGracefulShutdown();

    process.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should let another listener finish its cleanup before exiting', async () => {
    const order: string[] = [];
    // Registered AFTER the exit handler, mirroring the sync engine's ordering
    // relative to the cache. The deferred exit must not preempt it.
    installSignalExit();
    process.on('SIGINT', () => order.push('cleanup'));
    exitSpy.mockImplementation((() => order.push('exit')) as never);

    process.emit('SIGINT');
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(['cleanup', 'exit']);
  });
});

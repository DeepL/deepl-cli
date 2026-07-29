import { InvalidArgumentError } from 'commander';

/**
 * Commander option parser for a bounded positive integer.
 *
 * A bare `parseInt` yields NaN for a non-numeric value, and NaN survives the
 * `??` default chains used downstream — so an invalid `--concurrency` reached
 * the worker-pool sizing and silently produced zero workers. Rejecting at the
 * boundary means the user is told instead.
 */
export function parsePositiveIntOption(value: string, name: string, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new InvalidArgumentError(
      `--${name} must be an integer between 1 and ${max}, got '${value}'`,
    );
  }
  return parsed;
}

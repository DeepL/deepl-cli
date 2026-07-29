/**
 * Registering `sync audit` must not load sync-bucket-walker (which pulls
 * fast-glob) at module scope; the walker is only needed inside the action.
 */

const mockLoadTracker = { loaded: false };
jest.mock('../../../src/sync/sync-bucket-walker', () => {
  mockLoadTracker.loaded = true;
  return jest.requireActual('../../../src/sync/sync-bucket-walker');
});

import { Command } from 'commander';

describe('registerSyncAudit lazy loading', () => {
  it('does not load sync-bucket-walker at registration time', async () => {
    const { registerSyncAudit } = await import(
      '../../../src/cli/commands/sync/register-sync-audit'
    );

    const program = new Command();
    registerSyncAudit(program, { handleError: jest.fn() as never });

    expect(mockLoadTracker.loaded).toBe(false);
  });
});

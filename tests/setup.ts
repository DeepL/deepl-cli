import nock from 'nock';
import requireBuild from './require-build';

beforeAll(() => {
  requireBuild();

  if (!nock.isActive()) {
    nock.activate();
  }
  nock.disableNetConnect();
});

afterEach(() => {
  // Assert every interceptor we registered actually fired. An unasserted
  // mock (nock scope registered but never hit by the SUT) is a silent
  // test gap — the test passes but isn't proving what it claims. Capture
  // before cleanup so the message is intact for Jest's diff output.
  const pending = nock.pendingMocks();
  nock.abortPendingRequests();
  nock.cleanAll();
  if (pending.length > 0) {
    // Negative-path tests that intentionally register non-firing interceptors
    // (e.g., to confirm a cache-hit path skips the network) can opt out by
    // calling `nock.cleanAll()` from their own afterEach before this hook runs.
    throw new Error(
      `nock had ${pending.length} unasserted pending interceptor(s) at end of test:\n  ${pending.join('\n  ')}`,
    );
  }
});

afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
  nock.restore();
});

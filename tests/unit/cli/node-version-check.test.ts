import {
  MIN_NODE_MAJOR,
  assertSupportedNodeVersion,
  unsupportedNodeVersionMessage,
} from '../../../src/cli/node-version-check';
import { ExitCode } from '../../../src/utils/exit-codes';

describe('node-version-check', () => {
  describe('unsupportedNodeVersionMessage', () => {
    it('should return a clear one-line message for Node below the minimum', () => {
      const message = unsupportedNodeVersionMessage('22.17.0');

      expect(message).not.toBeNull();
      expect(message).toContain(`Node.js >= ${MIN_NODE_MAJOR}`);
      expect(message).toContain('v22.17.0');
      expect(message).not.toContain('\n');
    });

    it('should return null for the minimum supported major', () => {
      expect(unsupportedNodeVersionMessage('24.0.0')).toBeNull();
    });

    it('should return null for newer majors', () => {
      expect(unsupportedNodeVersionMessage('25.3.1')).toBeNull();
    });

    it('should fail open on unparseable versions', () => {
      expect(unsupportedNodeVersionMessage('weird')).toBeNull();
    });
  });

  describe('assertSupportedNodeVersion', () => {
    it('should exit with InvalidInput on unsupported versions', () => {
      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      assertSupportedNodeVersion('22.0.0');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('v22.0.0'));
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.InvalidInput);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should be a no-op on supported versions', () => {
      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);

      assertSupportedNodeVersion('24.5.0');

      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });
});

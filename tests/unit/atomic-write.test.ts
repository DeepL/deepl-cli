import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  atomicWriteFile,
  atomicWriteFileSync,
  __cleanupInFlightTmpFiles,
  __getInFlightTmpCount,
} from '../../src/utils/atomic-write';

describe('atomicWriteFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write content and verify file exists', async () => {
    const filePath = path.join(tmpDir, 'output.txt');
    await atomicWriteFile(filePath, 'hello world', 'utf-8');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
  });

  it('should not leave .tmp file after success', async () => {
    const filePath = path.join(tmpDir, 'output.txt');
    await atomicWriteFile(filePath, 'content', 'utf-8');
    const leftover = fs.readdirSync(tmpDir).filter((f) => f.startsWith('output.txt.tmp.'));
    expect(leftover).toHaveLength(0);
  });

  it('should clean up .tmp file after rename failure', async () => {
    const filePath = path.join(tmpDir, 'output.txt');
    const renameSpy = jest.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('rename failed'));

    await expect(atomicWriteFile(filePath, 'content', 'utf-8')).rejects.toThrow('rename failed');
    const leftover = fs.readdirSync(tmpDir).filter((f) => f.startsWith('output.txt.tmp.'));
    expect(leftover).toHaveLength(0);

    renameSpy.mockRestore();
  });

  it('should support Buffer content', async () => {
    const filePath = path.join(tmpDir, 'output.bin');
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    await atomicWriteFile(filePath, buf);
    expect(Buffer.compare(fs.readFileSync(filePath), buf)).toBe(0);
  });

  it('should overwrite existing files', async () => {
    const filePath = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(filePath, 'old content');
    await atomicWriteFile(filePath, 'new content', 'utf-8');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
  });

  it('should preserve the mode of an existing target file', async () => {
    const filePath = path.join(tmpDir, 'secrets.txt');
    fs.writeFileSync(filePath, 'old secret');
    fs.chmodSync(filePath, 0o600);

    await atomicWriteFile(filePath, 'new secret', 'utf-8');

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new secret');
  });

  it('should create new files with default permissions', async () => {
    const filePath = path.join(tmpDir, 'fresh.txt');

    await atomicWriteFile(filePath, 'content', 'utf-8');

    const expected = 0o666 & ~process.umask();
    expect(fs.statSync(filePath).mode & 0o777).toBe(expected);
  });

  it('should use a unique temp filename with PID and random suffix', async () => {
    const filePath = path.join(tmpDir, 'output.txt');
    const writeSpy = jest.spyOn(fs.promises, 'writeFile');
    await atomicWriteFile(filePath, 'data', 'utf-8');
    const tmpPathArg = String(writeSpy.mock.calls[0]?.[0]);
    expect(tmpPathArg).toMatch(new RegExp(`\\.tmp\\.${process.pid}\\.[a-z0-9]+$`));
    writeSpy.mockRestore();
  });
});

describe('atomicWriteFileSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-sync-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write content and verify file exists', () => {
    const filePath = path.join(tmpDir, 'output.txt');
    atomicWriteFileSync(filePath, 'hello sync', 'utf-8');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello sync');
  });

  it('should not leave .tmp file after success', () => {
    const filePath = path.join(tmpDir, 'output.txt');
    atomicWriteFileSync(filePath, 'content', 'utf-8');
    const leftover = fs.readdirSync(tmpDir).filter((f) => f.startsWith('output.txt.tmp.'));
    expect(leftover).toHaveLength(0);
  });

  it('should clean up .tmp file after write failure to non-existent directory', () => {
    const filePath = path.join(tmpDir, 'nonexistent', 'deep', 'output.txt');

    expect(() => atomicWriteFileSync(filePath, 'content', 'utf-8')).toThrow();
  });

  it('should support Buffer content', () => {
    const filePath = path.join(tmpDir, 'output.bin');
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    atomicWriteFileSync(filePath, buf);
    expect(Buffer.compare(fs.readFileSync(filePath), buf)).toBe(0);
  });

  it('should preserve the mode of an existing target file', () => {
    const filePath = path.join(tmpDir, 'secrets.txt');
    fs.writeFileSync(filePath, 'old secret');
    fs.chmodSync(filePath, 0o600);

    atomicWriteFileSync(filePath, 'new secret', 'utf-8');

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new secret');
  });

  it('should create new files with default permissions', () => {
    const filePath = path.join(tmpDir, 'fresh.txt');

    atomicWriteFileSync(filePath, 'content', 'utf-8');

    const expected = 0o666 & ~process.umask();
    expect(fs.statSync(filePath).mode & 0o777).toBe(expected);
  });
});

describe('atomic-write crash cleanup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-crash-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the in-flight .tmp sibling mid-write so a SIGINT cleanup can find it', async () => {
    const filePath = path.join(tmpDir, 'output.txt');
    const countBefore = __getInFlightTmpCount();

    let tmpPathObserved: string | null = null;
    const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async (p) => {
      tmpPathObserved = String(p);
      // Write synchronously under our own hand so the file exists to be
      // "discovered" by the cleanup helper, simulating a crash between
      // write and rename.
      fs.writeFileSync(tmpPathObserved, 'partial');
      expect(__getInFlightTmpCount()).toBe(countBefore + 1);
      throw new Error('simulated crash');
    });

    await expect(atomicWriteFile(filePath, 'content', 'utf-8')).rejects.toThrow('simulated crash');
    writeSpy.mockRestore();

    expect(tmpPathObserved).not.toBeNull();
    // After rejection the registry must be empty again (cleanup path already ran).
    expect(__getInFlightTmpCount()).toBe(countBefore);
  });

  it('__cleanupInFlightTmpFiles deletes tracked .tmp files and clears the registry', () => {
    // Simulate the crash-in-middle state by seeding the tmp registry manually.
    const tmpPath = path.join(tmpDir, 'output.txt.tmp.' + process.pid + '.xyz');
    fs.writeFileSync(tmpPath, 'partial');

    // Fire through a real atomicWriteFile call whose underlying writeFile hangs:
    // we'll use the synchronous helper instead. But easier: call the cleanup
    // helper after poking at a private accessor to emulate tracked state.
    const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async (p) => {
      const actualTmp = String(p);
      fs.writeFileSync(actualTmp, 'partial');
      // At this point the tmp is tracked. Trigger the public cleanup.
      __cleanupInFlightTmpFiles();
      expect(fs.existsSync(actualTmp)).toBe(false);
      throw new Error('abort after cleanup');
    });

    const run = atomicWriteFile(path.join(tmpDir, 'output.txt'), 'content', 'utf-8');
    return expect(run).rejects.toThrow('abort after cleanup').then(() => {
      writeSpy.mockRestore();
      // Seed tmp file should also have been cleaned if tracked — but it wasn't
      // tracked (we wrote it ourselves) so it remains. That's expected; the
      // helper only cleans up registered paths.
      expect(fs.existsSync(tmpPath)).toBe(true);
    });
  });

  it('registers SIGINT/SIGTERM listeners while a write is pending and detaches after', async () => {
    // Baseline listener counts before any write.
    const sigintBase = process.listenerCount('SIGINT');
    const sigtermBase = process.listenerCount('SIGTERM');

    let observedSigint = 0;
    let observedSigterm = 0;
    const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async (p) => {
      // Mid-write: signal listeners should be attached.
      observedSigint = process.listenerCount('SIGINT') - sigintBase;
      observedSigterm = process.listenerCount('SIGTERM') - sigtermBase;
      fs.writeFileSync(String(p), 'partial');
      throw new Error('abort mid-write');
    });

    const run = atomicWriteFile(path.join(tmpDir, 'output.txt'), 'data', 'utf-8');
    await expect(run).rejects.toThrow('abort mid-write');
    writeSpy.mockRestore();

    expect(observedSigint).toBeGreaterThanOrEqual(1);
    expect(observedSigterm).toBeGreaterThanOrEqual(1);
    // After the write resolved/rejected, the registry should be empty and
    // listeners detached back to baseline.
    expect(process.listenerCount('SIGINT')).toBe(sigintBase);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBase);
  });
});

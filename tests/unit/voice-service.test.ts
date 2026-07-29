/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/**
 * Tests for VoiceService
 * Covers content type detection, validation, chunking, and transcript accumulation.
 */

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { VoiceService } from '../../src/services/voice.js';
import { VoiceClient } from '../../src/api/voice-client.js';
import { ValidationError, VoiceError } from '../../src/utils/errors.js';
import type { VoiceTranslateOptions } from '../../src/types/voice.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createMockVoiceClient } from '../helpers/mock-factories';

jest.mock('ws', () => {
   
  const { EventEmitter: EE } = require('events');
  class MockWebSocket extends EE {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    send = jest.fn();
    close = jest.fn();
  }
  return { default: MockWebSocket, __esModule: true };
});

function createMockWebSocket() {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    send: jest.Mock;
    close: jest.Mock;
  };
  ws.readyState = 1;
  ws.send = jest.fn();
  ws.close = jest.fn();
  return ws;
}

function setupSessionMock(
  mockClient: jest.Mocked<VoiceClient>,
  sessionId: string,
  mockWs: ReturnType<typeof createMockWebSocket>,
  onOpen: (callbacks: any) => void,
) {
  mockClient.createSession.mockResolvedValue({
    streaming_url: 'wss://test',
    token: 'token',
    session_id: sessionId,
  });
  mockClient.createWebSocket.mockImplementation((_url: string, _token: string, callbacks: any) => {
    process.nextTick(() => {
      mockWs.emit('open');
      process.nextTick(() => onOpen(callbacks));
    });
    return mockWs as any;
  });
}

describe('VoiceService', () => {
  let service: VoiceService;
  let mockClient: jest.Mocked<VoiceClient>;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'] });
    jest.clearAllMocks();
    mockClient = createMockVoiceClient();

    service = new VoiceService(mockClient);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a VoiceService instance', () => {
      expect(service).toBeInstanceOf(VoiceService);
    });

    it('should throw error if client is not provided', () => {
      expect(() => new VoiceService(null as unknown as VoiceClient)).toThrow(ValidationError);
    });
  });

  describe('cancel()', () => {
    it('should be a no-op when no session is active', () => {
      expect(() => service.cancel()).not.toThrow();
    });
  });

  describe('detectContentType()', () => {
    it('should detect .ogg as opus/ogg', () => {
      expect(service.detectContentType('audio.ogg')).toBe('audio/opus;container=ogg');
    });

    it('should detect .opus as opus/ogg', () => {
      expect(service.detectContentType('audio.opus')).toBe('audio/opus;container=ogg');
    });

    it('should detect .webm as opus/webm', () => {
      expect(service.detectContentType('audio.webm')).toBe('audio/opus;container=webm');
    });

    it('should detect .mka as opus/matroska', () => {
      expect(service.detectContentType('audio.mka')).toBe('audio/opus;container=matroska');
    });

    it('should detect .flac as audio/flac', () => {
      expect(service.detectContentType('recording.flac')).toBe('audio/flac');
    });

    it('should detect .mp3 as audio/mpeg', () => {
      expect(service.detectContentType('song.mp3')).toBe('audio/mpeg');
    });

    it('should detect .pcm as PCM 16kHz', () => {
      expect(service.detectContentType('raw.pcm')).toBe('audio/pcm;encoding=s16le;rate=16000');
    });

    it('should detect .raw as PCM 16kHz', () => {
      expect(service.detectContentType('raw.raw')).toBe('audio/pcm;encoding=s16le;rate=16000');
    });

    it('should return undefined for unknown extensions', () => {
      expect(service.detectContentType('file.wav')).toBeUndefined();
    });

    it('should return undefined for files without extension', () => {
      expect(service.detectContentType('audio')).toBeUndefined();
    });

    it('should handle uppercase extensions via extname', () => {
      // extname('audio.OGG') returns '.OGG', and toLowerCase() handles it
      expect(service.detectContentType('audio.OGG')).toBe('audio/opus;container=ogg');
      expect(service.detectContentType('audio.ogg')).toBe('audio/opus;container=ogg');
    });

    it('should handle paths with directories', () => {
      expect(service.detectContentType('/path/to/audio.mp3')).toBe('audio/mpeg');
    });
  });

  describe('validateOptions()', () => {
    it('should accept valid options with one target language', () => {
      expect(() =>
        service.validateOptions({ targetLangs: ['de'] } as VoiceTranslateOptions),
      ).not.toThrow();
    });

    it('should accept valid options with 5 target languages', () => {
      expect(() =>
        service.validateOptions({
          targetLangs: ['de', 'fr', 'es', 'it', 'pt'],
        } as VoiceTranslateOptions),
      ).not.toThrow();
    });

    it('should reject empty target languages', () => {
      expect(() =>
        service.validateOptions({ targetLangs: [] } as VoiceTranslateOptions),
      ).toThrow(ValidationError);
      expect(() =>
        service.validateOptions({ targetLangs: [] } as VoiceTranslateOptions),
      ).toThrow(/at least one target language/i);
    });

    it('should reject undefined target languages', () => {
      expect(() =>
        service.validateOptions({} as VoiceTranslateOptions),
      ).toThrow(ValidationError);
    });

    it('should reject more than 5 target languages', () => {
      expect(() =>
        service.validateOptions({
          targetLangs: ['de', 'fr', 'es', 'it', 'pt', 'ja'],
        } as VoiceTranslateOptions),
      ).toThrow(ValidationError);
      expect(() =>
        service.validateOptions({
          targetLangs: ['de', 'fr', 'es', 'it', 'pt', 'ja'],
        } as VoiceTranslateOptions),
      ).toThrow(/maximum 5/i);
    });
  });

  describe('translateFile()', () => {
    let tmpDir: string;
    let testFile: string;

    beforeEach(async () => {
      jest.useRealTimers();
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-test-'));
      testFile = path.join(tmpDir, 'test.mp3');
      await fs.writeFile(testFile, Buffer.alloc(1024));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'] });
    });

    afterEach(async () => {
      jest.useRealTimers();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should throw ValidationError for unknown file extension without content-type', async () => {
      jest.useRealTimers();
      const unknownFile = path.join(tmpDir, 'test.wav');
      await fs.writeFile(unknownFile, Buffer.alloc(100));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'] });

      await expect(
        service.translateFile(unknownFile, {
          targetLangs: ['de'],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should accept explicit content-type override', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-1', mockWs, (cb) => {
        cb.onEndOfStream?.();
      });

      jest.useRealTimers();
      const wavFile = path.join(tmpDir, 'test.wav');
      await fs.writeFile(wavFile, Buffer.alloc(100));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'] });

      const result = await service.translateFile(wavFile, {
        targetLangs: ['de'],
        contentType: 'audio/pcm;encoding=s16le;rate=16000',
      });

      expect(result.sessionId).toBe('session-1');
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        service.translateFile('/nonexistent/file.mp3', {
          targetLangs: ['de'],
        }),
      ).rejects.toThrow();
    });

    it('should reject symlinks for security reasons', async () => {
      jest.useRealTimers();
      const targetFile = path.join(tmpDir, 'real.mp3');
      const symlinkFile = path.join(tmpDir, 'link.mp3');
      await fs.writeFile(targetFile, Buffer.alloc(100));
      await fs.symlink(targetFile, symlinkFile);
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'] });

      await expect(
        service.translateFile(symlinkFile, {
          targetLangs: ['de'],
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.translateFile(symlinkFile, {
          targetLangs: ['de'],
        }),
      ).rejects.toThrow(/symlinks are not supported/i);
    });

    it('should normalize file path with resolve', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-resolve', mockWs, (cb) => {
        cb.onEndOfStream?.();
      });

      // Use a relative-style path with '..' that resolve() would normalize
      const unnormalizedPath = path.join(tmpDir, 'subdir', '..', 'test.mp3');

      const result = await service.translateFile(unnormalizedPath, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      expect(result.sessionId).toBe('session-resolve');
    });

    it('should auto-detect content type from extension', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-mp3', mockWs, (cb) => {
        cb.onEndOfStream?.();
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de'],
      });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          source_media_content_type: 'audio/mpeg',
        }),
      );
      expect(result.sessionId).toBe('session-mp3');
    });

    it('should stream audio and accumulate transcripts', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-transcript', mockWs, (cb) => {
        cb.onSourceTranscript?.({
          concluded: [{ text: 'Hello world', language: 'en', start_time: 0, end_time: 1.5 }],
          tentative: [],
        });
        cb.onTargetTranscript?.({
          language: 'de',
          concluded: [{ text: 'Hallo Welt', start_time: 0, end_time: 1.5 }],
          tentative: [],
        });
        cb.onEndOfStream?.();
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      expect(result.source.text).toBe('Hello world');
      expect(result.source.lang).toBe('en');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]!.lang).toBe('de');
      expect(result.targets[0]!.text).toBe('Hallo Welt');
    });

    it('should accumulate multiple concluded segments', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-multi', mockWs, (cb) => {
        cb.onSourceTranscript?.({
          concluded: [{ text: 'Hello', language: 'en', start_time: 0, end_time: 0.5 }],
          tentative: [{ text: 'world', language: 'en', start_time: 0.5, end_time: 1 }],
        });
        cb.onSourceTranscript?.({
          concluded: [{ text: 'world', language: 'en', start_time: 0.5, end_time: 1 }],
          tentative: [],
        });
        cb.onEndOfStream?.();
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      expect(result.source.text).toBe('Hello world');
      expect(result.source.segments).toHaveLength(2);
    });

    it('should accumulate many segments efficiently with correct spacing', async () => {
      const mockWs = createMockWebSocket();

      const segmentCount = 1200;
      const segments = Array.from({ length: segmentCount }, (_, i) => ({
        text: `segment${i}`,
        start_time: i * 0.5,
        end_time: (i + 1) * 0.5,
      }));

      setupSessionMock(mockClient, 'session-many-segments', mockWs, (cb) => {
        for (const seg of segments) {
          cb.onSourceTranscript?.({
            concluded: [{ ...seg, language: 'en' }],
            tentative: [],
          });
        }
        cb.onEndOfStream?.();
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      const expectedText = segments.map((s) => s.text).join(' ');
      expect(result.source.text).toBe(expectedText);
      expect(result.source.segments).toHaveLength(segmentCount);
    });

    it('should handle multiple concluded segments in a single update', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-batch-concluded', mockWs, (cb) => {
        cb.onSourceTranscript?.({
          concluded: [
            { text: 'One', language: 'en', start_time: 0, end_time: 0.5 },
            { text: 'Two', language: 'en', start_time: 0.5, end_time: 1 },
            { text: 'Three', language: 'en', start_time: 1, end_time: 1.5 },
          ],
          tentative: [],
        });
        cb.onEndOfStream?.();
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      expect(result.source.text).toBe('One Two Three');
      expect(result.source.segments).toHaveLength(3);
    });

    it('should handle multi-target languages', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-multi-target', mockWs, (cb) => {
        cb.onTargetTranscript?.({
          language: 'de',
          concluded: [{ text: 'Hallo', start_time: 0, end_time: 1 }],
          tentative: [],
        });
        cb.onTargetTranscript?.({
          language: 'fr',
          concluded: [{ text: 'Bonjour', start_time: 0, end_time: 1 }],
          tentative: [],
        });
        cb.onEndOfStream?.();
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de', 'fr'],
        chunkInterval: 0,
      });

      expect(result.targets).toHaveLength(2);
      expect(result.targets[0]!.text).toBe('Hallo');
      expect(result.targets[1]!.text).toBe('Bonjour');
    });

    it('should reject on voice streaming error', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-error', mockWs, (cb) => {
        cb.onError?.({
          request_type: 'unknown',
          error_code: 400,
          reason_code: 9040000,
          error_message: 'Invalid audio format',
        });
      });

      await expect(
        service.translateFile(testFile, {
          targetLangs: ['de'],
          chunkInterval: 0,
        }),
      ).rejects.toThrow(VoiceError);
    });

    it('should pass formality and glossary_id to session request', async () => {
      const mockWs = createMockWebSocket();
      setupSessionMock(mockClient, 'session-opts', mockWs, (cb) => {
        cb.onEndOfStream?.();
      });

      await service.translateFile(testFile, {
        targetLangs: ['de'],
        formality: 'more',
        glossaryId: 'glossary-123',
        chunkInterval: 0,
      });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          target_languages: ['de'],
          formality: 'more',
          glossary_id: 'glossary-123',
        }),
      );
    });

    it('should reject with VoiceError when WebSocket emits error', async () => {
      const mockWs = createMockWebSocket();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-ws-error',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          // ws always emits close after an error; the session reports the
          // transport failure from there.
          mockWs.emit('error', new Error('Connection refused'));
          mockWs.emit('close');
        });
        return mockWs as any;
      });

      await expect(
        service.translateFile(testFile, {
          targetLangs: ['de'],
          chunkInterval: 0,
          reconnect: false,
        }),
      ).rejects.toThrow(VoiceError);
      await expect(
        service.translateFile(testFile, {
          targetLangs: ['de'],
          chunkInterval: 0,
          reconnect: false,
        }),
      ).rejects.toThrow(/WebSocket connection failed: Connection refused/);
    });

    it('should remove SIGINT listener when WebSocket closes', async () => {
      const mockWs = createMockWebSocket();
      const listenerCountBefore = process.listenerCount('SIGINT');

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-close',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            callbacks.onEndOfStream?.();
            mockWs.emit('close');
          });
        });
        return mockWs as any;
      });

      await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      expect(process.listenerCount('SIGINT')).toBe(listenerCountBefore);
    });

    it('should call sendEndOfSource when SIGINT is received', async () => {
      const mockWs = createMockWebSocket();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-sigint',
      });

      // Fire onEndOfStream only after sendEndOfSource has been called
      // (indicating chunk streaming completed), ensuring SIGINT fires mid-stream
      let endStreamCb: (() => void) | null = null;
      mockClient.sendEndOfSource.mockImplementation(() => {
        if (endStreamCb) { process.nextTick(endStreamCb); }
      });

      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, callbacks: any) => {
        endStreamCb = () => callbacks.onEndOfStream?.();
        process.nextTick(() => {
          mockWs.emit('open');
        });
        return mockWs as any;
      });

      await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      expect(mockClient.sendEndOfSource).toHaveBeenCalledWith(mockWs);
    });

    it('should break chunking loop when WebSocket readyState is not OPEN', async () => {
      const mockWs = createMockWebSocket();

      jest.useRealTimers();
      const largeFile = path.join(tmpDir, 'large.mp3');
      await fs.writeFile(largeFile, Buffer.alloc(10000));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'] });

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-readystate',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.readyState = 3; // CLOSED
            process.nextTick(() => {
              callbacks.onEndOfStream?.();
            });
          });
        });
        return mockWs as any;
      });

      const promise = service.translateFile(largeFile, {
        targetLangs: ['de'],
        chunkSize: 100,
        chunkInterval: 10,
      });

      // Interleave timer advances with I/O processing
      for (let i = 0; i < 100; i++) {
        await jest.advanceTimersByTimeAsync(10);
        await new Promise((r) => setImmediate(r));
      }
      const result = await promise;

      expect(result.sessionId).toBe('session-readystate');
    });

    it('should reject when chunk reading throws an error', async () => {
      const mockWs = createMockWebSocket();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-chunk-error',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
        });
        return mockWs as any;
      });

      // Mock the chunk reader to throw deterministically
      // (avoids a filesystem race between createReadStream and unlink)
      // eslint-disable-next-line require-yield
      jest.spyOn(service as any, 'readFileInChunks').mockImplementation(async function*() {
        throw new Error('ENOENT: no such file or directory');
      });

      const promise = service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      await expect(promise).rejects.toThrow();
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('should proxy onEndOfSourceTranscript callback', async () => {
      const mockWs = createMockWebSocket();
      const onEndOfSourceTranscript = jest.fn();

      setupSessionMock(mockClient, 'session-eos-transcript', mockWs, (cb) => {
        cb.onEndOfSourceTranscript?.();
        cb.onEndOfStream?.();
      });

      await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      }, {
        onEndOfSourceTranscript,
      });

      expect(onEndOfSourceTranscript).toHaveBeenCalledTimes(1);
    });

    it('should proxy onEndOfTargetTranscript callback with language', async () => {
      const mockWs = createMockWebSocket();
      const onEndOfTargetTranscript = jest.fn();

      setupSessionMock(mockClient, 'session-eot-transcript', mockWs, (cb) => {
        cb.onEndOfTargetTranscript?.('de');
        cb.onEndOfStream?.();
      });

      await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      }, {
        onEndOfTargetTranscript,
      });

      expect(onEndOfTargetTranscript).toHaveBeenCalledTimes(1);
      expect(onEndOfTargetTranscript).toHaveBeenCalledWith('de');
    });
  });

  describe('reconnection', () => {
    let tmpDir: string;
    let testFile: string;
    let largeFile: string;

    beforeEach(async () => {
      jest.useRealTimers();
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-reconnect-'));
      testFile = path.join(tmpDir, 'test.mp3');
      largeFile = path.join(tmpDir, 'large.mp3');
      await fs.writeFile(testFile, Buffer.alloc(1024));
      await fs.writeFile(largeFile, Buffer.alloc(5000));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'] });
    });

    afterEach(async () => {
      jest.useRealTimers();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should reconnect on unexpected WebSocket close', async () => {
      // First WS: closes unexpectedly after open
      const mockWs1 = createMockWebSocket();
      // Second WS: completes normally
      const mockWs2 = createMockWebSocket();

      const onReconnecting = jest.fn();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token-1',
        session_id: 'session-reconnect',
      });

      (mockClient as any).reconnectSession = jest.fn().mockResolvedValue({
        streaming_url: 'wss://test-new',
        token: 'token-2',
      });

      let wsCallCount = 0;
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, callbacks: any) => {
        wsCallCount++;
        if (wsCallCount === 1) {
          process.nextTick(() => {
            mockWs1.emit('open');
            process.nextTick(() => {
              // Simulate unexpected close (no end_of_stream)
              mockWs1.readyState = 3;
              mockWs1.emit('close');
            });
          });
          return mockWs1 as any;
        } else {
          process.nextTick(() => {
            mockWs2.emit('open');
            process.nextTick(() => {
              callbacks.onEndOfStream?.();
            });
          });
          return mockWs2 as any;
        }
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      }, { onReconnecting });

      expect(result.sessionId).toBe('session-reconnect');
      expect(onReconnecting).toHaveBeenCalledWith(1);
      expect((mockClient as any).reconnectSession).toHaveBeenCalledWith('token-1');
    });

    it('should reject after max reconnect attempts exhausted', async () => {
      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token-1',
        session_id: 'session-exhaust',
      });

      let tokenCounter = 1;
      (mockClient as any).reconnectSession = jest.fn().mockImplementation(() => {
        tokenCounter++;
        return Promise.resolve({
          streaming_url: `wss://test-${tokenCounter}`,
          token: `token-${tokenCounter}`,
        });
      });

      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        const mockWs = createMockWebSocket();

        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.readyState = 3;
            mockWs.emit('close');
          });
        });
        return mockWs as any;
      });

      await expect(
        service.translateFile(testFile, {
          targetLangs: ['de'],
          chunkInterval: 0,
          maxReconnectAttempts: 2,
        }),
      ).rejects.toThrow(VoiceError);
      await expect(
        service.translateFile(testFile, {
          targetLangs: ['de'],
          chunkInterval: 0,
          maxReconnectAttempts: 2,
        }),
      ).rejects.toThrow(/WebSocket closed unexpectedly/);
    });

    it('should not reconnect when reconnect option is false', async () => {
      const mockWs = createMockWebSocket();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token-1',
        session_id: 'session-no-reconnect',
      });
      (mockClient as any).reconnectSession = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.readyState = 3;
            mockWs.emit('close');
          });
        });
        return mockWs as any;
      });

      await expect(
        service.translateFile(testFile, {
          targetLangs: ['de'],
          chunkInterval: 0,
          reconnect: false,
        }),
      ).rejects.toThrow(VoiceError);

      expect((mockClient as any).reconnectSession).not.toHaveBeenCalled();
    });

    it('should not reconnect on normal end_of_stream close', async () => {
      const mockWs = createMockWebSocket();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token-1',
        session_id: 'session-normal-close',
      });
      (mockClient as any).reconnectSession = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            callbacks.onEndOfStream?.();
            // Simulate ws.close() triggering 'close' event
            mockWs.emit('close');
          });
        });
        return mockWs as any;
      });

      const result = await service.translateFile(testFile, {
        targetLangs: ['de'],
        chunkInterval: 0,
      });

      expect(result.sessionId).toBe('session-normal-close');
      expect((mockClient as any).reconnectSession).not.toHaveBeenCalled();
    });

    it('should reject if reconnectSession itself fails', async () => {
      const mockWs = createMockWebSocket();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token-1',
        session_id: 'session-reconnect-fail',
      });
      (mockClient as any).reconnectSession = jest.fn().mockRejectedValue(
        new VoiceError('Voice API access denied.'),
      );

      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.readyState = 3;
            mockWs.emit('close');
          });
        });
        return mockWs as any;
      });

      await expect(
        service.translateFile(testFile, {
          targetLangs: ['de'],
          chunkInterval: 0,
        }),
      ).rejects.toThrow(VoiceError);
    });

    it('should resume chunk streaming on new WebSocket after reconnection', async () => {
      // Use a larger file so chunking is in-flight when the first WS drops
      const mockWs1 = createMockWebSocket();
      const mockWs2 = createMockWebSocket();

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token-1',
        session_id: 'session-resume',
      });

      (mockClient as any).reconnectSession = jest.fn().mockResolvedValue({
        streaming_url: 'wss://test-new',
        token: 'token-2',
      });

      const chunksSentOnWs1: string[] = [];
      const chunksSentOnWs2: string[] = [];
      let wsCallCount = 0;
      let ws1ChunkCount = 0;

      let ws2Callbacks: any = null;

      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, callbacks: any) => {
        wsCallCount++;
        if (wsCallCount === 1) {
          process.nextTick(() => {
            mockWs1.emit('open');
          });
          return mockWs1 as any;
        } else {
          ws2Callbacks = callbacks;
          process.nextTick(() => {
            mockWs2.emit('open');
          });
          return mockWs2 as any;
        }
      });

      // Signal end-of-stream when sendEndOfSource is called, after all chunks
      // have been sent. Driving it off the call rather than polling keeps this
      // deterministic under fake timers and file I/O.
      mockClient.sendEndOfSource.mockImplementation(() => {
        process.nextTick(() => ws2Callbacks?.onEndOfStream?.());
      });

      // Track which WS each chunk was sent on
      mockClient.sendAudioChunk.mockImplementation((ws: any, data: string) => {
        if (ws === mockWs1) {
          chunksSentOnWs1.push(data);
          ws1ChunkCount++;
          // After exactly 2 chunks on ws1, close it unexpectedly.
          // Emit synchronously so the reconnect starts before the next
          // paceChunks timer fires — avoids CI flakiness where nextTick
          // drains after multiple timer callbacks in advanceTimersByTimeAsync.
          if (ws1ChunkCount === 2) {
            mockWs1.readyState = 3;
            mockWs1.emit('close');
          }
        } else if (ws === mockWs2) {
          chunksSentOnWs2.push(data);
        }
        return true;
      });

      const result = await service.translateFile(largeFile, {
        targetLangs: ['de'],
        chunkSize: 500,
        chunkInterval: 0,
      });

      expect(result.sessionId).toBe('session-resume');
      // Chunks should have been sent on both WebSockets
      const totalChunks = chunksSentOnWs1.length + chunksSentOnWs2.length;
      expect(totalChunks).toBeGreaterThanOrEqual(Math.ceil(5000 / 500));
      // At least some chunks should have been sent on the second WS
      expect(chunksSentOnWs2.length).toBeGreaterThan(0);
    });
  });

  describe('translateStdin()', () => {
    it('should require content-type for stdin', async () => {
      await expect(
        service.translateStdin({
          targetLangs: ['de'],
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.translateStdin({
          targetLangs: ['de'],
        }),
      ).rejects.toThrow(/content type is required/i);
    });

    it('should validate options before streaming', async () => {
      await expect(
        service.translateStdin({
          targetLangs: [],
          contentType: 'audio/mpeg',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should stream from stdin when content-type is provided', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-stdin',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockStdin.write(Buffer.alloc(100));
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkInterval: 0,
      });

      await jest.advanceTimersByTimeAsync(100);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-stdin');
      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          source_media_content_type: 'audio/mpeg',
        }),
      );
      expect(mockClient.sendAudioChunk).toHaveBeenCalled();
    });

    it('should use default chunkSize and chunkInterval when not specified', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-stdin-defaults',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            // Write more than default chunkSize (6400) to verify chunking
            mockStdin.write(Buffer.alloc(7000));
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
      });

      // paceChunks uses default chunkInterval=200ms, advance timers enough for all chunks
      await jest.advanceTimersByTimeAsync(2000);

      // Fire onEndOfStream after chunks are sent
      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-stdin-defaults');
      // With 7000 bytes and default chunkSize 6400, we should get 2 chunks (6400 + 600)
      expect(mockClient.sendAudioChunk).toHaveBeenCalledTimes(2);
    });

    it('should handle large stream without data loss', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-large-stream',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            const totalSize = 65536;
            const pushSize = 256;
            for (let i = 0; i < totalSize / pushSize; i++) {
              const buf = Buffer.alloc(pushSize, i & 0xff);
              mockStdin.write(buf);
            }
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const chunkSize = 6400;
      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkSize,
        chunkInterval: 0,
      });

      // Allow microtasks and stream processing to complete
      await jest.advanceTimersByTimeAsync(100);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-large-stream');

      // sendAudioChunk receives base64 strings; decode to verify byte counts
      const calls = mockClient.sendAudioChunk.mock.calls;
      let totalBytesSent = 0;
      for (const call of calls) {
        const b64 = call[1] as string;
        const byteLen = Buffer.from(b64, 'base64').length;
        totalBytesSent += byteLen;
        expect(byteLen).toBeLessThanOrEqual(chunkSize);
      }
      expect(totalBytesSent).toBe(65536);
      expect(calls.length).toBeGreaterThanOrEqual(Math.ceil(65536 / chunkSize));
    });

    it('should handle exact multiple of chunkSize without trailing empty yield', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-exact-multiple',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockStdin.write(Buffer.alloc(12800));
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const chunkSize = 6400;
      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkSize,
        chunkInterval: 0,
      });

      await jest.advanceTimersByTimeAsync(100);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-exact-multiple');

      // sendAudioChunk receives base64 strings; decode to verify byte counts
      const calls = mockClient.sendAudioChunk.mock.calls;
      let totalBytesSent = 0;
      for (const call of calls) {
        const b64 = call[1] as string;
        const byteLen = Buffer.from(b64, 'base64').length;
        expect(byteLen).toBeGreaterThan(0);
        expect(byteLen).toBeLessThanOrEqual(chunkSize);
        totalBytesSent += byteLen;
      }
      expect(totalBytesSent).toBe(12800);
    });

    it('should handle single-byte pushes correctly', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-single-byte',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            const totalBytes = 25;
            for (let i = 0; i < totalBytes; i++) {
              mockStdin.write(Buffer.from([i]));
            }
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const chunkSize = 10;
      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkSize,
        chunkInterval: 0,
      });

      await jest.advanceTimersByTimeAsync(100);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-single-byte');

      // sendAudioChunk receives base64 strings; decode to verify byte counts
      const calls = mockClient.sendAudioChunk.mock.calls;
      let totalBytesSent = 0;
      for (const call of calls) {
        const b64 = call[1] as string;
        const byteLen = Buffer.from(b64, 'base64').length;
        expect(byteLen).toBeLessThanOrEqual(chunkSize);
        totalBytesSent += byteLen;
      }
      expect(totalBytesSent).toBe(25);
      expect(calls.length).toBeGreaterThanOrEqual(Math.ceil(25 / chunkSize));
    });

    it('should yield remaining buffer from stdin when stream ends', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-stdin-remainder',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            // Write less than one chunk to test remainder yielding (line 242-243)
            mockStdin.write(Buffer.alloc(50));
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkSize: 6400,
        chunkInterval: 0,
      });

      await jest.advanceTimersByTimeAsync(100);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-stdin-remainder');
      // 50 bytes < 6400 chunkSize, so remainder path yields one chunk
      expect(mockClient.sendAudioChunk).toHaveBeenCalledTimes(1);
    });

    it('should handle empty stdin (zero bytes) without sending audio chunks', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-empty-stdin',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkInterval: 0,
      });

      await jest.advanceTimersByTimeAsync(100);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-empty-stdin');
      expect(mockClient.sendAudioChunk).not.toHaveBeenCalled();
      expect(mockClient.sendEndOfSource).toHaveBeenCalled();
    });

    it('should handle stdin input larger than 128KB without any size limit', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-large-stdin',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            // Write 256KB of data -- double the translate command's 128KB limit
            const totalSize = 256 * 1024;
            const pushSize = 4096;
            for (let i = 0; i < totalSize / pushSize; i++) {
              mockStdin.write(Buffer.alloc(pushSize, i & 0xff));
            }
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const chunkSize = 6400;
      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkSize,
        chunkInterval: 0,
      });

      await jest.advanceTimersByTimeAsync(500);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-large-stdin');

      const calls = mockClient.sendAudioChunk.mock.calls;
      let totalBytesSent = 0;
      for (const call of calls) {
        const b64 = call[1] as string;
        const byteLen = Buffer.from(b64, 'base64').length;
        totalBytesSent += byteLen;
        expect(byteLen).toBeLessThanOrEqual(chunkSize);
      }
      // All 256KB must arrive -- no truncation, no rejection
      expect(totalBytesSent).toBe(256 * 1024);
    });

    it('should accumulate multi-push data before yielding complete chunks', async () => {
      const mockWs = createMockWebSocket();
      const mockStdin = new PassThrough();
      jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);

      mockClient.createSession.mockResolvedValue({
        streaming_url: 'wss://test',
        token: 'token',
        session_id: 'session-accumulate',
      });
      mockClient.createWebSocket.mockImplementation((_url: string, _token: string, _callbacks: any) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            // Push 3 chunks of 40 bytes each (120 total) with chunkSize=100
            // Should yield one 100-byte chunk + one 20-byte remainder
            mockStdin.write(Buffer.alloc(40, 0xaa));
            mockStdin.write(Buffer.alloc(40, 0xbb));
            mockStdin.write(Buffer.alloc(40, 0xcc));
            mockStdin.end();
          });
        });
        return mockWs as any;
      });

      const chunkSize = 100;
      const promise = service.translateStdin({
        targetLangs: ['de'],
        contentType: 'audio/mpeg',
        chunkSize,
        chunkInterval: 0,
      });

      await jest.advanceTimersByTimeAsync(100);

      const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
      callbacks.onEndOfStream?.();

      const result = await promise;

      expect(result.sessionId).toBe('session-accumulate');

      const calls = mockClient.sendAudioChunk.mock.calls;
      let totalBytesSent = 0;
      for (const call of calls) {
        const b64 = call[1] as string;
        const byteLen = Buffer.from(b64, 'base64').length;
        expect(byteLen).toBeLessThanOrEqual(chunkSize);
        totalBytesSent += byteLen;
      }
      expect(totalBytesSent).toBe(120);
      // 120 bytes / 100 chunkSize = 1 full chunk + 1 remainder = 2 calls
      expect(calls.length).toBe(2);
    });
  });
});

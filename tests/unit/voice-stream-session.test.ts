 
/**
 * Tests for VoiceStreamSession
 * Covers WebSocket lifecycle, reconnection, SIGINT handling, chunk streaming,
 * and transcript accumulation directly on the extracted class.
 */

import { VoiceStreamSession } from '../../src/services/voice-stream-session.js';
import { VoiceClient } from '../../src/api/voice-client.js';
import { VoiceError } from '../../src/utils/errors.js';
import type {
  VoiceSessionResponse,
  VoiceTranslateOptions,
  VoiceStreamCallbacks,
} from '../../src/types/voice.js';
import { createMockVoiceClient } from '../helpers/mock-factories';

jest.mock('ws', () => {
  const EventEmitter = require('events');
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    send = jest.fn();
    close = jest.fn();
  }
  return { default: MockWebSocket, __esModule: true };
});

describe('VoiceStreamSession', () => {
  let mockClient: jest.Mocked<VoiceClient>;
  let session: VoiceSessionResponse;
  let options: VoiceTranslateOptions;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.clearAllMocks();
    mockClient = createMockVoiceClient();

    session = {
      streaming_url: 'wss://test.deepl.com/stream',
      token: 'token-1',
      session_id: 'session-1',
    };

    options = {
      targetLangs: ['de'],
      chunkInterval: 0,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize transcript state for source and targets', () => {
      const streamSession = new VoiceStreamSession(mockClient, session, {
        targetLangs: ['de', 'fr', 'es'],
      });
      expect(streamSession).toBeInstanceOf(VoiceStreamSession);
    });

    it('should use "auto" as default source language', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => callbacks.onEndOfStream?.());
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      const result = await streamSession.run(emptyChunks());
      expect(result.source.lang).toBe('auto');
    });

    it('should use provided source language', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => callbacks.onEndOfStream?.());
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, {
        ...options,
        sourceLang: 'en',
      });

      const result = await streamSession.run(emptyChunks());
      expect(result.source.lang).toBe('en');
    });
  });

  describe('run()', () => {
    it('should create WebSocket and stream chunks', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.sendEndOfSource.mockImplementation(() => {
        process.nextTick(() => {
          const callbacks = mockClient.createWebSocket.mock.calls[0]![2] as any;
          callbacks.onEndOfStream?.();
        });
      });

      mockClient.createWebSocket.mockImplementation((_url, _token, _callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      const result = await streamSession.run(singleChunk(Buffer.from('audio-data')));

      expect(mockClient.createWebSocket).toHaveBeenCalledWith(
        'wss://test.deepl.com/stream',
        'token-1',
        expect.any(Object),
      );
      expect(mockClient.sendAudioChunk).toHaveBeenCalled();
      expect(mockClient.sendEndOfSource).toHaveBeenCalled();
      expect(result.sessionId).toBe('session-1');
    });

    it('should return session result with source and targets', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            callbacks.onSourceTranscript?.({
              concluded: [{ text: 'Hello', language: 'en', start_time: 0, end_time: 1 }],
              tentative: [],
            });
            callbacks.onTargetTranscript?.({
              language: 'de',
              concluded: [{ text: 'Hallo', start_time: 0, end_time: 1 }],
              tentative: [],
            });
            callbacks.onEndOfStream?.();
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      const result = await streamSession.run(emptyChunks());

      expect(result.source.text).toBe('Hello');
      expect(result.source.lang).toBe('en');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]!.lang).toBe('de');
      expect(result.targets[0]!.text).toBe('Hallo');
    });

    it('should not register any SIGINT handlers', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      const listenerCountBefore = process.listenerCount('SIGINT');

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            expect(process.listenerCount('SIGINT')).toBe(listenerCountBefore);
            callbacks.onEndOfStream?.();
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      await streamSession.run(emptyChunks());
    });
  });

  describe('cancel()', () => {
    it('should call sendEndOfSource on the active WebSocket', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            streamSession.cancel();
            process.nextTick(() => callbacks.onEndOfStream?.());
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      await streamSession.run(emptyChunks());

      expect(mockClient.sendEndOfSource).toHaveBeenCalledWith(mockWs);
    });

    it('should be a no-op after stream has ended', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => callbacks.onEndOfStream?.());
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      await streamSession.run(emptyChunks());

      mockClient.sendEndOfSource.mockClear();
      streamSession.cancel();
      expect(mockClient.sendEndOfSource).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    // A socket error is always followed by a close event; the transport
    // failure is reported from there so reconnect stays reachable.
    it('should reject with VoiceError on WebSocket error when reconnect is disabled', async () => {
      const EventEmitter = require('events');

      mockClient.createWebSocket.mockImplementation(() => {
        const mockWs = new EventEmitter();
        mockWs.readyState = 1;
        mockWs.send = jest.fn();
        mockWs.close = jest.fn();

        process.nextTick(() => {
          mockWs.emit('error', new Error('Connection refused'));
          mockWs.readyState = 3;
          mockWs.emit('close');
        });
        return mockWs;
      });

      const noReconnect = { ...options, reconnect: false };
      await expect(
        new VoiceStreamSession(mockClient, session, noReconnect).run(emptyChunks()),
      ).rejects.toThrow(VoiceError);
      await expect(
        new VoiceStreamSession(mockClient, session, noReconnect).run(emptyChunks()),
      ).rejects.toThrow(/WebSocket connection failed: Connection refused/);
    });

    it('should reject with VoiceError on voice streaming error callback', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            callbacks.onError?.({
              request_type: 'unknown',
              error_code: 400,
              reason_code: 9040000,
              error_message: 'Invalid audio format',
            });
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      await expect(streamSession.run(emptyChunks())).rejects.toThrow(VoiceError);
    });

    it('should reject when chunk streaming throws', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation(() => {
        process.nextTick(() => mockWs.emit('open'));
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      await expect(streamSession.run(throwingChunks())).rejects.toThrow('chunk error');
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    it('should reconnect after a transport error closes the socket', async () => {
      const EventEmitter = require('events');
      const onReconnecting = jest.fn();

      mockClient.reconnectSession.mockResolvedValue({
        streaming_url: 'wss://test-new.deepl.com/stream',
        token: 'token-2',
      });

      let wsCallCount = 0;
      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        wsCallCount++;
        const mockWs = new EventEmitter();
        mockWs.readyState = 1;
        mockWs.send = jest.fn();
        mockWs.close = jest.fn();

        if (wsCallCount === 1) {
          process.nextTick(() => {
            mockWs.emit('open');
            process.nextTick(() => {
              mockWs.emit('error', new Error('read ECONNRESET'));
              mockWs.readyState = 3;
              mockWs.emit('close');
            });
          });
        } else {
          process.nextTick(() => {
            mockWs.emit('open');
            process.nextTick(() => callbacks.onEndOfStream?.());
          });
        }
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(
        mockClient, session, options, { onReconnecting },
      );
      const result = await streamSession.run(emptyChunks());

      expect(result.sessionId).toBe('session-1');
      expect(mockClient.reconnectSession).toHaveBeenCalledTimes(1);
      expect(mockClient.reconnectSession).toHaveBeenCalledWith('token-1');
      expect(onReconnecting).toHaveBeenCalledWith(1);
    });

    it('should reject with the transport error once reconnect attempts are exhausted', async () => {
      const EventEmitter = require('events');

      mockClient.reconnectSession.mockResolvedValue({
        streaming_url: 'wss://test-new.deepl.com/stream',
        token: 'token-2',
      });

      mockClient.createWebSocket.mockImplementation(() => {
        const mockWs = new EventEmitter();
        mockWs.readyState = 1;
        mockWs.send = jest.fn();
        mockWs.close = jest.fn();

        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.emit('error', new Error('read ECONNRESET'));
            mockWs.readyState = 3;
            mockWs.emit('close');
          });
        });
        return mockWs;
      });

      await expect(
        new VoiceStreamSession(mockClient, session, {
          ...options,
          maxReconnectAttempts: 1,
        }).run(emptyChunks()),
      ).rejects.toThrow(/WebSocket connection failed: read ECONNRESET/);
      expect(mockClient.reconnectSession).toHaveBeenCalledTimes(1);
    });

    it('should close the audio input when reconnect fails', async () => {
      const EventEmitter = require('events');
      const input = trackedChunks();

      mockClient.reconnectSession.mockRejectedValue(
        new VoiceError('Voice API access denied.'),
      );

      mockClient.createWebSocket.mockImplementation(() => {
        const mockWs = new EventEmitter();
        // Never open for writing, so the chunk pump parks waiting for a
        // usable socket — the state in which the generator must not leak.
        mockWs.readyState = 3;
        mockWs.send = jest.fn();
        mockWs.close = jest.fn();

        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            process.nextTick(() => mockWs.emit('close'));
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      await expect(streamSession.run(input.chunks)).rejects.toThrow(VoiceError);

      expect(input.closed()).toBe(true);
    });

    it('should reconnect on unexpected WebSocket close', async () => {
      const EventEmitter = require('events');
      const onReconnecting = jest.fn();

      const mockWs1 = new EventEmitter();
      mockWs1.readyState = 1;
      mockWs1.send = jest.fn();
      mockWs1.close = jest.fn();

      const mockWs2 = new EventEmitter();
      mockWs2.readyState = 1;
      mockWs2.send = jest.fn();
      mockWs2.close = jest.fn();

      mockClient.reconnectSession.mockResolvedValue({
        streaming_url: 'wss://test-new.deepl.com/stream',
        token: 'token-2',
      });

      let wsCallCount = 0;
      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        wsCallCount++;
        if (wsCallCount === 1) {
          process.nextTick(() => {
            mockWs1.emit('open');
            process.nextTick(() => {
              mockWs1.readyState = 3;
              mockWs1.emit('close');
            });
          });
          return mockWs1;
        } else {
          process.nextTick(() => {
            mockWs2.emit('open');
            process.nextTick(() => callbacks.onEndOfStream?.());
          });
          return mockWs2;
        }
      });

      const streamSession = new VoiceStreamSession(
        mockClient, session, options, { onReconnecting },
      );
      const result = await streamSession.run(emptyChunks());

      expect(result.sessionId).toBe('session-1');
      expect(onReconnecting).toHaveBeenCalledWith(1);
      expect(mockClient.reconnectSession).toHaveBeenCalledWith('token-1');
    });

    it('should reject after max reconnect attempts exhausted', async () => {
      const EventEmitter = require('events');

      let tokenCounter = 1;
      mockClient.reconnectSession.mockImplementation(() => {
        tokenCounter++;
        return Promise.resolve({
          streaming_url: `wss://test-${tokenCounter}.deepl.com/stream`,
          token: `token-${tokenCounter}`,
        });
      });

      mockClient.createWebSocket.mockImplementation(() => {
        const mockWs = new EventEmitter();
        mockWs.readyState = 1;
        mockWs.send = jest.fn();
        mockWs.close = jest.fn();

        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.readyState = 3;
            mockWs.emit('close');
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, {
        ...options,
        maxReconnectAttempts: 2,
      });

      await expect(streamSession.run(emptyChunks())).rejects.toThrow(VoiceError);
      await expect(
        new VoiceStreamSession(mockClient, session, {
          ...options,
          maxReconnectAttempts: 2,
        }).run(emptyChunks()),
      ).rejects.toThrow(/WebSocket closed unexpectedly/);
    });

    it('should not reconnect when reconnect option is false', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation(() => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.readyState = 3;
            mockWs.emit('close');
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, {
        ...options,
        reconnect: false,
      });

      await expect(streamSession.run(emptyChunks())).rejects.toThrow(VoiceError);
      expect(mockClient.reconnectSession).not.toHaveBeenCalled();
    });

    it('should reject if reconnectSession itself fails', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.reconnectSession.mockRejectedValue(
        new VoiceError('Voice API access denied.'),
      );

      mockClient.createWebSocket.mockImplementation(() => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            mockWs.readyState = 3;
            mockWs.emit('close');
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      await expect(streamSession.run(emptyChunks())).rejects.toThrow(VoiceError);
    });
  });

  describe('transcript accumulation', () => {
    it('should accumulate multiple source transcript updates', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            callbacks.onSourceTranscript?.({
              concluded: [{ text: 'Hello', language: 'en', start_time: 0, end_time: 0.5 }],
              tentative: [],
            });
            callbacks.onSourceTranscript?.({
              concluded: [{ text: 'world', language: 'en', start_time: 0.5, end_time: 1 }],
              tentative: [],
            });
            callbacks.onEndOfStream?.();
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      const result = await streamSession.run(emptyChunks());

      expect(result.source.text).toBe('Hello world');
      expect(result.source.segments).toHaveLength(2);
    });

    it('should accumulate multiple target languages', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            callbacks.onTargetTranscript?.({
              language: 'de',
              concluded: [{ text: 'Hallo', start_time: 0, end_time: 1 }],
              tentative: [],
            });
            callbacks.onTargetTranscript?.({
              language: 'fr',
              concluded: [{ text: 'Bonjour', start_time: 0, end_time: 1 }],
              tentative: [],
            });
            callbacks.onEndOfStream?.();
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, {
        targetLangs: ['de', 'fr'],
      });
      const result = await streamSession.run(emptyChunks());

      expect(result.targets).toHaveLength(2);
      expect(result.targets[0]!.text).toBe('Hallo');
      expect(result.targets[1]!.text).toBe('Bonjour');
    });

    it('should detect source language from concluded segments', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, callbacks) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            callbacks.onSourceTranscript?.({
              concluded: [{ text: 'Bonjour', language: 'fr', start_time: 0, end_time: 1 }],
              tentative: [],
            });
            callbacks.onEndOfStream?.();
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options);
      const result = await streamSession.run(emptyChunks());

      expect(result.source.lang).toBe('fr');
    });
  });

  describe('callback proxying', () => {
    it('should proxy all callback types', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      const callbacks: VoiceStreamCallbacks = {
        onSourceTranscript: jest.fn(),
        onTargetTranscript: jest.fn(),
        onEndOfSourceTranscript: jest.fn(),
        onEndOfTargetTranscript: jest.fn(),
        onEndOfStream: jest.fn(),
      };

      mockClient.createWebSocket.mockImplementation((_url, _token, internalCbs) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            internalCbs.onSourceTranscript?.({
              concluded: [{ text: 'Hello', language: 'en', start_time: 0, end_time: 1 }],
              tentative: [],
            });
            internalCbs.onTargetTranscript?.({
              language: 'de',
              concluded: [{ text: 'Hallo', start_time: 0, end_time: 1 }],
              tentative: [],
            });
            internalCbs.onEndOfSourceTranscript?.();
            internalCbs.onEndOfTargetTranscript?.('de');
            internalCbs.onEndOfStream?.();
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(mockClient, session, options, callbacks);
      await streamSession.run(emptyChunks());

      expect(callbacks.onSourceTranscript).toHaveBeenCalledTimes(1);
      expect(callbacks.onTargetTranscript).toHaveBeenCalledTimes(1);
      expect(callbacks.onEndOfSourceTranscript).toHaveBeenCalledTimes(1);
      expect(callbacks.onEndOfTargetTranscript).toHaveBeenCalledWith('de');
      expect(callbacks.onEndOfStream).toHaveBeenCalledTimes(1);
    });

    it('should proxy onError callback', async () => {
      const EventEmitter = require('events');
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = jest.fn();
      mockWs.close = jest.fn();

      const onError = jest.fn();

      mockClient.createWebSocket.mockImplementation((_url, _token, internalCbs) => {
        process.nextTick(() => {
          mockWs.emit('open');
          process.nextTick(() => {
            internalCbs.onError?.({
              request_type: 'unknown',
              error_code: 400,
              reason_code: 0,
              error_message: 'Bad request',
            });
          });
        });
        return mockWs;
      });

      const streamSession = new VoiceStreamSession(
        mockClient, session, options, { onError },
      );

      await expect(streamSession.run(emptyChunks())).rejects.toThrow(VoiceError);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ error_code: 400 }),
      );
    });
  });
});

async function* emptyChunks(): AsyncGenerator<Buffer> {
  // yields nothing
}

 
async function* singleChunk(data: Buffer): AsyncGenerator<Buffer> {
  yield data;
}

// eslint-disable-next-line require-yield
async function* throwingChunks(): AsyncGenerator<Buffer> {
  throw new Error('chunk error');
}

/** A chunk source that reports whether the session closed it. */
function trackedChunks(): { chunks: AsyncGenerator<Buffer>; closed: () => boolean } {
  let closed = false;
  async function* generate(): AsyncGenerator<Buffer> {
    try {
      yield Buffer.from('audio-1');
      yield Buffer.from('audio-2');
    } finally {
      closed = true;
    }
  }
  return { chunks: generate(), closed: () => closed };
}

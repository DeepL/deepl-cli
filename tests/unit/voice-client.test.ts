/**
 * Tests for VoiceClient
 * Covers REST session creation and WebSocket message handling.
 */

import { VoiceClient } from '../../src/api/voice-client.js';
import { VoiceError } from '../../src/utils/errors.js';
import axios from 'axios';
import type {
  VoiceSessionRequest,
  VoiceSessionResponse,
  VoiceStreamCallbacks,
} from '../../src/types/voice.js';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock ws
let lastWsConstructorArgs: {
  url: string;
  options?: Record<string, unknown>;
} | null = null;
jest.mock('ws', () => {
  const EventEmitter = require('events');
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    _readyState = 1;
    bufferedAmount = 0;
    send = jest.fn();
    close = jest.fn();
    constructor(url: string, options?: Record<string, unknown>) {
      super();
      lastWsConstructorArgs = { url, options };
    }
    get readyState() {
      return this._readyState;
    }
    set readyState(val: number) {
      this._readyState = val;
    }
  }
  return { default: MockWebSocket, __esModule: true };
});

describe('VoiceClient', () => {
  let client: VoiceClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      request: jest.fn(),
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);

    client = new VoiceClient('test-api-key');
  });

  describe('constructor', () => {
    it('should create a VoiceClient instance', () => {
      expect(client).toBeInstanceOf(VoiceClient);
    });

    it('should throw error for empty API key', () => {
      expect(() => new VoiceClient('')).toThrow('API key is required');
    });

    it('should use Free API URL by default when no baseUrl is provided', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api-free.deepl.com',
        })
      );
    });

    it('should allow baseUrl override', () => {
      new VoiceClient('test-key', { baseUrl: 'https://custom.example.com' });
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.example.com',
        })
      );
    });
  });

  describe('createSession()', () => {
    const mockRequest: VoiceSessionRequest = {
      target_languages: ['de'],
      source_media_content_type: 'audio/mpeg',
    };

    const mockResponse: VoiceSessionResponse = {
      streaming_url: 'wss://voice.deepl.com/ws/123',
      token: 'test-token-abc',
      session_id: 'session-123',
    };

    it('should create a session successfully', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockResponse,
        status: 200,
        headers: {},
      });

      const result = await client.createSession(mockRequest);

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/v3/voice/realtime',
        })
      );
    });

    it('should throw VoiceError on 403', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Forbidden' }, headers: {} },
        message: 'Forbidden',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.createSession(mockRequest)).rejects.toThrow(
        VoiceError
      );
    });

    it('should throw VoiceError on 400', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Invalid request' },
          headers: {},
        },
        message: 'Bad request',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.createSession(mockRequest)).rejects.toThrow(
        VoiceError
      );
    });

    it('should include source_lang when provided', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockResponse,
        status: 200,
        headers: {},
      });

      const reqWithSource: VoiceSessionRequest = {
        ...mockRequest,
        source_language: 'en',
      };

      await client.createSession(reqWithSource);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source_language: 'en',
          }),
        })
      );
    });

    it('should include multiple target languages', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockResponse,
        status: 200,
        headers: {},
      });

      const multiTargetRequest: VoiceSessionRequest = {
        target_languages: ['de', 'fr', 'es'],
        source_media_content_type: 'audio/mpeg',
      };

      await client.createSession(multiTargetRequest);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            target_languages: ['de', 'fr', 'es'],
          }),
        })
      );
    });
  });

  describe('reconnectSession()', () => {
    it('should return new streaming_url and token on success', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: {
          streaming_url: 'wss://voice.deepl.com/ws/456',
          token: 'new-token',
        },
        status: 200,
        headers: {},
      });

      const result = await client.reconnectSession('old-token');

      expect(result).toEqual({
        streaming_url: 'wss://voice.deepl.com/ws/456',
        token: 'new-token',
      });
    });

    it('should pass token as query parameter', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: { streaming_url: 'wss://voice.deepl.com/ws', token: 'new' },
        status: 200,
        headers: {},
      });

      await client.reconnectSession('my-token');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/v3/voice/realtime',
          params: expect.objectContaining({ token: 'my-token' }),
        })
      );
    });

    it('should throw VoiceError on 403', async () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Forbidden' }, headers: {} },
        message: 'Forbidden',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.reconnectSession('expired-token')).rejects.toThrow(
        VoiceError
      );
    });

    it('should throw VoiceError on 400', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Invalid token' },
          headers: {},
        },
        message: 'Bad request',
      };
      mockAxiosInstance.request.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.reconnectSession('bad-token')).rejects.toThrow(
        VoiceError
      );
    });
  });

  describe('createWebSocket()', () => {
    it('should set maxPayload to 1 MiB on the WebSocket', () => {
      client.createWebSocket('wss://voice.deepl.com/ws/123', 'token', {});
      expect(lastWsConstructorArgs?.options).toEqual(
        expect.objectContaining({ maxPayload: 1048576 })
      );
    });

    it('should create a WebSocket and route messages', () => {
      const callbacks: VoiceStreamCallbacks = {
        onSourceTranscript: jest.fn(),
        onTargetTranscript: jest.fn(),
        onEndOfSourceTranscript: jest.fn(),
        onEndOfTargetTranscript: jest.fn(),
        onEndOfStream: jest.fn(),
        onError: jest.fn(),
      };

      const ws = client.createWebSocket(
        'wss://voice.deepl.com/ws/123',
        'token',
        callbacks
      );
      expect(ws).toBeDefined();
    });

    it('should accept wss:// URLs with deepl.com hostname', () => {
      expect(() =>
        client.createWebSocket('wss://voice.deepl.com/ws/123', 'token', {})
      ).not.toThrow();
    });

    it('should accept wss:// URLs with subdomains of deepl.com', () => {
      expect(() =>
        client.createWebSocket('wss://api.voice.deepl.com/ws/123', 'token', {})
      ).not.toThrow();
    });

    it('should reject non-wss:// schemes', () => {
      expect(() =>
        client.createWebSocket('ws://voice.deepl.com/ws/123', 'token', {})
      ).toThrow(VoiceError);
      expect(() =>
        client.createWebSocket('ws://voice.deepl.com/ws/123', 'token', {})
      ).toThrow('Invalid streaming URL: scheme must be wss://');
    });

    it('should reject http:// schemes', () => {
      expect(() =>
        client.createWebSocket('http://voice.deepl.com/ws/123', 'token', {})
      ).toThrow(VoiceError);
    });

    it('should reject hostnames not under deepl.com', () => {
      expect(() =>
        client.createWebSocket('wss://evil.example.com/ws/123', 'token', {})
      ).toThrow(VoiceError);
      expect(() =>
        client.createWebSocket('wss://evil.example.com/ws/123', 'token', {})
      ).toThrow('Invalid streaming URL: hostname must be under deepl.com');
    });

    it('should reject hostnames that look like deepl.com but are not', () => {
      expect(() =>
        client.createWebSocket('wss://notdeepl.com/ws/123', 'token', {})
      ).toThrow(VoiceError);
      expect(() =>
        client.createWebSocket('wss://deepl.com.evil.com/ws/123', 'token', {})
      ).toThrow(VoiceError);
    });

    it('should reject invalid URLs', () => {
      expect(() => client.createWebSocket('not-a-url', 'token', {})).toThrow(
        VoiceError
      );
    });

    it('should dispatch source_transcript_update messages', () => {
      const onSourceTranscript = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onSourceTranscript,
      });

      const message = JSON.stringify({
        source_transcript_update: {
          concluded: [
            { text: 'Hello', language: 'en', start_time: 0, end_time: 1 },
          ],
          tentative: [],
        },
      });

      ws.emit('message', Buffer.from(message));
      expect(onSourceTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          concluded: [
            { text: 'Hello', language: 'en', start_time: 0, end_time: 1 },
          ],
        })
      );
    });

    it('should dispatch target_transcript_update messages', () => {
      const onTargetTranscript = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onTargetTranscript,
      });

      const message = JSON.stringify({
        target_transcript_update: {
          language: 'de',
          concluded: [{ text: 'Hallo', start_time: 0, end_time: 1 }],
          tentative: [],
        },
      });

      ws.emit('message', Buffer.from(message));
      expect(onTargetTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'de',
        })
      );
    });

    it('should dispatch end_of_stream messages', () => {
      const onEndOfStream = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onEndOfStream,
      });

      ws.emit('message', Buffer.from(JSON.stringify({ end_of_stream: {} })));
      expect(onEndOfStream).toHaveBeenCalled();
    });

    it('should dispatch end_of_source_transcript messages', () => {
      const onEndOfSourceTranscript = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onEndOfSourceTranscript,
      });

      ws.emit(
        'message',
        Buffer.from(JSON.stringify({ end_of_source_transcript: {} }))
      );
      expect(onEndOfSourceTranscript).toHaveBeenCalled();
    });

    it('should dispatch end_of_target_transcript messages', () => {
      const onEndOfTargetTranscript = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onEndOfTargetTranscript,
      });

      ws.emit(
        'message',
        Buffer.from(
          JSON.stringify({ end_of_target_transcript: { language: 'de' } })
        )
      );
      expect(onEndOfTargetTranscript).toHaveBeenCalledWith('de');
    });

    it('should dispatch error messages', () => {
      const onError = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onError,
      });

      ws.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            error: {
              request_type: 'unknown',
              error_code: 400,
              reason_code: 9040000,
              error_message: 'Invalid audio format',
            },
          })
        )
      );
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          error_code: 400,
          error_message: 'Invalid audio format',
        })
      );
    });

    // Transport errors belong to whoever owns the socket lifecycle: routing
    // them into onError made them indistinguishable from server error
    // messages, and left every socket carrying two 'error' listeners.
    it('should leave transport errors to the socket owner', () => {
      const onError = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onError,
      });
      const transportErrors: Error[] = [];
      ws.on('error', (error: Error) => transportErrors.push(error));

      ws.emit('error', new Error('Connection failed'));

      expect(ws.listenerCount('error')).toBe(1);
      expect(transportErrors).toHaveLength(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it('should ignore unparseable messages', () => {
      const onError = jest.fn();
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onError,
      });

      ws.emit('message', Buffer.from('not json'));
      expect(onError).not.toHaveBeenCalled();
    });

    it('should propagate callback errors instead of swallowing them', () => {
      const onSourceTranscript = jest.fn().mockImplementation(() => {
        throw new Error('callback error');
      });
      const ws = client.createWebSocket('wss://voice.deepl.com/ws', 'token', {
        onSourceTranscript,
      });

      const message = JSON.stringify({
        source_transcript_update: {
          concluded: [
            { text: 'Hello', language: 'en', start_time: 0, end_time: 1 },
          ],
          tentative: [],
        },
      });

      expect(() => ws.emit('message', Buffer.from(message))).toThrow(
        'callback error'
      );
    });
  });

  describe('sendAudioChunk()', () => {
    it('should send base64 audio chunk and return true when buffer is low', () => {
      const ws = client.createWebSocket(
        'wss://voice.deepl.com/ws',
        'token',
        {}
      );
      Object.defineProperty(ws, 'bufferedAmount', { value: 0, writable: true });
      const result = client.sendAudioChunk(ws, 'dGVzdA==');
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ source_media_chunk: { data: 'dGVzdA==' } })
      );
      expect(result).toBe(true);
    });

    it('should return false when WebSocket is not open', () => {
      const ws = client.createWebSocket(
        'wss://voice.deepl.com/ws',
        'token',
        {}
      );
      (ws as any).readyState = 3; // CLOSED
      const result = client.sendAudioChunk(ws, 'dGVzdA==');
      expect(ws.send).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should return false when bufferedAmount exceeds high-water mark', () => {
      const ws = client.createWebSocket(
        'wss://voice.deepl.com/ws',
        'token',
        {}
      );
      Object.defineProperty(ws, 'bufferedAmount', {
        value: 2 * 1024 * 1024,
        writable: true,
      });
      const result = client.sendAudioChunk(ws, 'dGVzdA==');
      expect(ws.send).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('sendEndOfSource()', () => {
    it('should send end_of_source_media message', () => {
      const ws = client.createWebSocket(
        'wss://voice.deepl.com/ws',
        'token',
        {}
      );
      client.sendEndOfSource(ws);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ end_of_source_media: {} })
      );
    });

    it('should not send if WebSocket is not open', () => {
      const ws = client.createWebSocket(
        'wss://voice.deepl.com/ws',
        'token',
        {}
      );
      (ws as any).readyState = 3; // CLOSED
      client.sendEndOfSource(ws);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});

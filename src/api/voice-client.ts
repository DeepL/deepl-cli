/**
 * Voice API Client
 * Handles REST session creation and WebSocket streaming for the DeepL Voice API.
 */

import WebSocket from 'ws';
import {
  HttpClient,
  type DeepLClientOptions,
  USER_AGENT,
} from './http-client.js';
import type {
  VoiceSessionRequest,
  VoiceSessionResponse,
  VoiceReconnectResponse,
  VoiceServerMessage,
  VoiceStreamCallbacks,
} from '../types/index.js';
import { AuthError, VoiceError } from '../utils/errors.js';
import { normalizeFormality } from '../utils/formality.js';
const WS_HIGH_WATER_MARK = 1024 * 1024; // 1 MiB

export class VoiceClient extends HttpClient {
  constructor(apiKey: string, options: DeepLClientOptions = {}) {
    super(apiKey, options);
  }

  async createSession(
    request: VoiceSessionRequest
  ): Promise<VoiceSessionResponse> {
    try {
      const body: Record<string, unknown> = {
        target_languages: request.target_languages,
        source_media_content_type: request.source_media_content_type,
      };
      if (request.source_language !== undefined) {
        body['source_language'] = request.source_language;
      }
      if (request.source_language_mode !== undefined) {
        body['source_language_mode'] = request.source_language_mode;
      }
      if (request.formality !== undefined) {
        body['formality'] = normalizeFormality(request.formality, 'voice');
      }
      if (request.glossary_id !== undefined) {
        body['glossary_id'] = request.glossary_id;
      }
      return await this.makeJsonRequest<VoiceSessionResponse>(
        'POST',
        '/v3/voice/realtime',
        body
      );
    } catch (error) {
      throw this.handleVoiceError(error);
    }
  }

  async reconnectSession(token: string): Promise<VoiceReconnectResponse> {
    try {
      return await this.makeJsonRequest<VoiceReconnectResponse>(
        'GET',
        '/v3/voice/realtime',
        undefined,
        { token }
      );
    } catch (error) {
      throw this.handleVoiceError(error);
    }
  }

  // Security: The token is passed as a URL query parameter because the DeepL
  // Voice API requires it (WebSocket headers are not supported by the browser
  // WebSocket API the server protocol targets). Tokens in URLs may appear in
  // proxy/CDN access logs. The CLI must never log the full WebSocket URL.
  createWebSocket(
    streamingUrl: string,
    token: string,
    callbacks: VoiceStreamCallbacks
  ): WebSocket {
    this.validateStreamingUrl(streamingUrl);
    const url = `${streamingUrl}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url, {
      handshakeTimeout: 30_000,
      maxPayload: 1024 * 1024,
      headers: { 'User-Agent': USER_AGENT },
    });

    ws.on('message', (data: WebSocket.Data) => {
      const text =
        typeof data === 'string'
          ? data
          : Buffer.from(data as ArrayBuffer).toString('utf-8');
      let message: VoiceServerMessage;
      try {
        message = JSON.parse(text) as VoiceServerMessage;
      } catch {
        return; // Ignore unparseable messages
      }
      this.dispatchMessage(message, callbacks);
    });

    // Transport errors stay on the socket: `callbacks.onError` carries
    // server error messages only, so a dropped connection is
    // distinguishable from a protocol error, and the socket keeps a single
    // 'error' listener owned by whoever drives its lifecycle.
    return ws;
  }

  sendAudioChunk(ws: WebSocket, base64Data: string): boolean {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify({ source_media_chunk: { data: base64Data } }));
    return ws.bufferedAmount < WS_HIGH_WATER_MARK;
  }

  sendEndOfSource(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ end_of_source_media: {} }));
    }
  }

  private validateStreamingUrl(streamingUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(streamingUrl);
    } catch {
      throw new VoiceError('Invalid streaming URL: unable to parse URL');
    }

    if (parsed.protocol !== 'wss:') {
      throw new VoiceError('Invalid streaming URL: scheme must be wss://');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'deepl.com' && !hostname.endsWith('.deepl.com')) {
      throw new VoiceError(
        'Invalid streaming URL: hostname must be under deepl.com'
      );
    }
  }

  private dispatchMessage(
    message: VoiceServerMessage,
    callbacks: VoiceStreamCallbacks
  ): void {
    if (message.source_transcript_update) {
      callbacks.onSourceTranscript?.(message.source_transcript_update);
    } else if (message.target_transcript_update) {
      callbacks.onTargetTranscript?.(message.target_transcript_update);
    } else if (message.end_of_source_transcript !== undefined) {
      callbacks.onEndOfSourceTranscript?.();
    } else if (message.end_of_target_transcript) {
      callbacks.onEndOfTargetTranscript?.(
        message.end_of_target_transcript.language
      );
    } else if (message.end_of_stream !== undefined) {
      callbacks.onEndOfStream?.();
    } else if (message.error) {
      callbacks.onError?.(message.error);
    }
  }

  private handleVoiceError(error: unknown): Error {
    if (this.isAxiosError(error)) {
      const status = error.response?.status;
      const responseData = error.response?.data as
        | { message?: string }
        | undefined;

      if (status === 403) {
        return new VoiceError(
          'Voice API access denied. Your plan may not include Voice API access.',
          'The Voice API requires a DeepL Pro or Enterprise plan. Visit https://www.deepl.com/pro to upgrade.'
        );
      }

      if (status === 400) {
        return new VoiceError(
          `Voice session creation failed: ${responseData?.message ?? 'Bad request'}`
        );
      }
    }

    // executeWithRetry classifies 403 as AuthError before it reaches here;
    // reclassify as VoiceError with a more specific message.
    if (error instanceof AuthError) {
      return new VoiceError(
        'Voice API access denied. Your plan may not include Voice API access.',
        'The Voice API requires a DeepL Pro or Enterprise plan. Visit https://www.deepl.com/pro to upgrade.'
      );
    }

    // For other already-classified errors (e.g. 400 → generic Error from handleError),
    // wrap as VoiceError if the message indicates an API error.
    if (error instanceof Error && error.message.startsWith('API error:')) {
      return new VoiceError(
        `Voice session creation failed: ${error.message.replace('API error: ', '')}`
      );
    }

    return this.handleError(error);
  }
}

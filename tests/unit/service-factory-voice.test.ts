/**
 * Tests for createVoiceCommand URL validation.
 * Ensures VoiceClient path validates API URL the same way createDeepLClient does.
 */

jest.mock('ws', () => {
   
  const { EventEmitter } = require('events');
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    send = jest.fn();
    close = jest.fn();
  }
  return { default: MockWebSocket, __esModule: true };
});

jest.mock('chalk', () => {
  const passthrough = (s: string) => s;
  return { __esModule: true, default: { red: passthrough, green: passthrough, blue: passthrough, yellow: passthrough, gray: passthrough, bold: passthrough, level: 3 } };
});

import { createVoiceCommand, type GetApiKeyAndOptions } from '../../src/cli/commands/service-factory.js';

describe('createVoiceCommand', () => {
  it('should reject insecure HTTP base URL', async () => {
    const getApiKeyAndOptions: GetApiKeyAndOptions = () => ({
      apiKey: 'test-key',
      options: { baseUrl: 'http://evil.com' },
    });

    await expect(createVoiceCommand(getApiKeyAndOptions)).rejects.toThrow(
      /Insecure HTTP URL rejected/,
    );
  });

  it('should reject unsupported protocol', async () => {
    const getApiKeyAndOptions: GetApiKeyAndOptions = () => ({
      apiKey: 'test-key',
      options: { baseUrl: 'ftp://evil.com' },
    });

    await expect(createVoiceCommand(getApiKeyAndOptions)).rejects.toThrow(
      /Unsupported protocol/,
    );
  });

  it('should allow HTTPS base URL', async () => {
    const getApiKeyAndOptions: GetApiKeyAndOptions = () => ({
      apiKey: 'test-key',
      options: { baseUrl: 'https://api.deepl.com' },
    });

    const voiceCommand = await createVoiceCommand(getApiKeyAndOptions);
    expect(voiceCommand).toHaveProperty('translate');
  });

  it('should allow HTTP localhost for testing', async () => {
    const getApiKeyAndOptions: GetApiKeyAndOptions = () => ({
      apiKey: 'test-key',
      options: { baseUrl: 'http://localhost:3000' },
    });

    const voiceCommand = await createVoiceCommand(getApiKeyAndOptions);
    expect(voiceCommand).toHaveProperty('translate');
  });

  it('should allow HTTP 127.0.0.1 for testing', async () => {
    const getApiKeyAndOptions: GetApiKeyAndOptions = () => ({
      apiKey: 'test-key',
      options: { baseUrl: 'http://127.0.0.1:8080' },
    });

    const voiceCommand = await createVoiceCommand(getApiKeyAndOptions);
    expect(voiceCommand).toHaveProperty('translate');
  });

  it('should allow undefined base URL (uses default)', async () => {
    const getApiKeyAndOptions: GetApiKeyAndOptions = () => ({
      apiKey: 'test-key',
      options: {},
    });

    const voiceCommand = await createVoiceCommand(getApiKeyAndOptions);
    expect(voiceCommand).toHaveProperty('translate');
  });

  it('should reject invalid URL format', async () => {
    const getApiKeyAndOptions: GetApiKeyAndOptions = () => ({
      apiKey: 'test-key',
      options: { baseUrl: 'not-a-url' },
    });

    await expect(createVoiceCommand(getApiKeyAndOptions)).rejects.toThrow(
      /Invalid URL/,
    );
  });
});

/**
 * Tests for Logger utility
 */

import { Logger } from '../../src/utils/logger';

describe('Logger', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    // Reset logger state
    Logger.setQuiet(false);
    Logger.setVerbose(false);
  });

  describe('setQuiet()', () => {
    it('should enable quiet mode', () => {
      Logger.setQuiet(true);
      expect(Logger.isQuiet()).toBe(true);
    });

    it('should disable quiet mode', () => {
      Logger.setQuiet(true);
      Logger.setQuiet(false);
      expect(Logger.isQuiet()).toBe(false);
    });
  });

  describe('info()', () => {
    it('should log info messages to stderr in normal mode', () => {
      Logger.info('Test message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Test message');
    });

    it('should suppress info messages in quiet mode', () => {
      Logger.setQuiet(true);
      Logger.info('Test message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle multiple arguments', () => {
      Logger.info('Message', 'with', 'args');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Message', 'with', 'args');
    });
  });

  describe('success()', () => {
    it('should log success messages to stderr in normal mode', () => {
      Logger.success('Success message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Success message');
    });

    it('should suppress success messages in quiet mode', () => {
      Logger.setQuiet(true);
      Logger.success('Success message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('warn()', () => {
    it('should log warnings in normal mode', () => {
      Logger.warn('Warning message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Warning message');
    });

    it('should suppress warnings in quiet mode', () => {
      Logger.setQuiet(true);
      Logger.warn('Warning message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('error()', () => {
    it('should log errors in normal mode', () => {
      Logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error message');
    });

    it('should always log errors even in quiet mode', () => {
      Logger.setQuiet(true);
      Logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error message');
    });

    it('should handle multiple arguments', () => {
      Logger.setQuiet(true);
      Logger.error('Error:', 'details');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', 'details');
    });
  });

  describe('output()', () => {
    it('should log output in normal mode', () => {
      Logger.output('Result');
      expect(consoleLogSpy).toHaveBeenCalledWith('Result');
    });

    it('should always log output even in quiet mode', () => {
      Logger.setQuiet(true);
      Logger.output('Result');
      expect(consoleLogSpy).toHaveBeenCalledWith('Result');
    });

    it('should handle objects', () => {
      const obj = { text: 'Hello' };
      Logger.output(obj);
      expect(consoleLogSpy).toHaveBeenCalledWith(obj);
    });
  });

  describe('setVerbose()', () => {
    it('should enable verbose mode', () => {
      Logger.setVerbose(true);
      expect(Logger.isVerbose()).toBe(true);
    });

    it('should disable verbose mode', () => {
      Logger.setVerbose(true);
      Logger.setVerbose(false);
      expect(Logger.isVerbose()).toBe(false);
    });

    it('should default to disabled', () => {
      expect(Logger.isVerbose()).toBe(false);
    });
  });

  describe('verbose()', () => {
    it('should not log when verbose mode is disabled', () => {
      Logger.verbose('Verbose message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log to stderr when verbose mode is enabled', () => {
      Logger.setVerbose(true);
      Logger.verbose('Verbose message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Verbose message');
    });

    it('should suppress verbose messages in quiet mode even when verbose is enabled', () => {
      Logger.setVerbose(true);
      Logger.setQuiet(true);
      Logger.verbose('Verbose message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle multiple arguments', () => {
      Logger.setVerbose(true);
      Logger.verbose('Key:', 'value', 123);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Key:', 'value', 123);
    });
  });

  describe('verbose() sanitization', () => {
    beforeEach(() => {
      Logger.setVerbose(true);
    });

    it('should redact ?token= query parameter from URLs', () => {
      Logger.verbose('wss://api.deepl.com/ws?token=abc123-secret');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'wss://api.deepl.com/ws?token=[REDACTED]'
      );
    });

    it('should redact &token= query parameter from URLs', () => {
      Logger.verbose('https://api.deepl.com/ws?lang=en&token=abc123-secret&format=text');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'https://api.deepl.com/ws?lang=en&token=[REDACTED]&format=text'
      );
    });

    it('should redact DeepL-Auth-Key header values', () => {
      Logger.verbose('Authorization: DeepL-Auth-Key abc123-secret:fx');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Authorization: DeepL-Auth-Key [REDACTED]'
      );
    });

    it('should redact DeepL-Auth-Key case-insensitively', () => {
      Logger.verbose('deepl-auth-key MY-KEY:fx');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'DeepL-Auth-Key [REDACTED]'
      );
    });

    it('should redact X-Api-Key header values', () => {
      Logger.verbose('Headers: X-Api-Key: abcd-1234-efgh');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Headers: X-Api-Key: [REDACTED]'
      );
    });

    it('should redact X-Auth-Token header values', () => {
      Logger.verbose('Headers: X-Auth-Token: deadbeef-1234');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Headers: X-Auth-Token: [REDACTED]'
      );
    });

    it('should redact X-Api-Key case-insensitively', () => {
      Logger.verbose('x-api-key: MY-SECRET');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'X-Api-Key: [REDACTED]'
      );
    });

    it('should redact ?api_key= query parameter from URLs', () => {
      Logger.verbose('https://tms.example.com/projects?api_key=abc123&format=json');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'https://tms.example.com/projects?api_key=[REDACTED]&format=json'
      );
    });

    it('should redact ?apikey= (no underscore or hyphen) query parameter from URLs', () => {
      Logger.verbose('https://tms.example.com/projects?apikey=abc123');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'https://tms.example.com/projects?api_key=[REDACTED]'
      );
    });

    it('should redact DEEPL_API_KEY env var value from strings', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'test-secret-key-123:fx';
      try {
        Logger.verbose('Using key test-secret-key-123:fx for request');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Using key [REDACTED] for request'
        );
      } finally {
        if (originalKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });

    it('should not redact when DEEPL_API_KEY is not set', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      delete process.env['DEEPL_API_KEY'];
      try {
        Logger.verbose('Some message with no key to redact');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Some message with no key to redact'
        );
      } finally {
        if (originalKey !== undefined) {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });

    it('should redact inside plain object args and leave primitives unchanged', () => {
      const obj = { url: 'wss://api.deepl.com/ws?token=secret' };
      Logger.verbose(obj, 42, null);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        { url: 'wss://api.deepl.com/ws?token=[REDACTED]' },
        42,
        null
      );
      // The caller's object is not mutated.
      expect(obj.url).toBe('wss://api.deepl.com/ws?token=secret');
    });

    it('should sanitize multiple string args independently', () => {
      Logger.verbose('wss://host?token=secret', 'DeepL-Auth-Key my-key');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'wss://host?token=[REDACTED]',
        'DeepL-Auth-Key [REDACTED]'
      );
    });

    it('should apply all sanitization patterns to a single string', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'combo-key:fx';
      try {
        Logger.verbose('url?token=tok1 header DeepL-Auth-Key combo-key:fx end');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'url?token=[REDACTED] header DeepL-Auth-Key [REDACTED] end'
        );
      } finally {
        if (originalKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });
  });

  describe('error() sanitization', () => {
    it('should redact API key from error messages', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'secret-error-key:fx';
      try {
        Logger.error('Request failed with key secret-error-key:fx');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Request failed with key [REDACTED]'
        );
      } finally {
        if (originalKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });

    it('should redact DeepL-Auth-Key from error messages', () => {
      Logger.error('Auth failed: DeepL-Auth-Key abc123-secret:fx');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Auth failed: DeepL-Auth-Key [REDACTED]'
      );
    });

    it('should redact token query parameters from error messages', () => {
      Logger.error('Connection failed: wss://api.deepl.com/ws?token=secret123');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Connection failed: wss://api.deepl.com/ws?token=[REDACTED]'
      );
    });

    it('should sanitize even in quiet mode', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'quiet-key:fx';
      try {
        Logger.setQuiet(true);
        Logger.error('Error with quiet-key:fx exposed');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error with [REDACTED] exposed'
        );
      } finally {
        if (originalKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });
  });

  describe('info() sanitization', () => {
    it('should redact API key from info messages', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'info-secret-key:fx';
      try {
        Logger.info('Using key info-secret-key:fx for request');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Using key [REDACTED] for request'
        );
      } finally {
        if (originalKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });

    it('should redact DeepL-Auth-Key from info messages', () => {
      Logger.info('Header: DeepL-Auth-Key my-secret-key');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Header: DeepL-Auth-Key [REDACTED]'
      );
    });
  });

  describe('warn() sanitization', () => {
    it('should redact API key from warn messages', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'warn-secret-key:fx';
      try {
        Logger.warn('Deprecation: key warn-secret-key:fx will expire');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Deprecation: key [REDACTED] will expire'
        );
      } finally {
        if (originalKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });
  });

  describe('success() sanitization', () => {
    it('should redact API key from success messages', () => {
      const originalKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'success-secret-key:fx';
      try {
        Logger.success('Authenticated with success-secret-key:fx');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Authenticated with [REDACTED]'
        );
      } finally {
        if (originalKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalKey;
        }
      }
    });
  });

  describe('spinner control', () => {
    const originalStderrIsTTY = process.stderr.isTTY;

    afterEach(() => {
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalStderrIsTTY,
        configurable: true,
        writable: true,
      });
    });

    it('should return true when not quiet and stderr is a TTY', () => {
      Object.defineProperty(process.stderr, 'isTTY', {
        value: true,
        configurable: true,
        writable: true,
      });
      expect(Logger.shouldShowSpinner()).toBe(true);
    });

    it('should return false in quiet mode even when stderr is a TTY', () => {
      Object.defineProperty(process.stderr, 'isTTY', {
        value: true,
        configurable: true,
        writable: true,
      });
      Logger.setQuiet(true);
      expect(Logger.shouldShowSpinner()).toBe(false);
    });

    it('should return false when stderr is not a TTY (piped / CI)', () => {
      Object.defineProperty(process.stderr, 'isTTY', {
        value: false,
        configurable: true,
        writable: true,
      });
      expect(Logger.shouldShowSpinner()).toBe(false);
    });
  });

  describe('TMS credential sanitization', () => {
    let originalTmsApiKey: string | undefined;
    let originalTmsToken: string | undefined;

    beforeEach(() => {
      originalTmsApiKey = process.env['TMS_API_KEY'];
      originalTmsToken = process.env['TMS_TOKEN'];
      delete process.env['TMS_API_KEY'];
      delete process.env['TMS_TOKEN'];
    });

    afterEach(() => {
      if (originalTmsApiKey === undefined) {
        delete process.env['TMS_API_KEY'];
      } else {
        process.env['TMS_API_KEY'] = originalTmsApiKey;
      }
      if (originalTmsToken === undefined) {
        delete process.env['TMS_TOKEN'];
      } else {
        process.env['TMS_TOKEN'] = originalTmsToken;
      }
    });

    it('should redact TMS_API_KEY env value when set', () => {
      process.env['TMS_API_KEY'] = 'test-tms-api-key-12345';
      Logger.info('TMS call used key test-tms-api-key-12345 successfully');
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(logged).not.toContain('test-tms-api-key-12345');
      expect(logged).toMatch(/\[REDACTED\]/);
      expect(logged).toBe('TMS call used key [REDACTED] successfully');
    });

    it('should redact TMS_TOKEN env value when set', () => {
      process.env['TMS_TOKEN'] = 'test-tms-token-67890';
      Logger.info('TMS token test-tms-token-67890 refreshed');
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(logged).not.toContain('test-tms-token-67890');
      expect(logged).toMatch(/\[REDACTED\]/);
      expect(logged).toBe('TMS token [REDACTED] refreshed');
    });

    it('should not redact when TMS_API_KEY is not set', () => {
      Logger.info('Generic message without any TMS values');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Generic message without any TMS values',
      );
    });

    it('should not redact when TMS_TOKEN is not set', () => {
      Logger.info('Another generic message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Another generic message');
    });

    it('should redact Authorization: ApiKey header values', () => {
      Logger.info('req headers: Authorization: ApiKey secret-value-xyz');
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(logged).not.toContain('secret-value-xyz');
      expect(logged).toMatch(/\[REDACTED\]/);
      expect(logged).toBe('req headers: Authorization: ApiKey [REDACTED]');
    });

    it('should redact Authorization: Bearer header values', () => {
      Logger.info('req headers: Authorization: Bearer jwt.xyz.abc');
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(logged).not.toContain('jwt.xyz.abc');
      expect(logged).toMatch(/\[REDACTED\]/);
      expect(logged).toBe('req headers: Authorization: Bearer [REDACTED]');
    });

    it('should redact Authorization: ApiKey case-insensitively', () => {
      Logger.info('authorization: apikey leaked-secret');
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(logged).not.toContain('leaked-secret');
      expect(logged).toMatch(/\[REDACTED\]/);
    });

    it('should redact Authorization header even when TMS env vars are not set', () => {
      Logger.info('Authorization: Bearer rotated-jwt-token');
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(logged).not.toContain('rotated-jwt-token');
      expect(logged).toMatch(/\[REDACTED\]/);
    });

    it('should redact env credentials inside object values', () => {
      process.env['TMS_API_KEY'] = 'test-tms-api-key-12345';
      process.env['TMS_TOKEN'] = 'test-tms-token-67890';
      const obj = { token: 'test-tms-token-67890' };
      Logger.info(obj, 42, null, undefined);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        { token: '[REDACTED]' },
        42,
        null,
        undefined
      );
    });

    it('should redact multiple distinct credentials in the same log line', () => {
      const originalDeeplKey = process.env['DEEPL_API_KEY'];
      process.env['DEEPL_API_KEY'] = 'deepl-key-abc:fx';
      process.env['TMS_API_KEY'] = 'test-tms-api-key-12345';
      process.env['TMS_TOKEN'] = 'test-tms-token-67890';
      try {
        Logger.info(
          'deepl=deepl-key-abc:fx tmsKey=test-tms-api-key-12345 tmsTok=test-tms-token-67890 url?token=qp-secret DeepL-Auth-Key deepl-key-abc:fx Authorization: Bearer jwt.abc',
        );
        const logged = consoleErrorSpy.mock.calls[0]?.[0] as string;
        expect(logged).not.toContain('deepl-key-abc:fx');
        expect(logged).not.toContain('test-tms-api-key-12345');
        expect(logged).not.toContain('test-tms-token-67890');
        expect(logged).not.toContain('qp-secret');
        expect(logged).not.toContain('jwt.abc');
        expect(logged).toMatch(/deepl=\[REDACTED\]/);
        expect(logged).toMatch(/tmsKey=\[REDACTED\]/);
        expect(logged).toMatch(/tmsTok=\[REDACTED\]/);
        expect(logged).toMatch(/\?token=\[REDACTED\]/);
        expect(logged).toMatch(/DeepL-Auth-Key \[REDACTED\]/);
        expect(logged).toMatch(/Authorization: Bearer \[REDACTED\]/);
      } finally {
        if (originalDeeplKey === undefined) {
          delete process.env['DEEPL_API_KEY'];
        } else {
          process.env['DEEPL_API_KEY'] = originalDeeplKey;
        }
      }
    });
  });

  describe('deep sanitization', () => {
    it('should redact through nested objects and arrays', () => {
      Logger.error({
        config: {
          headers: { Authorization: 'Authorization: Bearer secret-jwt' },
          urls: ['https://host?token=qp-secret', 'https://host/safe'],
        },
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith({
        config: {
          headers: { Authorization: 'Authorization: Bearer [REDACTED]' },
          urls: ['https://host?token=[REDACTED]', 'https://host/safe'],
        },
      });
    });

    it('should guard against circular references', () => {
      const obj: Record<string, unknown> = { url: 'https://host?token=loop-secret' };
      obj['self'] = obj;
      Logger.error(obj);
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(logged['url']).toBe('https://host?token=[REDACTED]');
      expect(logged['self']).toBe('[Circular]');
    });

    it('should redact Error message and stack while keeping it an Error', () => {
      const err = new Error('request failed: DeepL-Auth-Key leaked-key-value');
      Logger.error(err);
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as Error;
      expect(logged).toBeInstanceOf(Error);
      expect(logged.message).toBe('request failed: DeepL-Auth-Key [REDACTED]');
      expect(logged.stack).not.toContain('leaked-key-value');
      // The caller's error object is not mutated.
      expect(err.message).toContain('leaked-key-value');
    });

    it('should redact extra properties attached to an Error', () => {
      const err = new Error('boom') as Error & { config?: unknown };
      err.config = { headers: { Authorization: 'Authorization: ApiKey axios-secret' } };
      Logger.error(err);
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as Error & {
        config?: { headers?: { Authorization?: string } };
      };
      expect(logged).toBeInstanceOf(Error);
      expect(logged.config?.headers?.Authorization).toBe('Authorization: ApiKey [REDACTED]');
    });

    it('should pass non-plain objects through unchanged', () => {
      class Custom {
        value = 'https://host?token=class-secret';
      }
      const instance = new Custom();
      const map = new Map([['k', 'v']]);
      Logger.error(instance, map);
      expect(consoleErrorSpy).toHaveBeenCalledWith(instance, map);
    });

    it('should redact values in null-prototype objects', () => {
      const obj = Object.create(null) as Record<string, unknown>;
      obj['url'] = 'https://host?api_key=np-secret';
      Logger.error(obj);
      const logged = consoleErrorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(logged['url']).toBe('https://host?api_key=[REDACTED]');
    });
  });
});

/**
 * Exit Codes Tests
 * Tests for exit code classification and retry logic
 */

import { ExitCode, getExitCodeFromError, isRetryableError } from '../../src/utils/exit-codes';
import { AuthError } from '../../src/utils/errors';
import { Logger } from '../../src/utils/logger';

describe('ExitCode', () => {
  describe('enum values', () => {
    it('should have correct exit code values', () => {
      expect(ExitCode.Success).toBe(0);
      expect(ExitCode.GeneralError).toBe(1);
      expect(ExitCode.AuthError).toBe(2);
      expect(ExitCode.RateLimitError).toBe(3);
      expect(ExitCode.QuotaError).toBe(4);
      expect(ExitCode.NetworkError).toBe(5);
      expect(ExitCode.InvalidInput).toBe(6);
      expect(ExitCode.ConfigError).toBe(7);
      expect(ExitCode.CheckFailed).toBe(8);
      expect(ExitCode.VoiceError).toBe(9);
      expect(ExitCode.SyncDrift).toBe(10);
      expect(ExitCode.SyncConflict).toBe(11);
      expect(ExitCode.PartialFailure).toBe(12);
    });

    it('PartialFailure is distinct from GeneralError', () => {
      // PartialFailure must stay distinct from GeneralError so CI scripts can
      // tell "some locales failed" from "CLI crashed". 12 keeps a gap below
      // the Linux signal-exit range (128+signal).
      expect(ExitCode.PartialFailure).not.toBe(ExitCode.GeneralError);
    });
  });

  describe('getExitCodeFromError', () => {
    it.each<[string, string, ExitCode]>([
      // AuthError classification
      ['authentication failed', 'Authentication failed', ExitCode.AuthError],
      ['invalid api key', 'Invalid API key provided', ExitCode.AuthError],
      ['api key not set', 'API key not set', ExitCode.AuthError],
      ['api key required', 'API key is required', ExitCode.AuthError],
      ['auth (case insensitive)', 'AUTHENTICATION FAILED', ExitCode.AuthError],

      // RateLimitError classification
      ['rate limit exceeded', 'Rate limit exceeded', ExitCode.RateLimitError],
      ['too many requests', 'Too many requests', ExitCode.RateLimitError],
      ['HTTP 429', 'HTTP 429 error', ExitCode.RateLimitError],

      // QuotaError classification
      ['quota exceeded', 'Quota exceeded', ExitCode.QuotaError],
      ['character limit reached', 'Character limit reached', ExitCode.QuotaError],
      ['HTTP 456', 'HTTP 456 error', ExitCode.QuotaError],

      // NetworkError classification
      ['ECONNREFUSED', 'connect ECONNREFUSED', ExitCode.NetworkError],
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND', ExitCode.NetworkError],
      ['ECONNRESET', 'read ECONNRESET', ExitCode.NetworkError],
      ['ETIMEDOUT', 'connect ETIMEDOUT', ExitCode.NetworkError],
      ['socket hang up', 'socket hang up', ExitCode.NetworkError],
      ['network error phrase', 'Network error occurred', ExitCode.NetworkError],
      ['connection refused phrase', 'Connection refused', ExitCode.NetworkError],
      ['connection reset phrase', 'Connection reset by peer', ExitCode.NetworkError],
      ['connection timed out phrase', 'Connection timed out', ExitCode.NetworkError],
      ['network timeout phrase', 'Network timeout', ExitCode.NetworkError],
      ['service unavailable', 'Service temporarily unavailable', ExitCode.NetworkError],
      ['HTTP 503', 'HTTP 503 error', ExitCode.NetworkError],

      // InvalidInput classification
      ['cannot be empty', 'Text cannot be empty', ExitCode.InvalidInput],
      ['file not found', 'File not found', ExitCode.InvalidInput],
      ['path not found', 'Path not found: /tmp/missing', ExitCode.InvalidInput],
      ['directory not found', 'Directory not found: /tmp/dir', ExitCode.InvalidInput],
      ['not found in glossary', 'Term not found in glossary', ExitCode.InvalidInput],
      ['unsupported format', 'Unsupported format', ExitCode.InvalidInput],
      ['unsupported language', 'Unsupported language: xx', ExitCode.InvalidInput],
      ['not supported for', 'Formality not supported for EN', ExitCode.InvalidInput],
      ['not supported in', 'Feature not supported in free plan', ExitCode.InvalidInput],
      ['invalid target language', 'Invalid target language', ExitCode.InvalidInput],
      ['invalid source language', 'Invalid source language: xx', ExitCode.InvalidInput],
      ['invalid language code', 'Invalid language code: zz', ExitCode.InvalidInput],
      ['invalid glossary', 'Invalid glossary ID', ExitCode.InvalidInput],
      ['invalid hook', 'Invalid hook script', ExitCode.InvalidInput],
      ['invalid url', 'Invalid URL provided', ExitCode.InvalidInput],
      ['invalid size', 'Invalid size: exceeds limit', ExitCode.InvalidInput],
      ['"is required"', 'Target language is required', ExitCode.InvalidInput],
      ['cannot specify both', 'Cannot specify both --source and --auto-detect', ExitCode.InvalidInput],

      // ConfigError classification
      ['failed to load config', 'Failed to load config', ExitCode.ConfigError],
      ['config file', 'Config file corrupted', ExitCode.ConfigError],
      ['config directory', 'Config directory not writable', ExitCode.ConfigError],
      ['configuration file', 'Configuration file missing', ExitCode.ConfigError],
      ['configuration error', 'Configuration error: invalid JSON', ExitCode.ConfigError],
      ['failed to save config', 'Failed to save config', ExitCode.ConfigError],
    ])(
      'should classify %s error message "%s" → exit code %i',
      (_, message, expectedCode) => {
        expect(getExitCodeFromError(new Error(message))).toBe(expectedCode);
      },
    );

    describe('priority ordering', () => {
      it('should prioritize specific auth patterns over generic invalid pattern', () => {
        const error = new Error('invalid api key');
        expect(getExitCodeFromError(error)).toBe(ExitCode.AuthError);
      });

      it('should classify pure config file errors correctly', () => {
        const error = new Error('Config file corrupted');
        expect(getExitCodeFromError(error)).toBe(ExitCode.ConfigError);
      });
    });

    it.each<[string, string]>([
      ['bare "connection" without qualifying phrase', 'Database connection pool exhausted'],
      ['bare "timeout" without qualifying phrase', 'Lock acquisition timeout'],
      ['bare "required" without "is required"', 'All fields required by the API'],
      ['bare "config" in unrelated context', 'The config value was updated'],
      ['ambiguous "Database connection required for config"', 'Database connection required for config'],
      ['ambiguous "timeout waiting for required resource"', 'timeout waiting for required resource'],
      ['ambiguous "connection pool required"', 'connection pool required'],
      ['429 embedded in other numbers', 'Error code 14291'],
      ['503 embedded in other numbers', 'Reference ID: 50312'],
      ['456 embedded in other numbers', 'Transaction 45678 failed'],
      ['bare "not found"', 'Method not found in proxy', ],
      ['bare "invalid"', 'Invalid state: connection pool exhausted'],
      ['bare "unsupported"', 'Unsupported encoding utf-32'],
      ['bare "expected"', 'Expected closing bracket at position 42'],
      ['JSON parse error', 'Unexpected token } in JSON at position 42'],
      ['unknown message', 'Something went wrong'],
      ['empty message', ''],
      ['truly generic error', 'Something broke'],
    ])(
      'should fall back to GeneralError for %s ("%s")',
      (_, message) => {
        expect(getExitCodeFromError(new Error(message))).toBe(ExitCode.GeneralError);
      },
    );

    it('should log verbose warning when classifyByMessage is invoked', () => {
      const verboseSpy = jest.spyOn(Logger, 'verbose').mockImplementation();
      getExitCodeFromError(new Error('some unknown error'));
      expect(verboseSpy).toHaveBeenCalledWith(expect.stringContaining('Untyped error'));
      verboseSpy.mockRestore();
    });

    it('should not log verbose warning for typed DeepLCLIError', () => {
      const verboseSpy = jest.spyOn(Logger, 'verbose').mockImplementation();
      getExitCodeFromError(new AuthError('test'));
      expect(verboseSpy).not.toHaveBeenCalled();
      verboseSpy.mockRestore();
    });
  });

  describe('isRetryableError', () => {
    it.each<[string, ExitCode, boolean]>([
      ['rate limit errors', ExitCode.RateLimitError, true],
      ['network errors', ExitCode.NetworkError, true],
      ['auth errors', ExitCode.AuthError, false],
      ['quota errors', ExitCode.QuotaError, false],
      ['invalid input errors', ExitCode.InvalidInput, false],
      ['config errors', ExitCode.ConfigError, false],
      ['general errors', ExitCode.GeneralError, false],
      ['check failed', ExitCode.CheckFailed, false],
      ['success', ExitCode.Success, false],
    ])(
      'should mark %s (code %i) as retryable=%s',
      (_, exitCode, expected) => {
        expect(isRetryableError(exitCode)).toBe(expected);
      },
    );
  });
});

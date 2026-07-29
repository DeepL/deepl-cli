/**
 * Logger Utility
 * Centralized logging with quiet mode support
 */

class LoggerClass {
  private quiet: boolean = false;
  private verboseMode: boolean = false;

  /**
   * Enable or disable quiet mode
   */
  setQuiet(enabled: boolean): void {
    this.quiet = enabled;
  }

  /**
   * Check if quiet mode is enabled
   */
  isQuiet(): boolean {
    return this.quiet;
  }

  /**
   * Enable or disable verbose mode
   */
  setVerbose(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  /**
   * Check if verbose mode is enabled
   */
  isVerbose(): boolean {
    return this.verboseMode;
  }

  private sanitize(value: unknown): unknown {
    return this.sanitizeValue(value, new WeakSet());
  }

  /**
   * Recursively redact strings inside plain objects, arrays and Errors so a
   * dumped axios error (config.headers.Authorization etc.) cannot leak
   * credentials via util.inspect. Other object types pass through unchanged.
   */
  private sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return this.sanitizeString(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, seen));
    }

    if (value instanceof Error) {
      const copy = Object.create(Object.getPrototypeOf(value) as object) as object;
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) continue;
        // Accessor properties (V8 materializes `stack` lazily via a getter)
        // are flattened to their current value so the copy stays self-contained.
        const raw = 'value' in descriptor
          ? descriptor.value
          : (value as unknown as Record<string, unknown>)[key];
        Object.defineProperty(copy, key, {
          value: this.sanitizeValue(raw, seen),
          writable: true,
          configurable: true,
          enumerable: descriptor.enumerable,
        });
      }
      return copy;
    }

    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        result[key] = this.sanitizeValue(entry, seen);
      }
      return result;
    }

    return value;
  }

  private sanitizeString(value: string): string {
    let result = value;
    result = result.replace(/([?&])token=[^&\s]*/gi, '$1token=[REDACTED]');
    result = result.replace(/([?&])api[_-]?key=[^&\s]*/gi, '$1api_key=[REDACTED]');
    result = result.replace(/DeepL-Auth-Key\s+\S+/gi, 'DeepL-Auth-Key [REDACTED]');
    result = result.replace(
      /Authorization:\s+(ApiKey|Bearer)\s+\S+/gi,
      'Authorization: $1 [REDACTED]',
    );
    // X-Api-Key / X-Auth-Token — common in REST APIs and present on
    // TMS-style backends. axios error dumps frequently include the full
    // `config.headers` object, so these need explicit coverage.
    result = result.replace(/X-Api-Key:\s+\S+/gi, 'X-Api-Key: [REDACTED]');
    result = result.replace(/X-Auth-Token:\s+\S+/gi, 'X-Auth-Token: [REDACTED]');
    const apiKey = process.env['DEEPL_API_KEY'];
    if (apiKey) {
      result = result.replaceAll(apiKey, '[REDACTED]');
    }
    const tmsApiKey = process.env['TMS_API_KEY'];
    if (tmsApiKey) {
      result = result.replaceAll(tmsApiKey, '[REDACTED]');
    }
    const tmsToken = process.env['TMS_TOKEN'];
    if (tmsToken) {
      result = result.replaceAll(tmsToken, '[REDACTED]');
    }
    return result;
  }

  /**
   * Log verbose messages (only shown when verbose mode is enabled, suppressed in quiet mode)
   */
  verbose(...args: unknown[]): void {
    if (this.verboseMode && !this.quiet) {
      console.error(...args.map((arg) => this.sanitize(arg)));
    }
  }

  /**
   * Log informational messages (suppressed in quiet mode)
   */
  info(...args: unknown[]): void {
    if (!this.quiet) {
      console.error(...args.map((arg) => this.sanitize(arg)));
    }
  }

  /**
   * Log success messages (suppressed in quiet mode)
   */
  success(...args: unknown[]): void {
    if (!this.quiet) {
      console.error(...args.map((arg) => this.sanitize(arg)));
    }
  }

  /**
   * Log warning messages (suppressed in quiet mode)
   */
  warn(...args: unknown[]): void {
    if (!this.quiet) {
      console.error(...args.map((arg) => this.sanitize(arg)));
    }
  }

  /**
   * Log error messages (ALWAYS shown, even in quiet mode)
   */
  error(...args: unknown[]): void {
    console.error(...args.map((arg) => this.sanitize(arg)));
  }

  /**
   * Log essential output (ALWAYS shown, even in quiet mode)
   * Use this for translation results, command output, etc.
   */
  output(...args: unknown[]): void {
    console.log(...args);
  }

  /**
   * Check if spinners should be shown.
   * Returns false in quiet mode or when stderr is not a TTY — ora writes to
   * stderr by default, so a non-TTY stderr means spinners would either no-op
   * silently inside ora or (on older ora versions) leak ANSI escapes into CI
   * logs. Gating at this single chokepoint covers every `ora(...)` callsite.
   */
  shouldShowSpinner(): boolean {
    return !this.quiet && !!process.stderr.isTTY;
  }
}

// Export singleton instance
export const Logger = new LoggerClass();

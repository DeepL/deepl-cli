/**
 * Redact userinfo before a URL reaches a log line or an error message.
 * Unparseable input is reported as such rather than echoed back.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '[invalid URL]';
  }
}

# Troubleshooting Guide

Common issues and solutions when using the DeepL CLI.

## Table of Contents

- [Authentication Errors (Exit Code 2)](#authentication-errors-exit-code-2)
- [Setup Wizard Issues (`deepl init`)](#setup-wizard-issues-deepl-init)
- [Quota Errors (Exit Code 4)](#quota-errors-exit-code-4)
- [Rate Limiting (Exit Code 3)](#rate-limiting-exit-code-3)
- [Network Errors (Exit Code 5)](#network-errors-exit-code-5)
- [CheckFailed (Exit Code 8)](#checkfailed-exit-code-8)
- [Voice API Errors (Exit Code 9)](#voice-api-errors-exit-code-9)
- [Write API Issues](#write-api-issues)
- [Configuration Errors (Exit Code 7)](#configuration-errors-exit-code-7)
- [Input Validation Errors (Exit Code 6)](#input-validation-errors-exit-code-6)
- [Cache Issues](#cache-issues)
- [Document Translation Issues](#document-translation-issues)
- [Glossary Issues](#glossary-issues)
- [Exit Codes Reference](#exit-codes-reference)
- [Environment Variables](#environment-variables)
- [Getting More Help](#getting-more-help)
- [Still Having Issues?](#still-having-issues)

---

## Authentication Errors (Exit Code 2)

### "Authentication failed: Invalid API key"

**Cause:** The API key is missing, invalid, or expired.

**Solutions:**

1. Verify your key is set:

   ```bash
   deepl auth show
   ```

   - With a key configured: `API Key: XXXX...XXXX` (shows first 4 and last 4 characters)
   - Without a key: `No API key set`

2. Set or update your key:

   ```bash
   deepl auth set-key YOUR_API_KEY
   ```

3. Alternatively, use the environment variable:

   ```bash
   export DEEPL_API_KEY="your-key-here"
   ```

4. Verify the key works:
   ```bash
   deepl auth show
   ```

**Notes:**

- Free API keys end with `:fx`. Pro keys do not.
- The CLI auto-detects the API endpoint from the key suffix: `:fx` keys use `api-free.deepl.com`, others use `api.deepl.com`. Custom regional endpoints (e.g. `api-jp.deepl.com`) always take priority.
- The stored config key takes precedence over the `DEEPL_API_KEY` environment variable.

---

## Setup Wizard Issues (`deepl init`)

### Setup wizard fails with network error

**Cause:** The `deepl init` wizard validates your API key by contacting the DeepL API. If the network is unreachable, validation will fail.

**Solutions:**

1. Check your internet connection and try again:

   ```bash
   deepl init
   ```

2. If behind a proxy, set proxy environment variables before running init:
   ```bash
   export HTTPS_PROXY=https://proxy.example.com:8443
   deepl init
   ```

### API key validation fails during setup

**Cause:** The key you entered is invalid, expired, or for a different API tier than expected.

**Solutions:**

1. Double-check your API key on the [DeepL account page](https://www.deepl.com/account/summary).

2. Ensure you're copying the full key, including the `:fx` suffix for free-tier keys.

3. As a manual fallback, skip the wizard and set the key directly:
   ```bash
   deepl auth set-key YOUR_API_KEY
   ```

---

## Quota Errors (Exit Code 4)

### "Quota exceeded: Character limit reached"

**Cause:** Your DeepL account has reached its character translation limit.

**Solutions:**

1. Check your current usage:

   ```bash
   deepl usage
   ```

2. For detailed breakdown:

   ```bash
   deepl usage --format json
   ```

3. Wait for your quota to reset (monthly for most plans), or upgrade your DeepL plan.

---

## Rate Limiting (Exit Code 3)

### "Rate limit exceeded: Too many requests"

**Cause:** Too many API requests in a short time period.

**Solutions:**

1. The CLI automatically retries rate-limited requests with exponential backoff. If you still see this error, reduce concurrency.

2. For batch/directory translation, the CLI uses concurrency control internally. Avoid running multiple CLI instances simultaneously on the same API key.

3. Retries honor the server's `Retry-After` header when present, falling back to full-jitter exponential backoff (max 3 retries by default; see the global `--max-retries` flag). If errors persist, wait and try again.

---

## Network Errors (Exit Code 5)

### "Network error: timeout" or "ECONNREFUSED"

**Cause:** Cannot reach the DeepL API servers.

**Solutions:**

1. Check your internet connection.

2. Verify DeepL API is reachable:

   ```bash
   curl -s https://api-free.deepl.com/v2/languages -H "Authorization: DeepL-Auth-Key YOUR_KEY"
   ```

3. If behind a corporate proxy, configure it via environment variables:

   ```bash
   export HTTPS_PROXY=https://proxy.example.com:8443
   # or
   export HTTP_PROXY=http://proxy.example.com:8080
   ```

4. The CLI retries idempotent requests on transient network errors automatically. Requests that submit work (translations, document uploads, glossary creation) are replayed only when the error proves the request never reached the server, so they are never double-billed — for those, rerun the command (exit code 5 is safe to retry at the script level).

### "Request failed with status code 503"

**Cause:** The DeepL API is temporarily overloaded or undergoing maintenance.

**Solutions:**

1. Wait a few minutes and retry your request.

2. Use `--no-cache` to bypass any stale cached error responses:

   ```bash
   deepl translate "Hello" --to es --no-cache
   ```

3. Read-only requests are retried automatically on 503. Requests that submit work (translate, document upload) surface the error immediately so they are never double-billed; retry them at the script level (exit code 5). If the error persists, the API may be experiencing an extended outage.

---

## CheckFailed (Exit Code 8)

### `deepl write --check` returns exit code 8

**Cause:** This is expected behavior, not an error. Exit code 8 means `deepl write --check` found improvements for your text.

**Details:**

- **Exit 0** — Text is clean, no improvements suggested.
- **Exit 8** — Improvements were found and suggested.

This exit code is useful in CI/CD pipelines or scripts to detect when text could be improved:

```bash
deepl write --check "Your text" --lang en-US
if [ $? -eq 8 ]; then
  echo "Text has suggested improvements"
fi
```

---

## Voice API Errors (Exit Code 9)

### "Voice API access denied"

**Cause:** Voice API requires a DeepL Pro account with Voice API access enabled.

**Solutions:**

1. Verify your account has Voice API access on the DeepL website.
2. Voice API uses the same endpoint resolution as other commands (`:fx` keys use `api-free.deepl.com`).
3. Check that your audio file format is supported (OGG, Opus, WebM, MKA, FLAC, MP3, PCM).

### "Invalid streaming URL"

**Cause:** The WebSocket URL returned by the API failed validation.

**Notes:**

- The CLI validates that streaming URLs use `wss://` scheme and `*.deepl.com` hostnames.
- This is a security check to prevent connection to unauthorized servers.
- If you see this error, it may indicate an API issue. Try again later.

### Audio format issues

If the CLI cannot auto-detect your audio format from the file extension, specify it explicitly:

```bash
deepl voice audio.raw --to de --content-type 'audio/pcm;encoding=s16le;rate=16000'
```

Supported formats: `audio/ogg`, `audio/webm`, `audio/flac`, `audio/mpeg`, `audio/x-matroska`, and PCM variants.

---

## Write API Issues

### Unsupported language pair

**Cause:** The Write API supports fewer language pairs than the Translate API. Not all combinations are available.

**Solutions:**

1. Check which languages Write API supports:

   ```bash
   deepl write --help
   ```

2. Use `--verbose` to see the API request and response details:

   ```bash
   deepl write "Your text" --lang en-US --verbose
   ```

3. If your language pair is unsupported, use the translate command as a fallback.

### Style or tone not applied

**Cause:** The formality or style parameter may not be supported for the target language, or the text already matches the requested style.

**Solutions:**

1. Not all languages support formality settings. Check the DeepL API documentation for supported languages.

2. Verify you are using valid formality values:

   ```bash
   deepl write --help
   ```

3. Use `--verbose` to inspect the API response and confirm the style was applied.

### Empty or unchanged output

**Cause:** The input text may already match the requested style, or the Write API determined no changes were needed.

**Solutions:**

1. Try a different style or formality level to see if changes are applied.

2. Use `--check` mode to compare the original with the improved version:

   ```bash
   deepl write "Your text" --lang en-US --check
   ```

3. Check the verbose output for details:
   ```bash
   deepl write "Your text" --lang en-US --verbose
   ```

### Rate limiting on Write API

**Cause:** The Write API has its own rate limits, separate from the Translate API.

**Solutions:**

1. The CLI automatically retries rate-limited requests with exponential backoff.

2. If processing multiple texts, consider adding delays between requests.

3. Check your current API usage:
   ```bash
   deepl usage
   ```

---

## Configuration Errors (Exit Code 7)

### "Configuration error: invalid config file"

**Cause:** The config file is corrupted or has invalid JSON.

The config file location depends on your setup (see [Configuration Paths](../README.md#configuration-paths)):

- XDG default: `~/.config/deepl-cli/config.json`
- Legacy: `~/.deepl-cli/config.json`

**Solutions:**

1. View current config:

   ```bash
   deepl config list
   ```

2. Reset a specific setting:

   ```bash
   deepl config set <key> <value>
   ```

3. If the config file is corrupted, remove it and reconfigure:

   ```bash
   rm ~/.config/deepl-cli/config.json   # or ~/.deepl-cli/config.json
   deepl auth set-key YOUR_API_KEY
   ```

4. Use a custom config directory:
   ```bash
   export DEEPL_CONFIG_DIR=/path/to/config
   ```

---

## Input Validation Errors (Exit Code 6)

### "Missing required argument"

Common causes and fixes:

- **translate**: Requires text or file path and `--to` language:

  ```bash
  deepl translate "Hello" --to es
  ```

- **watch**: Requires a path and `--to`:

  ```bash
  deepl watch ./docs --to es,fr
  ```

- **completion**: Requires a shell name:
  ```bash
  deepl completion bash
  ```

### "Unsupported language"

Use `deepl languages` to see all supported languages:

```bash
deepl languages --source
deepl languages --target
```

---

## Cache Issues

### Stale translations

If you suspect cached translations are outdated:

```bash
# Clear the cache
deepl cache clear

# Check cache status
deepl cache stats
```

### Cache database errors

If the SQLite cache becomes corrupted:

```bash
# Disable cache temporarily
deepl cache disable

# Remove the cache file and re-enable
rm ~/.cache/deepl-cli/cache.db   # or ~/.deepl-cli/cache.db for legacy installations
deepl cache enable
```

### "Translation cache backend failed to load"

**Cause:** The cache uses Node's built-in `node:sqlite` module, which requires Node.js 24 or later (the CLI's minimum supported version). On an older runtime the module doesn't exist, so caching cannot start.

Translation and write commands keep working with caching disabled for the run; your cache database is not modified. `deepl cache` subcommands fail until the CLI runs on a supported Node.js version.

**Solution:** run the CLI with Node.js 24 or later — e.g. `nvm install 24 && nvm use 24`, or install Node 24 from [nodejs.org](https://nodejs.org/).

---

## Document Translation Issues

### "Output directory is required for batch translation"

When translating a directory, you must specify `--output`:

```bash
deepl translate ./docs --to es --output ./docs-es
```

### Unsupported document format

Supported document formats: PDF, DOCX, DOC, PPTX, XLSX, TXT, HTML, HTM, XLF, XLIFF, SRT, JPG, JPEG, PNG. See [docs/API.md](API.md) for the complete list of supported formats.

```bash
deepl translate document.docx --to fr --output translated.docx
```

---

## Glossary Issues

### "Glossary not found"

1. List available glossaries:

   ```bash
   deepl glossary list
   ```

2. Glossary names are case-sensitive. Use the exact name or ID.

3. Glossaries are tied to specific language pairs. Ensure your source/target language matches the glossary's language pair.

---

## Exit Codes Reference

| Code | Meaning                            | Retryable? |
| ---- | ---------------------------------- | ---------- |
| 0    | Success                            | N/A        |
| 1    | General error                      | No         |
| 2    | Authentication error               | No         |
| 3    | Rate limit exceeded                | Yes        |
| 4    | Quota exceeded                     | No         |
| 5    | Network error                      | Yes        |
| 6    | Invalid input                      | No         |
| 7    | Configuration error                | No         |
| 8    | Check found issues (write --check) | No         |
| 9    | Voice API error                    | No         |
| 10   | Sync drift detected (sync --frozen) | No        |
| 11   | Sync lockfile conflict             | No         |
| 12   | Partial sync failure (some locales failed) | Yes (retry failed locales) |

Use exit codes in scripts for retry logic:

```bash
deepl translate "Hello" --to es
case $? in
  0) echo "Success" ;;
  3|5) echo "Transient error, retrying..." ;;
  2) echo "Fix your API key" ;;
  4) echo "Quota exceeded, wait for reset" ;;
  *) echo "Error, check output" ;;
esac
```

---

## Environment Variables

| Variable           | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `DEEPL_API_KEY`    | API key (fallback when no stored config key)         |
| `DEEPL_CONFIG_DIR` | Override config and cache directory                  |
| `XDG_CONFIG_HOME`  | Override XDG config base (default: `~/.config`)      |
| `XDG_CACHE_HOME`   | Override XDG cache base (default: `~/.cache`)        |
| `HTTP_PROXY`       | HTTP proxy URL                                       |
| `HTTPS_PROXY`      | HTTPS proxy URL (takes precedence over `HTTP_PROXY`) |
| `TMS_API_KEY`      | API key for the configured TMS server (`sync push`/`pull`) |
| `TMS_TOKEN`        | Alternative auth token for the configured TMS server |
| `NO_COLOR`         | Disable colored output when set to any value         |
| `FORCE_COLOR`      | Force colored output (`NO_COLOR` wins if both are set) |
| `TERM`             | `TERM=dumb` disables colored output and progress spinners |

---

## Getting More Help

```bash
# General help
deepl --help

# Command-specific help
deepl translate --help
deepl voice --help
deepl glossary --help

# Check CLI version
deepl --version
```

If you encounter an issue not covered here, check the [DeepL API documentation](https://www.deepl.com/docs-api).

---

## Still Having Issues?

If your problem isn't listed above, [file a bug report](https://github.com/DeepL/deepl-cli/issues/new) with:

- The command you ran
- The full error output
- Your CLI version (`deepl --version`)
- Your OS and Node.js version

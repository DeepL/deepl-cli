# DeepL Sync -- Continuous Localization Engine

> Scan, translate, and sync i18n files from the command line.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Supported File Formats](#supported-file-formats)
- [Configuration](#configuration)
- [Commands](#commands)
- [Stability & deprecation](#stability--deprecation)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)
- [Exit Codes](#exit-codes)
- [Further Reading](#further-reading)

## Overview

`deepl sync` is a continuous localization engine that keeps your project's translation files in sync with your source strings. It scans your project for i18n resource files, detects new and changed strings using a lockfile, sends only the delta to the DeepL API, and writes back properly formatted target files -- preserving indentation, comments, and format-specific conventions. This replaces the manual export/translate/import cycle with a single command that fits into both local development and CI/CD pipelines.

## Quick Start

### Prerequisites

- DeepL API key (`deepl auth set-key YOUR_KEY` or `DEEPL_API_KEY` env var)
- Project with i18n resource files (JSON, YAML, TOML, PO, Android XML, iOS Strings, ARB, XLIFF, Java Properties, Xcode String Catalog, or Laravel PHP arrays)

### First Sync in 30 Seconds

```bash
# 1. Initialize (auto-detects your project's i18n framework)
deepl sync init --source-locale en --target-locales de,fr --file-format json --path "locales/en.json"

# 2. Preview what would be translated
deepl sync --dry-run

# 3. Translate
deepl sync
```

## How It Works

1. **Scan** -- finds i18n files matching bucket patterns in `.deepl-sync.yaml`
2. **Diff** -- compares source strings against `.deepl-sync.lock` to find new/changed/deleted keys
3. **Translate** -- sends only new and changed strings to the DeepL API
4. **Write** -- reconstructs target files preserving format, indentation, and comments
5. **Lock** -- updates `.deepl-sync.lock` with translation hashes for incremental sync

The lockfile tracks content hashes for every source string. On subsequent runs, only strings whose hash has changed (or that are newly added) are sent to DeepL. Deleted keys are removed from target files. This makes sync fast and cost-efficient -- you only pay for what actually changed.

All sync commands (`sync`, `sync push`, `sync pull`, `sync export`, `sync validate`) refuse to follow symbolic links when scanning `include` globs. A symlink matching a bucket pattern is silently skipped, preventing a hostile symlink (e.g., `locales/en.json` -> `/etc/passwd`) from exfiltrating files outside the project root to the TMS server or into an exported XLIFF.

### Concurrent sync

Only one `deepl sync` run is supported at a time per project directory. At startup, sync writes a `.deepl-sync.lock.pidfile` containing its PID; a second invocation that sees an existing pidfile whose PID is still alive exits with `ConfigError` (exit code 7). If the PID is dead (e.g., a previous run crashed), sync removes the stale pidfile with a warning and proceeds. The pidfile is deleted automatically on normal completion and on SIGINT/SIGTERM.

## Supported File Formats

| Format | Extensions | Used By |
|--------|-----------|---------|
| JSON (i18n) | `.json` | i18next, react-intl, vue-i18n, next-intl |
| YAML | `.yaml`, `.yml` | Rails, Hugo, Symfony |
| TOML | `.toml` | Go go-i18n |
| Gettext PO | `.po`, `.pot` | Django, WordPress, LinguiJS |
| Android XML | `.xml` | Android (`strings.xml`) |
| iOS Strings | `.strings` | iOS, macOS (`Localizable.strings`) |
| Xcode String Catalog | `.xcstrings` | iOS, macOS (`Localizable.xcstrings`) — multi-locale |
| ARB | `.arb` | Flutter, Dart |
| XLIFF | `.xlf`, `.xliff` | Angular, Xcode, enterprise CAT tools |
| Java Properties | `.properties` | Java, Spring (`ResourceBundle`) |
| Laravel PHP arrays | `.php` | Laravel (`lang/**/*.php`, `resources/lang/**/*.php`) |

All parsers preserve format-specific metadata:

- **JSON**: nested key structure, indentation style, trailing newlines
- **YAML**: comments, anchors, flow/block style
- **PO**: translator comments, flags, plural forms, msgctxt
- **Android XML**: `translatable="false"` attributes, comments, string-arrays, plurals
- **iOS Strings**: comments, ordering, escape sequences
- **Xcode String Catalog**: per-locale `stringUnit` state, comments, multi-locale structure
- **ARB**: `@key` metadata (description, placeholders, type)
- **XLIFF**: `<note>` elements, state attributes, translation units
- **TOML**: `#` comments, blank lines between sections, key order within a section, per-value quote style (double-quoted vs literal single-quoted), irregular whitespace around `=`, and every byte outside a replaced string literal round-trip verbatim via span-surgical reconstruct. Multi-line triple-quoted strings are passed through as-is (not translated).
- **Properties**: comments, Unicode escapes (`\uXXXX`), line continuations, separator style
- **Laravel PHP arrays**: PHPDoc/line/block comments, quote style (single vs double), trailing commas, irregular whitespace, and every byte outside a replaced string literal round-trip verbatim. Span-surgical reconstruct — the AST is used for string-literal offsets only, never reprinted. Allowlist rejects double-quoted interpolation (`"Hello $name"`), heredoc, nowdoc, and string concatenation; Laravel pipe-pluralization values (`|{n}` / `|[n,m]` / `|[n,*]`) are excluded from the translation batch and counted separately in `deepl sync status`.

The sync engine also supports **multi-locale formats** where all locales are stored in a single file (e.g., Apple `.xcstrings`). For these formats, the engine automatically serializes locale writes to prevent race conditions and passes the locale to the parser so it can scope extract/reconstruct operations to the correct locale section.

## Configuration

### `.deepl-sync.yaml`

This file defines what `deepl sync` translates. It lives in your project root and should be committed to version control.

```yaml
version: 1
source_locale: en
target_locales:
  - de
  - fr
  - es
  - ja

buckets:
  json:
    include:
      - "locales/en.json"
      - "locales/en/*.json"
    exclude:
      - "locales/en/generated.json"

translation:
  formality: default
  model_type: prefer_quality_optimized
  glossary: my-project-terms
  translation_memory: my-tm
  translation_memory_threshold: 80
  instruction_templates:
    button: "Keep translation concise, maximum 3 words."
    th: "Table column header. Maximum 2 words."

context:
  enabled: true
  scan_paths:
    - "src/**/*.{ts,tsx}"
  overrides:
    save: "Save button in document editor toolbar"
    close: "Close button in modal dialog"
```

### Schema Reference

**Validation.** Unknown fields are rejected at every nesting level (top-level, buckets, translation, context, validation, sync, tms, locale_overrides) with a `ConfigError` (exit 7). Typos produce a did-you-mean hint pointing at the closest known field — for example, `target_locale: en` (singular) reports `Unknown field "target_locale" in .deepl-sync.yaml top level` with the hint `Did you mean "target_locales"?`.

#### Top-level fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `version` | `number` | Yes | -- | Config schema version (currently `1`) |
| `source_locale` | `string` | Yes | -- | BCP-47 source language code (e.g., `en`, `de`, `ja`) |
| `target_locales` | `string[]` | Yes | -- | List of target language codes |

#### `buckets`

Each bucket maps a format name to a set of file patterns. The format name must be one of: `json`, `yaml`, `toml`, `po`, `android_xml`, `ios_strings`, `xcstrings`, `arb`, `xliff`, `properties`, `laravel_php`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `include` | `string[]` | Yes | Glob patterns for source files to include |
| `exclude` | `string[]` | No | Glob patterns for source files to exclude |
| `target_path_pattern` | `string` | No | Template for target file paths. Use `{locale}` for the target locale and `{basename}` for the source filename. Required for formats where the source locale is not in the source file path (e.g., Android XML, XLIFF). |
| `key_style` | `string` | No | Key format: `nested` (dot-separated keys become nested objects) or `flat` (keys preserved as-is). |

#### `translation`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `formality` | `string` | No | `default` | Formality level: `default`, `more`, `less`, `prefer_more`, `prefer_less`, `formal`, `informal` |
| `model_type` | `string` | No | `prefer_quality_optimized` | Model type: `quality_optimized`, `latency_optimized`, `prefer_quality_optimized` |
| `glossary` | `string` | No | -- | Glossary name or ID, or `auto` for automatic glossary management |
| `translation_memory` | `string` | No | -- | Translation memory name or UUID. Requires `model_type: quality_optimized`. Invalid pairing rejected at config load (ConfigError, exit 7). See [Translation memory](#translation-memory). |
| `translation_memory_threshold` | `number` | No | `75` | Minimum match score 0–100 (requires `translation_memory`). Non-integer or out-of-range values exit 7 (ConfigError). |
| `custom_instructions` | `string[]` | No | -- | Custom instructions passed to the DeepL API |
| `style_id` | `string` | No | -- | Style ID for consistent translation style |
| `locale_overrides` | `object` | No | -- | Per-locale overrides for `formality`, `glossary`, `translation_memory`, `translation_memory_threshold`, `custom_instructions`, `style_id` |
| `instruction_templates` | `object` | No | -- | Per-element-type instruction templates. Built-in defaults cover 16 element types: `button`, `a`, `h1`-`h6`, `th`, `label`, `option`, `input`, `title`, `summary`, `legend`, `caption`. User-provided templates override defaults. Only effective for locales supporting custom instructions: DE, EN, ES, FR, IT, JA, KO, ZH. See [Translation Strategies](#translation-strategies). |
| `length_limits.enabled` | `boolean` | No | `false` | Enable length-aware translation instructions. Adds "Keep under N characters" per key based on source text length and locale expansion factors. Only applies to length-constrained element types (button, th, label, option, input, title) for keys sent via per-key API calls. |
| `length_limits.expansion_factors` | `object` | No | built-in defaults | Per-locale expansion factors relative to English source. Built-in defaults: DE 1.3, FR 1.3, ES 1.25, JA 0.5, KO 0.7, ZH 0.5, etc. Based on industry-standard approximations (IBM, W3C). User-overridable. |

##### `glossary: auto`

Setting `translation.glossary: auto` enables automatic project glossaries. Each time `deepl sync` runs, the engine scans completed translations for source terms that appear in at least three distinct keys with a consistent translation across all of them, and creates (or updates) a DeepL glossary per target locale named `deepl-sync-{source}-{target}`. On the first run the glossary is created; on subsequent runs the existing glossary is found by name and its entries are replaced with the freshly computed set in a single `PATCH /v3/glossaries/{id}` call per locale — rather than one API call per added or removed term. The glossary list response is also cached for the duration of a sync run, so multi-locale projects issue one `GET /v3/glossaries` lookup total instead of one per locale. The resulting `glossary_id` is stored in the lockfile under `glossary_ids` (keyed by `{source}-{target}` pair) so you can see which glossary the engine is tracking. Only source terms of 50 characters or fewer are considered.

##### Translation memory

Set `translation.translation_memory` to a translation memory name or UUID to reuse approved translations across a sync run. Translation memories are authored and uploaded through the DeepL web UI; the CLI never creates or edits them. Names are resolved to UUIDs once via `GET /v3/translation_memories` and cached for the remainder of the invocation, so a multi-locale sync issues at most one list call per unique name. TM composes with glossary — both `glossary_id` and `translation_memory_id` are sent on the same translate call when both are configured.

Translation memories require `model_type: quality_optimized`. Set `model_type: quality_optimized` at the same scope as `translation_memory` (top-level `translation.model_type`, or the matching per-locale override). Other values are rejected at config load with `ConfigError` (exit 7), before any API call is made. Threshold propagates from YAML into each translate request (default 75, range 0–100); `translation_memory_threshold` without `translation_memory` is inert. Per-locale `locale_overrides.<locale>.translation_memory` takes precedence over the top-level `translation.translation_memory`; `locale_overrides.<locale>.translation_memory_threshold` falls back to the top-level threshold when unset. See [Is translation memory actually being applied?](#is-translation-memory-actually-being-applied) for verification steps.

#### `context`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | `boolean` | No | `false` | Enable auto-context extraction from source code |
| `scan_paths` | `string[]` | No | `['src/**/*.{ts,tsx,js,jsx}']` | Glob patterns for source files to scan for context |
| `function_names` | `string[]` | No | `['t', 'i18n.t', '$t', 'intl.formatMessage']` | Function names to search for key usage. Both string literal calls (`t('key')`) and template literal calls (`` t(`prefix.${var}`) ``) are matched. |
| `context_lines` | `number` | No | `3` | Number of surrounding code lines to include as context |
| `overrides` | `object` | No | -- | Manual context strings per key (e.g., `save: "Save button in toolbar"`). Overrides auto-extracted context. |

Template literal calls like `` t(`features.${key}.title`) `` are resolved against the known keys in your source locale files. The interpolation is treated as a wildcard, so the pattern `features.*.title` matches `features.incremental.title`, `features.multiformat.title`, etc. Each matched key inherits the surrounding source code as context. This is useful for idiomatic React/Vue i18n patterns that iterate over keys dynamically.

When context scanning is enabled, two additional signals are automatically extracted:

- **Key path context**: The i18n key hierarchy (e.g., `pricing.free.cta`) is parsed into a natural-language description (`"Call-to-action in the pricing > free section."`) and prepended to the context string sent to the API. This helps the API disambiguate short strings like "Save" (verb vs noun).

- **Element type detection**: The HTML/JSX element type surrounding each `t()` call (e.g., `<button>`, `<h2>`, `<th>`, `<summary>`, `<legend>`, `<caption>`) is extracted and stored. This feeds into instruction templates (see `translation.instruction_templates`) to auto-generate element-aware `custom_instructions`. Built-in templates cover 16 element types; user-provided templates override defaults.

#### Translation Strategies

When context extraction is enabled, keys are translated using one of four strategies:

| Strategy | When used | API calls | Quality | Speed |
|----------|-----------|-----------|---------|-------|
| **Section context** (default) | Keys with auto-extracted context, grouped by i18n section | One batch per section (e.g., all `nav.*` keys together) | Good | Fast |
| **Per-key context** (`--no-batch`) | All keys with context, sent individually | One API call per key | Best | Slow |
| **Element instructions** | Keys with detected element type + matching template, no context | One batch per element type | Good | Fast |
| **Plain batch** (`--batch`) | All keys, or keys with no context/instructions | One batch per 50 keys | Baseline | Fastest |

**Default behavior:** Keys with auto-extracted context are **grouped by their parent i18n section** (e.g., all keys under `nav.*` share the context `"Used in the nav section."`) and sent as a single batch per section. This is ~3.4x faster than per-key while still providing context for disambiguation.

**Batching mode comparison (benchmark results, 3 target locales):**

| Mode | 1K keys | 5K keys | 10K keys |
|------|---------|---------|----------|
| `--batch` (no context) | ~2s | ~2s | ~2.5s |
| Default (section-batched) | ~30s | ~2.5 min | ~5 min |
| `--no-batch` (per-key) | ~105s | ~9 min | ~17 min |

**Guidelines:**
- For **incremental syncs** (1-50 changed keys): default mode is fast regardless of project size (<1s)
- For **first sync** of large projects (5K+ keys): default mode completes in minutes, which is reasonable for a one-time operation
- Use `--batch` when speed matters more than context quality (CI pipelines, rapid iteration)
- Use `--no-batch` when you need maximum context precision for every key (critical UI copy, small projects)

**Strategy output:** The sync summary shows how many keys used each strategy:

```
Sync complete: 42 new, 3 updated across 5 languages (12,450 chars, ~$0.31)
  context: 18 keys, instructions: 12 keys (button: 8, label: 4)
```

In JSON output (`--format json`), the `strategy` field provides the breakdown:

```json
{
  "strategy": {
    "context": 18,
    "instruction": { "button": 8, "label": 4 },
    "batch": 22
  }
}
```

**Notes:**
- Custom instructions are only supported by the DeepL API for 8 locales: DE, EN, ES, FR, IT, JA, KO, ZH. For other target locales, keys that would use element instructions fall back to plain batch. A warning is shown if `instruction_templates` is configured but context scanning is disabled or no element types are detected.
- Keys with manual `context.overrides` always use per-key translation regardless of batching mode.
- No-op syncs (nothing changed) complete in <200ms on typical projects.

**Rollback:** If auto-generated instructions or section context produce an undesirable translation for a specific key, edit the target file manually. The lock file preserves translations by source hash — manual edits persist across syncs as long as the source text is unchanged. Use `--force` to re-translate all keys (this overwrites manual edits).

#### `validation`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `check_placeholders` | `boolean` | No | `true` | Validate placeholder preservation in translations |
| `fail_on_error` | `boolean` | No | `false` | Fail sync when validation errors are detected |
| `validate_after_sync` | `boolean` | No | `true` | Run validation after each sync |
| `fail_on_missing` | `boolean` | No | `true` | With `--frozen`, fail on new/missing translations |
| `fail_on_stale` | `boolean` | No | `true` | With `--frozen`, fail on stale (source-changed) translations |

#### `sync`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `concurrency` | `number` | No | `5` | Maximum number of parallel locale translations |
| `batch_size` | `number` | No | `50` | Maximum number of strings per translation API call |
| `batch` | `boolean` | No | -- | When `true`, force all keys into plain batch (fastest, no context). When `false`, force per-key context (slowest, max quality). When unset, use section-batched context (default, good balance). |
| `max_characters` | `number` | No | -- | Cost cap: abort sync if estimated characters exceed this limit (override with `--force`) |
| `backup` | `boolean` | No | `true` | Create `.deepl.bak` copies of target files before overwriting; cleaned up after successful sync |
| `max_scan_files` | `number` | No | `50000` | Hard ceiling on the number of files matched by `context.scan_paths`. Prevents a misconfigured pattern from wedging the CLI on shared CI with huge source trees and slow disks. Exceeding the cap throws `ValidationError` with a suggestion to narrow the pattern. Positive integer. |
| `limits.max_entries_per_file` | `number` | No | `25000` | Per-file parser cap on extracted entry count. Files exceeding this are skipped with a warning. Hard ceiling: `100000`. Values above the ceiling fail at config load with `ConfigError` (exit 7). |
| `limits.max_file_bytes` | `number` | No | `4194304` (4 MiB) | Per-file parser cap on on-disk size, checked via `fs.stat` before read. Files exceeding this are skipped with a warning. Hard ceiling: `10485760` (10 MiB). Values above the ceiling fail at config load with `ConfigError` (exit 7). |
| `limits.max_depth` | `number` | No | `32` | Per-file parser cap on associative-array nesting depth. Protects against stack-overflow on adversarial input. Currently consumed by the Laravel PHP parser. Files exceeding this are skipped with a warning. Hard ceiling: `64`. Values above the ceiling fail at config load with `ConfigError` (exit 7). |
| `limits.max_source_files` | `number` | No | `10000` | Per-bucket cap on how many source files a single `include` glob may match. Buckets exceeding this are **skipped entirely with a warning** — the assumption is that a glob which returned 10k+ files is picking up an unintended vendored tree. Narrow the `include` pattern or raise the cap. Hard ceiling: `1000000`. Values above the ceiling fail at config load with `ConfigError` (exit 7). |

#### `tms`

Optional integration with a translation management system (TMS) for collaborative editing and human review workflows. Any TMS that implements the REST contract below can be wired up; `deepl sync push` sends translations to the TMS for human review, and `deepl sync pull` retrieves approved translations back into local files.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | `boolean` | Yes | -- | Enable TMS integration |
| `server` | `string` | Yes | -- | TMS server URL (HTTPS required except for `localhost`/`127.0.0.1`) |
| `project_id` | `string` | Yes | -- | TMS project identifier |
| `api_key` | `string` | No | -- | API key for TMS authentication (prefer `TMS_API_KEY` env var) |
| `token` | `string` | No | -- | Bearer token for TMS authentication (prefer `TMS_TOKEN` env var) |
| `auto_push` | `boolean` | No | `false` | Automatically push after sync |
| `auto_pull` | `boolean` | No | `false` | Automatically pull before sync |
| `require_review` | `string[]` | No | -- | Locales that require human review before pull |
| `timeout_ms` | `number` | No | `30000` | Per-request timeout in milliseconds for TMS HTTP calls (positive integer). Aborts the request via `AbortController` when exceeded. |
| `push_concurrency` | `number` | No | `10` | Maximum number of in-flight `PUT /keys/{keyPath}` requests during `deepl sync push`. Positive integer. Applied per (file, locale) batch of entries; aborts remaining pushes on first failure. |

##### TMS reliability: timeouts and retries

Each TMS HTTP request is bounded by `tms.timeout_ms` (default 30000 ms) using an `AbortController`. If the configured timeout elapses before the server responds, the client raises a `TmsTimeoutError` rather than hanging indefinitely.

`429 Too Many Requests` and `503 Service Unavailable` responses, along with transient network errors (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EAI_AGAIN`) and timeouts, are retried up to 3 attempts total with jittered exponential backoff starting at ~500 ms, doubling each attempt, and capped at ~10 s (±25% jitter). All other `4xx` responses (including `401`/`403` auth failures) are not retried. When a non-2xx response is finally surfaced to the caller, up to 1 KB of the response body is appended to the error message so operators can diagnose the failure without reproducing it under `curl`.

`deepl sync push` issues per-key `PUT` requests concurrently, bounded by `tms.push_concurrency` (default 10). A 5000-key × 10-locale project at ~100 ms round-trip completes in minutes instead of hours. Pushes abort on first failure — a partial push is confusing and operators re-run after fixing the underlying cause — so the overall semantic (fail-fast, caller retries) is unchanged from the previous serial behavior.

##### TMS REST contract

The built-in `push`/`pull` client expects the TMS server to implement these endpoints (`{server}` and `{projectId}` come from the `tms:` config block):

| Method | Path | Purpose |
|--------|------|---------|
| `PUT` | `{server}/api/projects/{projectId}/keys/{keyPath}` | Push a single translation. Request body: `{"locale":"de","value":"Hallo"}` |
| `GET` | `{server}/api/projects/{projectId}/keys/export?format=json&locale={locale}` | Pull approved translations. Response: `{ "key": "translated value", ... }` |
| `GET` | `{server}/api/projects/{projectId}` | Project status (reserved; not currently consumed by the CLI) |

Authentication is sent as an `Authorization` header. When `api_key` is configured the header is `ApiKey {api_key}`; when `token` is configured it is `Bearer {token}`. Any TMS implementing this contract — DeepL's own, or a self-hosted bridge in front of Crowdin/Lokalise/Phrase/etc. — can be used.

#### `ignore`

An array of glob patterns for files to exclude from sync across all buckets.

```yaml
ignore:
  - "*.test.json"
  - "**/fixtures/**"
```

### `.deepl-sync.lock`

The lockfile is auto-generated and should be committed to version control. It stores content hashes for each source string so that subsequent syncs only translate what changed. Never edit this file manually.

**Recovery.** If sync encounters a lockfile with an unsupported `version` or invalid JSON, it copies the existing file to `.deepl-sync.lock.bak-<tag>-<timestamp>` (tag is `corrupt`, `v-unknown`, or `v<N>`) before resetting in-memory state and continuing with a full re-sync. The backup path is logged at WARN level so you can restore it from the working tree if needed.

Each translation entry in the lockfile records:

| Field | Description |
|-------|-------------|
| `hash` | Content hash of the source string at time of translation |
| `translated_at` | ISO 8601 timestamp |
| `status` | `translated`, `failed`, or `pending` |
| `character_count` | Characters billed by the DeepL API for this translation |
| `context_sent` | `true` when source code context was included in the API request |
| `review_status` | `machine_translated` or `human_reviewed` (set by `--flag-for-review`) |

### Multiple Buckets

You can define multiple buckets to handle different file formats in the same project:

```yaml
version: 1
source_locale: en
target_locales: [de, fr, ja]

buckets:
  json:
    include:
      - "web/locales/en/**/*.json"
  android_xml:
    include:
      - "android/app/src/main/res/values/strings.xml"
    target_path_pattern: "android/app/src/main/res/values-{locale}/strings.xml"
  ios_strings:
    include:
      - "ios/en.lproj/Localizable.strings"
  xliff:
    include:
      - "src/locale/messages.xlf"
    target_path_pattern: "src/locale/messages.{locale}.xlf"
```

## Commands

### `deepl sync` (default -- translate)

Run the sync engine: scan, diff, translate, and write target files.

```bash
deepl sync [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview changes without translating |
| `--frozen` | Fail (exit 10) if any translations are missing or outdated; for CI/CD |
| `--ci` | Alias for `--frozen` |
| `--force` | Re-translate all strings, ignoring the lockfile. **Also bypasses the `sync.max_characters` cost cap** — a forced run can re-bill every key. Preview cost with `--dry-run` first. Billing safety guards: `--watch --force` is rejected at startup with `ValidationError` (exit 6); interactive mode prompts for confirmation (add `--yes`/`-y` to skip in scripts); in CI (`CI=true`), `--force` requires explicit `--yes` or exits 6. |
| `--locale <langs>` | Sync only specific target locales (comma-separated) |
| `--concurrency <n>` | Max parallel locale translations (default: 5) |
| `--batch` | Force plain batch mode (fastest, no context or instructions). |
| `--no-batch` | Force per-key mode (slowest, individual context per key). Default: section-batched context. |
| `--format <fmt>` | Output format: `text` (default), `json` |
| `--formality <level>` | Override formality: `default`, `more`, `less`, `prefer_more`, `prefer_less`, `formal`, `informal` |
| `--model-type <type>` | Override model type: `quality_optimized`, `prefer_quality_optimized`, `latency_optimized` |
| `--glossary <id>` | Override glossary name or ID |
| `--scan-context` / `--no-scan-context` | Enable or disable source-code context scanning (key paths, HTML element types). Overrides `context.enabled` only; other `context.*` settings in `.deepl-sync.yaml` (patterns, excludes, etc.) are preserved. Bare `--context` on `sync` is rejected — use `--scan-context` instead. |
| `--auto-commit` | Auto-commit translated files after sync (requires git) |
| `--flag-for-review` | Mark translations as `machine_translated` in lock file for human review |
| `--watch` | Watch source files and auto-sync on changes |
| `--debounce <ms>` | Debounce delay for watch mode (default: 500ms) |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

**Examples:**

```bash
# Sync all locales
deepl sync

# Preview what would be translated
deepl sync --dry-run

# CI/CD: fail if translations are out of date
deepl sync --frozen

# Re-translate everything from scratch
deepl sync --force

# Sync only German and French
deepl sync --locale de,fr

# Watch mode: auto-sync on source file changes
deepl sync --watch

# Force batch mode (fastest, no context)
deepl sync --batch

# Force per-key context (slowest, maximum quality)
deepl sync --no-batch

# JSON output for scripting
deepl sync --format json
```

> **Context, instructions, and batching:** By default, keys with context are grouped by i18n section (e.g., all `nav.*` keys share context) and translated in section batches — ~3.4x faster than per-key while still providing disambiguation context. Keys with element-type instructions are batched by element type. Remaining keys are plain-batched. Use `--batch` to force all keys into plain batch (fastest, no context). Use `--no-batch` to force true per-key context (slowest, maximum quality). Use `--no-scan-context` to disable source-code context scanning for the current run (overrides `context.enabled` only — other `context.*` settings are preserved). Bare `--context` / `--no-context` on `deepl sync` is rejected (it collides with `deepl translate --context "<text>"`); use `--scan-context` / `--no-scan-context` instead.

**Output:**

During a sync, per-locale progress is printed as each translation completes:

```
  ✓ de: 10/10 keys (locales/en.json)
  ✓ fr: 10/10 keys (locales/en.json)
Sync complete: 2 new, 1 updated, 7 current (100 chars, ~$0.00) (Pro tier estimate)
✓ de: 10/10  ✓ fr: 10/10
```

Each locale shows `✓` when all translations succeeded, or `✗` when some failed. The format is `locale: translated/attempted`.

In `--dry-run` mode, the output includes estimated characters and cost (computed from source string lengths × target locales, no API calls):

```
[dry-run] No translations performed.
Sync complete: 12 new, 3 updated across 5 languages
This sync: ~4,500 chars, ~$0.11 (Pro tier estimate)
```

Cost estimates use the DeepL Pro rate ($25 per 1 million characters). If you are on the Free tier or a different plan, your actual cost will differ. Check your account tier at [deepl.com](https://deepl.com) to determine the applicable rate.

With `--format json`, the result includes `estimatedCharacters`, `targetLocaleCount`, `estimatedCost`, and `rateAssumption: "pro"` (indicating the estimate is based on Pro-tier pricing). A `perLocale` array provides per-file per-locale breakdowns.

**stdout/stderr split (stable contract).** The final success JSON payload is written to **stdout**, so `deepl sync --format json > out.json` captures the result in a parseable file. Progress events (both `key-translated` and `locale-complete`) are streamed to **stderr** as JSON lines during the sync, enabling programmatic progress monitoring without polluting the consumer contract on stdout. On failure, `--format json` emits the nested error envelope `{"ok":false,"error":{"code":"...","message":"...","suggestion":"..."},"exitCode":N}` to **stderr** and exits non-zero; the `error.code` field matches the error class name (e.g. `ConfigError`).

### `deepl sync init`

Interactive setup wizard that creates `.deepl-sync.yaml` by scanning your project.

```bash
deepl sync init [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--source-locale <code>` | Source locale code |
| `--target-locales <codes>` | Target locales (comma-separated) |
| `--file-format <type>` | File format (choices: `json`, `yaml`, `toml`, `po`, `android_xml`, `ios_strings`, `xcstrings`, `arb`, `xliff`, `properties`, `laravel_php`) |
| `--path <glob>` | Source file path or glob pattern |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

`--source-lang` and `--target-langs` were accepted as deprecated aliases during `1.x` and were removed in `2.0.0`; use `--source-locale` and `--target-locales`. The `--locale` filter on `sync push` / `pull` / `status` / `export` is unchanged. `deepl translate --target-lang` is unchanged — it operates on strings and stays aligned with the DeepL API's wire name.

**Examples:**

```bash
# Interactive mode (auto-detects framework)
deepl sync init

# Non-interactive with explicit options
deepl sync init --source-locale en --target-locales de,fr,es --file-format json --path "locales/en.json"
```

**Interactive target-locale picker.** The wizard's `Target locales:` checkbox offers the full DeepL target-locale set (core, regional variants like `pt-br` / `zh-hans`, and the extended tier). Eight common locales — `de`, `es`, `fr`, `it`, `ja`, `ko`, `pt-br`, `zh` — are pre-checked; everything else is available but unchecked to avoid silently billing for dozens of locales on a bare [Enter].

**Non-interactive validation.** When all four flags (`--source-locale`, `--target-locales`, `--file-format`, `--path`) are supplied, `deepl sync init` validates them before writing `.deepl-sync.yaml` and exits 6 (`ValidationError`) on any of:

- `--source-locale` appears in `--target-locales` (case-insensitive).
- `--target-locales` contains a duplicate entry (case-insensitive).
- `--target-locales` is empty after splitting on commas.
- Any `--target-locales` entry is not a loose BCP-47 code (`^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*$`). Script and region subtags such as `zh-Hans`, `pt-BR`, and `en-US-POSIX` are accepted.
- `--path` contains a `..` segment (path traversal).

If `--path` points to a file that does not yet exist (and contains no glob metacharacters), the wizard writes the config but prints a warning — the source file is expected to be present by the time `deepl sync` runs.

In non-TTY environments (CI, piped shells), all four flags are required; partial-flag fallback to interactive prompts is disabled to avoid hangs. Missing flags under a non-TTY stdin cause `deepl sync init` to exit with code 6 (`ValidationError`).

**Auto-detection:**

The init wizard scans your project for known i18n patterns. Detection is filesystem-only — no package manifests are parsed. Patterns listed with a **marker** require that file to exist at the repo root; the marker is a plain existence check that disambiguates ecosystems whose file layout alone is not unique (e.g., `.arb` is Flutter-specific but the detector adds `pubspec.yaml` as a safety net; `.php` in a `lang/` directory is unambiguous only when paired with `composer.json`).

| Framework | Detection signal | Marker | Suggested config |
|-----------|-----------------|--------|-----------------|
| i18next / react-intl / vue-i18n / next-intl | `locales/en.json`, `locales/en/*.json`, or `i18n/en.json` | — | JSON bucket (flat vs dir-per-locale emit distinct bucket patterns; when both layouts coexist the dir-per-locale form is preferred) |
| Rails canonical | `config/locales/en.yml` (or `.yaml`) | — | YAML bucket |
| Rails namespaced | `config/locales/**/en.yml` (or `.yaml`) — engines, concerns, per-namespace splits | — | YAML bucket (preserves namespace dir in `include:`) |
| Generic YAML (Hugo, Symfony, etc.) | `locales/en.yaml`, `locales/en.yml`, `i18n/en.yaml`, or `i18n/en.yml` | — | YAML bucket |
| Django / generic gettext | `locale/en/LC_MESSAGES/*.po` or a root-level `*.po` | — | PO bucket |
| Android | `res/values/strings.xml` | — | Android XML bucket + `target_path_pattern: "res/values-{locale}/strings.xml"` |
| iOS/macOS | `*.lproj/Localizable.strings` | — | iOS Strings bucket |
| Xcode String Catalog | `Localizable.xcstrings` at root, `Resources/Localizable.xcstrings`, or any `*.xcstrings` | — | xcstrings bucket (multi-locale — same file holds every locale) |
| Flutter | `l10n/app_en.arb` or any `*_en.arb` | `pubspec.yaml` | ARB bucket |
| Angular | `src/locale/messages.xlf`, `src/locale/*.xlf`, or `src/locale/*.xliff` | — | XLIFF bucket + `target_path_pattern: "src/locale/messages.{locale}.xlf"` |
| Symfony | `translations/messages.en.xlf` | — | XLIFF bucket + `target_path_pattern: "translations/messages.{locale}.xlf"` |
| go-i18n (directory) | `locales/en.toml` or `i18n/en.toml` | — | TOML bucket |
| go-i18n (root-level) | `active.en.toml` | — | TOML bucket + `active.{locale}.toml` filename template |
| Java / Spring | `src/main/resources/messages_en.properties` | — | Properties bucket |
| Laravel (9+, ≤8, Lumen) | `lang/en/*.php` or `resources/lang/en/*.php` | `composer.json` | `laravel_php` bucket |

Projects whose layout matches more than one row emit multiple candidate suggestions; the init wizard lets you pick one. Bare-root `*.strings`, `*.xlf`, and `*.xliff` are intentionally excluded — Apple's bundle model mandates `.lproj`, and root-level XLIFF is CAT-tool dump territory (Trados/memoQ/Xcode `.xcloc` extracts). Layouts outside these conventions need the four-flag non-interactive path — `--source-locale`, `--target-locales`, `--file-format`, and `--path`.

If no recognized i18n files are detected, `deepl sync init` exits 7 (`ConfigError`) and prints a remediation hint. Use all four flags explicitly to bypass detection: `deepl sync init --source-locale <locale> --target-locales <list> --file-format <format> --path <glob>`.

### `deepl sync status`

Show translation coverage for all target locales.

```bash
deepl sync status [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--locale <langs>` | Show status for specific locales only |
| `--format <fmt>` | Output format: `text` (default), `json` |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

**Example output:**

```
Source: en (142 keys)

  de  [###################.]  98%  (2 missing, 0 outdated)
  fr  [####################]  100%  (0 missing, 0 outdated)
  es  [###################.]  97%  (4 missing, 0 outdated)
  ja  [##################..]  91%  (12 missing, 0 outdated)
```

Each row shows: locale code, a 20-character ASCII progress bar (`#` = translated, `.` = missing/outdated), integer coverage percentage, and a parenthetical with missing and outdated key counts.

**JSON output:**

```bash
deepl sync status --format json
```

```json
{
  "sourceLocale": "en",
  "totalKeys": 142,
  "skippedKeys": 1,
  "locales": [
    { "locale": "de", "complete": 140, "missing": 2, "outdated": 0, "coverage": 98 },
    { "locale": "fr", "complete": 142, "missing": 0, "outdated": 0, "coverage": 100 },
    { "locale": "es", "complete": 138, "missing": 4, "outdated": 0, "coverage": 97 },
    { "locale": "ja", "complete": 130, "missing": 12, "outdated": 0, "coverage": 91 }
  ]
}
```

**Per-locale fields:** `complete` — keys with a current translation; `missing` — keys with no translation entry; `outdated` — keys whose source content has changed since the last sync (translation exists but is stale); `coverage` — integer 0–100 computed as `complete / (complete + missing + outdated) * 100`.

**`skippedKeys`** counts entries the parser tagged as untranslatable and excluded from the translation batch — currently only Laravel pipe-pluralization values (`|{n}`, `|[n,m]`, `|[n,*]`). Included in `totalKeys`; round-trip byte-verbatim via reconstruct.

**JSON output contract.** The field set above is stable within a major version. `coverage` is an integer 0-100. The success payload is written to **stdout** so `deepl sync status --format json > status.json` captures it in a parseable file; diagnostic logs remain on stderr. On failure, `--format json` emits the nested error envelope `{"ok":false,"error":{"code":"...","message":"...","suggestion":"..."},"exitCode":N}` to **stderr** and exits non-zero; `error.code` matches the error class name (e.g. `ConfigError`). The same stdout/stderr split applies to `deepl sync validate --format json` and `deepl sync audit --format json`.

**Casing.** CLI JSON output uses `camelCase`. The on-disk lockfile and config use `snake_case`. This split is deliberate — JSON is a consumer contract, files are authored configuration.

### `deepl sync validate`

Check translations for placeholder integrity, format string consistency, and common errors.

```bash
deepl sync validate [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--locale <langs>` | Validate specific locales only |
| `--format <fmt>` | Output format: `text` (default), `json` |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

**Example output:**

```
Validation Results:

  de:
    ✓ 138/140 strings valid
    ✗ 2 issues found:
      - messages.welcome: placeholder {name} missing in translation
      - errors.count: format specifier %d replaced with %s

  fr:
    ✓ 142/142 strings valid

  2 issues found across 1 locale.
```

**Checks performed:**

- Named placeholders present in translation (e.g., `{name}`, `{{count}}`, `%{user}`)
- Format specifiers match source (e.g., `%d`, `%s`, `%@`)
- HTML/XML tags balanced and matching
- ICU message syntax valid (plurals, selects)
- No untranslated strings copied verbatim from source
- Length ratio warnings (translation >150% of source length)
- Key count matches between source and target files

### `deepl sync export`

Export source strings to XLIFF 1.2 for handoff to CAT tools or human translators.

```bash
deepl sync export [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--locale <langs>` | Export for specific locales only |
| `--output <path>` | Write to file instead of stdout |
| `--overwrite` | Overwrite `--output` if it already exists (default: refuse to clobber) |
| `--format <fmt>` | Output format: `text` (default), `json`. Success output is always XLIFF 1.2; `json` affects the **error** envelope on stderr so script consumers can parse failure shape uniformly with other sync subcommands |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

Without `--overwrite`, `deepl sync export --output` refuses to write over an existing file and exits 6 (ValidationError). Pass `--overwrite` to re-export:

```bash
deepl sync export --output strings.xlf --overwrite
```

### `deepl sync resolve`

Auto-resolve git merge conflicts in `.deepl-sync.lock`. For each conflict region, the resolver parses both sides as JSON and merges at the per-key level: when both sides have valid JSON and define a translation entry for the same key, it takes the newer translation by `translated_at` timestamp. Keys present on only one side are carried through as-is.

```bash
deepl sync resolve [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--format <fmt>` | Output format: `text` (default), `json` |
| `--dry-run` | Print the per-entry decision report without writing the lockfile |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

**Output.** The resolver now emits a per-entry report: one line per decision, plus a summary. Each line names the file, key, chosen side (`kept ours` / `kept theirs`), and the reason (typically the winning `translated_at` timestamp). Example:

```
Resolved locales/de/app.json:button.save (kept theirs: newer translated_at 2026-04-20T08:12:03Z)
Resolved locales/de/app.json:button.cancel (kept ours: newer translated_at 2026-04-20T09:33:15Z)
WARN  locales/de/app.json:<conflict-region> — parse-error fallback used, JSON.parse failed on "{\"t...": Unexpected token }
Resolved 3 conflicts (1 theirs, 1 ours, 1 length-heuristic). Run "deepl sync" to fill any gaps.
```

**Fallback behavior.** When `JSON.parse` fails on a conflict fragment (e.g., conflict markers landed mid-entry and split the JSON), the resolver falls back to a length-heuristic: the longer side wins. This is now **loud** — it logs a `WARN` line naming the file + conflict region with the truncated parse error, and the decision is tagged `length-heuristic` in the report. Earlier releases ran this heuristic silently, making auto-resolve a data-loss risk the user could not audit without a diff against git history. Inspect any `length-heuristic` entries and consider resolving them by hand.

**Dry-run.** `--dry-run` runs the full decision pipeline and prints the per-entry report without touching the lockfile. Use it to preview what `sync resolve` would do, especially when the report includes `length-heuristic` fallback warnings.

After resolving, run `deepl sync` to fill any translation gaps.

### Watch Mode (`deepl sync --watch`)

Keeps `deepl sync` running and re-syncs whenever a tracked source file changes. Useful during active translation authoring to shorten the feedback loop between edit and translated-output.

```bash
# Default debounce is 500ms: successive writes within this window coalesce into one sync.
deepl sync --watch

# Tighten to 100ms for very snappy feedback, or loosen when editors write in multiple bursts.
deepl sync --watch --debounce 1000

# Preview-only: watch for changes but don't touch the API or target files.
deepl sync --watch --dry-run
```

**Lifecycle.** The command runs until it receives `SIGINT` (Ctrl+C) or `SIGTERM`. On either signal the in-flight sync terminates gracefully after its current locale iteration completes, any `.deepl.bak` files created by that cycle are cleaned up, the file watcher is closed, and the process exits with code 0. Ctrl+C never leaves `.deepl.bak` siblings orphaned in the workspace.

**Event coalescing.** Only one sync runs at a time. If more file-change events arrive while a sync is in flight, they are coalesced into a **single** follow-up run that starts after the current sync completes — no matter how many bursts of edits fired in between. Earlier releases silently dropped these in-flight events, which could leave the final edit of a burst unsynced until the user triggered another change manually.

**Stale `.deepl.bak` sweep.** On startup, the watcher sweeps for `.deepl.bak` siblings older than 5 minutes (files with any other suffix, including plain `.bak`, are never touched). A stale backup whose target file exists but is empty is auto-restored from the backup before the backup is removed; in every other case — including a missing target, which is never recreated — the stale backup is removed outright. This recovers cleanly from a previous watcher that was killed mid-translation without leaving residue for the user to manually clean up.

**Scope.** Watched paths are the `buckets.*.include` globs from `.deepl-sync.yaml`, plus `.deepl-sync.yaml` itself. When `.deepl-sync.yaml` changes, the config is reloaded from disk before the next sync cycle runs — YAML values like bucket definitions, `formality`, `glossary`, and `model_type` are picked up without restarting the watcher. Sending `SIGHUP` (`kill -HUP <pid>`) also force-reloads the config immediately, without waiting for a file-change event. Watch mode does not cross-talk with the separate `deepl watch` command (which is for translating individual plain-text files).

**Flag interactions.** `--watch` does not combine with `--frozen`/`--ci` (frozen mode is for one-shot CI drift detection; it would be meaningless in a long-running loop). This is now enforced at CLI parsing: `deepl sync --frozen --watch` exits immediately with a `ValidationError` (code 6). Use one or the other. CLI flags such as `--locale`, `--dry-run`, `--formality`, and `--glossary` are baked into the session at invocation and do **not** change between sync cycles — to use different flag values you must restart the watcher. Only the YAML config values reload on a config-file change.

### `deepl sync audit`

Analyze the lock file for terminology inconsistencies -- cases where the same source text has been translated differently. "Audit" here is translation-consistency (term divergence across locales), not security audit in the `npm audit` sense.

```bash
deepl sync audit [OPTIONS]
```

> Prior to the 1.1.0 release this subcommand was prototyped as `glossary-report`; it never shipped in a tagged release under that name. The old name now errors out with a pointer at `audit`; no alias is kept.

**Options:**

| Flag | Description |
|------|-------------|
| `--format <fmt>` | Output format: `text` (default), `json` |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

**Sample JSON output:**

```json
{
  "totalTerms": 1,
  "inconsistencies": [
    {
      "sourceText": "Dashboard",
      "locale": "de",
      "translations": ["Armaturenbrett", "Dashboard"],
      "files": ["locales/en/common.json", "locales/en/admin.json"]
    }
  ]
}
```

`translations` contains the real translated text read from target files. If a target file is missing, the content hash falls back in its place so the divergence is still visible.

### `deepl sync push`

Push local translations to a TMS for collaborative editing and human review.

```bash
deepl sync push [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--locale <langs>` | Push specific locales only |
| `--format <fmt>` | Output format: `text` (default), `json` |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

### `deepl sync pull`

Pull approved translations from a TMS back into local files.

```bash
deepl sync pull [OPTIONS]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--locale <langs>` | Pull specific locales only |
| `--format <fmt>` | Output format: `text` (default), `json` |
| `--sync-config <path>` | Path to `.deepl-sync.yaml` (default: auto-detect) |

Each target locale's approved dictionary is fetched exactly once per `sync pull` run (one GET per locale from the TMS export endpoint), then applied to every matching source file locally. Projects with many source files per bucket do not multiply wire bytes by the source-file count.

**Key-count limit:** The pull response is capped at **50,000 keys** (`MAX_PULL_KEY_COUNT`). Responses exceeding this limit are rejected with a `ValidationError` before any data is written. If your TMS project exceeds this threshold, partition the export by locale or paginate the pull on the TMS side before invoking `deepl sync pull`.

**Note:** `push` and `pull` require a TMS that implements the REST contract documented above. They are optional -- `deepl sync` works entirely locally with just the DeepL Translation API.

## Stability & deprecation

`deepl sync` has a stable public surface as of 2.0.0. This section records the commitment that governs how public subcommand and flag renames are delivered, so downstream users can rely on a predictable upgrade cadence.

- **Public renames ship with a deprecated alias.** Any rename of a documented subcommand or flag keeps the predecessor as a working alias for one minor release, and the alias emits a stderr deprecation warning naming the replacement.
- **Aliases are removed at the next major.** A deprecated alias introduced in `1.x` is removed at the `2.0` cut; it is never silently slipped into a later `1.x`.
- **Internal tooling is exempt.** Hidden commands and operator-only helpers (e.g., the hidden `_describe --format json` command for QA harness drift detection) are not part of the public surface. Renaming or removing them requires no alias, no deprecation warning, no CHANGELOG entry, and no API.md update.
- **Every rename pins a commander-tree snapshot.** Renames are guarded by the snapshot test at `tests/unit/cli/register-sync.commander-snapshot.test.ts`, which fails loudly if a subcommand or flag changes shape without the rename being intentional.
- **CHANGELOG discipline.** Renames record the alias under `Deprecated` when introduced and under `Removed` when the alias is dropped at the major cut.

### Worked example

`deepl sync init` accepted `--source-lang` and `--target-langs` as deprecated aliases for `--source-locale` and `--target-locales` throughout `1.x`; both emitted a stderr deprecation warning pointing at the replacement flag. Per the policy above, the aliases were removed at the `2.0` cut — since `2.0.0` they fail as unknown options. See the [`deepl sync init`](#deepl-sync-init) section for the current accepted synopsis.

## CI/CD Integration

### GitHub Actions

```yaml
name: i18n Sync Check
on: [pull_request]

jobs:
  check-translations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install -g @deepl/cli
      - name: Check translations are up to date
        run: deepl sync --frozen
        env:
          DEEPL_API_KEY: ${{ secrets.DEEPL_API_KEY }}
```

The `--frozen` flag causes the sync engine to exit with code 10 if any translations are missing or outdated, without making any API calls. This is ideal for pull request checks.

### GitHub Actions (auto-sync)

```yaml
name: i18n Auto-Sync
on:
  push:
    branches: [main]
    paths:
      - "locales/en/**"

jobs:
  sync-translations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install -g @deepl/cli
      - name: Sync and commit translations
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          deepl sync --auto-commit
          git push
        env:
          DEEPL_API_KEY: ${{ secrets.DEEPL_API_KEY }}
```

The `--auto-commit` flag stages translated files and the lock file (when updated), then creates a commit automatically. All `git` invocations run in the project root resolved from `.deepl-sync.yaml`, not the caller's current working directory.

**Preflight checks.** Before staging or committing, `deepl sync --auto-commit` refuses to proceed with a `ValidationError` (exit code 6) when any of the following are true:

1. **Dirty working tree with unrelated modifications.** `git status --porcelain` lists paths outside the translation-target-files set (the written locale files plus `.deepl-sync.lock` when it was updated). Commit or stash the unrelated changes, then re-run.
2. **A rebase, merge, or cherry-pick is in progress.** `.git/rebase-apply`, `.git/rebase-merge`, `.git/MERGE_HEAD`, or `.git/CHERRY_PICK_HEAD` exists. Complete or abort the operation first (`git rebase --abort`, `git merge --abort`, `git cherry-pick --abort`).
3. **HEAD is detached.** `git symbolic-ref -q HEAD` fails. Check out a branch (`git checkout <branch>`) before auto-committing.
4. **Pre-existing staged changes unrelated to this sync.** These appear the same as #1 in `git status --porcelain` output and are rejected for the same reason — the chore(i18n) commit would otherwise bundle them.

The `.deepl-sync.lock` file is only staged when this sync run actually wrote an updated lockfile; a no-op sync (all locales current) will not stage or commit.

**Combined with `--watch`.** `deepl sync --watch --auto-commit` commits on **every successful sync cycle**, not only the initial pre-watch sync. Each commit is gated by the same preflight checks listed above (clean tree, on a branch, not mid-rebase/merge/cherry-pick). If preflight fails for a given cycle, that cycle throws and the watcher logs the error; subsequent cycles report the same refusal until the tree is clean again, at which point the pending translations are committed — including any left behind by an earlier refused cycle. A cycle with nothing to commit is silent.

### GitLab CI

```yaml
i18n-check:
  stage: test
  image: node:24
  script:
    - npm install -g @deepl/cli
    - deepl sync --frozen
  variables:
    DEEPL_API_KEY: $DEEPL_API_KEY
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

### Pre-commit Hook

```bash
# Install a pre-commit hook that checks translations
deepl hooks install pre-commit

# Or add to your .pre-commit-config.yaml
# - repo: local
#   hooks:
#     - id: deepl-sync-check
#       name: Check i18n translations
#       entry: deepl sync --frozen
#       language: system
#       pass_filenames: false
```

## Troubleshooting

### Is translation memory actually being applied?

If translated output does not reuse known TM entries, work through these checks in order:

1. **Verify TM is active for the run.** Confirm `translation.translation_memory` is set in `.deepl-sync.yaml` (or in the per-locale override that applies). `deepl sync` does not expose `--translation-memory` on the command line; the only source of truth is the YAML config. If you pass `--sync-config <path>`, double-check you are editing the file the sync actually loads. Resolution failures — unknown TM name, wrong pair — surface as `ConfigError` with exit code 7 before any translation happens.

2. **Confirm override precedence.** When the same locale has both a top-level `translation.translation_memory` and a `translation.locale_overrides.<locale>.translation_memory`, the per-locale override wins. The same precedence applies to `translation_memory_threshold`: the per-locale override wins when set, otherwise the top-level threshold is used, otherwise the API default of 75 is applied at the client layer. A locale absent from `locale_overrides` inherits the top-level TM; to disable TM for a single locale, set `translation_memory: ""` in its override block.

3. **Check threshold propagation.** The YAML value flows through `SyncTranslationSettings` into the per-locale `TranslationOptions` and is sent as `translation_memory_threshold` on each translate request. If `translation_memory_threshold` is invalid (non-integer or outside 0–100), `deepl sync` exits 7 (ConfigError) with the offending key path before any API call. A threshold set without `translation_memory` is silently inert — there is no TM to match against. Raising the threshold tightens match strictness: a call that reuses TM text at threshold 75 may fall back to fresh MT at threshold 95.

### "No .deepl-sync.yaml found"

Run `deepl sync init` to create the config file, or create one manually in your project root.

### "0 strings to translate" on first run

Check that your `include` patterns in `.deepl-sync.yaml` actually match files. Use `deepl sync status` to verify file detection.

### Target files not appearing

Ensure your `target_locales` are set and that the target file path conventions match your framework. For example, if your source is `locales/en.json`, the German target would be `locales/de.json`.

For formats where the source locale is not in the source file path (Android XML, XLIFF), you must set `target_path_pattern` in the bucket config. For example:

```yaml
android_xml:
  include:
    - "res/values/strings.xml"
  target_path_pattern: "res/values-{locale}/strings.xml"
```

Without `target_path_pattern`, the sync engine cannot determine where to write target files for these formats.

### Merge conflicts in `.deepl-sync.lock`

Run `deepl sync resolve` to auto-resolve by taking the newer translation for each conflicting entry. Then run `deepl sync` to fill any gaps.

### "Sync drift detected" in CI (exit code 10)

The `--frozen` flag found missing or outdated translations. Run `deepl sync` locally, commit the updated files, and push again.

### Placeholders broken in translation

Run `deepl sync validate` to detect placeholder issues. Consider adding a glossary for domain-specific placeholders.

The sync engine automatically preserves these placeholder formats during translation:
- Simple variables: `{name}`, `{{count}}`, `${userId}`
- Printf-style: `%s`, `%d`, `%1$s`, `%2$d`
- ICU MessageFormat: `{count, plural, one {# item} other {# items}}` — structural keywords (`plural`, `select`, `selectordinal`, `one`, `other`, `few`, `many`, `zero`, `two`) and variable names are preserved; only leaf text is translated. Nested ICU (e.g., select inside plural) is supported.

### Rate limiting (HTTP 429)

The sync engine respects `Retry-After` headers and uses exponential backoff. Reduce `--concurrency` if you hit rate limits frequently.

### Partial failures

Each target locale translates independently. If the API returns a transient error (e.g., HTTP 5xx) for one locale after retries are exhausted, the sync continues with the other locales and records the failure in the per-file result. The successful locales keep their written target files and lockfile entries; the failed locale's target file is not written. Re-running `deepl sync` resumes only the locales that failed. Authentication failures (401/403) abort the entire run, since the same credential is used across every locale.

### Large projects with many strings

- Pass `--locale` to restrict a sync run to one language at a time
- Increase `--concurrency` for faster parallel processing (default: 5)
- The lockfile ensures only changed strings are sent, keeping subsequent syncs fast

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success -- all translations up to date |
| 1 | General error -- unclassified failure (inspect stderr) |
| 6 | Invalid input -- bad arguments or unsupported format |
| 7 | Config error -- invalid or missing `.deepl-sync.yaml` |
| 8 | Validation failed -- `deepl sync validate` found issues |
| 10 | Sync drift detected -- `--frozen` found missing/outdated translations |
| 11 | Sync conflict -- `sync resolve` could not auto-resolve lockfile conflicts |
| 12 | Partial sync failure -- one or more locales failed, others succeeded; retry with `--locale <failed>` |

See [API.md Exit Codes appendix](API.md#exit-codes) for detailed per-code descriptions, triggering commands, and shell-handling examples across every `deepl` command.

## Further Reading

- [API Reference](./API.md#sync) -- complete command and flag reference
- [Example: Basic Sync](../examples/30-sync-basic.sh) -- walkthrough of a typical sync workflow
- [Example: CI/CD Sync](../examples/31-sync-ci.sh) -- using sync in automated pipelines
- [CHANGELOG](../CHANGELOG.md) -- release history

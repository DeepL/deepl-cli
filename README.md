# DeepL CLI

> A next-generation command-line interface for DeepL translation and writing enhancement

[![CI](https://github.com/DeepL/deepl-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/DeepL/deepl-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blueviolet.svg)](https://opensource.org/licenses/MIT)

**DeepL CLI** is a comprehensive, developer-friendly command-line tool that integrates DeepL's powerful translation API and cutting-edge Write API for grammar and style enhancement. Built with TypeScript and designed for modern development workflows.

## 🌟 Key Features

- **🌍 Translation** - High-quality translation using DeepL's next-gen LLM
- **🔄 Continuous Localization (`deepl sync`)** - Incremental i18n file sync with 11 format parsers
- **📄 Document Translation** - Translate PDF, DOCX, PPTX, XLSX with formatting preservation
- **🎙️ Voice Translation (Pro/Enterprise)** - Real-time speech translation via WebSocket streaming (Voice API)
- **👀 Watch Mode** - Real-time file watching with auto-translation
- **✍️ Writing Enhancement** - Grammar, style, and tone suggestions (DeepL Write API)
- **💾 Smart Caching** - Local SQLite cache with LRU eviction
- **🎯 Context-Aware** - Preserves code blocks, variables, and formatting
- **📦 Batch Processing** - Translate multiple files with parallel processing
- **💰 Cost Transparency** - Track actual billed characters for budget planning
- **🔧 Developer Workflows** - Git hooks, CI/CD integration
- **🔒 Privacy-First** - Local caching, no telemetry, secure key storage

For security policy and vulnerability reporting, see [SECURITY.md](SECURITY.md).

## 📋 Table of Contents

- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Global Options](#-global-options)
  - [Verbose Mode](#verbose-mode)
  - [Quiet Mode](#quiet-mode)
  - [Custom Configuration Files](#custom-configuration-files)
  - [Configuration Paths](#configuration-paths)
    - [Proxy Configuration](#proxy-configuration)
    - [Retry and Timeout Configuration](#retry-and-timeout-configuration)
- [Usage](#-usage)
  - **Core Commands:** [Translation](#translation) | [Writing Enhancement](#writing-enhancement) | [Voice Translation](#voice-translation)
  - **Resources:** [Glossaries](#glossaries) | [Translation Memories](#translation-memories)
  - **Workflow:** [Watch Mode](#watch-mode) | [Git Hooks](#git-hooks)
  - **Configuration:** [Setup Wizard](#setup-wizard) | [Authentication](#authentication) | [Configure Defaults](#configure-defaults) | [Cache Management](#cache-management) | [Style Rules](#style-rules)
  - **Information:** [Usage Statistics](#api-usage-statistics) | [Language Detection](#language-detection) | [Languages](#supported-languages) | [Shell Completion](#shell-completion) | [Command Suggestions](#command-suggestions)
  - **Administration:** [Admin API](#admin-api)
- [Development](#-development)
- [Architecture](#-architecture)
- [Testing](#-testing)
- [Documentation](#-documentation)
- [Environment Variables](#-environment-variables)
- [Security & Privacy](#-security--privacy)
- [Contributing](#-contributing)
- [License](#-license)

## 📦 Installation

> **Prerequisite:** Node.js **24 or later** (except for Homebrew, which installs Node for you). The cache uses Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) module — no native compilation, no build toolchain needed.

### Homebrew (macOS / Linux)

```bash
brew install deepl/tap/deepl
```

Installs the `deepl` command and everything it needs, including Node.

### npm

```bash
npm install -g @deepl/cli

# Verify installation
deepl --version
```

The package is scoped, but the command is just `deepl`.

### From Source

```bash
# Clone the repository
git clone https://github.com/DeepL/deepl-cli.git
cd deepl-cli

# Install dependencies
npm install

# Build the project
npm run build

# Link for global usage
npm link

# Verify installation
deepl --version
```

## 🚀 Quick Start

### 1. Get Your DeepL API Key

Sign up for a [DeepL API account](https://www.deepl.com/pro-api) and get your authentication key.

### 2. Set Up Your Environment

Use the interactive setup wizard:

```bash
deepl init
```

Or set your API key directly:

```bash
deepl auth set-key YOUR_API_KEY

# Recommended: pipe key from stdin to avoid exposing it in process listings
echo "YOUR_API_KEY" | deepl auth set-key --from-stdin
```

Or use an environment variable:

```bash
export DEEPL_API_KEY=YOUR_API_KEY
```

### 3. Translate Your First Text

```bash
deepl translate "Hello, world!" --to es
# Output:
# Translation (ES):
# ¡Hola, mundo!
```

## 🔧 Global Options

DeepL CLI supports global flags that work with all commands:

| Flag            | Short | Description                                                  |
| --------------- | ----- | ------------------------------------------------------------ |
| `--version`     | `-V`  | Show version number                                          |
| `--quiet`       | `-q`  | Suppress non-essential output                                |
| `--verbose`     | `-v`  | Show extra information                                       |
| `--config FILE` | `-c`  | Use alternate configuration file                             |
| `--no-input`    |       | Disable all interactive prompts (abort instead of prompting) |

### Verbose Mode

The `--verbose` (or `-v`) flag shows extra information such as detected source language, timing, and cache status. Useful for debugging and understanding translation behavior.

```bash
$ deepl --verbose translate "Hello" --to es
```

### Quiet Mode

The `--quiet` (or `-q`) flag suppresses all non-essential output, showing only errors and essential results. Perfect for scripts, CI/CD pipelines, and automation.

```bash
# Normal mode - shows informational messages
$ deepl translate "Hello" --to es
Hello

# Quiet mode - cleaner output
$ deepl --quiet translate "Hello" --to es
Hola

# Suppress progress indicators in batch operations
$ deepl --quiet translate docs/ --to es --output docs-es/
# Shows only final statistics, no spinners or progress updates
```

**What's suppressed in quiet mode:**

- ❌ Informational messages (`API Key: ...`)
- ❌ Success confirmations (`✓ Cache enabled`)
- ❌ Progress spinners and status updates
- ❌ Decorative output

**What's always shown:**

- ✅ Errors and critical warnings
- ✅ Essential command output (translation results, JSON data, statistics)

**Use cases:**

- **CI/CD pipelines**: Clean output for log parsing
- **Scripting**: Extract just the translation result
- **Automation**: Reduce noise in automated workflows
- **Parsing**: Easier to parse machine-readable output

```bash
# Example: Use in scripts
TRANSLATION=$(deepl --quiet translate "Hello" --to es)
echo "Result: $TRANSLATION"  # Result: Hola

# Example: CI/CD pipeline
deepl --quiet translate docs/ --to es,fr,de --output i18n/
# Returns exit code 0 on success, shows only errors if they occur
```

See [docs/API.md#global-options](./docs/API.md#global-options) for complete documentation.

### Command Suggestions

Mistype a command? The CLI suggests the closest match:

```bash
$ deepl transalte "Hello" --to es
# Error: Unknown command 'transalte'. Did you mean 'translate'?
```

### Custom Configuration Files

The `--config` (or `-c`) flag allows you to use alternate configuration files for different projects, environments, or accounts:

```bash
# Use work configuration
$ deepl --config ~/.deepl-work.json translate "Hello" --to es

# Use project-specific configuration
$ deepl --config ./project/.deepl.json translate docs/ --to fr --output docs-fr/

# Use test environment configuration
$ deepl -c /path/to/test-config.json usage
```

**Use cases:**

- **Multiple API keys**: Switch between free and paid accounts
- **Project isolation**: Different settings per project (glossaries, formality defaults, etc.)
- **Team configurations**: Share standardized configs via version control
- **Environment separation**: Separate configs for dev/staging/production
- **Testing**: Use test configurations without affecting default settings

**Precedence**: `--config` > `DEEPL_CONFIG_DIR` > legacy `~/.deepl-cli/` > XDG directories (see below).

### Configuration Paths

The CLI follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/):

| Priority | Condition              | Config path                              | Cache path                           |
| -------- | ---------------------- | ---------------------------------------- | ------------------------------------ |
| 1        | `DEEPL_CONFIG_DIR` set | `$DEEPL_CONFIG_DIR/config.json`          | `$DEEPL_CONFIG_DIR/cache.db`         |
| 2        | `~/.deepl-cli/` exists | `~/.deepl-cli/config.json`               | `~/.deepl-cli/cache.db`              |
| 3        | XDG env vars set       | `$XDG_CONFIG_HOME/deepl-cli/config.json` | `$XDG_CACHE_HOME/deepl-cli/cache.db` |
| 4        | Default                | `~/.config/deepl-cli/config.json`        | `~/.cache/deepl-cli/cache.db`        |

Existing `~/.deepl-cli/` installations continue to work with no changes needed.

See [docs/API.md#global-options](./docs/API.md#global-options) for more details.

## 📖 Usage

### Translation

#### Basic Text Translation

```bash
# Simple translation
deepl translate "Hello world" --to ja
# Translation (JA):
# こんにちは世界

# Specify source language explicitly
deepl translate "Bonjour" --from fr --to en
# Translation (EN):
# Hello

# Multiple target languages
deepl translate "Good morning" --to es,fr,de
# Translation (ES):
# Buenos días
#
# Translation (FR):
# Bonjour
#
# Translation (DE):
# Guten Morgen

# Read from stdin
echo "Hello world" | deepl translate --to es
cat input.txt | deepl translate --to ja
```

#### File Translation

**Text Files:** `.txt`, `.md`, `.html`, `.htm`, `.srt`, `.xlf`, `.xliff`

**Structured Files (i18n):** `.json`, `.yaml`, `.yml`

Structured files are parsed to extract only string values. Keys, nesting, non-string values (numbers, booleans, null), indentation, and YAML comments are all preserved. Ideal for translating i18n locale files.

```bash
# Translate a JSON locale file
deepl translate en.json --to es --output es.json

# Translate a YAML locale file (comments preserved)
deepl translate en.yaml --to de --output de.yaml

# Multiple targets
deepl translate locales/en.json --to es,fr,de --output locales/
```

**Smart Caching for Text Files:**

Small text-based files (under 100 KiB) automatically use the cached text translation API for faster performance and reduced API calls. Larger files automatically fall back to the document translation API (not cached).

- **Cached formats:** `.txt`, `.md`, `.html`, `.htm`, `.srt`, `.xlf`, `.xliff` (files under 100 KiB only)
- **Structured formats:** `.json`, `.yaml`, `.yml` — parsed and translated via batch text API (no size limit)
- **Large file fallback:** Files ≥100 KiB use document API (not cached, always makes API calls)
- **Binary formats:** `.pdf`, `.docx`, `.pptx`, `.xlsx` always use document API (not cached)
- **Performance:** Only small text files (<100 KiB) benefit from instant cached translations
- **Cost savings:** Only small text files avoid repeated API calls

```bash
# Single file translation (uses cache for small text files)
deepl translate README.md --to es --output README.es.md
# Translated README.md to 1 language(s):
#   [ES] README.es.md

# Multiple target languages (creates README.es.md, README.fr.md, etc.)
deepl translate docs.md --to es,fr,de --output ./translated/
# Translated docs.md to 3 language(s):
#   [ES] ./translated/docs.es.md
#   [FR] ./translated/docs.fr.md
#   [DE] ./translated/docs.de.md

# With code preservation (preserves code blocks in markdown)
deepl translate tutorial.md --to ja --output tutorial.ja.md --preserve-code

# Large text file (over 100 KiB) - automatic fallback with warning
deepl translate large-document.txt --to es --output large-document.es.txt
# ⚠ File exceeds 100 KiB limit for cached translation (150.5 KiB), using document API instead
# Translated large-document.txt to 1 language(s):
#   [ES] large-document.es.txt
```

#### Document Translation

**Supported Document Formats:** `.pdf`, `.docx`, `.doc`, `.pptx`, `.xlsx`, `.html`, `.htm`, `.txt`, `.srt`, `.xlf`, `.xliff`, `.jpg`, `.jpeg`, `.png`

Translate complete documents while preserving formatting, structure, and layout:

```bash
# Translate PDF document
deepl translate document.pdf --to es --output document.es.pdf
# Uploading document...
# Document queued for translation...
# Translating document (est. 5s remaining)...
# Downloading translated document...
# ✔ Document translated successfully!
# Translated document.pdf -> document.es.pdf
# Billed characters: 1,234

# Translate PowerPoint presentation
deepl translate presentation.pptx --to fr --output presentation.fr.pptx

# Translate Excel spreadsheet
deepl translate report.xlsx --to de --output report.de.xlsx

# Translate HTML file
deepl translate website.html --to ja --output website.ja.html

# With formality setting
deepl translate contract.pdf --to de --formality more --output contract.de.pdf

# Specify source language
deepl translate document.pdf --from en --to es --output document.es.pdf

# Convert PDF to DOCX during translation (ONLY supported conversion)
deepl translate document.pdf --to es --output-format docx --output document.es.docx
# Translates PDF to Spanish and converts to editable Word format

# Note: DeepL API only supports PDF → DOCX conversion
# All other format conversions (DOCX→PDF, HTML→TXT, etc.) are NOT supported
# See examples/06-document-format-conversion.sh for details
```

**Document Translation Features:**

- ✅ **Preserves Formatting** - Maintains fonts, styles, colors, and layout
- ✅ **Format Conversion** - PDF → DOCX conversion only (convert PDFs to editable Word documents)
- ✅ **Progress Tracking** - Real-time status updates during translation
- ✅ **Large Files** - Handles documents up to 10MB (PDF) or 30MB (other formats)
- ✅ **Cost Tracking** - Shows billed characters after translation
- ✅ **Async Processing** - Documents are translated on DeepL servers with polling

**Supported Formats:**

- `.pdf` - PDF documents
- `.docx`, `.doc` - Microsoft Word
- `.pptx` - Microsoft PowerPoint
- `.xlsx` - Microsoft Excel
- `.html`, `.htm` - HTML files
- `.txt` - Plain text files
- `.srt` - Subtitle files
- `.xlf`, `.xliff` - XLIFF localization files
- `.jpg`, `.jpeg` - JPEG images
- `.png` - PNG images

**Note:** Document translation uses DeepL's async translation API. The CLI automatically handles upload, polling, and download. Translation time varies based on document size and complexity.

#### Batch Translation (Directory Processing)

Translate multiple files in parallel with progress indicators:

```bash
# Translate all files in a directory
deepl translate ./docs --to es --output ./docs-es
# Scanning files...
# Translating files: 10/10
# ✔ Translation complete!
#
# Translation Statistics:
#   Total files: 10
#   ✓ Successful: 10

# Translate specific file types with glob pattern
deepl translate ./docs --to fr --output ./docs-fr --pattern "*.md"
# Only translates markdown files

# Non-recursive (current directory only)
deepl translate ./docs --to de --output ./docs-de --no-recursive

# Custom concurrency (default: 5)
deepl translate ./large-docs --to ja --output ./large-docs-ja --concurrency 10
# Faster processing with more parallel translations
```

**Performance Optimization:**

The CLI automatically optimizes batch translations by grouping multiple texts into single API requests (up to 50 texts per batch). This significantly reduces API overhead and improves translation speed compared to translating texts individually.

- ✅ **Automatic batching** - Groups translations into efficient batches
- ✅ **Cache-aware** - Only translates uncached texts
- ✅ **Smart splitting** - Respects DeepL API batch size limits (50 texts/request)
- ✅ **Parallel processing** - Multiple batches processed concurrently

This optimization is automatic and transparent - no configuration needed.

#### Advanced Translation Options

```bash
# Preserve code blocks and variables
deepl translate tutorial.md --preserve-code --to ja --output tutorial.ja.md

# Preserve line breaks and whitespace formatting
deepl translate document.txt --preserve-formatting --to es --output document.es.txt

# Enable document minification for PPTX/DOCX (reduces file size)
deepl translate presentation.pptx --enable-minification --to de --output presentation.de.pptx

# Set formality level (default, more, less, prefer_more, prefer_less, formal, informal)
deepl translate "How are you?" --formality more --to de --output formal.txt
# More formal: Wie geht es Ihnen?

deepl translate "How are you?" --formality less --to de --output casual.txt
# Less formal: Wie geht's?

# Add context for better translation quality (helps with ambiguous terms)
deepl translate "bank" --context "This document is about financial institutions" --to es
# Translation considers financial context → "banco" (financial institution)

deepl translate "bank" --context "This document is about rivers and geography" --to es
# Translation considers geographical context → "orilla" (riverbank)

# Combine context with other options
deepl translate "How are you?" --context "Formal business email" --formality more --to de

# Choose model type for quality vs. speed trade-offs
deepl translate "Long document text..." --to ja --model-type quality_optimized
# Best translation quality (default)

deepl translate "Real-time chat message" --to es --model-type latency_optimized
# Faster response time, slightly lower quality

deepl translate "Important email" --to de --model-type prefer_quality_optimized
# Prefer quality, fall back to latency if unavailable

# Custom instructions for tailored translations (repeatable, max 10)
deepl translate "Click Save to confirm" --to de \
  --custom-instruction "This is a software UI string" \
  --custom-instruction "Keep it concise"

# Combine custom instructions with other options
deepl translate "Meeting at the bank" --to es \
  --custom-instruction "This is about financial institutions" \
  --formality more

# Apply a style rule (Pro API only - get IDs with: deepl style-rules list)
deepl translate "Hello" --to de --style-id "abc-123-def-456"

# Custom API endpoint (for DeepL Pro accounts or testing)
deepl translate "Hello" --to es --api-url https://api.deepl.com/v2

# Track actual billed characters for cost transparency
deepl translate "Hello, world!" --to es --show-billed-characters
# Output:
# Hola, mundo!
#
# Billed characters: 13

# Table output format - structured view for multiple languages
deepl translate "Hello, world!" --to es,fr,de --format table
# ┌──────────┬──────────────────────────────────────────────────────────────────────┐
# │ Language │ Translation                                                          │
# ├──────────┼──────────────────────────────────────────────────────────────────────┤
# │ ES       │ ¡Hola, mundo!                                                        │
# │ FR       │ Bonjour le monde!                                                    │
# │ DE       │ Hallo, Welt!                                                         │
# └──────────┴──────────────────────────────────────────────────────────────────────┘

# Table format with cost tracking (adds Characters column)
deepl translate "Cost analysis" --to es,fr,de --format table --show-billed-characters --no-cache
# ┌──────────┬────────────────────────────────────────────────────────────┬────────────┐
# │ Language │ Translation                                                │ Characters │
# ├──────────┼────────────────────────────────────────────────────────────┼────────────┤
# │ ES       │ Análisis de costes                                         │ 14         │
# │ FR       │ Analyse des coûts                                          │ 14         │
# │ DE       │ Kostenanalyse                                              │ 14         │
# └──────────┴────────────────────────────────────────────────────────────┴────────────┘

# Preview what would be translated without making API calls (file/directory mode)
deepl translate ./docs --to es --dry-run

# Include beta languages that are not yet stable
deepl translate "Hello" --to my --enable-beta-languages

# Specify tag handling version (v2 improves structure handling, requires --tag-handling)
deepl translate page.html --to es --tag-handling html --tag-handling-version v2

# Advanced XML/HTML tag handling (requires --tag-handling xml)
# Control automatic XML structure detection
deepl translate "<doc><p>Hello</p></doc>" --to es --tag-handling xml --outline-detection false

# Specify tags that split sentences (like <br/> and <hr/>)
deepl translate "<div>First sentence<br/>Second sentence</div>" --to es --tag-handling xml --splitting-tags "br,hr"

# Preserve non-translatable content (code blocks, preformatted text)
deepl translate "<doc><code>let x = 1;</code><p>Text</p></doc>" --to es --tag-handling xml --non-splitting-tags "code,pre"

# Ignore specific tags and their content (scripts, styles)
deepl translate page.html --to es --tag-handling xml --ignore-tags "script,style,noscript" --output page.es.html

# Combine multiple XML tag handling options for fine-tuned control
deepl translate complex.xml --to de --tag-handling xml \
  --outline-detection false \
  --splitting-tags "br,hr,div" \
  --non-splitting-tags "code,pre,kbd" \
  --ignore-tags "script,style" \
  --output complex.de.xml
```

**XML Tag Handling Use Cases:**

Advanced XML/HTML tag handling is perfect for:

- 🌐 Localizing HTML websites while preserving structure
- 📚 Translating technical documentation with code blocks
- 📄 Processing custom XML formats with specific content rules
- 🔒 Protecting non-translatable content (scripts, styles, code)
- ✂️ Fine-tuned control over sentence splitting for better context

See [examples/09-xml-tag-handling.sh](./examples/09-xml-tag-handling.sh) for comprehensive XML tag handling examples with real-world scenarios.

**Model Types:**

- `quality_optimized` - Best translation quality, standard latency
- `prefer_quality_optimized` - Prefer quality, fallback to latency if unavailable
- `latency_optimized` - Faster responses, slightly lower quality (ideal for real-time use)

See [examples/08-model-type-selection.sh](./examples/08-model-type-selection.sh) for a complete example with different model types.

### Writing Enhancement

Improve your writing with AI-powered grammar, style, and tone suggestions using the **DeepL Write API**.

The `--lang` flag is optional. If omitted, DeepL auto-detects the language and rephrases in the original language. Generic codes `en` and `pt` are also accepted (mapped to `en-US` and `pt-BR` respectively).

```bash
# Auto-detect language (--lang is optional)
deepl write "This is a sentence."

# Specify language explicitly
deepl write "This is a sentence." --lang en-US

# Use generic language code (en maps to en-US, pt maps to pt-BR)
deepl write "This is a sentence." --lang en

# Apply business writing style
deepl write "We want to tell you about our new product." --lang en-US --style business

# Apply academic writing style
deepl write "This shows that the method works." --lang en-US --style academic

# Apply casual tone
deepl write "That is interesting." --lang en-US --style casual

# Use confident tone
deepl write "I think this will work." --lang en-US --tone confident

# Use diplomatic tone
deepl write "Try something else." --lang en-US --tone diplomatic

# Show all alternative improvements
deepl write "This is good." --tone enthusiastic --alternatives

# Improve files and save to output
deepl write input.txt --lang en-US --output improved.txt

# Edit file in place
deepl write document.md --lang en-US --in-place

# Interactive mode - choose from multiple style alternatives
# Generates improvements with simple, business, academic, and casual styles
deepl write "Text to improve." --lang en-US --interactive

# Interactive mode with file
deepl write document.md --lang en-US --interactive --in-place

# Interactive mode with specific style (single option)
deepl write "Text to improve." --lang en-US --style business --interactive

# Check if text needs improvement (exit code 0 if no changes needed)
deepl write document.md --lang en-US --check

# Auto-fix files in place
deepl write document.md --lang en-US --fix

# Auto-fix with backup
deepl write document.md --lang en-US --fix --backup

# Show diff between original and improved
deepl write file.txt --lang en-US --diff

# Show diff for plain text
deepl write "This text could be better." --lang en-US --diff

# Bypass cache for this request
deepl write "Fresh improvement please." --lang en-US --no-cache
```

**Supported Languages:**

- German (`de`)
- English (`en`) - generic, defaults to American English
- English - British (`en-GB`)
- English - American (`en-US`)
- Spanish (`es`)
- French (`fr`)
- Italian (`it`)
- Portuguese (`pt`) - generic, defaults to Brazilian Portuguese
- Portuguese - Brazilian (`pt-BR`)
- Portuguese - European (`pt-PT`)

**Writing Styles:**

- `simple` - Easy-to-read, accessible language
- `business` - Professional, formal business tone
- `academic` - Scholarly, research-oriented style
- `casual` - Relaxed, conversational tone
- `prefer_*` prefix - Apply style only if language supports it

**Tones:**

- `enthusiastic` - Energetic and positive
- `friendly` - Warm and approachable
- `confident` - Assertive and certain
- `diplomatic` - Tactful and considerate
- `prefer_*` prefix - Apply tone only if language supports it

**Interactive Mode:**

When using `--interactive` without specifying a style or tone, the CLI automatically generates **4 different alternatives** by calling the DeepL Write API with different writing styles (simple, business, academic, casual). You can then choose which version works best for your needs:

```
? Choose an improvement (4 alternatives):
❯ Keep original - "This text could be better improved with..."
  Simple - "This text needs improvement with better..."
  Business - "We recommend enhancing this text through..."
  Academic - "It is advisable to improve this text via..."
  Casual - "You should make this text better by..."
```

If you specify a style or tone with `--interactive`, you'll get a simple confirm/reject prompt for that single suggestion.

**Note:** You cannot combine `--style` and `--tone` in a single request. Choose one or the other.

### Voice Translation

Translate audio in real-time using the DeepL Voice API. Supports multiple audio formats with automatic content type detection.

```bash
# Translate an audio file
deepl voice recording.ogg --to de

# Multiple target languages (max 5)
deepl voice meeting.mp3 --to de,fr,es

# Specify source language
deepl voice audio.flac --to ja --from en

# Pipe from stdin (content-type required)
cat audio.pcm | deepl voice - --to es --content-type 'audio/pcm;encoding=s16le;rate=16000'

# JSON output
deepl voice speech.ogg --to de --format json

# Disable live streaming (plain text at end)
deepl voice speech.ogg --to de --no-stream

# Set source language detection mode (auto or fixed)
deepl voice speech.ogg --to de --from en --source-language-mode fixed

# Customize chunking behavior
deepl voice large-recording.ogg --to de --chunk-size 12800 --chunk-interval 100

# Adjust reconnection attempts (default: 3)
deepl voice speech.ogg --to de --max-reconnect-attempts 5
```

**Supported audio formats:** OGG (Opus), WebM (Opus), FLAC, MP3, PCM (16kHz s16le), Matroska (Opus)

Automatic WebSocket reconnection is enabled by default (up to 3 attempts). Disable with `--no-reconnect` or adjust with `--max-reconnect-attempts <n>`.

**Note:** The Voice API requires a DeepL Pro or Enterprise plan.

### Watch Mode

Monitor files or directories for changes and automatically translate them in real-time. Perfect for keeping documentation and localization files in sync.

```bash
# Watch a single file
deepl watch README.md --to es,fr,de

# Watch a directory (all supported files)
deepl watch docs/ --to ja --output docs-i18n/

# Watch with pattern filtering
deepl watch src/locales/ --pattern "*.json" --to es,fr,de

# Watch markdown files only
deepl watch docs/ --pattern "*.md" --to ja

# Auto-commit translations to git
deepl watch docs/ --to es --auto-commit

# Custom debounce delay (default: 500ms)
deepl watch src/ --to es --debounce 1000

# Preview what would be watched without starting the watcher
deepl watch docs/ --to es --dry-run

# Only watch git-staged files (useful in pre-commit workflows)
deepl watch . --to es --git-staged

# With formality and code preservation
deepl watch docs/ --to de --formality more --preserve-code
```

**Features:**

- 🔄 Real-time monitoring with debouncing
- 📁 Watch files or entire directories
- 🎯 Glob pattern filtering (e.g., `*.md`, `*.json`)
- 🔀 Multiple target languages
- 💾 Auto-commit to git (optional)
- 📌 Git-staged filtering for pre-commit workflows
- ⚡ Smart debouncing to avoid redundant translations

**Example output:**

```
👀 Watching for changes...
Path: docs/
Targets: es, fr, ja
Output: docs/translations
Pattern: *.md

📝 Change detected: docs/README.md
✓ Translated docs/README.md to 3 languages
  → [es] docs/translations/README.es.md
  → [fr] docs/translations/README.fr.md
  → [ja] docs/translations/README.ja.md

Press Ctrl+C to stop
```

See [examples/16-watch-mode.sh](./examples/16-watch-mode.sh) for a complete watch mode example with multiple scenarios.

### Git Hooks

Automate translation validation in your git workflow with pre-commit, pre-push, commit-msg, and post-commit hooks.

```bash
# Install hooks
deepl hooks install pre-commit
deepl hooks install pre-push
deepl hooks install commit-msg
deepl hooks install post-commit

# List hook installation status
deepl hooks list

# Show path to hook file
deepl hooks path pre-commit

# Uninstall a hook
deepl hooks uninstall pre-commit
```

**What the hooks do:**

- **pre-commit**: Checks if staged files include translatable content (`.md`, `.txt` files) and validates translations are up-to-date
- **pre-push**: Validates all translations in the repository before pushing to remote
- **commit-msg**: Validates or augments commit messages with translation context
- **post-commit**: Runs post-commit translation tasks (e.g., auto-translate changed files)

**Features:**

- 🔒 Safe installation with automatic backup of existing hooks
- 🎯 Only validates changed files (pre-commit)
- ⚡ Lightweight and fast
- 🔧 Customizable hook scripts
- 🗑️ Clean uninstallation with backup restoration

**Hook Status Example:**

```bash
$ deepl hooks list

Git Hooks Status:

  ✓ pre-commit      installed
  ✗ pre-push        not installed
  ✗ commit-msg      not installed
  ✗ post-commit     not installed
```

**Note:** The hooks are generated with placeholder validation logic. You can customize them based on your project's translation workflow by editing the hook files directly at `.git/hooks/pre-commit` or `.git/hooks/pre-push`.

See [examples/17-git-hooks.sh](./examples/17-git-hooks.sh) for a complete git hooks example demonstrating installation, usage, and management.

### Configuration

#### Setup Wizard

First-time users can use the interactive setup wizard:

```bash
deepl init
# Walks through:
# - API key setup and validation
# - Default target language selection
# - Basic configuration
```

> To configure continuous localization for an existing project, see also [`deepl sync init`](#sync-init) or run the wizard directly.

#### Authentication

```bash
# Set API key
deepl auth set-key YOUR_API_KEY
# ✓ API key saved and validated successfully
# Account type: DeepL API Free

# Show current API key status
deepl auth show
# API Key: abc1...2def
# Status: Valid

# Clear API key
deepl auth clear
# ✓ API key removed
```

Or use an environment variable:

```bash
export DEEPL_API_KEY=YOUR_API_KEY
```

#### API Usage Statistics

Check your API usage to monitor character consumption:

```bash
# Show API usage statistics
deepl usage
# Character Usage:
#   Used: 123,456 / 500,000 (24.7%)
#   Remaining: 376,544
```

**Note:** Usage statistics help you track your DeepL API character quota and avoid exceeding limits.

See [examples/23-usage-monitoring.sh](./examples/23-usage-monitoring.sh) for a complete usage monitoring example.

**Cost Transparency:**

For detailed cost tracking per translation, use the `--show-billed-characters` flag with the translate command (see Advanced Translation Options above). This displays the actual billed character count for each translation, helping with budget planning and cost analysis.

See [examples/12-cost-transparency.sh](./examples/12-cost-transparency.sh) for comprehensive cost tracking examples.

#### Language Detection

Detect the language of text using the DeepL API:

```bash
# Detect language of text
deepl detect "Bonjour le monde"
# Detected language: fr (French)

# Pipe text for detection
echo "こんにちは" | deepl detect

# JSON output for scripting
deepl detect "Hola mundo" --format json
# { "detected_language": "es", "language_name": "Spanish" }
```

#### Supported Languages

List all 121 supported languages grouped by category:

```bash
# Show all supported languages (both source and target)
deepl languages
# Source Languages:
#   ar    Arabic
#   bg    Bulgarian
#   ...
#   zh    Chinese
#
#   Extended Languages (quality_optimized only, no formality/glossary):
#   ace   Acehnese
#   af    Afrikaans
#   ...
#
# Target Languages:
#   ar        Arabic
#   ...
#   en-gb     English (British)
#   en-us     English (American)
#   ...
#
#   Extended Languages (quality_optimized only, no formality/glossary):
#   ace       Acehnese
#   ...

# Show only source languages
deepl languages --source

# Show only target languages
deepl languages --target

# Works without API key (shows local registry data)
deepl languages
```

**Note:** Languages are grouped into three categories:

- **Core** (32) — Full feature support including formality and glossaries
- **Regional** (7) — Target-only variants: `en-gb`, `en-us`, `es-419`, `pt-br`, `pt-pt`, `zh-hans`, `zh-hant`
- **Extended** (82) — Only support `quality_optimized` model, no formality or glossary

See [examples/24-languages.sh](./examples/24-languages.sh) for a complete example.

#### Configure Defaults

Configuration is stored in `~/.config/deepl-cli/config.json` (or `~/.deepl-cli/config.json` for legacy installations; see [Configuration Paths](#configuration-paths))

```bash
# View all configuration
deepl config list
# {
#   "auth": { "apiKey": "..." },
#   "api": { "baseUrl": "https://api.deepl.com", "usePro": true, ... },
#   "cache": { "enabled": true, "maxSize": 1073741824, "ttl": 2592000 },
#   ...
# }

# Get specific value
deepl config get cache.enabled
# true

# Set a value
deepl config set defaults.targetLangs es,fr,de
# ✓ Configuration updated: defaults.targetLangs = ["es","fr","de"]

# Set cache size (in bytes)
deepl config set cache.maxSize 2147483648
# ✓ Configuration updated: cache.maxSize = 2147483648

# Disable caching
deepl config set cache.enabled false

# Reset to defaults
deepl config reset
# ✓ Configuration reset to defaults

# Reset without confirmation prompt
deepl config reset --yes
```

#### Proxy Configuration

DeepL CLI automatically supports HTTP and HTTPS proxies through environment variables:

```bash
# Configure HTTP proxy
export HTTP_PROXY=http://proxy.example.com:8080
deepl translate "Hello" --to es

# Configure HTTPS proxy
export HTTPS_PROXY=https://proxy.example.com:8443
deepl translate "Hello" --to es

# Configure proxy with authentication
export HTTP_PROXY=http://username:password@proxy.example.com:8080
deepl translate "Hello" --to es

# Both HTTP_PROXY and HTTPS_PROXY are supported (case-insensitive)
export http_proxy=http://proxy.example.com:8080
export https_proxy=https://proxy.example.com:8443
```

**Features:**

- ✅ Automatic proxy detection from environment variables
- ✅ HTTP and HTTPS proxy support
- ✅ Proxy authentication support
- ✅ Follows standard proxy environment variable conventions
- ✅ Works with all DeepL CLI commands

**Note:** HTTPS_PROXY takes precedence over HTTP_PROXY when both are set. The CLI automatically parses proxy URLs including authentication credentials.

#### Retry and Timeout Configuration

DeepL CLI includes built-in retry logic and timeout handling for robust API communication:

**Automatic Retry Logic:**

- Automatically retries failed requests on transient errors (5xx, network failures)
- Default: 3 retries with exponential backoff
- Does not retry on client errors (4xx - bad request, auth failures, etc.)
- Exponential backoff delays: 1s, 2s, 4s, 8s, 10s (capped at 10s)

**Timeout Configuration:**

- Default timeout: 30 seconds per request
- Applies to all API requests (translate, usage, languages, etc.)

**Features:**

- ✅ Automatic retry on transient failures
- ✅ Exponential backoff to avoid overwhelming the API
- ✅ Smart error detection (retries 5xx, not 4xx)
- ✅ Configurable via library-consumer options; not exposed as a CLI flag
- ✅ Works across all DeepL API endpoints

**Retry Behavior Examples:**

```bash
# Network failure - automatically retries up to 3 times
deepl translate "Hello" --to es
# If API returns 503 (service unavailable), retries automatically

# Authentication failure (403) - does not retry
deepl translate "Hello" --to es
# Fails immediately without retries on auth errors

# Rate limiting (429) - does not retry
# You may want to wait before retrying manually
```

**Note:** Retry and timeout settings use sensible defaults optimized for the DeepL API. These are internal features that work automatically - no configuration required.

### Glossaries

DeepL glossaries ensure consistent terminology across translations. The v3 Glossary API supports both single-target and multilingual glossaries (one glossary with multiple target languages).

```bash
# Create a single-target glossary from TSV file
# File format: source_term<TAB>target_term per line
echo -e "API\tAPI\nREST\tREST\nauthentication\tAuthentifizierung" > glossary.tsv
deepl glossary create tech-terms en de glossary.tsv
# ✓ Glossary created: tech-terms (ID: abc123...)
# Source language: EN
# Target languages: DE
# Type: Single target
# Total entries: 3

# List all glossaries
deepl glossary list
# 📖 tech-terms (en→de) - 3 entries
# 📚 multilingual-terms (en→3 targets) - 15 entries

# Show glossary details
deepl glossary show tech-terms
# Name: tech-terms
# ID: abc123...
# Source language: en
# Target languages: de
# Type: Single target
# Total entries: 3
# Created: 2024-10-07T12:34:56Z

# Show glossary entries (single-target glossary - no --target flag needed)
deepl glossary entries tech-terms
# API → API
# REST → REST
# authentication → Authentifizierung

# Show entries for multilingual glossary (--target flag required)
deepl glossary entries multilingual-terms --target-lang es
# API → API
# cache → caché
# ...

# Delete glossary
deepl glossary delete tech-terms
# ✓ Glossary deleted: tech-terms

# Preview what would be deleted without performing the operation
deepl glossary delete tech-terms --dry-run

# List supported glossary language pairs
deepl glossary languages
# de → en
# de → fr
# de → it
# en → de
# en → es
# en → fr
# en → ja
# en → pt
# ...

# Add a new entry to an existing glossary
deepl glossary add-entry tech-terms "database" "Datenbank"
# ✓ Entry added successfully

# Add entry to multilingual glossary (requires --target-lang flag)
deepl glossary add-entry multilingual-terms "cache" "caché" --target-lang es

# Update an existing entry in a glossary
deepl glossary update-entry tech-terms "API" "API (Programmierschnittstelle)"
# ✓ Entry updated successfully

# Remove an entry from a glossary
deepl glossary remove-entry tech-terms "REST"
# ✓ Entry removed successfully

# Rename a glossary
deepl glossary rename tech-terms "Technical Terms v2"
# ✓ Glossary renamed successfully

# Update glossary name and/or dictionary entries in a single request
deepl glossary update my-terms --name "Updated Terms" --target-lang de --file updated.tsv

# Replace all entries in a glossary dictionary from a new file (v3 API only)
# Unlike individual entry updates (which merge), this replaces the entire dictionary
deepl glossary replace-dictionary multilingual-terms es updated-entries.tsv
# ✓ Dictionary replaced successfully (es)
# Note: All existing entries for the target language are removed and replaced
# The file format is the same as for 'glossary create' (TSV or CSV)

# Delete a dictionary from a multilingual glossary (v3 API only)
# Removes a specific language pair from a multilingual glossary
deepl glossary delete-dictionary multilingual-terms es
# ✓ Dictionary deleted successfully (es)
# Note: This only works with multilingual glossaries (multiple target languages)
# For single-target glossaries, use 'glossary delete' to remove the entire glossary
```

**Glossary file format (TSV):**

```tsv
source_term	target_term
API	API
REST	REST
authentication	Authentifizierung
```

**Key Features:**

- **Single-target glossaries** - One source language → one target language (e.g., EN → DE)
- **Multilingual glossaries** - One source language → multiple target languages (e.g., EN → ES, FR, DE)
- **Direct updates** - v3 API uses PATCH endpoints for efficient updates (no delete+recreate)
- **Smart defaults** - `--target` flag only required for multilingual glossaries
- **Visual indicators** - 📖 for single-target, 📚 for multilingual glossaries
- **Translation integration** - Use `--glossary` flag in translate and watch commands to apply glossary terms

### Style Rules

Style rules are pre-configured translation rules created via the DeepL web UI and applied to translations using their ID (Pro API only).

```bash
# List available style rules
deepl style-rules list

# List with detailed information
deepl style-rules list --detailed

# JSON output
deepl style-rules list --format json

# Paginate results
deepl style-rules list --page 2 --page-size 10

# Apply a style rule to a translation
deepl translate "Hello" --to de --style-id "abc-123-def-456"
```

### Admin API

Manage API keys and view organization usage analytics (requires admin-level API key).

```bash
# List all API keys in the organization
deepl admin keys list

# List keys in JSON format
deepl admin keys list --format json

# Create a new API key
deepl admin keys create --label "Production Key"

# Rename an API key
deepl admin keys rename <key-id> "New Label"

# Set character usage limit
deepl admin keys set-limit <key-id> 1000000

# Remove usage limit (unlimited)
deepl admin keys set-limit <key-id> unlimited

# Deactivate an API key (permanent, cannot be undone)
deepl admin keys deactivate <key-id>

# Deactivate without confirmation prompt
deepl admin keys deactivate <key-id> --yes

# View organization usage for a date range (includes per-product breakdown)
deepl admin usage --start 2024-01-01 --end 2024-12-31
# Period: 2024-01-01 to 2024-12-31
#
# Total Usage:
#   Total:       10,000
#   Translation: 7,000
#   Documents:   2,000
#   Write:       1,000

# Usage grouped by key (shows per-product breakdown per key)
deepl admin usage --start 2024-01-01 --end 2024-12-31 --group-by key

# Daily usage per key
deepl admin usage --start 2024-01-01 --end 2024-01-31 --group-by key_and_day

# JSON output for programmatic use
deepl admin usage --start 2024-01-01 --end 2024-12-31 --format json
```

**Key Management:**

- **list** - View all API keys in the organization
- **create** - Create a new key with an optional label
- **rename** - Change the label of an existing key
- **set-limit** - Set or remove character usage limits
- **deactivate** - Permanently deactivate a key (requires confirmation)

**Usage Analytics:**

- Per-product character breakdowns (translation, documents, write)
- Group by key or by key and day for cost allocation
- JSON output for integration with monitoring tools

**Note:** Admin API endpoints require an admin-level API key, not a regular developer key. Key deactivation is permanent and cannot be undone.

### Shell Completion

Generate shell completion scripts for tab-completion of commands, options, and arguments:

```bash
# Bash
deepl completion bash > /etc/bash_completion.d/deepl

# Zsh
deepl completion zsh > "${fpath[1]}/_deepl"

# Fish
deepl completion fish > ~/.config/fish/completions/deepl.fish

# Or source directly in your current session
source <(deepl completion bash)
```

### Cache Management

The CLI uses a local SQLite database to cache translations and write improvements, reducing API calls.

```bash
# View cache statistics
deepl cache stats
# Cache Status: enabled
# Entries: 42
# Size: 1.23 MB / 1024.00 MB (0.1% used)

# Clear all cached translations
deepl cache clear
# ✓ Cache cleared successfully

# Preview what would be cleared without performing the operation
deepl cache clear --dry-run

# Enable caching
deepl cache enable
# ✓ Cache enabled

# Disable caching
deepl cache disable
# ✓ Cache disabled
```

Cache location: `~/.cache/deepl-cli/cache.db` (or `~/.deepl-cli/cache.db` for legacy installations)

## 💻 Development

### Prerequisites

- Node.js >= 20.19.0
- npm >= 9.0.0
- DeepL API key

### Setup

```bash
# Clone repository
git clone https://github.com/DeepL/deepl-cli.git
cd deepl-cli

# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Type check
npm run type-check

# Build
npm run build
```

### Development Workflow

See [CLAUDE.md](./CLAUDE.md) for comprehensive development guidelines.

### Project Structure

```
deepl-cli/
├── src/
│   ├── cli/              # CLI interface and commands
│   ├── services/         # Business logic
│   ├── api/              # DeepL API client
│   ├── storage/          # Data persistence (cache, config)
│   ├── utils/            # Utility functions
│   ├── types/            # Type definitions
├── tests/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── e2e/              # End-to-end tests
├── docs/                 # Documentation
├── examples/             # Usage examples
├── CLAUDE.md             # Development guidelines
└── README.md             # This file
```

### Running Locally

```bash
# Run CLI without building
npm run dev -- translate "Hello" --to es

# Or link for global usage
npm link
deepl translate "Hello" --to es
```

## 🏗️ Architecture

DeepL CLI follows a layered architecture:

```
CLI Commands (translate, write, voice, sync, watch, glossary, tm, …)
           ↓
Service Layer (Translation, Write, Voice, Batch, Watch, Glossary,
               TranslationMemory, StyleRules, Admin, Document,
               GitHooks, Usage, Detect, Languages)
           ↓                         ↓
Sync Engine (src/sync)        Format Parsers (src/formats — 11 i18n formats)
           ↓                         ↓
API Client (Translate, Write, Glossary, Document, Voice,
            StyleRules, Admin, TMS)
           ↓
Storage (SQLite Cache, Config) + Static Data (src/data — language registry)
```

### Key Components

- **Translation Service** — core translation with caching and text preservation
- **Write Service** — grammar, style, and tone suggestions
- **Voice Service** — real-time speech translation over WebSocket
- **Sync Engine** — continuous localization: scan, diff, translate, write, lock
- **Format Parsers** — 11 i18n parsers (JSON, YAML, TOML, PO, Android XML, iOS Strings, xcstrings, ARB, XLIFF, Properties, Laravel PHP) with format-preserving reconstruct
- **Batch Service** — parallel multi-file translation
- **Watch Service** — file watching with debouncing
- **Glossary Service** — glossary management and application
- **Translation Memory Service** — reuse approved translations (`--translation-memory`)
- **Cache** — SQLite cache with LRU eviction (`src/storage/cache.ts`)
- **Preservation utilities** — `src/utils/` helpers for code blocks, variables, and ICU MessageFormat

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test type
npm run test:unit
npm run test:integration
npm run test:e2e

# Run specific test file
npm test -- translation.test.ts

# Run with coverage report
npm run test:coverage

# Watch mode for TDD
npm test -- --watch

# Run all example scripts (validation)
npm run examples

# Run example scripts (fast mode, skips slow examples)
npm run examples:fast
```

## 📚 Documentation

- **[API Reference](./docs/API.md)** - Complete API reference with all commands, flags, and options
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues, solutions, and exit codes reference
- **[Examples](./examples/README.md)** - Practical usage examples for every feature
- **[Changelog](./CHANGELOG.md)** - Release history and version notes
- **[Development Guidelines](./CLAUDE.md)** - TDD workflow and contribution standards
- **[DeepL API Docs](https://www.deepl.com/docs-api)** - Official API documentation
- **[CLI Guidelines](https://clig.dev/)** - Command-line best practices

## 🌐 Environment Variables

| Variable           | Description                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `DEEPL_API_KEY`    | API authentication key                                                                                               |
| `DEEPL_CONFIG_DIR` | Override config and cache directory                                                                                  |
| `XDG_CONFIG_HOME`  | Override XDG config base (default: `~/.config`)                                                                      |
| `XDG_CACHE_HOME`   | Override XDG cache base (default: `~/.cache`)                                                                        |
| `HTTP_PROXY`       | HTTP proxy URL for outbound DeepL API traffic                                                                        |
| `HTTPS_PROXY`      | HTTPS proxy URL (takes precedence over `HTTP_PROXY`)                                                                 |
| `TMS_API_KEY`      | API key for the configured TMS server (`sync push`/`pull`)                                                           |
| `TMS_TOKEN`        | Alternative auth token for the configured TMS server                                                                 |
| `NO_COLOR`         | Disable colored output                                                                                               |
| `FORCE_COLOR`      | Force colored output even when terminal doesn't support it. Useful in CI. `NO_COLOR` takes priority if both are set. |
| `TERM=dumb`        | Disables colored output and progress spinners. Automatically set by some CI environments and editors.                |

See [docs/API.md#environment-variables](./docs/API.md#environment-variables) for full details.

## 🔒 Security & Privacy

- **API key storage** - Keys are stored as **plaintext** in `config.json` with `0600` file permissions (owner read/write only). For CI/CD or shared environments, prefer the `DEEPL_API_KEY` environment variable instead. Avoid committing `config.json` to version control — it is gitignored by default.
- **Local caching** - All cached data stored locally in SQLite, never shared
- **No telemetry** - Zero usage tracking or data collection
- **Environment variable support** - Use `DEEPL_API_KEY` environment variable for CI/CD
- **GDPR-aligned with DeepL's DPA** - Follows DeepL's Data Processing Agreement terms

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

DeepL® is a registered trademark of DeepL SE.

---

_Powered by DeepL's next-generation language model_

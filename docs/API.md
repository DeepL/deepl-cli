# DeepL CLI - API Reference

**Version**: 2.0.0
**Last Updated**: July 29, 2026

Complete reference for all DeepL CLI commands, options, and configuration.

---

## Table of Contents

- [Global Options](#global-options)
- [Commands](#commands)
  - Core Commands
    - [translate](#translate)
    - [write](#write)
    - [correct](#correct)
    - [voice](#voice)
  - Resources
    - [glossary](#glossary)
    - [tm](#tm)
  - Workflow
    - [watch](#watch)
    - [sync](#sync)
    - [hooks](#hooks)
  - Configuration
    - [init](#init)
    - [auth](#auth)
    - [config](#config)
    - [cache](#cache)
    - [style-rules](#style-rules)
  - Information
    - [usage](#usage)
    - [languages](#languages)
    - [detect](#detect)
    - [completion](#completion)
  - Administration
    - [admin](#admin)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Exit Codes](#exit-codes)

---

## Global Options

Options that work with all commands:

```bash
--version, -V       Show version number
--help              Show help message
--quiet, -q         Suppress all non-essential output (errors and results only)
--verbose, -v       Show extra information (source language, timing, cache status)
--config, -c FILE   Use alternate configuration file
--no-input          Disable all interactive prompts (abort instead of prompting)
--timeout MS        HTTP request timeout in milliseconds (default: 30000)
--max-retries N     Maximum automatic retries for retryable requests (default: 3)
```

Automatic retries apply to idempotent requests, and to rate-limited (429) responses for every method; a request that submits work is otherwise never replayed. Retries share a wall-clock budget of twice `--timeout`, so raising `--max-retries` alone does not extend how long the CLI waits on an unresponsive endpoint.

**Examples:**

```bash
# Show version
deepl --version

# Get help
deepl --help
deepl translate --help

# Quiet mode - suppress informational messages, keep errors and results
deepl --quiet translate "Hello" --to es
# Output: Hola (no "Translation (ES):" label)

deepl -q cache stats
# Shows cache statistics without decorative output

# Quiet mode with batch operations (no spinners or progress indicators)
deepl --quiet translate docs/ --to es --output docs-es/
# Shows final statistics only, no progress updates

# Use custom config file
deepl --config ~/.deepl-work.json translate "Hello" --to es

# Give a large document more time, and disable automatic retries
deepl --timeout 120000 --max-retries 0 translate report.pdf --to de

# Use custom config directory (via environment variable)
export DEEPL_CONFIG_DIR=/path/to/config
deepl translate "Hello" --to es

# Disable cache
deepl cache disable
deepl translate "Hello" --to es
deepl cache enable
```

**Quiet Mode Behavior:**

- ✅ **Always shown**: Errors and their `Suggestion:` remediation lines, essential output (translation results, JSON data, command output)
- ❌ **Suppressed**: Warnings, informational messages, success confirmations, progress spinners, status updates
- 🎯 **Use cases**: CI/CD pipelines, scripting, parsing output, quiet automation

**Non-Interactive Mode (`--no-input`):**

```bash
# Abort instead of prompting for confirmation
deepl --no-input cache clear
# Output: Aborted.

# Combine with --yes to skip prompts and proceed
deepl --no-input cache clear --yes

# Interactive-only commands error with exit code 6
deepl --no-input init
deepl --no-input write "text" --interactive
```

- Commands that require confirmation (e.g., `cache clear`) abort with "Aborted." instead of prompting
- `--yes` takes precedence over `--no-input` — the combination proceeds without prompting
- Interactive-only commands (`init`, `write --interactive`) exit with code 6 (InvalidInput)
- Use cases: CI/CD pipelines, scripts, automation where a forgotten prompt would hang

**Example comparison:**

```bash
# Normal mode
$ deepl cache enable
✓ Cache enabled

# Quiet mode
$ deepl --quiet cache enable
(no output - command succeeded silently)

# Normal mode with errors
$ deepl translate "Hello" --to invalid
Error: Invalid target language: invalid

# Quiet mode with errors (errors always shown)
$ deepl --quiet translate "Hello" --to invalid
Error: Invalid target language: invalid
```

**Custom Configuration Files:**

The `--config` flag allows you to use alternate configuration files for different projects, environments, or accounts:

```bash
# Use work configuration
deepl --config ~/.deepl-work.json translate "Hello" --to es

# Use project-specific configuration
deepl --config ./project/.deepl.json translate docs/ --to fr --output docs-fr/

# Use test environment configuration
deepl --config /path/to/test-config.json usage
```

**Use cases:**

- **Multiple API keys**: Switch between free and paid accounts
- **Project isolation**: Different settings per project (glossaries, formality, etc.)
- **Environment separation**: Separate configs for dev/staging/production
- **Testing**: Use test configurations without affecting default settings

**Precedence:** `--config` replaces the config _file_ only, overriding `DEEPL_CONFIG_DIR` for configuration. The cache location is unaffected — it still follows `DEEPL_CONFIG_DIR` > legacy `~/.deepl-cli/` > XDG resolution.

**Command Suggestions:**

Mistype a command? The CLI suggests the closest match:

```bash
$ deepl transalte "Hello" --to es
Unknown command: transalte
Did you mean: deepl translate?

Run deepl --help to see available commands.
```

---

## Commands

Commands are organized into six groups, matching the `deepl --help` output:

| Group              | Commands                                         | Description                                                               |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| **Core Commands**  | `translate`, `write`, `voice`                    | Translation, writing enhancement, and speech translation                  |
| **Resources**      | `glossary`, `tm`                                 | Manage translation glossaries and translation memory                      |
| **Workflow**       | `watch`, `sync`, `hooks`                         | File watching, project sync, and git hook automation                      |
| **Configuration**  | `init`, `auth`, `config`, `cache`, `style-rules` | Setup wizard, authentication, settings, caching, and style rules          |
| **Information**    | `usage`, `languages`, `detect`, `completion`     | API usage, supported languages, language detection, and shell completions |
| **Administration** | `admin`                                          | Organization key management and usage analytics                           |

---

### translate

Translate text, files, or directories.

#### Synopsis

```bash
deepl translate [OPTIONS] [TEXT|FILE|DIRECTORY]
deepl t [OPTIONS] [TEXT|FILE|DIRECTORY]        # alias
```

#### Description

Translate text directly, from stdin, from files, or entire directories. Supports multiple target languages, code preservation, and context-aware translation.

**Input Sources:**

- Direct text argument: `deepl translate "Hello" --to es`
- From stdin: `echo "Hello" | deepl translate --to es`
- Single file: `deepl translate README.md --to es --output README.es.md`
- Directory: `deepl translate docs/ --to es --output docs-es/`

**Note:** When reading from stdin or translating files, omit the text argument.

#### Options

**Target Language:**

- `--to, -t LANGS` - Target language(s), comma-separated (e.g., `es`, `es,fr,de`). Required unless `defaults.targetLangs` is configured.

**Source Options:**

- `--from, -f LANG` - Source language (auto-detect if omitted)
- `--context TEXT` - Additional context for better translation

**Output Options:**

- `--output, -o PATH` - Output file or directory (required for file/directory translation, optional for text). Use `-` for stdout (text-based files only)
- `--output-format FORMAT` - Convert PDF to DOCX during translation. Valid choices: `docx` (only supported conversion)
- `--enable-minification` - Enable document minification for PPTX/DOCX files (reduces file size)
- `--format FORMAT` - Output format: `text`, `json`, `table` (default: `text`)

**Translation Options:**

- `--formality LEVEL` - Formality: `default`, `more`, `less`, `prefer_more`, `prefer_less`, `formal`, `informal`
- `--model-type TYPE` - Model type: `quality_optimized`, `prefer_quality_optimized`, `latency_optimized` (no CLI default; the API server selects the model when omitted)
- `--preserve-code` - Preserve code blocks (markdown, etc.)
  - Known limitation: code blocks and variable placeholders (`{name}`, `%s`, etc.; always preserved) are protected internally with `__CODE_n__`/`__VAR_n__` tokens, so source text that literally contains such tokens may be rewritten during restoration.
- `--preserve-formatting` - Preserve line breaks and whitespace formatting
- `--split-sentences LEVEL` - Sentence splitting: `on` (default), `off`, `nonewlines`
- `--tag-handling MODE` - XML tag handling: `xml`, `html`
- `--outline-detection BOOL` - Control automatic XML structure detection: `true` (default), `false` (requires `--tag-handling xml`)
- `--splitting-tags TAGS` - Comma-separated XML tags that split sentences (requires `--tag-handling xml`)
- `--non-splitting-tags TAGS` - Comma-separated XML tags that should not be used to split sentences (requires `--tag-handling xml`)
- `--ignore-tags TAGS` - Comma-separated XML tags with content to ignore (requires `--tag-handling xml`)
- `--tag-handling-version VERSION` - Tag handling version: `v1`, `v2`. v2 improves XML/HTML structure handling (requires `--tag-handling`)
- `--glossary NAME-OR-ID` - Use glossary by name or ID for consistent terminology
- `--translation-memory NAME-OR-UUID` - Use translation memory by name or UUID (forces `quality_optimized` model). Requires `--from` because TMs are pinned to a specific source→target language pair. Invalid use exits 6 (ValidationError); unresolvable/misconfigured TM exits 7 (ConfigError).
- `--tm-threshold N` - Minimum match score 0–100 (default 75, requires `--translation-memory`). Invalid use exits 6 (ValidationError); unresolvable/misconfigured TM exits 7 (ConfigError).
- `--custom-instruction INSTRUCTION` - Custom instruction for translation (repeatable, max 10, max 300 chars each). Forces `quality_optimized` model. Cannot be used with `latency_optimized`.
- `--style-id UUID` - Style rule ID for translation (Pro API only). Forces `quality_optimized` model. Cannot be used with `latency_optimized`. Use `deepl style-rules list` to see available IDs.
- `--enable-beta-languages` - Include beta languages that are not yet stable (forward-compatibility with new DeepL languages)
- `--no-cache` - Bypass cache for this translation (useful for testing/forcing fresh translation)
- `--dry-run` - Show what would be translated without performing the operation

**API Options:**

- `--api-url URL` - Custom API endpoint URL (for testing or private instances)
- `--show-billed-characters` - Request and display actual billed character count for cost transparency

**Batch Options (for directories):**

- `--no-recursive` - Do not recurse into subdirectories (recursive is the default)
- `--pattern GLOB` - File pattern (e.g., `*.md`, `**/*.txt`)
- `--concurrency N` - Number of parallel translations (default: 5)

#### Examples

**Basic text translation:**

```bash
# Single language
deepl translate "Hello, world!" --to es

# Multiple languages
deepl translate "Hello, world!" --to es,fr,de

# With source language
deepl translate "Bonjour" --from fr --to en
```

**From stdin:**

```bash
# Pipe text
echo "Hello" | deepl translate --to es

# From file via stdin
cat README.md | deepl translate --to fr
```

**File translation:**

```bash
# Single file
deepl translate README.md --to es --output README.es.md

# Multiple languages
deepl translate README.md --to es,fr,de --output translations/

# With code preservation
deepl translate tutorial.md --to es --output tutorial.es.md --preserve-code
```

**Output to stdout:**

```bash
# Pipe translated file content to stdout
deepl translate README.md --to es --output -

# Combine with shell tools
deepl translate README.md --to es --output - | wc -l

# Redirect to a file
deepl translate README.md --to es --output - > translated.md
```

**Note:** `--output -` only works with text-based files (`.txt`, `.md`, `.html`, `.srt`, `.xlf`). Binary documents (PDF, DOCX, etc.), structured files (JSON, YAML), and multi-target translations do not support stdout output.

**Smart caching for text-based files:**

Small text-based files are automatically routed to the cached text API for faster, more efficient translations:

```bash
# Text files under 100 KiB are automatically cached
deepl translate README.md --to es --output README.es.md
# First translation: Makes API call
# Subsequent identical translations: Instant (from cache)

# HTML files also benefit from caching
deepl translate index.html --to fr --output index.fr.html

# Subtitle files
deepl translate subtitles.srt --to ja --output subtitles.ja.srt

# XLIFF localization files
deepl translate strings.xlf --to de --output strings.de.xlf
```

**Structured file formats (i18n):**

The following structured formats are parsed to extract only string values, translated via the batch text API, then reassembled preserving keys, nesting, non-string values, indentation, and YAML comments:

- `.json` - JSON files (i18n locale files, config files)
- `.yaml`, `.yml` - YAML files (Rails i18n, config files)

```bash
# Translate JSON locale file
deepl translate en.json --to es --output es.json

# Translate YAML locale file (comments preserved)
deepl translate en.yaml --to de --output de.yaml
```

**Cached text-based formats:**

The following formats use the cached text API when files are under 100 KiB:

- `.txt` - Plain text files
- `.md` - Markdown files
- `.html`, `.htm` - HTML files
- `.srt` - Subtitle files
- `.xlf`, `.xliff` - XLIFF localization files

**Large file automatic fallback:**

When text-based files exceed 100 KiB, they automatically fall back to the document API:

```bash
# Large text file (>100 KiB) - uses document API
deepl translate large-document.txt --to es --output large-document.es.txt
# ⚠ File exceeds 100 KiB limit for cached translation (150.5 KiB), using document API instead
# Translated large-document.txt -> large-document.es.txt
```

**Benefits of smart caching:**

- **Performance**: Only small text files (<100 KiB) benefit from instant cached translations
- **Efficiency**: Reduces API calls and character usage for small text files
- **Cost savings**: Only small text files avoid repeated API quota consumption
- **Automatic**: No configuration needed - works out of the box
- **Transparent**: Warning shown when falling back to document API

**Important**: Large text files (≥100 KiB) and all binary documents use the document API, which is NOT cached. Repeated translations of large files always make fresh API calls.

**Document translation:**

```bash
# Translate PDF document
deepl translate document.pdf --to es --output document.es.pdf

# Translate PowerPoint with formality
deepl translate presentation.pptx --to de --formality more --output presentation.de.pptx

# Translate Excel spreadsheet
deepl translate report.xlsx --to fr --output report.fr.xlsx

# Translate HTML file
deepl translate website.html --to ja --output website.ja.html

# Convert format during translation (PDF to DOCX - only supported conversion)
deepl translate document.pdf --to es --output document.es.docx --output-format docx

# Enable document minification for smaller file size (PPTX/DOCX only)
deepl translate presentation.pptx --to de --output presentation.de.pptx --enable-minification
deepl translate report.docx --to fr --output report.fr.docx --enable-minification
```

**Supported Document Formats:**

- `.pdf` - PDF documents (up to 30MB) - **Document API only**
- `.docx`, `.doc` - Microsoft Word - **Document API only**
- `.pptx` - Microsoft PowerPoint - **Document API only**
- `.xlsx` - Microsoft Excel - **Document API only**
- `.jpg`, `.jpeg` - JPEG images - **Document API only**
- `.png` - PNG images - **Document API only**
- `.html`, `.htm` - HTML files - **Smart routing** (cached text API <100 KiB, document API ≥100 KiB)
- `.txt` - Plain text files (up to 30MB) - **Smart routing** (cached text API <100 KiB, document API ≥100 KiB)
- `.srt` - Subtitle files - **Smart routing** (cached text API <100 KiB, document API ≥100 KiB)
- `.xlf`, `.xliff` - XLIFF localization files - **Smart routing** (cached text API <100 KiB, document API ≥100 KiB)
- `.md` - Markdown files - **Cached text API** (all sizes)
- `.json` - JSON files - **Structured file API** (string extraction + batch translation)
- `.yaml`, `.yml` - YAML files - **Structured file API** (string extraction + batch translation, comments preserved)

**Document Translation Notes:**

- **Structured files**: `.json`, `.yaml`, `.yml` are parsed to extract string values, translated via batch text API, and reassembled preserving structure
- **Smart routing**: Text-based files (`.txt`, `.md`, `.html`, `.srt`, `.xlf`, `.xliff`) under 100 KiB automatically use the cached text API for better performance
- **Binary formats** (PDF, DOCX, PPTX, XLSX) and **image formats** (JPEG, PNG) always use the document API regardless of size
- Documents are translated on DeepL servers using async processing
- Progress updates show status (queued → translating → done)
- Billed characters are displayed after completion
- Formatting, structure, and layout are automatically preserved
- Large documents may take several seconds to translate
- Maximum file sizes: 30MB (document API, all formats), 100 KiB (cached text API)
- **Document minification** (`--enable-minification`): Reduces file size for PPTX and DOCX files only. Useful for large presentations and documents.

**Directory translation:**

```bash
# Translate all supported files
deepl translate docs/ --to es --output docs-es/

# With glob pattern
deepl translate docs/ --to es --output docs-es/ --pattern "*.md"

# Recursive (default) with custom concurrency
deepl translate src/ --to es,fr --output translations/ --concurrency 10
```

**Context-aware translation:**

```bash
# Add context for better disambiguation
deepl translate "Bank" --to es --context "Financial institution"
# → "Banco" (not "Orilla" for riverbank)

deepl translate app.json --to es --context "E-commerce checkout flow"
```

**Formality levels:**

```bash
# Formal
deepl translate "How are you?" --to de --formality more
# → "Wie geht es Ihnen?" (formal)

# Informal
deepl translate "How are you?" --to de --formality less
# → "Wie geht es dir?" (informal)
```

**Sentence splitting:**

```bash
# Default behavior (sentences split on punctuation and newlines)
deepl translate "Hello. How are you?" --to es
# → "Hola. ¿Cómo estás?"

# Disable sentence splitting (treat as one unit)
deepl translate "Hello. How are you?" --to es --split-sentences off
# → May produce different translation

# Split only on punctuation, not newlines
deepl translate "Line 1\nLine 2" --to es --split-sentences nonewlines
# → Preserves line breaks while splitting sentences
```

**Tag handling (XML/HTML):**

```bash
# Basic XML tag preservation
deepl translate "<p>Hello world</p>" --to es --tag-handling xml
# → "<p>Hola mundo</p>"

# Translate HTML content
deepl translate "<div><span>Welcome</span></div>" --to de --tag-handling html
# → "<div><span>Willkommen</span></div>"

# Useful for localizing markup files
deepl translate content.html --to fr --tag-handling html --output content.fr.html

# Advanced XML tag handling: Disable automatic structure detection
deepl translate "<doc><p>Text</p></doc>" --to es --tag-handling xml --outline-detection false
# Forces manual tag handling instead of automatic detection

# Specify tags that split sentences (useful for custom XML formats)
deepl translate "<article><br/>Content<hr/>More</article>" --to es --tag-handling xml --splitting-tags "br,hr"
# Treats <br/> and <hr/> as sentence boundaries

# Specify tags for non-translatable content (like code blocks)
deepl translate "<doc><code>let x = 1;</code><p>Text</p></doc>" --to es --tag-handling xml --non-splitting-tags "code,pre"
# Content in <code> and <pre> tags won't be split into sentences

# Ignore specific tags and their content (e.g., scripts, styles)
deepl translate file.html --to es --tag-handling xml --ignore-tags "script,style,noscript" --output file.es.html
# Content in <script>, <style>, and <noscript> tags is not translated

# Combine multiple XML tag handling options
deepl translate complex.xml --to de --tag-handling xml \
  --outline-detection false \
  --splitting-tags "br,hr,div" \
  --non-splitting-tags "code,pre,kbd" \
  --ignore-tags "script,style" \
  --output complex.de.xml
# Fine-tuned control for complex XML/HTML documents
```

**Glossary usage:**

```bash
# Use glossary for consistent terminology
deepl translate "API documentation" --to es --glossary tech-terms

# Use glossary by ID
deepl translate README.md --to fr --glossary abc-123-def-456 --output README.fr.md
```

**Translation memory usage:**

Translation memories (TMs) are pinned to a source→target language pair, so `--from` is required. Passing `--translation-memory` forces `quality_optimized` model type; combining it with `--model-type latency_optimized` (or `prefer_quality_optimized`) exits 6 (ValidationError). TM files are authored and uploaded via the DeepL web UI; this CLI resolves the name-or-UUID against `GET /v3/translation_memories` and caches the resolution per run.

```bash
# Use translation memory by name (requires --from for pair resolution)
deepl translate "Welcome to our product." --from en --to de --translation-memory my-tm

# Use translation memory by UUID with a custom threshold
deepl translate "Welcome to our product." --from en --to de \
  --translation-memory 3f2504e0-4f89-41d3-9a0c-0305e82c3301 --tm-threshold 80

# Combine glossary and translation memory on a single call
deepl translate "Welcome to our product." --from en --to de \
  --glossary tech-terms --translation-memory my-tm --tm-threshold 85
```

**Multi-target file translation with glossary / TM:**

Both `--glossary` and `--translation-memory` apply to multi-target file translation (e.g. `--to en,fr,es`) and in that mode `--from` is required. Glossary name resolution works transparently across all target languages. Translation memory name resolution, however, requires a single TM that covers every requested target language pair — because each TM in DeepL is scoped to one source→target pair, using a TM name with differing multi-targets surfaces a `ConfigError` (exit 7). For multi-target TM use, pass the TM UUID directly.

```bash
# Glossary across multiple targets (name resolution works for all targets)
deepl translate README.md --from en --to fr,es,it --glossary tech-terms --output ./out

# Translation memory across multiple targets: pass a UUID to avoid the
# single-pair name-resolution constraint
deepl translate README.md --from en --to fr,es,it --output ./out \
  --translation-memory 3f2504e0-4f89-41d3-9a0c-0305e82c3301
```

**Cache control:**

```bash
# Bypass cache for fresh translation
deepl translate "Hello" --to es --no-cache

# Useful for testing or when you need the latest translation
deepl translate document.md --to es --output document.es.md --no-cache
```

**Cost transparency:**

```bash
# Show actual billed character count (Pro API only)
deepl translate "Hello, world!" --to es --show-billed-characters
# Hola, mundo!
#
# Billed characters: 13

# Use with multiple languages
deepl translate "Hello" --to es,fr,de --show-billed-characters
# [es] Hola
# [fr] Bonjour
# [de] Hallo
#
# Billed characters: 15

# Useful for budget tracking and cost analysis
deepl translate document.md --to es --output document.es.md --show-billed-characters
```

**Note:** The `--show-billed-characters` feature is only available with Pro API accounts. Free API accounts will display "N/A" for character counts.

**JSON output:**

```bash
# Get machine-readable JSON output
deepl translate "Hello" --to es --format json
# {"text":"Hola","detectedSourceLang":"en","targetLang":"es","cached":false}

# JSON output may include modelTypeUsed when the API reports which model was used
deepl translate "Hello" --to es --format json --no-cache
# {"text":"Hola","detectedSourceLang":"en","targetLang":"es","modelTypeUsed":"quality_optimized"}

# Useful for scripting and automation
deepl translate "Test" --to es,fr,de --format json
```

**Table output:**

```bash
# Display translations in structured table format (multiple languages)
deepl translate "Hello, world!" --to es,fr,de --format table
# ┌──────────┬──────────────────────────────────────────────────────────────────────┐
# │ Language │ Translation                                                          │
# ├──────────┼──────────────────────────────────────────────────────────────────────┤
# │ ES       │ ¡Hola mundo!                                                         │
# │ FR       │ Bonjour le monde!                                                    │
# │ DE       │ Hallo Welt!                                                          │
# └──────────┴──────────────────────────────────────────────────────────────────────┘

# Add --show-billed-characters to display the Characters column
deepl translate "Cost tracking" --to es,fr,de --format table --show-billed-characters --no-cache
# ┌──────────┬────────────────────────────────────────────────────────────────┬────────────┐
# │ Language │ Translation                                                    │ Characters │
# ├──────────┼────────────────────────────────────────────────────────────────┼────────────┤
# │ ES       │ Seguimiento de costes                                          │ 16         │
# │ FR       │ Suivi des coûts                                                │ 16         │
# │ DE       │ Kostenverfolgung                                               │ 16         │
# └──────────┴────────────────────────────────────────────────────────────────┴────────────┘

# Long translations automatically wrap in the Translation column
deepl translate "This is a very long sentence that demonstrates word wrapping." --to es,fr --format table
# Wider Translation column (70 chars) when Characters column is not shown

# Useful for:
# - Comparing translations side-by-side across multiple languages
# - Monitoring billed characters per translation for cost transparency (with --show-billed-characters)
# - Human-readable output for reports and documentation
# - Quality assurance - spot-checking consistency across languages
```

**Notes:**

- Table format is only available when translating to multiple target languages. For single language translations, use default plain text or JSON format.
- The Characters column is only shown when using `--show-billed-characters` flag.
- Without `--show-billed-characters`, the Translation column is wider (70 characters vs 60) for better readability.
- When the API returns metadata (billed characters, model type used), it is appended below the translated text in plain text output and included as fields in JSON output.

---

### write

Improve text with DeepL Write API (grammar, style, tone enhancement).

#### Synopsis

```bash
deepl write [OPTIONS] TEXT
deepl w [OPTIONS] TEXT        # alias
```

#### Description

Enhance text quality with AI-powered grammar checking, style improvement, and tone adjustment. Supports 14 target languages.

**File Detection:** The command automatically detects if the text argument is a file path. If a file exists at that path, it operates on the file; otherwise, it treats the argument as text to improve.

#### Options

**Language:**

- `--lang, -l LANG` - Target language: `de`, `en`, `en-GB`, `en-US`, `es`, `fr`, `it`, `ja`, `ko`, `pt`, `pt-BR`, `pt-PT`, `zh`, `zh-Hans`. Optional — omit to auto-detect the language and rephrase in the original language.
- `--to LANG` - Long-only alias of `--lang`. Accepts the same language values. Provided for muscle-memory consistency with `deepl translate --to`; the short form `-t` is intentionally **not** bound here (it would collide with `deepl translate -t, --to`). Specifying both `--to` and `--lang` with different values exits with a `ValidationError`.

**Style Options (mutually exclusive with tone):**

- `--style STYLE` - Writing style:
  - `default` - No style modification (API default)
  - `simple` - Simpler, more accessible language
  - `business` - Professional business language
  - `academic` - Formal academic language
  - `casual` - Conversational, informal language
  - `prefer_simple`, `prefer_business`, etc. - Soft preferences

**Tone Options (mutually exclusive with style):**

- `--tone TONE` - Tone:
  - `default` - No tone modification (API default)
  - `enthusiastic` - More enthusiastic and positive
  - `friendly` - Warmer, more approachable
  - `confident` - More assertive and certain
  - `diplomatic` - More careful and tactful
  - `prefer_enthusiastic`, `prefer_friendly`, etc. - Soft preferences

**Supported target-language / style-and-tone combinations:**

| Target language | `--style` | `--tone` |
|-----------------|:---------:|:--------:|
| `en`, `en-GB`, `en-US`, `de` | ✓ | ✓ |
| `es`, `fr`, `it`, `pt`, `pt-BR`, `pt-PT` | ✓ | ✓ |
| `ja`, `ko`, `zh`, `zh-Hans` | — | — |

When `--style` or `--tone` is set for a target language that does not support it, the server returns a 4xx; the CLI converts that response into a `ValidationError` (exit code 6) that names the unsupported combination and points back to this table.

**Output Options:**

- `--alternatives, -a` - Show all improvement alternatives
- `--interactive, -i` - Interactive mode: choose from multiple alternatives
- `--diff, -d` - Show diff between original and improved text
- `--check` - Check if text needs improvement without modifying (exits with 0 if no changes, 8 if improvements suggested)
- `--fix` - Auto-fix files in place
- `--output, -o FILE` - Write output to file
- `--in-place` - Edit file in place
- `--backup, -b` - Create backup before fixing (use with `--fix`)
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Advanced:**

- `--no-cache` - Bypass cache for this request (always call API)

#### Supported Languages

- `de` - German
- `en` - English (generic, defaults to American English)
- `en-GB` - British English
- `en-US` - American English
- `es` - Spanish
- `fr` - French
- `it` - Italian
- `ja` - Japanese
- `ko` - Korean
- `pt` - Portuguese (generic, defaults to Brazilian Portuguese)
- `pt-BR` - Brazilian Portuguese
- `pt-PT` - European Portuguese
- `zh` - Chinese (generic, defaults to Simplified Chinese)
- `zh-Hans` - Simplified Chinese

#### Examples

**Basic improvement (auto-detect language):**

```bash
deepl write "Me and him went to store."
# → "He and I went to the store."
```

**With explicit language:**

```bash
deepl write "Me and him went to store." --lang en-US
# → "He and I went to the store."
```

**With writing style:**

```bash
# Business style
deepl write "We want to tell you about our product." --lang en-US --style business
# → "We are pleased to inform you about our product."

# Casual style
deepl write "The analysis demonstrates significant findings." --lang en-US --style casual
# → "The analysis shows some pretty big findings."
```

**With tone:**

```bash
# Confident tone
deepl write "I think this might work." --lang en-US --tone confident
# → "This will work."

# Diplomatic tone
deepl write "Your approach is wrong." --lang en-US --tone diplomatic
# → "Perhaps we could consider an alternative approach."
```

**Show alternatives:**

```bash
deepl write "This is good." --lang en-US --alternatives
```

**File operations:**

```bash
# Improve file and save to new location
deepl write document.txt --lang en-US --output improved.txt

# Edit file in place
deepl write document.txt --lang en-US --in-place

# Auto-fix with backup
deepl write document.txt --lang en-US --fix --backup
```

**Interactive mode:**

```bash
# Choose from multiple alternatives interactively
deepl write "Text to improve." --lang en-US --interactive
```

**Check mode:**

```bash
# Check if file needs improvement (exit code 8 if changes needed)
deepl write document.md --lang en-US --check
```

**Diff view:**

```bash
# Show differences between original and improved
deepl write file.txt --lang en-US --diff
```

**JSON output:**

```bash
# Get machine-readable JSON output
deepl write "This are good." --lang en-US --format json
# {"original":"This are good.","improved":"This is good.","changes":1,"language":"en-US"}
```

**Bypass cache:**

```bash
# Force a fresh API call, skipping cached results
deepl write "Improve this text." --lang en-US --no-cache
```

---

### correct

Correct spelling and grammar with the DeepL Write API, without rewording.

#### Synopsis

```bash
deepl correct [OPTIONS] TEXT
deepl c [OPTIONS] TEXT        # alias
```

#### Description

Fixes spelling and grammar only, avoiding the broader rewording that `deepl write` performs. Uses the Write API's `/v2/write/correct` endpoint. Supports the same 14 target languages as `write`.

**File Detection:** The command automatically detects if the text argument is a file path. If a file exists at that path, it operates on the file; otherwise, it treats the argument as text to correct.

#### Options

`correct` accepts the same options as `write` **except** `--style` and `--tone` (the correct endpoint does not restyle text):

**Language:**

- `--lang, -l LANG` - Target language: `de`, `en`, `en-GB`, `en-US`, `es`, `fr`, `it`, `ja`, `ko`, `pt`, `pt-BR`, `pt-PT`, `zh`, `zh-Hans`. Optional — omit to auto-detect the language and correct in the original language.
- `--to LANG` - Long-only alias of `--lang`, as on `write`.

**Output Modes:**

- `--alternatives, -a` - Show all alternative corrections
- `--output, -o FILE` - Write corrected text to file
- `--in-place` - Edit file in place (use with file input)
- `--interactive, -i` - Review the correction before accepting
- `--diff, -d` - Show diff between original and corrected text

**Fix Operations:**

- `--check` - Check if text needs correction (exit 0 if clean, exit 8 if corrections needed)
- `--fix` - Automatically fix file in place
- `--backup, -b` - Create backup file before fixing (use with `--fix`)

**Advanced:**

- `--no-cache` - Bypass cache for this request
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

#### Examples

**Basic correction:**

```bash
deepl correct "This is an test."
# This is a test.

# Using the alias
deepl c "Their going too the store."
```

**Grammar gate in CI (exit code 8 if corrections needed):**

```bash
deepl correct README.md --check
```

**Fix a file in place with a backup:**

```bash
deepl correct essay.md --fix --backup
```

**Diff view:**

```bash
deepl correct document.txt --diff
```

**Pipe via stdin:**

```bash
cat notes.txt | deepl correct
```

**JSON output:**

```bash
deepl correct "Their going too the store." --format json
# {"original":"Their going too the store.","improved":"They're going to the store.","changes":1,"language":"auto-detected"}
```

---

### voice

Translate audio using the DeepL Voice API with real-time WebSocket streaming.

#### Synopsis

```
deepl voice [options] <file>
```

#### Arguments

| Argument | Description                                 |
| -------- | ------------------------------------------- |
| `file`   | Audio file to translate. Use `-` for stdin. |

#### Options

| Option                          | Short | Description                                                                                    | Default   |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------- | --------- |
| `--to <languages>`              | `-t`  | Target language(s), comma-separated, max 5 (required)                                          | -         |
| `--from <language>`             | `-f`  | Source language (auto-detect if not specified)                                                 | auto      |
| `--formality <level>`           |       | Formality level: `default`, `formal`, `more`, `informal`, `less`, `prefer_more`, `prefer_less` | `default` |
| `--glossary <name-or-id>`       |       | Use glossary by name or ID                                                                     | -         |
| `--content-type <type>`         |       | Audio content type (auto-detected from file extension)                                         | auto      |
| `--chunk-size <bytes>`          |       | Audio chunk size in bytes                                                                      | `6400`    |
| `--chunk-interval <ms>`         |       | Interval between audio chunks in milliseconds                                                  | `200`     |
| `--no-stream`                   |       | Disable live streaming output, collect and print at end                                        | -         |
| `--no-reconnect`                |       | Disable automatic reconnection on WebSocket drop                                               | -         |
| `--max-reconnect-attempts <n>`  |       | Maximum reconnect attempts on WebSocket drop                                                   | `3`       |
| `--source-language-mode <mode>` |       | Source language detection mode: `auto`, `fixed`                                                | -         |
| `--format <format>`             |       | Output format: `text`, `json`                                                                  | `text`    |

> **Note:** All formality values (`default`, `formal`, `informal`, `more`, `less`, `prefer_more`, `prefer_less`) are accepted. The voice API natively uses `formal`/`informal` (in addition to `more`/`less`), while the translate API uses `prefer_more`/`prefer_less`.

#### Supported Audio Formats

| Extension       | Content Type                          |
| --------------- | ------------------------------------- |
| `.ogg`, `.opus` | `audio/opus;container=ogg`            |
| `.webm`         | `audio/opus;container=webm`           |
| `.mka`          | `audio/opus;container=matroska`       |
| `.flac`         | `audio/flac`                          |
| `.mp3`          | `audio/mpeg`                          |
| `.pcm`, `.raw`  | `audio/pcm;encoding=s16le;rate=16000` |

#### Examples

```bash
# Basic audio translation
deepl voice recording.ogg --to de

# Multiple target languages
deepl voice meeting.mp3 --to de,fr,es

# With source language and formality
deepl voice audio.flac --to ja --from en --formality more

# Pipe from ffmpeg
ffmpeg -i video.mp4 -f ogg - | deepl voice - --to es --content-type 'audio/opus;container=ogg'

# Pipe raw PCM from stdin
cat audio.pcm | deepl voice - --to es --content-type 'audio/pcm;encoding=s16le;rate=16000'

# JSON output for scripting
deepl voice speech.ogg --to de --format json | jq .targets[0].text

# Disable live streaming
deepl voice speech.ogg --to de --no-stream
```

#### JSON Output Format

```json
{
  "sessionId": "session-abc123",
  "source": {
    "lang": "en",
    "text": "Hello world",
    "segments": [{ "text": "Hello world", "startTime": 0, "endTime": 1.5 }]
  },
  "targets": [
    {
      "lang": "de",
      "text": "Hallo Welt",
      "segments": [{ "text": "Hallo Welt", "startTime": 0, "endTime": 1.5 }]
    }
  ]
}
```

#### Notes

- The Voice API requires a DeepL Pro or Enterprise plan.
- Maximum 5 target languages per session.
- Maximum audio chunk size: 100KB, recommended pacing: 200ms between chunks.
- Sessions have a 30-second inactivity timeout and 1-hour maximum duration.
- The Voice API uses the same endpoint resolution as other commands: `:fx` keys use `api-free.deepl.com`, others use `api.deepl.com`, and custom regional URLs are always honored.

---

### watch

Watch files or directories for changes and auto-translate.

#### Synopsis

```bash
deepl watch [OPTIONS] PATH
```

#### Description

Monitor files or directories for changes and automatically translate them. Supports debouncing, glob patterns, and multiple target languages.

**Behavior:**

- Runs continuously until interrupted (Ctrl+C)
- Shows translation statistics on exit
- Detects file changes using filesystem watch
- Debounces rapid changes to avoid duplicate translations

#### Options

**Watch Options:**

- `--to, -t LANGS` - Target language(s), comma-separated (uses configured `defaults.targetLangs` if omitted)
- `--output, -o DIR` - Output directory (default: `<path>/translations` for directories, same dir for files)
- `--pattern GLOB` - File pattern filter (e.g., `*.md`, `**/*.json`)
- `--debounce MS` - Debounce delay in milliseconds (default: 500)
- `--concurrency NUM` - Maximum parallel translations (default: 5)

**Translation Options:**

- `--from, -f LANG` - Source language (auto-detect if omitted)
- `--formality LEVEL` - Formality level: `default`, `more`, `less`, `prefer_more`, `prefer_less`, `formal`, `informal`
- `--preserve-code` - Preserve code blocks
- `--preserve-formatting` - Preserve line breaks and whitespace formatting
- `--glossary NAME-OR-ID` - Use glossary by name or ID for consistent terminology

**Git Integration:**

- `--auto-commit` - Auto-commit translations to git after each change
- `--git-staged` - Only watch git-staged files (snapshot taken once at startup)
- `--dry-run` - Show what would be watched without starting the watcher

#### Examples

**Watch single file:**

```bash
# Basic watching
deepl watch README.md --to es

# With custom output
deepl watch README.md --to es,fr --output translations/

# With options
deepl watch tutorial.md --to es --preserve-code --formality more
```

**Watch directory:**

```bash
# Watch all supported files
deepl watch docs/ --to es

# Watch with pattern
deepl watch docs/ --to es,fr --pattern "*.md"

# With custom debounce (wait 1 second after changes)
deepl watch docs/ --to es --debounce 1000
```

**With auto-commit:**

```bash
# Automatically commit translations
deepl watch docs/ --to es --auto-commit
```

**With git-staged filtering:**

```bash
# Only translate files currently staged in git
deepl watch . --to es --git-staged

# Combine with dry-run to preview staged files
deepl watch . --to es,fr --git-staged --dry-run

# Pre-commit workflow: stage files, then watch only those
git add docs/guide.md docs/faq.md
deepl watch docs/ --to de,ja --git-staged --auto-commit
```

> **Note:** `--git-staged` takes a one-time snapshot of staged files at startup. Files staged after the watcher starts are not included. Requires a git repository — exits with an error otherwise.

---

### sync

Continuous localization engine for i18n file translation.

#### Synopsis

```bash
deepl sync [OPTIONS]
deepl sync init [OPTIONS]
deepl sync status [OPTIONS]
deepl sync validate [OPTIONS]
deepl sync audit [OPTIONS]
deepl sync export [OPTIONS]
deepl sync resolve [OPTIONS]
deepl sync push [OPTIONS]
deepl sync pull [OPTIONS]
```

#### Description

Scan, translate, and sync i18n resource files. The sync engine reads `.deepl-sync.yaml` for project configuration, diffs source strings against `.deepl-sync.lock` to detect changes, translates only new and modified strings via the DeepL API, and writes properly formatted target files.

**Supported formats:** JSON, YAML, TOML, Gettext PO, Android XML, iOS Strings, Xcode String Catalog (.xcstrings), ARB, XLIFF, Java Properties, Laravel PHP arrays (.php).

**Behavior:**

- Reads configuration from `.deepl-sync.yaml` in the current directory
- Tracks translation state in `.deepl-sync.lock` for incremental sync
- Preserves format-specific structure (indentation, comments, metadata)
- Displays per-locale progress as each translation completes
- Exits with code [10](#exit-codes) when `--frozen` detects translation drift
- Bounds `context.scan_paths` at `sync.max_scan_files` files (default 50,000) to prevent a misconfigured glob from wedging the CLI on huge source trees. Exceeding the cap throws a `ValidationError` with a suggestion to narrow the pattern or raise the cap; see [docs/SYNC.md](SYNC.md#sync).

#### Options

**Sync Mode:**

- `--dry-run` - Preview changes without translating
- `--frozen` - Fail (exit 10) if translations are missing or outdated; no API calls
- `--ci` - Alias for `--frozen`
- `--force` - Re-translate all strings, ignoring the lockfile. **WARNING:** also bypasses the `sync.max_characters` cost-cap preflight in `.deepl-sync.yaml`, so a forced run can re-bill every translated key and incur unexpected API costs. Run `deepl sync --dry-run` first to see the character estimate before forcing.

  **Billing safety guards:**

  - `--watch --force` is rejected at startup with a `ValidationError` (exit 6) to prevent unbounded billing from a forced re-translation on every file save.
  - In an interactive terminal, `--force` prompts for confirmation before bypassing the cost cap. Pass `--yes` (`-y`) to skip the prompt in scripts.
  - In CI environments (`CI=true`), `--force` requires an explicit `--yes`; otherwise the process exits 6 with an actionable hint naming the missing flag.

- `--yes, -y` - Skip the `--force` confirmation prompt (required when `CI=true`)

**Filtering:**

- `--locale LANGS` - Sync only specific target locales (comma-separated). **Note the split:** `sync --locale` is a *filter* over locales already declared in `.deepl-sync.yaml#target_locales` — it narrows which configured targets a run acts on. `deepl translate --to` is an *invocation-time specifier* — it names the target languages for a one-shot text translation. The sync engine owns the locale mapping via `.deepl-sync.yaml`; `translate` does not. A locale not in `target_locales` passed to `sync --locale` exits with a `ConfigError`; an unrecognized code passed to `translate --to` exits with `InvalidInput`.

**Translation Quality:**

- `--formality LEVEL` - Override formality: `default`, `more`, `less`, `prefer_more`, `prefer_less`, `formal`, `informal`
- `--model-type TYPE` - Override model type: `quality_optimized`, `prefer_quality_optimized`, `latency_optimized`
- `--glossary NAME-OR-ID` - Override glossary name or ID
- `--scan-context` / `--no-scan-context` - Enable or disable source-code context scanning. Matches both string literal and template literal `t()` calls. When enabled, key paths are parsed into natural-language context descriptions, and HTML element types are detected from surrounding source code. Element types feed into `instruction_templates` (configured in `.deepl-sync.yaml`) for auto-generated `custom_instructions`. **Scope:** these flags override `context.enabled` in `.deepl-sync.yaml` only; all other `context.*` settings (`include`, `exclude`, `max_files`, etc.) continue to apply when scanning is enabled. **Note:** bare `--context` / `--no-context` on `deepl sync` is rejected with a ValidationError (exit 6) — the string-valued `--context "<text>"` flag only applies to `deepl translate`; sync's boolean toggle was renamed to `--scan-context` to avoid the collision.

**Note:** `deepl sync` deliberately exposes no `--translation-memory` / `--tm-threshold` CLI override; configure translation memory via `translation.translation_memory` (and optional `translation.translation_memory_threshold`) in `.deepl-sync.yaml`, with per-locale overrides under `translation.locale_overrides`.

**Performance:**

- `--concurrency NUM` - Max parallel locale translations (default: 5)
- `--batch` - Force plain batch mode (fastest, no context or instructions). All keys in batch API calls.
- `--no-batch` - Force per-key mode (slowest, individual context per key). Default: section-batched context (~3.4x faster than per-key while preserving disambiguation context).

**Git:**

- `--auto-commit` - Auto-commit translated files after sync (requires git)

**Review:**

- `--flag-for-review` - Mark translations as `machine_translated` in lock file for human review

**Watch:**

- `--watch` - Watch source files and auto-sync on changes
- `--debounce MS` - Debounce delay for watch mode (default: 500ms)

**Output:**

- `--format FORMAT` - Output format: `text` (default), `json`

**Config:**

- `--sync-config PATH` - Path to `.deepl-sync.yaml` (default: auto-detect)

#### Subcommands

##### `init`

Interactive setup wizard that creates `.deepl-sync.yaml` by scanning the project for i18n files.

**Auto-detected project types:** i18next / react-intl / vue-i18n / next-intl (JSON under `locales/` or `i18n/`), Rails (`config/locales/en.yml`), generic YAML i18n, Django / generic gettext (`locale/*/LC_MESSAGES/*.po`), Android (`res/values/strings.xml`), iOS / macOS (`*.lproj/Localizable.strings`), Xcode String Catalog (`Localizable.xcstrings` / `*.xcstrings`), Flutter (`pubspec.yaml` + `l10n/app_en.arb` or `*_en.arb`), Angular / CAT tools (XLIFF under `src/locale/` or root), go-i18n (`locales/en.toml` or `i18n/en.toml`), Java / Spring (`src/main/resources/messages_en.properties`), and Laravel (`composer.json` + `lang/en/*.php` or `resources/lang/en/*.php`). Detection is filesystem-only — no package manifests are parsed. See [docs/SYNC.md](./SYNC.md#deepl-sync-init) for the full detection matrix. Layouts outside these conventions need the four flags above.

**Options:**

- `--source-locale CODE` - Source locale code
- `--target-locales CODES` - Target locales (comma-separated)
- `--file-format TYPE` - File format: `json`, `yaml`, `toml`, `po`, `android_xml`, `ios_strings`, `xcstrings`, `arb`, `xliff`, `properties`, `laravel_php`
- `--path GLOB` - Source file path or glob pattern
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

`--source-lang` and `--target-langs` were accepted as deprecated aliases during `1.x` and were removed in `2.0.0`; use `--source-locale` / `--target-locales`. `deepl translate --target-lang` is unchanged — it operates on strings and stays aligned with the DeepL API's wire name.

**Examples:**

```bash
# Interactive auto-detection
deepl sync init

# Non-interactive
deepl sync init --source-locale en --target-locales de,fr,es --file-format json --path "locales/en.json"
```

##### `status`

Show translation coverage for all target locales.

**Options:**

- `--locale LANGS` - Show status for specific locales only
- `--format FORMAT` - Output format: `text` (default), `json`
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

**JSON output contract (stable within a major version):**

```json
{
  "sourceLocale": "en",
  "totalKeys": 142,
  "skippedKeys": 1,
  "locales": [
    { "locale": "de", "complete": 140, "missing": 2, "outdated": 0, "coverage": 98 }
  ]
}
```

`skippedKeys` counts entries the parser tagged as untranslatable and excluded from the translation batch — currently only Laravel pipe-pluralization values (`|{n}`, `|[n,m]`, `|[n,*]`). Included in `totalKeys`.

**stdout/stderr split (stable contract):** The success JSON payload is written to **stdout**, so `deepl sync status --format json > status.json` produces a parseable file. Diagnostic/progress logs stay on **stderr**. The same stdout/stderr split applies to `deepl sync --format json`, `deepl sync validate --format json`, and `deepl sync audit --format json`.

**Error envelope (shared across every `sync` subcommand):** On failure, `--format json` emits the following JSON envelope to **stderr** and exits with the typed exit code:

```json
{
  "ok": false,
  "error": {
    "code": "ConfigError",
    "message": ".deepl-sync.yaml not found in current directory or any parent",
    "suggestion": "Run `deepl sync init` to create one."
  },
  "exitCode": 7
}
```

The `error.code` field matches the error class name (`ConfigError`, `ValidationError`, `SyncConflict`, `AuthError`, etc.). `error.suggestion` is present when the underlying `DeepLCLIError` carries one. `exitCode` matches the process exit code, so a caller can branch on either field. The envelope shape is identical for `deepl sync`, `sync push`, `sync pull`, `sync resolve`, `sync export`, `sync validate`, `sync audit`, `sync init`, and `sync status`.

**`sync init --format json` success envelope:** For scripted project bootstrap, `deepl sync init --format json` emits a success envelope on **stdout** instead of the plain text confirmation:

```json
{
  "ok": true,
  "created": {
    "configPath": "/absolute/path/.deepl-sync.yaml",
    "sourceLocale": "en",
    "targetLocales": ["de", "fr"],
    "keys": 128
  }
}
```

**Casing convention:** CLI JSON output uses `camelCase`; the on-disk `.deepl-sync.lock` and `.deepl-sync.yaml` use `snake_case`. The two are deliberately kept separate — JSON output is a consumer contract; the files are authored configuration.

**Examples:**

```bash
deepl sync status

# JSON output
deepl sync status --format json
```

**Sample output:**

```
Source: en (142 keys)

  de  [###################.]  98%  (2 missing, 0 outdated)
  fr  [####################]  100%  (0 missing, 0 outdated)
  es  [###################.]  97%  (4 missing, 0 outdated)
  ja  [##################..]  91%  (12 missing, 0 outdated)
```

##### `validate`

Check translations for placeholder integrity and format consistency.

**Options:**

- `--locale LANGS` - Validate specific locales only
- `--format FORMAT` - Output format: `text` (default), `json`
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

**Examples:**

```bash
deepl sync validate

# Validate only German
deepl sync validate --locale de
```

**Sample output:**

```
Validation Results:

  de:
    ✓ 138/140 strings valid
    ✗ 2 issues found:
      - messages.welcome: placeholder {name} missing in translation
      - errors.count: format specifier %d replaced with %s

  fr:
    ✓ 142/142 strings valid
```

##### `audit`

Analyze translation consistency and detect terminology inconsistencies across target locales. "Audit" here means translation-consistency audit (detecting term divergence across locales), not security audit in the `npm audit` sense.

**Options:**

- `--format FORMAT` - Output format: `text` (default), `json`
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

**Note:** Prior to the 1.1.0 release, this subcommand was prototyped as `glossary-report`; it never shipped in a tagged release under that name. The old name is rejected with an error pointing at the new form; no alias is kept.

**JSON output sample:**

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

The `translations` array contains the actual translated strings read from target files. If a target file is missing, the content hash falls back in its place.

##### `export`

Export source strings to XLIFF 1.2 for CAT tool handoff.

**Options:**

- `--locale LANGS` - Filter by locale (comma-separated)
- `--output PATH` - Write to file instead of stdout. Path must stay within the project root; intermediate directories are created automatically
- `--overwrite` - Required to overwrite an existing `--output` file. Without it, an existing file causes a non-zero exit and no write occurs
- `--format FORMAT` - Output format: `text` (default), `json`. Success output is always XLIFF 1.2 regardless of format; `json` affects the **error** envelope on stderr (matching other sync subcommands) so script consumers can parse failure shape uniformly
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

**Examples:**

```bash
# Print XLIFF to stdout (pipe to CAT tool, clipboard, etc.)
deepl sync export

# Write to a file (creates reports/ if needed)
deepl sync export --output reports/handoff.xlf

# Overwrite an existing file
deepl sync export --output reports/handoff.xlf --overwrite

# Rejected: path escapes the project root
deepl sync export --output ../elsewhere.xlf
```

##### `resolve`

Resolve git merge conflicts in `.deepl-sync.lock`.

**Options:**

- `--format FORMAT` - Output format: `text` (default), `json`
- `--dry-run` - Preview conflict decisions without writing the lockfile
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

**JSON success envelope (stable within a major version):** `{ "ok": true, "resolved": <n>, "decisions": [...] }`

##### `push`

Push local translations to a TMS for human review.

**Options:**

- `--locale LANGS` - Push specific locales only
- `--format FORMAT` - Output format: `text` (default), `json`
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

**Requires TMS integration.** Add a `tms:` block to `.deepl-sync.yaml` (at minimum `enabled: true`, `server`, `project_id`) and supply credentials via the `TMS_API_KEY` or `TMS_TOKEN` environment variable. Running `push` without a configured `tms:` block exits 7 (ConfigError). See [docs/SYNC.md#tms-rest-contract](./SYNC.md#tms-rest-contract) for the full field reference and REST contract.

**JSON success envelope (stable within a major version):** `{ "ok": true, "pushed": <n>, "skipped": [...] }`

##### `pull`

Pull approved translations from a TMS back into local files.

**Options:**

- `--locale LANGS` - Pull specific locales only
- `--format FORMAT` - Output format: `text` (default), `json`
- `--sync-config PATH` - Path to `.deepl-sync.yaml`

**Requires TMS integration.** Add a `tms:` block to `.deepl-sync.yaml` (at minimum `enabled: true`, `server`, `project_id`) and supply credentials via the `TMS_API_KEY` or `TMS_TOKEN` environment variable. Running `pull` without a configured `tms:` block exits 7 (ConfigError). See [docs/SYNC.md#tms-rest-contract](./SYNC.md#tms-rest-contract) for the full field reference and REST contract.

**JSON success envelope (stable within a major version):** `{ "ok": true, "pulled": <n>, "skipped": [...] }`

#### Examples

**Basic sync:**

```bash
# Sync all configured locales
deepl sync

# Preview what would be translated
deepl sync --dry-run
```

**CI/CD (frozen mode):**

```bash
# Fail if translations are out of date (exit code 10)
deepl sync --frozen
```

**Locale filtering:**

```bash
# Sync only German and French
deepl sync --locale de,fr
```

**Force re-translation:**

```bash
# Re-translate everything, ignoring the lockfile
deepl sync --force
```

**JSON output for scripting:**

```bash
deepl sync --format json
deepl sync status --format json
```

**`deepl sync --format json` output contract (stable within a major version):**

The success payload is written to **stdout** as a single JSON object. The following fields are guaranteed stable and will not be renamed or removed within the same major version:

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` if the sync completed without errors |
| `totalKeys` | `number` | Total translation keys discovered across all source files |
| `translated` | `number` | Keys translated during this run (summed across all locales) |
| `skipped` | `number` | Keys skipped (already up-to-date, summed across all locales) |
| `failed` | `number` | Keys that could not be translated (summed across all locales) |
| `targetLocaleCount` | `number` | Number of target locales processed |
| `estimatedCharacters` | `number` | Characters estimated for billing this run |
| `estimatedCost` | `string \| undefined` | Human-readable cost estimate at Pro rate (e.g. `~$0.05`), omitted when zero |
| `rateAssumption` | `"pro"` | Always `"pro"` — cost estimate uses the DeepL Pro per-character rate |
| `dryRun` | `boolean` | `true` when `--dry-run` was passed; no translations were written |
| `perLocale` | `Array<{locale, translated, skipped, failed}>` | Per-locale breakdown; each entry aggregates all files for that locale |

No other fields appear in the output. Fields not listed above are internal and may change without notice.

#### Notes

- The `--frozen` flag makes no API calls. It compares the lockfile against source files and exits with code 10 if any translations are missing or outdated. This is the recommended mode for CI/CD pipelines.
- The lockfile (`.deepl-sync.lock`) should be committed to version control. It enables incremental sync by tracking content hashes.
- The `push` and `pull` subcommands require a TMS that implements the REST contract documented in [docs/SYNC.md](./SYNC.md#tms-rest-contract). All other commands work with the standard DeepL Translation API.
- By default, keys with extracted context are grouped by i18n section and translated in section batches. Use `--no-batch` to force individual per-key context translation. Use `--batch` to force all keys into plain batch calls (no context).
- See [docs/SYNC.md](./SYNC.md) for the complete sync guide including configuration schema, CI/CD recipes, and troubleshooting.

---

### hooks

Manage git hooks for translation workflow automation.

#### Synopsis

```bash
deepl hooks <SUBCOMMAND>
```

#### Description

Install, uninstall, and manage git hooks that validate translations before committing or pushing.

#### Subcommands

##### `install <hook-type>`

Install a git hook.

**Arguments:**

- `hook-type` - Hook type: `pre-commit`, `pre-push`, `commit-msg`, `post-commit`

**Examples:**

```bash
deepl hooks install pre-commit
deepl hooks install pre-push
deepl hooks install commit-msg
deepl hooks install post-commit
```

##### `uninstall <hook-type>`

Uninstall a git hook.

**Examples:**

```bash
deepl hooks uninstall pre-commit
deepl hooks uninstall pre-push
deepl hooks uninstall commit-msg
deepl hooks uninstall post-commit
```

##### `list`

List all hooks and their installation status.

**Options:**

- `--format <format>` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
deepl hooks list

# JSON output for CI/CD scripting
deepl hooks list --format json
# { "pre-commit": true, "pre-push": false, "commit-msg": false, "post-commit": false }
```

##### `path <hook-type>`

Show the path to a hook file.

**Examples:**

```bash
deepl hooks path pre-commit
```

---

### glossary

Manage translation glossaries using the DeepL v3 Glossary API.

The v3 API supports both **single-target glossaries** (one source → one target language) and **multilingual glossaries** (one source → multiple target languages).

#### Synopsis

```bash
deepl glossary <SUBCOMMAND>
```

#### Subcommands

##### `create <name> <source-lang> <target-lang> <file>`

Create a new glossary from a TSV or CSV file.

**Arguments:**

- `name` - Glossary name
- `source-lang` - Source language code (e.g., `en`, `de`, `fr`)
- `target-lang` - Target language code, comma-separated for multiple (e.g., `es`, `de,fr,es`)
- `file` - Path to TSV or CSV file with term pairs

**File Format:**

- **TSV** (Tab-Separated Values): `source_term<TAB>target_term`
- **CSV** (Comma-Separated Values): `source_term,target_term`
- One term pair per line
- No header row required

**Example file (glossary.tsv):**

```
API	API
authentication	autenticación
cache	caché
```

**Examples:**

```bash
# Create single-target glossary from TSV file
deepl glossary create tech-terms en es glossary.tsv
# ✓ Glossary created: tech-terms (ID: abc123...)
# Source language: EN
# Target languages: ES
# Type: Single target
# Total entries: 3

# Create multilingual glossary with comma-separated target languages
deepl glossary create tech-terms en de,fr,es glossary.tsv

# Create glossary from CSV file
deepl glossary create product-names en fr terms.csv
```

##### `list`

List all glossaries with their IDs, language pairs, and entry counts.

**Options:**

- `--format <format>` - Output format: `text`, `json` (default: `text`)

**Output Format (text):**

- Single-target glossaries: `📖 name (source→target) - N entries`
- Multilingual glossaries: `📚 name (source→N targets) - N entries`

**Example:**

```bash
deepl glossary list
# 📖 tech-terms (en→de) - 3 entries
# 📚 multilingual-terms (en→3 targets) - 15 entries

# JSON output for CI/CD scripting
deepl glossary list --format json
# [{ "glossary_id": "abc123...", "name": "tech-terms", ... }]
```

##### `show <name-or-id>`

Show glossary details including name, ID, languages, creation date, and entry count.

**Options:**

- `--format <format>` - Output format: `text`, `json` (default: `text`)

**Output includes:**

- Name and ID
- Source language
- Target languages (comma-separated for multilingual glossaries)
- Type (Single target or Multilingual)
- Total entry count
- Language pairs (for multilingual glossaries)
- Creation timestamp

**Example:**

```bash
deepl glossary show tech-terms
# Name: tech-terms
# ID: abc123...
# Source language: EN
# Target languages: DE
# Type: Single target
# Total entries: 3
# Created: 2024-10-07T12:34:56.000Z

# Multilingual glossary example
deepl glossary show multilingual-terms
# Name: multilingual-terms
# ID: def456...
# Source language: EN
# Target languages: ES, FR, DE
# Type: Multilingual
# Total entries: 15
#
# Language pairs:
#   EN → ES: 5 entries
#   EN → FR: 5 entries
#   EN → DE: 5 entries
# Created: 2024-10-08T10:00:00.000Z
```

##### `delete <name-or-id>`

Delete a glossary by name or ID.

**Options:**

- `-y, --yes` - Skip confirmation prompt
- `--dry-run` - Show what would be deleted without performing the operation

**Example:**

```bash
deepl glossary delete tech-terms
deepl glossary delete abc-123-def-456
deepl glossary delete tech-terms --dry-run
```

##### `entries <name-or-id> [--target-lang <lang>]`

Get glossary entries in TSV format (suitable for backup or editing).

**Arguments:**

- `name-or-id` - Glossary name or ID

**Options:**

- `--target-lang <lang>` - Target language (required for multilingual glossaries, optional for single-target)
- `--format <format>` - Output format: `text`, `json` (default: `text`)

**Behavior:**

- For **single-target glossaries**: `--target-lang` flag is optional (automatically uses the single target language)
- For **multilingual glossaries**: `--target-lang` flag is required to specify which language pair to retrieve

**Example:**

```bash
# Single-target glossary (no --target-lang needed)
deepl glossary entries tech-terms > backup.tsv

# View entries
deepl glossary entries tech-terms
# API → API
# REST → REST
# authentication → Authentifizierung

# Multilingual glossary (--target-lang required)
deepl glossary entries multilingual-terms --target-lang es
# API → API
# cache → caché
# ...

deepl glossary entries multilingual-terms --target-lang fr
# API → API
# cache → cache
# ...
```

##### `languages`

List all supported glossary language pairs.

**Description:**
Shows which source-target language combinations are available for glossary creation. Not all language pairs supported by DeepL translation are available for glossaries.

**Example:**

```bash
deepl glossary languages
# en → de
# en → es
# en → fr
# de → en
# ...
```

##### `add-entry <name-or-id> <source> <target> [--target-lang <lang>]`

Add a new entry to an existing glossary.

**Arguments:**

- `name-or-id` - Glossary name or ID
- `source` - Source language term
- `target` - Target language translation

**Options:**

- `--target-lang <lang>` - Target language (required for multilingual glossaries, optional for single-target)

**Behavior:**

- Uses v3 PATCH endpoint for efficient updates (no delete+recreate)
- Glossary ID remains unchanged
- Preserves all other entries
- Fails if entry already exists

**Examples:**

```bash
# Add entry to single-target glossary
deepl glossary add-entry tech-terms "database" "Datenbank"

# Add entry to multilingual glossary (--target-lang required)
deepl glossary add-entry multilingual-terms "cache" "caché" --target-lang es
deepl glossary add-entry multilingual-terms "cache" "cache" --target-lang fr

# Add phrase
deepl glossary add-entry tech-terms "user interface" "Schnittstelle"
```

**Note:** v3 API uses PATCH for efficient updates. The glossary ID remains unchanged.

##### `update-entry <name-or-id> <source> <new-target> [--target-lang <lang>]`

Update an existing entry in a glossary.

**Arguments:**

- `name-or-id` - Glossary name or ID
- `source` - Source language term to update
- `new-target` - New target language translation

**Options:**

- `--target-lang <lang>` - Target language (required for multilingual glossaries, optional for single-target)

**Behavior:**

- Updates existing entry's target text using v3 PATCH endpoint
- Glossary ID remains unchanged
- Fails if entry doesn't exist

**Examples:**

```bash
# Update entry in single-target glossary
deepl glossary update-entry tech-terms "API" "API (Programmierschnittstelle)"

# Update entry in multilingual glossary (--target-lang required)
deepl glossary update-entry multilingual-terms "API" "API (Interfaz)" --target-lang es
deepl glossary update-entry multilingual-terms "API" "API (Interface)" --target-lang fr
```

**Note:** v3 API uses PATCH for efficient updates. The glossary ID remains unchanged.

##### `remove-entry <name-or-id> <source> [--target-lang <lang>]`

Remove an entry from a glossary.

**Arguments:**

- `name-or-id` - Glossary name or ID
- `source` - Source language term to remove

**Options:**

- `--target-lang <lang>` - Target language (required for multilingual glossaries, optional for single-target)

**Behavior:**

- Removes entry from glossary using v3 PATCH endpoint
- Glossary ID remains unchanged
- Fails if entry doesn't exist
- Fails if removing the last entry (delete glossary instead)

**Examples:**

```bash
# Remove entry from single-target glossary
deepl glossary remove-entry tech-terms "obsolete-term"

# Remove entry from multilingual glossary (--target-lang required)
deepl glossary remove-entry multilingual-terms "deprecated" --target-lang es
```

**Note:** You cannot remove the last entry from a glossary. If you need to remove all entries, use `deepl glossary delete` instead.

##### `rename <name-or-id> <new-name>`

Rename a glossary.

**Arguments:**

- `name-or-id` - Glossary name or ID
- `new-name` - New name for the glossary

**Behavior:**

- Changes glossary name using v3 PATCH endpoint
- Glossary ID remains unchanged
- Preserves all entries and language pairs
- Fails if new name matches current name

**Examples:**

```bash
# Rename by glossary name
deepl glossary rename tech-terms "Technical Terminology v2"

# Rename by glossary ID
deepl glossary rename abc-123-def-456 "Product Names 2024"
```

**Note:** v3 API uses PATCH for efficient rename. The glossary ID remains unchanged and all entries are preserved.

##### `update <name-or-id> [--name <name>] [--target-lang <lang>] [--file <path>]`

Update a glossary's name and/or dictionary entries in a single request.

**Arguments:**

- `name-or-id` - Glossary name or ID

**Options:**

- `--name <name>` - New glossary name
- `--target-lang <lang>` - Target language for dictionary update (required when using `--file`)
- `--file <path>` - TSV/CSV file with entries for dictionary update

**Behavior:**

- At least one of `--name` or `--file` (with `--target-lang`) must be provided
- When both `--name` and `--file` are given, the rename and dictionary update happen in a single PATCH request
- `--target-lang` is required when `--file` is specified
- Uses v3 PATCH endpoint for efficient updates
- Glossary ID remains unchanged

**Examples:**

```bash
# Rename only
deepl glossary update my-terms --name "Updated Terms"

# Update dictionary entries only
deepl glossary update my-terms --target-lang de --file updated.tsv

# Rename and update dictionary in one request
deepl glossary update my-terms --name new-name --target-lang de --file updated.tsv
```

##### `replace-dictionary <name-or-id> <target-lang> <file>`

Replace all entries in a glossary dictionary from a TSV/CSV file (v3 API only). Unlike updating individual entries (which merges), this replaces the entire dictionary contents.

**Arguments:**

- `name-or-id` - Glossary name or ID
- `target-lang` - Target language of the dictionary to replace (e.g., `es`, `fr`, `de`)
- `file` - TSV/CSV file path with replacement entries

**Examples:**

```bash
# Replace all Spanish entries from a new file
deepl glossary replace-dictionary my-glossary es new-entries.tsv
# ✓ Dictionary replaced successfully (es)

# Replace by glossary ID
deepl glossary replace-dictionary abc-123-def-456 fr updated-fr.tsv
```

**Notes:**

- Replaces the entire dictionary via the v3 PUT endpoint (not a merge)
- All existing entries for the specified language pair are removed and replaced with the file contents
- The file format is the same as for `glossary create` (TSV or CSV)

---

##### `delete-dictionary <name-or-id> <target-lang>`

Delete a specific language pair from a multilingual glossary (v3 API only).

**Arguments:**

- `name-or-id` - Glossary name or ID
- `target-lang` - Target language of the dictionary to delete (e.g., `es`, `fr`, `de`)

**Options:**

- `-y, --yes` - Skip confirmation prompt

**Behavior:**

- Removes a specific language pair from a multilingual glossary using v3 DELETE endpoint
- Glossary ID remains unchanged
- Other language pairs in the glossary are preserved
- Fails if glossary is single-target (use `glossary delete` instead)
- Fails if this would be the last dictionary in the glossary (use `glossary delete` instead)
- Fails if the dictionary doesn't exist in the glossary

**Examples:**

```bash
# Delete Spanish dictionary from multilingual glossary
deepl glossary delete-dictionary multilingual-terms es
# ✓ Dictionary deleted successfully (es)
# Other language pairs (fr, de) remain intact

# Delete by glossary ID
deepl glossary delete-dictionary abc-123-def-456 fr
# ✓ Dictionary deleted successfully (fr)
```

**Notes:**

- **Multilingual glossaries only**: This command only works with multilingual glossaries that have multiple target languages. For single-target glossaries, use `deepl glossary delete` to remove the entire glossary.
- **Preserves glossary**: Unlike `glossary delete`, this command preserves the glossary and only removes one language pair.
- **Cannot delete last dictionary**: If the glossary would have zero dictionaries after deletion, the command fails. Use `glossary delete` to remove the entire glossary instead.

---

### tm

Manage translation memories. TM files are authored and uploaded via the DeepL web UI; this command surfaces the account's TMs so you can copy a name or UUID into a translate or sync invocation without leaving the terminal.

#### Synopsis

```bash
deepl tm list [options]
```

#### Subcommands

##### `list`

List all translation memories on the account.

**Options:**

- `--format <format>` - Output format: `text`, `json` (default: `text`)

**Output Format (text):**

- Per-TM: `name (source → target[, target...])` — e.g. `brand-terms (EN → DE, FR, JA)`. Control chars and zero-width codepoints are stripped from the rendered name to prevent a malicious API-returned name from corrupting the terminal via ANSI escape sequences.
- Empty list: `No translation memories found`

**Output Format (JSON):**

Raw `TranslationMemory[]` as returned by `GET /v3/translation_memories` — fields: `translation_memory_id`, `name`, `source_language`, `target_languages` (array).

**Example:**

```bash
deepl tm list
# brand-terms (EN → DE, FR, JA)
# legal-phrases (EN → FR)

deepl tm list --format json | jq '.[] | select(.name == "brand-terms") | .translation_memory_id'
# "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
```

**Related:**

- `deepl translate --translation-memory <name-or-uuid>` — use a listed TM on a single translate call.
- `.deepl-sync.yaml` `translation.translation_memory` — configure a TM for a sync run (see [sync](#sync)).

---

### cache

Manage translation cache.

#### Synopsis

```bash
deepl cache <SUBCOMMAND>
```

#### Subcommands

##### `stats`

Show cache statistics (status, entries count, size, percentage used).

**Options:**

- `--format <format>` - Output format: `text`, `json`, `table` (default: `text`). In non-TTY output, `table` falls back to `text` with a `WARN` line on stderr.

##### `clear`

Clear all cache entries (displays: "✓ Cache cleared successfully").

**Options:**

- `-y, --yes` - Skip confirmation prompt
- `--dry-run` - Show cache stats that would be cleared without performing the operation

##### `enable`

Enable cache (displays: "✓ Cache enabled").

**Options:**

- `--max-size <size>` - Maximum cache size (e.g., `100M`, `1G`, `500MB`)

**Examples:**

```bash
# Enable cache with default size
deepl cache enable

# Enable cache with custom size
deepl cache enable --max-size 100M
deepl cache enable --max-size 1G
```

**Note:** You can also configure max cache size separately: `deepl config set cache.maxSize <bytes>`

##### `disable`

Disable cache (displays: "✓ Cache disabled").

---

### config

Manage CLI configuration.

#### Synopsis

```bash
deepl config <SUBCOMMAND>
```

#### Subcommands

##### `list`

List all configuration values (same as `get` without arguments).

**Options:**

- `--format <format>` - Output format: `text`, `json` (default: `json`)

**Examples:**

```bash
# JSON output (default)
deepl config list

# Human-readable key=value pairs
deepl config list --format text
# auth.apiKey = "xxxx...xxxx"
# cache.enabled = true
# cache.maxSize = 1073741824
```

##### `get [key]`

Get a specific configuration value, or all values if key is omitted.

**Arguments:**

- `key` (optional) - Configuration key in dot notation (e.g., `cache.maxSize`, `auth.apiKey`)

**Options:**

- `--format <format>` - Output format: `text`, `json` (default: `json`)

**Examples:**

```bash
# Get all configuration (JSON)
deepl config get

# Get specific value
deepl config get cache.maxSize

# Human-readable output
deepl config get cache.maxSize --format text
# cache.maxSize = 1073741824
```

##### `set <key> <value>`

Set a configuration value.

**Arguments:**

- `key` - Configuration key in dot notation
- `value` - Value to set

**Examples:**

```bash
deepl config set cache.maxSize 52428800
deepl config set defaults.formality more
```

##### `reset`

Reset configuration to defaults (keeps API key).

**Options:**

- `-y, --yes` - Skip confirmation prompt

---

### usage

Show API usage statistics.

#### Synopsis

```bash
deepl usage
```

#### Description

Display your DeepL API character usage and remaining quota. Helps you monitor consumption and avoid exceeding your account limits.

#### Options

- `--format FORMAT` - Output format: `text`, `json`, `table` (default: `text`). In non-TTY output, `table` falls back to `text` with a `WARN` line on stderr.

#### Examples

```bash
# Show usage statistics (Free account)
deepl usage
# Character Usage:
#   Used: 123,456 / 500,000 (24.7%)
#   Remaining: 376,544

# Pro account output (additional sections)
deepl usage
# Character Usage:
#   Used: 2,150,000 / 20,000,000 (10.8%)
#   Remaining: 17,850,000
#
# Billing Period:
#   2025-04-24 to 2025-05-24
#
# API Key Usage:
#   Used: 1,880,000 / unlimited
#
# Speech-to-Text Usage:
#   Used: 12m 34s / 1h 0m 0s (20.9%)
#   Remaining: 47m 26s
#
# Product Breakdown:
#   translate: 900,000 characters (API key: 880,000)
#   write: 1,250,000 characters (API key: 1,000,000)
#   speech_to_text: 12m 34s (API key: 12m 34s)
```

**Output Fields:**

- **Used**: Number of characters translated this billing period
- **Limit**: Total character limit for your account
- **Percentage**: Usage as a percentage of total quota
- **Remaining**: Characters remaining in your quota

**Pro accounts show additional fields:**

- **Billing Period**: Start and end dates of the current billing cycle
- **API Key Usage**: Characters used by this specific API key (vs. the whole account)
- **Speech-to-Text Usage**: Duration used and remaining for speech-to-text quota (displayed as hours/minutes/seconds)
- **Product Breakdown**: Per-product character counts (translate, write) and durations (speech_to_text) with API key-level breakdown

**Notes:**

- Usage resets monthly for most accounts
- Free tier: typically 500,000 characters/month
- Pro accounts: varies by subscription level; additional sections shown automatically
- Shows warning when usage exceeds 80%

---

### languages

List supported source and target languages.

#### Synopsis

```bash
deepl languages [OPTIONS]
```

#### Description

Display all 121 supported languages grouped by category. Core and regional languages are shown first, followed by extended languages. When an API key is configured, language names are fetched from the DeepL API; otherwise, the local language registry is used.

You can filter to show only source languages, only target languages, or both (default).

#### Options

- `--source, -s` - Show only source languages
- `--target` - Show only target languages
- `--format FORMAT` - Output format: `text`, `json`, `table` (default: `text`). In non-TTY output, `table` falls back to `text` with a `WARN` line on stderr.

#### Examples

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
#   ar        Arabic [F]
#   ...
#   en-gb     English (British)
#   en-us     English (American)
#   ...
#
#   Extended Languages (quality_optimized only, no formality/glossary):
#   ace       Acehnese
#   ...
#
#   [F] = supports formality parameter

# Show only source languages
deepl languages --source

# Show only target languages
deepl languages --target

# Works without API key (shows local registry data)
deepl languages
# Note: No API key configured. Showing local language registry only.
```

**Output Format:**

- Languages are grouped: core/regional first, then extended in a separate section
- Extended languages are annotated with "quality_optimized only, no formality/glossary"
- Target languages that support the `--formality` parameter are marked with `[F]` (requires API key)
- Language codes are left-aligned and padded for readability

**Notes:**

- Source and target language lists differ: 7 regional variants (en-gb, en-us, es-419, pt-br, pt-pt, zh-hans, zh-hant) are target-only
- Extended languages (82 codes) only support `quality_optimized` model type and do not support formality or glossary features
- Without an API key, the command shows all languages from the local registry with a warning

---

### detect

Detect the language of text using DeepL API.

#### Synopsis

```bash
deepl detect [OPTIONS] [text]
```

#### Description

Detect the language of the given text. Under the hood, this command calls the DeepL translate API with a dummy target language and returns only the `detected_source_language` field from the response.

Text can be provided as a positional argument or piped via stdin.

#### Options

- `--format <format>` - Output format: `text`, `json` (default: `text`)

#### Examples

```bash
# Detect language of French text
deepl detect "Bonjour le monde"
# Detected language: French (fr)

# Detect language with JSON output
deepl detect "Hallo Welt" --format json
# {
#   "detected_language": "de",
#   "language_name": "German"
# }

# Pipe text via stdin
echo "Ciao mondo" | deepl detect
# Detected language: Italian (it)

# Use in a script
LANG=$(deepl detect "Hola" --format json | jq -r '.detected_language')
echo "$LANG"  # es
```

**Notes:**

- Requires an API key (the detection uses a translate API call)
- Each detection call consumes character quota (the text is translated to produce the detection)
- Very short text (single characters or words) may produce unreliable detection results
- Supports all 121 languages recognized by the DeepL API (core, regional, and extended)

---

### completion

Generate shell completion scripts for bash, zsh, or fish.

#### Synopsis

```bash
deepl completion <shell>
```

#### Arguments

- `shell` - Shell type: `bash`, `zsh`, `fish`

#### Examples

```bash
# Generate and install bash completions
deepl completion bash > /etc/bash_completion.d/deepl

# Generate and install zsh completions
deepl completion zsh > "${fpath[1]}/_deepl"

# Generate and install fish completions
deepl completion fish > ~/.config/fish/completions/deepl.fish

# Or source directly in your current session:
source <(deepl completion bash)
eval "$(deepl completion zsh)"
deepl completion fish | source
```

---

### init

Interactive setup wizard for first-time users.

#### Synopsis

```bash
deepl init
```

#### Description

Guides through API key setup, default target language selection, and basic configuration. Validates the API key against the DeepL API before saving.

#### Examples

```bash
# Run the interactive setup wizard
deepl init

# Output:
# Welcome to DeepL CLI! Let's get you set up.
# Enter your DeepL API key: ****
# ✓ API key validated (DeepL API Free)
# Select default target language: es
# ✓ Configuration saved
# You're ready! Try: deepl translate "Hello" --to es
```

---

### auth

Manage API authentication.

#### Synopsis

```bash
deepl auth <SUBCOMMAND>
```

#### Subcommands

##### `set-key [api-key]`

Set your DeepL API key and validate it with the DeepL API.

**Arguments:**

- `api-key` (optional) - Your DeepL API authentication key. If omitted, reads from stdin.

**Options:**

- `--from-stdin` - Read API key from stdin
- `--no-verify` - Store the key without validating it against the API. Use on offline or proxied networks, where validation cannot reach the API and the key would otherwise be discarded. Exports of `DEEPL_API_KEY` also bypass validation entirely.

**Examples:**

```bash
# Pipe key from stdin (recommended - avoids exposing key in process listings)
echo "YOUR-API-KEY" | deepl auth set-key --from-stdin

# Read from file
deepl auth set-key --from-stdin < ~/.deepl-api-key

# Provide key as argument
deepl auth set-key YOUR-API-KEY-HERE
# ✓ API key saved and validated successfully

# Store without a network round-trip (offline, or behind an unconfigured proxy)
echo "YOUR-API-KEY" | deepl auth set-key --from-stdin --no-verify
# ✓ API key saved without validation
```

**Security Note:** Prefer `--from-stdin` over passing the key as a command argument. Command arguments are visible to other users via process listings (`ps aux`).

> **Deprecation:** Passing the API key as a positional argument is deprecated and will emit a warning. Use `--from-stdin` instead for secure key input.

##### `show`

Show current API key (masked for security).

**Output Format:** `API Key: abcd...xyz1` (first 4 and last 4 characters visible)

**Examples:**

```bash
deepl auth show
# API Key: 1234...abcd

deepl auth show
# No API key set
```

##### `clear`

Clear stored API key from configuration.

**Examples:**

```bash
deepl auth clear
# ✓ API key removed
```

---

### style-rules

Manage DeepL style rules (Pro API only). Style rules carry a list of configured rule ids and optional custom instructions, and apply to translations via their style id.

#### Synopsis

```bash
deepl style-rules <SUBCOMMAND>
```

#### Subcommands

##### `list`

List all available style rules.

**Options:**

- `--detailed` - Show detailed information including configured rules and custom instructions
- `--page NUMBER` - Page number for pagination
- `--page-size NUMBER` - Number of results per page (1-25)
- `--format FORMAT` - Output format: `text`, `json`, `table` (default: `text`). In non-TTY output, `table` falls back to `text` with a `WARN` line on stderr.

**Examples:**

```bash
deepl style-rules list
deepl style-rules list --detailed
deepl style-rules list --format json
deepl style-rules list --format table
deepl style-rules list --page 1 --page-size 10
```

##### `create`

Create a new style rule list.

**Options:**

- `--name NAME` - Style rule name (required)
- `--language LANG` - Target language (required)
- `--rules JSON` - Configured rules as a JSON object of category → settings (optional). The DeepL API models configured rules as a two-level dictionary; arrays are not accepted. See "Configured rules shape" below.
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
deepl style-rules create --name "Corporate" --language en
deepl style-rules create --name "Québécois" --language fr \
  --rules '{"punctuation":{"quotation_mark":"use_guillemets"}}'
```

**Configured rules shape:**

The DeepL API expects `configured_rules` as a nested object — a category name maps to a settings object, and each setting maps to a string value. Empty rules are `{}`. Example for fr-CA:

```json
{
  "punctuation": {
    "quotation_mark": "use_guillemets",
    "spacing_and_punctuation": "do_not_use_space"
  },
  "spelling_and_grammar": {
    "accents_and_cedillas": "use_even_on_capital_letters"
  }
}
```

The available categories, settings, and accepted values are defined by the DeepL API; consult DeepL's API documentation for the current rule schema.

##### `show`

Show a single style rule.

**Arguments:**

- `<id>` - Style rule id (required)

**Options:**

- `--detailed` - Include configured rules and custom instructions
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
deepl style-rules show sr-abc123
deepl style-rules show sr-abc123 --detailed --format json
```

##### `update`

Update a style rule — rename and/or replace configured rules. At least one of `--name` / `--rules` is required. When both are provided, the rename (PATCH) runs first, then the rules replacement (PUT `/configured_rules`).

**Arguments:**

- `<id>` - Style rule id (required)

**Options:**

- `--name NAME` - New name
- `--rules JSON` - Replace configured rules with a JSON object of category → settings (see "Configured rules shape" under `create`)
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
deepl style-rules update sr-abc123 --name "Renamed"
deepl style-rules update sr-abc123 --rules '{"punctuation":{"quotation_mark":"use_guillemets"}}'
deepl style-rules update sr-abc123 --name "New" --rules '{"spelling_and_grammar":{"accents_and_cedillas":"use_even_on_capital_letters"}}'
```

##### `delete`

Delete a style rule. Prompts for confirmation on a TTY; use `--yes` to skip or `--dry-run` to preview.

**Arguments:**

- `<id>` - Style rule id (required)

**Options:**

- `-y`, `--yes` - Skip confirmation prompt
- `--dry-run` - Show what would be deleted without performing the operation

**Examples:**

```bash
deepl style-rules delete sr-abc123
deepl style-rules delete sr-abc123 --yes
deepl style-rules delete sr-abc123 --dry-run
```

##### `instructions`

List custom instructions attached to a style rule. Synthesized from the detailed `show` response.

**Arguments:**

- `<style-id>` - Style rule id (required)

**Options:**

- `--format FORMAT` - Output format: `text`, `json`, `table` (default: `text`). In non-TTY output, `table` falls back to `text` with a `WARN` line on stderr.

**Examples:**

```bash
deepl style-rules instructions sr-abc123
deepl style-rules instructions sr-abc123 --format json
deepl style-rules instructions sr-abc123 --format table
```

##### `add-instruction`

Add a custom instruction to a style rule.

**Arguments:**

- `<style-id>` - Style rule id (required)
- `<label>` - Instruction label, unique within the rule (required)
- `<prompt>` - Instruction prompt text (required)

**Options:**

- `--source-language LANG` - Source language code (optional)
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
deepl style-rules add-instruction sr-abc123 tone "Be formal"
deepl style-rules add-instruction sr-abc123 register "Use first person" --source-language en
```

##### `update-instruction`

Update the prompt and/or source language of an existing custom instruction. The label cannot be changed (it is the identifier); rename by removing and re-adding.

**Arguments:**

- `<style-id>` - Style rule id (required)
- `<label>` - Instruction label (required)
- `<prompt>` - New instruction prompt text (required)

**Options:**

- `--source-language LANG` - Source language code (optional)
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
deepl style-rules update-instruction sr-abc123 tone "Be friendlier"
```

##### `remove-instruction`

Remove a custom instruction from a style rule. Prompts for confirmation on a TTY.

**Arguments:**

- `<style-id>` - Style rule id (required)
- `<label>` - Instruction label (required)

**Options:**

- `-y`, `--yes` - Skip confirmation prompt
- `--dry-run` - Show what would be removed without performing the operation

**Examples:**

```bash
deepl style-rules remove-instruction sr-abc123 tone --yes
deepl style-rules remove-instruction sr-abc123 tone --dry-run
```

#### Notes

- Style rules are Pro API only and datacenter-specific (EU and US rules don't cross).
- Use the style id with `deepl translate --style-id <uuid>` to apply a rule at translation time.
- Style rules force the `quality_optimized` model type.
- Text-format output of stored user strings (rule names, instruction labels, instruction prompts) passes through a terminal-escape sanitizer to prevent injection of control characters from the API response. JSON-format output preserves raw strings (JSON-escaped at the encoding layer).

### admin

Admin API for managing API keys and viewing organization usage analytics. Requires an admin-level API key.

#### Synopsis

```bash
deepl admin <SUBCOMMAND>
```

#### Subcommands

##### `keys list`

List all API keys in the organization.

**Options:**

- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
# List all API keys
deepl admin keys list

# JSON output
deepl admin keys list --format json
```

##### `keys create`

Create a new API key.

**Options:**

- `--label LABEL` - Label for the new key
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Examples:**

```bash
# Create a key with a label
deepl admin keys create --label "Production Key"

# Create a key without a label
deepl admin keys create

# JSON output
deepl admin keys create --label "CI Key" --format json
```

##### `keys deactivate`

Deactivate an API key (permanent, cannot be undone).

**Arguments:**

- `<key-id>` - Key ID to deactivate (required)

**Options:**

- `-y, --yes` - Skip confirmation prompt

**Examples:**

```bash
deepl admin keys deactivate abc123-def456
deepl admin keys deactivate abc123-def456 --yes
```

##### `keys rename`

Rename an API key.

**Arguments:**

- `<key-id>` - Key ID to rename (required)
- `<label>` - New label (required)

**Examples:**

```bash
deepl admin keys rename abc123-def456 "New Label"
```

##### `keys set-limit`

Set character usage limit for an API key.

**Arguments:**

- `<key-id>` - Key ID (required)
- `<characters>` - Character limit (number or "unlimited") (required)

**Options:**

- `--stt-limit <milliseconds>` - Speech-to-text milliseconds limit (number or `unlimited`)

**Examples:**

```bash
# Set a limit of 1 million characters
deepl admin keys set-limit abc123-def456 1000000

# Remove the limit
deepl admin keys set-limit abc123-def456 unlimited

# Set character limit and speech-to-text limit together
deepl admin keys set-limit abc123-def456 1000000 --stt-limit 3600000
```

##### `usage`

View organization usage analytics with per-product character breakdowns.

**Options:**

- `--start DATE` - Start date in YYYY-MM-DD format (required)
- `--end DATE` - End date in YYYY-MM-DD format (required)
- `--group-by GROUPING` - Group results: `key`, `key_and_day`
- `--format FORMAT` - Output format: `text`, `json` (default: `text`)

**Output includes:**

- **Total characters** across all products
- **Text translation characters** — characters used for `/v2/translate`
- **Document translation characters** — characters used for document translation
- **Text improvement characters** — characters used for DeepL Write

**Examples:**

```bash
# View total usage for a date range
deepl admin usage --start 2024-01-01 --end 2024-12-31

# Group usage by key
deepl admin usage --start 2024-01-01 --end 2024-12-31 --group-by key

# Daily usage per key
deepl admin usage --start 2024-01-01 --end 2024-01-31 --group-by key_and_day

# JSON output
deepl admin usage --start 2024-01-01 --end 2024-12-31 --format json
```

**Example output:**

```
Period: 2024-01-01 to 2024-01-31

Total Usage:
  Total:       10,000
  Translation: 7,000
  Documents:   2,000
  Write:       1,000

Per-Key Usage (2 entries):

  Staging Key
    Total:       6,000
    Translation: 4,000
    Documents:   1,500
    Write:       500

  Production Key
    Total:       4,000
    Translation: 3,000
    Documents:   500
    Write:       500
```

#### Notes

- Admin API endpoints require an admin-level API key (not a regular developer key)
- Key deactivation is permanent and cannot be undone
- Usage analytics show per-product character breakdowns (translation, documents, write)
- The `--group-by` option provides granular breakdowns for cost allocation

---

## Configuration

**Configuration file location:**

The CLI resolves configuration and cache paths using the following priority order:

| Priority | Condition              | Config path                              | Cache path                           |
| -------- | ---------------------- | ---------------------------------------- | ------------------------------------ |
| 1        | `DEEPL_CONFIG_DIR` set | `$DEEPL_CONFIG_DIR/config.json`          | `$DEEPL_CONFIG_DIR/cache.db`         |
| 2        | `~/.deepl-cli/` exists | `~/.deepl-cli/config.json`               | `~/.deepl-cli/cache.db`              |
| 3        | XDG env vars set       | `$XDG_CONFIG_HOME/deepl-cli/config.json` | `$XDG_CACHE_HOME/deepl-cli/cache.db` |
| 4        | Default                | `~/.config/deepl-cli/config.json`        | `~/.cache/deepl-cli/cache.db`        |

Existing `~/.deepl-cli/` installations continue to work with no changes needed.

### Configuration Schema

```json
{
  "auth": {
    "apiKey": "your-api-key"
  },
  "api": {
    "baseUrl": "https://api.deepl.com",
    "usePro": true
  },
  "defaults": {
    "sourceLang": null,
    "targetLangs": [],
    "formality": "default",
    "preserveFormatting": true
  },
  "cache": {
    "enabled": true,
    "maxSize": 1073741824,
    "ttl": 2592000
  },
  "output": {
    "format": "text",
    "verbose": false,
    "color": true
  },
  "watch": {
    "debounceMs": 500,
    "autoCommit": false,
    "pattern": "*.md"
  }
}
```

**Configuration Notes:**

- **`baseUrl`** — when set to a custom/regional endpoint (e.g. `https://api-jp.deepl.com`), it overrides all auto-detection. Standard DeepL URLs (`api.deepl.com`, `api-free.deepl.com`) are treated as tier defaults and do **not** override key-based auto-detection. By default, the endpoint is auto-detected from the API key: keys ending with `:fx` use the Free API (`api-free.deepl.com`), all others use the Pro API (`api.deepl.com`). The `usePro` flag serves as a backward-compatible fallback for non-`:fx` keys.
- Most users configure settings via `deepl config set` command rather than editing the file directly.

---

## Environment Variables

### `DEEPL_API_KEY`

Set your API key via environment variable.

```bash
export DEEPL_API_KEY="your-api-key"
deepl translate "Hello" --to es
```

### `DEEPL_CONFIG_DIR`

Override config and cache directory. Takes highest priority over all other path resolution.

```bash
export DEEPL_CONFIG_DIR="/custom/path"
```

### `XDG_CONFIG_HOME`

Override XDG config base directory (default: `~/.config`). Config is stored at `$XDG_CONFIG_HOME/deepl-cli/config.json`. Only used when `DEEPL_CONFIG_DIR` is unset and legacy `~/.deepl-cli/` does not exist.

```bash
export XDG_CONFIG_HOME="$HOME/.config"
```

### `XDG_CACHE_HOME`

Override XDG cache base directory (default: `~/.cache`). Cache is stored at `$XDG_CACHE_HOME/deepl-cli/cache.db`. Only used when `DEEPL_CONFIG_DIR` is unset and legacy `~/.deepl-cli/` does not exist.

```bash
export XDG_CACHE_HOME="$HOME/.cache"
```

### `NO_COLOR`

Disable colored output.

```bash
export NO_COLOR=1
```

### `FORCE_COLOR`

Force colored output even when the terminal doesn't appear to support it. Note: `NO_COLOR` takes priority if both are set. Useful in CI environments.

```bash
export FORCE_COLOR=1
```

### `TERM`

When set to `dumb`, disables colored output and progress spinners. This is automatically set by some CI environments and editors.

```bash
export TERM=dumb
```

### `HTTP_PROXY`

Route outbound DeepL API requests through an HTTP proxy. Accepts a full URL including optional `username:password@` credentials. Also recognized as lowercase `http_proxy`.

```bash
export HTTP_PROXY="http://proxy.example.com:3128"
```

### `HTTPS_PROXY`

Route outbound DeepL API requests through an HTTPS proxy. Takes precedence over `HTTP_PROXY` when both are set. Also recognized as lowercase `https_proxy`.

```bash
export HTTPS_PROXY="http://proxy.example.com:3128"
```

### `TMS_API_KEY`

API key used by `deepl sync push` and `deepl sync pull` to authenticate against the external translation management system configured under `tms.server` in `.deepl-sync.yaml`. See [docs/SYNC.md](SYNC.md) for setup details.

```bash
export TMS_API_KEY="your-tms-api-key"
```

### `TMS_TOKEN`

Bearer token alternative to `TMS_API_KEY`. Used by `deepl sync push` and `deepl sync pull` when the configured TMS server expects token-based auth. See [docs/SYNC.md](SYNC.md) for setup details.

```bash
export TMS_TOKEN="your-tms-token"
```

---

## Exit Codes

Every `deepl` command returns a specific exit code so CI/CD pipelines and shell scripts can react programmatically to failure modes. This appendix is the single source of truth for every code the CLI emits; per-command sections above surface exit codes inline where a flag has a code-specific contract (for example, `sync --frozen` exits 10 on drift).

Exit codes come from three paths:

1. **Typed errors** thrown in services, API clients, and commands subclass `DeepLCLIError`, each carrying a fixed `exitCode`. The CLI's top-level `handleError` uses that value directly.
2. **HTTP responses** from the DeepL API are mapped to typed errors inside the HTTP client (401 → `AuthError`, 429 → `RateLimitError`, 456 → `QuotaError`, 503 → `NetworkError`).
3. **Untyped errors** (plain `Error` instances that escape service boundaries) are classified by message against a curated list of substrings. When nothing matches, the CLI returns `1` (general error).

Retryable codes are `3` (rate limit) and `5` (network); everything else should be treated as fatal by calling scripts.

### Quick reference

| Code | Name           | Meaning                                                        | Retryable |
| ---- | -------------- | -------------------------------------------------------------- | --------- |
| 0    | Success        | Command completed successfully                                 | N/A       |
| 1    | GeneralError   | Unclassified failure (error escaped every typed handler and matched no classifier heuristic) | No |
| 2    | AuthError      | Authentication failed or API key missing                       | No        |
| 3    | RateLimitError | Rate limit exceeded (HTTP 429)                                 | Yes       |
| 4    | QuotaError     | Monthly character quota exhausted (HTTP 456)                   | No        |
| 5    | NetworkError   | Connection timeout, refused, reset, or 503 Service Unavailable | Yes       |
| 6    | InvalidInput   | Missing or malformed arguments, unsupported format             | No        |
| 7    | ConfigError    | Configuration file or value invalid                            | No        |
| 8    | CheckFailed    | A check-style command found actionable issues                  | No        |
| 9    | VoiceError     | Voice API unavailable or session failed                        | No        |
| 10   | SyncDrift      | `sync --frozen` detected translations out of date              | No        |
| 11   | SyncConflict   | `sync resolve` could not auto-resolve lockfile conflicts       | No        |
| 12   | PartialFailure | `deepl sync` completed with at least one failed locale         | Yes (per-locale retry) |

### Code details

#### 0 — Success

Command completed without error. Every `deepl` subcommand uses this code on success. Do not rely on stdout being non-empty — successful commands may emit only a status line (e.g., `deepl cache clear`).

#### 1 — GeneralError

Unclassified failure: emitted when an error escapes every typed handler and matches none of the message-classification heuristics in `src/utils/exit-codes.ts`. Any command can surface this. Treat it as "unknown failure — inspect stderr." Typically indicates an unexpected CLI bug or an error from a third-party dependency.

**CI branching.** Exit 1 now means exactly "unclassified failure." Partial sync failure has its own code — see [#12 — PartialFailure](#12--partialfailure). A CI script can safely treat exit 1 as "CLI crashed, investigate" without misreading a partial-locale outcome.

#### 2 — AuthError

Authentication failed or no API key is available. Emitted by:

- `deepl auth set-key` when the key cannot be validated
- Every command that touches the API (`translate`, `write`, `voice`, `glossary`, `usage`, `sync`, `tm list`, `admin`, etc.) when `DEEPL_API_KEY` is unset and no key is in the config file
- HTTP 401/403 responses from the DeepL API

Remediation: run `deepl init` or `deepl auth set-key <your-api-key>`, or export `DEEPL_API_KEY`.

#### 3 — RateLimitError

Too many requests in too short a window. Emitted when the DeepL API returns HTTP 429 from any endpoint (`/v2/translate`, `/v2/write`, `/v3/glossaries`, `/v3/translation_memories`, document upload/download, voice session). The CLI honors the `Retry-After` header when the server sends one, otherwise it falls back to exponential backoff for in-process retries. When all internal retries are exhausted, this code is returned to the caller.

Remediation: wait and retry, or lower concurrency with `--concurrency` (batch translation, `sync`).

#### 4 — QuotaError

Monthly character quota has been exhausted (HTTP 456). Emitted by any command that consumes characters: `translate`, `write`, `voice`, and `sync`. Unlike rate limits, quota is not retryable within the billing window.

Remediation: run `deepl usage` to see remaining characters, or upgrade the plan at <https://www.deepl.com/pro>.

#### 5 — NetworkError

Connection-layer failure or transient server outage. Covers TCP errors (`ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`, `ETIMEDOUT`, socket hang up), timeouts, proxy misconfigurations, and HTTP 503 responses. Also emitted for malformed or empty API responses thrown from `src/api/translation-client.ts` and `src/api/write-client.ts`, and from document/structured-file translation when the polling response is unparseable.

Remediation: check connectivity and `HTTPS_PROXY` / `HTTP_PROXY` env vars, then retry.

#### 6 — InvalidInput

User-supplied input was rejected by client-side validation before any API call. This is the most commonly emitted non-zero code. Sites include:

- `translate`: empty text, missing `--to`, unsupported file format, invalid `--tm-threshold` range, `--tm-threshold` without `--translation-memory`, `--translation-memory` without `--from`, mutually exclusive flags
- `write`: empty text, `--style` and `--tone` used together, `--fix` without a file path, unsupported language for the Write API
- `voice`: missing target languages, unsupported plan (pre-flight check), invalid session parameters
- `glossary`: missing name/entries, entry not found on delete
- `sync`: `--frozen` combined with `--force`, missing `.deepl-sync.yaml` (before `ConfigError` hands off)
- `hooks`, `watch`, `detect`, `admin`, `init`, `completion`, `cache`: argument parsing, unknown subcommand, bad path, bad size

Remediation: re-read the command's `--help` and the relevant section of this API reference.

#### 7 — ConfigError

The configuration file or a configuration value is invalid. Emitted by:

- `deepl config set` with a key that is not in the schema, or a value that fails validation (invalid language code, invalid formality, invalid output format, non-positive cache size, non-HTTPS `baseUrl`, path-traversal attempts)
- `deepl config get` with a malformed key
- Any command that loads the config file when the file fails to parse, is missing a required field, or specifies an unsupported version
- `sync` when `.deepl-sync.yaml` is missing required fields, has invalid locales, or declares an unsupported version
- `sync push` / `sync pull` when the remote TMS returns 401/403 (surfaced as `ConfigError` with a hint to check `TMS_API_KEY` / `TMS_TOKEN` and the relevant YAML fields)
- `glossary` when a named glossary cannot be resolved

Remediation: run `deepl config get` to inspect the current config, or edit the file directly and re-run.

#### 8 — CheckFailed

A check-style command ran successfully but found actionable issues. Exit is *soft* — `process.exitCode` is set so cleanup still runs. Emitted by:

- `deepl write --check <text|file>` when the Write API would suggest changes (`needsImprovement === true`)
- `deepl sync validate` when validation surfaces one or more `error`-severity issues (missing placeholders, format-string mismatches, unbalanced HTML tags)

This code is specifically designed for CI use: a `check` step can block a merge without requiring try/catch wrappers in the calling script. It does **not** indicate a CLI failure.

#### 9 — VoiceError

Voice API call failed for a reason other than authentication, rate limiting, or generic network trouble. Emitted by:

- `deepl voice` when the plan does not include the Voice API (pre-flight check in the voice client)
- Voice streaming URL validation failures (`src/api/voice-client.ts`: non-`wss://` scheme, unparseable URL, disallowed host)
- Voice session lifecycle errors (failed to open, unexpected close)

Remediation: confirm Pro/Enterprise plan, verify the session configuration, and retry.

#### 10 — SyncDrift

`deepl sync --frozen` (alias `--ci`) detected that lockfile-tracked translations are out of date with the source strings. Emitted only from `src/cli/commands/sync/register-sync-root.ts` when the sync run completes and `result.driftDetected === true`. No other command returns this code.

Use this in CI to fail a pull request when a contributor edits source strings without running `deepl sync`. Exit is **soft** — `process.exitCode` is set so in-flight writes, auto-commit steps, and any `--watch` event loop drain cleanly before the process exits.

Remediation: run `deepl sync` locally and commit the updated translations and lockfile.

#### 11 — SyncConflict

`deepl sync resolve` found git merge conflict markers in `.deepl-sync.lock` but could not automatically resolve every region. Emitted only by `sync resolve` when auto-resolution leaves residual conflict markers or produces invalid JSON (typically because the conflict region split a JSON entry in two and neither side parses in isolation).

Distinct from exit code 1 (GeneralError): a pipeline that runs `deepl sync resolve` in CI can now branch on `11` to route the lockfile to a human for manual merge without masking real CLI crashes under the same code.

Remediation: open `.deepl-sync.lock`, resolve the remaining `<<<<<<<` / `=======` / `>>>>>>>` regions by hand, save, and run `deepl sync` to fill any gaps.

#### 12 — PartialFailure

`deepl sync` completed, but at least one locale failed while at least one other locale succeeded. The successful locales' target files and lockfile entries are written; the failed locales' files are not touched. Emitted only by `deepl sync` (the root command).

Authentication failures (401/403) abort the entire run and surface as exit code 2 (`AuthError`) instead of 12. Network / rate-limit / quota failures bubble up as 5 / 3 / 4 respectively. Code 12 specifically means "the run proceeded far enough to attempt per-locale work, and the result was mixed."

**Retry model.** Re-running `deepl sync` (optionally with `--locale <failed,comma,separated>`) will retry only the locales whose lockfile entries weren't written. This is the canonical CI recovery path: branch on `$? -eq 12`, inspect the per-locale error report, and re-run with the failed locales as the filter.

The paired typed error is `SyncPartialFailureError` in `src/utils/errors.ts`; the JSON error envelope emits `code: "SyncPartialFailure"` to match the SyncConflict/SyncDrift naming convention.

### Classification heuristics (fallback)

When an error reaches the top-level handler without being a `DeepLCLIError`, the CLI inspects the error message (lowercased) and maps it to a code. These substring matches live in `classifyByMessage` in `src/utils/exit-codes.ts`:

- **2 — AuthError**: `authentication failed`, `invalid api key`, `api key not set`, `api key is required`
- **3 — RateLimitError**: `rate limit exceeded`, `too many requests`, `\b429\b`
- **4 — QuotaError**: `quota exceeded`, `character limit reached`, `\b456\b`
- **5 — NetworkError**: `econnrefused`, `enotfound`, `econnreset`, `etimedout`, `socket hang up`, `network error`, `network timeout`, `connection refused`, `connection reset`, `connection timed out`, `service temporarily unavailable`, `\b503\b`
- **9 — VoiceError**: `voice api`, `voice session`
- **7 — ConfigError** (checked before 6 because config messages may contain "invalid"): `config file`, `config directory`, `configuration file`, `configuration error`, `failed to load config`, `failed to save config`, `failed to read config`
- **6 — InvalidInput**: `cannot be empty`, `file not found`, `path not found`, `directory not found`, `not found in glossary`, `unsupported format`, `unsupported language`, `not supported for`, `not supported in`, `invalid target language`, `invalid source language`, `invalid language code`, `invalid glossary`, `invalid hook`, `invalid url`, `invalid size`, `is required`, `cannot specify both`
- **1 — GeneralError**: anything not matched above

The list is in the order the classifier actually tests, which is what determines the code when a message matches more than one pattern.

### Trace IDs

API error messages include the DeepL `X-Trace-ID` header when available, which is useful when contacting DeepL support:

```bash
deepl translate "Hello" --to es
# Error: Authentication failed: Invalid API key (Trace ID: abc123-def456-ghi789)
```

The trace ID is also accessible programmatically via `DeepLClient.lastTraceId` after any API call.

### Shell handling examples

Retry only on retryable codes (`3` and `5`):

```bash
#!/bin/bash
deepl translate "Hello" --to es
case $? in
  0) echo "Success" ;;
  3|5) sleep 5 && deepl translate "Hello" --to es ;;
  *) echo "Non-retryable error ($?)"; exit $? ;;
esac
```

Fail a CI build when translations drift:

```bash
deepl sync --frozen || {
  code=$?
  [ $code -eq 10 ] && echo "::error::Translation drift — run 'deepl sync' locally" >&2
  exit $code
}
```

Block a merge when `deepl write --check` flags a file:

```bash
deepl write --check README.md
[ $? -eq 8 ] && echo "Write suggests improvements; run: deepl write --fix README.md" >&2
```

---

## See Also

- [Examples](../examples/)
- [DeepL API Documentation](https://www.deepl.com/docs-api)

---

**Last Updated**: July 29, 2026
**DeepL CLI Version**: 2.0.0

# DeepL CLI Examples

This directory contains practical, real-world examples of using the DeepL CLI.

## Quick Links

### Core Commands

**Translate:**
- [Basic Translation](./01-basic-translation.sh) - Simple text translation examples
- [File Translation & Caching](./02-file-translation.sh) - Translating files with smart caching for text-based formats
- [Batch Processing](./03-batch-processing.sh) - Translating multiple files
- [Context-Aware Translation](./04-context-aware-translation.sh) - Using context for better translation quality
- [Document Translation](./05-document-translation.sh) - Translating complete documents (PDF, DOCX, HTML, etc.) while preserving formatting
- [Document Format Conversion](./06-document-format-conversion.sh) - Converting document formats during translation
- [Structured File Translation](./07-structured-file-translation.sh) - Translating JSON/YAML i18n locale files while preserving structure
- [Model Type Selection](./08-model-type-selection.sh) - Choosing quality vs. speed trade-offs
- [XML Tag Handling](./09-xml-tag-handling.sh) - Advanced XML/HTML tag handling for fine-tuned translation control
- [Custom Instructions](./10-custom-instructions.sh) - Guide translations with custom instructions for domain, style, and terminology
- [Table Output Format](./11-table-output.sh) - Structured table output for comparing translations across multiple languages
- [Cost Transparency](./12-cost-transparency.sh) - Tracking billed characters for translation cost analysis

**Write:**
- [Writing Enhancement](./13-write.sh) - Using DeepL Write API for grammar, style, and tone improvement
- [Write — Extended Languages](./36-write-extended-languages.sh) - JA/KO/ZH targets and tone/style on ES/IT/FR/PT variants
- [Correct](./37-correct.sh) - Spelling and grammar correction without rewording (`deepl correct`, alias `c`)

**Voice:**
- [Voice Translation](./14-voice.sh) - Real-time speech translation via the Voice API

### Resources

- [Glossaries](./15-glossaries.sh) - Managing glossaries for consistent terminology
- [Translation Memory Listing](./33-tm-list.sh) — List translation memories on your account

### Workflow

- [Watch Mode](./16-watch-mode.sh) - Real-time file monitoring and auto-translation
- [Git Hooks Integration](./17-git-hooks.sh) - Automating translation validation in git workflow
- [CI/CD Integration](./18-cicd-integration.sh) - Using DeepL CLI in automated workflows
- [Sync — Basic Usage](./30-sync-basic.sh) - Scanning, diffing, and syncing i18n locale files
- [Sync — CI/CD Integration](./31-sync-ci.sh) - Using deepl sync in automated pipelines
- [Sync — Live Validation](./32-sync-live-validation.sh) - Comprehensive end-to-end validation of all sync features
- [Sync — Laravel PHP arrays](./34-sync-laravel-php.sh) - `laravel_php` format parser: AST allowlist, span-surgical reconstruct, pipe-pluralization warning gate, `sync.limits` caps

### Configuration

- [Configuration](./19-configuration.sh) - Setting up and managing configuration
- [Custom Config Files](./20-custom-config-files.sh) - Using multiple configuration files for different projects
- [Cache Management](./21-cache.sh) - Working with the translation cache
- [Style Rules](./22-style-rules.sh) - Listing and using pre-configured style rules for consistent translations
- [Style Rules — CRUD](./35-style-rules-crud.sh) - End-to-end style-rules lifecycle: create, update rules, manage custom instructions, delete

### Information

- [Usage Monitoring](./23-usage-monitoring.sh) - Monitoring API character usage and quota
- [Supported Languages](./24-languages.sh) - Listing source and target languages supported by DeepL
- [Language Detection](./25-detect.sh) - Detecting the language of text input
- [Shell Completions](./26-completion.sh) - Setting up bash, zsh, and fish shell completions

### Administration

- [Admin API](./27-admin.sh) - Managing API keys and viewing organization usage analytics

### Getting Started

- [Setup Wizard](./28-init.sh) - Interactive first-time setup with `deepl init`

### Advanced

- [Advanced Translation](./29-advanced-translate.sh) - Tag handling versions, beta languages, custom API URLs, and document minification

## Prerequisites

All examples assume you have:

1. Installed DeepL CLI (`npm install -g @deepl/cli` or `npm link`)
2. A DeepL API key configured (`deepl auth set-key YOUR_API_KEY`)

## Running Examples

Each example is a standalone bash script that you can run directly:

```bash
# Make executable
chmod +x examples/*.sh

# Run an example
./examples/01-basic-translation.sh
```

Or follow along and run commands individually.

### Running All Examples

You can run all examples at once using the `run-all.sh` script:

```bash
# Run all examples
./examples/run-all.sh

# Run all examples in fast mode (skip slow examples like watch mode)
./examples/run-all.sh --fast

# Stop on first failure
./examples/run-all.sh --stop-on-error

# Show help
./examples/run-all.sh --help
```

**Note:** Running all examples will make real API calls and consume your DeepL API quota.

## Example Files

The example scripts generate their own fixture files under `/tmp` at runtime and clean them up on exit; no sample data is checked into this directory.

## Contributing Examples

Have a useful example? Please contribute! See [../CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

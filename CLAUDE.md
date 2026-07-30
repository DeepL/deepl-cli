# Claude Code Project Configuration

## Project Overview

DeepL CLI is a command-line interface for the DeepL API that integrates translation, writing enhancement (DeepL Write API), and developer workflow automation.

### Current Status

- **Version**: see `package.json` (the single source of truth; `src/version.ts` reads it at runtime)
- **Tests**: see `npm test` output (target: all green; coverage thresholds enforced by jest config)
- **Test mix**: ~70-75% unit, ~25-30% integration/e2e

### Architecture

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
Storage (node:sqlite Cache, Config) + Static Data (src/data — language registry)
```

### Configuration

- **Config**: XDG default `~/.config/deepl-cli/config.json`, legacy `~/.deepl-cli/config.json`
- **Cache**: XDG default `~/.cache/deepl-cli/cache.db`, legacy `~/.deepl-cli/cache.db`
- **Path priority**: `DEEPL_CONFIG_DIR` > legacy `~/.deepl-cli/` > XDG env vars > XDG defaults
- **Environment Variables**:
  - `DEEPL_API_KEY` - API authentication
  - `DEEPL_CONFIG_DIR` - Override config and cache directory (used for test isolation)
  - `XDG_CONFIG_HOME` - Override XDG config base (default: `~/.config`)
  - `XDG_CACHE_HOME` - Override XDG cache base (default: `~/.cache`)
  - `NO_COLOR` - Disable colored output

### Key Project Files

- **CHANGELOG.md** - Release history and version notes
- **docs/API.md** - Complete CLI command reference

## Development Philosophy

### Package Management

- Always use the latest versions of packages
- Never downgrade packages to avoid ESM/CommonJS issues
- If a package is ESM-only, refactor code to use dynamic imports or ESM

### Test-Driven Development

This project follows strict TDD:

1. **Red** - Write failing tests that define expected behavior
2. **Green** - Write minimal code to make tests pass
3. **Refactor** - Improve code quality while keeping tests green
4. **Commit** - Save progress after each cycle

Always write tests before implementation code. Test behavior, not implementation. Keep tests isolated.

## Versioning and Changelog

Use **Semantic Versioning** with **Conventional Commits**:

- `feat:` → MINOR, `fix:` → PATCH, `BREAKING CHANGE:` → MAJOR
- `docs:, chore:, refactor:` → no bump unless behavior changes

### On Every Change

1. Add entries under **Unreleased** in `CHANGELOG.md` using **only** the standard [Keep a Changelog](https://keepachangelog.com) categories: **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**. Do not invent custom categories (e.g., "Improved").
2. Determine MAJOR/MINOR/PATCH from change scope

### When Cutting a Release

1. Move Unreleased items to `## [X.Y.Z] - YYYY-MM-DD`
2. Set the version with `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and the lockfile together; the release workflow refuses to publish if the tag and `package.json` disagree)
3. Create annotated tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z: <summary>"`
4. Push: `git push && git push --tags`

## Code Style

- **Comment sparingly** - only when behavior is unclear
- **Type everything** - avoid `any`
- **Prefer explicit over implicit**
- **Follow existing patterns** in the codebase

### Naming Conventions

- **Files**: kebab-case (`translation-service.ts`)
- **Classes/Types/Interfaces**: PascalCase (`TranslationService`)
- **Functions/variables**: camelCase (`translateText`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_CACHE_SIZE`)

### File Organization

```
src/
├── cli/              # CLI interface and commands
├── services/         # Business logic
├── sync/             # Continuous localization engine (scan, diff, translate, write, lock)
├── formats/          # i18n file format parsers (JSON, YAML, PO, XLIFF, Android XML, etc.)
├── api/              # DeepL API client
├── storage/          # Data persistence (node:sqlite cache, config)
├── data/             # Static data (language registry)
├── utils/            # Utility functions
└── types/            # Type definitions
```

## Testing

### Stack

- **Jest** + **ts-jest** - Test runner with TypeScript support
- **nock** - HTTP request mocking for API tests
- **memfs** - File system mocking

### Test Types

All three are **required** for new features:

- **Unit tests** - Individual functions/classes in isolation, mock all dependencies. File: `tests/unit/<component>.test.ts`
- **Integration tests** - Component interactions with nock for HTTP mocking and `DEEPL_CONFIG_DIR` for isolation. File: `tests/integration/<component>.integration.test.ts`
- **E2E tests** - Complete CLI workflows, exit codes, stdin/stdout, error messages. File: `tests/e2e/<workflow>.e2e.test.ts`

### Test Structure

```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do something specific', () => {
      // Arrange → Act → Assert
    });
  });
});
```

### Required Scenarios for New Features

**Integration tests must cover:**
1. Happy path with valid inputs
2. API key validation
3. Argument validation
4. Error handling (403, 429, 503)
5. HTTP request structure (validated with nock)
6. Response parsing

**E2E tests must cover:**
1. Complete user workflows
2. Stdin/stdout piping
3. Exit codes (success = 0, errors > 0)
4. Error messages are clear and actionable
5. Flag combinations (valid and invalid)

### Mocking Strategy

- Unit tests: Jest mocks or nock for external APIs
- Integration tests: nock for HTTP, real implementations internally
- File system: memfs where needed
- Test isolation: `DEEPL_CONFIG_DIR` env var pointing to temp directory

## Git Commit Guidelines

Use conventional commits:

```
<type>(<scope>): <description>

[optional body]
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`

- Make separate commits per logical change
- Group tests with the logic they test
- **Run `npm run lint` and `npm run type-check` before every commit**

## Pull Request Guidelines

PR descriptions should include:

1. **Summary** - What changed and why (1-2 sentences)
2. **Changes Made** - Bullet points of specific changes
3. **Test Coverage** - What tests were added/modified
4. **Backward Compatibility** - Breaking changes or compatibility notes

## Pre-Commit Checklist

- [ ] All tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] TypeScript compiles (`npm run type-check`)
- [ ] Unit, integration, and E2E tests written for new features
- [ ] HTTP mocking with nock for API interactions
- [ ] Test isolation using `DEEPL_CONFIG_DIR`
- [ ] CHANGELOG.md updated under Unreleased
- [ ] README.md updated if user-facing feature
- [ ] API.md updated if command/flag added
- [ ] Example script added to `examples/` for new features
- [ ] Commit messages follow conventional commits format

## Development Commands

```bash
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:e2e            # E2E tests only
npm run test:coverage       # Tests with coverage report
npm run lint                # Lint code
npm run lint:fix            # Fix lint issues
npm run type-check          # TypeScript type checking
npm run build               # Build project
npm run dev                 # Run CLI locally
npm run examples            # Run all example scripts
npm run examples:fast       # Run examples (skip slow ones)
```

## Documentation Maintenance

### API.md Accuracy

API.md must accurately reflect the implementation. When adding new flags or commands:

1. Verify the flag exists in source: `grep "\.option.*--flag-name" src/cli/index.ts`
2. Ensure synopsis matches commander.js definitions
3. Verify default values match code
4. Test documented examples against the actual CLI

### Example Scripts

New features should include an example script in `examples/`:

- Sequential numbering (`examples/13-new-feature.sh`), executable (`chmod +x`)
- Include API key check, use `/tmp` for temp files, clean up on exit
- Add to `examples/run-all.sh` EXAMPLES array
- Reference in `examples/README.md`

## Agent Teamwork Guidelines

When spawning multiple agents to work in parallel:

### Use git worktrees, not branches in a shared checkout

```bash
git worktree add /tmp/fix-watch fix/watch-infinite-loop
git worktree add /tmp/fix-write fix/write-bugs
```

### Partition work by file boundaries

Map each task to files it will touch. Ensure no two agents modify the same file. If two tasks touch the same file, assign them to the same agent.

### Merge strategy

1. Merge feature branches one at a time into main
2. Run the full test suite after all merges (`npm test`)
3. Delete feature branches after merge

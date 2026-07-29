# Contributing to DeepL CLI

Thank you for your interest in contributing to DeepL CLI. This guide covers everything you need to get started.

## Code of Conduct

This project has a [Code of Conduct](CODE_OF_CONDUCT.md) to which all
contributors must adhere when participating in the project. Instances of
abusive, harassing, or otherwise unacceptable behavior may be reported by
contacting [open-source@deepl.com](mailto:open-source@deepl.com) and/or a
project maintainer.

## Prerequisites

- **Node.js** >= 24.0.0
- **npm** >= 9.0.0
- A [DeepL API key](https://www.deepl.com/pro-api) (free tier works for development)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/DeepL/deepl-cli.git
cd deepl-cli

# Install dependencies
npm install

# Build the project
npm run build

# Link for local testing
npm link

# Verify it works
deepl --version
```

## Development Workflow

This project follows **Test-Driven Development (TDD)**. Every change goes through the Red-Green-Refactor cycle:

1. **Red** -- Write a failing test that defines the expected behavior.
2. **Green** -- Write the minimum code to make the test pass.
3. **Refactor** -- Improve the code while keeping tests green.
4. **Commit** -- Save your progress with a descriptive message.

### Running the CLI Locally

```bash
# Run without building
npm run dev -- translate "Hello" --to es

# Or use the linked global command
deepl translate "Hello" --to es
```

## Running Tests

```bash
# Run all tests
npm test

# Run by category
npm run test:unit
npm run test:integration
npm run test:e2e

# Run a specific file
npm test -- translation.test.ts

# Watch mode (useful during TDD)
npm test -- --watch

# Coverage report
npm run test:coverage
```

### Test Requirements

New features **must** include all three test types:

| Type | Location | Purpose |
|------|----------|---------|
| Unit | `tests/unit/` | Test functions/classes in isolation with mocked dependencies |
| Integration | `tests/integration/` | Test component interactions; use `nock` for HTTP mocking |
| E2E | `tests/e2e/` | Test complete CLI workflows from input to output |

Use `DEEPL_CONFIG_DIR` (set to a temp directory) to isolate test configuration from your real settings.

## Code Style

### Conventions

- **Files**: `kebab-case.ts`
- **Classes/Types/Interfaces**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`

### TypeScript

- Strict mode is enabled. Avoid `any`.
- Prefer `async/await` over raw promises.
- Runtime validation is hand-written: use commander's `Option.choices()` for flag values and dedicated validator functions for structured input (e.g. `validateSyncConfig` in `src/sync/sync-config.ts`). There is no schema-validation dependency.

### Project Structure

```
src/
  cli/              # CLI commands and argument parsing
  services/         # Business logic
  sync/             # Continuous localization engine (scan, diff, translate, write, lock)
  formats/          # i18n file format parsers (JSON, YAML, PO, XLIFF, Android XML, etc.)
  api/              # DeepL API client
  storage/          # SQLite cache and config management
  data/             # Static data (language registry)
  utils/            # Shared utility functions
  types/            # Type definitions
tests/
  unit/             # Unit tests
  integration/      # Integration tests
  e2e/              # End-to-end tests
```

### Linting and Formatting

```bash
npm run lint          # Check for issues
npm run lint:fix      # Fix lint issues automatically
npm run type-check    # TypeScript compilation check
npm run format        # Format code with Prettier
npm run format:check  # Check code formatting
npm run examples      # Run all example scripts
npm run examples:fast # Run examples (skip slow ones)
```

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Maintenance (deps, config, CI) |
| `perf` | Performance improvement |

### Examples

```
feat(translate): add XML tag handling options
fix(cache): prevent stale entries after TTL expiry
test(glossary): add integration tests for multilingual glossaries
docs(api): document --style-id flag usage
```

Group tests in the same commit as the code they validate.

## Pull Request Process

Before beginning work, please create an [issue][issues] describing the changes
you plan to contribute, to avoid wasting or duplicating effort. We will then
let you know whether we would accept the changes.

Contributions must be licensed under the same license as the project:
[MIT License](LICENSE).

1. **Create a branch** from `main` for your change.
2. **Write tests first**, then implement the feature (TDD).
3. **Run the full check suite** before pushing:
   ```bash
   npm test && npm run lint && npm run type-check && npm run build
   ```
4. **Open a PR** with a clear description covering:
   - Summary of the change and motivation
   - List of specific changes
   - Backward compatibility notes
   - Test coverage summary
5. **Address review feedback** with additional commits (do not force-push).

### PR Checklist

- [ ] All tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] TypeScript compiles (`npm run type-check`)
- [ ] New code includes unit, integration, and e2e tests
- [ ] Commit messages follow conventional commits format
- [ ] `CHANGELOG.md` updated under **Unreleased** section
- [ ] `README.md` updated if user-facing feature changed
- [ ] `docs/API.md` updated if command/flag added or changed
- [ ] Example script added/updated in `examples/` for new features
- [ ] Added new example script to `examples/run-all.sh` EXAMPLES array (for new CLI commands)

## Adding a New CLI Command

Here is a condensed walkthrough for adding a command called `mycommand`:

1. **Write tests** in `tests/unit/`, `tests/integration/`, and `tests/e2e/`.
2. **Create the command handler** at `src/cli/commands/mycommand.ts`.
3. **Create the registration file** at `src/cli/commands/register-mycommand.ts` to wire the command into Commander.js.
4. **Add a service** (if needed) at `src/services/mycommand-service.ts` for business logic.
5. **Register the command** in `src/cli/index.ts`.
6. **Add an example script** at `examples/NN-mycommand.sh` and register it in `examples/run-all.sh`.
7. **Update documentation**: `docs/API.md` (command reference) and `README.md` (usage section).

Follow the existing commands (e.g., `translate`, `write`, `glossary`) as templates.

## Reporting Issues

When filing a bug report, include:

- DeepL CLI version (`deepl --version`)
- Node.js version (`node --version`)
- Operating system and version
- Steps to reproduce the issue
- Expected vs. actual behavior
- Relevant error output

## Further Reading

- [CLAUDE.md](./CLAUDE.md) -- Detailed development guidelines, TDD workflow, and testing strategy
- [docs/API.md](./docs/API.md) -- Complete CLI command reference
- [DeepL API Docs](https://www.deepl.com/docs-api) -- Official API documentation

[issues]: https://github.com/DeepL/deepl-cli/issues

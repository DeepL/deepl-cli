/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts',
  ],
  // Exclude transient agent worktree copies; they shadow real tests and race on shared temp dirs.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.claude/worktrees/',
  ],
  // Keep haste-map from indexing agent worktrees too — a leftover worktree
  // otherwise duplicates manual mocks (tests/__mocks__/*) and warns on every run.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/cli/index.ts', // Main entry point
    '!src/cli/commands/translate/index.ts', // Barrel re-exports
    '!src/cli/commands/register-sync.ts', // CLI glue — tested by E2E (cli-sync.e2e.test.ts)
    '!src/cli/commands/sync/register-sync-*.ts', // CLI glue per-subcommand builders — tested by E2E
    '!src/cli/commands/sync/sync-options.ts', // CLI glue helper — tested via snapshot test
    '!src/cli/commands/register-detect.ts', // CLI glue — tested by E2E
    '!src/cli/commands/register-init.ts', // CLI glue — tested by E2E
    '!src/types/**/*.ts', // Type definitions
    '!src/version.ts', // Mocked in tests (uses import.meta.url)
    '!src/formats/php-parser-bridge.ts', // Mocked in tests (uses import.meta.url)
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'cobertura'],
  coverageThreshold: {
    global: {
      branches: 86,
      functions: 94,
      lines: 93,
      statements: 93,
    },
  },

  // Module resolution
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '(.*)/version\\.js$': '<rootDir>/tests/__mocks__/version',
    '(.*)/php-parser-bridge\\.js$': '<rootDir>/tests/__mocks__/php-parser-bridge',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Transform configuration
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Relaxed settings for tests
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        // TypeScript 6.0 stopped auto-including all @types/* packages globally;
        // declare the ones the test suite needs (jest globals + node).
        types: ['node', 'jest'],
      },
    }],
    '^.+\\.jsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        allowJs: true,
        types: ['node', 'jest'],
      },
    }],
  },

  // Transform ESM packages
  transformIgnorePatterns: [
    'node_modules/(?!(p-limit|yocto-queue|fast-glob|chalk|chokidar|readdirp|commander)/)',
  ],

  // Setup files
  globalSetup: '<rootDir>/tests/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  // Test timeout
  testTimeout: 10000,

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // KNOWN BENIGN WARNING: jest emits "A worker process has failed to exit
  // gracefully" at the end of every full-suite run. Stack traces lead to six
  // `nock(...).replyWithError(...)` test sites in deepl-client.test.ts and
  // three integration files. The leak is in nock v14 + @mswjs/interceptors:
  // each replyWithError call constructs a synthetic Node IncomingMessage
  // that is never drained, leaving an HTTPINCOMINGMESSAGE handle pinned in
  // the worker. The affected tests all PASS — only the orphaned handles
  // trigger the warning. `forceExit: true` does not suppress it (the warning
  // fires from the worker, not the main process, before forceExit applies),
  // and `--runInBand` eliminates it but is 5× slower. Fixing upstream
  // (nock/mswjs) is out of scope. Run `npm run test:debug` to audit for
  // any NEW leak source beyond the six known replyWithError sites.

  // Verbose output
  verbose: true,
};

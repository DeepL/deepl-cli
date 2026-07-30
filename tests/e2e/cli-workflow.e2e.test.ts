/**
 * E2E Tests for CLI Workflows
 * Tests complete user scenarios without requiring real API key
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createTestConfigDir, createTestDir, makeRunCLI } from '../helpers';

describe('CLI Workflow E2E', () => {
  const testFiles = createTestDir('e2e');
  const testConfig = createTestConfigDir('e2e-config');
  const testDir = testFiles.path;
  const testConfigDir = testConfig.path;
  const { runCLI, runCLIAll, runCLIExpectError } = makeRunCLI(testConfig.path);

  // Cache help outputs to avoid redundant process spawns
  let mainHelp: string;
  let translateHelp: string;
  let glossaryHelp: string;

  beforeAll(() => {
    mainHelp = execSync('deepl --help', { encoding: 'utf-8' });
    translateHelp = execSync('deepl translate --help', { encoding: 'utf-8' });
    glossaryHelp = execSync('deepl glossary --help', { encoding: 'utf-8' });
  });

  afterAll(() => {
    testFiles.cleanup();
    testConfig.cleanup();
  });

  describe('Help and Version Commands', () => {
    it('should display help for main command', () => {
      const output = mainHelp;

      expect(output).toContain('Usage:');
      expect(output).toContain('translate');
      expect(output).toContain('auth');
      expect(output).toContain('config');
      expect(output).toContain('cache');
      expect(output).toContain('glossary');
    });

    it('should display version', () => {
      const output = execSync('deepl --version', { encoding: 'utf-8' });

      // Should display a version number (e.g., 0.1.0)
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should display help for translate command', () => {
      const output = translateHelp;

      expect(output).toContain('Usage:');
      expect(output).toContain('--to');
      expect(output).toContain('--from');
      expect(output).toContain('--output');
      expect(output).toContain('--formality');
      expect(output).toContain('--preserve-code');
    });

    it('should display help for auth command', () => {
      const output = execSync('deepl auth --help', { encoding: 'utf-8' });

      expect(output).toContain('Usage:');
      expect(output).toContain('set-key');
      expect(output).toContain('show');
      expect(output).toContain('clear');
    });

    it('should display help for config command', () => {
      const output = execSync('deepl config --help', { encoding: 'utf-8' });

      expect(output).toContain('Usage:');
      expect(output).toContain('get');
      expect(output).toContain('set');
      expect(output).toContain('list');
      expect(output).toContain('reset');
    });

    it('should display help for cache command', () => {
      const output = execSync('deepl cache --help', { encoding: 'utf-8' });

      expect(output).toContain('Usage:');
      expect(output).toContain('stats');
      expect(output).toContain('clear');
      expect(output).toContain('enable');
      expect(output).toContain('disable');
    });

    it('should display help for glossary command', () => {
      const output = glossaryHelp;

      expect(output).toContain('Usage:');
      expect(output).toContain('create');
      expect(output).toContain('list');
      expect(output).toContain('show');
      expect(output).toContain('entries');
      expect(output).toContain('delete');
    });

    it('should document comma-separated target languages in glossary create help', () => {
      const output = execSync('deepl glossary create --help', {
        encoding: 'utf-8',
      });

      expect(output).toContain('comma-separated');
    });
  });

  describe('Configuration Workflow', () => {
    it('should complete config workflow: list → set → get → reset', () => {
      // Step 1: List all config values
      const listOutput = runCLI('deepl config list');
      expect(listOutput).toContain('auth');
      expect(listOutput).toContain('cache');
      expect(listOutput).toContain('defaults');

      // Step 2: Set a config value
      runCLI('deepl config set cache.enabled false');

      // Step 3: Get the value to verify
      const getValue = runCLI('deepl config get cache.enabled');
      expect(getValue.trim()).toBe('false');

      // Step 4: Reset config (success message goes to stderr via Logger.success)
      const resetOutput = runCLIAll('deepl config reset --yes');
      expect(resetOutput).toContain('reset');

      // Step 5: Verify reset worked (should be back to default true)
      const getAfterReset = runCLI('deepl config get cache.enabled');
      expect(getAfterReset.trim()).toBe('true');
    });

    it('should handle nested config values', () => {
      // Set nested value
      runCLI('deepl config set output.color false');

      // Get nested value
      const output = runCLI('deepl config get output.color');
      expect(output.trim()).toBe('false');

      // Reset
      runCLI('deepl config reset --yes');
    });

    it('should handle array config values', () => {
      // Set array value
      runCLI('deepl config set defaults.targetLangs es,fr,de');

      // Get array value
      const output = runCLI('deepl config get defaults.targetLangs');
      const parsed = JSON.parse(output.trim());
      expect(parsed).toEqual(['es', 'fr', 'de']);

      // Reset
      runCLI('deepl config reset --yes');
    });
  });

  describe('Cache Workflow', () => {
    it('should complete cache workflow: stats → clear → enable/disable commands', () => {
      // Step 1: Check initial stats
      const statsOutput = runCLI('deepl cache stats');
      expect(statsOutput).toContain('Cache Status:');
      expect(statsOutput).toContain('Entries:');

      // Step 2: Clear cache (success message goes to stderr via Logger.success)
      const clearOutput = runCLIAll('deepl cache clear --yes');
      expect(clearOutput).toContain('cleared');

      // Step 3: Verify cache is empty
      const statsAfterClear = runCLI('deepl cache stats');
      expect(statsAfterClear).toContain('Entries: 0');

      // Step 4: Test enable command (success message goes to stderr)
      const enableOutput = runCLIAll('deepl cache enable');
      expect(enableOutput).toContain('enabled');

      // Step 5: Test disable command (success message goes to stderr)
      const disableOutput = runCLIAll('deepl cache disable');
      expect(disableOutput).toContain('disabled');

      // Note: enable/disable commands work but don't persist to config,
      // so stats will always show the config value. This is documented as a known limitation.
    });
  });

  describe('Error Handling Workflow', () => {
    it('should require --to flag or config default for translation', () => {
      const env = { ...process.env, DEEPL_CONFIG_DIR: testConfigDir };
      (env as Record<string, string | undefined>)['DEEPL_API_KEY'] = undefined;

      expect.assertions(1);
      try {
        execSync('deepl translate "Hello"', {
          encoding: 'utf-8',
          stdio: 'pipe',
          env,
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        expect(output).toMatch(/--to|target language/i);
      }
    });

    it('should require --output flag for file translation', () => {
      // Create test file
      const testFile = path.join(testDir, 'test.txt');
      fs.writeFileSync(testFile, 'Hello world');

      expect.assertions(1);
      try {
        execSync(`deepl translate "${testFile}" --to es`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        expect(output).toMatch(/API key|auth|output/i);
      }
    });

    it('should handle non-existent config keys gracefully', () => {
      const output = runCLI('deepl config get nonexistent.key');
      expect(output.trim()).toBe('null');
    });

    it('should require API key for translation', () => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        DEEPL_CONFIG_DIR: testConfigDir,
      };
      delete env['DEEPL_API_KEY'];

      // Clear API key from config
      try {
        execSync('deepl auth clear', { encoding: 'utf-8', env });
      } catch {
        // Ignore if already cleared
      }

      expect.assertions(1);
      try {
        execSync('deepl translate "Hello" --to es', {
          encoding: 'utf-8',
          env,
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should handle invalid glossary file path', () => {
      const nonExistentFile = path.join(testDir, 'does-not-exist.tsv');

      expect.assertions(1);
      try {
        execSync(`deepl glossary create "test" en de "${nonExistentFile}"`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        expect(output).toMatch(/not found|does not exist|API key|auth/i);
      }
    });

    it('routes pre-handler coercer throws through handleError (--tm-threshold 80abc -> exit 6, no stack)', () => {
      expect.assertions(3);
      const result = runCLIExpectError(
        'deepl translate "Hi" --to de --tm-threshold 80abc',
        { stdio: 'pipe' },
      );
      expect(result.status).toBe(6);
      expect(result.output).toContain('--tm-threshold must be an integer');
      expect(result.output).not.toMatch(/\s+at\s+.+:\d+:\d+/);
    });
  });

  describe('Auth Command Workflow', () => {
    it('should complete auth workflow: show → clear → show again', () => {
      // Step 1: Try to show current key (just to check command works)
      try {
        runCLI('deepl auth show');
      } catch (error: any) {
        // If no key is set, that's expected
      }

      // Step 2: Clear the key (success message goes to stderr via Logger.success)
      const clearOutput = runCLIAll('deepl auth clear');
      expect(clearOutput).toMatch(/cleared|removed/i);

      // Step 3: Show should now indicate no key is set
      try {
        const output = runCLI('deepl auth show');
        expect(output).toMatch(/No API key set|not set|not configured/i);
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/not set|not configured/i);
      }
    });

    it('should reject invalid API key format', () => {
      expect.assertions(1);
      try {
        runCLI('deepl auth set-key "invalid-key"');
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/Authentication failed|invalid|error/i);
      }
    });

    it('should reject empty API key', () => {
      expect.assertions(1);
      try {
        runCLI('deepl auth set-key ""');
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/output-format.*invalid/i);
      }
    });

    it('should include output-format in help text', () => {
      const helpOutput = translateHelp;

      // Should mention output-format flag
      expect(helpOutput).toContain('--output-format');
      expect(helpOutput).toMatch(/format.*convert/i);
    });
  });

  describe('Glossary Languages Workflow', () => {
    it('should display glossary languages help text', () => {
      const helpOutput = glossaryHelp;

      // Should mention languages subcommand
      expect(helpOutput).toContain('languages');
      expect(helpOutput).toContain('List supported glossary language pairs');
    });

    it('should display help for glossary languages subcommand', () => {
      const helpOutput = execSync('deepl glossary languages --help', {
        encoding: 'utf-8',
      });

      expect(helpOutput).toContain('Usage:');
      expect(helpOutput).toContain('languages');
      expect(helpOutput).toContain('List supported glossary language pairs');
    });

    it('should require API key for glossary languages', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary languages', { excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should not require any arguments', () => {
      expect.assertions(2);
      try {
        runCLI('deepl glossary languages', { excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth, not missing arguments
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/required|missing.*argument/i);
      }
    });

    it('should exit with non-zero on authentication failure', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary languages', { excludeApiKey: true });
      } catch (error: any) {
        // Non-zero exit code
        expect(error.status).toBeGreaterThan(0);
      }
    });
  });

  describe('Glossary Entry Editing Workflow', () => {
    describe('add-entry command', () => {
      it('should display help for add-entry subcommand', () => {
        const helpOutput = execSync('deepl glossary add-entry --help', {
          encoding: 'utf-8',
        });

        expect(helpOutput).toContain('Usage:');
        expect(helpOutput).toContain('add-entry');
        expect(helpOutput).toContain('Add a new entry to a glossary');
        expect(helpOutput).toContain('<name-or-id>');
        expect(helpOutput).toContain('<source>');
        expect(helpOutput).toContain('<target>');
      });

      it('should mention add-entry in glossary help', () => {
        const helpOutput = glossaryHelp;

        expect(helpOutput).toContain('add-entry');
        expect(helpOutput).toContain('Add a new entry to a glossary');
      });

      it('should require all three arguments', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary add-entry');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });

      it('should require source and target arguments', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary add-entry "My Glossary"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });

      it('should require target argument', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary add-entry "My Glossary" "Hello"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });
    });

    describe('update-entry command', () => {
      it('should display help for update-entry subcommand', () => {
        const helpOutput = execSync('deepl glossary update-entry --help', {
          encoding: 'utf-8',
        });

        expect(helpOutput).toContain('Usage:');
        expect(helpOutput).toContain('update-entry');
        expect(helpOutput).toContain('Update an existing entry in a glossary');
        expect(helpOutput).toContain('<name-or-id>');
        expect(helpOutput).toContain('<source>');
        expect(helpOutput).toContain('<new-target>');
      });

      it('should mention update-entry in glossary help', () => {
        const helpOutput = glossaryHelp;

        expect(helpOutput).toContain('update-entry');
        expect(helpOutput).toContain('Update an existing entry in a glossary');
      });

      it('should require all three arguments', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary update-entry');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });

      it('should require source and new-target arguments', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary update-entry "My Glossary"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });

      it('should require new-target argument', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary update-entry "My Glossary" "Hello"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });
    });

    describe('remove-entry command', () => {
      it('should display help for remove-entry subcommand', () => {
        const helpOutput = execSync('deepl glossary remove-entry --help', {
          encoding: 'utf-8',
        });

        expect(helpOutput).toContain('Usage:');
        expect(helpOutput).toContain('remove-entry');
        expect(helpOutput).toContain('Remove an entry from a glossary');
        expect(helpOutput).toContain('<name-or-id>');
        expect(helpOutput).toContain('<source>');
      });

      it('should mention remove-entry in glossary help', () => {
        const helpOutput = glossaryHelp;

        expect(helpOutput).toContain('remove-entry');
        expect(helpOutput).toContain('Remove an entry from a glossary');
      });

      it('should require both arguments', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary remove-entry');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });

      it('should require source argument', () => {
        expect.assertions(1);
        try {
          runCLI('deepl glossary remove-entry "My Glossary"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/missing|argument|required/i);
        }
      });
    });

    describe('entry editing workflow', () => {
      it('should support complete workflow: create → add → update → remove', () => {
        expect.assertions(6);
        // Clear API key to test the workflow structure (will fail on auth)
        try {
          runCLI('deepl auth clear');
        } catch {
          // Ignore if already cleared
        }

        // Test that all commands are structured correctly (will fail on auth, not structure)
        try {
          runCLI('deepl glossary add-entry "tech-terms" "API" "Interfaz"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/API key|auth|not found/i);
          expect(output).not.toMatch(/invalid.*command|unknown.*command/i);
        }

        try {
          runCLI(
            'deepl glossary update-entry "tech-terms" "API" "API (Interfaz)"'
          );
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/API key|auth|not found/i);
          expect(output).not.toMatch(/invalid.*command|unknown.*command/i);
        }

        try {
          runCLI('deepl glossary remove-entry "tech-terms" "API"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          expect(output).toMatch(/API key|auth|not found/i);
          expect(output).not.toMatch(/invalid.*command|unknown.*command/i);
        }
      });

      it('should accept glossary ID in addition to name', () => {
        expect.assertions(1);
        // Clear API key
        try {
          runCLI('deepl auth clear');
        } catch {
          // Ignore if already cleared
        }

        // Test with a glossary ID format (UUID-like)
        try {
          runCLI('deepl glossary add-entry "abc123-def456" "Hello" "Hola"');
        } catch (error: any) {
          const output = error.stderr ?? error.stdout;
          // Should fail on auth or not found, not on ID format
          expect(output).toMatch(/API key|auth|not found/i);
        }
      });
    });

    describe('replace-dictionary subcommand', () => {
      it('should display replace-dictionary help text', () => {
        const helpOutput = execSync(
          'deepl glossary replace-dictionary --help',
          { encoding: 'utf-8' }
        );

        expect(helpOutput).toContain('Usage:');
        expect(helpOutput).toContain('replace-dictionary');
        expect(helpOutput).toContain('<name-or-id>');
        expect(helpOutput).toContain('<target-lang>');
        expect(helpOutput).toContain('<file>');
      });

      it('should mention replace-dictionary in glossary help', () => {
        const helpOutput = glossaryHelp;

        expect(helpOutput).toContain('replace-dictionary');
      });
    });
  });

  describe('Cost Transparency Workflow', () => {
    it('should display --show-billed-characters flag in translate help', () => {
      const helpOutput = translateHelp;

      expect(helpOutput).toContain('--show-billed-characters');
      expect(helpOutput).toMatch(/billed.*character/i);
      expect(helpOutput).toMatch(/cost.*transparency/i);
    });

    it('should accept --show-billed-characters flag without unknown option error', () => {
      expect.assertions(2);
      try {
        runCLI('deepl translate "Hello" --to es --show-billed-characters', {
          excludeApiKey: true,
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        // Should fail on auth, not on unknown option
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unknown.*option.*show-billed-characters/i);
      }
    });

    it('should support --show-billed-characters with other flags', () => {
      expect.assertions(3);
      try {
        runCLI(
          'deepl translate "Hello" --to es --from en --formality more --show-billed-characters',
          { excludeApiKey: true }
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        // Should fail on auth, not on flag combination
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).not.toMatch(/invalid.*flag/i);
      }
    });

    it('should support --show-billed-characters with JSON output format', () => {
      expect.assertions(2);
      try {
        runCLI(
          'deepl translate "Test" --to es --show-billed-characters --format json',
          { excludeApiKey: true }
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout ?? error.message;
        // Should fail on auth, not on flag parsing
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unknown.*option/i);
      }
    });

    it('should exit with non-zero when using --show-billed-characters without API key', () => {
      expect.assertions(1);
      try {
        runCLI('deepl translate "Hello" --to es --show-billed-characters', {
          excludeApiKey: true,
        });
      } catch (error: any) {
        // Non-zero exit code
        expect(error.status).toBeGreaterThan(0);
      }
    });
  });

  describe('Custom Instructions', () => {
    it('should accept --custom-instruction flag without error', () => {
      expect.assertions(2);
      try {
        runCLI(
          'deepl translate "Hello" --to es --custom-instruction "Use informal tone"',
          { excludeApiKey: true }
        );
      } catch (error: any) {
        // Should fail on API key, not flag parsing
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unknown.*option/i);
      }
    });

    it('should accept multiple --custom-instruction flags', () => {
      expect.assertions(1);
      try {
        runCLI(
          'deepl translate "Hello" --to es --custom-instruction "Be concise" --custom-instruction "Preserve acronyms"',
          { excludeApiKey: true }
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should combine --custom-instruction with other flags', () => {
      expect.assertions(2);
      try {
        runCLI(
          'deepl translate "Hello" --to es --custom-instruction "Use formal tone" --formality more --model-type quality_optimized',
          { excludeApiKey: true }
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unknown.*option/i);
      }
    });
  });

  describe('Style ID', () => {
    it('should accept --style-id flag without error', () => {
      expect.assertions(2);
      try {
        runCLI('deepl translate "Hello" --to es --style-id "abc-123-def-456"', {
          excludeApiKey: true,
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unknown.*option/i);
      }
    });

    it('should combine --style-id with other flags', () => {
      expect.assertions(2);
      try {
        runCLI(
          'deepl translate "Hello" --to es --style-id "abc-123" --formality more',
          { excludeApiKey: true }
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unknown.*option/i);
      }
    });
  });

  describe('Style Rules Command', () => {
    it('should show style-rules command in help', () => {
      const result = mainHelp;
      expect(result).toContain('style-rules');
    });

    it('should require API key for style-rules list', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules list', { excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should accept --detailed and pagination flags', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules list --detailed --page 1 --page-size 10');
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
      }
    });
  });

  describe('Expanded Language Support', () => {
    it('should accept extended language codes like Swahili', () => {
      expect.assertions(1);
      try {
        runCLI('deepl translate "Hello" --to sw');
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/Invalid target language/i);
      }
    });

    it('should accept ES-419 Latin American Spanish', () => {
      expect.assertions(1);
      try {
        runCLI('deepl translate "Hello" --to es-419');
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/Invalid target language/i);
      }
    });

    it('should accept Chinese simplified/traditional variants', () => {
      expect.assertions(1);
      try {
        runCLI('deepl translate "Hello" --to zh-hant');
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/Invalid target language/i);
      }
    });
  });

  describe('Tag Handling Version', () => {
    it('should accept --tag-handling-version flag', () => {
      expect.assertions(1);
      try {
        runCLI(
          'deepl translate "<p>Hello</p>" --to es --tag-handling html --tag-handling-version v2'
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
      }
    });
  });

  describe('Admin Command', () => {
    it('should show admin command in main help', () => {
      const output = mainHelp;
      expect(output).toContain('admin');
    });

    it('should display help for admin command', () => {
      const output = runCLI('deepl admin --help');
      expect(output).toContain('keys');
      expect(output).toContain('usage');
      expect(output).toContain('admin');
    });

    it('should display help for admin keys subcommand', () => {
      const output = runCLI('deepl admin keys --help');
      expect(output).toContain('list');
      expect(output).toContain('create');
      expect(output).toContain('deactivate');
      expect(output).toContain('rename');
      expect(output).toContain('set-limit');
    });

    it('should display help for admin usage subcommand', () => {
      const output = runCLI('deepl admin usage --help');
      expect(output).toContain('--start');
      expect(output).toContain('--end');
      expect(output).toContain('--group-by');
      expect(output).toContain('--format');
    });

    it('should require API key for admin keys list', () => {
      try {
        runCLI('deepl auth clear');
      } catch {
        // Ignore
      }

      expect.assertions(2);
      try {
        const env = {
          ...process.env,
          DEEPL_CONFIG_DIR: testConfigDir,
        } as NodeJS.ProcessEnv;
        delete env['DEEPL_API_KEY'];
        execSync('deepl admin keys list', {
          encoding: 'utf-8',
          env,
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
        expect(error.status).toBeGreaterThan(0);
      }
    });

    it('should require --start and --end flags for admin usage', () => {
      expect.assertions(2);
      try {
        execSync('deepl admin usage', {
          encoding: 'utf-8',
          env: { ...process.env, DEEPL_CONFIG_DIR: testConfigDir },
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/required|start/i);
        expect(error.status).toBeGreaterThan(0);
      }
    });
  });
});

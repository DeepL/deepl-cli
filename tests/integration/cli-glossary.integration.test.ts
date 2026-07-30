/**
 * Integration Tests for Glossary CLI Command
 * Tests the glossary command CLI behavior, subcommands, and validation
 */

import * as fs from 'fs';
import * as path from 'path';
import { createTestConfigDir, createTestDir, makeRunCLI } from '../helpers';

describe('Glossary CLI Integration', () => {
  const testConfig = createTestConfigDir('glossary');
  const testFiles = createTestDir('glossary-files');
  const { runCLI } = makeRunCLI(testConfig.path);
  const testDir = testFiles.path;

  afterAll(() => {
    testConfig.cleanup();
    testFiles.cleanup();
  });

  describe('deepl glossary --help', () => {
    it('should display help for glossary command', () => {
      const output = runCLI('deepl glossary --help');

      expect(output).toContain('Usage:');
      expect(output).toContain('deepl glossary');
      expect(output).toContain('Manage translation glossaries');
      expect(output).toContain('create');
      expect(output).toContain('list');
      expect(output).toContain('show');
      expect(output).toContain('entries');
      expect(output).toContain('delete');
    });
  });

  describe('deepl glossary without API key', () => {
    it('should require API key for glossary operations', () => {
      // Ensure no API key is set
      try {
        runCLI('deepl auth clear', { stdio: 'pipe' });
      } catch {
        // Ignore if already cleared
      }

      expect.assertions(1);
      try {
        runCLI('deepl glossary list', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should indicate API key is required
        expect(output).toMatch(/API key|auth|not set/i);
      }
    });
  });

  describe('glossary create', () => {
    it('should require name, source-lang, target-lang, and file arguments', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain(
        'create <name> <source-lang> <target-lang> <file>'
      );
      expect(helpOutput).toContain('Create a glossary from TSV/CSV file');
    });

    it('should validate missing file argument', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary create "Test" en de', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|file|API key|auth/i);
      }
    });

    it('should validate non-existent file', () => {
      const nonExistentFile = path.join(testDir, 'does-not-exist.tsv');

      expect.assertions(1);
      try {
        runCLI(`deepl glossary create "Test" en de "${nonExistentFile}"`, {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/not found|does not exist|API key|auth/i);
      }
    });

    it('should accept TSV file', () => {
      const tsvFile = path.join(testDir, 'glossary.tsv');
      fs.writeFileSync(tsvFile, 'Hello\tHola\nWorld\tMundo\n', 'utf-8');

      expect.assertions(2);
      try {
        // Will fail without API key but should recognize file type
        runCLI(`deepl glossary create "Test" en es "${tsvFile}"`, {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth, not file format
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/invalid.*format|unsupported/i);
      }
    });

    it('should accept CSV file', () => {
      const csvFile = path.join(testDir, 'glossary.csv');
      fs.writeFileSync(csvFile, 'Hello,Hola\nWorld,Mundo\n', 'utf-8');

      expect.assertions(1);
      try {
        // Will fail without API key but should recognize file type
        runCLI(`deepl glossary create "Test" en es "${csvFile}"`, {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should not fail on file format
        expect(output).not.toMatch(/invalid.*format|unsupported/i);
      }
    });

    it('should accept comma-separated target languages', () => {
      const tsvFile = path.join(testDir, 'glossary-multi.tsv');
      fs.writeFileSync(tsvFile, 'Hello\tHola\nWorld\tMundo\n', 'utf-8');

      expect.assertions(2);
      try {
        runCLI(`deepl glossary create "MultiTest" en de,fr,es "${tsvFile}"`, {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/unsupported|invalid.*format/i);
      }
    });
  });

  describe('glossary list', () => {
    it('should have list subcommand', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('list');
      expect(helpOutput).toContain('List all glossaries');
    });

    it('should not require any arguments', () => {
      expect.assertions(2);
      try {
        // Will fail without API key
        runCLI('deepl glossary list', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth, not missing arguments
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/required|missing.*argument/i);
      }
    });

    it('should accept --format json option', () => {
      const helpOutput = runCLI('deepl glossary list --help');
      expect(helpOutput).toContain('--format');
      expect(helpOutput).toContain('json');
    });
  });

  describe('glossary show', () => {
    it('should accept --format json option', () => {
      const helpOutput = runCLI('deepl glossary show --help');
      expect(helpOutput).toContain('--format');
      expect(helpOutput).toContain('json');
    });

    it('should require name-or-id argument', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('show');
      expect(helpOutput).toContain('<name-or-id>');
      expect(helpOutput).toContain('Show glossary details');
    });

    it('should validate missing argument', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary show', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should accept glossary name or ID', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept argument
        runCLI('deepl glossary show "My Glossary"', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });
  });

  describe('glossary entries', () => {
    it('should accept --format json option', () => {
      const helpOutput = runCLI('deepl glossary entries --help');
      expect(helpOutput).toContain('--format');
      expect(helpOutput).toContain('json');
    });

    it('should require name-or-id argument', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toMatch(/entries.*<name-or-id>/);
      expect(helpOutput).toContain('Show glossary entries');
    });

    it('should validate missing argument', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary entries', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should accept glossary name or ID', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept argument
        runCLI('deepl glossary entries "My Glossary"', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });
  });

  describe('glossary delete', () => {
    it('should require name-or-id argument', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toMatch(/delete.*<name-or-id>/);
      expect(helpOutput).toContain('Delete a glossary');
    });

    it('should validate missing argument', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary delete', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should accept glossary name or ID with --yes flag', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept argument
        runCLI('deepl glossary delete "My Glossary" --yes', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });

    it('should abort without --yes in non-TTY mode', () => {
      const { runCLIAll } = makeRunCLI(testConfig.path);
      const output = runCLIAll('deepl glossary delete "My Glossary"');
      expect(output).toContain('Aborted');
    });

    it('should accept -y short flag', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary delete "My Glossary" -y', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });

    it('should show --yes option in help', () => {
      const helpOutput = runCLI('deepl glossary delete --help');
      expect(helpOutput).toContain('--yes');
      expect(helpOutput).toContain('-y');
    });
  });

  describe('command structure', () => {
    it('should be available as a command', () => {
      const helpOutput = runCLI('deepl --help');

      // Glossary command should be listed in main help
      expect(helpOutput).toContain('glossary');
      expect(helpOutput).toContain('Manage translation glossaries');
    });

    it('should have subcommands', () => {
      const helpOutput = runCLI('deepl glossary --help');

      // Should show subcommands structure
      expect(helpOutput).toContain('Commands:');
      expect(helpOutput).toMatch(/create.*list.*show.*entries.*delete/s);
    });

    it('should support help for subcommands', () => {
      const helpOutput = runCLI('deepl glossary --help');

      // Should mention help command
      expect(helpOutput).toContain('help [command]');
    });
  });

  describe('file format support', () => {
    it('should mention TSV format', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('TSV');
    });

    it('should mention CSV format', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('CSV');
    });
  });

  describe('language validation', () => {
    it('should accept valid language pairs', () => {
      const tsvFile = path.join(testDir, 'valid-lang.tsv');
      fs.writeFileSync(tsvFile, 'test\tprueba\n', 'utf-8');

      expect.assertions(2);
      try {
        // Common language pairs
        runCLI(`deepl glossary create "Test" en es "${tsvFile}"`, {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth, not language validation
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/invalid.*language|unsupported.*language/i);
      }
    });
  });

  describe('glossary languages', () => {
    it('should have languages subcommand', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('languages');
      expect(helpOutput).toContain('List supported glossary language pairs');
    });

    it('should not require any arguments', () => {
      expect.assertions(2);
      try {
        // Will fail without API key
        runCLI('deepl glossary languages', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth, not missing arguments
        expect(output).toMatch(/API key|auth/i);
        expect(output).not.toMatch(/required|missing.*argument/i);
      }
    });

    it('should not accept extraneous arguments', () => {
      expect.assertions(1);
      try {
        // Will fail without API key, but should not accept extra args
        runCLI('deepl glossary languages extra-arg', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail (either too many args or auth)
        expect(output).toMatch(/argument|API key|auth/i);
      }
    });

    it('should accept --help flag', () => {
      const helpOutput = runCLI('deepl glossary languages --help');

      expect(helpOutput).toContain('languages');
      expect(helpOutput).toContain('List supported glossary language pairs');
    });
  });

  describe('glossary add-entry', () => {
    it('should have add-entry subcommand', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('add-entry');
      expect(helpOutput).toContain('Add a new entry to a glossary');
    });

    it('should require name-or-id, source, and target arguments', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toMatch(/add-entry.*<name-or-id>.*<source>.*<target>/);
    });

    it('should validate missing arguments', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary add-entry', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should validate missing source and target', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary add-entry "My Glossary"', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should validate missing target', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary add-entry "My Glossary" "Hello"', {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should accept all required arguments', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept arguments
        runCLI('deepl glossary add-entry "My Glossary" "Hello" "Hola"', {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });

    it('should accept --help flag', () => {
      const helpOutput = runCLI('deepl glossary add-entry --help');

      expect(helpOutput).toContain('add-entry');
      expect(helpOutput).toContain('Add a new entry to a glossary');
    });
  });

  describe('glossary update-entry', () => {
    it('should have update-entry subcommand', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('update-entry');
      expect(helpOutput).toContain('Update an existing entry in a glossary');
    });

    it('should require name-or-id, source, and new-target arguments', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toMatch(
        /update-entry.*<name-or-id>.*<source>.*<new-target>/
      );
    });

    it('should validate missing arguments', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary update-entry', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should validate missing source and new-target', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary update-entry "My Glossary"', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should validate missing new-target', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary update-entry "My Glossary" "Hello"', {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should accept all required arguments', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept arguments
        runCLI(
          'deepl glossary update-entry "My Glossary" "Hello" "Hola Updated"',
          { stdio: 'pipe' }
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });

    it('should accept --help flag', () => {
      const helpOutput = runCLI('deepl glossary update-entry --help');

      expect(helpOutput).toContain('update-entry');
      expect(helpOutput).toContain('Update an existing entry in a glossary');
    });
  });

  describe('glossary remove-entry', () => {
    it('should have remove-entry subcommand', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('remove-entry');
      expect(helpOutput).toContain('Remove an entry from a glossary');
    });

    it('should require name-or-id and source arguments', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toMatch(/remove-entry.*<name-or-id>.*<source>/);
    });

    it('should validate missing arguments', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary remove-entry', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should validate missing source', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary remove-entry "My Glossary"', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should accept all required arguments', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept arguments
        runCLI('deepl glossary remove-entry "My Glossary" "Hello"', {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });

    it('should accept --help flag', () => {
      const helpOutput = runCLI('deepl glossary remove-entry --help');

      expect(helpOutput).toContain('remove-entry');
      expect(helpOutput).toContain('Remove an entry from a glossary');
    });
  });

  describe('glossary rename', () => {
    it('should have rename subcommand', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('rename');
      expect(helpOutput).toContain('Rename a glossary');
    });

    it('should require name-or-id and new-name arguments', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('rename <name-or-id> <new-name>');
    });

    it('should validate missing arguments', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary rename', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should validate missing new-name', () => {
      expect.assertions(1);
      try {
        runCLI('deepl glossary rename "My Glossary"', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing|argument|required/i);
      }
    });

    it('should accept all required arguments', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept arguments
        runCLI('deepl glossary rename "My Glossary" "New Name"', {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });

    it('should accept glossary ID as identifier', () => {
      expect.assertions(1);
      try {
        // Will fail without API key but should accept ID format
        runCLI('deepl glossary rename "abc123-def456" "New Name"', {
          stdio: 'pipe',
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        // Should fail on auth or not found, not argument validation
        expect(output).toMatch(/API key|auth|not found/i);
      }
    });

    it('should accept --help flag', () => {
      const helpOutput = runCLI('deepl glossary rename --help');

      expect(helpOutput).toContain('rename');
      expect(helpOutput).toContain('Rename a glossary');
    });

    it('should show rename in glossary help', () => {
      const helpOutput = runCLI('deepl glossary --help');

      expect(helpOutput).toContain('rename');
      expect(helpOutput).toMatch(/rename.*<name-or-id>.*<new-name>/);
    });
  });
});

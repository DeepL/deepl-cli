/**
 * E2E Tests for Correct Command CLI
 * Tests the correct command surface: help, alias, flag validation, file input
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createTestDir } from '../helpers';

describe('Correct Command E2E', () => {
  const testFiles = createTestDir('correct-e2e');
  const testDir = testFiles.path;

  afterAll(() => {
    testFiles.cleanup();
  });

  describe('Help Command', () => {
    it('should display help for correct command', () => {
      const output = execSync('deepl correct --help', { encoding: 'utf-8' });

      expect(output).toContain('Usage:');
      expect(output).toContain('spelling and grammar');
      expect(output).toContain('--lang');
      expect(output).toContain('--alternatives');
      expect(output).toContain('--output');
      expect(output).toContain('--in-place');
      expect(output).toContain('--interactive');
      expect(output).toContain('--diff');
      expect(output).toContain('--check');
      expect(output).toContain('--fix');
      expect(output).toContain('--backup');
    });

    it('should not offer --style or --tone', () => {
      const output = execSync('deepl correct --help', { encoding: 'utf-8' });

      expect(output).not.toContain('--style');
      expect(output).not.toContain('--tone');
    });

    it('should resolve the c alias to correct', () => {
      const output = execSync('deepl c --help', { encoding: 'utf-8' });

      expect(output).toContain('correct');
      expect(output).toContain('--check');
    });
  });

  describe('Error Handling', () => {
    it('should accept correct without --lang flag (auto-detect)', () => {
      expect.assertions(1);
      try {
        execSync('deepl correct "test text"', { encoding: 'utf-8', stdio: 'pipe' });
      } catch (error: any) {
        // May fail on API key, but should NOT fail on missing --lang (exit code 1)
        expect(error.status).not.toBe(1);
      }
    });

    it('should reject invalid language code', () => {
      expect.assertions(1);
      try {
        execSync('deepl correct "test" --lang invalid', { encoding: 'utf-8', stdio: 'pipe' });
      } catch (error: any) {
        // Exit code 6 = InvalidInput (validation error)
        expect(error.status).toBe(6);
      }
    });

    it('should reject --style as an unknown option', () => {
      expect.assertions(2);
      try {
        execSync('deepl correct "test" --style business', { encoding: 'utf-8', stdio: 'pipe' });
      } catch (error: any) {
        expect(error.status).not.toBe(0);
        expect(error.stderr?.toString() ?? '').toMatch(/unknown option/i);
      }
    });

    it('should reject --tone as an unknown option', () => {
      expect.assertions(2);
      try {
        execSync('deepl correct "test" --tone friendly', { encoding: 'utf-8', stdio: 'pipe' });
      } catch (error: any) {
        expect(error.status).not.toBe(0);
        expect(error.stderr?.toString() ?? '').toMatch(/unknown option/i);
      }
    });

    it('should reject conflicting --to and --lang values', () => {
      expect.assertions(1);
      try {
        execSync('deepl correct "test" --to de --lang fr', { encoding: 'utf-8', stdio: 'pipe' });
      } catch (error: any) {
        expect(error.status).toBe(6);
      }
    });
  });

  describe('File Operations', () => {
    it('should recognize file path input', () => {
      const testFile = path.join(testDir, 'test.txt');
      fs.writeFileSync(testFile, 'Test content', 'utf-8');

      // This will fail without API key, but should recognize it as a file operation
      expect.assertions(1);
      try {
        execSync(`deepl correct "${testFile}" --lang en-US`, { encoding: 'utf-8', stdio: 'pipe' });
      } catch (error: any) {
        // Expected to fail without API key, but should not error on file path recognition
        const stderr = error.stderr?.toString() ?? '';
        expect(stderr).not.toContain('File not found');
      }
    });
  });
});

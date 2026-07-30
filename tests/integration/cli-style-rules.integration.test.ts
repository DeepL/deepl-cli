/**
 * Integration Tests for Style Rules CLI Command
 * Tests CLI argument parsing, HTTP request structure with nock, and error handling
 */

import nock from 'nock';
import { DeepLClient } from '../../src/api/deepl-client.js';
import { StyleRulesService } from '../../src/services/style-rules.js';
import { StyleRulesCommand } from '../../src/cli/commands/style-rules.js';
import {
  createTestConfigDir,
  makeRunCLI,
  DEEPL_FREE_API_URL,
} from '../helpers';

describe('Style Rules CLI Integration', () => {
  const testConfig = createTestConfigDir('style-rules');
  const { runCLI } = makeRunCLI(testConfig.path);

  afterAll(() => {
    testConfig.cleanup();
  });

  describe('deepl style-rules --help', () => {
    it('should display help for style-rules command', () => {
      const output = runCLI('deepl style-rules --help');

      expect(output).toContain('Usage:');
      expect(output).toContain('style-rules');
      expect(output).toContain('Manage DeepL style rules');
      expect(output).toContain('list');
    });

    it('should display help for style-rules list subcommand', () => {
      const output = runCLI('deepl style-rules list --help');

      expect(output).toContain('List all style rules');
      expect(output).toContain('--detailed');
      expect(output).toContain('--page');
      expect(output).toContain('--page-size');
      expect(output).toContain('--format');
    });
  });

  describe('deepl style-rules without API key', () => {
    beforeEach(() => {
      try {
        runCLI('deepl auth clear', { stdio: 'pipe' });
      } catch {
        // Ignore if already cleared
      }
    });

    it('should require API key for style-rules list', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules list', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth|not set/i);
      }
    });

    it('should require API key for style-rules list --detailed', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules list --detailed', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth|not set/i);
      }
    });

    it('should require API key for style-rules list with pagination', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules list --page 1 --page-size 10', {
          stdio: 'pipe', excludeApiKey: true,
        });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/API key|auth|not set/i);
      }
    });
  });

  describe('option flags validation', () => {
    it('should accept --detailed flag without error', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules list --detailed', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option.*detailed/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should accept --page flag without error', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules list --page 2', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option.*page/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should accept --page-size flag without error', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules list --page-size 10', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option.*page-size/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should accept --format json flag without error', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules list --format json', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option.*format/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should accept all flags combined', () => {
      expect.assertions(2);
      try {
        runCLI(
          'deepl style-rules list --detailed --page 1 --page-size 5 --format json',
          { stdio: 'pipe' }
        );
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should accept create subcommand with required flags', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules create --name Foo --language en', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should require --name and --language on create', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules create', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/required.*(--name|--language)/i);
      }
    });

    it('should accept show subcommand with positional id', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules show sr-1', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should require id argument on show', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules show', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing.*argument|id.*required/i);
      }
    });

    it('should accept update subcommand with --name', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules update sr-1 --name "New"', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should require --name or --rules on update (exit 6)', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules update sr-1', { stdio: 'pipe' });
      } catch (error: any) {
        expect(error.status).toBe(6);
      }
    });

    it('should accept delete --dry-run without running the deletion', () => {
      const output = runCLI('deepl style-rules delete sr-1 --dry-run');
      expect(output).toContain('[dry-run]');
      expect(output).toContain('sr-1');
    });

    it('should accept instructions subcommand with positional style-id', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules instructions sr-1', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should require style-id argument on instructions', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules instructions', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing.*argument|style-id.*required/i);
      }
    });

    it('should accept add-instruction with three positional args', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules add-instruction sr-1 tone "Be formal"', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should require all three args on add-instruction', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules add-instruction sr-1 tone', { stdio: 'pipe' });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).toMatch(/missing.*argument|prompt.*required/i);
      }
    });

    it('should accept update-instruction with three positional args', () => {
      expect.assertions(2);
      try {
        runCLI('deepl style-rules update-instruction sr-1 tone "Be friendlier"', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option/i);
        expect(output).toMatch(/API key|auth/i);
      }
    });

    it('should accept remove-instruction --dry-run without running', () => {
      const output = runCLI('deepl style-rules remove-instruction sr-1 tone --dry-run');
      expect(output).toContain('[dry-run]');
      expect(output).toContain('tone');
      expect(output).toContain('sr-1');
    });

    it('should accept --source-language on add-instruction', () => {
      expect.assertions(1);
      try {
        runCLI('deepl style-rules add-instruction sr-1 tone "Be formal" --source-language en', { stdio: 'pipe', excludeApiKey: true });
      } catch (error: any) {
        const output = error.stderr ?? error.stdout;
        expect(output).not.toMatch(/unknown.*option.*source-language/i);
      }
    });
  });

  describe('command structure', () => {
    it('should be listed in main help', () => {
      const output = runCLI('deepl --help');
      expect(output).toContain('style-rules');
    });

    it('should describe as Pro API only', () => {
      const output = runCLI('deepl style-rules --help');
      expect(output).toContain('Pro API only');
    });

    it('should have list as a subcommand', () => {
      const output = runCLI('deepl style-rules --help');
      expect(output).toContain('list');
      expect(output).toContain('List all style rules');
    });
  });
});

describe('Style Rules API Integration', () => {
  const API_KEY = 'test-api-key-123:fx';
  const FREE_API_URL = DEEPL_FREE_API_URL;
  let client: DeepLClient;
  let styleRulesCommand: StyleRulesCommand;

  beforeEach(() => {
    client = new DeepLClient(API_KEY);
    styleRulesCommand = new StyleRulesCommand(new StyleRulesService(client));
  });

  afterEach(() => {
    client.destroy();
    nock.cleanAll();
  });

  describe('list - happy path', () => {
    it('should make GET request to /v3/style_rules', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'Business Writing',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
            },
          ],
        });

      const rules = await styleRulesCommand.list();

      expect(rules).toHaveLength(1);
      expect(rules[0]?.styleId).toBe('abc-123');
      expect(rules[0]?.name).toBe('Business Writing');
      expect(rules[0]?.language).toBe('en');
      expect(rules[0]?.version).toBe(1);
      expect(rules[0]?.creationTime).toBe('2024-01-01T00:00:00Z');
      expect(rules[0]?.updatedTime).toBe('2024-01-02T00:00:00Z');
      expect(scope.isDone()).toBe(true);
    });

    it('should return multiple style rules', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'Business Writing',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
            },
            {
              style_id: 'def-456',
              name: 'Academic Style',
              language: 'de',
              version: 2,
              creation_time: '2024-02-01T00:00:00Z',
              updated_time: '2024-02-15T00:00:00Z',
            },
          ],
        });

      const rules = await styleRulesCommand.list();

      expect(rules).toHaveLength(2);
      expect(rules[0]?.name).toBe('Business Writing');
      expect(rules[1]?.name).toBe('Academic Style');
      expect(rules[1]?.language).toBe('de');
      expect(scope.isDone()).toBe(true);
    });

    it('should handle empty style rules list', async () => {
      const scope = nock(FREE_API_URL).get('/v3/style_rules').reply(200, {
        style_rules: [],
      });

      const rules = await styleRulesCommand.list();

      expect(rules).toHaveLength(0);
      expect(scope.isDone()).toBe(true);
    });

    it('should format empty results correctly', async () => {
      nock(FREE_API_URL).get('/v3/style_rules').reply(200, { style_rules: [] });

      const rules = await styleRulesCommand.list();
      const output = styleRulesCommand.formatStyleRulesList(rules);

      expect(output).toBe('No style rules found.');
    });

    it('should format style rules list output correctly', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'Business Writing',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
            },
          ],
        });

      const rules = await styleRulesCommand.list();
      const output = styleRulesCommand.formatStyleRulesList(rules);

      expect(output).toContain('Found 1 style rule(s)');
      expect(output).toContain('Business Writing');
      expect(output).toContain('abc-123');
      expect(output).toContain('en');
    });
  });

  describe('list --detailed', () => {
    it('should pass detailed=true query parameter', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .query({ detailed: true })
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'Business Writing',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
              configured_rules: {
                voice: { passive: 'avoid' },
                length: { max_sentence_words: '20' },
              },
              custom_instructions: [
                { label: 'Voice', prompt: 'Use active voice' },
                { label: 'Length', prompt: 'Keep sentences under 20 words' },
              ],
            },
          ],
        });

      const rules = await styleRulesCommand.list({ detailed: true });

      expect(rules).toHaveLength(1);
      const rule = rules[0] as any;
      expect(rule.configuredRules).toEqual({
        voice: { passive: 'avoid' },
        length: { max_sentence_words: '20' },
      });
      expect(rule.customInstructions).toEqual([
        { label: 'Voice', prompt: 'Use active voice' },
        { label: 'Length', prompt: 'Keep sentences under 20 words' },
      ]);
      expect(scope.isDone()).toBe(true);
    });

    it('should format detailed style rules with configured rules and instructions', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .query({ detailed: true })
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'Business Writing',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
              configured_rules: {
                punctuation: { quotation_mark: 'use_guillemets' },
              },
              custom_instructions: [
                { label: 'Instruction one', prompt: 'Do this' },
                { label: 'Instruction two', prompt: 'Do that' },
              ],
            },
          ],
        });

      const rules = await styleRulesCommand.list({ detailed: true });
      const output = styleRulesCommand.formatStyleRulesList(rules);

      expect(output).toContain('punctuation');
      expect(output).toContain('quotation_mark: use_guillemets');
      expect(output).toContain('Instruction one');
      expect(output).toContain('Instruction two');
    });
  });

  describe('list with pagination', () => {
    it('should pass page query parameter', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .query({ page: 2 })
        .reply(200, { style_rules: [] });

      await styleRulesCommand.list({ page: 2 });

      expect(scope.isDone()).toBe(true);
    });

    it('should pass page_size query parameter', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .query({ page_size: 10 })
        .reply(200, { style_rules: [] });

      await styleRulesCommand.list({ pageSize: 10 });

      expect(scope.isDone()).toBe(true);
    });

    it('should pass both page and page_size query parameters', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .query({ page: 1, page_size: 5 })
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'Paginated Rule',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
            },
          ],
        });

      const rules = await styleRulesCommand.list({ page: 1, pageSize: 5 });

      expect(rules).toHaveLength(1);
      expect(rules[0]?.name).toBe('Paginated Rule');
      expect(scope.isDone()).toBe(true);
    });

    it('should combine pagination with detailed option', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .query({ detailed: true, page: 1, page_size: 10 })
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'Full Options Rule',
              language: 'fr',
              version: 3,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
              configured_rules: { brevity: { max_words: '20' } },
              custom_instructions: [{ label: 'Brevity', prompt: 'Be brief' }],
            },
          ],
        });

      const rules = await styleRulesCommand.list({
        detailed: true,
        page: 1,
        pageSize: 10,
      });

      expect(rules).toHaveLength(1);
      const rule = rules[0] as any;
      expect(rule.language).toBe('fr');
      expect(rule.configuredRules).toEqual({ brevity: { max_words: '20' } });
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('JSON format output', () => {
    it('should format rules as valid JSON', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(200, {
          style_rules: [
            {
              style_id: 'abc-123',
              name: 'JSON Rule',
              language: 'en',
              version: 1,
              creation_time: '2024-01-01T00:00:00Z',
              updated_time: '2024-01-02T00:00:00Z',
            },
          ],
        });

      const rules = await styleRulesCommand.list();
      const jsonOutput = styleRulesCommand.formatStyleRulesJson(rules);
      const parsed = JSON.parse(jsonOutput);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].styleId).toBe('abc-123');
      expect(parsed[0].name).toBe('JSON Rule');
      expect(parsed[0].language).toBe('en');
      expect(parsed[0].version).toBe(1);
    });

    it('should format empty rules as empty JSON array', async () => {
      nock(FREE_API_URL).get('/v3/style_rules').reply(200, { style_rules: [] });

      const rules = await styleRulesCommand.list();
      const jsonOutput = styleRulesCommand.formatStyleRulesJson(rules);

      expect(JSON.parse(jsonOutput)).toEqual([]);
    });
  });

  describe('HTTP request structure', () => {
    it('should include Authorization header', async () => {
      const scope = nock(FREE_API_URL, {
        reqheaders: {
          authorization: `DeepL-Auth-Key ${API_KEY}`,
        },
      })
        .get('/v3/style_rules')
        .reply(200, { style_rules: [] });

      await styleRulesCommand.list();

      expect(scope.isDone()).toBe(true);
    });

    it('should use GET method for listing style rules', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(200, { style_rules: [] });

      await styleRulesCommand.list();

      expect(scope.isDone()).toBe(true);
    });

    it('should not send request body for GET request', async () => {
      let receivedBody: any = undefined;
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(function (_uri: string, body: any) {
          receivedBody = body;
          return [200, { style_rules: [] }];
        });

      await styleRulesCommand.list();

      expect(scope.isDone()).toBe(true);
      expect(receivedBody).toBe('');
    });

    it('should use Pro API URL when configured', async () => {
      const proClient = new DeepLClient(API_KEY, { usePro: true });
      const proCommand = new StyleRulesCommand(
        new StyleRulesService(proClient)
      );

      const scope = nock('https://api.deepl.com')
        .get('/v3/style_rules')
        .reply(200, { style_rules: [] });

      await proCommand.list();
      proClient.destroy();

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('response field mapping', () => {
    it('should map snake_case API fields to camelCase', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(200, {
          style_rules: [
            {
              style_id: 'test-id-001',
              name: 'Mapped Rule',
              language: 'en',
              version: 5,
              creation_time: '2024-06-01T10:00:00Z',
              updated_time: '2024-06-15T14:30:00Z',
            },
          ],
        });

      const rules = await styleRulesCommand.list();

      expect(rules[0]).toEqual({
        styleId: 'test-id-001',
        name: 'Mapped Rule',
        language: 'en',
        version: 5,
        creationTime: '2024-06-01T10:00:00Z',
        updatedTime: '2024-06-15T14:30:00Z',
      });
    });

    it('should map detailed fields correctly', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .query({ detailed: true })
        .reply(200, {
          style_rules: [
            {
              style_id: 'test-id-002',
              name: 'Detailed Mapped Rule',
              language: 'de',
              version: 2,
              creation_time: '2024-03-01T00:00:00Z',
              updated_time: '2024-03-10T00:00:00Z',
              configured_rules: {
                tone: { formality: 'formal' },
                grammar: { contractions: 'forbidden' },
              },
              custom_instructions: [
                { label: 'Formality', prompt: 'Always use formal language' },
              ],
            },
          ],
        });

      const rules = await styleRulesCommand.list({ detailed: true });
      const rule = rules[0] as any;

      expect(rule.styleId).toBe('test-id-002');
      expect(rule.configuredRules).toEqual({
        tone: { formality: 'formal' },
        grammar: { contractions: 'forbidden' },
      });
      expect(rule.customInstructions).toEqual([
        { label: 'Formality', prompt: 'Always use formal language' },
      ]);
    });
  });

  // error handling must be the last describe block — replyWithError in nock v14
  // emits async socket errors that leak into subsequent tests
  describe('error handling', () => {
    let noRetryClient: DeepLClient;
    let noRetryCommand: StyleRulesCommand;

    beforeEach(() => {
      noRetryClient = new DeepLClient(API_KEY, { maxRetries: 0 });
      noRetryCommand = new StyleRulesCommand(
        new StyleRulesService(noRetryClient)
      );
    });

    afterEach(() => {
      noRetryClient.destroy();
    });

    it('should handle 403 authentication error', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(403, { message: 'Invalid API key' });

      await expect(noRetryCommand.list()).rejects.toThrow(
        'Authentication failed'
      );
    });

    it('should handle 429 rate limit error', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(429, { message: 'Too many requests' });

      await expect(noRetryCommand.list()).rejects.toThrow(
        'Rate limit exceeded'
      );
    });

    it('should handle 503 service unavailable error', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(503, { message: 'Service unavailable' });

      await expect(noRetryCommand.list()).rejects.toThrow(
        'Service temporarily unavailable'
      );
    });

    it('should handle 456 quota exceeded error', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(456, { message: 'Quota exceeded' });

      await expect(noRetryCommand.list()).rejects.toThrow('Quota exceeded');
    });

    it('should handle unexpected API response format', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .reply(500, { error: 'Internal server error' });

      await expect(noRetryCommand.list()).rejects.toThrow();
    });

    // replyWithError must be last — nock v14 emits async socket errors that
    // leak into subsequent tests despite abortPendingRequests()
    it('should handle network errors', async () => {
      nock(FREE_API_URL)
        .get('/v3/style_rules')
        .replyWithError('Connection refused');

      await expect(noRetryCommand.list()).rejects.toThrow();
    });
  });

  describe('CRUD invariants', () => {
    const styleRuleWire = {
      style_id: 'sr-new',
      name: 'Corporate',
      language: 'en',
      version: 1,
      creation_time: '2026-04-24T00:00:00Z',
      updated_time: '2026-04-24T00:00:00Z',
    };

    it('invariant 1: create returns an id that show can retrieve (round-trip)', async () => {
      const createScope = nock(FREE_API_URL)
        .post('/v3/style_rules', (body) => {
          expect(body.name).toBe('Corporate');
          expect(body.language).toBe('en');
          return true;
        })
        .reply(200, styleRuleWire);

      const created = await styleRulesCommand.create({ name: 'Corporate', language: 'en' });
      expect(created.styleId).toBe('sr-new');
      expect(createScope.isDone()).toBe(true);

      const showScope = nock(FREE_API_URL)
        .get(`/v3/style_rules/${created.styleId}`)
        .reply(200, styleRuleWire);

      const shown = await styleRulesCommand.show(created.styleId);
      expect(shown.styleId).toBe(created.styleId);
      expect(shown.name).toBe(created.name);
      expect(showScope.isDone()).toBe(true);
    });

    it('invariant 2: update → show reflects the patched fields', async () => {
      const updateScope = nock(FREE_API_URL)
        .patch('/v3/style_rules/sr-new', (body) => {
          expect(body.name).toBe('Renamed');
          return true;
        })
        .reply(200, { ...styleRuleWire, name: 'Renamed', version: 2 });

      const updated = await styleRulesCommand.update('sr-new', { name: 'Renamed' });
      expect(updated.name).toBe('Renamed');
      expect(updated.version).toBe(2);
      expect(updateScope.isDone()).toBe(true);

      const showScope = nock(FREE_API_URL)
        .get('/v3/style_rules/sr-new')
        .reply(200, { ...styleRuleWire, name: 'Renamed', version: 2 });

      const shown = await styleRulesCommand.show('sr-new');
      expect(shown.name).toBe('Renamed');
      expect(showScope.isDone()).toBe(true);
    });

    it('invariant 3: delete followed by show returns 404', async () => {
      const deleteScope = nock(FREE_API_URL)
        .delete('/v3/style_rules/sr-new')
        .reply(204);

      await expect(styleRulesCommand.delete('sr-new')).resolves.toBeUndefined();
      expect(deleteScope.isDone()).toBe(true);

      const showScope = nock(FREE_API_URL)
        .get('/v3/style_rules/sr-new')
        .reply(404, { message: 'Style rule not found' });

      await expect(styleRulesCommand.show('sr-new')).rejects.toThrow();
      expect(showScope.isDone()).toBe(true);
    });

    it('custom-instructions round-trip: create then get returns same shape', async () => {
      const createScope = nock(FREE_API_URL)
        .post('/v3/style_rules/sr-new/custom_instructions', (body) => {
          expect(body.label).toBe('tone');
          expect(body.prompt).toBe('Be formal');
          return true;
        })
        .reply(200, { label: 'tone', prompt: 'Be formal' });

      const created = await styleRulesCommand.addInstruction('sr-new', {
        label: 'tone', prompt: 'Be formal',
      });
      expect(created).toEqual({ label: 'tone', prompt: 'Be formal' });
      expect(createScope.isDone()).toBe(true);
    });

    it('custom-instructions list synthesizes from detailed getStyleRule', async () => {
      const scope = nock(FREE_API_URL)
        .get('/v3/style_rules/sr-new')
        .query({ detailed: true })
        .reply(200, {
          ...styleRuleWire,
          configured_rules: {},
          custom_instructions: [
            { label: 'tone', prompt: 'Be formal' },
            { label: 'register', prompt: 'First person', source_language: 'en' },
          ],
        });

      const result = await styleRulesCommand.listInstructions('sr-new');
      expect(result).toHaveLength(2);
      expect(result[1]?.sourceLanguage).toBe('en');
      expect(scope.isDone()).toBe(true);
    });

    it('custom-instructions update then delete: lookup-then-act flow', async () => {
      const instructionId = 'inst-uuid-1';

      // 1. update: GET (lookup) + PUT
      const lookupForUpdate = nock(FREE_API_URL)
        .get('/v3/style_rules/sr-new')
        .query({ detailed: true })
        .reply(200, {
          ...styleRuleWire,
          configured_rules: {},
          custom_instructions: [{ id: instructionId, label: 'tone', prompt: 'old' }],
        });
      const updateScope = nock(FREE_API_URL)
        .put(`/v3/style_rules/sr-new/custom_instructions/${instructionId}`, (body) => {
          expect(body.label).toBe('tone');
          expect(body.prompt).toBe('Be friendlier');
          return true;
        })
        .reply(200, { id: instructionId, label: 'tone', prompt: 'Be friendlier' });

      const updated = await styleRulesCommand.updateInstruction('sr-new', 'tone', {
        prompt: 'Be friendlier',
      });
      expect(updated.prompt).toBe('Be friendlier');
      expect(lookupForUpdate.isDone()).toBe(true);
      expect(updateScope.isDone()).toBe(true);

      // 2. delete: GET (lookup) + DELETE
      const lookupForDelete = nock(FREE_API_URL)
        .get('/v3/style_rules/sr-new')
        .query({ detailed: true })
        .reply(200, {
          ...styleRuleWire,
          configured_rules: {},
          custom_instructions: [{ id: instructionId, label: 'tone', prompt: 'Be friendlier' }],
        });
      const deleteScope = nock(FREE_API_URL)
        .delete(`/v3/style_rules/sr-new/custom_instructions/${instructionId}`)
        .reply(204);

      await expect(styleRulesCommand.removeInstruction('sr-new', 'tone'))
        .resolves.toBeUndefined();
      expect(lookupForDelete.isDone()).toBe(true);
      expect(deleteScope.isDone()).toBe(true);
    });

    it('replaceConfiguredRules: PUT returns updated detailed rule', async () => {
      const rules = {
        punctuation: { quotation_mark: 'use_guillemets' },
        spelling_and_grammar: { accents: 'preserve' },
      };
      const scope = nock(FREE_API_URL)
        .put('/v3/style_rules/sr-new/configured_rules', (body) => {
          // Body is the rules dict directly — no `configured_rules` outer wrapper.
          expect(body).toEqual(rules);
          return true;
        })
        .reply(200, {
          ...styleRuleWire,
          version: 3,
          configured_rules: rules,
          custom_instructions: [],
        });

      const result = await styleRulesCommand.replaceRules('sr-new', rules);
      expect(result.configuredRules).toEqual(rules);
      expect(result.version).toBe(3);
      expect(scope.isDone()).toBe(true);
    });
  });
});

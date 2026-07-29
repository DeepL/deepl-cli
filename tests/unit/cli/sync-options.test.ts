import { Command } from 'commander';
import {
  parseLocaleFilter,
  resolveLocale,
  resolveSyncConfig,
} from '../../../src/cli/commands/sync/sync-options';

describe('sync-options', () => {
  function childOf(parentOpts: Record<string, unknown>): Command {
    const parent = new Command('sync');
    const child = parent.command('status');
    Object.assign(parent.opts(), parentOpts);
    return child;
  }

  describe('resolveLocale', () => {
    it('prefers the subcommand value', () => {
      expect(resolveLocale({ locale: 'de' }, childOf({ locale: 'fr' }))).toBe('de');
    });

    it('falls back to the parent value', () => {
      expect(resolveLocale({}, childOf({ locale: 'fr' }))).toBe('fr');
    });

    it('returns undefined when neither scope has a value', () => {
      expect(resolveLocale({}, childOf({}))).toBeUndefined();
    });
  });

  describe('resolveSyncConfig', () => {
    it('prefers the subcommand value', () => {
      expect(resolveSyncConfig({ syncConfig: 'a.yaml' }, childOf({ syncConfig: 'b.yaml' }))).toBe(
        'a.yaml',
      );
    });

    it('falls back to the parent value', () => {
      expect(resolveSyncConfig({}, childOf({ syncConfig: 'b.yaml' }))).toBe('b.yaml');
    });

    it('returns undefined when neither scope has a value', () => {
      expect(resolveSyncConfig({}, childOf({}))).toBeUndefined();
    });
  });

  describe('parseLocaleFilter', () => {
    it('splits and trims a comma-separated list', () => {
      expect(parseLocaleFilter('de, fr ,ja')).toEqual(['de', 'fr', 'ja']);
    });

    it('returns undefined for an absent or empty value', () => {
      expect(parseLocaleFilter(undefined)).toBeUndefined();
      expect(parseLocaleFilter('')).toBeUndefined();
    });
  });
});

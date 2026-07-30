/**
 * Tests for package.json publish-surface invariants
 *
 * These guard properties that are easy to lose in a merge and expensive to
 * lose silently — e.g. without the `clean` script a stale `dist/` reaches
 * `npm pack`.
 */

import * as fs from 'fs';
import * as path from 'path';

interface PackageManifest {
  name: string;
  version: string;
  publishConfig?: { access?: string };
  repository: { type: string; url: string };
  bugs: { url: string };
  homepage: string;
  scripts: {
    clean?: string;
    build: string;
    prepublishOnly: string;
    'check-deps'?: string;
  };
  files: string[];
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('package.json manifest', () => {
  let pkg: PackageManifest;

  beforeAll(() => {
    const manifestPath = path.join(__dirname, '..', '..', 'package.json');
    pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PackageManifest;
  });

  describe('clean script', () => {
    it('should define a clean script', () => {
      expect(pkg.scripts.clean).toBeDefined();
    });

    it('should remove dist so renames cannot leak stale output to npm publish', () => {
      expect(pkg.scripts.clean).toContain('dist');
    });

    it('should remove the TypeScript build info file', () => {
      // Without this, tsc's incremental cache reports the deleted output as
      // up-to-date and emits nothing, leaving dist empty after a clean.
      expect(pkg.scripts.clean).toContain('tsbuildinfo');
    });
  });

  describe('build script', () => {
    it('should run clean before compiling', () => {
      expect(pkg.scripts.build).toMatch(/^npm run clean &&/);
    });

    it('should make the CLI entrypoint executable', () => {
      expect(pkg.scripts.build).toContain('chmod +x');
    });
  });

  describe('publish surface', () => {
    it('should rebuild from scratch before publishing', () => {
      expect(pkg.scripts.prepublishOnly).toContain('build');
    });

    it('should exclude source maps and build info from the tarball', () => {
      const excluded = pkg.files.filter((entry) => entry.startsWith('!'));
      expect(excluded).toContain('!dist/**/*.tsbuildinfo');
      expect(excluded).toContain('!dist/**/*.js.map');
    });

    it('should point bin at a path inside dist', () => {
      expect(Object.values(pkg.bin).every((target) => target.startsWith('dist/'))).toBe(true);
    });
  });

  describe('runtime dependencies', () => {
    // Consumers install dependencies only. A package imported by src/ but
    // declared under devDependencies resolves in this tree and fails on every
    // real install, and dependency ranges cannot be changed after publish.
    it.each(['@inquirer/prompts', 'diff'])('should declare %s as a runtime dependency', (name) => {
      expect(pkg.dependencies[name]).toBeDefined();
      expect(pkg.devDependencies[name]).toBeUndefined();
    });

    it('should not declare packages that no source file imports', () => {
      expect(pkg.dependencies['inquirer']).toBeUndefined();
    });

    it('should expose the dependency check as a script so CI can gate on it', () => {
      expect(pkg.scripts['check-deps']).toContain('check-dependencies');
    });
  });

  describe('publish identity', () => {
    it('should be the scoped @deepl/cli package', () => {
      expect(pkg.name).toBe('@deepl/cli');
    });

    it('should keep the bin name deepl regardless of the package scope', () => {
      expect(Object.keys(pkg.bin)).toEqual(['deepl']);
    });

    it('should publish publicly — scoped packages default to restricted', () => {
      expect(pkg.publishConfig?.access).toBe('public');
    });

    it('should point repository metadata at the DeepL org, not the legacy DeepLcom redirect', () => {
      expect(pkg.repository.url).toBe('https://github.com/DeepL/deepl-cli');
      expect(pkg.bugs.url).toBe('https://github.com/DeepL/deepl-cli/issues');
      expect(pkg.homepage).toBe('https://github.com/DeepL/deepl-cli#readme');
    });
  });
});

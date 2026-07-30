#!/usr/bin/env node
/**
 * Verifies that every external package referenced by src/ is declared in
 * package.json dependencies, and reports declared packages that src/ never
 * references.
 *
 * Undeclared imports resolve only by accident of npm's flat hoisting: a strict
 * layout (pnpm, --install-strategy=nested) fails outright, and a consumer with
 * its own copy of the package silently binds our import to their version.
 *
 * Package names are matched as quoted strings anywhere in the source so that
 * indirect loads (requireModule('php-parser')) count as references.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

function packageName(specifier) {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/**
 * `from` is anchored to a preceding delimiter so that the word inside a string
 * literal — `new Set(['from', 'format'])` — is not read as an import.
 */
const SPECIFIER_PATTERNS = [
  /(?:^|[\s;})])from[ \t]+['"]([^'"]+)['"]/gm,
  /\bimport[ \t]*\([ \t]*['"]([^'"]+)['"]/g,
  /\brequire[ \t]*\([ \t]*['"]([^'"]+)['"]/g,
];

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const declared = new Set(Object.keys(manifest.dependencies ?? {}));

const undeclared = [];
const referenced = new Set();

for (const file of sourceFiles(SRC)) {
  const contents = readFileSync(file, 'utf-8');
  const relative = path.relative(ROOT, file);

  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of contents.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || BUILTINS.has(specifier)) {
        continue;
      }
      const name = packageName(specifier);
      referenced.add(name);
      if (!declared.has(name)) {
        const line = contents.slice(0, match.index).split('\n').length;
        undeclared.push({ location: `${relative}:${line}`, name });
      }
    }
  }

  for (const name of declared) {
    if (contents.includes(`'${name}'`) || contents.includes(`"${name}"`)) {
      referenced.add(name);
    }
  }
}

const unused = [...declared].filter((name) => !referenced.has(name)).sort();

for (const { location, name } of undeclared) {
  console.error(`ERROR  ${location.padEnd(52)} undeclared: ${name}`);
}
for (const name of unused) {
  console.error(`ERROR  package.json${' '.repeat(40)} declared but unreferenced: ${name}`);
}

if (undeclared.length > 0 || unused.length > 0) {
  console.error(`\n${undeclared.length} undeclared, ${unused.length} unreferenced`);
  process.exit(1);
}

console.log(`${referenced.size} referenced packages, all declared`);

import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { Logger } from '../utils/logger.js';
import { ConfigError, ValidationError } from '../utils/errors.js';
import { extractGlobLiteralPrefix } from '../utils/glob-prefix.js';

export const DEFAULT_FUNCTION_NAMES = ['t', 'i18n.t', '$t', 'intl.formatMessage'];

// Hard ceiling on scan_paths fan-out. User-controlled `scan_paths` globs can
// expand to every file under a large source tree; on shared CI with slow
// disks a misconfigured pattern can wedge the process for minutes. Cap the
// walker at 50K files by default; callers may override via
// `sync.max_scan_files` in `.deepl-sync.yaml`.
export const SCAN_PATHS_MAX_FILES = 50000;

export interface ContextMatch {
  key: string;
  filePath: string;
  line: number;
  surroundingCode: string;
  matchedFunction: string;
}

export interface ContextExtractionOptions {
  scanPaths: string[];
  rootDir: string;
  functionNames?: string[];
  contextLines?: number;
  maxScanFiles?: number;
}

export interface KeyContext {
  key: string;
  context: string;
  occurrences: number;
  elementType?: string | null;
}

export interface TemplatePatternMatch {
  pattern: string;
  filePath: string;
  line: number;
  surroundingCode: string;
  matchedFunction: string;
}

export interface ContextExtractionResult {
  keyContexts: Map<string, KeyContext>;
  templatePatterns: TemplatePatternMatch[];
}

const MAX_CONTEXT_LENGTH = 1000;
const MAX_LOCATIONS = 3;

const ROLE_MAP: Record<string, string> = {
  cta: 'Call-to-action',
  title: 'Title',
  heading: 'Heading',
  subheading: 'Subheading',
  subtitle: 'Subtitle',
  description: 'Description',
  label: 'Label',
  placeholder: 'Placeholder',
  hint: 'Hint',
  error: 'Error message',
  success: 'Success message',
  warning: 'Warning message',
  tooltip: 'Tooltip',
  help: 'Help text',
  confirm: 'Confirmation prompt',
  cancel: 'Cancel action',
  submit: 'Submit action',
  save: 'Save action',
  delete: 'Delete action',
  empty: 'Empty state',
  loading: 'Loading state',
  alt: 'Alt text',
  aria: 'Accessibility label',
  quote: 'Quote',
  copyright: 'Copyright notice',
  name: 'Name field',
  email: 'Email field',
  password: 'Password field',
  search: 'Search',
};

const ROLE_MODIFIERS = ['primary', 'secondary', 'main', 'default'];

const ELEMENT_TAG_RE = /<(button|a|h[1-6]|p|span|label|th|td|li|option|input|textarea|select|summary|figcaption|legend|caption|dt|dd|title)[\s>/]/g;

// Format parsers flatten nested keys using either `.` (e.g., JSON) or `\0`
// (e.g., YAML, to tolerate literal `.` characters in YAML keys). The
// section-batching logic must honor whichever separator the parser used for a
// given key so that keys like `version.major` (literal dot, YAML) are not
// falsely split into two sections.
function keyPathSeparator(key: string): '\0' | '.' {
  return key.includes('\0') ? '\0' : '.';
}

export function sectionContextKey(key: string): string {
  const sep = keyPathSeparator(key);
  const segments = key.split(sep);
  if (segments.length < 2) return '';
  return segments.slice(0, -1).filter((s) => !/^\d+$/.test(s)).join(sep);
}

export function sectionToContext(sectionKey: string): string {
  if (!sectionKey) return '';
  const sep = keyPathSeparator(sectionKey);
  const display = sep === '\0' ? sectionKey.split(sep).join(' > ') : sectionKey.replace(/\./g, ' > ');
  return `Used in the ${display} section.`;
}

export function keyPathToContext(key: string): string {
  const sep = keyPathSeparator(key);
  const segments = key.split(sep);
  if (segments.length < 2) {
    return '';
  }

  const lastSegment = segments[segments.length - 1]!;
  const parentSegments = segments.slice(0, -1).filter((s) => !/^\d+$/.test(s));

  if (parentSegments.length === 0) {
    return '';
  }

  const sectionPath = parentSegments.join(' > ');
  const roleDescription = resolveRole(lastSegment);

  return `${roleDescription} in the ${sectionPath} section.`;
}

function resolveRole(segment: string): string {
  if (ROLE_MAP[segment]) {
    return ROLE_MAP[segment];
  }

  const parts = segment.split('_');
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.filter((_, idx) => idx !== i).join('_');
    const modifier = parts[i]!;

    if (ROLE_MAP[candidate] && ROLE_MODIFIERS.includes(modifier)) {
      return `${capitalize(modifier)} ${ROLE_MAP[candidate].toLowerCase()}`;
    }
  }

  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join('_');
    const suffix = parts.slice(i);
    if (ROLE_MAP[prefix] && suffix.length > 0 && suffix.every((s) => ROLE_MODIFIERS.includes(s))) {
      return `${capitalize(suffix.join(' '))} ${ROLE_MAP[prefix].toLowerCase()}`;
    }
  }

  return capitalize(segment.replace(/_/g, ' '));
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function extractElementType(surroundingCode: string): string | null {
  const cleaned = surroundingCode.replace(/<!--[\s\S]*?-->/g, '');
  ELEMENT_TAG_RE.lastIndex = 0;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = ELEMENT_TAG_RE.exec(cleaned)) !== null) {
    lastMatch = match;
  }
  return lastMatch?.[1] ?? null;
}

export function buildKeyPatterns(functionNames: string[]): RegExp[] {
  return functionNames.map((name) => {
    if (name === 'intl.formatMessage') {
      return new RegExp(
        `\\bintl\\.formatMessage\\(\\s*\\{[^}]*id\\s*:\\s*['"]([^'"]+)['"]`,
        'g',
      );
    }

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (name.includes('.')) {
      return new RegExp(
        `\\b${escaped}\\(\\s*['"]([^'"]+)['"]\\s*[,)]`,
        'g',
      );
    }

    if (name.startsWith('$')) {
      return new RegExp(
        `${escaped}\\(\\s*['"]([^'"]+)['"]\\s*[,)]`,
        'g',
      );
    }

    return new RegExp(
      `(?:^|[^.\\w])${escaped}\\(\\s*['"]([^'"]+)['"]\\s*[,)]`,
      'g',
    );
  });
}

function extractSurroundingCode(
  lines: string[],
  lineIndex: number,
  contextLines: number,
): string {
  const start = Math.max(0, lineIndex - contextLines);
  const end = Math.min(lines.length - 1, lineIndex + contextLines);
  return lines.slice(start, end + 1).join('\n');
}

export function extractContextFromSource(
  content: string,
  filePath: string,
  functionNames: string[],
  contextLines: number,
): ContextMatch[] {
  const patterns = buildKeyPatterns(functionNames);
  const lines = content.split('\n');
  const matches: ContextMatch[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;

    for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
      const pattern = patterns[patternIndex]!;
      const fnName = functionNames[patternIndex]!;

      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(line)) !== null) {
        const key = match[1];
        if (key) {
          matches.push({
            key,
            filePath,
            line: lineIndex + 1,
            surroundingCode: extractSurroundingCode(lines, lineIndex, contextLines),
            matchedFunction: fnName,
          });
        }
      }
    }
  }

  return matches;
}

export function synthesizeContext(matches: ContextMatch[], options?: { key?: string }): string {
  const keyContext = options?.key ? keyPathToContext(options.key) : '';

  if (matches.length === 0 && !keyContext) {
    return '';
  }

  const parts: string[] = [];

  if (keyContext) {
    parts.push(keyContext);
  }

  const displayed = matches.slice(0, MAX_LOCATIONS);

  for (const m of displayed) {
    parts.push(`Used as ${m.matchedFunction}() in ${m.filePath}:${m.line}:\n${m.surroundingCode}`);
  }

  if (matches.length > MAX_LOCATIONS) {
    parts.push(`...and ${matches.length - MAX_LOCATIONS} more occurrence(s)`);
  }

  const result = parts.join('\n\n');

  if (result.length > MAX_CONTEXT_LENGTH) {
    return result.slice(0, MAX_CONTEXT_LENGTH - 3) + '...';
  }

  return result;
}

export function buildTemplateLiteralPatterns(functionNames: string[]): RegExp[] {
  return functionNames.map((name) => {
    // intl.formatMessage uses object syntax, not template literals for keys
    if (name === 'intl.formatMessage') {
      return null;
    }

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (name.includes('.')) {
      return new RegExp(
        `\\b${escaped}\\(\\s*\`([^\`]+)\`\\s*[,)]`,
        'g',
      );
    }

    if (name.startsWith('$')) {
      return new RegExp(
        `${escaped}\\(\\s*\`([^\`]+)\`\\s*[,)]`,
        'g',
      );
    }

    return new RegExp(
      `(?:^|[^.\\w])${escaped}\\(\\s*\`([^\`]+)\`\\s*[,)]`,
      'g',
    );
  }).filter((p): p is RegExp => p !== null);
}

export function templateToGlobPattern(template: string): string {
  return template.replace(/\$\{[^}]+\}/g, '*');
}

export function extractTemplateLiteralMatches(
  content: string,
  filePath: string,
  functionNames: string[],
  contextLines: number,
): TemplatePatternMatch[] {
  const patterns = buildTemplateLiteralPatterns(functionNames);
  const lines = content.split('\n');
  const matches: TemplatePatternMatch[] = [];

  // Build a filtered function name list matching the patterns array
  // (intl.formatMessage is excluded from template patterns)
  const filteredNames = functionNames.filter((name) => name !== 'intl.formatMessage');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;

    for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
      const pattern = patterns[patternIndex]!;
      const fnName = filteredNames[patternIndex]!;

      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(line)) !== null) {
        const templateContent = match[1];
        if (templateContent && /\$\{[^}]+\}/.test(templateContent)) {
          matches.push({
            pattern: templateContent,
            filePath,
            line: lineIndex + 1,
            surroundingCode: extractSurroundingCode(lines, lineIndex, contextLines),
            matchedFunction: fnName,
          });
        }
      }
    }
  }

  return matches;
}

export function resolveTemplatePatterns(
  patterns: TemplatePatternMatch[],
  knownKeys: string[],
): Map<string, ContextMatch[]> {
  const result = new Map<string, ContextMatch[]>();
  const seen = new Set<string>();
  const deduped = patterns.filter((t) => !seen.has(t.pattern) && seen.add(t.pattern));
  const regexByPattern = new Map<string, RegExp>();

  for (const tmpl of deduped) {
    let regex = regexByPattern.get(tmpl.pattern);
    if (!regex) {
      const glob = templateToGlobPattern(tmpl.pattern);
      // Escape all regex metacharacters, then turn the glob * into a
      // single-segment match. Construction stays guarded so a scanned
      // pattern can never abort the whole sync.
      const regexStr = '^' + glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+') + '$';
      try {
        regex = new RegExp(regexStr);
      } catch {
        continue;
      }
      regexByPattern.set(tmpl.pattern, regex);
    }

    for (const key of knownKeys) {
      if (regex.test(key)) {
        const contextMatch: ContextMatch = {
          key,
          filePath: tmpl.filePath,
          line: tmpl.line,
          surroundingCode: tmpl.surroundingCode,
          matchedFunction: tmpl.matchedFunction,
        };
        const existing = result.get(key);
        if (existing) {
          existing.push(contextMatch);
        } else {
          result.set(key, [contextMatch]);
        }
      }
    }
  }

  return result;
}

export async function extractAllKeyContexts(
  options: ContextExtractionOptions,
): Promise<ContextExtractionResult> {
  const functionNames = options.functionNames ?? DEFAULT_FUNCTION_NAMES;
  const contextLines = options.contextLines ?? 3;

  const allMatches = new Map<string, ContextMatch[]>();
  const allTemplatePatterns: TemplatePatternMatch[] = [];

  const normalizedRoot = path.resolve(options.rootDir);
  const scanPatterns = options.scanPaths.map((scanPath) => {
    let literalPrefix: string;
    try {
      literalPrefix = extractGlobLiteralPrefix(scanPath);
    } catch (err) {
      if (err instanceof ConfigError) {
        Logger.warn(`Skipping scan_path "${scanPath}": ${err.message}`);
        return null;
      }
      throw err;
    }
    const prefixResolved = path.isAbsolute(literalPrefix)
      ? path.resolve(literalPrefix)
      : path.resolve(options.rootDir, literalPrefix);
    if (prefixResolved !== normalizedRoot && !prefixResolved.startsWith(normalizedRoot + path.sep)) {
      Logger.warn(`Skipping scan_path "${scanPath}": resolves outside project root`);
      return null;
    }
    return path.isAbsolute(scanPath) ? scanPath : path.join(options.rootDir, scanPath);
  }).filter((p): p is string => p !== null);

  const files = await fg(scanPatterns, {
    cwd: options.rootDir,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const maxFiles = options.maxScanFiles ?? SCAN_PATHS_MAX_FILES;
  if (files.length > maxFiles) {
    throw new ValidationError(
      `scan_paths matched ${files.length} files (> max ${maxFiles}); narrow the pattern or set sync.max_scan_files.`,
    );
  }

  for (const file of files) {
    let content: string;
    try {
      content = await fs.promises.readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const relPath = path.relative(options.rootDir, file);

    const matches = extractContextFromSource(content, relPath, functionNames, contextLines);
    for (const match of matches) {
      const existing = allMatches.get(match.key);
      if (existing) {
        existing.push(match);
      } else {
        allMatches.set(match.key, [match]);
      }
    }

    const templateMatches = extractTemplateLiteralMatches(content, relPath, functionNames, contextLines);
    allTemplatePatterns.push(...templateMatches);
  }

  const keyContexts = new Map<string, KeyContext>();

  for (const [key, matches] of allMatches) {
    const firstMatch = matches[0];
    const elementType = firstMatch ? extractElementType(firstMatch.surroundingCode) : null;
    keyContexts.set(key, {
      key,
      context: synthesizeContext(matches, { key }),
      occurrences: matches.length,
      elementType,
    });
  }

  return { keyContexts, templatePatterns: allTemplatePatterns };
}

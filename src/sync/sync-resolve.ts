import * as fs from 'fs';
import type { SyncLockFile } from './types.js';

const CONFLICT_START = /^<{7}/m;
const CONFLICT_MID = /^={7}/m;
const CONFLICT_END = /^>{7}/m;
const MAX_REASON_LEN = 80;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type DecisionSource = 'ours' | 'theirs' | 'length-heuristic' | 'unresolved';

export interface ResolveDecision {
  file?: string;
  key: string;
  source: DecisionSource;
  reason: string;
}

export interface ResolveResult {
  hadConflicts: boolean;
  resolved: boolean;
  entriesMerged: number;
  decisions?: ResolveDecision[];
}

export interface ResolveConflictsOptions {
  file?: string;
}

export interface ResolveLockFileOptions {
  dryRun?: boolean;
}

export function hasConflictMarkers(content: string): boolean {
  return CONFLICT_START.test(content);
}

export function resolveConflicts(
  content: string,
  options: ResolveConflictsOptions = {},
): { resolved: string; mergeCount: number; decisions: ResolveDecision[] } {
  const lines = content.split('\n');
  const result: string[] = [];
  let oursLines: string[] = [];
  let theirsLines: string[] = [];
  let inConflict: 'none' | 'ours' | 'theirs' = 'none';
  let mergeCount = 0;
  const decisions: ResolveDecision[] = [];

  for (const line of lines) {
    if (CONFLICT_START.test(line)) {
      inConflict = 'ours';
      oursLines = [];
      theirsLines = [];
      mergeCount++;
      continue;
    }
    if (CONFLICT_MID.test(line) && inConflict === 'ours') {
      inConflict = 'theirs';
      continue;
    }
    if (CONFLICT_END.test(line) && inConflict === 'theirs') {
      inConflict = 'none';
      const { merged, decisions: sectionDecisions } = mergeConflictSections(
        oursLines.join('\n'),
        theirsLines.join('\n'),
        options.file,
      );
      result.push(merged);
      decisions.push(...sectionDecisions);
      continue;
    }

    if (inConflict === 'ours') {
      oursLines.push(line);
    } else if (inConflict === 'theirs') {
      theirsLines.push(line);
    } else {
      result.push(line);
    }
  }

  return { resolved: result.join('\n'), mergeCount, decisions };
}

function mergeConflictSections(
  ours: string,
  theirs: string,
  file?: string,
): { merged: string; decisions: ResolveDecision[] } {
  let oursObj: Record<string, unknown> | undefined;
  let theirsObj: Record<string, unknown> | undefined;
  let parseError: string | undefined;

  try {
    oursObj = JSON.parse(`{${ours}}`) as Record<string, unknown>;
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  if (!parseError) {
    try {
      theirsObj = JSON.parse(`{${theirs}}`) as Record<string, unknown>;
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }

  if (oursObj && theirsObj) {
    const { merged, decisions } = deepMergeWithDecisions(oursObj, theirsObj, file, '');
    const json = JSON.stringify(merged, null, 2);
    return { merged: json.slice(2, -2), decisions };
  }

  const preview = truncate(ours.trim().split('\n')[0] ?? '', 10);
  const reasonMsg = parseError
    ? `JSON.parse failed on "${preview}": ${truncate(parseError, MAX_REASON_LEN)}`
    : 'conflict fragment could not be parsed';

  // The decision below carries the warning; the command layer prints it once
  // with a project-relative path.
  const winningSide: 'ours' | 'theirs' = ours.length >= theirs.length ? 'ours' : 'theirs';
  const decision: ResolveDecision = {
    file,
    key: '<conflict-region>',
    source: 'length-heuristic',
    reason: reasonMsg,
  };
  return { merged: winningSide === 'ours' ? ours : theirs, decisions: [decision] };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function deepMergeWithDecisions(
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
  file: string | undefined,
  keyPath: string,
): { merged: Record<string, unknown>; decisions: ResolveDecision[] } {
  const merged: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(ours)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    merged[key] = value;
  }
  const decisions: ResolveDecision[] = [];

  for (const [key, theirValue] of Object.entries(theirs)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const ourValue = merged[key];
    const childPath = keyPath ? `${keyPath}.${key}` : key;

    if (ourValue === undefined) {
      merged[key] = theirValue;
      decisions.push({
        file,
        key: childPath,
        source: 'theirs',
        reason: 'only present in theirs',
      });
      continue;
    }

    if (isTranslationEntry(ourValue) && isTranslationEntry(theirValue)) {
      const ourDate = (ourValue as Record<string, unknown>)['translated_at'] as string | undefined;
      const theirDate = (theirValue as Record<string, unknown>)['translated_at'] as string | undefined;
      if (ourDate && theirDate) {
        if (ourDate >= theirDate) {
          merged[key] = ourValue;
          decisions.push({
            file,
            key: childPath,
            source: 'ours',
            reason: `kept ours: newer translated_at ${ourDate}`,
          });
        } else {
          merged[key] = theirValue;
          decisions.push({
            file,
            key: childPath,
            source: 'theirs',
            reason: `kept theirs: newer translated_at ${theirDate}`,
          });
        }
      } else if (theirDate) {
        merged[key] = theirValue;
        decisions.push({
          file,
          key: childPath,
          source: 'theirs',
          reason: `kept theirs: ours lacked translated_at`,
        });
      } else {
        decisions.push({
          file,
          key: childPath,
          source: 'ours',
          reason: 'kept ours: neither side had translated_at',
        });
      }
      continue;
    }

    if (
      typeof ourValue === 'object' &&
      typeof theirValue === 'object' &&
      ourValue !== null &&
      theirValue !== null &&
      !Array.isArray(ourValue) &&
      !Array.isArray(theirValue)
    ) {
      const { merged: childMerged, decisions: childDecisions } = deepMergeWithDecisions(
        ourValue as Record<string, unknown>,
        theirValue as Record<string, unknown>,
        file,
        childPath,
      );
      merged[key] = childMerged;
      decisions.push(...childDecisions);
      continue;
    }

    decisions.push({
      file,
      key: childPath,
      source: 'ours',
      reason: 'kept ours: scalar conflict, defaulting to ours',
    });
  }

  return { merged, decisions };
}

function isTranslationEntry(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return 'translated_at' in record || 'source_hash' in record;
}

export async function resolveLockFile(
  lockPath: string,
  options: ResolveLockFileOptions = {},
): Promise<ResolveResult> {
  let content: string;
  try {
    content = await fs.promises.readFile(lockPath, 'utf-8');
  } catch {
    return { hadConflicts: false, resolved: false, entriesMerged: 0 };
  }

  if (!hasConflictMarkers(content)) {
    return { hadConflicts: false, resolved: false, entriesMerged: 0 };
  }

  const { resolved, mergeCount, decisions } = resolveConflicts(content, { file: lockPath });

  try {
    JSON.parse(resolved) as SyncLockFile;
  } catch {
    return { hadConflicts: true, resolved: false, entriesMerged: 0, decisions };
  }

  if (!options.dryRun) {
    await fs.promises.writeFile(lockPath, resolved, 'utf-8');
  }
  return { hadConflicts: true, resolved: true, entriesMerged: mergeCount, decisions };
}

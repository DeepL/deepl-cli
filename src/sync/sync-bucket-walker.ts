import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import type { ExtractedEntry, FormatParser, FormatRegistry } from '../formats/index.js';
import type { ResolvedSyncConfig } from './sync-config.js';
import type { SyncBucketConfig } from './types.js';
import { resolveSyncLimits, DEFAULT_SYNC_LIMITS } from './types.js';
import { assertPathWithinRoot } from './sync-utils.js';
import { Logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import {
  PhpArraysFormatParser,
  PhpArraysCapExceededError,
} from '../formats/php-arrays.js';

export interface WalkedBucketFile {
  bucket: string;
  bucketConfig: SyncBucketConfig;
  parser: FormatParser;
  sourceFile: string;
  relPath: string;
  content: string;
  /** Translatable entries — extract output with skipped entries removed. */
  entries: ExtractedEntry[];
  /**
   * Entries the parser tagged with `metadata.skipped` — currently only the
   * Laravel pipe-pluralization gate. Never enters the translation batch;
   * round-trips byte-verbatim via reconstruct. Surfaced so `sync status` can
   * count the skips.
   */
  skippedEntries: ExtractedEntry[];
  isMultiLocale: boolean;
}

export interface BucketFileCacheEntry {
  content: string;
  entries: ExtractedEntry[];
}

/**
 * Split raw extract output into translatable `entries` and `skippedEntries`
 * tagged with `metadata.skipped` (flush on emit, drop on delete — skipped
 * entries round-trip verbatim via reconstruct but never enter a batch or TMS
 * payload). This is the sole supported filter for the skip metadata contract;
 * callers that run `parser.extract(...)` inline outside `walkBuckets` must
 * re-apply this partition before forwarding entries downstream.
 */
export function partitionEntries(all: ExtractedEntry[]): {
  entries: ExtractedEntry[];
  skippedEntries: ExtractedEntry[];
} {
  const entries: ExtractedEntry[] = [];
  const skippedEntries: ExtractedEntry[] = [];
  for (const e of all) {
    if (e.metadata && 'skipped' in e.metadata) {
      skippedEntries.push(e);
    } else {
      entries.push(e);
    }
  }
  return { entries, skippedEntries };
}

/**
 * Extract translatable entries from `content` using `parser`, with skip-metadata
 * partition applied. A raw `parser.extract(...)` on a target-file read outside
 * `walkBuckets` must drop skipped entries before feeding them into diff /
 * translation / glossary-audit paths. Use this instead of calling
 * `parser.extract(...)` directly at any walkBuckets-consumer site that
 * operates on target-file content.
 */
export function extractTranslatable(
  parser: FormatParser,
  content: string,
  locale?: string,
): ExtractedEntry[] {
  const raw = parser.multiLocale && locale
    ? parser.extract(content, locale)
    : parser.extract(content);
  return partitionEntries(raw).entries;
}

// Cache of already-read+parsed bucket source files, keyed by absolute path.
// Populated opportunistically by the template-pattern prep pass in sync-service
// so walkBuckets can skip re-reading the same files on the main translation loop.
export type BucketFileCache = Map<string, BucketFileCacheEntry>;

export interface WalkBucketsOptions {
  strictParser?: boolean;
  fileCache?: BucketFileCache;
}

export async function* walkBuckets(
  config: ResolvedSyncConfig,
  registry: FormatRegistry,
  opts: WalkBucketsOptions = {},
): AsyncIterable<WalkedBucketFile> {
  const limits = resolveSyncLimits(config);

  for (const [bucket, bucketConfig] of Object.entries(config.buckets)) {
    const registeredParser = registry.getParserByFormatKey(bucket);
    if (!registeredParser) {
      if (opts.strictParser) {
        throw new ValidationError(`No parser for format "${bucket}"`);
      }
      continue;
    }

    // For laravel_php, use a config-aware parser instance when the user has
    // overridden max_depth. Other formats (which don't consume max_depth)
    // use the registered parser as-is.
    const parser: FormatParser =
      registeredParser.configKey === 'laravel_php' &&
      limits.max_depth !== DEFAULT_SYNC_LIMITS.max_depth
        ? new PhpArraysFormatParser({ maxDepth: limits.max_depth })
        : registeredParser;

    const ignorePatterns = [...(bucketConfig.exclude ?? []), ...(config.ignore ?? [])];
    const sourceFiles = await fg(bucketConfig.include, {
      cwd: config.projectRoot,
      ignore: ignorePatterns,
      absolute: true,
      followSymbolicLinks: false,
    });

    if (sourceFiles.length === 0) {
      Logger.warn(`Bucket "${bucket}": glob pattern matched no files (include: ${bucketConfig.include.join(', ')})`);
    }

    if (sourceFiles.length > limits.max_source_files) {
      Logger.warn(
        `Skipping bucket "${bucket}": glob matched ${sourceFiles.length} files, exceeding sync.limits.max_source_files (${limits.max_source_files}). ` +
        `Narrow the include pattern or raise the cap in .deepl-sync.yaml.`,
      );
      continue;
    }

    const isMultiLocale = !!parser.multiLocale;

    for (const sourceFile of sourceFiles) {
      assertPathWithinRoot(sourceFile, config.projectRoot);
      const cached = opts.fileCache?.get(sourceFile);

      // max_file_bytes: pre-read size check avoids loading multi-MiB files
      // into memory just to reject them. Cached reads already happened upstream.
      if (!cached) {
        try {
          const stat = await fs.promises.stat(sourceFile);
          if (stat.size > limits.max_file_bytes) {
            Logger.warn(
              `Skipping ${path.relative(config.projectRoot, sourceFile)}: ` +
              `file size ${stat.size} bytes exceeds sync.limits.max_file_bytes (${limits.max_file_bytes}).`,
            );
            continue;
          }
        } catch {
          // fs.stat failures flow through to the readFile which will report a clearer error.
        }
      }

      const content = cached
        ? cached.content
        : await fs.promises.readFile(sourceFile, 'utf-8');

      let rawEntries: ExtractedEntry[];
      try {
        rawEntries = cached
          ? cached.entries
          : isMultiLocale
            ? parser.extract(content, config.source_locale)
            : parser.extract(content);
      } catch (err) {
        if (err instanceof PhpArraysCapExceededError) {
          Logger.warn(
            `Skipping ${path.relative(config.projectRoot, sourceFile)}: ${err.message}`,
          );
          continue;
        }
        throw err;
      }

      // max_entries_per_file: enforce post-extract. Caching path is trusted —
      // upstream already ran extract with the same parser, so re-checking is
      // redundant but cheap and keeps the invariant local.
      if (rawEntries.length > limits.max_entries_per_file) {
        Logger.warn(
          `Skipping ${path.relative(config.projectRoot, sourceFile)}: ` +
          `${rawEntries.length} entries exceeds sync.limits.max_entries_per_file (${limits.max_entries_per_file}).`,
        );
        continue;
      }

      const { entries, skippedEntries } = partitionEntries(rawEntries);
      const relPath = path.relative(config.projectRoot, sourceFile);
      yield {
        bucket,
        bucketConfig,
        parser,
        sourceFile,
        relPath,
        content,
        entries,
        skippedEntries,
        isMultiLocale,
      };
    }
  }
}

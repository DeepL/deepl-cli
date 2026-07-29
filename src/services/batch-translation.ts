/**
 * Batch Translation Service
 * Handles parallel translation of multiple files with progress tracking and error recovery
 */

import * as fs from 'fs';
import * as path from 'path';
import pLimit from 'p-limit';
import fg from 'fast-glob';
import { FileTranslationService } from './file-translation.js';
import { atomicWriteFile } from '../utils/atomic-write.js';
import { TranslationService, MAX_TEXT_BYTES, TRANSLATE_BATCH_SIZE } from './translation.js';
import { preserveCodeBlocks, preserveVariables, restorePlaceholders } from '../utils/text-preservation.js';
import { TranslationOptions } from '../types/index.js';
import { safeReadFile } from '../utils/safe-read-file.js';
import { Logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { errorMessage } from '../utils/error-message.js';

interface BatchOptions {
  outputDir: string;
  outputPattern?: string;
  recursive?: boolean;
  pattern?: string;
  baseDir?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: ProgressInfo) => void;
}

interface ProgressInfo {
  completed: number;
  total: number;
  current?: string;
}

interface BatchResult {
  successful: Array<{ file: string; outputPath: string }>;
  failed: Array<{ file: string; error: string }>;
  skipped: Array<{ file: string; reason: string }>;
}

interface BatchStatistics {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
}

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 100;
const PLAIN_TEXT_EXTENSIONS = new Set(['.txt', '.md']);

/**
 * /v2/translate bodies are application/x-www-form-urlencoded, so the API's
 * per-request size limit applies to the percent-encoded text (up to ~3x the
 * raw UTF-8 size for non-ASCII). Batch grouping measures that encoded size.
 * The serialized output is pure ASCII, so string length equals byte length.
 */
function formEncodedByteLength(text: string): number {
  return new URLSearchParams([['t', text]]).toString().length - 't='.length;
}

export class BatchTranslationService {
  private fileTranslationService: FileTranslationService;
  private translationService: TranslationService | null;
  private concurrency: number;

  constructor(
    fileTranslationService: FileTranslationService,
    options: { concurrency?: number; translationService?: TranslationService } = {}
  ) {
    this.fileTranslationService = fileTranslationService;
    this.translationService = options.translationService ?? null;

    // Validate concurrency parameter
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    if (concurrency < 1) {
      throw new ValidationError('Concurrency must be at least 1');
    }
    if (concurrency > MAX_CONCURRENCY) {
      throw new ValidationError('Concurrency cannot exceed 100');
    }

    this.concurrency = concurrency;
  }

  private isPlainTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return PLAIN_TEXT_EXTENSIONS.has(ext);
  }

  /**
   * Translate multiple files in parallel.
   * Plain text files (.txt, .md) are batched into fewer API calls via translateBatch().
   * Structured files (.json, .yaml, .yml) continue through the per-file path.
   */
  async translateFiles(
    files: string[],
    translationOptions: TranslationOptions,
    batchOptions: Partial<BatchOptions> = {}
  ): Promise<BatchResult> {
    const result: BatchResult = {
      successful: [],
      failed: [],
      skipped: [],
    };

    if (files.length === 0) {
      return result;
    }

    // Partition files into plain text (batchable) vs others (per-file)
    const plainTextFiles: string[] = [];
    const perFileFiles: string[] = [];

    for (const file of files) {
      if (!this.fileTranslationService.isSupportedFile(file)) {
        result.skipped.push({ file, reason: 'Unsupported file type' });
      } else if (this.translationService && this.isPlainTextFile(file)) {
        plainTextFiles.push(file);
      } else {
        perFileFiles.push(file);
      }
    }

    const totalFiles = files.length;
    let completed = result.skipped.length;

    // Report progress for skipped files
    for (const entry of result.skipped) {
      batchOptions.onProgress?.({ completed, total: totalFiles, current: entry.file });
    }

    // Batch-translate plain text files
    if (plainTextFiles.length > 0) {
      const batchResult = await this.translatePlainTextFilesBatched(
        plainTextFiles,
        translationOptions,
        batchOptions,
        totalFiles,
        completed,
        batchOptions.onProgress,
      );
      result.successful.push(...batchResult.successful);
      result.failed.push(...batchResult.failed);
      completed += batchResult.successful.length + batchResult.failed.length;
    }

    // Per-file translation for structured/other files
    if (perFileFiles.length > 0) {
      const limit = pLimit(this.concurrency);

      const tasks = perFileFiles.map(file =>
        limit(async () => {
          if (batchOptions.abortSignal?.aborted) {
            result.skipped.push({ file, reason: 'Aborted' });
            completed++;
            batchOptions.onProgress?.({ completed, total: totalFiles, current: file });
            return;
          }

          try {
            const outputPath = this.generateOutputPath(
              file,
              translationOptions.targetLang,
              batchOptions
            );

            await this.fileTranslationService.translateFile(
              file,
              outputPath,
              translationOptions,
              { preserveCode: true }
            );

            result.successful.push({ file, outputPath });
            completed++;
            batchOptions.onProgress?.({ completed, total: totalFiles, current: file });
          } catch (error) {
            result.failed.push({
              file,
              error: errorMessage(error),
            });
            completed++;
            batchOptions.onProgress?.({ completed, total: totalFiles, current: file });
          }
        })
      );

      await Promise.all(tasks);
    }

    return result;
  }

  /**
   * Batch-translate plain text files using TranslationService.translateBatch().
   * Files are read one at a time and flushed batch by batch (read → translate
   * → write → release), so resident memory is bounded by a single batch
   * rather than the whole file set.
   */
  private async translatePlainTextFilesBatched(
    files: string[],
    translationOptions: TranslationOptions,
    batchOptions: Partial<BatchOptions>,
    totalFiles: number,
    startCompleted: number,
    onProgress?: (progress: ProgressInfo) => void,
  ): Promise<{ successful: Array<{ file: string; outputPath: string }>; failed: Array<{ file: string; error: string }> }> {
    const successful: Array<{ file: string; outputPath: string }> = [];
    const failed: Array<{ file: string; error: string }> = [];

    interface FileEntry {
      file: string;
      outputPath: string;
      processedText: string;
      preservationMap: Map<string, string>;
    }

    let completed = startCompleted;
    let currentBatch: FileEntry[] = [];
    let currentBytes = 0;

    const flushBatch = async (): Promise<void> => {
      const batch = currentBatch;
      currentBatch = [];
      currentBytes = 0;
      if (batch.length === 0) {
        return;
      }

      if (batchOptions.abortSignal?.aborted) {
        for (const entry of batch) {
          completed++;
          onProgress?.({ completed, total: totalFiles, current: entry.file });
        }
        return;
      }

      const texts = batch.map(e => e.processedText);

      try {
        const results = await this.translationService!.translateBatch(texts, translationOptions);

        if (results.length !== batch.length) {
          // Result count mismatch — mark entire batch as failed
          for (const entry of batch) {
            failed.push({ file: entry.file, error: 'Batch result count mismatch' });
            completed++;
            onProgress?.({ completed, total: totalFiles, current: entry.file });
          }
          return;
        }

        for (let i = 0; i < batch.length; i++) {
          const entry = batch[i]!;
          const translatedText = restorePlaceholders(
            results[i]!.text,
            entry.preservationMap,
          );

          try {
            const outputDir = path.dirname(entry.outputPath);
            await fs.promises.mkdir(outputDir, { recursive: true });
            await atomicWriteFile(entry.outputPath, translatedText, 'utf-8');

            successful.push({ file: entry.file, outputPath: entry.outputPath });
          } catch (error) {
            failed.push({
              file: entry.file,
              error: errorMessage(error),
            });
          }
          completed++;
          onProgress?.({ completed, total: totalFiles, current: entry.file });
        }
      } catch (error) {
        Logger.error(`Batch translation failed: ${errorMessage(error)}`);
        for (const entry of batch) {
          failed.push({
            file: entry.file,
            error: errorMessage(error),
          });
          completed++;
          onProgress?.({ completed, total: totalFiles, current: entry.file });
        }
      }
    };

    for (const file of files) {
      let entry: FileEntry;
      try {
        const content = await safeReadFile(file, 'utf-8');
        if (!content || content.trim() === '') {
          failed.push({ file, error: 'File is empty' });
          continue;
        }

        const byteSize = Buffer.byteLength(content, 'utf8');
        if (byteSize > MAX_TEXT_BYTES) {
          failed.push({ file, error: `File too large: ${byteSize} bytes exceeds ${MAX_TEXT_BYTES} byte limit` });
          continue;
        }

        const preservationMap = new Map<string, string>();
        let processedText = preserveCodeBlocks(content, preservationMap);
        processedText = preserveVariables(processedText, preservationMap);

        const outputPath = this.generateOutputPath(
          file,
          translationOptions.targetLang,
          batchOptions,
        );

        entry = { file, outputPath, processedText, preservationMap };
      } catch (error) {
        failed.push({ file, error: errorMessage(error) });
        continue;
      }

      const entryBytes = formEncodedByteLength(entry.processedText);
      if (currentBatch.length > 0 &&
          (currentBatch.length >= TRANSLATE_BATCH_SIZE || currentBytes + entryBytes > MAX_TEXT_BYTES)) {
        await flushBatch();
      }

      currentBatch.push(entry);
      currentBytes += entryBytes;
    }
    await flushBatch();

    return { successful, failed };
  }

  /**
   * Translate all files in a directory
   */
  async translateDirectory(
    inputDir: string,
    translationOptions: TranslationOptions,
    batchOptions: Partial<BatchOptions> = {}
  ): Promise<BatchResult> {
    // Check if directory exists
    if (!fs.existsSync(inputDir)) {
      throw new ValidationError(`Directory not found: ${inputDir}`);
    }

    const stats = fs.statSync(inputDir);
    if (!stats.isDirectory()) {
      throw new ValidationError(`Not a directory: ${inputDir}`);
    }

    // Build glob pattern
    const pattern = batchOptions.pattern ?? '*';
    const depth = batchOptions.recursive === false ? 1 : undefined;
    const globPattern = batchOptions.recursive === false
      ? path.join(inputDir, pattern)
      : path.join(inputDir, '**', pattern);

    // Find all files
    const files = await fg(globPattern, {
      onlyFiles: true,
      absolute: true,
      dot: false,
      deep: depth,
      followSymbolicLinks: false,
    });

    // Filter to only supported files
    const supportedFiles = files.filter(file =>
      this.fileTranslationService.isSupportedFile(file)
    );

    // Translate files with preserved directory structure
    return this.translateFiles(
      supportedFiles,
      translationOptions,
      {
        ...batchOptions,
        outputDir: batchOptions.outputDir ?? inputDir,
        baseDir: inputDir,
      }
    );
  }

  /**
   * Get statistics from batch results
   */
  getStatistics(result: BatchResult): BatchStatistics {
    return {
      total: result.successful.length + result.failed.length + result.skipped.length,
      successful: result.successful.length,
      failed: result.failed.length,
      skipped: result.skipped.length,
    };
  }

  /**
   * Generate output path for a file
   */
  private generateOutputPath(
    inputPath: string,
    targetLang: string,
    options: Partial<BatchOptions>
  ): string {
    const outputDir = options.outputDir ?? path.dirname(inputPath);
    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);

    // Apply custom pattern if provided
    if (options.outputPattern) {
      const outputFilename = options.outputPattern
        .replace('{name}', basename)
        .replace('{lang}', targetLang)
        .replace('{ext}', ext);

      const outputPath = path.resolve(outputDir, outputFilename);
      const resolvedOutputDir = path.resolve(outputDir);
      if (!outputPath.startsWith(resolvedOutputDir + path.sep) && outputPath !== resolvedOutputDir) {
        throw new ValidationError(
          `Output path "${outputFilename}" escapes output directory "${outputDir}"`
        );
      }
      return outputPath;
    }

    // Default pattern: name.lang.ext
    const outputFilename = `${basename}.${targetLang}${ext}`;

    // Preserve directory structure if baseDir is provided
    if (options.baseDir) {
      const relativePath = path.relative(options.baseDir, inputPath);
      const relativeDir = path.dirname(relativePath);
      const outputPath = path.resolve(outputDir, relativeDir, outputFilename);
      const resolvedOutputDir = path.resolve(outputDir);
      if (!outputPath.startsWith(resolvedOutputDir + path.sep) && outputPath !== resolvedOutputDir) {
        throw new ValidationError(
          `Output path "${path.join(relativeDir, outputFilename)}" escapes output directory "${outputDir}"`
        );
      }
      return outputPath;
    }

    return path.join(outputDir, outputFilename);
  }
}

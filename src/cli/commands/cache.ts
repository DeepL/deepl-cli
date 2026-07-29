/**
 * Cache Command
 * Manages translation cache
 */

import Table from 'cli-table3';
import { CacheService } from '../../storage/cache.js';
import { ConfigService } from '../../storage/config.js';
import { isColorEnabled } from '../../utils/formatters.js';

interface CacheStats {
  entries: number;
  totalSize: number;
  maxSize: number;
  enabled: boolean;
}

export class CacheCommand {
  private cache: CacheService;
  private config: ConfigService;

  constructor(cache: CacheService, config: ConfigService) {
    this.cache = cache;
    this.config = config;
  }

  /**
   * Get cache statistics
   */
  async stats(): Promise<CacheStats> {
    return this.cache.stats();
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Enable cache with optional max size.
   * Persisted to config: the in-memory flag alone would die with this process.
   */
  async enable(maxSize?: number): Promise<void> {
    if (maxSize !== undefined) {
      this.config.set('cache.maxSize', maxSize);
      this.cache.setMaxSize(maxSize);
    }

    this.config.set('cache.enabled', true);
    this.cache.enable();
  }

  /**
   * Disable cache. Persisted to config, as with enable().
   */
  async disable(): Promise<void> {
    this.config.set('cache.enabled', false);
    this.cache.disable();
  }

  /**
   * Format cache statistics for display
   */
  formatStats(stats: CacheStats): string {
    const totalSizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
    const maxSizeMB = (stats.maxSize / (1024 * 1024)).toFixed(2);
    const status = stats.enabled ? 'enabled' : 'disabled';
    const percentUsed = stats.maxSize > 0
      ? ((stats.totalSize / stats.maxSize) * 100).toFixed(1)
      : '0.0';

    return [
      `Cache Status: ${status}`,
      `Entries: ${stats.entries}`,
      `Size: ${totalSizeMB} MB / ${maxSizeMB} MB (${percentUsed}% used)`,
    ].join('\n');
  }

  /** Format cache statistics as a cli-table3 table. */
  formatStatsTable(stats: CacheStats): string {
    const totalSizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
    const maxSizeMB = (stats.maxSize / (1024 * 1024)).toFixed(2);
    const percentUsed = stats.maxSize > 0
      ? ((stats.totalSize / stats.maxSize) * 100).toFixed(1)
      : '0.0';
    const colorDisabled = !isColorEnabled();

    const table = new Table({
      head: ['Metric', 'Value'],
      colWidths: [16, 28],
      wordWrap: true,
      ...(colorDisabled && { style: { head: [], border: [] } }),
    });

    table.push(
      ['Status', stats.enabled ? 'enabled' : 'disabled'],
      ['Entries', String(stats.entries)],
      ['Used', `${totalSizeMB} MB`],
      ['Limit', `${maxSizeMB} MB`],
      ['Usage', `${percentUsed}%`],
    );

    return table.toString();
  }
}

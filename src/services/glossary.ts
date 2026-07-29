/**
 * Glossary Service
 * Manages DeepL glossaries
 */

import { DeepLClient } from '../api/deepl-client.js';
import { GlossaryInfo, GlossaryLanguagePair, Language, isMultilingual } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { ValidationError, ConfigError } from '../utils/errors.js';

function sanitizeForError(input: string): string {
  // eslint-disable-next-line no-control-regex -- intentional: strip control chars before interpolating untrusted input into errors
  return input.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80);
}

function hasSuspiciousChars(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- intentional: checking for control chars in untrusted API-returned strings
  return /[\x00-\x1f\x7f\u200B-\u200D\uFEFF]/.test(name);
}

const LIST_CACHE_TTL_MS = 60_000;

/**
 * Characters the glossary TSV wire format reserves as column and row
 * separators. A term containing one of them cannot survive the round trip:
 * it either shifts columns or fabricates extra entries.
 */
const TERM_SEPARATOR_NAMES: Array<[string, string]> = [
  ['\t', 'tab'],
  ['\r', 'carriage return'],
  ['\n', 'newline'],
];

function findSeparatorChar(text: string): string | null {
  for (const [char, name] of TERM_SEPARATOR_NAMES) {
    if (text.includes(char)) return name;
  }
  return null;
}

function assertNoSeparatorChars(label: string, text: string): void {
  const found = findSeparatorChar(text);
  if (found) {
    throw new ValidationError(
      `${label} cannot contain a ${found} character`,
      'Glossary entries are stored as tab-separated rows; split the term into separate entries instead.',
    );
  }
}

export class GlossaryService {
  private client: DeepLClient;
  private resolutionCache = new Map<string, string>();
  private listCache?: { at: number; list: GlossaryInfo[] };

  constructor(client: DeepLClient) {
    this.client = client;
  }

  private invalidateResolutionCache(): void {
    this.resolutionCache.clear();
    this.listCache = undefined;
  }

  private async getCachedGlossaryList(): Promise<GlossaryInfo[]> {
    const now = Date.now();
    if (this.listCache && now - this.listCache.at < LIST_CACHE_TTL_MS) {
      return this.listCache.list;
    }
    const list = await this.client.listGlossaries();
    this.listCache = { at: now, list };
    return list;
  }

  /**
   * Create a glossary from entries object (v3 API - supports multiple target languages)
   */
  async createGlossary(
    name: string,
    sourceLang: Language,
    targetLangs: Language[],
    entries: Record<string, string>
  ): Promise<GlossaryInfo> {
    // Validate inputs
    if (!name || name.trim() === '') {
      throw new ValidationError('Glossary name is required');
    }

    if (targetLangs.length === 0) {
      throw new ValidationError('At least one target language is required');
    }

    if (Object.keys(entries).length === 0) {
      throw new ValidationError('Glossary entries cannot be empty');
    }

    // Convert entries to TSV format
    const tsv = GlossaryService.entriesToTSV(entries);

    // Create glossary via API
    const result = await this.client.createGlossary(name, sourceLang, targetLangs, tsv);
    this.invalidateResolutionCache();
    return result;
  }

  /**
   * Create a glossary from TSV/CSV string (v3 API - supports multiple target languages)
   */
  async createGlossaryFromTSV(
    name: string,
    sourceLang: Language,
    targetLangs: Language[],
    tsv: string
  ): Promise<GlossaryInfo> {
    if (!name || name.trim() === '') {
      throw new ValidationError('Glossary name is required');
    }

    if (targetLangs.length === 0) {
      throw new ValidationError('At least one target language is required');
    }

    if (!tsv || tsv.trim() === '') {
      throw new ValidationError('Glossary entries cannot be empty');
    }

    const result = await this.client.createGlossary(name, sourceLang, targetLangs, tsv);
    this.invalidateResolutionCache();
    return result;
  }

  /**
   * List all glossaries
   */
  async listGlossaries(): Promise<GlossaryInfo[]> {
    return this.client.listGlossaries();
  }

  /**
   * Get glossary by ID
   */
  async getGlossary(glossaryId: string): Promise<GlossaryInfo> {
    return this.client.getGlossary(glossaryId);
  }

  /**
   * Get glossary by name
   */
  async getGlossaryByName(name: string): Promise<GlossaryInfo | null> {
    const glossaries = await this.getCachedGlossaryList();
    const match = glossaries.find(g => g.name === name) ?? null;
    // List normalization suppresses this warning for unrelated glossaries;
    // surface it here only for the glossary actually being operated on.
    if (match?.dictionaries.length === 0) {
      Logger.warn('Glossary has empty dictionaries; defaulting source language to "en"');
    }
    return match;
  }

  /**
   * Resolve a glossary name or ID to a glossary ID.
   * If the input is a UUID, returns it directly. Otherwise looks up by name.
   */
  async resolveGlossaryId(nameOrId: string): Promise<string> {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId)) {
      return nameOrId;
    }
    const cached = this.resolutionCache.get(nameOrId);
    if (cached !== undefined) {
      Logger.verbose(`[verbose] Glossary cache hit: "${nameOrId}" -> ${cached}`);
      return cached;
    }
    const glossaries = await this.getCachedGlossaryList();
    const candidates = glossaries.filter(g => !hasSuspiciousChars(g.name));
    const matches = candidates.filter(g => g.name === nameOrId);
    if (matches.length > 1) {
      throw new ConfigError(
        `Multiple glossaries share the name "${sanitizeForError(nameOrId)}"`,
        'Pass the UUID directly to disambiguate.',
      );
    }
    const match = matches[0];
    if (!match) {
      throw new ConfigError(`Glossary "${sanitizeForError(nameOrId)}" not found`);
    }
    this.resolutionCache.set(nameOrId, match.glossary_id);
    Logger.verbose(`[verbose] Resolved glossary "${nameOrId}" -> ${match.glossary_id}`);
    return match.glossary_id;
  }

  /**
   * Delete a glossary
   */
  async deleteGlossary(glossaryId: string): Promise<void> {
    await this.client.deleteGlossary(glossaryId);
    this.invalidateResolutionCache();
  }

  /**
   * Get glossary entries as object (v3 API - requires language pair)
   */
  async getGlossaryEntries(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language
  ): Promise<Record<string, string>> {
    const tsv = await this.client.getGlossaryEntries(glossaryId, sourceLang, targetLang);
    return GlossaryService.tsvToEntries(tsv);
  }

  /**
   * Get supported glossary language pairs
   */
  async getGlossaryLanguages(): Promise<GlossaryLanguagePair[]> {
    return this.client.getGlossaryLanguages();
  }

  /**
   * Add a new entry to an existing glossary (v3 API - uses PATCH)
   */
  async addEntry(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    sourceText: string,
    targetText: string
  ): Promise<void> {
    if (!sourceText || sourceText.trim() === '') {
      throw new ValidationError('Source text cannot be empty');
    }
    if (!targetText || targetText.trim() === '') {
      throw new ValidationError('Target text cannot be empty');
    }
    assertNoSeparatorChars('Source text', sourceText);
    assertNoSeparatorChars('Target text', targetText);
    await this.mutateEntries(glossaryId, sourceLang, targetLang, (entries) => {
      if (entries[sourceText] !== undefined) {
        throw new ValidationError(`Entry "${sourceText}" already exists in glossary`);
      }
      entries[sourceText] = targetText;
    });
  }

  /**
   * Update an existing entry in a glossary (v3 API - uses PATCH)
   */
  async updateEntry(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    sourceText: string,
    newTargetText: string
  ): Promise<void> {
    if (!sourceText || sourceText.trim() === '') {
      throw new ValidationError('Source text cannot be empty');
    }
    if (!newTargetText || newTargetText.trim() === '') {
      throw new ValidationError('Target text cannot be empty');
    }
    assertNoSeparatorChars('Source text', sourceText);
    assertNoSeparatorChars('Target text', newTargetText);
    await this.mutateEntries(glossaryId, sourceLang, targetLang, (entries) => {
      if (entries[sourceText] === undefined) {
        throw new ConfigError(`Entry "${sourceText}" not found in glossary`);
      }
      entries[sourceText] = newTargetText;
    });
  }

  /**
   * Remove an entry from a glossary (v3 API - uses PATCH)
   */
  async removeEntry(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    sourceText: string
  ): Promise<void> {
    if (!sourceText || sourceText.trim() === '') {
      throw new ValidationError('Source text cannot be empty');
    }
    await this.mutateEntries(glossaryId, sourceLang, targetLang, (entries) => {
      if (entries[sourceText] === undefined) {
        throw new ConfigError(`Entry "${sourceText}" not found in glossary`);
      }
      if (Object.keys(entries).length === 1) {
        throw new ValidationError('Cannot remove last entry from glossary. Delete the glossary instead.');
      }
      delete entries[sourceText];
    });
  }

  private async mutateEntries(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    mutate: (entries: Record<string, string>) => void
  ): Promise<void> {
    const entries = await this.getGlossaryEntries(glossaryId, sourceLang, targetLang);
    mutate(entries);
    const tsv = GlossaryService.entriesToTSV(entries);
    await this.client.updateGlossaryEntries(glossaryId, sourceLang, targetLang, tsv);
  }

  /**
   * Update a glossary (v3 API - uses PATCH endpoint)
   * Combines name and dictionary updates into a single API call
   */
  async updateGlossary(
    glossaryId: string,
    options: {
      name?: string;
      dictionaries?: Array<{
        sourceLang: Language;
        targetLang: Language;
        entries: Record<string, string>;
      }>;
    }
  ): Promise<void> {
    if (options.name !== undefined && (!options.name || options.name.trim() === '')) {
      throw new ValidationError('New glossary name cannot be empty');
    }

    if (!options.name && !options.dictionaries) {
      throw new ValidationError('At least one of name or dictionaries must be provided');
    }

    if (options.name) {
      const glossary = await this.client.getGlossary(glossaryId);
      if (glossary.name === options.name) {
        throw new ValidationError('New name must be different from current name');
      }
    }

    const updates: {
      name?: string;
      dictionaries?: Array<{
        source_lang: string;
        target_lang: string;
        entries: string;
        entries_format: string;
      }>;
    } = {};

    if (options.name) {
      updates.name = options.name;
    }

    if (options.dictionaries) {
      updates.dictionaries = options.dictionaries.map(dict => ({
        source_lang: dict.sourceLang.toUpperCase(),
        target_lang: dict.targetLang.toUpperCase(),
        entries: GlossaryService.entriesToTSV(dict.entries),
        entries_format: 'tsv',
      }));
    }

    await this.client.updateGlossary(glossaryId, updates);
    if (options.name) {
      this.invalidateResolutionCache();
    }
  }

  /**
   * Rename a glossary (v3 API - uses PATCH endpoint)
   */
  async renameGlossary(
    glossaryId: string,
    newName: string
  ): Promise<void> {
    return this.updateGlossary(glossaryId, { name: newName });
  }

  /**
   * Replace all entries in a glossary dictionary (v3 API)
   * Unlike updateGlossaryEntries (PATCH/merge), this replaces the entire dictionary
   */
  async replaceGlossaryDictionary(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    tsvContent: string
  ): Promise<void> {
    const entries = GlossaryService.tsvToEntries(tsvContent);
    if (Object.keys(entries).length === 0) {
      throw new ValidationError('No valid entries found in TSV content');
    }

    const tsv = GlossaryService.entriesToTSV(entries);
    await this.client.replaceGlossaryDictionary(glossaryId, sourceLang, targetLang, tsv);
  }

  /**
   * Delete a dictionary from a multilingual glossary (v3 API)
   * Removes a specific language pair from the glossary
   */
  async deleteGlossaryDictionary(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language
  ): Promise<void> {
    // Get glossary info to validate it's multilingual
    const glossary = await this.client.getGlossary(glossaryId);

    // Check if glossary has multiple dictionaries
    if (!isMultilingual(glossary)) {
      throw new ValidationError('Cannot delete dictionary from single-language glossary. Delete the entire glossary instead.');
    }

    // Check if this would be the last dictionary
    if (glossary.dictionaries.length === 1) {
      throw new ValidationError('Cannot delete last dictionary from glossary. Delete the entire glossary instead.');
    }

    // Validate the dictionary exists
    const dictionaryExists = glossary.dictionaries.some(
      dict => dict.source_lang.toUpperCase() === sourceLang.toUpperCase() &&
              dict.target_lang.toUpperCase() === targetLang.toUpperCase()
    );

    if (!dictionaryExists) {
      throw new ValidationError(`Dictionary ${sourceLang}-${targetLang} not found in glossary`);
    }

    // Delete the dictionary using v3 DELETE endpoint
    await this.client.deleteGlossaryDictionary(glossaryId, sourceLang, targetLang);
  }

  /**
   * Convert entries object to TSV format
   */
  static entriesToTSV(entries: Record<string, string>): string {
    return Object.entries(entries)
      .map(([source, target]) => `${source}\t${target}`)
      .join('\n');
  }

  /**
   * Convert TSV/CSV to entries object
   * Handles UTF-8 BOM, warns about extra columns, validates format
   */
  static tsvToEntries(tsv: string): Record<string, string> {
    // Null-prototype: a source term may legitimately be "toString" or
    // "__proto__", which on a plain object would read as an existing entry
    // (false duplicate warning) or, for __proto__, be swallowed by the
    // prototype setter instead of stored.
    const entries: Record<string, string> = Object.create(null) as Record<string, string>;

    // Remove UTF-8 BOM if present (0xFEFF)
    let content = tsv;
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    const lines = content.split('\n');
    // Pick the dialect once for the whole file. Sniffing per line tab-splits a
    // quoted CSV field that happens to contain a tab into garbage columns.
    const firstDataLine = lines.map(line => line.trim()).find(line => line !== '') ?? '';
    const isTabSeparated = firstDataLine.includes('\t');
    let lineNumber = 0;

    for (const line of lines) {
      lineNumber++;
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) {
        continue;
      }

      let parts: string[];

      if (isTabSeparated) {
        parts = trimmed.split('\t');
      } else if (trimmed.includes(',')) {
        // Use proper CSV parsing for comma-separated values (handles quoted fields)
        parts = GlossaryService.parseCsvLine(trimmed);
      } else {
        // Line has no separator - skip it
        Logger.warn(`Line ${lineNumber}: No tab or comma separator found, skipping`);
        continue;
      }

      // Validate we have at least 2 columns
      if (parts.length < 2) {
        Logger.warn(`Line ${lineNumber}: Expected 2 columns, found ${parts.length}, skipping`);
        continue;
      }

      // Warn if more than 2 columns (extra data will be ignored)
      if (parts.length > 2) {
        Logger.warn(`Line ${lineNumber}: Found ${parts.length} columns, expected 2. Using first 2 columns.`);
      }

      const source = parts[0]?.trim();
      const target = parts[1]?.trim();

      // Validate both source and target are non-empty
      if (!source || !target) {
        Logger.warn(`Line ${lineNumber}: Empty source or target, skipping`);
        continue;
      }

      // A quoted CSV field may carry a tab or newline that the TSV wire format
      // cannot represent; keeping it would corrupt every following entry.
      const separator = findSeparatorChar(source) ?? findSeparatorChar(target);
      if (separator) {
        Logger.warn(`Line ${lineNumber}: Source or target contains a ${separator} character, skipping`);
        continue;
      }

      // Add to entries (duplicates will overwrite earlier entries)
      if (Object.hasOwn(entries, source)) {
        Logger.warn(`Line ${lineNumber}: Duplicate source "${source}", overwriting previous entry`);
      }

      entries[source] = target;
    }

    return entries;
  }

  private static parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote (two consecutive quotes = one quote character)
          currentField += '"';
          i += 2;
        } else {
          // Toggle quote state (entering or leaving quoted field)
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator (only when not inside quotes)
        fields.push(currentField);
        currentField = '';
        i++;
      } else {
        // Regular character
        currentField += char;
        i++;
      }
    }

    // Add the last field
    fields.push(currentField);

    return fields;
  }
}

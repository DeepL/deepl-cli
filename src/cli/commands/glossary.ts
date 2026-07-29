/**
 * Glossary Command
 * Manages DeepL glossaries
 */

import * as fs from 'fs';
import { GlossaryService } from '../../services/glossary.js';
import { GlossaryInfo, GlossaryLanguagePair, Language, getTargetLang, getTotalEntryCount, isMultilingual } from '../../types/index.js';
import { safeReadFileSync } from '../../utils/safe-read-file.js';
import { sanitizeForTerminal } from '../../utils/control-chars.js';
import { ValidationError, ConfigError } from '../../utils/errors.js';

export class GlossaryCommand {
  private glossaryService: GlossaryService;

  constructor(glossaryService: GlossaryService) {
    this.glossaryService = glossaryService;
  }

  /**
   * Create glossary from TSV/CSV file (v3 API - supports multiple target languages)
   */
  async create(
    name: string,
    sourceLang: Language,
    targetLangs: Language[],
    filePath: string
  ): Promise<GlossaryInfo> {
    if (!fs.existsSync(filePath)) {
      throw new ValidationError(`File not found: ${filePath}`);
    }

    const content = safeReadFileSync(filePath, 'utf-8');
    return this.glossaryService.createGlossaryFromTSV(
      name,
      sourceLang,
      targetLangs,
      content
    );
  }

  /**
   * List all glossaries
   */
  async list(): Promise<GlossaryInfo[]> {
    return this.glossaryService.listGlossaries();
  }

  /**
   * Show glossary details
   */
  async show(nameOrId: string): Promise<GlossaryInfo> {
    // Try to get by ID first
    try {
      return await this.glossaryService.getGlossary(nameOrId);
    } catch {
      // If failed, try by name
      const glossary = await this.glossaryService.getGlossaryByName(nameOrId);
      if (!glossary) {
        throw new ConfigError(`Glossary not found: ${nameOrId}`);
      }
      return glossary;
    }
  }

  /**
   * Delete glossary
   */
  async delete(nameOrId: string): Promise<void> {
    // Try to get glossary first to find ID
    const glossary = await this.show(nameOrId);
    await this.glossaryService.deleteGlossary(glossary.glossary_id);
  }

  /**
   * Get glossary entries (v3 API - requires target lang for multilingual glossaries)
   */
  async entries(nameOrId: string, targetLang?: Language): Promise<Record<string, string>> {
    const glossary = await this.show(nameOrId);
    // Get target language (will throw if glossary is multilingual and targetLang not provided)
    const target = getTargetLang(glossary, targetLang);
    return this.glossaryService.getGlossaryEntries(
      glossary.glossary_id,
      glossary.source_lang,
      target
    );
  }

  /**
   * List supported glossary language pairs
   */
  async listLanguages(): Promise<GlossaryLanguagePair[]> {
    return this.glossaryService.getGlossaryLanguages();
  }

  /**
   * Add a new entry to an existing glossary (v3 API - requires target lang for multilingual glossaries)
   */
  async addEntry(
    nameOrId: string,
    sourceText: string,
    targetText: string,
    targetLang?: Language
  ): Promise<void> {
    const glossary = await this.show(nameOrId);
    // Get target language (will throw if glossary is multilingual and targetLang not provided)
    const target = getTargetLang(glossary, targetLang);
    await this.glossaryService.addEntry(
      glossary.glossary_id,
      glossary.source_lang,
      target,
      sourceText,
      targetText
    );
  }

  /**
   * Update an existing entry in a glossary (v3 API - requires target lang for multilingual glossaries)
   */
  async updateEntry(
    nameOrId: string,
    sourceText: string,
    newTargetText: string,
    targetLang?: Language
  ): Promise<void> {
    const glossary = await this.show(nameOrId);
    // Get target language (will throw if glossary is multilingual and targetLang not provided)
    const target = getTargetLang(glossary, targetLang);
    await this.glossaryService.updateEntry(
      glossary.glossary_id,
      glossary.source_lang,
      target,
      sourceText,
      newTargetText
    );
  }

  /**
   * Remove an entry from a glossary (v3 API - requires target lang for multilingual glossaries)
   */
  async removeEntry(
    nameOrId: string,
    sourceText: string,
    targetLang?: Language
  ): Promise<void> {
    const glossary = await this.show(nameOrId);
    // Get target language (will throw if glossary is multilingual and targetLang not provided)
    const target = getTargetLang(glossary, targetLang);
    await this.glossaryService.removeEntry(
      glossary.glossary_id,
      glossary.source_lang,
      target,
      sourceText
    );
  }

  /**
   * Update a glossary (v3 API - PATCH endpoint for combined name+dictionary updates)
   */
  async update(
    nameOrId: string,
    options: {
      name?: string;
      dictionaries?: Array<{
        targetLang: Language;
        entries: Record<string, string>;
      }>;
    }
  ): Promise<void> {
    const glossary = await this.show(nameOrId);
    await this.glossaryService.updateGlossary(glossary.glossary_id, {
      name: options.name,
      dictionaries: options.dictionaries?.map(dict => ({
        sourceLang: glossary.source_lang,
        targetLang: dict.targetLang,
        entries: dict.entries,
      })),
    });
  }

  /**
   * Rename a glossary (v3 API - uses PATCH)
   */
  async rename(
    nameOrId: string,
    newName: string
  ): Promise<void> {
    const glossary = await this.show(nameOrId);
    await this.glossaryService.renameGlossary(glossary.glossary_id, newName);
  }

  /**
   * Replace all entries in a glossary dictionary from a TSV/CSV file (v3 API)
   */
  async replaceDictionary(
    nameOrId: string,
    targetLang: Language,
    filePath: string
  ): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new ValidationError(`File not found: ${filePath}`);
    }

    const glossary = await this.show(nameOrId);
    const content = safeReadFileSync(filePath, 'utf-8');
    await this.glossaryService.replaceGlossaryDictionary(
      glossary.glossary_id,
      glossary.source_lang,
      targetLang,
      content
    );
  }

  /**
   * Delete a dictionary from a multilingual glossary (v3 API)
   */
  async deleteDictionary(
    nameOrId: string,
    targetLang: Language
  ): Promise<void> {
    const glossary = await this.show(nameOrId);
    await this.glossaryService.deleteGlossaryDictionary(
      glossary.glossary_id,
      glossary.source_lang,
      targetLang
    );
  }

  /**
   * Format glossary info for display (v3 structure)
   */
  formatGlossaryInfo(glossary: GlossaryInfo): string {
    const totalEntries = getTotalEntryCount(glossary);
    const multilingual = isMultilingual(glossary);

    const created = new Date(glossary.creation_time);
    const createdStr = Number.isNaN(created.getTime())
      ? glossary.creation_time
      : created.toISOString();

    const lines = [
      `Name: ${sanitizeForTerminal(glossary.name)}`,
      `ID: ${glossary.glossary_id}`,
      `Source language: ${glossary.source_lang.toUpperCase()}`,
      `Target languages: ${glossary.target_langs.map(l => l.toUpperCase()).join(', ')}`,
      `Type: ${multilingual ? 'Multilingual' : 'Single target'}`,
      `Total entries: ${totalEntries}`,
      `Created: ${createdStr}`,
    ];

    if (multilingual) {
      lines.push('\nLanguage pairs:');
      glossary.dictionaries.forEach(dict => {
        lines.push(`  ${dict.source_lang.toUpperCase()} → ${dict.target_lang.toUpperCase()}: ${dict.entry_count} entries`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Format glossary list for display (v3 structure)
   */
  formatGlossaryList(glossaries: GlossaryInfo[]): string {
    if (glossaries.length === 0) {
      return 'No glossaries found';
    }

    const lines = glossaries.map(g => {
      const totalEntries = getTotalEntryCount(g);
      const targetStr = g.target_langs.length === 1
        ? g.target_langs[0]
        : `${g.target_langs.length} targets`;
      const icon = isMultilingual(g) ? '📚' : '📖';
      return `${icon} ${sanitizeForTerminal(g.name)} (${g.source_lang}→${targetStr}) - ${totalEntries} entries`;
    });

    return lines.join('\n');
  }

  /**
   * Format glossary entries for display
   */
  formatEntries(entries: Record<string, string>): string {
    if (Object.keys(entries).length === 0) {
      return 'No entries found';
    }

    const lines = Object.entries(entries).map(
      ([source, target]) => `${source} → ${target}`
    );

    return lines.join('\n');
  }

  /**
   * Format glossary language pairs for display
   */
  formatLanguagePairs(pairs: GlossaryLanguagePair[]): string {
    if (pairs.length === 0) {
      return 'No language pairs available';
    }

    const lines = pairs.map(
      (pair) => `${pair.sourceLang} → ${pair.targetLang}`
    );

    return lines.join('\n');
  }
}

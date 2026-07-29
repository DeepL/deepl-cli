import { HttpClient, DeepLClientOptions } from './http-client.js';
import { Language, GlossaryInfo, GlossaryLanguagePair, normalizeGlossaryInfo, GlossaryApiResponse } from '../types/index.js';
import { ValidationError } from '../utils/errors.js';

interface DeepLGlossaryLanguagePairsResponse {
  supported_languages: Array<{
    source_lang: string;
    target_lang: string;
  }>;
}

export class GlossaryClient extends HttpClient {
  constructor(apiKey: string, options: DeepLClientOptions = {}) {
    super(apiKey, options);
  }

  async getGlossaryLanguages(): Promise<GlossaryLanguagePair[]> {
    const response = await this.makeRequest<DeepLGlossaryLanguagePairsResponse>(
      'GET',
      '/v2/glossary-language-pairs'
    );

    return response.supported_languages.map((pair) => ({
      sourceLang: this.normalizeLanguage(pair.source_lang),
      targetLang: this.normalizeLanguage(pair.target_lang),
    }));
  }

  async createGlossary(
    name: string,
    sourceLang: Language,
    targetLangs: Language[],
    entries: string
  ): Promise<GlossaryInfo> {
    if (targetLangs.length === 0) {
      throw new ValidationError('At least one target language is required');
    }

    const dictionaries = targetLangs.map(targetLang => ({
      source_lang: sourceLang.toUpperCase(),
      target_lang: targetLang.toUpperCase(),
      entries,
      entries_format: 'tsv',
    }));

    const response = await this.makeJsonRequest<GlossaryApiResponse>(
      'POST', '/v3/glossaries',
      { name, dictionaries }
    );

    return normalizeGlossaryInfo(response);
  }

  async listGlossaries(): Promise<GlossaryInfo[]> {
    try {
      const response = await this.makeRequest<{ glossaries: GlossaryApiResponse[] }>(
        'GET',
        '/v3/glossaries'
      );

      return (response.glossaries || []).map((g) =>
        normalizeGlossaryInfo(g, { warnOnEmpty: false }),
      );
    } catch (error) {
      throw this.handleError(error, 'listGlossaries');
    }
  }

  async getGlossary(glossaryId: string): Promise<GlossaryInfo> {
    this.validateGlossaryId(glossaryId);
    const response = await this.makeRequest<GlossaryApiResponse>(
      'GET',
      `/v3/glossaries/${glossaryId}`
    );

    return normalizeGlossaryInfo(response);
  }

  async deleteGlossary(glossaryId: string): Promise<void> {
    this.validateGlossaryId(glossaryId);
    await this.makeRequest<void>(
      'DELETE',
      `/v3/glossaries/${glossaryId}`
    );
  }

  async getGlossaryEntries(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language
  ): Promise<string> {
    this.validateGlossaryId(glossaryId);
    const response = await this.makeRequest<{
      dictionaries: Array<{
        source_lang: string;
        target_lang: string;
        entries: string;
        entries_format: string;
      }>;
    }>('GET', `/v3/glossaries/${glossaryId}/entries`, {
      source_lang: sourceLang.toUpperCase(),
      target_lang: targetLang.toUpperCase(),
    });

    if (!response.dictionaries || response.dictionaries.length === 0) {
      return '';
    }

    const dictionary = response.dictionaries[0];
    if (!dictionary) {
      return '';
    }

    return dictionary.entries;
  }

  async updateGlossaryEntries(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    entries: string
  ): Promise<void> {
    this.validateGlossaryId(glossaryId);
    await this.makeJsonRequest<void>(
      'PATCH',
      `/v3/glossaries/${glossaryId}`,
      {
        dictionaries: [{
          source_lang: sourceLang.toUpperCase(),
          target_lang: targetLang.toUpperCase(),
          entries,
          entries_format: 'tsv',
        }],
      }
    );
  }

  async replaceGlossaryDictionary(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    entries: string
  ): Promise<void> {
    this.validateGlossaryId(glossaryId);
    await this.makeJsonRequest<void>(
      'PUT',
      `/v3/glossaries/${glossaryId}/dictionaries`,
      {
        source_lang: sourceLang.toUpperCase(),
        target_lang: targetLang.toUpperCase(),
        entries,
        entries_format: 'tsv',
      }
    );
  }

  async updateGlossary(
    glossaryId: string,
    updates: {
      name?: string;
      dictionaries?: Array<{
        source_lang: string;
        target_lang: string;
        entries: string;
        entries_format: string;
      }>;
    }
  ): Promise<void> {
    this.validateGlossaryId(glossaryId);
    if (!updates.name && !updates.dictionaries) {
      throw new ValidationError('At least one of name or dictionaries must be provided');
    }
    await this.makeJsonRequest<void>(
      'PATCH',
      `/v3/glossaries/${glossaryId}`,
      updates
    );
  }

  async renameGlossary(glossaryId: string, newName: string): Promise<void> {
    return this.updateGlossary(glossaryId, { name: newName });
  }

  async deleteGlossaryDictionary(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language
  ): Promise<void> {
    this.validateGlossaryId(glossaryId);
    const params = new URLSearchParams({
      source_lang: sourceLang.toUpperCase(),
      target_lang: targetLang.toUpperCase(),
    });
    await this.makeRequest<void>(
      'DELETE',
      `/v3/glossaries/${glossaryId}/dictionaries?${params.toString()}`
    );
  }

  private validateGlossaryId(glossaryId: string): void {
    if (!/^[a-zA-Z0-9-]+$/.test(glossaryId)) {
      throw new ValidationError('Invalid glossary ID format');
    }
  }
}

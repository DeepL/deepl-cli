import { HttpClient, DeepLClientOptions } from './http-client.js';
import { TranslationClient, TranslationResult, isTranslationResult, ProductUsage, UsageInfo, LanguageInfo } from './translation-client.js';
import { GlossaryClient } from './glossary-client.js';
import { DocumentClient } from './document-client.js';
import { WriteClient } from './write-client.js';
import { StyleRulesClient } from './style-rules-client.js';
import { AdminClient } from './admin-client.js';
import {
  TranslationOptions,
  Language,
  WriteOptions,
  CorrectOptions,
  WriteImprovement,
  DocumentTranslationOptions,
  DocumentHandle,
  DocumentStatus,
  GlossaryInfo,
  GlossaryLanguagePair,
  TranslationMemory,
  StyleRule,
  StyleRuleDetailed,
  StyleRulesListOptions,
  CreateStyleRuleOptions,
  UpdateStyleRuleOptions,
  CustomInstruction,
  ConfiguredRules,
  CreateCustomInstructionOptions,
  UpdateCustomInstructionOptions,
  AdminApiKey,
  AdminUsageOptions,
  AdminUsageReport,
} from '../types/index.js';

export { TranslationResult, isTranslationResult, ProductUsage, UsageInfo, LanguageInfo };

export class DeepLClient {
  private readonly apiKey: string;
  private readonly options: DeepLClientOptions;

  private _translationClient?: TranslationClient;
  private _glossaryClient?: GlossaryClient;
  private _documentClient?: DocumentClient;
  private _writeClient?: WriteClient;
  private _styleRulesClient?: StyleRulesClient;
  private _adminClient?: AdminClient;

  constructor(apiKey: string, options: DeepLClientOptions = {}) {
    HttpClient.validateConfig(apiKey, options);
    this.apiKey = apiKey;
    this.options = options;
  }

  private get translationClient(): TranslationClient {
    this._translationClient ??= new TranslationClient(this.apiKey, this.options);
    return this._translationClient;
  }

  private get glossaryClient(): GlossaryClient {
    this._glossaryClient ??= new GlossaryClient(this.apiKey, this.options);
    return this._glossaryClient;
  }

  private get documentClient(): DocumentClient {
    this._documentClient ??= new DocumentClient(this.apiKey, this.options);
    return this._documentClient;
  }

  private get writeClient(): WriteClient {
    this._writeClient ??= new WriteClient(this.apiKey, this.options);
    return this._writeClient;
  }

  private get styleRulesClient(): StyleRulesClient {
    this._styleRulesClient ??= new StyleRulesClient(this.apiKey, this.options);
    return this._styleRulesClient;
  }

  private get adminClient(): AdminClient {
    this._adminClient ??= new AdminClient(this.apiKey, this.options);
    return this._adminClient;
  }

  destroy(): void {
    this._translationClient?.destroy();
    this._glossaryClient?.destroy();
    this._documentClient?.destroy();
    this._writeClient?.destroy();
    this._styleRulesClient?.destroy();
    this._adminClient?.destroy();
  }

  get lastTraceId(): string | undefined {
    return this.translationClient.lastTraceId;
  }

  async translate(
    text: string,
    options: TranslationOptions
  ): Promise<TranslationResult> {
    return this.translationClient.translate(text, options);
  }

  async translateBatch(
    texts: string[],
    options: TranslationOptions
  ): Promise<TranslationResult[]> {
    return this.translationClient.translateBatch(texts, options);
  }

  async getUsage(): Promise<UsageInfo> {
    return this.translationClient.getUsage();
  }

  async getSupportedLanguages(
    type: 'source' | 'target'
  ): Promise<LanguageInfo[]> {
    return this.translationClient.getSupportedLanguages(type);
  }

  async listTranslationMemories(): Promise<TranslationMemory[]> {
    return this.translationClient.listTranslationMemories();
  }

  async getGlossaryLanguages(): Promise<GlossaryLanguagePair[]> {
    return this.glossaryClient.getGlossaryLanguages();
  }

  async createGlossary(
    name: string,
    sourceLang: Language,
    targetLangs: Language[],
    entries: string
  ): Promise<GlossaryInfo> {
    return this.glossaryClient.createGlossary(name, sourceLang, targetLangs, entries);
  }

  async listGlossaries(): Promise<GlossaryInfo[]> {
    return this.glossaryClient.listGlossaries();
  }

  async getGlossary(glossaryId: string): Promise<GlossaryInfo> {
    return this.glossaryClient.getGlossary(glossaryId);
  }

  async deleteGlossary(glossaryId: string): Promise<void> {
    return this.glossaryClient.deleteGlossary(glossaryId);
  }

  async getGlossaryEntries(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language
  ): Promise<string> {
    return this.glossaryClient.getGlossaryEntries(glossaryId, sourceLang, targetLang);
  }

  async updateGlossaryEntries(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    entries: string
  ): Promise<void> {
    return this.glossaryClient.updateGlossaryEntries(glossaryId, sourceLang, targetLang, entries);
  }

  async replaceGlossaryDictionary(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language,
    entries: string
  ): Promise<void> {
    return this.glossaryClient.replaceGlossaryDictionary(glossaryId, sourceLang, targetLang, entries);
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
    return this.glossaryClient.updateGlossary(glossaryId, updates);
  }

  async renameGlossary(glossaryId: string, newName: string): Promise<void> {
    return this.glossaryClient.renameGlossary(glossaryId, newName);
  }

  async deleteGlossaryDictionary(
    glossaryId: string,
    sourceLang: Language,
    targetLang: Language
  ): Promise<void> {
    return this.glossaryClient.deleteGlossaryDictionary(glossaryId, sourceLang, targetLang);
  }

  async uploadDocument(
    file: Buffer,
    options: DocumentTranslationOptions
  ): Promise<DocumentHandle> {
    return this.documentClient.uploadDocument(file, options);
  }

  async getDocumentStatus(handle: DocumentHandle): Promise<DocumentStatus> {
    return this.documentClient.getDocumentStatus(handle);
  }

  async downloadDocument(handle: DocumentHandle): Promise<Buffer> {
    return this.documentClient.downloadDocument(handle);
  }

  async improveText(
    text: string,
    options: WriteOptions
  ): Promise<WriteImprovement[]> {
    return this.writeClient.improveText(text, options);
  }

  async correctText(
    text: string,
    options: CorrectOptions = {}
  ): Promise<WriteImprovement[]> {
    return this.writeClient.correctText(text, options);
  }

  async getStyleRules(
    options: StyleRulesListOptions = {}
  ): Promise<(StyleRule | StyleRuleDetailed)[]> {
    return this.styleRulesClient.getStyleRules(options);
  }

  async createStyleRule(options: CreateStyleRuleOptions): Promise<StyleRule> {
    return this.styleRulesClient.createStyleRule(options);
  }

  async getStyleRule(styleId: string, detailed = false): Promise<StyleRule | StyleRuleDetailed> {
    return this.styleRulesClient.getStyleRule(styleId, detailed);
  }

  async updateStyleRule(styleId: string, options: UpdateStyleRuleOptions): Promise<StyleRule> {
    return this.styleRulesClient.updateStyleRule(styleId, options);
  }

  async deleteStyleRule(styleId: string): Promise<void> {
    return this.styleRulesClient.deleteStyleRule(styleId);
  }

  async replaceConfiguredRules(styleId: string, rules: ConfiguredRules): Promise<StyleRuleDetailed> {
    return this.styleRulesClient.replaceConfiguredRules(styleId, rules);
  }

  async createCustomInstruction(
    styleId: string,
    options: CreateCustomInstructionOptions,
  ): Promise<CustomInstruction> {
    return this.styleRulesClient.createCustomInstruction(styleId, options);
  }

  async getCustomInstruction(styleId: string, label: string): Promise<CustomInstruction> {
    return this.styleRulesClient.getCustomInstruction(styleId, label);
  }

  async updateCustomInstruction(
    styleId: string,
    label: string,
    options: UpdateCustomInstructionOptions,
  ): Promise<CustomInstruction> {
    return this.styleRulesClient.updateCustomInstruction(styleId, label, options);
  }

  async deleteCustomInstruction(styleId: string, label: string): Promise<void> {
    return this.styleRulesClient.deleteCustomInstruction(styleId, label);
  }

  async listApiKeys(): Promise<AdminApiKey[]> {
    return this.adminClient.listApiKeys();
  }

  async createApiKey(label?: string): Promise<AdminApiKey> {
    return this.adminClient.createApiKey(label);
  }

  async deactivateApiKey(keyId: string): Promise<void> {
    return this.adminClient.deactivateApiKey(keyId);
  }

  async renameApiKey(keyId: string, label: string): Promise<void> {
    return this.adminClient.renameApiKey(keyId, label);
  }

  async setApiKeyLimit(keyId: string, characters: number | null): Promise<void> {
    return this.adminClient.setApiKeyLimit(keyId, characters);
  }

  async getAdminUsage(options: AdminUsageOptions): Promise<AdminUsageReport> {
    return this.adminClient.getAdminUsage(options);
  }
}

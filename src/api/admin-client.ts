import { HttpClient, DeepLClientOptions } from './http-client.js';
import { AdminApiKey, AdminUsageOptions, AdminUsageReport, UsageBreakdown } from '../types/index.js';
import { AuthError } from '../utils/errors.js';

export class AdminClient extends HttpClient {
  constructor(apiKey: string, options: DeepLClientOptions = {}) {
    super(apiKey, options);
  }

  /**
   * Admin endpoints reject valid non-admin keys with 401/403, so the default
   * "re-set your key" suggestion is misleading here. Keep the classification
   * (and exit code) but point at the actual requirement.
   */
  protected override handleError(
    error: unknown,
    context?: string,
    traceId?: string,
  ): Error {
    const result = super.handleError(error, context, traceId);
    if (result instanceof AuthError) {
      return new AuthError(
        result.message,
        'The admin API requires an administrator API key; a valid regular API key is not sufficient. Use a key created by your DeepL account administrator.',
      );
    }
    return result;
  }

  async listApiKeys(): Promise<AdminApiKey[]> {
    const response = await this.makeJsonRequest<Array<{
      key_id: string;
      label: string;
      creation_time: string;
      is_deactivated: boolean;
      usage_limits?: { characters?: number | null; speech_to_text_milliseconds?: number | null };
    }>>('GET', '/v2/admin/developer-keys');

    return response.map((key) => this.normalizeApiKey(key));
  }

  async createApiKey(label?: string): Promise<AdminApiKey> {
    const body: Record<string, string> = {};
    if (label) {
      body['label'] = label;
    }

    const response = await this.makeJsonRequest<{
      key_id: string;
      key?: string;
      label: string;
      creation_time: string;
      is_deactivated: boolean;
      usage_limits?: { characters?: number | null; speech_to_text_milliseconds?: number | null };
    }>('POST', '/v2/admin/developer-keys', body);

    return this.normalizeApiKey(response);
  }

  async deactivateApiKey(keyId: string): Promise<void> {
    await this.makeJsonRequest<void>(
      'PUT', '/v2/admin/developer-keys/deactivate', { key_id: keyId }
    );
  }

  async renameApiKey(keyId: string, label: string): Promise<void> {
    await this.makeJsonRequest<void>(
      'PUT', '/v2/admin/developer-keys/label', { key_id: keyId, label }
    );
  }

  async setApiKeyLimit(
    keyId: string,
    characters: number | null,
    speechToTextMilliseconds?: number | null,
  ): Promise<void> {
    const body: Record<string, unknown> = { key_id: keyId, characters };
    if (speechToTextMilliseconds !== undefined) {
      body['speech_to_text_milliseconds'] = speechToTextMilliseconds;
    }
    await this.makeJsonRequest<void>(
      'PUT', '/v2/admin/developer-keys/limits',
      body
    );
  }

  async getAdminUsage(options: AdminUsageOptions): Promise<AdminUsageReport> {
    const params: Record<string, string> = {
      start_date: options.startDate,
      end_date: options.endDate,
    };

    if (options.groupBy) {
      params['group_by'] = options.groupBy;
    }

    interface RawUsageBreakdown {
      total_characters: number;
      text_translation_characters: number;
      document_translation_characters: number;
      text_improvement_characters: number;
      speech_to_text_milliseconds: number;
    }

    interface RawEntry {
      api_key?: string;
      api_key_label?: string;
      usage_date?: string;
      usage: RawUsageBreakdown;
    }

    const response = await this.makeJsonRequest<{
      usage_report: {
        total_usage: RawUsageBreakdown;
        start_date: string;
        end_date: string;
        group_by?: string;
        key_usages?: RawEntry[];
        key_and_day_usages?: RawEntry[];
      };
    }>('GET', '/v2/admin/analytics', params);

    const report = response.usage_report;

    const mapBreakdown = (raw: RawUsageBreakdown): UsageBreakdown => ({
      totalCharacters: raw.total_characters,
      textTranslationCharacters: raw.text_translation_characters,
      documentTranslationCharacters: raw.document_translation_characters,
      textImprovementCharacters: raw.text_improvement_characters,
      speechToTextMilliseconds: raw.speech_to_text_milliseconds,
    });

    const rawEntries = report.key_usages ?? report.key_and_day_usages ?? [];

    return {
      totalUsage: mapBreakdown(report.total_usage),
      startDate: report.start_date,
      endDate: report.end_date,
      groupBy: report.group_by,
      entries: rawEntries.map((entry) => ({
        apiKey: entry.api_key,
        apiKeyLabel: entry.api_key_label,
        usageDate: entry.usage_date,
        usage: mapBreakdown(entry.usage),
      })),
    };
  }

  private normalizeApiKey(key: {
    key_id: string;
    key?: string;
    label: string;
    creation_time: string;
    is_deactivated: boolean;
    usage_limits?: { characters?: number | null; speech_to_text_milliseconds?: number | null };
  }): AdminApiKey {
    const result: AdminApiKey = {
      keyId: key.key_id,
      label: key.label,
      creationTime: key.creation_time,
      isDeactivated: key.is_deactivated,
    };
    if (key.usage_limits) {
      result.usageLimits = {
        characters: key.usage_limits.characters,
        ...(key.usage_limits.speech_to_text_milliseconds !== undefined && {
          speechToTextMilliseconds: key.usage_limits.speech_to_text_milliseconds,
        }),
      };
    }
    if (key.key) {
      result.key = key.key;
    }
    return result;
  }
}

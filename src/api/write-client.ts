import { HttpClient, DeepLClientOptions } from './http-client.js';
import { WriteOptions, CorrectOptions, WriteImprovement } from '../types/index.js';
import { NetworkError, ValidationError } from '../utils/errors.js';

interface DeepLWriteResponse {
  improvements: Array<{
    text: string;
    target_language: string;
    detected_source_language?: string;
  }>;
}

export class WriteClient extends HttpClient {
  constructor(apiKey: string, options: DeepLClientOptions = {}) {
    super(apiKey, options);
  }

  async improveText(
    text: string,
    options: WriteOptions
  ): Promise<WriteImprovement[]> {
    const params: Record<string, string | string[]> = {
      text: [text],
    };

    if (options.targetLang) {
      params['target_lang'] = options.targetLang;
    }

    if (options.writingStyle) {
      params['writing_style'] = options.writingStyle;
    }

    if (options.tone) {
      params['tone'] = options.tone;
    }

    try {
      const response = await this.makeRequest<DeepLWriteResponse>(
        'POST',
        '/v2/write/rephrase',
        params
      );

      return this.mapImprovements(response);
    } catch (error) {
      const translated = this.handleError(error);
      if (
        translated instanceof ValidationError &&
        (options.writingStyle !== undefined || options.tone !== undefined)
      ) {
        throw new ValidationError(
          `${translated.message} See https://github.com/DeepL/deepl-cli/blob/main/docs/API.md#write for supported target language / style / tone combinations.`
        );
      }
      throw translated;
    }
  }

  async correctText(
    text: string,
    options: CorrectOptions
  ): Promise<WriteImprovement[]> {
    const params: Record<string, string | string[]> = {
      text: [text],
    };

    if (options.targetLang) {
      params['target_lang'] = options.targetLang;
    }

    try {
      const response = await this.makeRequest<DeepLWriteResponse>(
        'POST',
        '/v2/write/correct',
        params
      );

      return this.mapImprovements(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private mapImprovements(response: DeepLWriteResponse): WriteImprovement[] {
    if (!response.improvements || response.improvements.length === 0) {
      throw new NetworkError('No improvements returned');
    }

    return response.improvements.map(improvement => ({
      text: improvement.text,
      targetLanguage: improvement.target_language as WriteImprovement['targetLanguage'],
      detectedSourceLanguage: improvement.detected_source_language,
    }));
  }
}

import { HttpClient, DeepLClientOptions } from './http-client.js';
import { DocumentTranslationOptions, DocumentHandle, DocumentStatus } from '../types/index.js';
import { ValidationError } from '../utils/errors.js';
import { normalizeFormality } from '../utils/formality.js';

interface DeepLDocumentUploadResponse {
  document_id: string;
  document_key: string;
}

interface DeepLDocumentStatusResponse {
  document_id: string;
  status: 'queued' | 'translating' | 'done' | 'error';
  seconds_remaining?: number;
  billed_characters?: number;
  error_message?: string;
}

/** Uploads and downloads move whole files, so they need far more headroom
 *  than the interactive request timeout. */
const TRANSFER_TIMEOUT_MS = 300_000;

export class DocumentClient extends HttpClient {
  constructor(apiKey: string, options: DeepLClientOptions = {}) {
    super(apiKey, options);
  }

  private get transferTimeout(): number {
    return Math.max(this.requestTimeout, TRANSFER_TIMEOUT_MS);
  }

  async uploadDocument(
    file: Buffer,
    options: DocumentTranslationOptions
  ): Promise<DocumentHandle> {
    if (!file || file.length === 0) {
      throw new ValidationError('Document file cannot be empty');
    }

    if (!options.filename) {
      throw new ValidationError('filename is required when uploading document as Buffer');
    }

    const { default: FormData } = await import('form-data');

    try {
      const response = await this.makeRawRequest<DeepLDocumentUploadResponse>(
        'POST',
        '/v2/document',
        () => {
          const formData = new FormData();
          formData.append('file', file, options.filename);
          formData.append('target_lang', this.normalizeLanguage(options.targetLang).toUpperCase());

          if (options.sourceLang) {
            formData.append('source_lang', this.normalizeLanguage(options.sourceLang).toUpperCase());
          }
          if (options.formality) {
            formData.append('formality', normalizeFormality(options.formality, 'text'));
          }
          if (options.glossaryId) {
            formData.append('glossary_id', options.glossaryId);
          }
          if (options.outputFormat) {
            formData.append('output_format', options.outputFormat);
          }
          if (options.enableDocumentMinification) {
            formData.append('enable_document_minification', '1');
          }
          if (options.enableBetaLanguages) {
            formData.append('enable_beta_languages', '1');
          }

          return {
            data: formData,
            headers: {
              ...formData.getHeaders(),
            },
          };
        },
        { timeout: this.transferTimeout }
      );

      return {
        documentId: response.document_id,
        documentKey: response.document_key,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getDocumentStatus(handle: DocumentHandle): Promise<DocumentStatus> {
    try {
      const response = await this.makeRequest<DeepLDocumentStatusResponse>(
        'POST',
        `/v2/document/${handle.documentId}`,
        { document_key: handle.documentKey }
      );

      return {
        documentId: response.document_id,
        status: response.status,
        secondsRemaining: response.seconds_remaining,
        billedCharacters: response.billed_characters,
        errorMessage: response.error_message,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * The result endpoint is effectively single-use: a replayed download can
   * consume the result of an already-billed translation and lose it
   * permanently, so this request is never retried.
   */
  async downloadDocument(handle: DocumentHandle): Promise<Buffer> {
    try {
      const response = await this.makeRawRequest<Buffer>(
        'POST',
        `/v2/document/${handle.documentId}/result`,
        () => {
          const formData = new URLSearchParams();
          formData.append('document_key', handle.documentKey);
          return {
            data: formData.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            responseType: 'arraybuffer',
          };
        },
        { maxRetries: 0, timeout: this.transferTimeout }
      );

      return Buffer.from(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }
}

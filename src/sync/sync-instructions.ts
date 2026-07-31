/**
 * Auto-generation of custom_instructions for the DeepL API based on HTML
 * element types. Custom instructions are supported for a limited set of
 * locales; this module encapsulates locale detection, template lookup,
 * instruction merging, and length-aware instruction generation.
 */

import { Logger } from '../utils/logger.js';

export const MAX_INSTRUCTIONS = 5;
export const MAX_INSTRUCTION_LENGTH = 2000;

const SUPPORTED_BASE_LOCALES = new Set(['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'zh']);

export const CUSTOM_INSTRUCTION_LOCALES: Set<string> = SUPPORTED_BASE_LOCALES;

function extractBaseLocale(locale: string): string {
  return locale.split(/[-_]/)[0]!.toLowerCase();
}

export function supportsCustomInstructions(locale: string): boolean {
  if (!locale) return false;
  return SUPPORTED_BASE_LOCALES.has(extractBaseLocale(locale));
}

export const DEFAULT_INSTRUCTION_TEMPLATES: Record<string, string> = {
  button: 'Keep translation concise, maximum 3 words.',
  a: 'Link text. Keep concise.',
  h1: 'Main heading. Keep concise and impactful.',
  h2: 'Section heading. Keep concise and impactful.',
  h3: 'Subheading. Keep concise.',
  h4: 'Subheading. Keep concise.',
  h5: 'Subheading. Keep concise.',
  h6: 'Subheading. Keep concise.',
  th: 'Table column header. Maximum 2 words.',
  label: 'Form label. Keep concise.',
  option: 'Dropdown option. Keep concise.',
  input: 'Form placeholder text. Keep very brief.',
  title: 'Page or section title. Keep concise.',
  summary: 'Disclosure label. Keep concise.',
  legend: 'Fieldset legend. Keep concise.',
  caption: 'Table caption. Keep concise.',
};

export function generateElementInstruction(
  elementType: string | null | undefined,
  userTemplates?: Record<string, string>,
): string | undefined {
  if (elementType === null || elementType === undefined) return undefined;

  const merged = userTemplates
    ? { ...DEFAULT_INSTRUCTION_TEMPLATES, ...userTemplates }
    : DEFAULT_INSTRUCTION_TEMPLATES;

  return merged[elementType];
}

export function mergeInstructions(
  userInstructions: string[] | undefined,
  autoInstruction: string | undefined,
): string[] | undefined {
  const parts: string[] = [];

  if (userInstructions) {
    parts.push(...userInstructions);
  }

  if (autoInstruction !== undefined) {
    parts.push(autoInstruction);
  }

  if (parts.length === 0) return undefined;

  let truncatedLength = false;
  const capped = parts.map(instruction => {
    if (instruction.length > MAX_INSTRUCTION_LENGTH) {
      truncatedLength = true;
      return instruction.slice(0, MAX_INSTRUCTION_LENGTH);
    }
    return instruction;
  });

  if (truncatedLength) {
    Logger.warn(`One or more instructions exceeded ${MAX_INSTRUCTION_LENGTH} characters and were truncated.`);
  }

  if (capped.length > MAX_INSTRUCTIONS) {
    Logger.warn(`Instructions count (${capped.length}) exceeds maximum of ${MAX_INSTRUCTIONS}; extra instructions dropped.`);
    return capped.slice(0, MAX_INSTRUCTIONS);
  }

  return capped;
}

// ---------------------------------------------------------------------------
// Length-aware instructions
// ---------------------------------------------------------------------------

// Industry-standard approximations (IBM, W3C localization guidelines).
// Not calculated from our data. Users can override via length_limits.expansion_factors.
export const DEFAULT_EXPANSION_FACTORS: Record<string, number> = {
  de: 1.3, es: 1.25, fr: 1.3, it: 1.25,
  'pt-br': 1.25, 'pt-pt': 1.25,
  ja: 0.5, ko: 0.7, zh: 0.5,
  ar: 1.2, he: 1.0, nl: 1.1,
  pl: 1.1, ru: 1.1, tr: 1.1,
};

export const LENGTH_CONSTRAINED_ELEMENTS: Set<string> = new Set([
  'button', 'th', 'label', 'option', 'input', 'title',
]);

const MIN_LENGTH_CHARS = 5;

export function generateLengthInstruction(
  sourceText: string,
  elementType: string | null | undefined,
  locale: string,
  config?: { expansion_factors?: Record<string, number> },
): string | undefined {
  if (elementType === null || elementType === undefined) return undefined;
  if (!LENGTH_CONSTRAINED_ELEMENTS.has(elementType)) return undefined;

  const factors = config?.expansion_factors
    ? { ...DEFAULT_EXPANSION_FACTORS, ...config.expansion_factors }
    : DEFAULT_EXPANSION_FACTORS;

  const normalizedLocale = locale.toLowerCase();
  const factor = factors[normalizedLocale] ?? factors[extractBaseLocale(normalizedLocale)];
  if (factor === undefined) return undefined;

  const max = Math.ceil(sourceText.length * factor * 1.1);
  if (max < MIN_LENGTH_CHARS) return undefined;

  return `Keep translation under ${max} characters.`;
}

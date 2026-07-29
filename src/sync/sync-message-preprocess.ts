/**
 * Pipeline position invariants
 * ---------------------------------------------------------------------------
 * expandPlurals → detectIcu → (translate via service) → reassembleIcu → writebackPlurals
 *
 * Every function preserves array length and ti-position assignments for
 * extendedTexts, so pluralSlots.textIndex and icuMappings.textIndex remain
 * valid indices into the results[] array that comes back from translateBatch.
 *
 * Swapping expandPlurals and detectIcu causes non-primary plural quantity
 * values to bypass ICU placeholder substitution and fall through to the main
 * batch.
 */

import { parseIcu } from '../utils/icu-preservation.js';
import { preserveVariables, restorePlaceholders } from '../utils/text-preservation.js';
import type { TranslationService } from '../services/translation.js';
import type { TranslationOptions } from '../types/api.js';
import type { TranslationResult } from '../api/translation-client.js';
import type { SyncDiff } from './types.js';

export interface PluralSlot {
  diffIndex: number;
  format: 'android' | 'po';
  slotKey: string;
  textIndex: number;
}

export interface IcuMapping {
  textIndex: number;
  icuResult: ReturnType<typeof parseIcu>;
}

export function expandPlurals(
  textsToTranslate: string[],
  localeDiffs: SyncDiff[],
): { extendedTexts: string[]; pluralSlots: PluralSlot[] } {
  const pluralSlots: PluralSlot[] = [];
  const extendedTexts = [...textsToTranslate];

  for (let di = 0; di < localeDiffs.length; di++) {
    const diff = localeDiffs[di]!;
    if (!diff.metadata) continue;

    const androidPlurals = diff.metadata['plurals'] as Array<{quantity: string; value: string}> | undefined;
    if (androidPlurals) {
      for (const p of androidPlurals) {
        if (p.value === diff.value) continue;
        pluralSlots.push({ diffIndex: di, format: 'android', slotKey: p.quantity, textIndex: extendedTexts.length });
        extendedTexts.push(p.value);
      }
    }

    const msgidPlural = diff.metadata['msgid_plural'] as string | undefined;
    if (msgidPlural && msgidPlural !== diff.value) {
      pluralSlots.push({ diffIndex: di, format: 'po', slotKey: 'msgid_plural', textIndex: extendedTexts.length });
      extendedTexts.push(msgidPlural);
    }
  }

  return { extendedTexts, pluralSlots };
}

export function detectIcu(
  extendedTexts: string[],
): { extendedTexts: string[]; icuMappings: IcuMapping[] } {
  const icuMappings: IcuMapping[] = [];
  const out = [...extendedTexts];

  for (let ti = 0; ti < out.length; ti++) {
    const icuResult = parseIcu(out[ti]!);
    if (icuResult.isIcu && icuResult.segments.length > 0) {
      icuMappings.push({ textIndex: ti, icuResult });
      // ICU strings skip the main batch and get translated segment-by-segment.
      out[ti] = `__ICU_PLACEHOLDER_${ti}__`;
    }
  }

  return { extendedTexts: out, icuMappings };
}

export async function reassembleIcu(
  translationService: TranslationService,
  results: (TranslationResult | null)[],
  icuMappings: IcuMapping[],
  baseOpts: TranslationOptions,
): Promise<void> {
  for (const icu of icuMappings) {
    const segTexts = icu.icuResult.segments.map(seg => {
      let text = seg.text;
      const pMap = new Map<string, string>();
      if (seg.isPluralBranch) {
        // Protect bare `#` in plural branches from being translated as literal text.
        text = text.replace(/(?<!\w)#(?!\w)/g, (m) => {
          const ph = `__VAR_HASH_${pMap.size}__`;
          pMap.set(ph, m);
          return ph;
        });
      }
      return { text: preserveVariables(text, pMap), pMap };
    });

    const segResults = await translationService.translateBatch(
      segTexts.map(s => s.text),
      { ...baseOpts },
    );

    // Every segment must come back. Substituting the source segment for a failed
    // one would emit a part-source message reported as successfully translated,
    // so leave the result unset — the message is marked failed and retried.
    const anySegmentFailed =
      segResults.length !== segTexts.length || segResults.some((sr) => !sr?.text);
    if (anySegmentFailed) {
      results[icu.textIndex] = null;
      continue;
    }

    const translatedSegments = segResults.map((sr, si) => {
      let translated = sr.text;
      const pMap = segTexts[si]!.pMap;
      if (pMap.size > 0) translated = restorePlaceholders(translated, pMap);
      return translated;
    });

    const reassembled = icu.icuResult.reassemble(translatedSegments);
    results[icu.textIndex] = {
      text: reassembled,
      billedCharacters: segResults.reduce((s, r) => s + (r?.billedCharacters ?? 0), 0),
    };
  }
}

export function writebackPlurals(
  results: (TranslationResult | null)[],
  pluralSlots: PluralSlot[],
  localeDiffs: SyncDiff[],
): void {
  for (const slot of pluralSlots) {
    const result = results[slot.textIndex];
    if (!result) continue;
    const diff = localeDiffs[slot.diffIndex]!;
    if (!diff.metadata) continue;

    if (slot.format === 'android') {
      const plurals = diff.metadata['plurals'] as Array<{quantity: string; value: string}>;
      const item = plurals.find(p => p.quantity === slot.slotKey);
      if (item) item.value = result.text;
    }

    if (slot.format === 'po' && slot.slotKey === 'msgid_plural') {
      const forms = (diff.metadata['plural_forms'] as Record<string, string>) ?? {};
      forms['msgstr[1]'] = result.text;
      for (const key of Object.keys(forms)) {
        if (/^msgstr\[\d+]$/.test(key) && key !== 'msgstr[0]' && key !== 'msgstr[1]') {
          forms[key] = result.text;
        }
      }
      diff.metadata['plural_forms'] = forms;
    }
  }
}

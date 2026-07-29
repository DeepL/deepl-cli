/**
 * Usage Command
 * Displays API usage statistics
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import type { UsageService } from '../../services/usage.js';
import { UsageInfo } from '../../api/deepl-client.js';
import type { ProductUsage } from '../../api/translation-client.js';
import { isColorEnabled } from '../../utils/formatters.js';

const DURATION_BILLING_UNITS = new Set(['milliseconds', 'minutes']);

/** The API reports product types in camelCase; display uses the documented snake_case. */
function productDisplayName(productType: string): string {
  return productType.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isDurationBilled(product: ProductUsage): boolean {
  return product.billingUnit !== undefined && DURATION_BILLING_UNITS.has(product.billingUnit);
}

/** Duration-billed usage in milliseconds: total and API-key-scoped amounts. */
function productDurationsMs(product: ProductUsage): { used: number; apiKeyUsed: number } {
  const scale = product.billingUnit === 'minutes' ? 60_000 : 1;
  const used = product.unitCount ?? product.apiKeyUnitCount ?? product.characterCount;
  const apiKeyUsed = product.apiKeyUnitCount ?? product.apiKeyCharacterCount;
  return { used: used * scale, apiKeyUsed: apiKeyUsed * scale };
}

export class UsageCommand {
  private service: UsageService;

  constructor(service: UsageService) {
    this.service = service;
  }

  /**
   * Get usage statistics from DeepL API
   */
  async getUsage(): Promise<UsageInfo> {
    return await this.service.getUsage();
  }

  /**
   * Format usage statistics for display
   */
  formatUsage(usage: UsageInfo): string {
    const { characterCount, characterLimit } = usage;

    const percentage = characterLimit > 0
      ? ((characterCount / characterLimit) * 100).toFixed(1)
      : '0.0';

    const remaining = characterLimit - characterCount;
    const isHighUsage = characterLimit > 0 && (characterCount / characterLimit) > 0.8;

    const formatNumber = (num: number): string => {
      return num.toLocaleString('en-US');
    };

    const lines: string[] = [];
    lines.push(chalk.bold('Character Usage:'));

    const usageColor = isHighUsage ? chalk.yellow : chalk.green;
    lines.push(`  Used: ${usageColor(formatNumber(characterCount))} / ${formatNumber(characterLimit)} (${usageColor(percentage + '%')})`);
    lines.push(`  Remaining: ${formatNumber(remaining)}`);

    if (isHighUsage) {
      lines.push('');
      lines.push(chalk.yellow('⚠ Warning: You are approaching your character limit'));
    }

    if (usage.startTime || usage.endTime) {
      lines.push('');
      lines.push(chalk.bold('Billing Period:'));
      const start = usage.startTime ? usage.startTime.split('T')[0] : 'N/A';
      const end = usage.endTime ? usage.endTime.split('T')[0] : 'N/A';
      lines.push(`  ${start} to ${end}`);
    }

    if (usage.accountUnitCount !== undefined) {
      lines.push('');
      lines.push(chalk.bold('Account Unit Usage:'));
      const unitLimit = usage.accountUnitLimit ?? 0;
      const unitLimitStr = unitLimit === 0 ? 'unlimited' : formatNumber(unitLimit);
      lines.push(`  Used: ${formatNumber(usage.accountUnitCount)} / ${unitLimitStr} units`);
    }

    if (usage.apiKeyUnitCount !== undefined) {
      lines.push('');
      lines.push(chalk.bold('API Key Unit Usage:'));
      const unitLimit = usage.apiKeyUnitLimit ?? 0;
      const unitLimitStr = unitLimit === 0 ? 'unlimited' : formatNumber(unitLimit);
      lines.push(`  Used: ${formatNumber(usage.apiKeyUnitCount)} / ${unitLimitStr} units`);
    } else if (usage.apiKeyCharacterCount !== undefined) {
      lines.push('');
      lines.push(chalk.bold('API Key Usage:'));
      const limitStr = usage.apiKeyCharacterLimit === 0
        ? 'unlimited'
        : formatNumber(usage.apiKeyCharacterLimit ?? 0);
      lines.push(`  Used: ${formatNumber(usage.apiKeyCharacterCount)} / ${limitStr}`);
    }

    if (usage.speechToTextMillisecondsCount !== undefined) {
      const sttCount = usage.speechToTextMillisecondsCount;
      const sttLimit = usage.speechToTextMillisecondsLimit ?? 0;
      const sttPercentage = sttLimit > 0
        ? ((sttCount / sttLimit) * 100).toFixed(1)
        : '0.0';
      const sttRemaining = sttLimit - sttCount;
      const isHighStt = sttLimit > 0 && (sttCount / sttLimit) > 0.8;

      lines.push('');
      lines.push(chalk.bold('Speech-to-Text Usage:'));
      const sttColor = isHighStt ? chalk.yellow : chalk.green;
      lines.push(`  Used: ${sttColor(this.formatMilliseconds(sttCount))} / ${this.formatMilliseconds(sttLimit)} (${sttColor(sttPercentage + '%')})`);
      lines.push(`  Remaining: ${this.formatMilliseconds(sttRemaining)}`);

      if (isHighStt) {
        lines.push('');
        lines.push(chalk.yellow('Warning: You are approaching your speech-to-text limit'));
      }
    }

    if (usage.products && usage.products.length > 0) {
      lines.push('');
      lines.push(chalk.bold('Product Breakdown:'));
      for (const product of usage.products) {
        const name = productDisplayName(product.productType);
        if (isDurationBilled(product)) {
          const { used, apiKeyUsed } = productDurationsMs(product);
          lines.push(`  ${name}: ${this.formatMilliseconds(used)} (API key: ${this.formatMilliseconds(apiKeyUsed)})`);
        } else if (product.unitCount !== undefined) {
          const apiKeyPart = product.apiKeyUnitCount !== undefined
            ? ` (API key: ${formatNumber(product.apiKeyUnitCount)} units)`
            : ` (API key: ${formatNumber(product.apiKeyCharacterCount)} characters)`;
          lines.push(`  ${name}: ${formatNumber(product.unitCount)} units${apiKeyPart}`);
        } else {
          lines.push(`  ${name}: ${formatNumber(product.characterCount)} characters (API key: ${formatNumber(product.apiKeyCharacterCount)})`);
        }
      }
    }

    return lines.join('\n');
  }

  private formatMilliseconds(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /** Format usage statistics as a cli-table3 table. */
  formatUsageTable(usage: UsageInfo): string {
    const formatNumber = (n: number): string => n.toLocaleString('en-US');
    const pct = (count: number, limit: number): string =>
      limit > 0 ? `${((count / limit) * 100).toFixed(1)}%` : '—';
    const fmtLimit = (limit: number | undefined): string =>
      limit === undefined || limit === 0 ? 'unlimited' : formatNumber(limit);
    const colorDisabled = !isColorEnabled();

    const table = new Table({
      head: ['Resource', 'Used', 'Limit', 'Usage'],
      colWidths: [22, 18, 18, 10],
      wordWrap: true,
      ...(colorDisabled && { style: { head: [], border: [] } }),
    });

    table.push([
      'Characters',
      formatNumber(usage.characterCount),
      fmtLimit(usage.characterLimit),
      pct(usage.characterCount, usage.characterLimit),
    ]);

    if (usage.accountUnitCount !== undefined) {
      table.push([
        'Account units',
        formatNumber(usage.accountUnitCount),
        fmtLimit(usage.accountUnitLimit),
        pct(usage.accountUnitCount, usage.accountUnitLimit ?? 0),
      ]);
    }

    if (usage.apiKeyUnitCount !== undefined) {
      table.push([
        'API key units',
        formatNumber(usage.apiKeyUnitCount),
        fmtLimit(usage.apiKeyUnitLimit),
        pct(usage.apiKeyUnitCount, usage.apiKeyUnitLimit ?? 0),
      ]);
    } else if (usage.apiKeyCharacterCount !== undefined) {
      table.push([
        'API key characters',
        formatNumber(usage.apiKeyCharacterCount),
        fmtLimit(usage.apiKeyCharacterLimit),
        pct(usage.apiKeyCharacterCount, usage.apiKeyCharacterLimit ?? 0),
      ]);
    }

    if (usage.speechToTextMillisecondsCount !== undefined) {
      const sttLimit = usage.speechToTextMillisecondsLimit ?? 0;
      table.push([
        'Speech-to-text',
        this.formatMilliseconds(usage.speechToTextMillisecondsCount),
        sttLimit === 0 ? 'unlimited' : this.formatMilliseconds(sttLimit),
        pct(usage.speechToTextMillisecondsCount, sttLimit),
      ]);
    }

    let output = table.toString();

    if (usage.products && usage.products.length > 0) {
      const productTable = new Table({
        head: ['Product', 'Used', 'API key'],
        colWidths: [28, 22, 22],
        wordWrap: true,
        ...(colorDisabled && { style: { head: [], border: [] } }),
      });
      for (const product of usage.products) {
        const name = productDisplayName(product.productType);
        if (isDurationBilled(product)) {
          const { used, apiKeyUsed } = productDurationsMs(product);
          productTable.push([
            name,
            this.formatMilliseconds(used),
            this.formatMilliseconds(apiKeyUsed),
          ]);
        } else if (product.unitCount !== undefined) {
          const apiKeyVal = product.apiKeyUnitCount !== undefined
            ? `${formatNumber(product.apiKeyUnitCount)} units`
            : `${formatNumber(product.apiKeyCharacterCount)} chars`;
          productTable.push([
            name,
            `${formatNumber(product.unitCount)} units`,
            apiKeyVal,
          ]);
        } else {
          productTable.push([
            name,
            `${formatNumber(product.characterCount)} chars`,
            `${formatNumber(product.apiKeyCharacterCount)} chars`,
          ]);
        }
      }
      output = `${output}\n\nProduct Breakdown:\n${productTable.toString()}`;
    }

    return output;
  }
}

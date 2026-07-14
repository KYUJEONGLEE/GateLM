import { TENANT_CHAT_MODEL_KEY_PATTERN } from './tenant-chat-runtime.contract';
import catalogDocument = require('./tenant-chat-model-pricing.catalog.data.json');

export interface TenantChatModelPricingEntry {
  providerFamily: string;
  modelKey: string;
  effectiveAt: string;
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
  cacheReadInputMicroUsdPerMillionTokens?: number;
  sourceUrl: string;
}

export interface TenantChatModelPricingCatalog {
  catalogVersion: string;
  entries: TenantChatModelPricingEntry[];
}

const catalog = validateCatalog(catalogDocument);

export function getTenantChatModelPricingCatalog(): TenantChatModelPricingCatalog {
  return catalog;
}

export function findTenantChatModelPricing(
  providerFamily: string,
  modelKey: string,
): TenantChatModelPricingEntry | null {
  return (
    catalog.entries.find(
      (entry) =>
        entry.providerFamily === providerFamily && entry.modelKey === modelKey,
    ) ?? null
  );
}

function validateCatalog(value: unknown): TenantChatModelPricingCatalog {
  if (!isRecord(value)) {
    throw new Error('Tenant Chat model pricing catalog must be an object.');
  }
  const catalogVersion = value.catalogVersion;
  const entries = value.entries;
  if (
    typeof catalogVersion !== 'string' ||
    !catalogVersion.trim() ||
    !Array.isArray(entries)
  ) {
    throw new Error('Tenant Chat model pricing catalog header is invalid.');
  }

  const keys = new Set<string>();
  const validatedEntries = entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Tenant Chat pricing entry ${index} must be an object.`);
    }
    const validated = validateEntry(entry, index);
    const key = `${validated.providerFamily}\u0000${validated.modelKey}`;
    if (keys.has(key)) {
      throw new Error(`Tenant Chat pricing entry ${index} is duplicated.`);
    }
    keys.add(key);
    return validated;
  });

  return Object.freeze({
    catalogVersion,
    entries: Object.freeze(validatedEntries) as unknown as TenantChatModelPricingEntry[],
  });
}

function validateEntry(
  entry: Record<string, unknown>,
  index: number,
): TenantChatModelPricingEntry {
  const providerFamily = entry.providerFamily;
  const modelKey = entry.modelKey;
  const effectiveAt = entry.effectiveAt;
  const inputPrice = entry.inputMicroUsdPerMillionTokens;
  const outputPrice = entry.outputMicroUsdPerMillionTokens;
  const cacheReadPrice = entry.cacheReadInputMicroUsdPerMillionTokens;
  const sourceUrl = entry.sourceUrl;
  if (
    typeof providerFamily !== 'string' ||
    !/^[a-z][a-z0-9_-]{1,63}$/.test(providerFamily) ||
    typeof modelKey !== 'string' ||
    !TENANT_CHAT_MODEL_KEY_PATTERN.test(modelKey) ||
    typeof effectiveAt !== 'string' ||
    Number.isNaN(Date.parse(effectiveAt)) ||
    !isNonnegativeInteger(inputPrice) ||
    !isNonnegativeInteger(outputPrice) ||
    (cacheReadPrice !== undefined && !isNonnegativeInteger(cacheReadPrice)) ||
    (typeof cacheReadPrice === 'number' && cacheReadPrice > inputPrice) ||
    typeof sourceUrl !== 'string' ||
    !(sourceUrl.startsWith('https://') || sourceUrl.startsWith('repo://'))
  ) {
    throw new Error(`Tenant Chat pricing entry ${index} is invalid.`);
  }

  return {
    providerFamily,
    modelKey,
    effectiveAt,
    inputMicroUsdPerMillionTokens: inputPrice,
    outputMicroUsdPerMillionTokens: outputPrice,
    ...(typeof cacheReadPrice === 'number'
      ? { cacheReadInputMicroUsdPerMillionTokens: cacheReadPrice }
      : {}),
    sourceUrl,
  };
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

import {
  findTenantChatModelPricing,
  getTenantChatModelPricingCatalog,
} from './tenant-chat-model-pricing.catalog';

describe('Tenant Chat model pricing catalog', () => {
  it('contains unique exact Provider family and model keys', () => {
    const catalog = getTenantChatModelPricingCatalog();
    const keys = catalog.entries.map(
      (entry) => `${entry.providerFamily}:${entry.modelKey}`,
    );

    expect(catalog.catalogVersion).toBe('2026-07-14');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns exact standard text pricing only', () => {
    expect(findTenantChatModelPricing('openai', 'gpt-5.4-mini')).toMatchObject({
      inputMicroUsdPerMillionTokens: 750000,
      outputMicroUsdPerMillionTokens: 4500000,
    });
    expect(findTenantChatModelPricing('openai', 'gpt-5.4')).toBeNull();
    expect(findTenantChatModelPricing('custom-openai', 'gpt-5.4-mini')).toBeNull();
  });

  it('keeps Mock pricing explicit and cost-free', () => {
    expect(findTenantChatModelPricing('mock', 'mock-fast')).toMatchObject({
      inputMicroUsdPerMillionTokens: 0,
      outputMicroUsdPerMillionTokens: 0,
    });
  });
});

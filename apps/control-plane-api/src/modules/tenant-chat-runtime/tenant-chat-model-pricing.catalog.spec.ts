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

    expect(catalog.catalogVersion).toBe('2026-07-15');
    expect(new Set(keys).size).toBe(keys.length);
    expect(catalog.entries).toHaveLength(94);
  });

  it('covers all officially priceable local Chat models by Provider family', () => {
    const expectedModels = {
      mock: ['mock-fast', 'mock-balanced'],
      openai: [
        'gpt-4o-mini',
        'gpt-4o-mini-2024-07-18',
        'gpt-4o',
        'gpt-4o-2024-08-06',
        'gpt-4o-2024-11-20',
        'gpt-4o-2024-05-13',
        'gpt-5.4-mini',
        'gpt-5.4-mini-2026-03-17',
        'gpt-5.4-nano',
        'gpt-5.4-nano-2026-03-17',
        'gpt-5.2',
        'gpt-5.2-2025-12-11',
        'gpt-5.1',
        'gpt-5.1-2025-11-13',
        'gpt-5',
        'gpt-5-2025-08-07',
        'gpt-5-mini',
        'gpt-5-mini-2025-08-07',
        'gpt-5-nano',
        'gpt-5-nano-2025-08-07',
        'gpt-4.5-preview',
        'gpt-4.1',
        'gpt-4.1-2025-04-14',
        'gpt-4.1-mini',
        'gpt-4.1-mini-2025-04-14',
        'gpt-4.1-nano',
        'gpt-4.1-nano-2025-04-14',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-0125',
        'gpt-3.5-turbo-1106',
        'chat-latest',
        'gpt-5-chat-latest',
        'gpt-5.1-chat-latest',
        'gpt-5.2-chat-latest',
        'gpt-5.3-chat-latest',
        'o1',
        'o1-2024-12-17',
        'o3',
        'o3-2025-04-16',
        'o3-mini',
        'o3-mini-2025-01-31',
        'o4-mini',
        'o4-mini-2025-04-16',
      ],
      gemini: [
        'gemini-3.5-flash',
        'gemini-flash-latest',
        'gemini-3.1-flash-lite',
        'gemini-3-flash-preview',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
      ],
      claude: [
        'claude-sonnet-5',
        'claude-fable-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-6',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
      ],
      cerebras: ['gpt-oss-120b', 'zai-glm-4.7', 'gemma-4-31b'],
      mistral: [
        'codestral-2508',
        'codestral-latest',
        'devstral-2512',
        'devstral-latest',
        'devstral-medium-latest',
        'labs-leanstral-1-5',
        'labs-leanstral-1-5-1',
        'magistral-medium-2509',
        'magistral-medium-latest',
        'magistral-small-2509',
        'magistral-small-latest',
        'ministral-14b-2512',
        'ministral-14b-latest',
        'ministral-3b-2512',
        'ministral-3b-latest',
        'ministral-8b-2512',
        'ministral-8b-latest',
        'mistral-large-2512',
        'mistral-large-latest',
        'mistral-medium-2505',
        'mistral-medium-2508',
        'mistral-medium-2604',
        'mistral-medium-3-5',
        'mistral-medium-3.5',
        'mistral-medium-latest',
        'mistral-small-2603',
        'mistral-small-latest',
        'open-mistral-nemo',
        'open-mistral-nemo-2407',
        'voxtral-small-2507',
        'voxtral-small-latest',
      ],
    } as const;

    const catalog = getTenantChatModelPricingCatalog();
    for (const [providerFamily, modelKeys] of Object.entries(expectedModels)) {
      expect(
        catalog.entries
          .filter((entry) => entry.providerFamily === providerFamily)
          .map((entry) => entry.modelKey),
      ).toEqual(modelKeys);
    }
  });

  it('returns exact standard text pricing for every supported Provider family', () => {
    expect(findTenantChatModelPricing('openai', 'gpt-5.4-mini')).toMatchObject({
      inputMicroUsdPerMillionTokens: 750000,
      outputMicroUsdPerMillionTokens: 4500000,
    });
    expect(findTenantChatModelPricing('gemini', 'gemini-3.1-flash-lite')).toMatchObject({
      inputMicroUsdPerMillionTokens: 250000,
      outputMicroUsdPerMillionTokens: 1500000,
    });
    expect(findTenantChatModelPricing('claude', 'claude-opus-4-6')).toMatchObject({
      inputMicroUsdPerMillionTokens: 5000000,
      outputMicroUsdPerMillionTokens: 25000000,
    });
    expect(findTenantChatModelPricing('cerebras', 'gpt-oss-120b')).toMatchObject({
      inputMicroUsdPerMillionTokens: 350000,
      outputMicroUsdPerMillionTokens: 750000,
    });
    expect(findTenantChatModelPricing('mistral', 'mistral-large-2512')).toMatchObject({
      inputMicroUsdPerMillionTokens: 500000,
      outputMicroUsdPerMillionTokens: 1500000,
      cacheReadInputMicroUsdPerMillionTokens: 50000,
    });
    expect(findTenantChatModelPricing('custom-openai', 'gpt-5.4-mini')).toBeNull();
  });

  it('rejects context-tiered prices the current flat snapshot cannot represent', () => {
    for (const modelKey of [
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-pro',
    ]) {
      expect(findTenantChatModelPricing('openai', modelKey)).toBeNull();
    }
    for (const modelKey of [
      'gemini-2.5-pro',
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview-customtools',
    ]) {
      expect(findTenantChatModelPricing('gemini', modelKey)).toBeNull();
    }
  });

  it('rejects non-Chat or extra-unit models instead of publishing incomplete prices', () => {
    for (const modelKey of [
      'gpt-5.3-codex',
      'gpt-5.2-pro',
      'gpt-5.2-codex',
      'gpt-5.1-codex',
      'gpt-5.1-codex-mini',
      'gpt-5.1-codex-max',
      'gpt-5-pro',
      'gpt-5-search-api',
      'gpt-realtime',
      'gpt-4o-transcribe',
      'sora-2',
    ]) {
      expect(findTenantChatModelPricing('openai', modelKey)).toBeNull();
    }
    expect(findTenantChatModelPricing('gemini', 'veo-3.1-generate-preview')).toBeNull();
    expect(findTenantChatModelPricing('mistral', 'mistral-vibe-cli-latest')).toBeNull();
  });

  it('keeps Mock pricing explicit and cost-free', () => {
    expect(findTenantChatModelPricing('mock', 'mock-fast')).toMatchObject({
      inputMicroUsdPerMillionTokens: 0,
      outputMicroUsdPerMillionTokens: 0,
    });
  });
});

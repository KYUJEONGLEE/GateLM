import {
  CredentialStatus,
  Prisma,
  PrismaClient,
  ProviderConnectionStatus,
  ResourceStatus,
  RuntimeConfig,
  RuntimeConfigPublishState,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import type {
  ActiveRuntimeConfigResponseDto,
  ProviderCatalogResponseDto,
  RuntimeConfigSafetyDetectorResponseDto,
  RuntimeSnapshotResponseDto,
} from '../src/modules/runtime-configs/dto/runtime-config.dto';

const prisma = new PrismaClient();

export const DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000100';
export const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000200';
export const DEMO_APPLICATION_ID = '00000000-0000-4000-8000-000000000300';
export const DEMO_API_KEY_ID = '00000000-0000-4000-8000-000000000400';
export const DEMO_APP_TOKEN_ID = '00000000-0000-4000-8000-000000000500';
export const DEMO_MOCK_PROVIDER_ID = '00000000-0000-4000-8000-000000000600';
export const DEMO_OPENAI_PROVIDER_ID = '00000000-0000-4000-8000-000000000601';
export const DEMO_RUNTIME_CONFIG_VERSION = 'runtime_config_v2_demo_001';

const DEMO_PROVIDER = 'mock';
const DEMO_PROVIDER_BASE_URL = 'http://mock-provider:8090';
const DEMO_OPENAI_PROVIDER = 'openai-main';
const DEMO_OPENAI_PROVIDER_BASE_URL = 'https://api.openai.com/v1';
const DEMO_OPENAI_LOW_COST_MODEL = 'gpt-4o-mini';
const DEMO_OPENAI_BALANCED_MODEL = 'gpt-4o';
const DEMO_OPENAI_EXTRA_MODELS = [
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.4-pro',
  'gpt-5.3-codex',
  'gpt-5.2',
  'gpt-5.2-pro',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-pro',
  'gpt-4.5-preview',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-3.5-turbo',
  'chat-latest',
] as const;
const DEMO_GENERATED_AT = '2026-06-27T02:00:00.000Z';
const DEMO_PUBLISHED_BY = 'control_plane';
const DEMO_GATEWAY_INSTANCE_ID = 'gateway_core_static';
const PROVIDER_CATALOG_ID_PREFIX = 'provider_catalog';
const CONFIG_HASH_ALGORITHM =
  'sha256(canonical_json(runtimeConfig_without_configHash))';
const DEMO_MODELS = ['mock-fast', 'mock-balanced'] as const;
export const PROVIDER_PRESETS = [
  {
    providerKey: 'openai',
    displayName: 'OpenAI',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    requestFormat: 'openai_chat_completions',
    modelDiscoveryType: 'openai_compatible_models',
    status: ResourceStatus.ACTIVE,
    sortOrder: 10,
  },
  {
    providerKey: 'gemini',
    displayName: 'Gemini',
    adapterType: 'openai_compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requestFormat: 'openai_chat_completions',
    modelDiscoveryType: 'openai_compatible_models',
    status: ResourceStatus.ACTIVE,
    sortOrder: 20,
  },
  {
    providerKey: 'groq',
    displayName: 'Groq',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    requestFormat: 'openai_chat_completions',
    modelDiscoveryType: 'openai_compatible_models',
    status: ResourceStatus.ACTIVE,
    sortOrder: 30,
  },
  {
    providerKey: 'cerebras',
    displayName: 'Cerebras',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    requestFormat: 'openai_chat_completions',
    modelDiscoveryType: 'openai_compatible_models',
    status: ResourceStatus.ACTIVE,
    sortOrder: 40,
  },
  {
    providerKey: 'mistral',
    displayName: 'Mistral AI',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    requestFormat: 'openai_chat_completions',
    modelDiscoveryType: 'openai_compatible_models',
    status: ResourceStatus.ACTIVE,
    sortOrder: 50,
  },
  {
    providerKey: 'claude',
    displayName: 'Claude',
    adapterType: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    requestFormat: 'anthropic_messages',
    modelDiscoveryType: 'anthropic_models',
    status: ResourceStatus.DISABLED,
    sortOrder: 60,
  },
] as const;

type DemoProviderMode = 'mock' | 'actual';

const DEFAULT_DEMO_RATE_LIMIT_LIMIT = 60;
const MAX_DEMO_RATE_LIMIT_LIMIT = 100000;
const PERF_RUNTIME_RATE_LIMIT_ENV = 'GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT';

interface DemoRuntimeConfigOptions {
  providerMode?: DemoProviderMode;
  mockProviderId?: string;
  mockProviderBaseUrl?: string;
  openAIProviderId?: string;
  openAIBaseUrl?: string;
  openAILowCostModel?: string;
  openAIBalancedModel?: string;
  openAIExtraModels?: string[];
  apiKeyPrefix?: string;
  apiKeyLast4?: string;
  appTokenPrefix?: string;
  appTokenLast4?: string;
  rateLimitLimit?: number;
}

export function credentialHash(plaintext: string): string {
  return sha256(plaintext.trim());
}

export function canonicalJsonForDemo(value: unknown): string {
  return canonicalJson(value);
}

export function buildDemoRuntimeConfigDocument(
  providerId: string,
  options: DemoRuntimeConfigOptions = {},
): ActiveRuntimeConfigResponseDto {
  const providerMode = options.providerMode ?? 'mock';
  const mockProviderId = options.mockProviderId ?? providerId;
  const mockProviderBaseUrl =
    options.mockProviderBaseUrl ?? DEMO_PROVIDER_BASE_URL;
  const openAIProviderId =
    options.openAIProviderId ?? DEMO_OPENAI_PROVIDER_ID;
  const openAIBaseUrl =
    options.openAIBaseUrl ?? DEMO_OPENAI_PROVIDER_BASE_URL;
  const openAILowCostModel =
    options.openAILowCostModel ?? DEMO_OPENAI_LOW_COST_MODEL;
  const openAIBalancedModel =
    options.openAIBalancedModel ?? DEMO_OPENAI_BALANCED_MODEL;
  const openAIModels = buildOpenAISeedModels(
    openAILowCostModel,
    openAIBalancedModel,
    options.openAIExtraModels ?? [...DEMO_OPENAI_EXTRA_MODELS],
  );
  const apiKeyPrefix = options.apiKeyPrefix ?? 'gsk_live_';
  const apiKeyLast4 = options.apiKeyLast4 ?? '9xA1';
  const appTokenPrefix = options.appTokenPrefix ?? 'gat_app_';
  const appTokenLast4 = options.appTokenLast4 ?? '4tK2';
  const rateLimitLimit = resolveDemoRateLimitLimit(options.rateLimitLimit);
  const safetyPolicy = buildSafetyPolicy();
  const routingPolicy = buildRoutingPolicy();
  const providers =
    providerMode === 'actual'
      ? [
          buildOpenAIRuntimeProvider({
            providerId: openAIProviderId,
            baseUrl: openAIBaseUrl,
            models: openAIModels.map((model) => model.model),
          }),
          buildMockRuntimeProvider(
            mockProviderId,
            'fail_open_to_fallback',
            mockProviderBaseUrl,
          ),
        ]
      : [
          buildMockRuntimeProvider(
            mockProviderId,
            'fail_closed',
            mockProviderBaseUrl,
          ),
        ];
  const models =
    providerMode === 'actual'
      ? [
          ...openAIModels.map((model) =>
            buildOpenAIModel(
              model.model,
              model.displayName,
              model.contextWindowTokens,
            ),
          ),
          buildMockModel('mock-fast', 'Mock Fast'),
          buildMockModel('mock-balanced', 'Mock Balanced'),
        ]
      : [
          buildMockModel('mock-fast', 'Mock Fast'),
          buildMockModel('mock-balanced', 'Mock Balanced'),
        ];
  const pricingRules =
    providerMode === 'actual'
      ? [
          buildPricingRule({
            provider: DEMO_OPENAI_PROVIDER,
            model: openAILowCostModel,
            pricingVersion: '2026-06-30.openai.demo.v1',
            promptTokenMicroUsd: 1,
            completionTokenMicroUsd: 4,
          }),
          buildPricingRule({
            provider: DEMO_OPENAI_PROVIDER,
            model: openAIBalancedModel,
            pricingVersion: '2026-06-30.openai.demo.v1',
            promptTokenMicroUsd: 3,
            completionTokenMicroUsd: 10,
          }),
          ...openAIModels
            .filter(isPricedOpenAISeedModel)
            .filter(
              (model) =>
                model.model !== openAILowCostModel &&
                model.model !== openAIBalancedModel,
            )
            .map((model) =>
              buildPricingRule({
                provider: DEMO_OPENAI_PROVIDER,
                model: model.model,
                pricingVersion: model.pricingVersion,
                promptTokenMicroUsd: model.promptTokenMicroUsd,
                completionTokenMicroUsd: model.completionTokenMicroUsd,
              }),
            ),
          buildPricingRule({
            provider: DEMO_PROVIDER,
            model: 'mock-fast',
            pricingVersion: '2026-06-27.mock.v1',
            promptTokenMicroUsd: 1,
            completionTokenMicroUsd: 2,
          }),
          buildPricingRule({
            provider: DEMO_PROVIDER,
            model: 'mock-balanced',
            pricingVersion: '2026-06-27.mock.v1',
            promptTokenMicroUsd: 2,
            completionTokenMicroUsd: 3,
          }),
        ]
      : [
          buildPricingRule({
            provider: DEMO_PROVIDER,
            model: 'mock-fast',
            pricingVersion: '2026-06-27.mock.v1',
            promptTokenMicroUsd: 1,
            completionTokenMicroUsd: 2,
          }),
          buildPricingRule({
            provider: DEMO_PROVIDER,
            model: 'mock-balanced',
            pricingVersion: '2026-06-27.mock.v1',
            promptTokenMicroUsd: 2,
            completionTokenMicroUsd: 3,
          }),
        ];
  const documentWithoutHash: ActiveRuntimeConfigResponseDto = {
    schemaVersion: 'gatelm.active-runtime-config.v2',
    configVersion: DEMO_RUNTIME_CONFIG_VERSION,
    configHash: '',
    configHashAlgorithm: CONFIG_HASH_ALGORITHM,
    generatedAt: DEMO_GENERATED_AT,
    effectiveAt: DEMO_GENERATED_AT,
    publishedAt: DEMO_GENERATED_AT,
    publishState: 'active',
    tenantId: DEMO_TENANT_ID,
    tenantStatus: 'active',
    projectId: DEMO_PROJECT_ID,
    projectStatus: 'active',
    applicationId: DEMO_APPLICATION_ID,
    applicationStatus: 'active',
    apiKeyId: DEMO_API_KEY_ID,
    apiKeyStatus: 'active',
    appTokenId: DEMO_APP_TOKEN_ID,
    appTokenStatus: 'active',
    apiKey: {
      id: DEMO_API_KEY_ID,
      type: 'api_key',
      status: 'active',
      prefix: apiKeyPrefix,
      last4: apiKeyLast4,
      scopes: ['chat:completions', 'models:read'],
      expiresAt: null,
      verification: 'prefix_then_hash_compare',
    },
    appToken: {
      id: DEMO_APP_TOKEN_ID,
      type: 'app_token',
      status: 'active',
      prefix: appTokenPrefix,
      last4: appTokenLast4,
      scopes: ['gateway:invoke'],
      expiresAt: null,
      verification: 'prefix_then_hash_compare',
    },
    providers,
    models,
    rateLimit: {
      enabled: true,
      scope: 'application',
      algorithm: 'fixed_window',
      windowSeconds: 60,
      limit: rateLimitLimit,
    },
    budgetPolicy: {
      enabled: false,
      enforcementMode: 'disabled',
      warningThresholdPercent: 80,
    },
    safetyPolicy,
    cachePolicy: {
      enabled: true,
      type: 'exact',
      ttlSeconds: 3600,
    },
    promptCapturePolicy: {
      enabled: false,
      mode: 'disabled',
      maxChars: 8000,
    },
    responseCapturePolicy: {
      enabled: false,
      mode: 'disabled',
      maxChars: 8000,
    },
    routingPolicy,
    pricingRules,
    hashing: {
      canonicalJson: 'utf8_json_sorted_keys_no_extra_whitespace',
      usesSecret: false,
      configHashSourceFields: [
        'tenantId',
        'projectId',
        'applicationId',
        'providers',
        'models',
        'rateLimit',
        'budgetPolicy',
        'safetyPolicy',
        'cachePolicy',
        'promptCapturePolicy',
        'responseCapturePolicy',
        'routingPolicy',
        'pricingRules',
      ],
      routingPolicyHashSourceFields: ['routingPolicy'],
      securityPolicyHashSourceFields: [
        'safetyPolicy.mode',
        'safetyPolicy.detectors',
      ],
      requestBodyHash:
        'sha256(canonical_json(openai_request_body_without_credentials))',
      promptHash: 'sha256(normalized_redacted_prompt_utf8)',
      cacheKeyHash: 'sha256(canonical_json(cache_key_material))',
      cacheKeyFields: [
        'tenantId',
        'projectId',
        'applicationId',
        'resolvedModelRef',
        'normalizedRedactedPrompt',
        'securityPolicyHash',
        'routingPolicyHash',
      ],
    },
    costing: {
      unit: 'micro_usd',
      formula:
        'ceil(promptTokens * promptTokenMicroUsd + completionTokens * completionTokenMicroUsd)',
      savedCostMicroUsdFormula:
        'sourceRequestCostMicroUsd_on_exact_cache_hit_else_0',
      usdStringFormat: 'fixed_6_decimal_places',
      missingPricingRule: 'provider_error',
    },
  };

  return {
    ...documentWithoutHash,
    configHash: sha256(
      canonicalJson({
        ...documentWithoutHash,
        configHash: undefined,
      }),
    ),
  };
}

export async function seedDemoData(client: PrismaClient): Promise<void> {
  assertDemoSeedAllowed(process.env);
  const providerMode = readDemoProviderMode();
  const rateLimitLimit = readDemoRateLimitLimit(providerMode, process.env);

  await client.$transaction(async (tx) => {
    await seedProviderPresets(tx);

    await tx.tenant.upsert({
      where: { id: DEMO_TENANT_ID },
      update: {
        name: 'Demo Tenant',
        status: ResourceStatus.ACTIVE,
        totalBudgetUsd: 1000,
      },
      create: {
        id: DEMO_TENANT_ID,
        name: 'Demo Tenant',
        status: ResourceStatus.ACTIVE,
        totalBudgetUsd: 1000,
      },
    });

    await tx.project.upsert({
      where: { id: DEMO_PROJECT_ID },
      update: {
        tenantId: DEMO_TENANT_ID,
        name: 'Customer Support',
        description: null,
        status: ResourceStatus.ACTIVE,
        totalBudgetUsd: 100,
      },
      create: {
        id: DEMO_PROJECT_ID,
        tenantId: DEMO_TENANT_ID,
        name: 'Customer Support',
        status: ResourceStatus.ACTIVE,
        totalBudgetUsd: 100,
      },
    });

    await tx.application.upsert({
      where: { id: DEMO_APPLICATION_ID },
      update: {
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        name: 'Customer Demo App',
        description: null,
        status: ResourceStatus.ACTIVE,
        budgetLimitMode: 'FIXED',
        budgetLimitUsd: 100,
        budgetLimitPercent: null,
      },
      create: {
        id: DEMO_APPLICATION_ID,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        name: 'Customer Demo App',
        status: ResourceStatus.ACTIVE,
        budgetLimitMode: 'FIXED',
        budgetLimitUsd: 100,
        budgetLimitPercent: null,
      },
    });

    const mockProviderBaseUrl = readEnvString(
      'GATELM_DEMO_MOCK_PROVIDER_BASE_URL',
      DEMO_PROVIDER_BASE_URL,
    );
    const openAIBaseUrl = readEnvString(
      'GATELM_DEMO_OPENAI_BASE_URL',
      DEMO_OPENAI_PROVIDER_BASE_URL,
    );
    const openAILowCostModel = readEnvString(
      'GATELM_DEMO_OPENAI_LOW_COST_MODEL',
      DEMO_OPENAI_LOW_COST_MODEL,
    );
    const openAIBalancedModel = readEnvString(
      'GATELM_DEMO_OPENAI_BALANCED_MODEL',
      DEMO_OPENAI_BALANCED_MODEL,
    );
    const openAIExtraModels = readEnvCSV(
      'GATELM_DEMO_OPENAI_EXTRA_MODELS',
      [...DEMO_OPENAI_EXTRA_MODELS],
    );
    const demoApiKey = readEnvString(
      'GATELM_DEMO_API_KEY',
      'glm_api_test_redacted',
    );
    const demoAppToken = readEnvString(
      'GATELM_DEMO_APP_TOKEN',
      'glm_app_token_test_redacted',
    );
    const apiKeyPreview = credentialPreview(demoApiKey, 'gsk_live_');
    const appTokenPreview = credentialPreview(demoAppToken, 'gat_app_');

    const existingMockProvider = await tx.providerConnection.findFirst({
      where: {
        tenantId: DEMO_TENANT_ID,
        provider: DEMO_PROVIDER,
      },
    });
    const provider = existingMockProvider
      ? await tx.providerConnection.update({
          where: { id: existingMockProvider.id },
          data: {
            tenantId: DEMO_TENANT_ID,
            projectId: null,
            displayName: 'Mock Provider',
            status: ProviderConnectionStatus.ACTIVE,
            baseUrl: mockProviderBaseUrl,
            timeoutMs: 30000,
            secretRef: null,
            credentialPrefix: null,
            credentialLast4: null,
            resolver: 'none',
            providerConfig: demoProviderConfig(),
          },
        })
      : await tx.providerConnection.create({
          data: {
            id: DEMO_MOCK_PROVIDER_ID,
            tenantId: DEMO_TENANT_ID,
            projectId: null,
            provider: DEMO_PROVIDER,
            displayName: 'Mock Provider',
            status: ProviderConnectionStatus.ACTIVE,
            baseUrl: mockProviderBaseUrl,
            timeoutMs: 30000,
            secretRef: null,
            credentialPrefix: null,
            credentialLast4: null,
            resolver: 'none',
            providerConfig: demoProviderConfig(),
          },
        });

    const openAIProvider =
      providerMode === 'actual'
        ? await upsertDemoTenantProvider(tx, {
            baseUrl: openAIBaseUrl,
            credentialLast4: '0000',
            credentialPrefix: 'env_ref_',
            displayName: 'OpenAI Main',
            fallbackId: DEMO_OPENAI_PROVIDER_ID,
            provider: DEMO_OPENAI_PROVIDER,
            providerConfig: demoOpenAIProviderConfig(
              openAILowCostModel,
              openAIBalancedModel,
              openAIExtraModels,
            ),
            resolver: 'environment',
            secretRef: `provider_credential:${DEMO_OPENAI_PROVIDER_ID}`,
          })
        : null;

    for (const providerConnection of [
      provider,
      ...(openAIProvider ? [openAIProvider] : []),
    ]) {
      await tx.applicationProviderConnection.upsert({
        where: {
          applicationId_providerConnectionId: {
            applicationId: DEMO_APPLICATION_ID,
            providerConnectionId: providerConnection.id,
          },
        },
        update: {
          tenantId: DEMO_TENANT_ID,
          projectId: DEMO_PROJECT_ID,
        },
        create: {
          tenantId: DEMO_TENANT_ID,
          projectId: DEMO_PROJECT_ID,
          applicationId: DEMO_APPLICATION_ID,
          providerConnectionId: providerConnection.id,
        },
      });
    }

    await tx.gatewayApiKey.upsert({
      where: { id: DEMO_API_KEY_ID },
      update: {
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        displayName: 'Demo API Key',
        prefix: apiKeyPreview.prefix,
        last4: apiKeyPreview.last4,
        secretHash: credentialHash(demoApiKey),
        hashAlgorithm: 'sha256',
        status: CredentialStatus.ACTIVE,
        scopes: ['chat:completions', 'models:read'],
        expiresAt: null,
        revokedAt: null,
      },
      create: {
        id: DEMO_API_KEY_ID,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        displayName: 'Demo API Key',
        prefix: apiKeyPreview.prefix,
        last4: apiKeyPreview.last4,
        secretHash: credentialHash(demoApiKey),
        hashAlgorithm: 'sha256',
        status: CredentialStatus.ACTIVE,
        scopes: ['chat:completions', 'models:read'],
        expiresAt: null,
      },
    });

    await tx.appToken.upsert({
      where: { id: DEMO_APP_TOKEN_ID },
      update: {
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        applicationId: DEMO_APPLICATION_ID,
        displayName: 'Demo App Token',
        prefix: appTokenPreview.prefix,
        last4: appTokenPreview.last4,
        secretHash: credentialHash(demoAppToken),
        hashAlgorithm: 'sha256',
        status: CredentialStatus.ACTIVE,
        scopes: ['gateway:invoke'],
        expiresAt: null,
        revokedAt: null,
      },
      create: {
        id: DEMO_APP_TOKEN_ID,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        applicationId: DEMO_APPLICATION_ID,
        displayName: 'Demo App Token',
        prefix: appTokenPreview.prefix,
        last4: appTokenPreview.last4,
        secretHash: credentialHash(demoAppToken),
        hashAlgorithm: 'sha256',
        status: CredentialStatus.ACTIVE,
        scopes: ['gateway:invoke'],
        expiresAt: null,
      },
    });

    const runtimeConfig = buildDemoRuntimeConfigDocument(provider.id, {
      providerMode,
      mockProviderId: provider.id,
      mockProviderBaseUrl,
      openAIProviderId: openAIProvider?.id ?? DEMO_OPENAI_PROVIDER_ID,
      openAIBaseUrl,
      openAILowCostModel,
      openAIBalancedModel,
      openAIExtraModels,
      apiKeyPrefix: apiKeyPreview.prefix,
      apiKeyLast4: apiKeyPreview.last4,
      appTokenPrefix: appTokenPreview.prefix,
      appTokenLast4: appTokenPreview.last4,
      rateLimitLimit,
    });
    await tx.runtimeConfig.updateMany({
      where: {
        applicationId: DEMO_APPLICATION_ID,
        publishState: RuntimeConfigPublishState.ACTIVE,
        configVersion: { not: DEMO_RUNTIME_CONFIG_VERSION },
      },
      data: {
        publishState: RuntimeConfigPublishState.SUPERSEDED,
      },
    });

    const savedRuntimeConfig = await tx.runtimeConfig.upsert({
      where: {
        applicationId_configVersion: {
          applicationId: DEMO_APPLICATION_ID,
          configVersion: DEMO_RUNTIME_CONFIG_VERSION,
        },
      },
      update: {
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        configHash: runtimeConfig.configHash,
        publishState: RuntimeConfigPublishState.ACTIVE,
        document: toInputJsonObject(runtimeConfig),
        effectiveAt: new Date(DEMO_GENERATED_AT),
        publishedAt: new Date(DEMO_GENERATED_AT),
      },
      create: {
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        applicationId: DEMO_APPLICATION_ID,
        configVersion: DEMO_RUNTIME_CONFIG_VERSION,
        configHash: runtimeConfig.configHash,
        publishState: RuntimeConfigPublishState.ACTIVE,
        document: toInputJsonObject(runtimeConfig),
        effectiveAt: new Date(DEMO_GENERATED_AT),
        publishedAt: new Date(DEMO_GENERATED_AT),
      },
    });
    const runtimeSnapshot = buildDemoRuntimeSnapshot(
      savedRuntimeConfig,
      runtimeConfig,
    );
    const savedRuntimeSnapshot = await tx.runtimeSnapshot.upsert({
      where: {
        applicationId_version: {
          applicationId: runtimeSnapshot.lookupKey.applicationId,
          version: BigInt(runtimeSnapshot.runtimeSnapshotVersion),
        },
      },
      update: {
        tenantId: runtimeSnapshot.lookupKey.tenantId,
        projectId: runtimeSnapshot.lookupKey.projectId,
        runtimeConfigId: savedRuntimeConfig.id,
        contentHash: runtimeSnapshot.contentHash,
        snapshotBody: toInputJsonObject(runtimeSnapshot),
        publishedAt: new Date(runtimeSnapshot.publishedAt),
        publishedBy: runtimeSnapshot.publishedBy,
      },
      create: {
        id: savedRuntimeConfig.id,
        tenantId: runtimeSnapshot.lookupKey.tenantId,
        projectId: runtimeSnapshot.lookupKey.projectId,
        applicationId: runtimeSnapshot.lookupKey.applicationId,
        runtimeConfigId: savedRuntimeConfig.id,
        version: BigInt(runtimeSnapshot.runtimeSnapshotVersion),
        contentHash: runtimeSnapshot.contentHash,
        snapshotBody: toInputJsonObject(runtimeSnapshot),
        publishedAt: new Date(runtimeSnapshot.publishedAt),
        publishedBy: runtimeSnapshot.publishedBy,
      },
    });
    await tx.activeRuntimeSnapshot.upsert({
      where: {
        tenantId_projectId_applicationId: {
          tenantId: runtimeSnapshot.lookupKey.tenantId,
          projectId: runtimeSnapshot.lookupKey.projectId,
          applicationId: runtimeSnapshot.lookupKey.applicationId,
        },
      },
      update: {
        runtimeSnapshotId: savedRuntimeSnapshot.id,
        updatedBy: runtimeSnapshot.publishedBy,
      },
      create: {
        tenantId: runtimeSnapshot.lookupKey.tenantId,
        projectId: runtimeSnapshot.lookupKey.projectId,
        applicationId: runtimeSnapshot.lookupKey.applicationId,
        runtimeSnapshotId: savedRuntimeSnapshot.id,
        updatedBy: runtimeSnapshot.publishedBy,
      },
    });
  });
}

function assertDemoSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (!isProductionLikeDemoSeedEnv(env)) {
    return;
  }

  throw new Error(
    'Refusing to run demo seed in production-like environments. Create real tenants, projects, applications, and credentials instead.',
  );
}

function isProductionLikeDemoSeedEnv(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === 'production') {
    return true;
  }
  if (
    env.AWS_EXECUTION_ENV ||
    env.ECS_CONTAINER_METADATA_URI ||
    env.ECS_CONTAINER_METADATA_URI_V4
  ) {
    return true;
  }

  const deploymentEnv = readDeploymentEnv(env);

  return [
    'aws',
    'aws-triage',
    'prod',
    'production',
    'release',
    'selfhost',
    'staging',
    'stage',
  ].includes(deploymentEnv);
}

function readDeploymentEnv(env: NodeJS.ProcessEnv): string {
  return (
    env.GATELM_DEPLOYMENT_ENV ??
    env.CONTROL_PLANE_DEPLOYMENT_ENV ??
    env.DEPLOYMENT_ENV ??
    env.APP_ENV ??
    ''
  )
    .trim()
    .toLowerCase();
}

async function upsertDemoTenantProvider(
  tx: Prisma.TransactionClient,
  args: {
    baseUrl: string;
    credentialLast4: string | null;
    credentialPrefix: string | null;
    displayName: string;
    fallbackId: string;
    provider: string;
    providerConfig: Prisma.InputJsonObject;
    resolver: string;
    secretRef: string | null;
  },
) {
  const existingProvider = await tx.providerConnection.findFirst({
    where: {
      tenantId: DEMO_TENANT_ID,
      provider: args.provider,
    },
  });

  if (existingProvider) {
    return tx.providerConnection.update({
      where: { id: existingProvider.id },
      data: {
        tenantId: DEMO_TENANT_ID,
        projectId: null,
        displayName: args.displayName,
        status: ProviderConnectionStatus.ACTIVE,
        baseUrl: args.baseUrl,
        timeoutMs: 30000,
        secretRef: existingProvider.secretRef ?? args.secretRef,
        credentialPrefix:
          existingProvider.credentialPrefix ?? args.credentialPrefix,
        credentialLast4:
          existingProvider.credentialLast4 ?? args.credentialLast4,
        resolver:
          existingProvider.resolver && existingProvider.resolver !== 'none'
            ? existingProvider.resolver
            : args.resolver,
        providerConfig: args.providerConfig,
      },
    });
  }

  return tx.providerConnection.create({
    data: {
      id: args.fallbackId,
      tenantId: DEMO_TENANT_ID,
      projectId: null,
      provider: args.provider,
      displayName: args.displayName,
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: args.baseUrl,
      timeoutMs: 30000,
      secretRef: args.secretRef,
      credentialPrefix: args.credentialPrefix,
      credentialLast4: args.credentialLast4,
      resolver: args.resolver,
      providerConfig: args.providerConfig,
    },
  });
}

async function seedProviderPresets(
  tx: Prisma.TransactionClient,
): Promise<void> {
  const activeProviderPresetKeys = PROVIDER_PRESETS.filter(
    (preset) => preset.status === ResourceStatus.ACTIVE,
  ).map((preset) => preset.providerKey);

  await tx.providerPreset.updateMany({
    where: {
      providerKey: { notIn: activeProviderPresetKeys },
      status: ResourceStatus.ACTIVE,
    },
    data: { status: ResourceStatus.ARCHIVED },
  });

  for (const preset of PROVIDER_PRESETS) {
    await tx.providerPreset.upsert({
      where: { providerKey: preset.providerKey },
      update: {
        displayName: preset.displayName,
        adapterType: preset.adapterType,
        baseUrl: preset.baseUrl,
        modelsEndpointPath: '/models',
        credentialRequired: true,
        defaultResolver: 'environment',
        defaultTimeoutMs: 30000,
        status: preset.status,
        sortOrder: preset.sortOrder,
        providerConfig: providerPresetConfig(preset),
      },
      create: {
        providerKey: preset.providerKey,
        displayName: preset.displayName,
        adapterType: preset.adapterType,
        baseUrl: preset.baseUrl,
        modelsEndpointPath: '/models',
        credentialRequired: true,
        defaultResolver: 'environment',
        defaultTimeoutMs: 30000,
        status: preset.status,
        sortOrder: preset.sortOrder,
        providerConfig: providerPresetConfig(preset),
      },
    });
  }
}

function providerPresetConfig(
  preset: (typeof PROVIDER_PRESETS)[number],
): Prisma.InputJsonObject {
  const models = providerPresetDefaultModels(preset.providerKey);
  const modelMetadata = providerPresetModelMetadata(preset.providerKey);
  return {
    providerKey: preset.providerKey,
    providerFamily: preset.providerKey,
    adapterType: preset.adapterType,
    requestFormat: preset.requestFormat,
    ...(models.length > 0 ? { models } : {}),
    ...(Object.keys(modelMetadata).length > 0 ? { modelMetadata } : {}),
    modelsEndpointPath: '/models',
    credentialRequired: true,
    modelDiscovery: {
      type: preset.modelDiscoveryType,
      cacheTtlSeconds: 3600,
    },
  };
}

function providerPresetDefaultModels(providerKey: string): string[] {
  if (providerKey === 'openai') {
    return buildOpenAISeedModels(
      DEMO_OPENAI_LOW_COST_MODEL,
      DEMO_OPENAI_BALANCED_MODEL,
      [...DEMO_OPENAI_EXTRA_MODELS],
    ).map((model) => model.model);
  }
  if (providerKey === 'gemini') {
    return ['gemini-1.5-flash', 'gemini-1.5-pro'];
  }
  if (providerKey === 'claude') {
    return ['claude-3.5-sonnet', 'claude-3-haiku'];
  }
  if (providerKey === 'groq') {
    return [
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
    ];
  }
  if (providerKey === 'cerebras') {
    return ['gpt-oss-120b'];
  }
  if (providerKey === 'mistral') {
    return [
      'mistral-small-latest',
      'mistral-medium-latest',
      'mistral-large-latest',
    ];
  }
  return [];
}

function providerPresetModelMetadata(
  providerKey: string,
): Prisma.InputJsonObject {
  if (providerKey === 'groq') {
    return {
      'llama-3.1-8b-instant': {
        contextWindowTokens: 131072,
        displayName: 'Llama 3.1 8B Instant',
        maxOutputTokens: 131072,
        supportsJsonMode: true,
        supportsStreaming: true,
      },
      'llama-3.3-70b-versatile': {
        contextWindowTokens: 131072,
        displayName: 'Llama 3.3 70B Versatile',
        maxOutputTokens: 32768,
        supportsJsonMode: true,
        supportsStreaming: true,
      },
      'openai/gpt-oss-20b': {
        contextWindowTokens: 131072,
        displayName: 'GPT-OSS 20B',
        maxOutputTokens: 65536,
        supportsJsonMode: true,
        supportsStreaming: true,
      },
      'openai/gpt-oss-120b': {
        contextWindowTokens: 131072,
        displayName: 'GPT-OSS 120B',
        maxOutputTokens: 65536,
        supportsJsonMode: true,
        supportsStreaming: true,
      },
    };
  }

  if (providerKey === 'cerebras') {
    return {
      'gpt-oss-120b': {
        contextWindowTokens: 131072,
        displayName: 'GPT-OSS 120B',
        maxOutputTokens: 40960,
        supportsJsonMode: true,
        supportsStreaming: true,
      },
    };
  }

  if (providerKey === 'mistral') {
    return {
      'mistral-small-latest': {
        contextWindowTokens: 256000,
        displayName: 'Mistral Small',
        supportsJsonMode: true,
        supportsStreaming: true,
      },
      'mistral-medium-latest': {
        contextWindowTokens: 256000,
        displayName: 'Mistral Medium',
        supportsJsonMode: true,
        supportsStreaming: true,
      },
      'mistral-large-latest': {
        contextWindowTokens: 256000,
        displayName: 'Mistral Large',
        supportsJsonMode: true,
        supportsStreaming: true,
      },
    };
  }

  return {};
}

function buildDemoRuntimeSnapshot(
  runtimeConfig: RuntimeConfig,
  document: ActiveRuntimeConfigResponseDto,
): RuntimeSnapshotResponseDto {
  const runtimeSnapshotVersion = toRuntimeSnapshotVersion(
    runtimeConfig,
    document,
  );
  const providerCatalog = buildDemoProviderCatalog(
    runtimeConfig,
    document,
  );
  const snapshotWithoutContentHash = {
    schemaVersion: 'gatelm.runtime-snapshot.v2',
    runtimeSnapshotId: runtimeConfig.id,
    runtimeSnapshotVersion,
    contentHash: undefined,
    runtimeState: 'snapshot_active',
    publishedAt:
      runtimeConfig.publishedAt?.toISOString() ?? document.publishedAt,
    publishedBy: DEMO_PUBLISHED_BY,
    gatewayInstanceId: DEMO_GATEWAY_INSTANCE_ID,
    lookupKey: {
      tenantId: document.tenantId,
      projectId: document.projectId,
      applicationId: document.applicationId,
    },
    budgetResolution: {
      budgetScopeType: 'application',
      budgetScopeId: document.applicationId,
      resolvedBy: 'default_application',
      warningThresholdPercent: document.budgetPolicy.warningThresholdPercent,
    },
    providerCatalogRef: {
      catalogId: providerCatalog.catalogId,
      catalogVersion: providerCatalog.catalogVersion,
      contentHash: providerCatalog.contentHash,
    },
    policies: {
      safety: {
        enabled: document.safetyPolicy.detectors.some(
          (detector) => detector.enabled,
        ),
        mode: document.safetyPolicy.detectors.some(
          (detector) => detector.enabled,
        )
          ? 'enforce'
          : 'disabled',
        requestSideRequired: true,
        policyHash: document.safetyPolicy.securityPolicyHash,
        detectorSet: document.safetyPolicy.detectors.map((detector) => ({
          detectorType: detector.type,
          action: detector.enabled ? detector.action : 'allow',
        })),
      },
      routing: {
        mode: document.routingPolicy.mode,
        bootstrapState: document.routingPolicy.bootstrapState,
        routes: document.routingPolicy.routes,
        routingPolicyHash: document.routingPolicy.routingPolicyHash,
      },
      cache: {
        exactCacheEnabled: document.cachePolicy.enabled,
        semanticCacheMode: document.cachePolicy.enabled
          ? 'evidence_only'
          : 'disabled',
        cachePolicyHash: sha256(canonicalJson(document.cachePolicy)),
      },
      promptCapture: {
        enabled: document.promptCapturePolicy.enabled,
        mode: document.promptCapturePolicy.mode,
        maxChars: document.promptCapturePolicy.maxChars,
      },
      responseCapture: {
        enabled: document.responseCapturePolicy.enabled,
        mode: document.responseCapturePolicy.mode,
        maxChars: document.responseCapturePolicy.maxChars,
      },
      rateLimit: {
        enabled: document.rateLimit.enabled,
        scope: document.rateLimit.scope,
        windowSeconds: document.rateLimit.windowSeconds,
        limit: document.rateLimit.limit,
      },
      budget: {
        enabled: document.budgetPolicy.enabled,
        enforcementMode: document.budgetPolicy.enforcementMode,
        warningThresholdPercent: document.budgetPolicy.warningThresholdPercent,
      },
      streaming: {
        enabled: document.models.some((model) => model.supportsStreaming),
        thinSliceOnly: true,
      },
    },
    legacyHashes: {
      configHash: document.configHash,
      securityPolicyHash: document.safetyPolicy.securityPolicyHash,
      routingPolicyHash: document.routingPolicy.routingPolicyHash,
    },
  } satisfies Omit<RuntimeSnapshotResponseDto, 'contentHash'> & {
    contentHash?: string;
  };

  return {
    ...snapshotWithoutContentHash,
    contentHash: sha256(canonicalJson(snapshotWithoutContentHash)),
  };
}

function buildDemoProviderCatalog(
  runtimeConfig: RuntimeConfig,
  document: ActiveRuntimeConfigResponseDto,
): ProviderCatalogResponseDto {
  const catalogVersion = toRuntimeSnapshotVersion(runtimeConfig, document);
  const updatedAt =
    runtimeConfig.publishedAt?.toISOString() ?? document.publishedAt;
  const catalogBodyWithoutHash = {
    catalogId: `${PROVIDER_CATALOG_ID_PREFIX}:${document.applicationId}:${catalogVersion}`,
    catalogVersion,
    updatedAt,
    providers: document.providers
      .filter(isProviderCatalogProviderExecutable)
      .map((provider) => ({
        providerId: provider.providerId,
        providerName: provider.provider,
        adapterType: toRuntimeProviderAdapterType(provider),
        enabled: provider.status === 'active',
        baseUrl: provider.baseUrl,
        timeoutMs: provider.timeoutMs,
        credentialRequired: providerCredentialRequired(provider),
        credentialRef: providerCredentialRequired(provider)
          ? providerCatalogCredentialRef(provider)
          : null,
        adapterConfig:
          provider.adapterConfig ??
          toRuntimeProviderAdapterConfig(
            toRuntimeProviderAdapterType(provider),
          ),
        fallbackEligible: provider.failureMode === 'fail_open_to_fallback',
        models: document.models
          .filter((model) => model.provider === provider.provider)
          .map((model) => {
            const modelId = `${provider.providerId}:${model.model}`;
            const modelRef =
              provider.provider === DEMO_PROVIDER &&
              model.model === 'mock-balanced'
                ? 'mock-balanced'
                : modelId;
            return {
            modelId,
            modelRef,
            modelName: model.model,
            displayName: model.displayName,
            enabled: model.status === 'active',
            capabilities: {
              streamingSupported: model.supportsStreaming,
              supportsJsonMode: model.supportsJsonMode,
              maxInputTokens: model.contextWindowTokens,
              maxOutputTokens: toMaxOutputTokens(model),
            },
            routing: {
              autoRoutingEligible: isModelSelectedForRouting(modelRef, document),
              costTier: 'balanced' as const,
              fallbackPriority: toModelFallbackPriority(modelRef, document),
            },
          };
          }),
      })),
  };
  if (catalogBodyWithoutHash.providers.length === 0) {
    throw new Error('Provider Catalog has no executable providers.');
  }

  return {
    ...catalogBodyWithoutHash,
    contentHash: sha256(canonicalJson(catalogBodyWithoutHash)),
  };
}

function isProviderCatalogProviderExecutable(
  provider: ActiveRuntimeConfigResponseDto['providers'][number],
): boolean {
  if (provider.status !== 'active') {
    return false;
  }
  if (!providerCredentialRequired(provider)) {
    return true;
  }

  return provider.credentialRef?.credentialState === 'active';
}

function providerCredentialRequired(
  provider: ActiveRuntimeConfigResponseDto['providers'][number],
): boolean {
  return provider.credentialRequired ?? provider.resolver !== 'none';
}

function providerCatalogCredentialRef(
  provider: ActiveRuntimeConfigResponseDto['providers'][number],
): NonNullable<
  ProviderCatalogResponseDto['providers'][number]['credentialRef']
> {
  if (!provider.credentialRef) {
    throw new Error('Provider credentialRef is required for catalog seed.');
  }

  return {
    credentialRefId: provider.credentialRef.credentialRefId,
    credentialVersion: provider.credentialRef.credentialVersion,
    credentialState: provider.credentialRef.credentialState,
  };
}

function toRuntimeProviderAdapterType(
  provider: ActiveRuntimeConfigResponseDto['providers'][number],
): string {
  if (isSafeCatalogToken(provider.adapterType)) {
    return provider.adapterType.trim();
  }

  return provider.provider === DEMO_PROVIDER ? 'mock' : 'openai_compatible';
}

function toRuntimeProviderAdapterConfig(
  adapterType: string,
): ProviderCatalogResponseDto['providers'][number]['adapterConfig'] {
  if (adapterType === 'anthropic') {
    return { requestFormat: 'anthropic_messages' };
  }

  return adapterType === 'mock'
    ? { requestFormat: 'mock_chat_completions' }
    : { requestFormat: 'openai_chat_completions' };
}

function toMaxOutputTokens(
  model: ActiveRuntimeConfigResponseDto['models'][number],
): number {
  return Math.max(
    1,
    Math.min(4096, Math.floor(model.contextWindowTokens / 4)),
  );
}

function isModelSelectedForRouting(
  modelRef: string,
  document: ActiveRuntimeConfigResponseDto,
): boolean {
  return routingModelRefs(document.routingPolicy.routes).includes(modelRef);
}

function toModelFallbackPriority(
  modelRef: string,
  document: ActiveRuntimeConfigResponseDto,
): number {
  const categories = Object.values(document.routingPolicy.routes) as Array<{
    simple: { modelRefs: string[] };
    complex: { modelRefs: string[] };
  }>;
  const indexes = categories
    .flatMap((category) =>
      [category.simple, category.complex].map((cell) =>
        cell.modelRefs.indexOf(modelRef),
      ),
    )
    .filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : 100;
}

function toRuntimeSnapshotVersion(
  runtimeConfig: RuntimeConfig,
  document: ActiveRuntimeConfigResponseDto,
): number {
  const fromVersion =
    trailingPositiveInteger(runtimeConfig.configVersion) ??
    trailingPositiveInteger(document.configVersion);
  if (fromVersion) {
    return fromVersion;
  }

  const publishedAt =
    runtimeConfig.publishedAt ?? new Date(document.publishedAt);
  if (!Number.isNaN(publishedAt.getTime())) {
    return Math.max(1, publishedAt.getTime());
  }

  return 1;
}

function trailingPositiveInteger(value: string): number | null {
  const match = value.match(/(\d+)$/);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isSafeCatalogToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._-]{1,80}$/.test(value.trim())
  );
}

function buildSafetyPolicy(): ActiveRuntimeConfigResponseDto['safetyPolicy'] {
  const detectors: RuntimeConfigSafetyDetectorResponseDto[] = [
    {
      type: 'email',
      enabled: true,
      action: 'redact',
      placeholder: '[EMAIL_REDACTED]',
    },
    {
      type: 'phone_number',
      enabled: true,
      action: 'redact',
      placeholder: '[PHONE_NUMBER_REDACTED]',
    },
    {
      type: 'resident_registration_number',
      enabled: true,
      action: 'block',
      placeholder: '[RESIDENT_REGISTRATION_NUMBER_REDACTED]',
    },
    {
      type: 'api_key',
      enabled: true,
      action: 'block',
      placeholder: '[API_KEY_REDACTED]',
    },
    {
      type: 'authorization_header',
      enabled: true,
      action: 'block',
      placeholder: '[AUTHORIZATION_HEADER_REDACTED]',
    },
    {
      type: 'jwt',
      enabled: true,
      action: 'block',
      placeholder: '[JWT_REDACTED]',
    },
    {
      type: 'private_key',
      enabled: true,
      action: 'block',
      placeholder: '[SECRET_REDACTED]',
    },
  ];

  return {
    mode: 'rule_based',
    securityPolicyHash: sha256(
      canonicalJson({
        mode: 'rule_based',
        detectors,
      }),
    ),
    remoteSafety: {
      enabled: false,
      mode: 'disabled',
    },
    detectors,
  };
}

function buildMockRuntimeProvider(
  providerId: string,
  failureMode: 'fail_closed' | 'fail_open_to_fallback',
  baseUrl: string,
): ActiveRuntimeConfigResponseDto['providers'][number] {
  return {
    providerId,
    provider: DEMO_PROVIDER,
    displayName: 'Mock Provider',
    status: 'active',
    adapterType: 'mock',
    baseUrl,
    timeoutMs: 30000,
    credentialRequired: false,
    credentialRef: null,
    secretRef: null,
    credentialPreview: null,
    resolver: 'none',
    adapterConfig: { requestFormat: 'mock_chat_completions' },
    models: [...DEMO_MODELS],
    failureMode,
  };
}

type OpenAISeedModel = {
  model: string;
  displayName: string;
  contextWindowTokens: number;
  pricingVersion?: string;
  promptTokenMicroUsd?: number;
  completionTokenMicroUsd?: number;
};

const OPENAI_MODEL_SEED_METADATA: Record<
  string,
  Omit<OpenAISeedModel, 'model'>
> = {
  'gpt-4o-mini': {
    displayName: 'GPT-4o mini',
    contextWindowTokens: 128000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.15,
    completionTokenMicroUsd: 0.6,
  },
  'gpt-4o': {
    displayName: 'GPT-4o',
    contextWindowTokens: 128000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 2.5,
    completionTokenMicroUsd: 10,
  },
  'gpt-5.5': {
    displayName: 'GPT-5.5',
    contextWindowTokens: 1050000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 5,
    completionTokenMicroUsd: 30,
  },
  'gpt-5.5-pro': {
    displayName: 'GPT-5.5 Pro',
    contextWindowTokens: 1050000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 30,
    completionTokenMicroUsd: 180,
  },
  'gpt-5.4': {
    displayName: 'GPT-5.4',
    contextWindowTokens: 1050000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 2.5,
    completionTokenMicroUsd: 15,
  },
  'gpt-5.4-mini': {
    displayName: 'GPT-5.4 mini',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.75,
    completionTokenMicroUsd: 4.5,
  },
  'gpt-5.4-nano': {
    displayName: 'GPT-5.4 nano',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.2,
    completionTokenMicroUsd: 1.25,
  },
  'gpt-5.4-pro': {
    displayName: 'GPT-5.4 Pro',
    contextWindowTokens: 1050000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 30,
    completionTokenMicroUsd: 180,
  },
  'gpt-5.3-codex': {
    displayName: 'GPT-5.3-Codex',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 1.75,
    completionTokenMicroUsd: 14,
  },
  'gpt-5.2': {
    displayName: 'GPT-5.2',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 1.75,
    completionTokenMicroUsd: 14,
  },
  'gpt-5.2-pro': {
    displayName: 'GPT-5.2 Pro',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 21,
    completionTokenMicroUsd: 168,
  },
  'gpt-5.2-codex': {
    displayName: 'GPT-5.2-Codex',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 1.75,
    completionTokenMicroUsd: 14,
  },
  'gpt-5.1': {
    displayName: 'GPT-5.1',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 1.25,
    completionTokenMicroUsd: 10,
  },
  'gpt-5.1-codex': {
    displayName: 'GPT-5.1-Codex',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 1.25,
    completionTokenMicroUsd: 10,
  },
  'gpt-5.1-codex-mini': {
    displayName: 'GPT-5.1-Codex mini',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.25,
    completionTokenMicroUsd: 2,
  },
  'gpt-5.1-codex-max': {
    displayName: 'GPT-5.1-Codex-Max',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 1.25,
    completionTokenMicroUsd: 10,
  },
  'gpt-5': {
    displayName: 'GPT-5',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 1.25,
    completionTokenMicroUsd: 10,
  },
  'gpt-5-mini': {
    displayName: 'GPT-5 mini',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.25,
    completionTokenMicroUsd: 2,
  },
  'gpt-5-nano': {
    displayName: 'GPT-5 nano',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.05,
    completionTokenMicroUsd: 0.4,
  },
  'gpt-5-pro': {
    displayName: 'GPT-5 Pro',
    contextWindowTokens: 400000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 15,
    completionTokenMicroUsd: 120,
  },
  'gpt-4.5-preview': {
    displayName: 'GPT-4.5 Preview',
    contextWindowTokens: 128000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 75,
    completionTokenMicroUsd: 150,
  },
  'gpt-4.1': {
    displayName: 'GPT-4.1',
    contextWindowTokens: 1047576,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 2,
    completionTokenMicroUsd: 8,
  },
  'gpt-4.1-mini': {
    displayName: 'GPT-4.1 mini',
    contextWindowTokens: 1047576,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.4,
    completionTokenMicroUsd: 1.6,
  },
  'gpt-4.1-nano': {
    displayName: 'GPT-4.1 nano',
    contextWindowTokens: 1047576,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.1,
    completionTokenMicroUsd: 0.4,
  },
  'gpt-3.5-turbo': {
    displayName: 'GPT-3.5 Turbo',
    contextWindowTokens: 16385,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 0.5,
    completionTokenMicroUsd: 1.5,
  },
  'chat-latest': {
    displayName: 'ChatGPT chat-latest',
    contextWindowTokens: 128000,
    pricingVersion: '2026-07-08.openai.official.v2',
    promptTokenMicroUsd: 5,
    completionTokenMicroUsd: 30,
  },
};

function buildOpenAISeedModels(
  lowCostModel: string,
  balancedModel: string,
  extraModels: string[],
): OpenAISeedModel[] {
  const seen = new Set<string>();
  return [lowCostModel, balancedModel, ...extraModels]
    .map((model) => model.trim())
    .filter((model) => {
      if (!model || seen.has(model)) {
        return false;
      }
      seen.add(model);
      return true;
    })
    .map((model) => ({
      model,
      ...(OPENAI_MODEL_SEED_METADATA[model] ?? {
        displayName: model,
        contextWindowTokens: 128000,
        // Unknown env-added models are callable through the catalog, but need
        // an explicit model_pricing_rules seed before cost reporting is valid.
      }),
    }));
}

function isPricedOpenAISeedModel(
  model: OpenAISeedModel,
): model is OpenAISeedModel &
  Required<
    Pick<
      OpenAISeedModel,
      'pricingVersion' | 'promptTokenMicroUsd' | 'completionTokenMicroUsd'
    >
  > {
  return (
    typeof model.pricingVersion === 'string' &&
    typeof model.promptTokenMicroUsd === 'number' &&
    typeof model.completionTokenMicroUsd === 'number'
  );
}

function buildOpenAIRuntimeProvider(args: {
  providerId: string;
  baseUrl: string;
  models: string[];
}): ActiveRuntimeConfigResponseDto['providers'][number] {
  return {
    providerId: args.providerId,
    provider: DEMO_OPENAI_PROVIDER,
    displayName: 'OpenAI Main',
    status: 'active',
    adapterType: 'openai_compatible',
    baseUrl: args.baseUrl,
    timeoutMs: 30000,
    credentialRequired: true,
    credentialRef: {
      credentialRefId: `provider_credential:${args.providerId}`,
      credentialVersion: 1,
      credentialState: 'active',
    },
    secretRef: `provider_credential:${args.providerId}`,
    credentialPreview: {
      prefix: 'env_ref_',
      last4: '0000',
    },
    resolver: 'environment',
    adapterConfig: { requestFormat: 'openai_chat_completions' },
    models: args.models,
    failureMode: 'fail_closed',
  };
}

function buildMockModel(
  model: (typeof DEMO_MODELS)[number],
  displayName: string,
): ActiveRuntimeConfigResponseDto['models'][number] {
  return {
    provider: DEMO_PROVIDER,
    model,
    displayName,
    status: 'active',
    contextWindowTokens: 8192,
    supportsStreaming: true,
    supportsJsonMode: false,
  };
}

function buildOpenAIModel(
  model: string,
  displayName: string,
  contextWindowTokens: number,
): ActiveRuntimeConfigResponseDto['models'][number] {
  return {
    provider: DEMO_OPENAI_PROVIDER,
    model,
    displayName,
    status: 'active',
    contextWindowTokens,
    supportsStreaming: true,
    supportsJsonMode: true,
  };
}

function buildPricingRule(args: {
  provider: string;
  model: string;
  pricingVersion: string;
  promptTokenMicroUsd: number;
  completionTokenMicroUsd: number;
}): ActiveRuntimeConfigResponseDto['pricingRules'][number] {
  return {
    pricingRuleId: `price_${args.provider}_${args.model}_v1`.replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    ),
    provider: args.provider,
    model: args.model,
    pricingVersion: args.pricingVersion,
    currency: 'USD',
    unit: 'token',
    promptTokenMicroUsd: args.promptTokenMicroUsd,
    completionTokenMicroUsd: args.completionTokenMicroUsd,
    effectiveAt: DEMO_GENERATED_AT,
  };
}

function buildRoutingPolicy(): ActiveRuntimeConfigResponseDto['routingPolicy'] {
  const modelRef = 'mock-balanced';
  const bootstrapState = 'mock_bootstrap';
  const routes = {
    general: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    code: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    translation: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    summarization: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
    reasoning: {
      simple: { modelRefs: [modelRef] },
      complex: { modelRefs: [modelRef] },
    },
  };
  const routingPolicyWithoutHash = {
    schemaVersion: 'gatelm.routing-policy.v2',
    mode: 'auto',
    bootstrapState,
    routes,
  } as const;

  return {
    ...routingPolicyWithoutHash,
    routingPolicyHash: `sha256:${sha256(
      canonicalJson(routingPolicyWithoutHash),
    )}`,
  };
}

function routingModelRefs(
  routes: ActiveRuntimeConfigResponseDto['routingPolicy']['routes'],
): string[] {
  const categories = Object.values(routes) as Array<{
    simple: { modelRefs: string[] };
    complex: { modelRefs: string[] };
  }>;
  return categories.flatMap((category) => [
    ...category.simple.modelRefs,
    ...category.complex.modelRefs,
  ]);
}

function demoProviderConfig(): Prisma.InputJsonObject {
  return {
    providerFamily: 'mock',
    models: [...DEMO_MODELS],
    failureMode: 'fail_open_to_fallback',
    adapterType: 'mock',
    requestFormat: 'mock_chat_completions',
  };
}

function demoOpenAIProviderConfig(
  lowCostModel: string,
  balancedModel: string,
  extraModels: string[],
): Prisma.InputJsonObject {
  return {
    providerFamily: 'openai',
    adapterType: 'openai_compatible',
    requestFormat: 'openai_chat_completions',
    credentialRequired: true,
    models: buildOpenAISeedModels(lowCostModel, balancedModel, extraModels).map(
      (model) => model.model,
    ),
    failureMode: 'fail_closed',
  };
}

function readDemoProviderMode(): DemoProviderMode {
  return process.env.GATELM_DEMO_PROVIDER_MODE === 'actual'
    ? 'actual'
    : 'mock';
}

function readDemoRateLimitLimit(
  providerMode: DemoProviderMode,
  env: NodeJS.ProcessEnv,
): number {
  const rawValue = env[PERF_RUNTIME_RATE_LIMIT_ENV];
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return DEFAULT_DEMO_RATE_LIMIT_LIMIT;
  }

  if (readDeploymentEnv(env) !== 'perf' || providerMode !== 'mock') {
    throw new Error(
      `${PERF_RUNTIME_RATE_LIMIT_ENV} is allowed only for the isolated perf Mock seed.`,
    );
  }

  const value = rawValue.trim();
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `${PERF_RUNTIME_RATE_LIMIT_ENV} must be an integer from 1 to ${MAX_DEMO_RATE_LIMIT_LIMIT}.`,
    );
  }

  return resolveDemoRateLimitLimit(Number(value));
}

function resolveDemoRateLimitLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_DEMO_RATE_LIMIT_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_DEMO_RATE_LIMIT_LIMIT
  ) {
    throw new Error(
      `Demo rate limit must be an integer from 1 to ${MAX_DEMO_RATE_LIMIT_LIMIT}.`,
    );
  }

  return limit;
}

function readEnvString(key: string, fallback: string): string {
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
}

function readEnvCSV(key: string, fallback: string[]): string[] {
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [...fallback];
  }

  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return values.length > 0 ? values : [...fallback];
}

function credentialPreview(
  plaintext: string,
  fallbackPrefix: string,
): { prefix: string; last4: string } {
  const value = plaintext.trim();
  const markerIndex = value.lastIndexOf('_');
  const prefix =
    markerIndex >= 0
      ? value.slice(0, Math.min(markerIndex + 1, 24))
      : fallbackPrefix;

  return {
    prefix,
    last4: value.length >= 4 ? value.slice(-4) : '****',
  };
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Demo Runtime Config contains an invalid Date value.');
    }

    return JSON.stringify(value.toISOString());
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const entries = Object.entries(objectValue)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => compareCanonicalKeys(left, right));

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalJson(entryValue)}`,
    )
    .join(',')}}`;
}

function compareCanonicalKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }

  return 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function toInputJsonObject(
  value: ActiveRuntimeConfigResponseDto | RuntimeSnapshotResponseDto,
): Prisma.InputJsonObject {
  return value as unknown as Prisma.InputJsonObject;
}

async function main(): Promise<void> {
  await seedDemoData(prisma);
}

if (require.main === module) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}

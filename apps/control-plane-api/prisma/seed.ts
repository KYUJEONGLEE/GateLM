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
export const DEMO_RUNTIME_CONFIG_VERSION = 'runtime_config_v1_demo_001';

const DEMO_PROVIDER = 'mock';
const DEMO_PROVIDER_BASE_URL = 'http://mock-provider:8090';
const DEMO_OPENAI_PROVIDER = 'openai-main';
const DEMO_OPENAI_PROVIDER_BASE_URL = 'https://api.openai.com/v1';
const DEMO_OPENAI_LOW_COST_MODEL = 'gpt-4o-mini';
const DEMO_OPENAI_BALANCED_MODEL = 'gpt-4o';
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
    providerKey: 'claude',
    displayName: 'Claude',
    adapterType: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    requestFormat: 'anthropic_messages',
    modelDiscoveryType: 'anthropic_models',
    status: ResourceStatus.DISABLED,
    sortOrder: 30,
  },
] as const;

type DemoProviderMode = 'mock' | 'actual';

interface DemoRuntimeConfigOptions {
  providerMode?: DemoProviderMode;
  mockProviderId?: string;
  mockProviderBaseUrl?: string;
  openAIProviderId?: string;
  openAIBaseUrl?: string;
  openAILowCostModel?: string;
  openAIBalancedModel?: string;
  apiKeyPrefix?: string;
  apiKeyLast4?: string;
  appTokenPrefix?: string;
  appTokenLast4?: string;
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
  const apiKeyPrefix = options.apiKeyPrefix ?? 'gsk_live_';
  const apiKeyLast4 = options.apiKeyLast4 ?? '9xA1';
  const appTokenPrefix = options.appTokenPrefix ?? 'gat_app_';
  const appTokenLast4 = options.appTokenLast4 ?? '4tK2';
  const safetyPolicy = buildSafetyPolicy();
  const routingPolicy =
    providerMode === 'actual'
      ? buildRoutingPolicy({
          defaultProvider: DEMO_OPENAI_PROVIDER,
          defaultModel: openAIBalancedModel,
          lowCostProvider: DEMO_OPENAI_PROVIDER,
          lowCostModel: openAILowCostModel,
          fallbackProvider: DEMO_PROVIDER,
          fallbackModel: 'mock-balanced',
        })
      : buildRoutingPolicy();
  const providers =
    providerMode === 'actual'
      ? [
          buildOpenAIRuntimeProvider({
            providerId: openAIProviderId,
            baseUrl: openAIBaseUrl,
            lowCostModel: openAILowCostModel,
            balancedModel: openAIBalancedModel,
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
          buildOpenAIModel(openAILowCostModel, 'OpenAI Low Cost', 128000),
          buildOpenAIModel(openAIBalancedModel, 'OpenAI Balanced', 128000),
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
    schemaVersion: 'gatelm.active-runtime-config.v1',
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
    defaultProvider: routingPolicy.defaultProvider,
    defaultModel: routingPolicy.defaultModel,
    lowCostProvider: routingPolicy.lowCostProvider,
    lowCostModel: routingPolicy.lowCostModel,
    fallbackProvider: routingPolicy.fallbackProvider,
    fallbackModel: routingPolicy.fallbackModel,
    rateLimit: {
      enabled: true,
      scope: 'application',
      algorithm: 'fixed_window',
      windowSeconds: 60,
      limit: 60,
    },
    budgetPolicy: {
      enabled: false,
      enforcementMode: 'disabled',
      warningThresholdPercent: 80,
      restrictHighQualityOnBudgetRisk: true,
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
        'selectedProvider',
        'selectedModel',
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

    const providerMode = readDemoProviderMode();
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

    const provider = await tx.providerConnection.upsert({
      where: {
        projectId_provider: {
          projectId: DEMO_PROJECT_ID,
          provider: DEMO_PROVIDER,
        },
      },
      update: {
        tenantId: DEMO_TENANT_ID,
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
      create: {
        id: DEMO_MOCK_PROVIDER_ID,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
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
        ? await tx.providerConnection.upsert({
            where: {
              projectId_provider: {
                projectId: DEMO_PROJECT_ID,
                provider: DEMO_OPENAI_PROVIDER,
              },
            },
            update: {
              tenantId: DEMO_TENANT_ID,
              displayName: 'OpenAI Main',
              status: ProviderConnectionStatus.ACTIVE,
              baseUrl: openAIBaseUrl,
              timeoutMs: 30000,
              secretRef: `provider_credential:${DEMO_OPENAI_PROVIDER_ID}`,
              credentialPrefix: 'env_ref_',
              credentialLast4: '0000',
              resolver: 'environment',
              providerConfig: demoOpenAIProviderConfig(
                openAILowCostModel,
                openAIBalancedModel,
              ),
            },
            create: {
              id: DEMO_OPENAI_PROVIDER_ID,
              tenantId: DEMO_TENANT_ID,
              projectId: DEMO_PROJECT_ID,
              provider: DEMO_OPENAI_PROVIDER,
              displayName: 'OpenAI Main',
              status: ProviderConnectionStatus.ACTIVE,
              baseUrl: openAIBaseUrl,
              timeoutMs: 30000,
              secretRef: `provider_credential:${DEMO_OPENAI_PROVIDER_ID}`,
              credentialPrefix: 'env_ref_',
              credentialLast4: '0000',
              resolver: 'environment',
              providerConfig: demoOpenAIProviderConfig(
                openAILowCostModel,
                openAIBalancedModel,
              ),
            },
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
      apiKeyPrefix: apiKeyPreview.prefix,
      apiKeyLast4: apiKeyPreview.last4,
      appTokenPrefix: appTokenPreview.prefix,
      appTokenLast4: appTokenPreview.last4,
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
  return {
    providerKey: preset.providerKey,
    adapterType: preset.adapterType,
    requestFormat: preset.requestFormat,
    modelsEndpointPath: '/models',
    credentialRequired: true,
    modelDiscovery: {
      type: preset.modelDiscoveryType,
      cacheTtlSeconds: 3600,
    },
  };
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
        autoModelEnabled: true,
        defaultRequestedModel: document.routingPolicy.autoModel,
        defaultProvider: document.routingPolicy.defaultProvider,
        defaultModel: document.routingPolicy.defaultModel,
        lowCostProvider: document.routingPolicy.lowCostProvider,
        lowCostModel: document.routingPolicy.lowCostModel,
        ...(document.routingPolicy.highQualityProvider &&
        document.routingPolicy.highQualityModel
          ? {
              highQualityProvider: document.routingPolicy.highQualityProvider,
              highQualityModel: document.routingPolicy.highQualityModel,
            }
          : {}),
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
        restrictHighQualityOnBudgetRisk:
          document.budgetPolicy.restrictHighQualityOnBudgetRisk,
      },
      fallback: {
        enabled: true,
        fallbackProvider: document.routingPolicy.fallbackProvider,
        fallbackModel: document.routingPolicy.fallbackModel,
        allowedReasons: ['provider_timeout', 'provider_error'],
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
          .map((model) => ({
            modelId: `${provider.providerId}:${model.model}`,
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
              autoRoutingEligible: model.status === 'active',
              costTier: toModelCostTier(model, document),
              fallbackPriority: toModelFallbackPriority(model, document),
            },
          })),
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

function toModelCostTier(
  model: ActiveRuntimeConfigResponseDto['models'][number],
  document: ActiveRuntimeConfigResponseDto,
): 'low' | 'balanced' | 'premium' {
  if (
    model.provider === document.routingPolicy.lowCostProvider &&
    model.model === document.routingPolicy.lowCostModel
  ) {
    return 'low';
  }

  return 'balanced';
}

function toModelFallbackPriority(
  model: ActiveRuntimeConfigResponseDto['models'][number],
  document: ActiveRuntimeConfigResponseDto,
): number {
  if (
    model.provider === document.routingPolicy.lowCostProvider &&
    model.model === document.routingPolicy.lowCostModel
  ) {
    return 0;
  }
  if (
    model.provider === document.routingPolicy.defaultProvider &&
    model.model === document.routingPolicy.defaultModel
  ) {
    return 1;
  }
  if (
    model.provider === document.routingPolicy.fallbackProvider &&
    model.model === document.routingPolicy.fallbackModel
  ) {
    return 10;
  }

  return 5;
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

function buildOpenAIRuntimeProvider(args: {
  providerId: string;
  baseUrl: string;
  lowCostModel: string;
  balancedModel: string;
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
    models: [args.lowCostModel, args.balancedModel],
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

function buildRoutingPolicy(
  overrides: Partial<{
    defaultProvider: string;
    defaultModel: string;
    lowCostProvider: string;
    lowCostModel: string;
    fallbackProvider: string;
    fallbackModel: string;
    shortPromptMaxChars: number;
  }> = {},
): ActiveRuntimeConfigResponseDto['routingPolicy'] {
  const routingPolicyWithoutHash = {
    type: 'simple',
    autoModel: 'auto',
    defaultProvider: overrides.defaultProvider ?? DEMO_PROVIDER,
    defaultModel: overrides.defaultModel ?? 'mock-balanced',
    lowCostProvider: overrides.lowCostProvider ?? DEMO_PROVIDER,
    lowCostModel: overrides.lowCostModel ?? 'mock-fast',
    fallbackProvider: overrides.fallbackProvider ?? DEMO_PROVIDER,
    fallbackModel: overrides.fallbackModel ?? 'mock-balanced',
    shortPromptMaxChars: overrides.shortPromptMaxChars ?? 500,
  } as const;

  return {
    ...routingPolicyWithoutHash,
    routingPolicyHash: sha256(canonicalJson(routingPolicyWithoutHash)),
  };
}

function demoProviderConfig(): Prisma.InputJsonObject {
  return {
    models: [...DEMO_MODELS],
    failureMode: 'fail_open_to_fallback',
    adapterType: 'mock',
    requestFormat: 'mock_chat_completions',
  };
}

function demoOpenAIProviderConfig(
  lowCostModel: string,
  balancedModel: string,
): Prisma.InputJsonObject {
  return {
    adapterType: 'openai_compatible',
    requestFormat: 'openai_chat_completions',
    credentialRequired: true,
    models: [lowCostModel, balancedModel],
    failureMode: 'fail_closed',
  };
}

function readDemoProviderMode(): DemoProviderMode {
  return process.env.GATELM_DEMO_PROVIDER_MODE === 'actual'
    ? 'actual'
    : 'mock';
}

function readEnvString(key: string, fallback: string): string {
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
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

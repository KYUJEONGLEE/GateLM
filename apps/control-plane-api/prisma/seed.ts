import {
  CredentialStatus,
  Prisma,
  PrismaClient,
  ProviderConnectionStatus,
  ResourceStatus,
  RuntimeConfigPublishState,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import type {
  ActiveRuntimeConfigResponseDto,
  RuntimeConfigSafetyDetectorResponseDto,
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

const DEMO_API_KEY_SECRET_HASH =
  '530ac6a98774a6a0d7b1b880ec696d040bcb317abf2c1ca246f37c67ba6576df';
const DEMO_APP_TOKEN_SECRET_HASH =
  '525420fa732030cf3d3da44e077628b53fdf3503f772b21e8b14b1fc1b354862';
const DEMO_PROVIDER = 'mock';
const DEMO_PROVIDER_BASE_URL = 'http://mock-provider:8090';
const DEMO_OPENAI_PROVIDER = 'openai-main';
const DEMO_OPENAI_PROVIDER_BASE_URL = 'https://api.openai.com/v1';
const DEMO_OPENAI_LOW_COST_MODEL = 'gpt-4o-mini';
const DEMO_OPENAI_BALANCED_MODEL = 'gpt-4o';
const DEMO_GENERATED_AT = '2026-06-27T02:00:00.000Z';
const CONFIG_HASH_ALGORITHM =
  'sha256(canonical_json(runtimeConfig_without_configHash))';
const DEMO_MODELS = ['mock-fast', 'mock-balanced'] as const;

type DemoProviderMode = 'mock' | 'actual';

interface DemoRuntimeConfigOptions {
  providerMode?: DemoProviderMode;
  mockProviderId?: string;
  openAIProviderId?: string;
  openAIBaseUrl?: string;
  openAILowCostModel?: string;
  openAIBalancedModel?: string;
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
  const openAIProviderId =
    options.openAIProviderId ?? DEMO_OPENAI_PROVIDER_ID;
  const openAIBaseUrl =
    options.openAIBaseUrl ?? DEMO_OPENAI_PROVIDER_BASE_URL;
  const openAILowCostModel =
    options.openAILowCostModel ?? DEMO_OPENAI_LOW_COST_MODEL;
  const openAIBalancedModel =
    options.openAIBalancedModel ?? DEMO_OPENAI_BALANCED_MODEL;
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
          buildMockRuntimeProvider(mockProviderId, 'fail_open_to_fallback'),
        ]
      : [buildMockRuntimeProvider(mockProviderId, 'fail_closed')];
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
      prefix: 'gsk_live_',
      last4: '9xA1',
      scopes: ['chat:completions', 'models:read'],
      expiresAt: null,
      verification: 'prefix_then_hash_compare',
    },
    appToken: {
      id: DEMO_APP_TOKEN_ID,
      type: 'app_token',
      status: 'active',
      prefix: 'gat_app_',
      last4: '4tK2',
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
    fallbackProvider: DEMO_PROVIDER,
    fallbackModel: 'mock-balanced',
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
    },
    safetyPolicy,
    cachePolicy: {
      enabled: true,
      type: 'exact',
      ttlSeconds: 3600,
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
    await tx.tenant.upsert({
      where: { id: DEMO_TENANT_ID },
      update: {
        name: 'Demo Tenant',
        status: ResourceStatus.ACTIVE,
      },
      create: {
        id: DEMO_TENANT_ID,
        name: 'Demo Tenant',
        status: ResourceStatus.ACTIVE,
      },
    });

    await tx.project.upsert({
      where: { id: DEMO_PROJECT_ID },
      update: {
        tenantId: DEMO_TENANT_ID,
        name: 'Customer Support',
        description: null,
        status: ResourceStatus.ACTIVE,
      },
      create: {
        id: DEMO_PROJECT_ID,
        tenantId: DEMO_TENANT_ID,
        name: 'Customer Support',
        status: ResourceStatus.ACTIVE,
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
      },
      create: {
        id: DEMO_APPLICATION_ID,
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        name: 'Customer Demo App',
        status: ResourceStatus.ACTIVE,
      },
    });

    const providerMode = readDemoProviderMode();
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
        baseUrl: DEMO_PROVIDER_BASE_URL,
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
        baseUrl: DEMO_PROVIDER_BASE_URL,
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

    await tx.gatewayApiKey.upsert({
      where: { id: DEMO_API_KEY_ID },
      update: {
        tenantId: DEMO_TENANT_ID,
        projectId: DEMO_PROJECT_ID,
        displayName: 'Demo API Key',
        prefix: 'gsk_live_',
        last4: '9xA1',
        secretHash: DEMO_API_KEY_SECRET_HASH,
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
        prefix: 'gsk_live_',
        last4: '9xA1',
        secretHash: DEMO_API_KEY_SECRET_HASH,
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
        prefix: 'gat_app_',
        last4: '4tK2',
        secretHash: DEMO_APP_TOKEN_SECRET_HASH,
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
        prefix: 'gat_app_',
        last4: '4tK2',
        secretHash: DEMO_APP_TOKEN_SECRET_HASH,
        hashAlgorithm: 'sha256',
        status: CredentialStatus.ACTIVE,
        scopes: ['gateway:invoke'],
        expiresAt: null,
      },
    });

    const runtimeConfig = buildDemoRuntimeConfigDocument(provider.id, {
      providerMode,
      mockProviderId: provider.id,
      openAIProviderId: openAIProvider?.id ?? DEMO_OPENAI_PROVIDER_ID,
      openAIBaseUrl,
      openAILowCostModel,
      openAIBalancedModel,
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

    await tx.runtimeConfig.upsert({
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
  });
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
): ActiveRuntimeConfigResponseDto['providers'][number] {
  return {
    providerId,
    provider: DEMO_PROVIDER,
    displayName: 'Mock Provider',
    status: 'active',
    adapterType: 'mock',
    baseUrl: DEMO_PROVIDER_BASE_URL,
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
    supportsStreaming: false,
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
  value: ActiveRuntimeConfigResponseDto,
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

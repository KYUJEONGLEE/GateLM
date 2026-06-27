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
export const DEMO_RUNTIME_CONFIG_VERSION = 'runtime_config_v1_demo_001';

const DEMO_API_KEY_SECRET_HASH =
  '530ac6a98774a6a0d7b1b880ec696d040bcb317abf2c1ca246f37c67ba6576df';
const DEMO_APP_TOKEN_SECRET_HASH =
  '525420fa732030cf3d3da44e077628b53fdf3503f772b21e8b14b1fc1b354862';
const DEMO_PROVIDER = 'mock';
const DEMO_PROVIDER_BASE_URL = 'http://mock-provider:8090';
const DEMO_GENERATED_AT = '2026-06-27T02:00:00.000Z';
const CONFIG_HASH_ALGORITHM =
  'sha256(canonical_json(runtimeConfig_without_configHash))';
const DEMO_MODELS = ['mock-fast', 'mock-balanced'] as const;

export function credentialHash(plaintext: string): string {
  return sha256(plaintext.trim());
}

export function buildDemoRuntimeConfigDocument(
  providerId: string,
): ActiveRuntimeConfigResponseDto {
  const safetyPolicy = buildSafetyPolicy();
  const routingPolicy = buildRoutingPolicy();
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
    providers: [
      {
        providerId,
        provider: DEMO_PROVIDER,
        displayName: 'Mock Provider',
        status: 'active',
        baseUrl: DEMO_PROVIDER_BASE_URL,
        timeoutMs: 30000,
        secretRef: null,
        credentialPreview: null,
        resolver: 'none',
        models: [...DEMO_MODELS],
        failureMode: 'fail_closed',
      },
    ],
    models: [
      {
        provider: DEMO_PROVIDER,
        model: 'mock-fast',
        displayName: 'Mock Fast',
        status: 'active',
        contextWindowTokens: 8192,
        supportsStreaming: false,
        supportsJsonMode: false,
      },
      {
        provider: DEMO_PROVIDER,
        model: 'mock-balanced',
        displayName: 'Mock Balanced',
        status: 'active',
        contextWindowTokens: 8192,
        supportsStreaming: false,
        supportsJsonMode: false,
      },
    ],
    defaultProvider: DEMO_PROVIDER,
    defaultModel: 'mock-balanced',
    lowCostProvider: DEMO_PROVIDER,
    lowCostModel: 'mock-fast',
    fallbackProvider: DEMO_PROVIDER,
    fallbackModel: 'mock-balanced',
    rateLimit: {
      enabled: true,
      scope: 'application',
      algorithm: 'fixed_window',
      windowSeconds: 60,
      limit: 60,
    },
    safetyPolicy,
    cachePolicy: {
      enabled: true,
      type: 'exact',
      ttlSeconds: 3600,
    },
    routingPolicy,
    pricingRules: [
      {
        pricingRuleId: 'price_mock_mock-fast_v1',
        provider: DEMO_PROVIDER,
        model: 'mock-fast',
        pricingVersion: '2026-06-27.mock.v1',
        currency: 'USD',
        unit: 'token',
        promptTokenMicroUsd: 1,
        completionTokenMicroUsd: 2,
        effectiveAt: DEMO_GENERATED_AT,
      },
      {
        pricingRuleId: 'price_mock_mock-balanced_v1',
        provider: DEMO_PROVIDER,
        model: 'mock-balanced',
        pricingVersion: '2026-06-27.mock.v1',
        currency: 'USD',
        unit: 'token',
        promptTokenMicroUsd: 2,
        completionTokenMicroUsd: 3,
        effectiveAt: DEMO_GENERATED_AT,
      },
    ],
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

    const runtimeConfig = buildDemoRuntimeConfigDocument(provider.id);
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

function buildRoutingPolicy(): ActiveRuntimeConfigResponseDto['routingPolicy'] {
  const routingPolicyWithoutHash = {
    type: 'simple',
    autoModel: 'auto',
    defaultProvider: DEMO_PROVIDER,
    defaultModel: 'mock-balanced',
    lowCostProvider: DEMO_PROVIDER,
    lowCostModel: 'mock-fast',
    fallbackProvider: DEMO_PROVIDER,
    fallbackModel: 'mock-balanced',
    shortPromptMaxChars: 500,
  } as const;

  return {
    ...routingPolicyWithoutHash,
    routingPolicyHash: sha256(canonicalJson(routingPolicyWithoutHash)),
  };
}

function demoProviderConfig(): Prisma.InputJsonObject {
  return {
    models: [...DEMO_MODELS],
    failureMode: 'fail_closed',
  };
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return '';
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

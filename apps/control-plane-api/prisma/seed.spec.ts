import {
  PrismaClient,
  ResourceStatus,
  RuntimeConfigPublishState,
} from '@prisma/client';

import {
  buildDemoRuntimeConfigDocument,
  canonicalJsonForDemo,
  credentialHash,
  DEMO_APPLICATION_ID,
  DEMO_MOCK_PROVIDER_ID,
  DEMO_OPENAI_PROVIDER_ID,
  DEMO_PROJECT_ID,
  DEMO_RUNTIME_CONFIG_VERSION,
  DEMO_TENANT_ID,
  PROVIDER_PRESETS,
  seedDemoData,
} from './seed';

const EXPECTED_OPENAI_SEED_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
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
];

describe('Control Plane demo seed baseline', () => {
  it('builds a stable active Runtime Config for Gateway demo readiness', () => {
    const first = buildDemoRuntimeConfigDocument('provider-demo-id');
    const second = buildDemoRuntimeConfigDocument('provider-demo-id');

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe('gatelm.active-runtime-config.v2');
    expect(first.configVersion).toBe(DEMO_RUNTIME_CONFIG_VERSION);
    expect(first.publishState).toBe('active');
    expect(first.applicationId).toBe(DEMO_APPLICATION_ID);
    expect(first.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.safetyPolicy.securityPolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.routingPolicy.routingPolicyHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(first.providers[0]?.models).toEqual([
      'mock-fast',
      'mock-balanced',
    ]);
    expect(first.rateLimit).toEqual({
      enabled: true,
      scope: 'application',
      algorithm: 'fixed_window',
      windowSeconds: 60,
      limit: 60,
    });
  });

  it('does not put raw credentials or hashes into the runtime config document', () => {
    const runtimeConfig = buildDemoRuntimeConfigDocument('provider-demo-id');
    const serialized = JSON.stringify(runtimeConfig);

    expect(serialized).not.toContain('secretHash');
    expect(serialized).not.toContain('plaintext');
    expect(serialized).not.toContain('authorizationHeader');
    expect(serialized).not.toContain('rawCredential');
    expect(serialized).not.toContain('demo_only');
  });

  it('can build an actual-provider main path without storing raw provider keys', () => {
    const runtimeConfig = buildDemoRuntimeConfigDocument(DEMO_MOCK_PROVIDER_ID, {
      providerMode: 'actual',
      mockProviderId: DEMO_MOCK_PROVIDER_ID,
      openAIProviderId: DEMO_OPENAI_PROVIDER_ID,
    });
    const openAIProvider = runtimeConfig.providers.find(
      (provider) => provider.provider === 'openai-main',
    );
    const mockProvider = runtimeConfig.providers.find(
      (provider) => provider.provider === 'mock',
    );
    const serialized = JSON.stringify(runtimeConfig);

    expect(runtimeConfig.routingPolicy.mode).toBe('auto');
    expect(runtimeConfig.routingPolicy.bootstrapState).toBe('mock_bootstrap');
    expect(
      Object.values(runtimeConfig.routingPolicy.routes).flatMap((route) => [
        ...route.simple.modelRefs,
        ...route.complex.modelRefs,
      ]),
    ).toEqual(Array(10).fill('mock-balanced'));
    expect(runtimeConfig).not.toHaveProperty('defaultProvider');
    expect(openAIProvider).toMatchObject({
      providerId: DEMO_OPENAI_PROVIDER_ID,
      adapterType: 'openai_compatible',
      credentialRequired: true,
      credentialRef: {
        credentialRefId: `provider_credential:${DEMO_OPENAI_PROVIDER_ID}`,
        credentialVersion: 1,
        credentialState: 'active',
      },
      resolver: 'environment',
      adapterConfig: { requestFormat: 'openai_chat_completions' },
    });
    expect(openAIProvider?.models).toEqual(EXPECTED_OPENAI_SEED_MODELS);
    expect(
      runtimeConfig.models
        .filter((model) => model.provider === 'openai-main')
        .map((model) => model.model),
    ).toEqual(EXPECTED_OPENAI_SEED_MODELS);
    expect(
      runtimeConfig.pricingRules
        .filter((rule) => rule.provider === 'openai-main')
        .map((rule) => rule.model),
    ).toEqual(EXPECTED_OPENAI_SEED_MODELS);
    expect(mockProvider).toMatchObject({
      providerId: DEMO_MOCK_PROVIDER_ID,
      adapterType: 'mock',
      failureMode: 'fail_open_to_fallback',
    });
    expect(serialized).not.toContain('OPENAI_API_KEY');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer ');
  });

  it('hashes demo credentials after trimming surrounding whitespace', () => {
    expect(credentialHash('  synthetic_demo_secret  ')).toBe(
      credentialHash('synthetic_demo_secret'),
    );
  });

  it('canonicalizes undefined like JSON for arrays while omitting object fields', () => {
    expect(canonicalJsonForDemo({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJsonForDemo(['a', undefined, 'c'])).toBe(
      '["a",null,"c"]',
    );
  });

  it('supersedes older active runtime configs and upserts the demo active config', async () => {
    const tx = createMockTransaction();
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    await seedDemoData(client as unknown as PrismaClient);

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.runtimeConfig.updateMany).toHaveBeenCalledWith({
      where: {
        applicationId: DEMO_APPLICATION_ID,
        publishState: RuntimeConfigPublishState.ACTIVE,
        configVersion: { not: DEMO_RUNTIME_CONFIG_VERSION },
      },
      data: {
        publishState: RuntimeConfigPublishState.SUPERSEDED,
      },
    });
    expect(tx.runtimeConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationId_configVersion: {
            applicationId: DEMO_APPLICATION_ID,
            configVersion: DEMO_RUNTIME_CONFIG_VERSION,
          },
        },
        update: expect.objectContaining({
          publishState: RuntimeConfigPublishState.ACTIVE,
          document: expect.objectContaining({
            publishState: 'active',
            configVersion: DEMO_RUNTIME_CONFIG_VERSION,
          }),
        }),
        create: expect.objectContaining({
          applicationId: DEMO_APPLICATION_ID,
          publishState: RuntimeConfigPublishState.ACTIVE,
          document: expect.objectContaining({
            publishState: 'active',
            configVersion: DEMO_RUNTIME_CONFIG_VERSION,
          }),
        }),
      }),
    );
  });

  it('upserts global provider presets for common providers', async () => {
    const tx = createMockTransaction();
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    await seedDemoData(client as unknown as PrismaClient);

    expect(tx.providerPreset.updateMany).toHaveBeenCalledWith({
      where: {
        providerKey: { notIn: ['openai', 'gemini'] },
        status: ResourceStatus.ACTIVE,
      },
      data: { status: ResourceStatus.ARCHIVED },
    });
    expect(tx.providerPreset.upsert).toHaveBeenCalledTimes(
      PROVIDER_PRESETS.length,
    );
    expect(tx.providerPreset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerKey: 'openai' },
        create: expect.objectContaining({
          adapterType: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          credentialRequired: true,
          defaultResolver: 'environment',
          modelsEndpointPath: '/models',
          status: ResourceStatus.ACTIVE,
          providerConfig: expect.objectContaining({
            models: EXPECTED_OPENAI_SEED_MODELS,
          }),
        }),
      }),
    );
    expect(
      tx.providerPreset.upsert.mock.calls.map(
        ([args]) => args.create.providerKey,
      ),
    ).toEqual(['openai', 'gemini', 'claude']);
    expect(tx.providerPreset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerKey: 'claude' },
        create: expect.objectContaining({
          adapterType: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          status: ResourceStatus.DISABLED,
          providerConfig: expect.objectContaining({
            adapterType: 'anthropic',
            requestFormat: 'anthropic_messages',
          }),
        }),
      }),
    );
  });

  it('does not reject demo seed for a local AWS region setting alone', async () => {
    const tx = createMockTransaction();
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    await withEnv(
      {
        AWS_DEFAULT_REGION: 'ap-northeast-2',
        AWS_REGION: 'ap-northeast-2',
      },
      async () => {
        await seedDemoData(client as unknown as PrismaClient);
      },
    );

    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('connects the demo application to the mock provider in mock mode', async () => {
    const tx = createMockTransaction();
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    await seedDemoData(client as unknown as PrismaClient);

    expect(tx.applicationProviderConnection.upsert).toHaveBeenCalledTimes(1);
    expect(tx.applicationProviderConnection.upsert).toHaveBeenCalledWith({
      where: {
        applicationId_providerConnectionId: {
          applicationId: DEMO_APPLICATION_ID,
          providerConnectionId: DEMO_MOCK_PROVIDER_ID,
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
        providerConnectionId: DEMO_MOCK_PROVIDER_ID,
      },
    });
  });

  it('upserts the OpenAI-compatible provider when actual demo mode is enabled', async () => {
    const tx = createMockTransaction();
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    await withEnv({ GATELM_DEMO_PROVIDER_MODE: 'actual' }, async () => {
      await seedDemoData(client as unknown as PrismaClient);
    });

    expect(tx.providerConnection.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: '00000000-0000-4000-8000-000000000100',
        provider: 'openai-main',
      },
    });
    expect(tx.providerConnection.create).toHaveBeenCalledTimes(2);
    expect(tx.providerConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: DEMO_OPENAI_PROVIDER_ID,
          projectId: null,
          provider: 'openai-main',
          resolver: 'environment',
          secretRef: `provider_credential:${DEMO_OPENAI_PROVIDER_ID}`,
          providerConfig: expect.objectContaining({
            adapterType: 'openai_compatible',
            requestFormat: 'openai_chat_completions',
            credentialRequired: true,
            models: EXPECTED_OPENAI_SEED_MODELS,
          }),
        }),
      }),
    );
    expect(tx.runtimeConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          document: expect.objectContaining({
            schemaVersion: 'gatelm.active-runtime-config.v2',
            routingPolicy: expect.objectContaining({
              schemaVersion: 'gatelm.routing-policy.v2',
              mode: 'auto',
              bootstrapState: 'mock_bootstrap',
            }),
          }),
        }),
      }),
    );
    expect(tx.applicationProviderConnection.upsert).toHaveBeenCalledTimes(2);
    expect(tx.applicationProviderConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationId_providerConnectionId: {
            applicationId: DEMO_APPLICATION_ID,
            providerConnectionId: DEMO_MOCK_PROVIDER_ID,
          },
        },
      }),
    );
    expect(tx.applicationProviderConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationId_providerConnectionId: {
            applicationId: DEMO_APPLICATION_ID,
            providerConnectionId: DEMO_OPENAI_PROVIDER_ID,
          },
        },
      }),
    );
  });
});

function createMockTransaction() {
  return {
    tenant: { upsert: jest.fn() },
    project: { upsert: jest.fn() },
    application: { upsert: jest.fn() },
    providerPreset: { updateMany: jest.fn(), upsert: jest.fn() },
    providerConnection: {
      create: jest.fn((args: { data: { id?: string } }) =>
        Promise.resolve({ id: args.data.id ?? 'provider-demo-id' }),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve({ id: args.where.id }),
      ),
    },
    applicationProviderConnection: {
      upsert: jest.fn(),
    },
    gatewayApiKey: { upsert: jest.fn() },
    appToken: { upsert: jest.fn() },
    runtimeConfig: {
      updateMany: jest.fn(),
      upsert: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000701',
        configVersion: DEMO_RUNTIME_CONFIG_VERSION,
        publishedAt: new Date('2026-06-27T02:00:00.000Z'),
      }),
    },
    runtimeSnapshot: {
      upsert: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000701',
      }),
    },
    activeRuntimeSnapshot: {
      upsert: jest.fn(),
    },
  };
}

async function withEnv(
  values: Record<string, string>,
  callback: () => Promise<void>,
): Promise<void> {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, values);
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

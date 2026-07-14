import { InternalServerErrorException } from '@nestjs/common';
import {
  CredentialStatus,
  ProviderConnectionStatus,
  ResourceStatus,
  RuntimeConfigPublishState,
} from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ActiveRuntimeConfigResponseDto,
  RuntimeSnapshotResponseDto,
} from './dto/runtime-config.dto';
import { RuntimeConfigsService } from './runtime-configs.service';

describe('RuntimeConfigsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const applicationId = '00000000-0000-4000-8000-000000000300';
  const apiKeyId = '00000000-0000-4000-8000-000000000400';
  const appTokenId = '00000000-0000-4000-8000-000000000500';
  const providerId = '00000000-0000-4000-8000-000000000600';
  const now = new Date('2026-06-27T02:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createService(): {
    service: RuntimeConfigsService;
    prisma: {
      application: { findUnique: jest.Mock };
      gatewayApiKey: { findFirst: jest.Mock; findUnique: jest.Mock };
      appToken: { findFirst: jest.Mock; findUnique: jest.Mock };
      providerConnection: { findMany: jest.Mock };
      applicationProviderConnection: { findMany: jest.Mock };
      runtimeConfig: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
      runtimeSnapshot: {
        create: jest.Mock;
        findUnique: jest.Mock;
      };
      activeRuntimeSnapshot: {
        findUnique: jest.Mock;
        upsert: jest.Mock;
      };
      $transaction: jest.Mock;
    };
  } {
    const prisma = {
      application: {
        findUnique: jest.fn(),
      },
      gatewayApiKey: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      appToken: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      providerConnection: {
        findMany: jest.fn(),
      },
      applicationProviderConnection: {
        findMany: jest.fn(),
      },
      runtimeConfig: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      runtimeSnapshot: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      activeRuntimeSnapshot: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    return {
      service: new RuntimeConfigsService(
        prisma as unknown as PrismaService,
      ),
      prisma,
    };
  }

  it('creates a draft runtime config without exposing raw credential material', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const result = await service.upsertDraft(applicationId, {
      rateLimit: { limit: 30 },
      budgetPolicy: {
        enabled: true,
        enforcementMode: 'warn',
        warningThresholdPercent: 70,
      },
      cachePolicy: { ttlSeconds: 120 },
      promptCapturePolicy: {
        enabled: true,
        mode: 'log_safe_full',
        maxChars: 1200,
      },
      responseCapturePolicy: {
        enabled: true,
        mode: 'raw_full',
        maxChars: 1600,
      },
    });

    expect(prisma.runtimeConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId,
          publishState: RuntimeConfigPublishState.DRAFT,
          publishedAt: null,
        }),
      }),
    );
    expect(result.publishState).toBe('draft');
    expect(result.runtimeConfig.publishState).toBe('draft');
    expect(result.runtimeConfig.rateLimit.limit).toBe(30);
    expect(result.runtimeConfig.budgetPolicy).toEqual({
      enabled: true,
      enforcementMode: 'warn',
      warningThresholdPercent: 70,
    });
    expect(result.runtimeConfig.cachePolicy.ttlSeconds).toBe(120);
    expect(result.runtimeConfig.promptCapturePolicy).toEqual({
      enabled: true,
      mode: 'log_safe_full',
      maxChars: 1200,
    });
    expect(result.runtimeConfig.responseCapturePolicy).toEqual({
      enabled: true,
      mode: 'raw_full',
      maxChars: 1600,
    });
    expect(result.runtimeConfig.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('secretHash');
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('a'.repeat(64));
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('b'.repeat(64));
  });

  it('rejects draft runtime configs that disable mandatory safety detectors', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        safetyPolicy: {
          detectors: [
            {
              type: 'api_key',
              enabled: false,
              action: 'block',
              placeholder: '[API_KEY_REDACTED]',
            },
          ],
        },
      }),
    ).rejects.toThrow(
      'Safety detector api_key is mandatory and cannot be disabled.',
    );
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
  });

  it('normalizes legacy stored credential resolver for runtime configs', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {
      credentialLast4: '1234',
      credentialPrefix: 'provided_',
      resolver: 'credential_store',
      secretRef: `provider_credential:${providerId}`,
    });
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const result = await service.upsertDraft(applicationId, {});

    expect(result.runtimeConfig.providers[0]?.resolver).toBe(
      'control_plane_secret_store',
    );
  });

  it('accepts optional v2 safety detector categories in draft configs', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const optionalDetectorTypes = [
      'email',
      'phone_number',
      'person_name',
      'postal_address',
      'organization_name',
    ] as const;

    const result = await service.upsertDraft(applicationId, {
      safetyPolicy: {
        detectors: optionalDetectorTypes.map((type) => ({
          type,
          enabled: true,
          action: 'redact',
          placeholder: `[${type.toUpperCase()}_REDACTED]`,
        })),
      },
    });

    expect(
      result.runtimeConfig.safetyPolicy.detectors.map(
        (detector) => detector.type,
      ),
    ).toEqual([...optionalDetectorTypes]);
    expect(result.runtimeConfig.safetyPolicy.detectors).toEqual(
      optionalDetectorTypes.map((type) =>
        expect.objectContaining({
          type,
          enabled: true,
          action: 'redact',
        }),
      ),
    );
  });

  it('stores the complete v2 routing matrix with opaque catalog model refs', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {
      providerConfig: { models: ['mock-fast', 'mock-balanced', 'mock-smart'] },
    });
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const result = await service.upsertDraft(applicationId, {
      routingPolicy: {
        mode: 'auto',
        routes: routingRoutes(`${providerId}:mock-smart`),
      },
    });

    expect(result.runtimeConfig.schemaVersion).toBe(
      'gatelm.active-runtime-config.v2',
    );
    expect(result.runtimeConfig.routingPolicy).toEqual({
      schemaVersion: 'gatelm.routing-policy.v2',
      mode: 'auto',
      bootstrapState: 'mock_bootstrap',
      routes: routingRoutes(`${providerId}:mock-smart`),
      routingPolicyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(result.runtimeConfig).not.toHaveProperty('defaultModel');
    expect(result.runtimeConfig.routingPolicy).not.toHaveProperty(
      'highQualityModel',
    );
    expect(result.runtimeConfig.routingPolicy.routingPolicyHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it('accepts global Simple and Complex roles with one shared fallback', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {
      providerConfig: { models: ['mock-fast', 'mock-smart'] },
    });
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );
    const routes = routingRoleRoutes(
      `${providerId}:mock-fast`,
      `${providerId}:mock-smart`,
      'mock-balanced',
    );

    const result = await service.upsertDraft(applicationId, {
      routingPolicy: { mode: 'auto', routes },
    });

    expect(result.runtimeConfig.routingPolicy.routes).toEqual(routes);
  });

  it('uses the reserved mock model for all ten cells when no policy exists', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const result = await service.upsertDraft(applicationId, {});

    expect(result.runtimeConfig.routingPolicy.bootstrapState).toBe(
      'mock_bootstrap',
    );
    expect(result.runtimeConfig.routingPolicy.routes).toEqual(
      routingRoutes('mock-balanced'),
    );
  });

  it('preserves custom mock-balanced settings for a registered mock provider', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const result = await service.upsertDraft(applicationId, {
      models: [
        {
          provider: 'mock',
          model: 'mock-balanced',
          displayName: 'Custom Mock Balanced',
          status: 'active',
          contextWindowTokens: 32768,
          supportsStreaming: true,
          supportsJsonMode: true,
        },
      ],
      routingPolicy: {
        mode: 'auto',
        routes: routingRoutes('mock-balanced'),
      },
    });

    expect(result.runtimeConfig.models).toEqual([
      {
        provider: 'mock',
        model: 'mock-balanced',
        displayName: 'Custom Mock Balanced',
        status: 'active',
        contextWindowTokens: 32768,
        supportsStreaming: true,
        supportsJsonMode: true,
      },
    ]);
    expect(result.runtimeConfig.providers).toContainEqual(
      expect.objectContaining({
        provider: 'mock',
        models: ['mock-balanced'],
      }),
    );
  });

  it('publishes a resolvable built-in mock target when a tenant only has real providers', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.providerConnection.findMany.mockResolvedValue([
      {
        id: providerId,
        tenantId,
        projectId,
        provider: 'openai-main',
        displayName: 'OpenAI Main',
        status: ProviderConnectionStatus.ACTIVE,
        baseUrl: 'https://api.openai.example/v1',
        timeoutMs: 30000,
        secretRef: 'secret/provider/openai-main',
        credentialPrefix: 'sk_',
        credentialLast4: '9xA1',
        resolver: 'none',
        providerConfig: { models: ['gpt-4o'] },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const draft = await service.upsertDraft(applicationId, {});

    expect(draft.runtimeConfig.routingPolicy.routes).toEqual(
      routingRoutes('mock-balanced'),
    );
    expect(draft.runtimeConfig.providers).toContainEqual(
      expect.objectContaining({
        providerId: '00000000-0000-4000-8000-000000000001',
        provider: 'mock',
        adapterType: 'mock',
        credentialRequired: false,
        models: ['mock-balanced'],
      }),
    );
    expect(draft.runtimeConfig.models).toContainEqual(
      expect.objectContaining({
        provider: 'mock',
        model: 'mock-balanced',
        status: 'active',
      }),
    );

    const tx = {
      runtimeConfig: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      runtimeSnapshot: {
        create: jest.fn(),
      },
      activeRuntimeSnapshot: {
        upsert: jest.fn(),
      },
    };
    tx.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(draft.runtimeConfig, {
        id: draft.id,
        publishState: RuntimeConfigPublishState.DRAFT,
      }),
    );
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const published = await service.publishRuntimeConfig(applicationId, {
      configVersion: 'runtime_config_real_provider_with_builtin_mock_001',
    });

    expect(published.publishState).toBe('active');
    expect(published.routingPolicy.routes).toEqual(
      routingRoutes('mock-balanced'),
    );
    expect(tx.runtimeSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          snapshotBody: expect.objectContaining({
            schemaVersion: 'gatelm.runtime-snapshot.v2',
            policies: expect.objectContaining({
              routing: expect.objectContaining({
                routes: routingRoutes('mock-balanced'),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('preserves provider preset model capabilities in generated runtime models', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {
      provider: 'groq-main',
      displayName: 'Groq Main',
      baseUrl: 'https://api.groq.com/openai/v1',
      providerConfig: {
        adapterType: 'openai_compatible',
        models: ['llama-3.1-8b-instant'],
        modelMetadata: {
          'llama-3.1-8b-instant': {
            contextWindowTokens: 2_000_000,
            displayName: 'Llama 3.1 8B Instant',
            supportsJsonMode: true,
            supportsStreaming: true,
          },
        },
        providerFamily: 'groq',
      },
    });
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    const result = await service.upsertDraft(applicationId, {});

    expect(result.runtimeConfig.models).toContainEqual({
      provider: 'groq-main',
      model: 'llama-3.1-8b-instant',
      displayName: 'Llama 3.1 8B Instant',
      status: 'active',
      contextWindowTokens: 2_000_000,
      supportsStreaming: true,
      supportsJsonMode: true,
    });
  });

  it('normalizes legacy routing roles for reads without persisting', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const base = activeRuntimeConfigDocument();
    const current = {
      ...base,
      providers: base.providers.map((provider) => ({
        ...provider,
        models: ['mock-default', 'mock-fast', 'mock-premium', 'mock-fallback'],
      })),
      models: [
        'mock-default',
        'mock-fast',
        'mock-premium',
        'mock-fallback',
      ].map((model) => ({
        ...base.models[0]!,
        model,
        displayName: model,
      })),
    };
    const legacyDocument = {
      ...current,
      schemaVersion: 'gatelm.active-runtime-config.v1',
      defaultProvider: 'mock',
      defaultModel: 'mock-default',
      lowCostProvider: 'mock',
      lowCostModel: 'mock-fast',
      highQualityProvider: 'mock',
      highQualityModel: 'mock-premium',
      fallbackProvider: 'mock',
      fallbackModel: 'mock-fallback',
      routingPolicy: {
        type: 'simple',
        autoModel: 'auto',
        defaultProvider: 'mock',
        defaultModel: 'mock-default',
        lowCostProvider: 'mock',
        lowCostModel: 'mock-fast',
        highQualityProvider: 'mock',
        highQualityModel: 'mock-premium',
        fallbackProvider: 'mock',
        fallbackModel: 'mock-fallback',
        shortPromptMaxChars: 500,
        routingPolicyHash: 'e'.repeat(64),
      },
    };
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(legacyDocument as unknown as ActiveRuntimeConfigResponseDto),
    );

    const result = await service.getRuntimeConfigHistoryDetail(
      applicationId,
      current.configVersion,
    );

    expect(result.runtimeConfig.routingPolicy.routes).toEqual(
      routingRoleRoutes(
        `${providerId}:mock-fast`,
        `${providerId}:mock-premium`,
        `${providerId}:mock-fallback`,
      ),
    );
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('lowCostModel');
    expect(JSON.stringify(result.runtimeConfig)).not.toContain(
      'highQualityModel',
    );
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('fallbackModel');
    expect(result.item.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed stored v2 routing policy instead of treating it as legacy', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const malformedV2 = {
      ...activeRuntimeConfigDocument(),
      routingPolicy: {
        ...activeRuntimeConfigDocument().routingPolicy,
        routingPolicyHash: 'not-a-canonical-hash',
      },
    };
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(malformedV2),
    );

    await expect(
      service.getRuntimeConfigHistoryDetail(
        applicationId,
        malformedV2.configVersion,
      ),
    ).rejects.toThrow('Runtime Config routing policy v2 is invalid.');
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
  });

  it('publishes a draft as the single active runtime config snapshot', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );
    const draft = await service.upsertDraft(applicationId, {
      routingPolicy: {
        mode: 'auto',
        routes: routingRoutes('mock-balanced'),
      },
    });
    const tx = {
      runtimeConfig: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      runtimeSnapshot: {
        create: jest.fn(),
      },
      activeRuntimeSnapshot: {
        upsert: jest.fn(),
      },
    };
    tx.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );

    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(draft.runtimeConfig, {
        id: draft.id,
        publishState: RuntimeConfigPublishState.DRAFT,
      }),
    );
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.publishRuntimeConfig(applicationId, {
      configVersion: 'runtime_config_test_001',
    });

    expect(tx.runtimeConfig.updateMany).toHaveBeenCalledWith({
      where: {
        applicationId,
        publishState: RuntimeConfigPublishState.ACTIVE,
      },
      data: {
        publishState: RuntimeConfigPublishState.SUPERSEDED,
      },
    });
    expect(tx.runtimeConfig).not.toHaveProperty('update');
    expect(tx.runtimeConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId,
          configVersion: 'runtime_config_test_001',
          publishState: RuntimeConfigPublishState.ACTIVE,
          publishedAt: now,
        }),
      }),
    );
    expect(tx.runtimeSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          projectId,
          applicationId,
          runtimeConfigId: '00000000-0000-4000-8000-000000000700',
          version: BigInt(1),
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          snapshotBody: expect.objectContaining({
            runtimeSnapshotId: '00000000-0000-4000-8000-000000000700',
            runtimeSnapshotVersion: 1,
            runtimeState: 'snapshot_active',
          }),
          publishedAt: now,
          publishedBy: 'control_plane',
        }),
      }),
    );
    expect(tx.activeRuntimeSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_projectId_applicationId: {
            tenantId,
            projectId,
            applicationId,
          },
        },
        update: expect.objectContaining({
          runtimeSnapshotId: '00000000-0000-4000-8000-000000000700',
          updatedBy: 'control_plane',
        }),
        create: expect.objectContaining({
          tenantId,
          projectId,
          applicationId,
          runtimeSnapshotId: '00000000-0000-4000-8000-000000000700',
          updatedBy: 'control_plane',
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
      }),
    );
    expect(result.configVersion).toBe('runtime_config_test_001');
    expect(result.publishState).toBe('active');
    expect(result.schemaVersion).toBe('gatelm.active-runtime-config.v2');
    expect(result.providers[0]?.credentialRef).toEqual({
      credentialRefId: 'secret/provider/mock',
      credentialVersion: 1,
      credentialState: 'active',
    });
    expect(result.providers[0]?.secretRef).toBe('secret/provider/mock');
    expect(JSON.stringify(result)).not.toContain('secretHash');
  });

  it('lists runtime config history without returning full runtime documents', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    const supersededDocument = {
      ...activeRuntimeConfigDocument(),
      configVersion: 'runtime_config_previous',
      configHash: 'd'.repeat(64),
    };
    const draftDocument = {
      ...activeRuntimeConfigDocument(),
      configVersion: 'draft',
      configHash: 'e'.repeat(64),
      publishState: 'draft' as const,
    };
    prisma.runtimeConfig.findMany.mockResolvedValue([
      runtimeConfigRecord(activeDocument, {
        id: '00000000-0000-4000-8000-000000000701',
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
      runtimeConfigRecord(supersededDocument, {
        id: '00000000-0000-4000-8000-000000000702',
        publishState: RuntimeConfigPublishState.SUPERSEDED,
        publishedAt: new Date('2026-06-27T01:00:00.000Z'),
      }),
      runtimeConfigRecord(draftDocument as ActiveRuntimeConfigResponseDto, {
        id: '00000000-0000-4000-8000-000000000703',
        publishState: RuntimeConfigPublishState.DRAFT,
        publishedAt: null,
      }),
    ]);

    const result = await service.listRuntimeConfigHistory(applicationId, {
      limit: 2,
    });

    expect(prisma.runtimeConfig.findMany).toHaveBeenCalledWith({
      where: { applicationId },
      select: {
        id: true,
        configVersion: true,
        configHash: true,
        publishState: true,
        effectiveAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: 3,
    });
    expect(result).toEqual({
      applicationId,
      items: [
        expect.objectContaining({
          configVersion: 'runtime_config_test_001',
          publishState: 'active',
          canRollback: false,
        }),
        expect.objectContaining({
          configVersion: 'runtime_config_previous',
          publishState: 'superseded',
          canRollback: true,
        }),
      ],
      pagination: {
        limit: 2,
        nextCursor: '00000000-0000-4000-8000-000000000702',
        hasMore: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret/provider/mock');
    expect(JSON.stringify(result)).not.toContain('providers');
  });

  it('returns runtime config history detail with the sanitized policy document', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const supersededDocument = {
      ...activeRuntimeConfigDocument(),
      configVersion: 'runtime_config_previous',
      configHash: 'd'.repeat(64),
      budgetPolicy: {
        enabled: true,
        enforcementMode: 'warn' as const,
        warningThresholdPercent: 75,
      },
    };
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(supersededDocument, {
        id: '00000000-0000-4000-8000-000000000702',
        publishState: RuntimeConfigPublishState.SUPERSEDED,
        publishedAt: new Date('2026-06-27T01:00:00.000Z'),
      }),
    );

    const result = await service.getRuntimeConfigHistoryDetail(
      applicationId,
      'runtime_config_previous',
    );

    expect(prisma.runtimeConfig.findUnique).toHaveBeenCalledWith({
      where: {
        applicationId_configVersion: {
          applicationId,
          configVersion: 'runtime_config_previous',
        },
      },
      select: {
        id: true,
        configVersion: true,
        configHash: true,
        publishState: true,
        document: true,
        effectiveAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result.item).toEqual(
      expect.objectContaining({
        configVersion: 'runtime_config_previous',
        publishState: 'superseded',
        canRollback: true,
      }),
    );
    expect(result.runtimeConfig).toEqual(
      expect.objectContaining({
        configVersion: 'runtime_config_previous',
        publishState: 'superseded',
        budgetPolicy: {
          enabled: true,
          enforcementMode: 'warn',
          warningThresholdPercent: 75,
        },
      }),
    );
    expect(result.runtimeConfig.providers[0]?.credentialRef).toEqual({
      credentialRefId: `provider_credential:${providerId}`,
      credentialVersion: 1,
      credentialState: 'active',
    });
    expect(JSON.stringify(result)).not.toContain('secretHash');
    expect(JSON.stringify(result)).not.toContain('rawProviderKey');
  });

  it('returns not found for a missing runtime config history detail', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);

    await expect(
      service.getRuntimeConfigHistoryDetail(
        applicationId,
        'runtime_config_missing',
      ),
    ).rejects.toThrow('Runtime Config history item not found.');
  });

  it('rejects malformed runtime config history detail versions before lookup', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.getRuntimeConfigHistoryDetail(applicationId, 'bad/version'),
    ).rejects.toThrow('Runtime Config history item not found.');
    expect(prisma.runtimeConfig.findUnique).not.toHaveBeenCalled();
  });

  it('rolls back by creating a new active runtime config from a previous published version', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const targetDocument = {
      ...activeRuntimeConfigDocument(),
      configVersion: 'runtime_config_previous',
      configHash: 'd'.repeat(64),
      budgetPolicy: {
        enabled: true,
        enforcementMode: 'block' as const,
        warningThresholdPercent: 70,
      },
    };
    const tx = {
      runtimeConfig: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      runtimeSnapshot: {
        create: jest.fn(),
      },
      activeRuntimeSnapshot: {
        upsert: jest.fn(),
      },
    };
    tx.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(targetDocument, {
        id: '00000000-0000-4000-8000-000000000702',
        configVersion: 'runtime_config_previous',
        publishState: RuntimeConfigPublishState.SUPERSEDED,
        publishedAt: new Date('2026-06-27T01:00:00.000Z'),
      }),
    );
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.rollbackRuntimeConfig(applicationId, {
      targetConfigVersion: 'runtime_config_previous',
      rollbackConfigVersion: 'runtime_config_rollback_manual',
    });

    expect(tx.runtimeConfig.updateMany).toHaveBeenCalledWith({
      where: {
        applicationId,
        publishState: RuntimeConfigPublishState.ACTIVE,
      },
      data: {
        publishState: RuntimeConfigPublishState.ROLLED_BACK,
      },
    });
    expect(tx.runtimeConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId,
          configVersion: 'runtime_config_rollback_manual',
          publishState: RuntimeConfigPublishState.ACTIVE,
          publishedAt: now,
        }),
      }),
    );
    expect(tx.runtimeSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          projectId,
          applicationId,
          runtimeConfigId: '00000000-0000-4000-8000-000000000700',
          version: BigInt(now.getTime()),
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          snapshotBody: expect.objectContaining({
            runtimeSnapshotId: '00000000-0000-4000-8000-000000000700',
            runtimeSnapshotVersion: now.getTime(),
            runtimeState: 'snapshot_active',
          }),
          publishedAt: now,
          publishedBy: 'control_plane',
        }),
      }),
    );
    expect(tx.activeRuntimeSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_projectId_applicationId: {
            tenantId,
            projectId,
            applicationId,
          },
        },
        update: expect.objectContaining({
          runtimeSnapshotId: '00000000-0000-4000-8000-000000000700',
          updatedBy: 'control_plane',
        }),
        create: expect.objectContaining({
          tenantId,
          projectId,
          applicationId,
          runtimeSnapshotId: '00000000-0000-4000-8000-000000000700',
          updatedBy: 'control_plane',
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
      }),
    );
    const createdDocument = tx.runtimeConfig.create.mock.calls[0][0].data
      .document as ActiveRuntimeConfigResponseDto;
    expect(result.configVersion).toBe('runtime_config_rollback_manual');
    expect(result.effectiveAt).toBe(now.toISOString());
    expect(result.budgetPolicy).toEqual({
      enabled: true,
      enforcementMode: 'block',
      warningThresholdPercent: 70,
    });
    expect(createdDocument.configVersion).toBe(
      'runtime_config_rollback_manual',
    );
    expect(createdDocument.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(createdDocument)).not.toContain('secretHash');
  });

  it('rejects rollback to a draft or current active runtime config', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValueOnce(
      runtimeConfigRecord(
        { ...activeRuntimeConfigDocument(), publishState: 'draft' },
        {
          publishState: RuntimeConfigPublishState.DRAFT,
        },
      ),
    );
    prisma.runtimeConfig.findUnique.mockResolvedValueOnce(
      runtimeConfigRecord(activeRuntimeConfigDocument(), {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.rollbackRuntimeConfig(applicationId, {
        targetConfigVersion: 'draft',
      }),
    ).rejects.toThrow(
      'Runtime Config rollback target must be a previous published version.',
    );
    await expect(
      service.rollbackRuntimeConfig(applicationId, {
        targetConfigVersion: 'runtime_config_test_001',
      }),
    ).rejects.toThrow(
      'Runtime Config rollback target must be a previous published version.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects rollback when the target runtime config document is not executable', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const targetDocument = activeRuntimeConfigDocument() as unknown as Record<
      string,
      unknown
    >;
    targetDocument.configVersion = 'runtime_config_broken_previous';
    targetDocument.budgetPolicy = { enabled: true };
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(
        targetDocument as unknown as ActiveRuntimeConfigResponseDto,
        {
          configVersion: 'runtime_config_broken_previous',
          publishState: RuntimeConfigPublishState.SUPERSEDED,
          publishedAt: new Date('2026-06-27T01:00:00.000Z'),
        },
      ),
    );

    await expect(
      service.rollbackRuntimeConfig(applicationId, {
        targetConfigVersion: 'runtime_config_broken_previous',
      }),
    ).rejects.toThrow('Active Runtime Config is not executable.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects publish when a selected provider is missing required credential binding', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {
      resolver: 'environment',
      secretRef: null,
    });
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    prisma.runtimeConfig.create.mockImplementation(({ data }) =>
      Promise.resolve(runtimeConfigRecord(data.document, data)),
    );
    const draft = await service.upsertDraft(applicationId, {});

    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(draft.runtimeConfig, {
        id: draft.id,
        publishState: RuntimeConfigPublishState.DRAFT,
      }),
    );

    await expect(
      service.publishRuntimeConfig(applicationId, {
        configVersion: 'runtime_config_test_002',
      }),
    ).rejects.toThrow(
      'RuntimeSnapshot publish validation failed: provider credential binding is missing.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the active runtime config document directly', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    const result = await service.getActiveRuntimeConfig(applicationId);

    expect(prisma.runtimeConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationId,
          publishState: RuntimeConfigPublishState.ACTIVE,
        },
      }),
    );
    expect(prisma.application.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: applicationId },
      }),
    );
    expect(prisma.gatewayApiKey.findUnique).toHaveBeenCalledWith({
      where: { id: apiKeyId },
    });
    expect(prisma.appToken.findUnique).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ...activeDocument,
        models: expect.arrayContaining(activeDocument.models),
        routingPolicy: expect.objectContaining({
          schemaVersion: 'gatelm.routing-policy.v2',
          mode: 'auto',
          routes: activeDocument.routingPolicy.routes,
          routingPolicyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(result).not.toHaveProperty('defaultModel');
  });

  it('returns an active RuntimeSnapshot execution view without copying legacy secret refs', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = {
      ...activeRuntimeConfigDocument(),
      promptCapturePolicy: {
        enabled: true,
        mode: 'log_safe_full' as const,
        maxChars: 1200,
      },
      responseCapturePolicy: {
        enabled: true,
        mode: 'raw_full' as const,
        maxChars: 1600,
      },
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.runtimeSnapshotId).toBe(
      '00000000-0000-4000-8000-000000000700',
    );
    expect(result.runtimeSnapshotVersion).toBe(1);
    expect(result.runtimeState).toBe('snapshot_active');
    expect(result.lookupKey).toEqual({
      tenantId,
      projectId,
      applicationId,
    });
    expect(result.lookupKey).not.toHaveProperty('budgetScopeId');
    expect(result.budgetResolution).toEqual({
      budgetScopeType: 'application',
      budgetScopeId: applicationId,
      resolvedBy: 'default_application',
      warningThresholdPercent: 80,
    });
    expect(result.providerCatalogRef.catalogVersion).toBe(1);
    expect(result.providerCatalogRef.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.contentHash).not.toBe(activeDocument.configHash);
    expect(result.policies.budget).toEqual({
      enabled: false,
      enforcementMode: 'disabled',
      warningThresholdPercent: 80,
    });
    expect(result.schemaVersion).toBe('gatelm.runtime-snapshot.v2');
    expect(result.policies.routing.mode).toBe('auto');
    expect(result.policies.routing.routes).toEqual(
      routingRoutes(`${providerId}:mock-fast`),
    );
    expect(result.policies.safety.requestSideRequired).toBe(true);
    expect(result.policies.promptCapture).toEqual({
      enabled: true,
      mode: 'log_safe_full',
      maxChars: 1200,
    });
    expect(result.policies.responseCapture).toEqual({
      enabled: true,
      mode: 'raw_full',
      maxChars: 1600,
    });
    expect(result.legacyHashes).toEqual({
      configHash: activeDocument.configHash,
      securityPolicyHash: activeDocument.safetyPolicy.securityPolicyHash,
      routingPolicyHash: result.policies.routing.routingPolicyHash,
    });
    expect(JSON.stringify(result)).not.toContain('secret/provider/mock');
    expect(JSON.stringify(result)).not.toContain('secretHash');
  });

  it('returns the persisted active RuntimeSnapshot before falling back to Runtime Config', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const snapshotBody = runtimeSnapshotBody();
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(snapshotBody),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result).toEqual(snapshotBody);
    expect(prisma.activeRuntimeSnapshot.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_projectId_applicationId: {
          tenantId,
          projectId,
          applicationId,
        },
      },
      include: {
        runtimeSnapshot: {
          include: {
            runtimeConfig: true,
          },
        },
      },
    });
    expect(prisma.runtimeConfig.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secretHash');
  });

  it('computes a v2 RuntimeSnapshot from a linked Runtime Config for persisted v1 bodies', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    const runtimeConfig = runtimeConfigRecord(activeDocument, {
      publishState: RuntimeConfigPublishState.ACTIVE,
      publishedAt: now,
    });
    const snapshotBody = {
      ...runtimeSnapshotBody(),
      schemaVersion: 'gatelm.runtime-snapshot.v1',
    } as unknown as RuntimeSnapshotResponseDto;
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(snapshotBody, {
        runtimeSnapshot: { runtimeConfig },
      }),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.schemaVersion).toBe('gatelm.runtime-snapshot.v2');
    expect(result.runtimeSnapshotId).toBe(snapshotBody.runtimeSnapshotId);
    expect(result.runtimeSnapshotVersion).toBe(
      snapshotBody.runtimeSnapshotVersion,
    );
    expect(result.policies.routing.routes).toEqual(
      activeDocument.routingPolicy.routes,
    );
    expect(prisma.runtimeSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.activeRuntimeSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
  });

  it('falls back from invalid legacy role models without keeping a duplicate fallback', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const current = activeRuntimeConfigDocument();
    const legacyDocument = {
      ...current,
      schemaVersion: 'gatelm.active-runtime-config.v1',
      defaultProvider: 'mock',
      defaultModel: 'mock-fast',
      lowCostProvider: 'missing-provider',
      lowCostModel: 'missing-model',
      highQualityProvider: 'missing-provider',
      highQualityModel: 'missing-model',
      fallbackProvider: 'mock',
      fallbackModel: 'mock-fast',
      routingPolicy: undefined,
    };
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(
        legacyDocument as unknown as ActiveRuntimeConfigResponseDto,
      ),
    );

    const result = await service.getRuntimeConfigHistoryDetail(
      applicationId,
      current.configVersion,
    );

    expect(result.runtimeConfig.routingPolicy.routes).toEqual(
      routingRoutes(`${providerId}:mock-fast`),
    );
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
  });

  it('keeps wider persisted v2 routing policies readable before explicit conversion', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const current = activeRuntimeConfigDocument();
    const advancedRoutes = routingRoutes(`${providerId}:mock-fast`);
    advancedRoutes.code.simple.modelRefs = [
      `${providerId}:mock-balanced`,
      `${providerId}:mock-fallback-1`,
      `${providerId}:mock-fallback-2`,
    ];
    const persistedAdvanced = {
      ...current,
      routingPolicy: {
        ...current.routingPolicy,
        routes: advancedRoutes,
      },
    };
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(persistedAdvanced),
    );

    const result = await service.getRuntimeConfigHistoryDetail(
      applicationId,
      current.configVersion,
    );

    expect(result.runtimeConfig.routingPolicy.routes).toEqual(advancedRoutes);
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
  });

  it('does not invent a Runtime Config when a persisted v1 snapshot has no linked config', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const snapshotBody = {
      ...runtimeSnapshotBody(),
      schemaVersion: 'gatelm.runtime-snapshot.v1',
    } as unknown as RuntimeSnapshotResponseDto;
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(snapshotBody),
    );

    await expect(
      service.getActiveRuntimeSnapshot(applicationId),
    ).rejects.toThrow('RuntimeSnapshot body is inconsistent.');
    expect(prisma.runtimeConfig.findFirst).not.toHaveBeenCalled();
  });

  it('fails with an internal error when the active snapshot pointer references another application', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const snapshotBody = runtimeSnapshotBody();
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(snapshotBody, {
        runtimeSnapshot: {
          applicationId: '00000000-0000-4000-8000-000000000399',
        },
      }),
    );

    const result = service.getActiveRuntimeSnapshot(applicationId);

    await expect(result).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(result).rejects.toThrow(
      'RuntimeSnapshot body is inconsistent.',
    );
  });

  it('fails with an internal error when persisted RuntimeSnapshot metadata is inconsistent', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const snapshotBody = runtimeSnapshotBody();
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(snapshotBody, {
        runtimeSnapshot: {
          contentHash: '9'.repeat(64),
        },
      }),
    );

    const result = service.getActiveRuntimeSnapshot(applicationId);

    await expect(result).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(result).rejects.toThrow(
      'RuntimeSnapshot body is inconsistent.',
    );
  });

  it('fails with an internal error instead of TypeError when persisted RuntimeSnapshot lookupKey is missing', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const snapshotBody = runtimeSnapshotBody() as unknown as Record<
      string,
      unknown
    >;
    delete snapshotBody.lookupKey;
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(
        snapshotBody as unknown as RuntimeSnapshotResponseDto,
      ),
    );

    const result = service.getActiveRuntimeSnapshot(applicationId);

    await expect(result).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(result).rejects.toThrow(
      'RuntimeSnapshot body is inconsistent.',
    );
  });

  it('uses disabled budget policy defaults for legacy Runtime Config documents', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument() as Partial<
      ActiveRuntimeConfigResponseDto
    >;
    delete activeDocument.budgetPolicy;
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument as ActiveRuntimeConfigResponseDto, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.policies.budget).toEqual({
      enabled: false,
      enforcementMode: 'disabled',
      warningThresholdPercent: 80,
    });
  });

  it('uses the default warning threshold for legacy budget policies that only miss the threshold', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument() as unknown as Record<
      string,
      unknown
    >;
    activeDocument.budgetPolicy = {
      enabled: true,
      enforcementMode: 'warn',
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(
        activeDocument as unknown as ActiveRuntimeConfigResponseDto,
        {
          publishState: RuntimeConfigPublishState.ACTIVE,
          publishedAt: now,
        },
      ),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.policies.budget).toEqual({
      enabled: true,
      enforcementMode: 'warn',
      warningThresholdPercent: 80,
    });
    expect(result.budgetResolution).toEqual({
      budgetScopeType: 'application',
      budgetScopeId: applicationId,
      resolvedBy: 'default_application',
      warningThresholdPercent: 80,
    });
  });

  it('defaults missing prompt capture mode to log_safe_full when capture is enabled', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument() as unknown as Record<
      string,
      unknown
    >;
    activeDocument.promptCapturePolicy = {
      enabled: true,
      maxChars: 1200,
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(
        activeDocument as unknown as ActiveRuntimeConfigResponseDto,
        {
          publishState: RuntimeConfigPublishState.ACTIVE,
          publishedAt: now,
        },
      ),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.policies.promptCapture).toEqual({
      enabled: true,
      mode: 'log_safe_full',
      maxChars: 1200,
    });
  });

  it('defaults missing response capture mode to raw_full when capture is enabled', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument() as unknown as Record<
      string,
      unknown
    >;
    activeDocument.responseCapturePolicy = {
      enabled: true,
      maxChars: 1600,
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(
        activeDocument as unknown as ActiveRuntimeConfigResponseDto,
        {
          publishState: RuntimeConfigPublishState.ACTIVE,
          publishedAt: now,
        },
      ),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.policies.responseCapture).toEqual({
      enabled: true,
      mode: 'raw_full',
      maxChars: 1600,
    });
  });

  it('reflects active budget policy in the RuntimeSnapshot execution view', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = {
      ...activeRuntimeConfigDocument(),
      budgetPolicy: {
        enabled: true,
        enforcementMode: 'block' as const,
        warningThresholdPercent: 75,
      },
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.budgetResolution).toEqual({
      budgetScopeType: 'application',
      budgetScopeId: applicationId,
      resolvedBy: 'default_application',
      warningThresholdPercent: 75,
    });
    expect(result.policies.budget).toEqual({
      enabled: true,
      enforcementMode: 'block',
      warningThresholdPercent: 75,
    });
  });

  it('keeps the RuntimeSnapshot budget shape stable for Gateway consumers', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = {
      ...activeRuntimeConfigDocument(),
      budgetPolicy: {
        enabled: true,
        enforcementMode: 'warn' as const,
        warningThresholdPercent: 65,
      },
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(Object.keys(result.policies.budget).sort()).toEqual([
      'enabled',
      'enforcementMode',
      'warningThresholdPercent',
    ]);
    expect(Object.keys(result.budgetResolution).sort()).toEqual([
      'budgetScopeId',
      'budgetScopeType',
      'resolvedBy',
      'warningThresholdPercent',
    ]);
    expect(result.policies.budget).toEqual({
      enabled: true,
      enforcementMode: 'warn',
      warningThresholdPercent: 65,
    });
    expect(result.budgetResolution).toEqual({
      budgetScopeType: 'application',
      budgetScopeId: applicationId,
      resolvedBy: 'default_application',
      warningThresholdPercent: 65,
    });
    expect(result.lookupKey).toEqual({
      tenantId,
      projectId,
      applicationId,
    });
    expect(result.lookupKey).not.toHaveProperty('budgetScopeType');
    expect(result.lookupKey).not.toHaveProperty('budgetScopeId');
    expect(result.policies.budget).not.toHaveProperty('quota');
    expect(result.policies.budget).not.toHaveProperty('ledger');
    expect(result.policies.budget).not.toHaveProperty('checker');
  });

  it('rejects partial stored budget policy documents', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument() as unknown as Record<
      string,
      unknown
    >;
    activeDocument.budgetPolicy = { enabled: true };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(
        activeDocument as unknown as ActiveRuntimeConfigResponseDto,
        {
          publishState: RuntimeConfigPublishState.ACTIVE,
          publishedAt: now,
        },
      ),
    );

    await expect(
      service.getActiveRuntimeSnapshot(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('disables semantic cache mode when exact cache is disabled', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = {
      ...activeRuntimeConfigDocument(),
      cachePolicy: { enabled: false, type: 'exact' as const, ttlSeconds: 3600 },
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.policies.cache.exactCacheEnabled).toBe(false);
    expect(result.policies.cache.semanticCacheMode).toBe('disabled');
  });

  it('uses publishedAt milliseconds for RuntimeSnapshot version fallback', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const publishedAt = new Date('2026-06-27T02:00:00.123Z');
    const activeDocument = {
      ...activeRuntimeConfigDocument(),
      configVersion: 'runtime_config_manual',
      publishedAt: publishedAt.toISOString(),
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt,
      }),
    );

    const result = await service.getActiveRuntimeSnapshot(applicationId);

    expect(result.runtimeSnapshotVersion).toBe(publishedAt.getTime());
    expect(result.providerCatalogRef.catalogVersion).toBe(
      publishedAt.getTime(),
    );
  });

  it('returns the active Provider Catalog body referenced by RuntimeSnapshot', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const snapshot = await service.getActiveRuntimeSnapshot(applicationId);
    const catalog = await service.getActiveProviderCatalog(applicationId);
    const catalogById = await service.getProviderCatalog(catalog.catalogId);

    expect(catalogById).toEqual(catalog);
    expect(snapshot.providerCatalogRef).toEqual({
      catalogId: catalog.catalogId,
      catalogVersion: catalog.catalogVersion,
      contentHash: catalog.contentHash,
    });
    expect(catalog.catalogId).toBe(
      `provider_catalog:${applicationId}:${catalog.catalogVersion}`,
    );
    expect(catalog.providers[0]).toMatchObject({
      providerId,
      providerName: 'mock',
      adapterType: 'mock',
      enabled: true,
      baseUrl: 'http://mock-provider:8090',
      timeoutMs: 30000,
      credentialRequired: false,
      credentialRef: null,
      adapterConfig: { requestFormat: 'mock_chat_completions' },
      fallbackEligible: false,
    });
    expect(catalog.providers[0]?.models[0]).toMatchObject({
      modelId: `${providerId}:mock-fast`,
      modelName: 'mock-fast',
      enabled: true,
      capabilities: {
        streamingSupported: false,
        supportsJsonMode: false,
        maxInputTokens: 8192,
        maxOutputTokens: 2048,
      },
      routing: {
        autoRoutingEligible: true,
        costTier: 'balanced',
        fallbackPriority: 0,
      },
    });
    expect(JSON.stringify(catalog)).not.toContain('secret/provider/mock');
    expect(JSON.stringify(catalog)).not.toContain('secretHash');
  });

  it('exposes selected custom model names in RuntimeSnapshot and Provider Catalog', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const selectedModel = 'mock-custom-model-x';
    const baseDocument = activeRuntimeConfigDocument();
    const baseProvider = baseDocument.providers[0];
    if (!baseProvider) {
      throw new Error('runtime config fixture provider is missing');
    }
    const activeDocument: ActiveRuntimeConfigResponseDto = {
      ...baseDocument,
      providers: [
        {
          ...baseProvider,
          models: [selectedModel, 'mock-custom-model-y'],
        },
      ],
      models: [
        {
          provider: 'mock',
          model: selectedModel,
          displayName: 'Mock Custom Model X',
          status: 'active' as const,
          contextWindowTokens: 16384,
          supportsStreaming: true,
          supportsJsonMode: true,
        },
        {
          provider: 'mock',
          model: 'mock-custom-model-y',
          displayName: 'Mock Custom Model Y',
          status: 'active' as const,
          contextWindowTokens: 16384,
          supportsStreaming: true,
          supportsJsonMode: true,
        },
      ],
      routingPolicy: {
        ...baseDocument.routingPolicy,
        routes: routingRoutes(`${providerId}:${selectedModel}`),
      },
      pricingRules: [
        {
          pricingRuleId: `price_mock_${selectedModel}_v1`,
          provider: 'mock',
          model: selectedModel,
          pricingVersion: '2026-06-27.mock.v1',
          currency: 'USD' as const,
          unit: 'token' as const,
          promptTokenMicroUsd: 1,
          completionTokenMicroUsd: 2,
          effectiveAt: now.toISOString(),
        },
      ],
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const snapshot = await service.getActiveRuntimeSnapshot(applicationId);
    const catalog = await service.getActiveProviderCatalog(applicationId);
    const catalogModel = catalog.providers[0]?.models.find(
      (model) => model.modelName === selectedModel,
    );

    expect(snapshot.policies.routing).toEqual(
      expect.objectContaining({
        routes: routingRoutes(`${providerId}:${selectedModel}`),
      }),
    );
    expect(snapshot.policies).not.toHaveProperty('fallback');
    expect(catalogModel).toMatchObject({
      modelId: `${providerId}:${selectedModel}`,
      modelRef: `${providerId}:${selectedModel}`,
      modelName: selectedModel,
      enabled: true,
      routing: expect.objectContaining({
        autoRoutingEligible: true,
      }),
    });
  });

  it('returns active Provider Catalog from persisted RuntimeSnapshot before revalidating active Runtime Config', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    const runtimeConfig = runtimeConfigRecord(activeDocument, {
      publishState: RuntimeConfigPublishState.ACTIVE,
      publishedAt: now,
    });
    prisma.runtimeConfig.findFirst.mockResolvedValue(runtimeConfig);

    const expectedCatalog =
      await service.getActiveProviderCatalog(applicationId);
    const snapshot = await service.getActiveRuntimeSnapshot(applicationId);
    prisma.runtimeConfig.findFirst.mockReset();
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(snapshot, {
        runtimeSnapshot: {
          runtimeConfig,
        },
      }),
    );

    const result = await service.getActiveProviderCatalog(applicationId);

    expect(result).toEqual(expectedCatalog);
    expect(prisma.runtimeConfig.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret/provider/mock');
    expect(JSON.stringify(result)).not.toContain('secretHash');
  });

  it('computes the active Provider Catalog from a linked Runtime Config for persisted v1 snapshots', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    const runtimeConfig = runtimeConfigRecord(activeDocument, {
      publishState: RuntimeConfigPublishState.ACTIVE,
      publishedAt: now,
    });
    const legacySnapshot = {
      ...runtimeSnapshotBody(),
      schemaVersion: 'gatelm.runtime-snapshot.v1',
    } as unknown as RuntimeSnapshotResponseDto;
    prisma.activeRuntimeSnapshot.findUnique.mockResolvedValue(
      activeRuntimeSnapshotRecord(legacySnapshot, {
        runtimeSnapshot: { runtimeConfig },
      }),
    );

    const result = await service.getActiveProviderCatalog(applicationId);

    expect(result.catalogId).toBe(`provider_catalog:${applicationId}:1`);
    expect(result.catalogVersion).toBe(1);
    expect(result.providers[0]).toMatchObject({
      providerId,
      providerName: 'mock',
    });
    expect(prisma.runtimeConfig.findFirst).not.toHaveBeenCalled();
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
  });

  it('returns canonical Provider Catalog by persisted RuntimeSnapshot ref without revalidating active Runtime Config', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    const runtimeConfig = runtimeConfigRecord(activeDocument, {
      publishState: RuntimeConfigPublishState.ACTIVE,
      publishedAt: now,
    });
    prisma.runtimeConfig.findFirst.mockResolvedValue(runtimeConfig);

    const expectedCatalog =
      await service.getActiveProviderCatalog(applicationId);
    const snapshot = await service.getActiveRuntimeSnapshot(applicationId);
    prisma.runtimeConfig.findFirst.mockReset();
    prisma.runtimeSnapshot.findUnique.mockResolvedValue({
      ...activeRuntimeSnapshotRecord(snapshot).runtimeSnapshot,
      runtimeConfig,
    });

    const result = await service.getProviderCatalog(
      expectedCatalog.catalogId,
    );

    expect(result).toEqual(expectedCatalog);
    expect(prisma.runtimeConfig.findFirst).not.toHaveBeenCalled();
    expect(prisma.runtimeSnapshot.findUnique).toHaveBeenCalledWith({
      where: {
        applicationId_version: {
          applicationId,
          version: BigInt(expectedCatalog.catalogVersion),
        },
      },
      include: {
        runtimeConfig: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret/provider/mock');
    expect(JSON.stringify(result)).not.toContain('secretHash');
  });

  it('preserves Anthropic adapter config in the Provider Catalog body', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const anthropicProviderId = '00000000-0000-4000-8000-000000000602';
    const activeDocument = activeRuntimeConfigDocument();
    const activeDocumentWithClaude = {
      ...activeDocument,
      providers: [
        ...activeDocument.providers,
        {
          providerId: anthropicProviderId,
          provider: 'claude',
          displayName: 'Claude',
          status: 'active' as const,
          adapterType: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          timeoutMs: 30000,
          credentialRequired: true,
          credentialRef: {
            credentialRefId: `provider_credential:${anthropicProviderId}`,
            credentialVersion: 1,
            credentialState: 'active' as const,
          },
          secretRef: `provider_credential:${anthropicProviderId}`,
          credentialPreview: { prefix: 'env_ref_', last4: '0000' },
          resolver: 'environment' as const,
          adapterConfig: {
            apiVersion: '2023-06-01',
            requestFormat: 'anthropic_messages' as const,
          },
          models: ['claude-synthetic-sonnet'],
          failureMode: 'fail_closed' as const,
        },
      ],
      models: [
        ...activeDocument.models,
        {
          provider: 'claude',
          model: 'claude-synthetic-sonnet',
          displayName: 'Claude Synthetic Sonnet',
          status: 'active' as const,
          contextWindowTokens: 200000,
          supportsStreaming: false,
          supportsJsonMode: false,
        },
      ],
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocumentWithClaude, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const catalog = await service.getActiveProviderCatalog(applicationId);
    const claudeProvider = catalog.providers.find(
      (provider) => provider.providerName === 'claude',
    );

    expect(claudeProvider).toMatchObject({
      providerId: anthropicProviderId,
      adapterType: 'anthropic',
      adapterConfig: {
        apiVersion: '2023-06-01',
        requestFormat: 'anthropic_messages',
      },
      models: [
        expect.objectContaining({
          modelName: 'claude-synthetic-sonnet',
        }),
      ],
    });
  });

  it('filters unselected providers that require missing credentials from the Provider Catalog body', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const unselectedProviderId = '00000000-0000-4000-8000-000000000601';
    const activeDocument = activeRuntimeConfigDocument();
    const activeDocumentWithUnselectedProvider = {
      ...activeDocument,
      providers: [
        ...activeDocument.providers,
        {
          providerId: unselectedProviderId,
          provider: 'openai-main',
          displayName: 'OpenAI Main',
          status: 'active' as const,
          adapterType: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          timeoutMs: 30000,
          credentialRequired: true,
          credentialRef: null,
          secretRef: null,
          credentialPreview: null,
          resolver: 'environment' as const,
          adapterConfig: { requestFormat: 'openai_chat_completions' as const },
          models: ['gpt-4o-mini'],
          failureMode: 'fail_closed' as const,
        },
      ],
      models: [
        ...activeDocument.models,
        {
          provider: 'openai-main',
          model: 'gpt-4o-mini',
          displayName: 'GPT 4o Mini',
          status: 'active' as const,
          contextWindowTokens: 128000,
          supportsStreaming: true,
          supportsJsonMode: true,
        },
      ],
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocumentWithUnselectedProvider, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    const catalog = await service.getActiveProviderCatalog(applicationId);

    expect(catalog.providers).toHaveLength(1);
    expect(catalog.providers[0]?.providerName).toBe('mock');
    expect(JSON.stringify(catalog)).not.toContain('openai-main');
    expect(JSON.stringify(catalog)).not.toContain(unselectedProviderId);
  });

  it('rejects a Provider Catalog id that does not match the active catalog', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
        publishedAt: now,
      }),
    );

    await expect(
      service.getProviderCatalog(`provider_catalog:${applicationId}:999`),
    ).rejects.toThrow('Provider Catalog not found.');
  });

  it('rejects malformed Provider Catalog ids before application lookup', async () => {
    const { service, prisma } = createService();

    await expect(
      service.getProviderCatalog('provider_catalog:not-a-uuid:12abc'),
    ).rejects.toThrow('Provider Catalog not found.');

    expect(prisma.runtimeConfig.findFirst).not.toHaveBeenCalled();
  });

  it('rejects provider base URLs with credential query material before saving runtime config', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {
      baseUrl: 'https://api.openai.com/v1?api_key=synthetic',
    });
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);

    await expect(service.upsertDraft(applicationId, {})).rejects.toThrow(
      'Provider baseUrl must not contain credential material.',
    );

    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects an active row when its stored document is not active', async () => {
    const { service, prisma } = createService();
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(
        { ...activeRuntimeConfigDocument(), publishState: 'draft' },
        {
          publishState: RuntimeConfigPublishState.ACTIVE,
        },
      ),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('rejects an active runtime config when current application context is not active', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {}, {
      applicationStatus: ResourceStatus.DISABLED,
    });
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeRuntimeConfigDocument(), {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow(
      'Runtime Config requires active tenant, project, and application.',
    );
  });

  it('rejects an active runtime config when its referenced API Key is no longer executable', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {}, { apiKeyStatus: CredentialStatus.REVOKED });
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeRuntimeConfigDocument(), {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('rejects an active runtime config when a selected provider is currently disabled', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, { status: ProviderConnectionStatus.DISABLED });
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeRuntimeConfigDocument(), {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('rejects an active runtime config when a selected model is disabled', async () => {
    const { service, prisma } = createService();
    const activeDocument = activeRuntimeConfigDocument();
    activeDocument.models = activeDocument.models.map((model) => ({
      ...model,
      status: 'disabled',
    }));
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('rejects configured state when any route still resolves to mock', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const activeDocument = activeRuntimeConfigDocument();
    activeDocument.routingPolicy.bootstrapState = 'configured';
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('rejects an active runtime config containing forbidden credential fields', async () => {
    const { service, prisma } = createService();
    const activeDocument =
      activeRuntimeConfigDocument() as ActiveRuntimeConfigResponseDto & {
        apiKey: ActiveRuntimeConfigResponseDto['apiKey'] & {
          secretHash: string;
        };
      };
    activeDocument.apiKey = {
      ...activeDocument.apiKey,
      secretHash: 'a'.repeat(64),
    };
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('rejects an active runtime config when credential references are malformed', async () => {
    const { service, prisma } = createService();
    const activeDocument = activeRuntimeConfigDocument() as unknown as Record<
      string,
      unknown
    >;
    delete activeDocument.apiKey;
    activeDocument.appTokenId = null;
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(
        activeDocument as unknown as ActiveRuntimeConfigResponseDto,
        {
          publishState: RuntimeConfigPublishState.ACTIVE,
        },
      ),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
    expect(prisma.gatewayApiKey.findUnique).not.toHaveBeenCalled();
    expect(prisma.appToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an active runtime config when provider models are malformed', async () => {
    const { service, prisma } = createService();
    const activeDocument = activeRuntimeConfigDocument();
    const provider = activeDocument.providers[0];
    if (!provider) {
      throw new Error('Expected active runtime config fixture provider.');
    }
    (provider as unknown as { models: unknown }).models = 'mock-fast';
    prisma.runtimeConfig.findFirst.mockResolvedValue(
      runtimeConfigRecord(activeDocument, {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.getActiveRuntimeConfig(applicationId),
    ).rejects.toThrow('Active Runtime Config is not executable.');
  });

  it('serializes canonical JSON with stable key order and Date values', () => {
    const { service } = createService();
    const canonicalJson = (
      service as unknown as {
        canonicalJson: (value: unknown) => string;
      }
    ).canonicalJson.bind(service);

    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ when: now })).toBe(
      `{"when":${JSON.stringify(now.toISOString())}}`,
    );
  });

  it('rejects invalid Date values during canonical JSON serialization', () => {
    const { service } = createService();
    const canonicalJson = (
      service as unknown as {
        canonicalJson: (value: unknown) => string;
      }
    ).canonicalJson.bind(service);

    expect(() => canonicalJson({ when: new Date('invalid') })).toThrow(
      'Runtime Config contains an invalid Date value.',
    );
  });

  it('does not overwrite a published config version when upserting a draft', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(
      runtimeConfigRecord(activeRuntimeConfigDocument(), {
        publishState: RuntimeConfigPublishState.ACTIVE,
      }),
    );

    await expect(
      service.upsertDraft(applicationId, {
        configVersion: 'runtime_config_test_001',
      }),
    ).rejects.toThrow('Runtime Config version is already published.');
    expect(prisma.runtimeConfig.update).not.toHaveBeenCalled();
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('keeps the draft version editable after publishing', async () => {
    const { service, prisma } = createService();
    const draftDocument: ActiveRuntimeConfigResponseDto = {
      ...activeRuntimeConfigDocument(),
      publishState: 'draft',
    };
    const draft = runtimeConfigRecord(draftDocument, {
      configVersion: 'draft',
      publishState: RuntimeConfigPublishState.DRAFT,
    });

    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(draft);
    prisma.runtimeConfig.update.mockImplementation(({ data }) =>
      Promise.resolve(
        runtimeConfigRecord(data.document, {
          id: draft.id,
          configVersion: 'draft',
          publishState: RuntimeConfigPublishState.DRAFT,
        }),
      ),
    );

    const result = await service.upsertDraft(applicationId, {
      rateLimit: { limit: 90 },
    });

    expect(prisma.runtimeConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: draft.id },
      }),
    );
    expect(result.publishState).toBe('draft');
    expect(result.runtimeConfig.rateLimit.limit).toBe(90);
  });

  it('rejects draft models for unregistered providers', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        models: [{ provider: 'openai', model: 'gpt-4o-mini' }],
      }),
    ).rejects.toThrow('Runtime Config model provider is not registered.');
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects non-reserved mock models when mock is not registered', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, {
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      baseUrl: 'https://api.openai.example/v1',
      providerConfig: { models: ['gpt-4o'] },
    });

    await expect(
      service.upsertDraft(applicationId, {
        models: [{ provider: 'mock', model: 'mock-fast' }],
      }),
    ).rejects.toThrow('Runtime Config model provider is not registered.');
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate model entries by provider and model', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        models: [
          { provider: 'mock', model: 'mock-fast' },
          { provider: 'mock', model: 'mock-fast' },
        ],
      }),
    ).rejects.toThrow(
      'Runtime Config model entries must be unique by provider and model.',
    );
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects draft runtime configs that select a disabled model', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        models: [
          {
            provider: 'mock',
            model: 'mock-fast',
            status: 'disabled',
          },
        ],
        routingPolicy: {
          mode: 'auto',
          routes: routingRoutes(`${providerId}:mock-fast`),
        },
      }),
    ).rejects.toThrow('Runtime Config selected models must be active.');
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects routing model refs that are not in the provider catalog', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        routingPolicy: {
          mode: 'auto',
          routes: routingRoutes(`${providerId}:missing-model`),
        },
      }),
    ).rejects.toThrow(
      'Runtime Config routing modelRef is not available in the provider catalog.',
    );
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects routing model refs that become duplicates after trimming', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    prisma.runtimeConfig.findUnique.mockResolvedValue(null);
    const duplicateRef = `${providerId}:mock-fast`;
    const routes = routingRoutes(duplicateRef);
    routes.general.simple.modelRefs = [duplicateRef, ` ${duplicateRef} `];

    await expect(
      service.upsertDraft(applicationId, {
        routingPolicy: { mode: 'auto', routes },
      }),
    ).rejects.toThrow(
      'Runtime Config routing policy must use one global Simple model, one global Complex model, and at most one global fallback model.',
    );
  });

  it('rejects more than one authored fallback candidate', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const routes = routingRoutes(`${providerId}:mock-fast`);
    routes.general.simple.modelRefs = [
      `${providerId}:mock-fast`,
      `${providerId}:mock-balanced`,
      `${providerId}:mock-last`,
    ];

    await expect(
      service.upsertDraft(applicationId, {
        routingPolicy: { mode: 'auto', routes },
      }),
    ).rejects.toThrow(
      'Runtime Config routing policy must use one global Simple model, one global Complex model, and at most one global fallback model.',
    );
  });

  it('rejects category-specific primary models for newly authored policies', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const routes = routingRoutes(`${providerId}:mock-fast`);
    routes.code.simple.modelRefs = [`${providerId}:mock-balanced`];

    await expect(
      service.upsertDraft(applicationId, {
        routingPolicy: { mode: 'auto', routes },
      }),
    ).rejects.toThrow(
      'Runtime Config routing policy must use one global Simple model, one global Complex model, and at most one global fallback model.',
    );
  });

  it('rejects cell-specific fallback models for newly authored policies', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);
    const primary = `${providerId}:mock-fast`;
    const routes = routingRoleRoutes(primary, primary, 'mock-balanced');
    routes.reasoning.complex.modelRefs[1] = `${providerId}:mock-balanced`;

    await expect(
      service.upsertDraft(applicationId, {
        routingPolicy: { mode: 'auto', routes },
      }),
    ).rejects.toThrow(
      'Runtime Config routing policy must use one global Simple model, one global Complex model, and at most one global fallback model.',
    );
  });

  it('rejects provider credential previews that cannot match runtime schema', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, { credentialLast4: 'too-long' });

    await expect(service.upsertDraft(applicationId, {})).rejects.toThrow(
      'Provider credential preview must include prefix and 4-character last4.',
    );
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects inconsistent budget policy settings', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        budgetPolicy: {
          enabled: false,
          enforcementMode: 'block',
        },
      }),
    ).rejects.toThrow('Runtime Config budget policy is invalid.');
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects pricing rules for models outside the runtime model set', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        pricingRules: [
          {
            provider: 'mock',
            model: 'missing-model',
            promptTokenMicroUsd: 1,
            completionTokenMicroUsd: 1,
          },
        ],
      }),
    ).rejects.toThrow('Runtime Config pricing rule model is not available.');
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  function mockRuntimeInputs(
    prisma: ReturnType<typeof createService>['prisma'],
    providerOverrides: Record<string, unknown> = {},
    contextOverrides: {
      tenantStatus?: ResourceStatus;
      projectStatus?: ResourceStatus;
      applicationStatus?: ResourceStatus;
      apiKeyStatus?: CredentialStatus;
      appTokenStatus?: CredentialStatus;
      apiKeyExpiresAt?: Date | null;
      appTokenExpiresAt?: Date | null;
    } = {},
  ) {
    prisma.application.findUnique.mockResolvedValue({
      id: applicationId,
      tenantId,
      projectId,
      name: 'Customer Demo App',
      description: null,
      status: contextOverrides.applicationStatus ?? ResourceStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      tenant: {
        id: tenantId,
        status: contextOverrides.tenantStatus ?? ResourceStatus.ACTIVE,
      },
      project: {
        id: projectId,
        status: contextOverrides.projectStatus ?? ResourceStatus.ACTIVE,
      },
    });
    const apiKey = {
      id: apiKeyId,
      tenantId,
      projectId,
      displayName: 'Demo API Key',
      prefix: 'gsk_live_',
      last4: '9xA1',
      secretHash: 'a'.repeat(64),
      hashAlgorithm: 'sha256',
      status: contextOverrides.apiKeyStatus ?? CredentialStatus.ACTIVE,
      scopes: ['chat:completions', 'models:read'],
      expiresAt: contextOverrides.apiKeyExpiresAt ?? null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.gatewayApiKey.findFirst.mockResolvedValue(apiKey);
    prisma.gatewayApiKey.findUnique.mockResolvedValue(apiKey);
    const appToken = {
      id: appTokenId,
      tenantId,
      projectId,
      applicationId,
      displayName: 'Demo App Token',
      prefix: 'gat_app_',
      last4: '4tK2',
      secretHash: 'b'.repeat(64),
      hashAlgorithm: 'sha256',
      status: contextOverrides.appTokenStatus ?? CredentialStatus.ACTIVE,
      scopes: ['gateway:invoke'],
      expiresAt: contextOverrides.appTokenExpiresAt ?? null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    prisma.appToken.findFirst.mockResolvedValue(appToken);
    prisma.appToken.findUnique.mockResolvedValue(appToken);
    prisma.providerConnection.findMany.mockResolvedValue([
      {
        id: providerId,
        tenantId,
        projectId,
        provider: 'mock',
        displayName: 'Mock Provider',
        status: ProviderConnectionStatus.ACTIVE,
        baseUrl: 'http://mock-provider:8090',
        timeoutMs: 30000,
        secretRef: 'secret/provider/mock',
        credentialPrefix: 'mock_',
        credentialLast4: '9xA1',
        resolver: 'none',
        providerConfig: { models: ['mock-fast', 'mock-balanced'] },
        createdAt: now,
        updatedAt: now,
        ...providerOverrides,
      },
    ]);
    prisma.applicationProviderConnection.findMany.mockImplementation(async () => {
      const providers = await prisma.providerConnection.findMany();

      return providers.map((provider: { id: string }) => ({
        id: `application-provider-${provider.id}`,
        tenantId,
        projectId,
        applicationId,
        providerConnectionId: provider.id,
        providerConnection: provider,
        createdAt: now,
      }));
    });
  }

  function runtimeConfigRecord(
    document: ActiveRuntimeConfigResponseDto,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: '00000000-0000-4000-8000-000000000700',
      tenantId,
      projectId,
      applicationId,
      configVersion: document.configVersion,
      configHash: document.configHash,
      publishState: RuntimeConfigPublishState.DRAFT,
      document,
      effectiveAt: new Date(document.effectiveAt),
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function activeRuntimeSnapshotRecord(
    snapshotBody: RuntimeSnapshotResponseDto,
    overrides: {
      pointer?: Record<string, unknown>;
      runtimeSnapshot?: Record<string, unknown>;
    } = {},
  ) {
    return {
      tenantId,
      projectId,
      applicationId,
      runtimeSnapshotId: snapshotBody.runtimeSnapshotId,
      updatedAt: now,
      updatedBy: 'control_plane',
      runtimeSnapshot: {
        id: snapshotBody.runtimeSnapshotId,
        tenantId,
        projectId,
        applicationId,
        runtimeConfigId: '00000000-0000-4000-8000-000000000700',
        version: BigInt(snapshotBody.runtimeSnapshotVersion),
        contentHash: snapshotBody.contentHash,
        snapshotBody,
        publishedAt: now,
        publishedBy: 'control_plane',
        createdAt: now,
        ...overrides.runtimeSnapshot,
      },
      ...overrides.pointer,
    };
  }

  function runtimeSnapshotBody(
    overrides: Partial<RuntimeSnapshotResponseDto> = {},
  ): RuntimeSnapshotResponseDto {
    return {
      schemaVersion: 'gatelm.runtime-snapshot.v2',
      runtimeSnapshotId: '00000000-0000-4000-8000-000000000700',
      runtimeSnapshotVersion: 1,
      contentHash: 'c'.repeat(64),
      runtimeState: 'snapshot_active',
      publishedAt: now.toISOString(),
      publishedBy: 'control_plane',
      gatewayInstanceId: 'gateway_core_static',
      lookupKey: {
        tenantId,
        projectId,
        applicationId,
      },
      budgetResolution: {
        budgetScopeType: 'application',
        budgetScopeId: applicationId,
        resolvedBy: 'default_application',
        warningThresholdPercent: 80,
      },
      providerCatalogRef: {
        catalogId: `provider_catalog:${applicationId}:1`,
        catalogVersion: 1,
        contentHash: 'f'.repeat(64),
      },
      policies: {
        safety: {
          enabled: true,
          mode: 'enforce',
          requestSideRequired: true,
          policyHash: 'd'.repeat(64),
          detectorSet: [{ detectorType: 'email', action: 'redact' }],
        },
        routing: {
          mode: 'auto',
          bootstrapState: 'mock_bootstrap',
          routes: routingRoutes(`${providerId}:mock-fast`),
          routingPolicyHash: `sha256:${'e'.repeat(64)}`,
        },
        cache: {
          exactCacheEnabled: true,
          semanticCacheMode: 'evidence_only',
          cachePolicyHash: 'a'.repeat(64),
        },
        promptCapture: {
          enabled: false,
          mode: 'disabled',
          maxChars: 8000,
        },
        responseCapture: {
          enabled: false,
          mode: 'disabled',
          maxChars: 8000,
        },
        rateLimit: {
          enabled: true,
          scope: 'application',
          windowSeconds: 60,
          limit: 60,
        },
        budget: {
          enabled: false,
          enforcementMode: 'disabled',
          warningThresholdPercent: 80,
        },
        streaming: {
          enabled: false,
          thinSliceOnly: true,
        },
      },
      legacyHashes: {
        configHash: 'c'.repeat(64),
        securityPolicyHash: 'd'.repeat(64),
        routingPolicyHash: 'e'.repeat(64),
      },
      ...overrides,
    };
  }

  function routingRoutes(modelRef: string) {
    return routingRoleRoutes(modelRef, modelRef);
  }

  function routingRoleRoutes(
    simpleModelRef: string,
    complexModelRef: string,
    fallbackModelRef?: string,
  ) {
    const simpleModelRefs = fallbackModelRef
      ? [simpleModelRef, fallbackModelRef]
      : [simpleModelRef];
    const complexModelRefs = fallbackModelRef
      ? [complexModelRef, fallbackModelRef]
      : [complexModelRef];
    return {
      general: {
        simple: { modelRefs: [...simpleModelRefs] },
        complex: { modelRefs: [...complexModelRefs] },
      },
      code: {
        simple: { modelRefs: [...simpleModelRefs] },
        complex: { modelRefs: [...complexModelRefs] },
      },
      translation: {
        simple: { modelRefs: [...simpleModelRefs] },
        complex: { modelRefs: [...complexModelRefs] },
      },
      summarization: {
        simple: { modelRefs: [...simpleModelRefs] },
        complex: { modelRefs: [...complexModelRefs] },
      },
      reasoning: {
        simple: { modelRefs: [...simpleModelRefs] },
        complex: { modelRefs: [...complexModelRefs] },
      },
    };
  }

  function activeRuntimeConfigDocument(): ActiveRuntimeConfigResponseDto {
    return {
      schemaVersion: 'gatelm.active-runtime-config.v2',
      configVersion: 'runtime_config_test_001',
      configHash: 'c'.repeat(64),
      configHashAlgorithm:
        'sha256(canonical_json(runtimeConfig_without_configHash))',
      generatedAt: now.toISOString(),
      effectiveAt: now.toISOString(),
      publishedAt: now.toISOString(),
      publishState: 'active',
      tenantId,
      tenantStatus: 'active',
      projectId,
      projectStatus: 'active',
      applicationId,
      applicationStatus: 'active',
      apiKeyId,
      apiKeyStatus: 'active',
      appTokenId: null,
      appTokenStatus: null,
      apiKey: {
        id: apiKeyId,
        type: 'api_key',
        status: 'active',
        prefix: 'gsk_live_',
        last4: '9xA1',
        scopes: ['chat:completions', 'models:read'],
        expiresAt: null,
        verification: 'prefix_then_hash_compare',
      },
      appToken: null,
      providers: [
        {
          providerId,
          provider: 'mock',
          displayName: 'Mock Provider',
          status: 'active',
          baseUrl: 'http://mock-provider:8090',
          timeoutMs: 30000,
          credentialRef: {
            credentialRefId: `provider_credential:${providerId}`,
            credentialVersion: 1,
            credentialState: 'active',
          },
          secretRef: 'secret/provider/mock',
          credentialPreview: { prefix: 'mock_', last4: '9xA1' },
          resolver: 'none',
          models: ['mock-fast', 'mock-balanced'],
          failureMode: 'fail_closed',
        },
      ],
      models: [
        {
          provider: 'mock',
          model: 'mock-fast',
          displayName: 'mock-fast',
          status: 'active',
          contextWindowTokens: 8192,
          supportsStreaming: false,
          supportsJsonMode: false,
        },
      ],
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
      safetyPolicy: {
        mode: 'rule_based',
        securityPolicyHash: 'd'.repeat(64),
        remoteSafety: { enabled: false, mode: 'disabled' },
        detectors: [
          {
            type: 'email',
            enabled: true,
            action: 'redact',
            placeholder: '[EMAIL_REDACTED]',
          },
        ],
      },
      cachePolicy: { enabled: true, type: 'exact', ttlSeconds: 3600 },
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
      routingPolicy: {
        schemaVersion: 'gatelm.routing-policy.v2',
        mode: 'auto',
        bootstrapState: 'mock_bootstrap',
        routes: routingRoutes(`${providerId}:mock-fast`),
        routingPolicyHash: `sha256:${'e'.repeat(64)}`,
      },
      pricingRules: [
        {
          pricingRuleId: 'price_mock_mock-fast_v1',
          provider: 'mock',
          model: 'mock-fast',
          pricingVersion: '2026-06-27.mock.v1',
          currency: 'USD',
          unit: 'token',
          promptTokenMicroUsd: 1,
          completionTokenMicroUsd: 2,
          effectiveAt: now.toISOString(),
        },
      ],
      hashing: {
        canonicalJson: 'utf8_json_sorted_keys_no_extra_whitespace',
        usesSecret: false,
        configHashSourceFields: ['tenantId'],
        routingPolicyHashSourceFields: ['routingPolicy'],
        securityPolicyHashSourceFields: ['safetyPolicy.mode'],
        requestBodyHash:
          'sha256(canonical_json(openai_request_body_without_credentials))',
        promptHash: 'sha256(normalized_redacted_prompt_utf8)',
        cacheKeyHash: 'sha256(canonical_json(cache_key_material))',
        cacheKeyFields: ['tenantId'],
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
  }
});

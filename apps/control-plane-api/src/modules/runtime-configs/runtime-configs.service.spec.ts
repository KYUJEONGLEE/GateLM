import {
  CredentialStatus,
  ProviderConnectionStatus,
  ResourceStatus,
  RuntimeConfigPublishState,
} from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ActiveRuntimeConfigResponseDto } from './dto/runtime-config.dto';
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
      runtimeConfig: {
        findFirst: jest.Mock;
        findUnique: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
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
      runtimeConfig: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
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
      cachePolicy: { ttlSeconds: 120 },
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
    expect(result.runtimeConfig.cachePolicy.ttlSeconds).toBe(120);
    expect(result.runtimeConfig.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('secretHash');
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('a'.repeat(64));
    expect(JSON.stringify(result.runtimeConfig)).not.toContain('b'.repeat(64));
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
        defaultProvider: 'mock',
        defaultModel: 'mock-balanced',
      },
    });
    const tx = {
      runtimeConfig: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };

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
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
      }),
    );
    expect(result.configVersion).toBe('runtime_config_test_001');
    expect(result.publishState).toBe('active');
    expect(result.schemaVersion).toBe('gatelm.active-runtime-config.v1');
    expect(result.providers[0]?.secretRef).toBe('secret/provider/mock');
    expect(JSON.stringify(result)).not.toContain('secretHash');
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
    expect(prisma.appToken.findUnique).toHaveBeenCalledWith({
      where: { id: appTokenId },
    });
    expect(result).toEqual(activeDocument);
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
          defaultProvider: 'mock',
          defaultModel: 'mock-fast',
        },
      }),
    ).rejects.toThrow('Runtime Config selected models must be active.');
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('returns a sanitized provider and model in unavailable model errors', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma);

    await expect(
      service.upsertDraft(applicationId, {
        routingPolicy: {
          defaultProvider: 'mock',
          defaultModel: 'missing\n"model"',
        },
      }),
    ).rejects.toThrow(
      'Runtime Config model is not available for provider "mock" and model "missing _model_".',
    );
    expect(prisma.runtimeConfig.create).not.toHaveBeenCalled();
  });

  it('rejects provider credential previews that cannot match runtime schema', async () => {
    const { service, prisma } = createService();
    mockRuntimeInputs(prisma, { credentialLast4: 'too-long' });

    await expect(service.upsertDraft(applicationId, {})).rejects.toThrow(
      'Provider credential preview must include prefix and 4-character last4.',
    );
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

  function activeRuntimeConfigDocument(): ActiveRuntimeConfigResponseDto {
    return {
      schemaVersion: 'gatelm.active-runtime-config.v1',
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
      appTokenId,
      appTokenStatus: 'active',
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
      appToken: {
        id: appTokenId,
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
          provider: 'mock',
          displayName: 'Mock Provider',
          status: 'active',
          baseUrl: 'http://mock-provider:8090',
          timeoutMs: 30000,
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
      defaultProvider: 'mock',
      defaultModel: 'mock-fast',
      lowCostProvider: 'mock',
      lowCostModel: 'mock-fast',
      fallbackProvider: 'mock',
      fallbackModel: 'mock-fast',
      rateLimit: {
        enabled: true,
        scope: 'application',
        algorithm: 'fixed_window',
        windowSeconds: 60,
        limit: 60,
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
      routingPolicy: {
        type: 'simple',
        autoModel: 'auto',
        defaultProvider: 'mock',
        defaultModel: 'mock-fast',
        lowCostProvider: 'mock',
        lowCostModel: 'mock-fast',
        fallbackProvider: 'mock',
        fallbackModel: 'mock-fast',
        shortPromptMaxChars: 500,
        routingPolicyHash: 'e'.repeat(64),
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

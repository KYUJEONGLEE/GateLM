import { Logger } from '@nestjs/common';
import { Prisma, ProviderConnectionStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ProviderConnectionsService } from './provider-connections.service';

describe('ProviderConnectionsService', () => {
  const projectId = '00000000-0000-4000-8000-000000000200';
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function createService(): {
    service: ProviderConnectionsService;
    prisma: {
      project: { findUnique: jest.Mock };
      providerConnection: {
        findMany: jest.Mock;
        findUnique: jest.Mock;
        upsert: jest.Mock;
      };
    };
  } {
    const prisma = {
      project: {
        findUnique: jest.fn(),
      },
      providerConnection: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
    };

    return {
      service: new ProviderConnectionsService(
        prisma as unknown as PrismaService,
      ),
      prisma,
    };
  }

  it('returns credential preview without exposing secretRef', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.upsert.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000900',
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
      providerConfig: { model: 'mock-fast' },
      createdAt: new Date('2026-06-27T00:00:00.000Z'),
      updatedAt: new Date('2026-06-27T00:00:00.000Z'),
    });

    const result = await service.upsertProvider(projectId, {
      provider: 'mock',
      displayName: 'Mock Provider',
      baseUrl: 'http://mock-provider:8090',
      secretRef: 'secret/provider/mock',
      credentialPrefix: 'mock_',
      credentialLast4: '9xA1',
    });

    expect(result).not.toHaveProperty('secretRef');
    expect(result.credentialPreview).toEqual({
      prefix: 'mock_',
      last4: '9xA1',
    });
  });

  it('discovers provider models with an environment credential binding', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000905';
    const providerCredential = 'test-provider-credential';
    process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = `provider_credential:${providerId}=OPENAI_API_KEY`;
    process.env.OPENAI_API_KEY = providerCredential;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'gpt-4o-mini',
            object: 'model',
            created: 1715367049,
            owned_by: 'openai',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(
      projectId,
      'openai-main',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${providerCredential}`,
        }),
        method: 'GET',
      }),
    );
    expect(result).toMatchObject({
      adapterType: 'openai_compatible',
      credentialRequired: true,
      modelCount: 1,
      models: [
        expect.objectContaining({
          modelName: 'gpt-4o-mini',
          ownedBy: 'openai',
          provider: 'openai-main',
          providerId,
        }),
      ],
      provider: 'openai-main',
      providerId,
    });
    expect(JSON.stringify(result)).not.toContain(providerCredential);
  });

  it('normalizes provider model created timestamps in milliseconds', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000908';
    const createdAtMs = 1715367049000;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'http://mock-provider:8090/v1',
        provider: 'mock',
        providerConfig: {
          adapterType: 'mock',
          credentialRequired: false,
        },
        resolver: 'none',
        secretRef: null,
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'mock-balanced',
            object: 'model',
            created: createdAtMs,
            owned_by: 'mock',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(projectId, 'mock');

    expect(result.models[0]?.createdAt).toBe(
      new Date(createdAtMs).toISOString(),
    );
  });

  it('rejects provider model discovery when a required credential is not bound', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000906';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    global.fetch = jest.fn();

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow(
      'Provider credential reference is not bound to an available environment variable.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects provider model discovery base URLs with api-key query material', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection('00000000-0000-4000-8000-000000000907', {
        baseUrl: 'https://api.openai.com/v1?api-key=synthetic',
        provider: 'openai-main',
        resolver: 'none',
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
        },
      }),
    );
    global.fetch = jest.fn();

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow('Provider baseUrl must not contain credential material.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid provider model discovery base URLs with a clear message', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection('00000000-0000-4000-8000-000000000909', {
        baseUrl: 'not a valid url',
        provider: 'openai-main',
        resolver: 'none',
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
        },
      }),
    );
    global.fetch = jest.fn();

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow('Provider baseUrl is invalid.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('logs provider model discovery transport failures without credential material', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000910';
    const providerCredential = 'test-provider-credential';
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = `provider_credential:${providerId}=OPENAI_API_KEY`;
    process.env.OPENAI_API_KEY = providerCredential;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    const transportError = new Error('synthetic network failure');
    Object.assign(transportError, { code: 'ECONNRESET' });
    global.fetch = jest.fn().mockRejectedValue(transportError);

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow('Provider model discovery failed.');

    expect(warnSpy).toHaveBeenCalledWith(
      'Provider model discovery upstream call failed. errorName=Error; errorCode=ECONNRESET',
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(providerCredential);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('Authorization');
  });

  it('sets hasMore and nextCursor from limit plus one pagination', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findMany.mockResolvedValue([
      providerConnection('00000000-0000-4000-8000-000000000901'),
      providerConnection('00000000-0000-4000-8000-000000000902'),
      providerConnection('00000000-0000-4000-8000-000000000903'),
    ]);

    const result = await service.listProviders(projectId, { limit: 2 });

    expect(prisma.providerConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000902',
      hasMore: true,
    });
  });

  it('maps explicit null providerConfig to Prisma DbNull', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.upsert.mockResolvedValue(
      providerConnection('00000000-0000-4000-8000-000000000904'),
    );

    await service.upsertProvider(projectId, {
      provider: 'mock',
      displayName: 'Mock Provider',
      baseUrl: 'http://mock-provider:8090',
      providerConfig: null,
    });

    expect(prisma.providerConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          providerConfig: Prisma.DbNull,
        }),
        update: expect.objectContaining({
          providerConfig: Prisma.DbNull,
        }),
      }),
    );
  });

  function providerConnection(
    id: string,
    overrides: Partial<ProviderConnectionFixture> = {},
  ): ProviderConnectionFixture {
    return {
      id,
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
      providerConfig: { model: 'mock-fast' },
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    };
  }

  type ProviderConnectionFixture = {
    baseUrl: string;
    createdAt: Date;
    credentialLast4: string | null;
    credentialPrefix: string | null;
    displayName: string;
    id: string;
    projectId: string;
    provider: string;
    providerConfig: Prisma.JsonValue;
    resolver: string;
    secretRef: string | null;
    status: ProviderConnectionStatus;
    tenantId: string;
    timeoutMs: number;
    updatedAt: Date;
  };
});

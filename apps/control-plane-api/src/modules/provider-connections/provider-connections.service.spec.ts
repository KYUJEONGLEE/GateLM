import { Prisma, ProviderConnectionStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ProviderConnectionsService } from './provider-connections.service';

describe('ProviderConnectionsService', () => {
  const projectId = '00000000-0000-4000-8000-000000000200';
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');

  function createService(): {
    service: ProviderConnectionsService;
    prisma: {
      project: { findUnique: jest.Mock };
      providerConnection: { upsert: jest.Mock; findMany: jest.Mock };
    };
  } {
    const prisma = {
      project: {
        findUnique: jest.fn(),
      },
      providerConnection: {
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

  function providerConnection(id: string) {
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
    };
  }
});

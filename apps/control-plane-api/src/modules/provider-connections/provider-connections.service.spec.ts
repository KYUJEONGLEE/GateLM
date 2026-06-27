import { ProviderConnectionStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ProviderConnectionsService } from './provider-connections.service';

describe('ProviderConnectionsService', () => {
  const projectId = '00000000-0000-4000-8000-000000000200';
  const tenantId = '00000000-0000-4000-8000-000000000100';

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
});

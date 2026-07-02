import { ConflictException } from '@nestjs/common';
import { CredentialStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ApiKeysService } from './api-keys.service';

describe('ApiKeysService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');

  function createService(): {
    service: ApiKeysService;
    prisma: {
      project: { findUnique: jest.Mock };
      gatewayApiKey: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
      };
      $transaction: jest.Mock;
    };
  } {
    const prisma = {
      project: {
        findUnique: jest.fn(),
      },
      gatewayApiKey: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    return {
      service: new ApiKeysService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  it('stores only the hashed API Key secret and returns plaintext once', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.gatewayApiKey.create.mockImplementation(({ data }) =>
      Promise.resolve(apiKey('00000000-0000-4000-8000-000000000401', data)),
    );

    const result = await service.issueApiKey(projectId, {
      displayName: 'Primary Gateway API Key',
    });

    const createData = prisma.gatewayApiKey.create.mock.calls[0][0].data;
    expect(result.plaintext).toMatch(/^gsk_live_/);
    expect(result.plaintextShownOnce).toBe(true);
    expect(createData).not.toHaveProperty('plaintext');
    expect(createData.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createData.secretHash).not.toBe(result.plaintext);
    expect(createData.hashAlgorithm).toBe('sha256');
    expect(createData.scopes).toEqual(['chat:completions', 'models:read']);
  });

  it('does not expose plaintext or secretHash from list responses', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.gatewayApiKey.findMany.mockResolvedValue([
      apiKey('00000000-0000-4000-8000-000000000401'),
      apiKey('00000000-0000-4000-8000-000000000402'),
      apiKey('00000000-0000-4000-8000-000000000403'),
    ]);

    const result = await service.listApiKeys(projectId, { limit: 2 });

    expect(prisma.gatewayApiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).not.toHaveProperty('plaintext');
    expect(result.data[0]).not.toHaveProperty('secretHash');
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000402',
      hasMore: true,
    });
  });

  it('revokes the previous API Key when rotating', async () => {
    const { service, prisma } = createService();
    const previous = apiKey('00000000-0000-4000-8000-000000000401');
    const tx = {
      gatewayApiKey: {
        update: jest.fn(),
        create: jest.fn(({ data }) =>
          Promise.resolve(
            apiKey('00000000-0000-4000-8000-000000000404', data),
          ),
        ),
      },
    };
    prisma.gatewayApiKey.findUnique.mockResolvedValue(previous);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.rotateApiKey(previous.id);

    expect(tx.gatewayApiKey.update).toHaveBeenCalledWith({
      where: { id: previous.id },
      data: expect.objectContaining({ status: CredentialStatus.REVOKED }),
    });
    expect(tx.gatewayApiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          projectId,
          secretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(result.credentialId).toBe('00000000-0000-4000-8000-000000000404');
    expect(result.plaintext).toMatch(/^gsk_live_/);
  });

  it('rejects rotate for revoked API Keys', async () => {
    const { service, prisma } = createService();
    prisma.gatewayApiKey.findUnique.mockResolvedValue(
      apiKey('00000000-0000-4000-8000-000000000401', {
        status: CredentialStatus.REVOKED,
        revokedAt: new Date('2026-06-27T00:10:00.000Z'),
      }),
    );

    await expect(
      service.rotateApiKey('00000000-0000-4000-8000-000000000401'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects rotate for expired API Keys', async () => {
    const { service, prisma } = createService();
    prisma.gatewayApiKey.findUnique.mockResolvedValue(
      apiKey('00000000-0000-4000-8000-000000000401', {
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      }),
    );

    await expect(
      service.rotateApiKey('00000000-0000-4000-8000-000000000401'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves revokedAt when revoking an already revoked API Key', async () => {
    const { service, prisma } = createService();
    const revokedAt = new Date('2026-06-27T00:10:00.000Z');
    prisma.gatewayApiKey.findUnique.mockResolvedValue(
      apiKey('00000000-0000-4000-8000-000000000401', {
        status: CredentialStatus.REVOKED,
        revokedAt,
      }),
    );

    const result = await service.revokeApiKey(
      '00000000-0000-4000-8000-000000000401',
    );

    expect(prisma.gatewayApiKey.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      credentialId: '00000000-0000-4000-8000-000000000401',
      status: 'revoked',
      revokedAt: '2026-06-27T00:10:00.000Z',
    });
  });

  function apiKey(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      tenantId,
      projectId,
      displayName: 'Primary Gateway API Key',
      prefix: 'gsk_live_',
      last4: '9xA1',
      secretHash: 'a'.repeat(64),
      hashAlgorithm: 'sha256',
      status: CredentialStatus.ACTIVE,
      scopes: ['chat:completions', 'models:read'],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    };
  }
});

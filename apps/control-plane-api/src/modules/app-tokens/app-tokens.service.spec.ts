import { ConflictException } from '@nestjs/common';
import { CredentialStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { AppTokensService } from './app-tokens.service';

describe('AppTokensService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const applicationId = '00000000-0000-4000-8000-000000000300';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');

  function createService(): {
    service: AppTokensService;
    prisma: {
      application: { findUnique: jest.Mock };
      appToken: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
      };
      $transaction: jest.Mock;
    };
  } {
    const prisma = {
      application: {
        findUnique: jest.fn(),
      },
      appToken: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    return {
      service: new AppTokensService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  it('binds App Tokens to the application and stores only hashed secret', async () => {
    const { service, prisma } = createService();
    prisma.application.findUnique.mockResolvedValue({
      id: applicationId,
      tenantId,
      projectId,
    });
    prisma.appToken.create.mockImplementation(({ data }) =>
      Promise.resolve(appToken('00000000-0000-4000-8000-000000000501', data)),
    );

    const result = await service.issueAppToken(applicationId, {
      displayName: 'Customer Demo App Token',
    });

    const createData = prisma.appToken.create.mock.calls[0][0].data;
    expect(result.plaintext).toMatch(/^gat_app_/);
    expect(result.plaintextShownOnce).toBe(true);
    expect(createData).toEqual(
      expect.objectContaining({
        tenantId,
        projectId,
        applicationId,
        hashAlgorithm: 'scrypt-v1',
        scopes: ['gateway:invoke'],
      }),
    );
    expect(createData).not.toHaveProperty('plaintext');
    expect(createData.secretHash).toMatch(/^scrypt-v1\$/);
  });

  it('does not expose plaintext or secretHash from list responses', async () => {
    const { service, prisma } = createService();
    prisma.application.findUnique.mockResolvedValue({
      id: applicationId,
      tenantId,
      projectId,
    });
    prisma.appToken.findMany.mockResolvedValue([
      appToken('00000000-0000-4000-8000-000000000501'),
      appToken('00000000-0000-4000-8000-000000000502'),
      appToken('00000000-0000-4000-8000-000000000503'),
    ]);

    const result = await service.listAppTokens(applicationId, { limit: 2 });

    expect(prisma.appToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).not.toHaveProperty('plaintext');
    expect(result.data[0]).not.toHaveProperty('secretHash');
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000502',
      hasMore: true,
    });
  });

  it('revokes the previous App Token when rotating', async () => {
    const { service, prisma } = createService();
    const previous = appToken('00000000-0000-4000-8000-000000000501');
    const tx = {
      appToken: {
        update: jest.fn(),
        create: jest.fn(({ data }) =>
          Promise.resolve(
            appToken('00000000-0000-4000-8000-000000000504', data),
          ),
        ),
      },
    };
    prisma.appToken.findUnique.mockResolvedValue(previous);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.rotateAppToken(previous.id);

    expect(tx.appToken.update).toHaveBeenCalledWith({
      where: { id: previous.id },
      data: expect.objectContaining({ status: CredentialStatus.REVOKED }),
    });
    expect(tx.appToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          projectId,
          applicationId,
          secretHash: expect.stringMatching(/^scrypt-v1\$/),
        }),
      }),
    );
    expect(result.credentialId).toBe('00000000-0000-4000-8000-000000000504');
    expect(result.plaintext).toMatch(/^gat_app_/);
  });

  it('rejects rotate for revoked App Tokens', async () => {
    const { service, prisma } = createService();
    prisma.appToken.findUnique.mockResolvedValue(
      appToken('00000000-0000-4000-8000-000000000501', {
        status: CredentialStatus.REVOKED,
        revokedAt: new Date('2026-06-27T00:10:00.000Z'),
      }),
    );

    await expect(
      service.rotateAppToken('00000000-0000-4000-8000-000000000501'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects rotate for expired App Tokens', async () => {
    const { service, prisma } = createService();
    prisma.appToken.findUnique.mockResolvedValue(
      appToken('00000000-0000-4000-8000-000000000501', {
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      }),
    );

    await expect(
      service.rotateAppToken('00000000-0000-4000-8000-000000000501'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves revokedAt when revoking an already revoked App Token', async () => {
    const { service, prisma } = createService();
    const revokedAt = new Date('2026-06-27T00:10:00.000Z');
    prisma.appToken.findUnique.mockResolvedValue(
      appToken('00000000-0000-4000-8000-000000000501', {
        status: CredentialStatus.REVOKED,
        revokedAt,
      }),
    );

    const result = await service.revokeAppToken(
      '00000000-0000-4000-8000-000000000501',
    );

    expect(prisma.appToken.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      credentialId: '00000000-0000-4000-8000-000000000501',
      status: 'revoked',
      revokedAt: '2026-06-27T00:10:00.000Z',
    });
  });

  function appToken(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      tenantId,
      projectId,
      applicationId,
      displayName: 'Customer Demo App Token',
      prefix: 'gat_app_',
      last4: '4tK2',
      secretHash: 'b'.repeat(64),
      hashAlgorithm: 'sha256',
      status: CredentialStatus.ACTIVE,
      scopes: ['gateway:invoke'],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    };
  }
});

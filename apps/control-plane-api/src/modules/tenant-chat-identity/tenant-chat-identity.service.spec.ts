import { HttpException } from '@nestjs/common';

import { TenantChatIdentityService } from './tenant-chat-identity.service';

const future = new Date(Date.now() + 60_000);
const invitation = {
  acceptedAt: null, deletedAt: null, email: 'invitee@example.test', id: 'employee-id',
  invitationExpiresAt: future, invitationRevokedAt: null, invitationStatus: 'pending', name: '초대 사용자',
  tenant: { authzVersion: 1, id: 'tenant-id', name: '테스트 조직', status: 'ACTIVE' }, tenantId: 'tenant-id',
};

function makeService(prisma: Record<string, any>, google: Record<string, jest.Mock> = {}) {
  return new TenantChatIdentityService(
    prisma as never,
    { getOrThrow: jest.fn().mockReturnValue('http://chat.localhost:3002/auth/google/callback') } as never,
    google as never,
  );
}

describe('TenantChatIdentityService', () => {
  it('requires normal authentication instead of replacing an existing credential', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      employee: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'existing-user' }]) },
    };
    const prisma = { $transaction: jest.fn((callback: Function) => callback(tx)) };
    await expect(makeService(prisma).acceptInvitationWithPassword({ name: '사용자', password: 'long-password', token: 'invitation-token-value' })).rejects.toBeInstanceOf(HttpException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('rejects a Google subject already bound to an account with another email', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      oAuthAccount: { findUnique: jest.fn().mockResolvedValue({ user: { deletedAt: null, email: 'other@example.test', id: 'user-id', status: 'active' } }) },
    };
    const prisma = { $transaction: jest.fn((callback: Function) => callback(tx)) };
    const google = {
      exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'test-memory-value' }),
      getProfile: jest.fn().mockResolvedValue({ email: 'invitee@example.test', emailVerified: true, name: '사용자', providerSubject: 'google-subject' }),
    };
    await expect(makeService(prisma, google).completeGoogle({ code: 'one-time-code' })).rejects.toBeInstanceOf(HttpException);
  });

  it('replaces unexpected transaction failures with a bounded identity error', async () => {
    const prisma = { $transaction: jest.fn().mockRejectedValue(new Error('database connection details')) };
    const service = makeService(prisma) as unknown as {
      identityTransaction: (work: () => Promise<never>) => Promise<never>;
    };

    await expect(service.identityTransaction(async () => Promise.reject(new Error('unused')))).rejects.toMatchObject({
      response: {
        code: 'CHAT_IDENTITY_UNAVAILABLE',
        message: 'Tenant Chat identity mutation is temporarily unavailable.',
      },
      status: 503,
    });
  });

  it('loads employee entitlements in one bounded query', async () => {
    const memberships = [
      {
        createdAt: new Date('2026-01-01T00:00:00.000Z'), deletedAt: null, id: 'membership-a', role: 'employee', status: 'active',
        tenant: { authzVersion: 2, id: 'tenant-a', name: '조직 A', status: 'ACTIVE' }, tenantId: 'tenant-a', userId: 'user-id',
      },
      {
        createdAt: new Date('2026-01-02T00:00:00.000Z'), deletedAt: null, id: 'membership-b', role: 'employee', status: 'active',
        tenant: { authzVersion: 3, id: 'tenant-b', name: '조직 B', status: 'ACTIVE' }, tenantId: 'tenant-b', userId: 'user-id',
      },
      {
        createdAt: new Date('2026-01-03T00:00:00.000Z'), deletedAt: null, id: 'membership-c', role: 'tenant_admin', status: 'active',
        tenant: { authzVersion: 4, id: 'tenant-c', name: '조직 C', status: 'ACTIVE' }, tenantId: 'tenant-c', userId: 'user-id',
      },
    ];
    const employeeFindMany = jest.fn().mockResolvedValue([
      { id: 'employee-a', tenantId: 'tenant-a' },
      { id: 'employee-b', tenantId: 'tenant-b' },
    ]);
    const prisma = {
      employee: { findMany: employeeFindMany },
      tenantMembership: { findMany: jest.fn().mockResolvedValue(memberships) },
      user: { findUnique: jest.fn().mockResolvedValue({ actorAuthzVersion: 5, deletedAt: null, email: 'user@example.test', id: 'user-id', name: '사용자', status: 'active' }) },
    };

    const result = await makeService(prisma).getEntitlements('user-id');

    expect(employeeFindMany).toHaveBeenCalledTimes(1);
    expect(employeeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: { in: ['tenant-a', 'tenant-b'] }, userId: 'user-id' }),
    }));
    expect(result.tenants).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorKind: 'employee', employeeId: 'employee-a', tenantId: 'tenant-a' }),
      expect.objectContaining({ actorKind: 'employee', employeeId: 'employee-b', tenantId: 'tenant-b' }),
      expect.objectContaining({ actorKind: 'tenant_admin', employeeId: null, tenantId: 'tenant-c' }),
    ]));
  });
});

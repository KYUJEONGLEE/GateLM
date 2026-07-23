import { HttpException } from '@nestjs/common';

import { TenantChatIdentityService } from './tenant-chat-identity.service';

const future = new Date(Date.now() + 60_000);
const invitation = {
  acceptedAt: null, deletedAt: null, email: 'invitee@example.test', id: 'employee-id',
  invitationExpiresAt: future, invitationRevokedAt: null, invitationStatus: 'pending', name: '초대 사용자',
  tenant: { authzVersion: 1, id: 'tenant-id', name: '테스트 조직', status: 'ACTIVE' }, tenantId: 'tenant-id',
};
const existingLocalUser = {
  actorAuthzVersion: 4,
  authProvider: 'local',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  email: invitation.email,
  emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  id: 'existing-user',
  lastLoginAt: null,
  metadata: {},
  name: '기존 사용자',
  passwordHash: 'existing-password-hash',
  status: 'active',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeService(
  prisma: Record<string, any>,
  google: Record<string, jest.Mock> = {},
  auth: Record<string, jest.Mock> = {},
) {
  return new TenantChatIdentityService(
    prisma as never,
    { getOrThrow: jest.fn().mockReturnValue('http://chat.localhost:3002/auth/google/callback') } as never,
    google as never,
    auth as never,
  );
}

describe('TenantChatIdentityService', () => {
  it('uses the Tenant Chat reset origin and shared credential service', async () => {
    const auth = {
      changePasswordForUser: jest.fn().mockResolvedValue({ passwordChanged: true }),
      confirmPasswordReset: jest.fn().mockResolvedValue({ passwordReset: true }),
      requestPasswordReset: jest.fn().mockResolvedValue({ accepted: true }),
    };
    const service = makeService({}, {}, auth);

    await expect(
      service.requestPasswordReset({ email: 'member@example.test' }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      service.confirmPasswordReset({
        newPassword: 'a-secure-tenant-chat-passphrase',
        token: 'reset-token-with-at-least-32-characters',
      }),
    ).resolves.toEqual({ passwordReset: true });
    await expect(
      service.changePassword({
        currentPassword: 'current-password',
        newPassword: 'a-new-tenant-chat-passphrase',
        userId: existingLocalUser.id,
      }),
    ).resolves.toEqual({ passwordChanged: true });

    expect(auth.requestPasswordReset).toHaveBeenCalledWith(
      { email: 'member@example.test' },
      'tenant-chat',
    );
    expect(auth.changePasswordForUser).toHaveBeenCalledWith(
      existingLocalUser.id,
      expect.objectContaining({ newPassword: 'a-new-tenant-chat-passphrase' }),
    );
  });

  it('requires normal authentication instead of replacing an existing credential', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      employee: {
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(invitation),
      },
      projectAdmin: { count: jest.fn().mockResolvedValue(0) },
      tenantAdmin: { count: jest.fn().mockResolvedValue(0) },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([{ role: 'employee' }]) },
      user: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([existingLocalUser]) },
    };
    const prisma = { $transaction: jest.fn((callback: Function) => callback(tx)) };
    await expect(makeService(prisma).acceptInvitationWithPassword({ name: '사용자', password: 'long-password-for-test', token: 'invitation-token-value' })).rejects.toBeInstanceOf(HttpException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('marks a local account with only stale employee memberships as reclaimable', async () => {
    const prisma = {
      employee: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(invitation),
      },
      projectAdmin: { count: jest.fn().mockResolvedValue(0) },
      tenantAdmin: { count: jest.fn().mockResolvedValue(0) },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([{ role: 'employee' }]) },
      user: { findMany: jest.fn().mockResolvedValue([existingLocalUser]) },
    };

    await expect(makeService(prisma).resolveInvitation('invitation-token-value')).resolves.toMatchObject({
      accountState: 'reclaimable',
      email: invitation.email,
      tenantId: invitation.tenantId,
    });
  });

  it('keeps an OAuth-only orphan on the existing-account authentication path', async () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { ...existingLocalUser, authProvider: 'google', passwordHash: null },
        ]),
      },
    };

    await expect(makeService(prisma).resolveInvitation('invitation-token-value')).resolves.toMatchObject({
      accountState: 'existing',
    });
  });

  it('recredentials a reclaimable local account and revokes every old session', async () => {
    const reclaimedUser = {
      ...existingLocalUser,
      actorAuthzVersion: existingLocalUser.actorAuthzVersion + 1,
      lastLoginAt: expect.any(Date),
      name: '새 조직 사용자',
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      authSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      employee: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(invitation),
        update: jest.fn().mockResolvedValue({ ...invitation, userId: existingLocalUser.id }),
      },
      projectAdmin: { count: jest.fn().mockResolvedValue(0) },
      tenantAdmin: { count: jest.fn().mockResolvedValue(0) },
      tenantChatRefreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      tenantChatSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([{ role: 'employee' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({ id: 'new-membership' }),
      },
      user: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([existingLocalUser]),
        update: jest.fn().mockResolvedValue(reclaimedUser),
      },
    };
    const prisma = { $transaction: jest.fn((callback: Function) => callback(tx)) };
    const service = makeService(prisma);
    const identityResult = jest.fn().mockResolvedValue({ tenants: [], user: reclaimedUser });
    (service as unknown as { identityResult: typeof identityResult }).identityResult = identityResult;

    await service.acceptInvitationWithPassword({
      name: '새 조직 사용자',
      password: 'long-password-for-test',
      token: 'invitation-token-value',
    });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: existingLocalUser.id },
      data: expect.objectContaining({
        actorAuthzVersion: { increment: 1 },
        name: '새 조직 사용자',
        passwordHash: expect.any(String),
        status: 'active',
      }),
    });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { revokedAt: null, userId: existingLocalUser.id },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.tenantChatRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { revokedAt: null, session: { userId: existingLocalUser.id } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.tenantChatSession.updateMany).toHaveBeenCalledWith({
      where: { revokedAt: null, userId: existingLocalUser.id },
      data: { revokeReason: 'account_reclaimed', revokedAt: expect.any(Date) },
    });
    expect(tx.tenantMembership.updateMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        role: 'employee',
        status: 'active',
        userId: existingLocalUser.id,
      },
      data: { deletedAt: expect.any(Date), status: 'removed' },
    });
    expect(tx.tenantMembership.upsert).toHaveBeenCalled();
    expect(tx.employee.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'active', userId: existingLocalUser.id }),
      where: { id: invitation.id },
    }));
    expect(identityResult).toHaveBeenCalledWith(existingLocalUser.id, tx);
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
      user: { findUnique: jest.fn().mockResolvedValue({ actorAuthzVersion: 5, deletedAt: null, email: 'user@example.test', id: 'user-id', name: '사용자', passwordHash: 'local-password-hash', status: 'active' }) },
    };

    const result = await makeService(prisma).getEntitlements('user-id');

    expect(employeeFindMany).toHaveBeenCalledTimes(1);
    expect(employeeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: { in: ['tenant-a', 'tenant-b'] }, userId: 'user-id' }),
    }));
    expect(result.user.hasLocalPassword).toBe(true);
    expect(result.tenants).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorKind: 'employee', employeeId: 'employee-a', tenantId: 'tenant-a' }),
      expect.objectContaining({ actorKind: 'employee', employeeId: 'employee-b', tenantId: 'tenant-b' }),
      expect.objectContaining({ actorKind: 'tenant_admin', employeeId: null, tenantId: 'tenant-c' }),
    ]));
  });
});

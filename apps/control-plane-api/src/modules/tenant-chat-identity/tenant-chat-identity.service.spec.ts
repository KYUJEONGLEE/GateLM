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
});

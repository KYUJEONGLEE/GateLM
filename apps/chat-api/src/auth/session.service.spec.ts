import { HttpException } from '@nestjs/common';

import { signAccessJwt, type AccessClaims } from './auth.crypto';
import { SessionService } from './session.service';

const accessSecret = 'test-only-access-secret-that-is-long-enough';
const intentSecret = 'test-only-intent-secret-that-is-long-enough';
const now = new Date();
const future = new Date(now.getTime() + 60_000);
const session = {
  createdAt: now,
  deviceIdHash: 'sha256:device',
  expiresAt: future,
  id: '00000000-0000-4000-8000-000000000010',
  revokeReason: null,
  revokedAt: null,
  selectedTenantId: '00000000-0000-4000-8000-000000000020',
  sessionVersion: 1,
  updatedAt: now,
  userId: '00000000-0000-4000-8000-000000000030',
};
const identity = {
  tenants: [{
    actorAuthzVersion: 4, actorKind: 'employee' as const, employeeId: '00000000-0000-4000-8000-000000000040',
    membershipId: '00000000-0000-4000-8000-000000000050', status: 'active' as const,
    tenantAuthzVersion: 7, tenantId: session.selectedTenantId, tenantName: '테스트 조직', userId: session.userId,
  }],
  user: { actorAuthzVersion: 4, email: 'member@example.test', id: session.userId, name: '테스트 사용자' },
};

function service(prisma: Record<string, any>, controlPlane: Record<string, jest.Mock>) {
  return new SessionService(
    prisma as never,
    controlPlane as never,
    { getOrThrow: (key: string) => key === 'TENANT_CHAT_ACCESS_JWT_SECRET' ? accessSecret : intentSecret } as never,
  );
}

function accessToken(overrides: Partial<AccessClaims> = {}) {
  const seconds = Math.floor(Date.now() / 1000);
  return signAccessJwt({
    actorAuthzVersion: 4, actorKind: 'employee', aud: 'gatelm-chat-web', deviceIdHash: session.deviceIdHash,
    employeeId: identity.tenants[0].employeeId, exp: seconds + 300, iat: seconds, iss: 'gatelm-chat-api',
    jti: '00000000-0000-4000-8000-000000000060', nbf: seconds - 1, sessionVersion: 1,
    sid: session.id, sub: session.userId, tenantAuthzVersion: 7, tenantId: session.selectedTenantId, ...overrides,
  }, accessSecret);
}

describe('SessionService', () => {
  it('revalidates the selected authoritative entitlement for execution', async () => {
    const prisma = { tenantChatSession: { findUnique: jest.fn().mockResolvedValue(session) } };
    const controlPlane = { entitlement: jest.fn().mockResolvedValue(identity.tenants[0]) };

    await expect(service(prisma, controlPlane).authorizeExecution(accessToken())).resolves.toMatchObject({
      actorKind: 'employee',
      employeeId: identity.tenants[0].employeeId,
      tenantId: session.selectedTenantId,
      userId: session.userId,
    });
    expect(controlPlane.entitlement).toHaveBeenCalledWith(session.userId, session.selectedTenantId);
  });

  it('rejects unavailable or stale execution entitlement without falling back', async () => {
    const prisma = { tenantChatSession: { findUnique: jest.fn().mockResolvedValue(session) } };
    const unavailable = { entitlement: jest.fn().mockRejectedValue(new Error('unavailable')) };
    await expect(service(prisma, unavailable).authorizeExecution(accessToken())).rejects.toThrow('unavailable');

    const stale = {
      entitlement: jest.fn().mockResolvedValue({ ...identity.tenants[0], tenantAuthzVersion: 8 }),
    };
    await expect(service(prisma, stale).authorizeExecution(accessToken())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CHAT_ACCESS_STALE' }),
      status: 401,
    });
  });

  it('does not mint another refresh family during tenant selection', async () => {
    const prisma = {
      tenantChatRefreshToken: { create: jest.fn() },
      tenantChatSession: { findUnique: jest.fn().mockResolvedValue(session), update: jest.fn().mockResolvedValue(session) },
    };
    const controlPlane = { entitlement: jest.fn().mockResolvedValue(identity.tenants[0]), entitlements: jest.fn().mockResolvedValue(identity) };
    const issued = await service(prisma, controlPlane).selectTenant(accessToken(), session.selectedTenantId);
    expect(issued.refreshToken).toBeUndefined();
    expect(prisma.tenantChatRefreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an access token after actor authorization version changes', async () => {
    const prisma = { tenantChatSession: { findUnique: jest.fn().mockResolvedValue(session) } };
    const controlPlane = { entitlements: jest.fn().mockResolvedValue({ ...identity, user: { ...identity.user, actorAuthzVersion: 5 } }) };
    await expect(service(prisma, controlPlane).current(accessToken())).rejects.toMatchObject({ status: 401 });
  });

  it('rotates refresh once and revokes the family when the old token is reused', async () => {
    let consumed = false;
    const refreshRow = { consumedAt: null, expiresAt: future, familyId: '00000000-0000-4000-8000-000000000070', id: '00000000-0000-4000-8000-000000000071', revokedAt: null, session, sessionId: session.id };
    const prisma: Record<string, any> = {
      tenantChatRefreshToken: {
        findUnique: jest.fn().mockResolvedValue(refreshRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenantChatSession: { findUnique: jest.fn().mockResolvedValue(session), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction = jest.fn(async (value: unknown) => {
      if (Array.isArray(value)) return Promise.all(value);
      return (value as Function)({
        tenantChatRefreshToken: {
          create: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockImplementation(async () => consumed ? { count: 0 } : (consumed = true, { count: 1 })),
        },
      });
    });
    const controlPlane = { entitlements: jest.fn().mockResolvedValue(identity) };
    const sessions = service(prisma, controlPlane);
    expect((await sessions.refresh('first-refresh-token')).refreshToken).toBeDefined();
    await expect(sessions.refresh('first-refresh-token')).rejects.toBeInstanceOf(HttpException);
    expect(prisma.tenantChatSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revokeReason: 'refresh_reuse' }),
      where: { id: session.id, revokedAt: null },
    }));
  });

  it('preserves the original reason when a session was already revoked', async () => {
    const revokedSession = { ...session, revokeReason: 'logout', revokedAt: now };
    const prisma = {
      tenantChatRefreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          consumedAt: null,
          expiresAt: future,
          familyId: '00000000-0000-4000-8000-000000000070',
          id: '00000000-0000-4000-8000-000000000071',
          revokedAt: now,
          session: revokedSession,
          sessionId: session.id,
        }),
        updateMany: jest.fn(),
      },
      tenantChatSession: { updateMany: jest.fn() },
    };
    const controlPlane = { entitlements: jest.fn() };

    await expect(service(prisma, controlPlane).refresh('revoked-refresh-token')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CHAT_AUTH_REQUIRED' }),
      status: 401,
    });
    expect(prisma.tenantChatSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.tenantChatRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(controlPlane.entitlements).not.toHaveBeenCalled();
  });
});

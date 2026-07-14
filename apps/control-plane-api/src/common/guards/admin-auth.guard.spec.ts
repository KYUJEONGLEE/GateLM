import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import { hashSecret } from '@/modules/auth/auth.crypto';
import { AUTH_COOKIE_NAMES } from '@/modules/auth/auth.tokens';

import { AdminAuthGuard } from './admin-auth.guard';
import { getAuthenticatedAdminUserId } from '@/common/authenticated-admin';

describe('AdminAuthGuard', () => {
  const sessionToken = 'session-token-for-test';
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const otherTenantId = '00000000-0000-4000-8000-000000000101';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const applicationId = '00000000-0000-4000-8000-000000000300';
  const userId = '00000000-0000-4000-8000-000000000900';
  const internalToken = 'internal-service-token-for-test';

  it('rejects admin mutations without a session cookie', async () => {
    const guard = newGuard();

    await expect(
      guard.canActivate(contextFor({ params: { tenantId } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects admin reads without a session cookie', async () => {
    const guard = newGuard();

    await expect(
      guard.canActivate(
        contextFor({
          method: 'GET',
          originalUrl: '/admin/v1/tenants/' + tenantId + '/projects',
          params: { tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects admin mutations with an invalid session', async () => {
    const prisma = newPrismaMock();
    prisma.authSession.findUnique.mockResolvedValue(null);
    const guard = newGuard(prisma);

    await expect(
      guard.canActivate(contextFor({ cookie: sessionCookie(), params: { tenantId } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.authSession.findUnique).toHaveBeenCalledWith({
      where: { sessionTokenHash: hashSecret(sessionToken) },
      select: {
        expiresAt: true,
        kind: true,
        revokedAt: true,
        userId: true,
      },
    });
  });

  it('rejects users without an active tenant_admin membership', async () => {
    const prisma = newPrismaMock();
    prisma.authSession.findUnique.mockResolvedValue(validSession());
    prisma.tenantMembership.findMany.mockResolvedValue([]);
    prisma.tenantAdmin.findMany.mockResolvedValue([]);
    const guard = newGuard(prisma);

    await expect(
      guard.canActivate(contextFor({ cookie: sessionCookie(), params: { tenantId } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects project-scoped mutations outside the tenant admin scope', async () => {
    const prisma = newPrismaMock();
    prisma.authSession.findUnique.mockResolvedValue(validSession());
    prisma.tenantMembership.findMany.mockResolvedValue([{ tenantId }]);
    prisma.tenantAdmin.findMany.mockResolvedValue([]);
    prisma.project.findUnique.mockResolvedValue({ tenantId: otherTenantId });
    const guard = newGuard(prisma);

    await expect(
      guard.canActivate(contextFor({ cookie: sessionCookie(), params: { projectId } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a full session for an active tenant admin in scope', async () => {
    const prisma = newPrismaMock();
    prisma.authSession.findUnique.mockResolvedValue(validSession());
    prisma.tenantMembership.findMany.mockResolvedValue([
      { tenantId },
    ]);
    prisma.tenantAdmin.findMany.mockResolvedValue([]);
    const guard = newGuard(prisma);

    const context = contextFor({ cookie: sessionCookie(), params: { tenantId } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(
      getAuthenticatedAdminUserId(context.switchToHttp().getRequest<Request>()),
    ).toBe(userId);
  });

  it('scopes provider catalog reads through the catalog application id', async () => {
    const prisma = newPrismaMock();
    prisma.authSession.findUnique.mockResolvedValue(validSession());
    prisma.tenantMembership.findMany.mockResolvedValue([{ tenantId }]);
    prisma.tenantAdmin.findMany.mockResolvedValue([]);
    prisma.application.findUnique.mockResolvedValue({ tenantId });
    const guard = newGuard(prisma);

    await expect(
      guard.canActivate(
        contextFor({
          cookie: sessionCookie(),
          method: 'GET',
          originalUrl:
            '/admin/v1/provider-catalogs/provider_catalog:' +
            applicationId +
            ':1',
          params: {
            catalogId: 'provider_catalog:' + applicationId + ':1',
          },
        }),
      ),
    ).resolves.toBe(true);
    expect(prisma.application.findUnique).toHaveBeenCalledWith({
      where: { id: applicationId },
      select: { tenantId: true },
    });
  });

  it('allows gateway internal token reads for runtime snapshots', async () => {
    const prisma = newPrismaMock();
    const guard = newGuard(prisma, internalToken);

    await expect(
      guard.canActivate(
        contextFor({
          headers: {
            'x-gatelm-control-plane-internal-token': internalToken,
          },
          method: 'GET',
          originalUrl:
            '/admin/v1/applications/' +
            applicationId +
            '/runtime-snapshot/active',
          params: { applicationId },
        }),
      ),
    ).resolves.toBe(true);
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
  });

  it('rejects wrong-length internal tokens without throwing', async () => {
    const prisma = newPrismaMock();
    const guard = newGuard(prisma, internalToken);

    await expect(
      guard.canActivate(
        contextFor({
          headers: {
            'x-gatelm-control-plane-internal-token': 'wrong',
          },
          method: 'GET',
          originalUrl:
            '/admin/v1/applications/' +
            applicationId +
            '/runtime-snapshot/active',
          params: { applicationId },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
  });

  it('does not allow internal tokens on general admin reads', async () => {
    const prisma = newPrismaMock();
    const guard = newGuard(prisma, internalToken);

    await expect(
      guard.canActivate(
        contextFor({
          headers: {
            'x-gatelm-control-plane-internal-token': internalToken,
          },
          method: 'GET',
          originalUrl: '/admin/v1/tenants/' + tenantId + '/projects',
          params: { tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
  });

  it('does not require admin mutation auth for non-admin routes', async () => {
    const prisma = newPrismaMock();
    const guard = newGuard(prisma);

    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          originalUrl: '/api/chat/conversations',
          params: { tenantId },
        }),
      ),
    ).resolves.toBe(true);
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
  });

  function newGuard(prisma = newPrismaMock(), token?: string) {
    return new AdminAuthGuard(
      prisma as unknown as PrismaService,
      {
        get: jest.fn((key: string) =>
          key === 'CONTROL_PLANE_INTERNAL_SERVICE_TOKEN' ? token : undefined,
        ),
      } as unknown as ConfigService,
    );
  }

  function newPrismaMock() {
    return {
      appToken: { findUnique: jest.fn() },
      application: { findUnique: jest.fn() },
      authSession: { findUnique: jest.fn() },
      gatewayApiKey: { findUnique: jest.fn() },
      project: { findUnique: jest.fn() },
      projectAdminInvitation: { findUnique: jest.fn() },
      team: { findUnique: jest.fn() },
      tenantAdmin: { findMany: jest.fn() },
      tenantMembership: { findMany: jest.fn() },
    };
  }

  function validSession() {
    return {
      expiresAt: new Date(Date.now() + 60_000),
      kind: 'full',
      revokedAt: null,
      userId,
    };
  }

  function sessionCookie() {
    return `${AUTH_COOKIE_NAMES.full}=${encodeURIComponent(sessionToken)}`;
  }

  function contextFor(input: {
    cookie?: string;
    headers?: Record<string, string>;
    method?: string;
    originalUrl?: string;
    params: Record<string, string>;
  }): ExecutionContext {
    const headers = { ...(input.headers ?? {}) };
    if (input.cookie) {
      headers.cookie = input.cookie;
    }
    const request = {
      headers,
      method: input.method ?? 'POST',
      originalUrl: input.originalUrl ?? '/admin/v1/tenants/' + tenantId + '/projects',
      params: input.params,
      url: input.originalUrl ?? '/admin/v1/tenants/' + tenantId + '/projects',
    } as Request;

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }
});

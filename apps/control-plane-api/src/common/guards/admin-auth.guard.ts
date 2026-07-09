import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import { hashSecret } from '@/modules/auth/auth.crypto';
import { AUTH_COOKIE_NAMES } from '@/modules/auth/auth.tokens';

const ADMIN_PATH_PREFIX = '/admin/v1';
const INTERNAL_SERVICE_TOKEN_HEADER =
  'x-gatelm-control-plane-internal-token';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.requiresAdminAuth(request)) {
      return true;
    }

    if (this.allowsInternalServiceRead(request)) {
      return true;
    }

    const sessionToken = this.readCookie(
      request.headers.cookie,
      AUTH_COOKIE_NAMES.full,
    );

    if (!sessionToken) {
      throw new UnauthorizedException('Control Plane admin session is required.');
    }

    const session = await this.prisma.authSession.findUnique({
      where: { sessionTokenHash: hashSecret(sessionToken) },
      select: {
        expiresAt: true,
        kind: true,
        revokedAt: true,
        userId: true,
      },
    });

    if (
      !session ||
      session.kind !== 'full' ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Control Plane admin session is invalid.');
    }

    const adminTenantIds = await this.findTenantAdminTenantIds(session.userId);
    if (adminTenantIds.size === 0) {
      throw new ForbiddenException('Control Plane tenant admin role is required.');
    }

    const routeTenantId = await this.resolveRouteTenantId(request);
    if (routeTenantId && !adminTenantIds.has(routeTenantId)) {
      throw new ForbiddenException('Control Plane resource is outside admin scope.');
    }

    return true;
  }

  private requiresAdminAuth(request: Request): boolean {
    const method = request.method?.toUpperCase();
    const path = requestPath(request);

    return Boolean(
      method &&
        (path === ADMIN_PATH_PREFIX || path.startsWith(`${ADMIN_PATH_PREFIX}/`)),
    );
  }

  private allowsInternalServiceRead(request: Request): boolean {
    if (request.method?.toUpperCase() !== 'GET') {
      return false;
    }

    const path = requestPath(request);
    if (!isInternalServiceReadPath(path)) {
      return false;
    }

    const expectedToken = this.config
      ?.get<string>('CONTROL_PLANE_INTERNAL_SERVICE_TOKEN')
      ?.trim();
    const providedToken = this.readHeader(
      request,
      INTERNAL_SERVICE_TOKEN_HEADER,
    );

    return Boolean(
      expectedToken &&
        providedToken &&
        constantTimeEquals(providedToken, expectedToken),
    );
  }

  private async findTenantAdminTenantIds(userId: string): Promise<Set<string>> {
    const [memberships, tenantAdmins] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where: {
          deletedAt: null,
          role: 'tenant_admin',
          status: 'active',
          userId,
        },
        select: { tenantId: true },
      }),
      this.prisma.tenantAdmin.findMany({
        where: { userId },
        select: { tenantId: true },
      }),
    ]);

    return new Set([
      ...memberships.map((membership) => membership.tenantId),
      ...tenantAdmins.map((tenantAdmin) => tenantAdmin.tenantId),
    ]);
  }

  private async resolveRouteTenantId(request: Request): Promise<string | null> {
    const params = request.params ?? {};
    const tenantId = this.readParam(params, 'tenantId');

    if (tenantId) {
      return tenantId;
    }

    const projectId = this.readParam(params, 'projectId');
    if (projectId) {
      return this.findTenantIdForResource('project', projectId);
    }

    const applicationId = this.readParam(params, 'applicationId');
    if (applicationId) {
      return this.findTenantIdForResource('application', applicationId);
    }

    const apiKeyId = this.readParam(params, 'apiKeyId');
    if (apiKeyId) {
      return this.findTenantIdForResource('apiKey', apiKeyId);
    }

    const appTokenId = this.readParam(params, 'appTokenId');
    if (appTokenId) {
      return this.findTenantIdForResource('appToken', appTokenId);
    }

    const teamId = this.readParam(params, 'teamId');
    if (teamId) {
      return this.findTenantIdForResource('team', teamId);
    }

    const invitationId = this.readParam(params, 'invitationId');
    if (invitationId) {
      return this.findTenantIdForResource(
        'projectAdminInvitation',
        invitationId,
      );
    }

    const catalogId = this.readParam(params, 'catalogId');
    if (catalogId) {
      const catalogApplicationId = applicationIdFromProviderCatalogId(catalogId);
      if (!catalogApplicationId) {
        throw new ForbiddenException('Control Plane resource is outside admin scope.');
      }

      return this.findTenantIdForResource('application', catalogApplicationId);
    }

    return null;
  }

  private async findTenantIdForResource(
    resource:
      | 'apiKey'
      | 'appToken'
      | 'application'
      | 'project'
      | 'projectAdminInvitation'
      | 'team',
    id: string,
  ): Promise<string> {
    if (!isUuid(id)) {
      throw new ForbiddenException('Control Plane resource is outside admin scope.');
    }

    const record = await this.findResourceTenant(resource, id);
    if (!record) {
      throw new ForbiddenException('Control Plane resource is outside admin scope.');
    }

    return record.tenantId;
  }

  private findResourceTenant(
    resource:
      | 'apiKey'
      | 'appToken'
      | 'application'
      | 'project'
      | 'projectAdminInvitation'
      | 'team',
    id: string,
  ): Promise<{ tenantId: string } | null> {
    if (resource === 'apiKey') {
      return this.prisma.gatewayApiKey.findUnique({
        where: { id },
        select: { tenantId: true },
      });
    }

    if (resource === 'appToken') {
      return this.prisma.appToken.findUnique({
        where: { id },
        select: { tenantId: true },
      });
    }

    if (resource === 'application') {
      return this.prisma.application.findUnique({
        where: { id },
        select: { tenantId: true },
      });
    }

    if (resource === 'project') {
      return this.prisma.project.findUnique({
        where: { id },
        select: { tenantId: true },
      });
    }

    if (resource === 'projectAdminInvitation') {
      return this.prisma.projectAdminInvitation.findUnique({
        where: { id },
        select: { tenantId: true },
      });
    }

    return this.prisma.team.findUnique({
      where: { id },
      select: { tenantId: true },
    });
  }

  private readParam(
    params: Record<string, string | string[] | undefined>,
    name: string,
  ): string | null {
    const value = params[name];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private readCookie(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) {
      return null;
    }

    for (const part of cookieHeader.split(';')) {
      const [rawName, ...rawValueParts] = part.trim().split('=');
      if (rawName !== name) {
        continue;
      }

      const rawValue = rawValueParts.join('=');
      if (!rawValue) {
        return null;
      }

      try {
        return decodeURIComponent(rawValue);
      } catch {
        return null;
      }
    }

    return null;
  }

  private readHeader(request: Request, name: string): string | null {
    const value = request.headers[name];
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }
}

function requestPath(request: Request): string {
  const value = request.originalUrl ?? request.url ?? '';
  const queryStart = value.indexOf('?');
  const path = queryStart >= 0 ? value.slice(0, queryStart) : value;
  return path.replace(/\/+$/, '') || '/';
}

function isInternalServiceReadPath(path: string): boolean {
  return (
    /^\/admin\/v1\/applications\/[^/?#]+\/runtime-snapshot\/active$/.test(
      path,
    ) || /^\/admin\/v1\/provider-catalogs\/[^/?#]+$/.test(path)
  );
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function applicationIdFromProviderCatalogId(catalogId: string): string | null {
  const parts = catalogId.split(':');
  if (parts.length !== 3 || parts[0] !== 'provider_catalog') {
    return null;
  }

  const applicationId = parts[1];
  return applicationId && isUuid(applicationId) ? applicationId : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

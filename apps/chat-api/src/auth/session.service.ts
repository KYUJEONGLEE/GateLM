import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '@/database/prisma.service';

import {
  hashValue,
  opaqueToken,
  openIntent,
  sealIntent,
  signAccessJwt,
  safeEqual,
  verifyAccessJwt,
  type AccessClaims,
} from './auth.crypto';
import type {
  AuthorizedExecution,
  IdentityResult,
  IssuedSession,
  PublicSession,
  TenantEntitlement,
} from './auth.types';
import { ControlPlaneClient } from './control-plane.client';

const ACCESS_TTL_SECONDS = 5 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVITATION_INTENT_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class SessionService {
  private readonly accessSecret: string;
  private readonly intentSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly controlPlane: ControlPlaneClient,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('TENANT_CHAT_ACCESS_JWT_SECRET');
    this.intentSecret = config.getOrThrow<string>('TENANT_CHAT_INTENT_SECRET');
  }

  password(email: string, password: string, deviceId: string): Promise<IssuedSession> {
    return this.controlPlane.password(email, password).then((identity) =>
      this.createSession(identity, deviceId),
    );
  }

  createInvitationIntent(token: string): string {
    return sealIntent(
      JSON.stringify({ exp: Date.now() + INVITATION_INTENT_TTL_MS, token }),
      this.intentSecret,
    );
  }

  async resolveInvitation(intent: string) {
    return this.controlPlane.resolveInvitation(this.readInvitationToken(intent));
  }

  async acceptPassword(
    intent: string,
    input: { name: string; password: string },
    deviceId: string,
  ): Promise<IssuedSession> {
    const identity = await this.controlPlane.acceptPassword({
      ...input,
      token: this.readInvitationToken(intent),
    });
    return this.createSession(identity, deviceId);
  }

  async bindExisting(intent: string, accessToken: string): Promise<IssuedSession> {
    const current = await this.requireSession(accessToken);
    const identity = await this.controlPlane.bindExisting({
      token: this.readInvitationToken(intent),
      userId: current.claims.sub,
    });
    await this.prisma.tenantChatSession.update({
      where: { id: current.session.id },
      data: { selectedTenantId: identity.tenants[0]?.tenantId ?? null },
    });
    return this.issueForExistingSession(current.session.id, identity, undefined);
  }

  async googleStart() {
    const state = opaqueToken(24);
    return { ...(await this.controlPlane.googleStart(state)), state };
  }

  async googleComplete(input: {
    code: string;
    expectedState: string;
    invitationIntent?: string;
    state: string;
    deviceId: string;
  }): Promise<IssuedSession> {
    if (!input.expectedState || !input.state || !safeEqual(input.expectedState, input.state)) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'Google authentication state is invalid.');
    }
    const invitationToken = input.invitationIntent
      ? this.readInvitationToken(input.invitationIntent)
      : undefined;
    const identity = await this.controlPlane.googleComplete({
      code: input.code,
      ...(invitationToken ? { invitationToken } : {}),
    });
    return this.createSession(identity, input.deviceId);
  }

  async current(accessToken: string): Promise<PublicSession> {
    const current = await this.requireSession(accessToken);
    const identity = await this.controlPlane.entitlements(current.claims.sub);
    this.assertFreshEntitlement(current.claims, identity);
    return this.publicSession(
      current.session,
      identity,
      new Date(current.claims.exp * 1000),
    );
  }

  async selectTenant(accessToken: string, tenantId: string): Promise<IssuedSession> {
    const current = await this.requireSession(accessToken);
    const currentIdentity = await this.controlPlane.entitlements(current.claims.sub);
    this.assertFreshEntitlement(current.claims, currentIdentity);
    await this.controlPlane.entitlement(current.claims.sub, tenantId);
    await this.prisma.tenantChatSession.update({
      where: { id: current.session.id },
      data: { selectedTenantId: tenantId },
    });
    const identity = await this.controlPlane.entitlements(current.claims.sub);
    return this.issueForExistingSession(current.session.id, identity, undefined);
  }

  async authorizeExecution(accessToken: string): Promise<AuthorizedExecution> {
    const current = await this.requireSession(accessToken);
    const tenantId = current.session.selectedTenantId;
    if (!tenantId || current.claims.tenantId !== tenantId) {
      this.fail(
        HttpStatus.CONFLICT,
        'CHAT_TENANT_SELECTION_REQUIRED',
        'A Tenant Chat tenant must be selected.',
      );
    }
    const entitlement = await this.controlPlane.entitlement(current.claims.sub, tenantId);
    this.assertFreshSelectedEntitlement(current.claims, entitlement);
    return {
      actorAuthzVersion: entitlement.actorAuthzVersion,
      actorKind: entitlement.actorKind,
      ...(entitlement.employeeId ? { employeeId: entitlement.employeeId } : {}),
      sessionId: current.session.id,
      sessionVersion: current.session.sessionVersion,
      tenantAuthzVersion: entitlement.tenantAuthzVersion,
      tenantId: entitlement.tenantId,
      userId: entitlement.userId,
    };
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const tokenHash = hashValue(refreshToken);
    const existing = await this.prisma.tenantChatRefreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });
    if (!existing || existing.expiresAt <= new Date() || existing.session.expiresAt <= new Date()) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'The Chat session has expired.');
    }
    if (existing.session.revokedAt) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'The Chat session has been revoked.');
    }
    if (existing.consumedAt || existing.revokedAt) {
      await this.revokeForReuse(existing.familyId, existing.sessionId);
      this.fail(
        HttpStatus.UNAUTHORIZED,
        'CHAT_REFRESH_REUSED',
        'The Chat session was revoked because a refresh token was reused.',
      );
    }

    const identity = await this.controlPlane.entitlements(existing.session.userId);
    const replacement = opaqueToken();
    const replacementHash = hashValue(replacement);
    const replacementId = randomUUID();
    const consumed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.tenantChatRefreshToken.updateMany({
        where: { consumedAt: null, id: existing.id, revokedAt: null },
        data: { consumedAt: new Date(), replacedByTokenId: replacementId },
      });
      if (update.count !== 1) return false;
      await tx.tenantChatRefreshToken.create({
        data: {
          expiresAt: existing.expiresAt,
          familyId: existing.familyId,
          id: replacementId,
          parentTokenId: existing.id,
          sessionId: existing.sessionId,
          tokenHash: replacementHash,
        },
      });
      return true;
    });
    if (!consumed) {
      await this.revokeForReuse(existing.familyId, existing.sessionId);
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_REFRESH_REUSED', 'The Chat session was revoked.');
    }
    return this.issueForExistingSession(existing.sessionId, identity, replacement);
  }

  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    let sessionId: string | undefined;
    if (accessToken) sessionId = verifyAccessJwt(accessToken, this.accessSecret)?.sid;
    if (!sessionId && refreshToken) {
      sessionId = (
        await this.prisma.tenantChatRefreshToken.findUnique({
          where: { tokenHash: hashValue(refreshToken) },
          select: { sessionId: true },
        })
      )?.sessionId;
    }
    if (!sessionId) return;
    await this.prisma.tenantChatSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: {
        revokeReason: 'logout',
        revokedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
    });
    await this.prisma.tenantChatRefreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(identity: IdentityResult, deviceId: string): Promise<IssuedSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    const refreshToken = opaqueToken();
    const selected = identity.tenants.length === 1 ? identity.tenants[0] : undefined;
    const session = await this.prisma.tenantChatSession.create({
      data: {
        deviceIdHash: hashValue(deviceId),
        expiresAt,
        selectedTenantId: selected?.tenantId,
        userId: identity.user.id,
        refreshTokens: {
          create: {
            expiresAt,
            familyId: randomUUID(),
            tokenHash: hashValue(refreshToken),
          },
        },
      },
    });
    return this.issue(session, identity, refreshToken);
  }

  private async issueForExistingSession(
    sessionId: string,
    identity: IdentityResult,
    refreshToken: string | undefined,
  ): Promise<IssuedSession> {
    const session = await this.prisma.tenantChatSession.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'The Chat session is not active.');
    }
    return this.issue(session, identity, refreshToken);
  }

  private issue(
    session: {
      deviceIdHash: string;
      expiresAt: Date;
      id: string;
      selectedTenantId: string | null;
      sessionVersion: number;
      userId: string;
    },
    identity: IdentityResult,
    refreshToken?: string,
  ): IssuedSession {
    const selected = identity.tenants.find((item) => item.tenantId === session.selectedTenantId);
    const now = Math.floor(Date.now() / 1000);
    const accessExpiresAt = new Date((now + ACCESS_TTL_SECONDS) * 1000);
    const claims: AccessClaims = {
      actorAuthzVersion: identity.user.actorAuthzVersion,
      aud: 'gatelm-chat-web',
      deviceIdHash: session.deviceIdHash,
      exp: now + ACCESS_TTL_SECONDS,
      iat: now,
      iss: 'gatelm-chat-api',
      jti: randomUUID(),
      nbf: now - 1,
      sessionVersion: session.sessionVersion,
      sid: session.id,
      sub: session.userId,
      ...(selected
        ? {
            actorKind: selected.actorKind,
            ...(selected.employeeId ? { employeeId: selected.employeeId } : {}),
            tenantAuthzVersion: selected.tenantAuthzVersion,
            tenantId: selected.tenantId,
          }
        : {}),
    };
    return {
      accessExpiresAt: accessExpiresAt.toISOString(),
      accessToken: signAccessJwt(claims, this.accessSecret),
      refreshExpiresAt: session.expiresAt.toISOString(),
      ...(refreshToken ? { refreshToken } : {}),
      session: this.publicSession(session, identity, accessExpiresAt),
    };
  }

  private publicSession(
    session: {
      expiresAt: Date;
      id: string;
      selectedTenantId: string | null;
      sessionVersion: number;
    },
    identity: IdentityResult,
    accessExpiresAt: Date,
  ): PublicSession {
    const selected = identity.tenants.find((item) => item.tenantId === session.selectedTenantId);
    return {
      accessExpiresAt: accessExpiresAt.toISOString(),
      csrfRequired: true,
      refreshExpiresAt: session.expiresAt.toISOString(),
      selectedTenant: selected ? this.publicTenant(selected) : null,
      sessionId: session.id,
      sessionVersion: session.sessionVersion,
      state: selected ? 'authenticated' : 'tenant_selection_required',
      tenants: identity.tenants.map((item) => this.publicTenant(item)),
      user: {
        email: identity.user.email,
        id: identity.user.id,
        name: identity.user.name,
      },
    };
  }

  private publicTenant(entitlement: TenantEntitlement) {
    return {
      actorKind: entitlement.actorKind,
      employeeId: entitlement.employeeId,
      id: entitlement.tenantId,
      name: entitlement.tenantName,
    };
  }

  private async requireSession(accessToken: string) {
    const claims = verifyAccessJwt(accessToken, this.accessSecret);
    if (!claims) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'The Chat session is invalid.');
    }
    const session = await this.prisma.tenantChatSession.findUnique({ where: { id: claims.sid } });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.deviceIdHash !== claims.deviceIdHash ||
      session.sessionVersion !== claims.sessionVersion ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'The Chat session is not active.');
    }
    return { claims, session };
  }

  private assertFreshEntitlement(claims: AccessClaims, identity: IdentityResult): void {
    const selected = claims.tenantId
      ? identity.tenants.find((tenant) => tenant.tenantId === claims.tenantId)
      : undefined;
    if (
      identity.user.actorAuthzVersion !== claims.actorAuthzVersion ||
      (claims.tenantId &&
        (!selected ||
          selected.tenantAuthzVersion !== claims.tenantAuthzVersion ||
          selected.actorKind !== claims.actorKind ||
          (selected.employeeId ?? undefined) !== claims.employeeId))
    ) {
      this.fail(
        HttpStatus.UNAUTHORIZED,
        'CHAT_ACCESS_STALE',
        'The Chat access token must be refreshed.',
      );
    }
  }

  private assertFreshSelectedEntitlement(
    claims: AccessClaims,
    entitlement: TenantEntitlement,
  ): void {
    if (
      entitlement.status !== 'active' ||
      entitlement.userId !== claims.sub ||
      entitlement.tenantId !== claims.tenantId ||
      entitlement.actorAuthzVersion !== claims.actorAuthzVersion ||
      entitlement.tenantAuthzVersion !== claims.tenantAuthzVersion ||
      entitlement.actorKind !== claims.actorKind ||
      (entitlement.employeeId ?? undefined) !== claims.employeeId
    ) {
      this.fail(
        HttpStatus.UNAUTHORIZED,
        'CHAT_ACCESS_STALE',
        'The Chat access token must be refreshed.',
      );
    }
  }

  private readInvitationToken(intent: string): string {
    const opened = openIntent(intent, this.intentSecret);
    if (!opened) this.fail(HttpStatus.CONFLICT, 'CHAT_INVITATION_INVALID', 'Invitation intent is invalid.');
    try {
      const parsed = JSON.parse(opened) as Record<string, unknown>;
      if (
        typeof parsed.token !== 'string' ||
        parsed.token.length < 16 ||
        typeof parsed.exp !== 'number' ||
        parsed.exp <= Date.now()
      ) {
        throw new Error('invalid');
      }
      return parsed.token;
    } catch {
      this.fail(HttpStatus.CONFLICT, 'CHAT_INVITATION_INVALID', 'Invitation intent is invalid.');
    }
  }

  private async revokeForReuse(familyId: string, sessionId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.tenantChatRefreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.tenantChatSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: {
          revokeReason: 'refresh_reuse',
          revokedAt: now,
          sessionVersion: { increment: 1 },
        },
      }),
    ]);
  }

  private fail(status: HttpStatus, code: string, message: string): never {
    throw new HttpException({ code, message }, status);
  }
}

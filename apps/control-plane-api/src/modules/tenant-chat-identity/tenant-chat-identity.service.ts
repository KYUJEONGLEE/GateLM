import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, User } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import { hashPassword, hashSecret, normalizeEmail, verifyPassword } from '@/modules/auth/auth.crypto';
import { AuthService } from '@/modules/auth/auth.service';
import { assertPasswordMeetsPolicy } from '@/modules/auth/password-policy';
import { GoogleOAuthClient } from '@/modules/auth/google-oauth-client';
import { GOOGLE_OAUTH_CLIENT } from '@/modules/auth/auth.tokens';

import {
  TenantChatGoogleCompleteDto,
  TenantChatInvitationBindDto,
  TenantChatInvitationPasswordDto,
  TenantChatPasswordChangeDto,
  TenantChatPasswordDto,
  TenantChatPasswordResetConfirmDto,
  TenantChatPasswordResetRequestDto,
} from './dto/tenant-chat-identity.dto';

type Transaction = Prisma.TransactionClient;
type InvitationAccountState = 'existing' | 'new' | 'reclaimable';

@Injectable()
export class TenantChatIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(GOOGLE_OAUTH_CLIENT)
    private readonly google: GoogleOAuthClient,
    private readonly auth: AuthService,
  ) {}

  async resolveInvitation(token: string) {
    const invitation = await this.findInvitation(this.prisma, token);
    this.assertInvitationUsable(invitation);
    const users = await this.findUsersByEmail(this.prisma, invitation.email);
    const accountState = await this.invitationAccountState(this.prisma, users);

    return {
      accountState,
      email: normalizeEmail(invitation.email),
      employeeName: invitation.name,
      expiresAt: invitation.invitationExpiresAt!.toISOString(),
      tenantId: invitation.tenantId,
      tenantName: invitation.tenant.name,
    };
  }

  async authenticatePassword(body: TenantChatPasswordDto) {
    const users = await this.findUsersByEmail(this.prisma, body.email);
    const user = users[0];
    if (
      users.length !== 1 ||
      !user?.passwordHash ||
      user.status !== 'active' ||
      user.deletedAt ||
      !(await verifyPassword(body.password, user.passwordHash))
    ) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'Email or password is invalid.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.identityResult(user.id);
  }

  requestPasswordReset(body: TenantChatPasswordResetRequestDto) {
    return this.auth.requestPasswordReset(body, 'tenant-chat');
  }

  confirmPasswordReset(body: TenantChatPasswordResetConfirmDto) {
    return this.auth.confirmPasswordReset(body);
  }

  changePassword(body: TenantChatPasswordChangeDto) {
    return this.auth.changePasswordForUser(body.userId, body);
  }

  async acceptInvitationWithPassword(body: TenantChatInvitationPasswordDto) {
    assertPasswordMeetsPolicy(body.password);
    const passwordHash = await hashPassword(body.password);
    return this.identityTransaction(
      async (tx) => {
        const preview = await this.findInvitation(tx, body.token);
        this.assertInvitationUsable(preview);
        await this.lockEmail(tx, preview.email);
        const invitation = await this.lockInvitation(tx, body.token);
        this.assertInvitationUsable(invitation);
        const users = await this.findUsersByEmail(tx, invitation.email);
        const accountState = await this.invitationAccountState(tx, users);
        if (accountState === 'existing') {
          this.fail(
            HttpStatus.CONFLICT,
            'CHAT_EXISTING_ACCOUNT_LOGIN_REQUIRED',
            'Sign in to the existing account before accepting this invitation.',
          );
        }

        let user: User;
        if (accountState === 'reclaimable') {
          const existingUser = users[0]!;
          const now = new Date();
          await this.revokeAccountSessions(tx, existingUser.id, now);
          await tx.tenantMembership.updateMany({
            where: {
              deletedAt: null,
              role: 'employee',
              status: 'active',
              userId: existingUser.id,
            },
            data: { deletedAt: now, status: 'removed' },
          });
          user = await tx.user.update({
            where: { id: existingUser.id },
            data: {
              actorAuthzVersion: { increment: 1 },
              emailVerifiedAt: now,
              lastLoginAt: now,
              name: body.name.trim(),
              passwordHash,
              status: 'active',
            },
          });
        } else {
          user = await tx.user.create({
            data: {
              authProvider: 'local',
              email: normalizeEmail(invitation.email),
              emailVerifiedAt: new Date(),
              name: body.name.trim(),
              passwordHash,
              status: 'active',
            },
          });
        }
        await this.bindInvitation(tx, invitation, user.id);
        return this.identityResult(user.id, tx);
      },
    );
  }

  async bindExistingInvitation(body: TenantChatInvitationBindDto) {
    return this.identityTransaction(
      async (tx) => {
        const preview = await this.findInvitation(tx, body.token);
        this.assertInvitationUsable(preview);
        await this.lockEmail(tx, preview.email);
        const invitation = await this.lockInvitation(tx, body.token);
        this.assertInvitationUsable(invitation);
        const user = await tx.user.findUnique({ where: { id: body.userId } });
        if (!user || user.deletedAt || user.status !== 'active') {
          this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'Authentication is required.');
        }
        if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
          this.fail(
            HttpStatus.CONFLICT,
            'CHAT_INVITATION_EMAIL_MISMATCH',
            'The authenticated account does not match this invitation.',
          );
        }
        await this.bindInvitation(tx, invitation, user.id);
        return this.identityResult(user.id, tx);
      },
    );
  }

  startGoogle(state: string) {
    return {
      authorizationUrl: this.google.buildAuthorizationUrl(
        state,
        this.config.getOrThrow<string>('TENANT_CHAT_GOOGLE_REDIRECT_URI'),
      ),
    };
  }

  async completeGoogle(body: TenantChatGoogleCompleteDto) {
    const redirectUri = this.config.getOrThrow<string>('TENANT_CHAT_GOOGLE_REDIRECT_URI');
    const token = await this.google.exchangeCode(body.code, redirectUri);
    const profile = await this.google.getProfile(token.accessToken);
    if (!profile.emailVerified) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'Google email verification is required.');
    }

    return this.identityTransaction(
      async (tx) => {
        const email = normalizeEmail(profile.email);
        await this.lockEmail(tx, email);
        let oauth = await tx.oAuthAccount.findUnique({
          where: {
            provider_providerSubject: {
              provider: 'google',
              providerSubject: profile.providerSubject,
            },
          },
          include: { user: true },
        });
        let user = oauth?.user;

        if (!user) {
          const users = await this.findUsersByEmail(tx, email);
          if (users.length > 1) {
            this.fail(HttpStatus.CONFLICT, 'CHAT_AUTH_REQUIRED', 'Account identity is ambiguous.');
          }
          user = users[0];
        }

        let invitation: Awaited<ReturnType<typeof this.lockInvitation>> | undefined;
        if (body.invitationToken) {
          invitation = await this.lockInvitation(tx, body.invitationToken);
          this.assertInvitationUsable(invitation);
          if (normalizeEmail(invitation.email) !== email) {
            this.fail(
              HttpStatus.CONFLICT,
              'CHAT_INVITATION_EMAIL_MISMATCH',
              'The Google account does not match this invitation.',
            );
          }
        }

        if (!user) {
          if (!invitation) {
            this.fail(
              HttpStatus.UNAUTHORIZED,
              'CHAT_AUTH_REQUIRED',
              'A valid invitation is required for a new Chat account.',
            );
          }
          user = await tx.user.create({
            data: {
              authProvider: 'google',
              email,
              emailVerifiedAt: new Date(),
              name: profile.name,
              passwordHash: null,
              status: 'active',
            },
          });
        } else if (user.deletedAt || user.status !== 'active') {
          this.fail(HttpStatus.FORBIDDEN, 'CHAT_USER_DISABLED', 'This account is not active.');
        } else if (normalizeEmail(user.email) !== email) {
          this.fail(
            HttpStatus.CONFLICT,
            'CHAT_INVITATION_EMAIL_MISMATCH',
            'The Google account email does not match the GateLM account.',
          );
        }

        if (!oauth) {
          oauth = await tx.oAuthAccount.create({
            data: {
              email,
              provider: 'google',
              providerSubject: profile.providerSubject,
              userId: user.id,
            },
            include: { user: true },
          });
        }

        if (invitation) {
          await this.bindInvitation(tx, invitation, user.id);
        }
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return this.identityResult(user.id, tx);
      },
    );
  }

  async getEntitlement(userId: string, tenantId: string) {
    const entitlements = await this.listEntitlements(this.prisma, userId);
    const entitlement = entitlements.find((item) => item.tenantId === tenantId);
    if (!entitlement) {
      this.fail(HttpStatus.FORBIDDEN, 'CHAT_MEMBERSHIP_DISABLED', 'Tenant access is not active.');
    }
    return entitlement;
  }

  async getEntitlements(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== 'active') {
      this.fail(HttpStatus.FORBIDDEN, 'CHAT_USER_DISABLED', 'This account is not active.');
    }
    return {
      tenants: await this.listEntitlements(this.prisma, userId),
      user: {
        actorAuthzVersion: user.actorAuthzVersion,
        email: normalizeEmail(user.email),
        hasLocalPassword: Boolean(user.passwordHash),
        id: user.id,
        name: user.name,
      },
    };
  }

  private async identityResult(userId: string, db: PrismaService | Transaction = this.prisma) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.fail(HttpStatus.UNAUTHORIZED, 'CHAT_AUTH_REQUIRED', 'Authentication is required.');
    }
    const tenants = await this.listEntitlements(db, user.id);
    if (tenants.length === 0) {
      this.fail(HttpStatus.FORBIDDEN, 'CHAT_MEMBERSHIP_DISABLED', 'No active tenant access exists.');
    }
    return {
      tenants,
      user: {
        actorAuthzVersion: user.actorAuthzVersion,
        email: normalizeEmail(user.email),
        hasLocalPassword: Boolean(user.passwordHash),
        id: user.id,
        name: user.name,
      },
    };
  }

  private async listEntitlements(db: PrismaService | Transaction, userId: string) {
    const actor = await db.user.findUnique({
      where: { id: userId },
      select: { actorAuthzVersion: true },
    });
    if (!actor) return [];
    const memberships = await db.tenantMembership.findMany({
      where: { deletedAt: null, status: 'active', userId },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    const employeeTenantIds = memberships
      .filter((membership) => membership.role !== 'tenant_admin' && membership.tenant.status === 'ACTIVE')
      .map((membership) => membership.tenantId);
    const employees = employeeTenantIds.length > 0
      ? await db.employee.findMany({
          where: {
            deletedAt: null,
            status: 'active',
            tenantId: { in: employeeTenantIds },
            userId,
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, tenantId: true },
        })
      : [];
    const employeesByTenantId = new Map<string, (typeof employees)[number]>();
    for (const employee of employees) {
      if (!employeesByTenantId.has(employee.tenantId)) employeesByTenantId.set(employee.tenantId, employee);
    }
    const result: Array<Record<string, unknown>> = [];
    for (const membership of memberships) {
      if (membership.tenant.status !== 'ACTIVE') continue;
      const actorKind = membership.role === 'tenant_admin' ? 'tenant_admin' : 'employee';
      const employee = actorKind === 'employee' ? employeesByTenantId.get(membership.tenantId) : undefined;
      if (actorKind === 'employee' && !employee) continue;
      result.push({
        actorAuthzVersion: actor.actorAuthzVersion,
        actorKind,
        employeeId: employee?.id ?? null,
        membershipId: membership.id,
        status: 'active',
        tenantAuthzVersion: membership.tenant.authzVersion,
        tenantId: membership.tenantId,
        tenantName: membership.tenant.name,
        userId,
      });
    }
    return result;
  }

  private async bindInvitation(
    tx: Transaction,
    invitation: NonNullable<Awaited<ReturnType<typeof this.findInvitation>>>,
    userId: string,
  ) {
    const now = new Date();
    await tx.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
      create: {
        joinedAt: now,
        role: 'employee',
        status: 'active',
        tenantId: invitation.tenantId,
        userId,
      },
      update: { deletedAt: null, joinedAt: now, status: 'active' },
    });
    await tx.employee.update({
      where: { id: invitation.id },
      data: {
        acceptedAt: now,
        invitationRevokedAt: null,
        invitationStatus: 'accepted',
        invitationTokenHash: null,
        status: 'active',
        userId,
      },
    });
  }

  private async lockInvitation(tx: Transaction, token: string) {
    const tokenHash = hashSecret(token);
    await tx.$queryRaw`SELECT "id" FROM "employees" WHERE "invitationTokenHash" = ${tokenHash} FOR UPDATE`;
    return this.findInvitation(tx, token);
  }

  private findInvitation(db: PrismaService | Transaction, token: string) {
    return db.employee.findUnique({
      where: { invitationTokenHash: hashSecret(token) },
      include: { tenant: true },
    });
  }

  private assertInvitationUsable(
    invitation: Awaited<ReturnType<typeof this.findInvitation>>,
  ): asserts invitation is NonNullable<typeof invitation> {
    if (!invitation || invitation.deletedAt) {
      this.fail(HttpStatus.CONFLICT, 'CHAT_INVITATION_INVALID', 'This invitation is invalid.');
    }
    if (invitation.tenant.status !== 'ACTIVE') {
      this.fail(HttpStatus.FORBIDDEN, 'CHAT_TENANT_DISABLED', 'This tenant is not active.');
    }
    if (invitation.invitationRevokedAt || invitation.invitationStatus === 'revoked') {
      this.fail(HttpStatus.CONFLICT, 'CHAT_INVITATION_REVOKED', 'This invitation is revoked.');
    }
    if (invitation.invitationStatus !== 'pending' || invitation.acceptedAt) {
      this.fail(HttpStatus.CONFLICT, 'CHAT_INVITATION_REVOKED', 'This invitation is no longer available.');
    }
    if (!invitation.invitationExpiresAt || invitation.invitationExpiresAt <= new Date()) {
      this.fail(HttpStatus.CONFLICT, 'CHAT_INVITATION_EXPIRED', 'This invitation has expired.');
    }
  }

  private async findUsersByEmail(db: PrismaService | Transaction, email: string) {
    return db.user.findMany({
      where: {
        deletedAt: null,
        email: { equals: normalizeEmail(email), mode: 'insensitive' },
      },
      orderBy: { createdAt: 'asc' },
      take: 2,
    });
  }

  private async invitationAccountState(
    db: PrismaService | Transaction,
    users: User[],
  ): Promise<InvitationAccountState> {
    if (users.length === 0) return 'new';
    if (users.length !== 1) return 'existing';
    return (await this.isReclaimableLocalAccount(db, users[0]!))
      ? 'reclaimable'
      : 'existing';
  }

  private async isReclaimableLocalAccount(
    db: PrismaService | Transaction,
    user: User,
  ): Promise<boolean> {
    if (user.authProvider !== 'local' || user.deletedAt || user.status !== 'active') {
      return false;
    }

    const [activeMemberships, linkedEmployeeCount, projectAdminCount, tenantAdminCount] =
      await Promise.all([
        db.tenantMembership.findMany({
          where: { deletedAt: null, status: 'active', userId: user.id },
          select: { role: true },
        }),
        db.employee.count({
          where: {
            deletedAt: null,
            status: { not: 'archived' },
            userId: user.id,
          },
        }),
        db.projectAdmin.count({ where: { userId: user.id } }),
        db.tenantAdmin.count({ where: { userId: user.id } }),
      ]);

    return (
      linkedEmployeeCount === 0 &&
      projectAdminCount === 0 &&
      tenantAdminCount === 0 &&
      activeMemberships.every((membership) => membership.role === 'employee')
    );
  }

  private async revokeAccountSessions(
    tx: Transaction,
    userId: string,
    revokedAt: Date,
  ): Promise<void> {
    await tx.authSession.updateMany({
      where: { revokedAt: null, userId },
      data: { revokedAt },
    });
    await tx.tenantChatRefreshToken.updateMany({
      where: { revokedAt: null, session: { userId } },
      data: { revokedAt },
    });
    await tx.tenantChatSession.updateMany({
      where: { revokedAt: null, userId },
      data: { revokeReason: 'account_reclaimed', revokedAt },
    });
  }

  private async lockEmail(tx: Transaction, email: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalizeEmail(email)}, 0))`;
  }

  private async identityTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.fail(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CHAT_IDENTITY_UNAVAILABLE',
        'Tenant Chat identity mutation is temporarily unavailable.',
      );
    }
  }

  private fail(status: HttpStatus, code: string, message: string): never {
    throw new HttpException({ code, message }, status);
  }
}

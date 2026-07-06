import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  AuthRepository,
  AuthSession,
  AuthSessionKind,
  AuthSessionWithUser,
  AuthTenant,
  AuthTenantMembership,
  AuthUser,
  EmailVerificationCode,
  OAuthAccount,
  OAuthAccountWithUser,
} from './auth.repository';

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async consumeOpenVerificationCodes(
    userId: string,
    consumedAt: Date,
  ): Promise<void> {
    await this.prisma.emailVerificationCode.updateMany({
      data: { consumedAt },
      where: {
        consumedAt: null,
        userId,
      },
    });
  }

  async consumeVerificationCode(id: string, consumedAt: Date): Promise<void> {
    await this.prisma.emailVerificationCode.update({
      data: { consumedAt },
      where: { id },
    });
  }

  async createGoogleUserWithOAuth(input: {
    email: string;
    emailVerifiedAt: Date;
    name: string | null;
    provider: string;
    providerSubject: string;
  }): Promise<{ oauthAccount: OAuthAccount; user: AuthUser }> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          authProvider: input.provider,
          email: input.email,
          emailVerifiedAt: input.emailVerifiedAt,
          name: input.name,
          passwordHash: null,
          status: 'active',
        },
      });
      const oauthAccount = await tx.oAuthAccount.create({
        data: {
          email: input.email,
          provider: input.provider,
          providerSubject: input.providerSubject,
          userId: user.id,
        },
      });

      return { oauthAccount, user };
    });
  }

  async createOAuthAccount(input: {
    email: string;
    provider: string;
    providerSubject: string;
    userId: string;
  }): Promise<OAuthAccount> {
    return this.prisma.oAuthAccount.create({
      data: input,
    });
  }

  async createSession(input: {
    expiresAt: Date;
    kind: AuthSessionKind;
    sessionTokenHash: string;
    userId: string;
  }): Promise<AuthSession> {
    return this.prisma.authSession.create({
      data: input,
    });
  }

  async createTenantAndMembership(input: {
    organizationName: string;
    userId: string;
  }): Promise<{ membership: AuthTenantMembership; tenant: AuthTenant }> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.organizationName,
        },
      });
      const membership = await tx.tenantMembership.create({
        data: {
          joinedAt: new Date(),
          role: 'tenant_admin',
          status: 'active',
          tenantId: tenant.id,
          userId: input.userId,
        },
        include: {
          tenant: true,
        },
      });

      return { membership, tenant };
    });
  }

  async createUser(input: {
    authProvider: string;
    email: string;
    emailVerifiedAt?: Date | null;
    name: string | null;
    passwordHash: string | null;
    status: string;
  }): Promise<AuthUser> {
    return this.prisma.user.create({
      data: {
        authProvider: input.authProvider,
        email: input.email,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        name: input.name,
        passwordHash: input.passwordHash,
        status: input.status,
      },
    });
  }

  async createVerificationCode(input: {
    codeHash: string;
    expiresAt: Date;
    userId: string;
  }): Promise<EmailVerificationCode> {
    return this.prisma.emailVerificationCode.create({
      data: input,
    });
  }

  async findActiveSessionByTokenHash(
    sessionTokenHash: string,
    now: Date,
  ): Promise<AuthSessionWithUser | null> {
    return this.prisma.authSession.findFirst({
      include: {
        user: true,
      },
      where: {
        expiresAt: { gt: now },
        revokedAt: null,
        sessionTokenHash,
        user: {
          deletedAt: null,
        },
      },
    });
  }

  async findLatestOpenVerificationCode(
    userId: string,
    now: Date,
  ): Promise<EmailVerificationCode | null> {
    return this.prisma.emailVerificationCode.findFirst({
      orderBy: { createdAt: 'desc' },
      where: {
        consumedAt: null,
        expiresAt: { gt: now },
        userId,
      },
    });
  }

  async findMembershipsByUserId(
    userId: string,
  ): Promise<AuthTenantMembership[]> {
    return this.prisma.tenantMembership.findMany({
      include: {
        tenant: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: {
        deletedAt: null,
        status: 'active',
        userId,
      },
    });
  }

  async findOAuthAccount(
    provider: string,
    providerSubject: string,
  ): Promise<OAuthAccountWithUser | null> {
    return this.prisma.oAuthAccount.findUnique({
      include: {
        user: true,
      },
      where: {
        provider_providerSubject: {
          provider,
          providerSubject,
        },
      },
    });
  }

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        email,
      },
    });
  }

  async recordVerificationCodeFailure(
    id: string,
    input: { consumedAt: Date | null },
  ): Promise<void> {
    await this.prisma.emailVerificationCode.update({
      data: {
        consumedAt: input.consumedAt ?? undefined,
        failedAttemptCount: {
          increment: 1,
        },
      },
      where: { id },
    });
  }

  async revokeSession(id: string, revokedAt: Date): Promise<void> {
    await this.prisma.authSession.update({
      data: { revokedAt },
      where: { id },
    });
  }

  async updateUserEmailVerified(
    userId: string,
    verifiedAt: Date,
  ): Promise<AuthUser> {
    return this.prisma.user.update({
      data: {
        emailVerifiedAt: verifiedAt,
        status: 'active',
      },
      where: { id: userId },
    });
  }

  async updateUserLastLogin(userId: string, lastLoginAt: Date): Promise<void> {
    await this.prisma.user.update({
      data: { lastLoginAt },
      where: { id: userId },
    });
  }
}

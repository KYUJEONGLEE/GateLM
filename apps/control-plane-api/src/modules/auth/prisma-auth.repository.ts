import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  AuthProjectAdmin,
  AuthProjectAdminInvitation,
  AuthRepository,
  AuthSession,
  AuthSessionKind,
  AuthSessionWithUser,
  AuthTenant,
  AuthTenantAdmin,
  AuthTenantMembership,
  AuthUser,
  EmailVerificationCode,
  OAuthAccount,
  OAuthAccountWithUser,
} from './auth.repository';

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async acceptProjectAdminInvitation(input: {
    acceptedAt: Date;
    email: string;
    tokenHash: string;
    userId: string;
  }): Promise<AuthProjectAdminInvitation> {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.projectAdminInvitation.findFirst({
        include: {
          project: true,
          tenant: true,
        },
        where: {
          acceptedAt: null,
          email: input.email,
          expiresAt: { gt: input.acceptedAt },
          revokedAt: null,
          status: 'pending',
          tokenHash: input.tokenHash,
        },
      });
      if (!invitation) {
        throw new Error('Project admin invitation not found.');
      }

      const existingActiveMembership = await tx.tenantMembership.findFirst({
        where: {
          deletedAt: null,
          status: 'active',
          tenantId: invitation.tenantId,
          userId: input.userId,
        },
      });

      if (!existingActiveMembership) {
        const existingMembership = await tx.tenantMembership.findFirst({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          where: {
            tenantId: invitation.tenantId,
            userId: input.userId,
          },
        });

        if (existingMembership) {
          await tx.tenantMembership.update({
            data: {
              deletedAt: null,
              joinedAt: input.acceptedAt,
              role: 'project_admin',
              status: 'active',
            },
            where: { id: existingMembership.id },
          });
        } else {
          await tx.tenantMembership.create({
            data: {
              joinedAt: input.acceptedAt,
              role: 'project_admin',
              status: 'active',
              tenantId: invitation.tenantId,
              userId: input.userId,
            },
          });
        }
      }

      await tx.projectAdmin.upsert({
        create: {
          projectId: invitation.projectId,
          tenantId: invitation.tenantId,
          userId: input.userId,
        },
        update: {
          tenantId: invitation.tenantId,
        },
        where: {
          projectId_userId: {
            projectId: invitation.projectId,
            userId: input.userId,
          },
        },
      });

      return tx.projectAdminInvitation.update({
        data: {
          acceptedAt: input.acceptedAt,
          status: 'accepted',
        },
        include: {
          project: true,
          tenant: true,
        },
        where: { id: invitation.id },
      });
    });
  }

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

  async createProjectAdminInvitation(input: {
    email: string;
    expiresAt: Date;
    invitedByUserId?: string | null;
    name?: string | null;
    projectId: string;
    tenantId: string;
    tokenHash: string;
  }): Promise<AuthProjectAdminInvitation> {
    return this.prisma.projectAdminInvitation.create({
      data: {
        email: input.email,
        expiresAt: input.expiresAt,
        invitedByUserId: input.invitedByUserId ?? null,
        name: input.name?.trim() || input.email,
        projectId: input.projectId,
        tenantId: input.tenantId,
        tokenHash: input.tokenHash,
      },
      include: {
        project: true,
        tenant: true,
      },
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

  async createLocalUserTenantAndMembership(input: {
    email: string;
    emailVerifiedAt: Date;
    name: string | null;
    organizationName: string;
    passwordHash: string;
  }): Promise<{
    membership: AuthTenantMembership;
    tenant: AuthTenant;
    user: AuthUser;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          deletedAt: null,
          email: input.email,
        },
      });
      let user: AuthUser;

      if (existingUser) {
        const activeMembershipCount = await tx.tenantMembership.count({
          where: {
            deletedAt: null,
            status: 'active',
            userId: existingUser.id,
          },
        });
        if (
          activeMembershipCount > 0 ||
          existingUser.authProvider !== 'local'
        ) {
          throw new Error('EMAIL_ALREADY_REGISTERED');
        }

        user = await tx.user.update({
          data: {
            authProvider: 'local',
            emailVerifiedAt: input.emailVerifiedAt,
            name: input.name,
            passwordHash: input.passwordHash,
            status: 'active',
          },
          where: { id: existingUser.id },
        });
      } else {
        user = await tx.user.create({
          data: {
            authProvider: 'local',
            email: input.email,
            emailVerifiedAt: input.emailVerifiedAt,
            name: input.name,
            passwordHash: input.passwordHash,
            status: 'active',
          },
        });
      }

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
          userId: user.id,
        },
        include: {
          tenant: true,
        },
      });

      return { membership, tenant, user };
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
      await tx.tenantAdmin.create({
        data: {
          tenantId: tenant.id,
          userId: input.userId,
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

  async findTenantAdminsByUserId(userId: string): Promise<AuthTenantAdmin[]> {
    return this.prisma.tenantAdmin.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: {
        userId,
      },
    });
  }
  async findProjectAdminsByUserId(userId: string): Promise<AuthProjectAdmin[]> {
    return this.prisma.projectAdmin.findMany({
      include: {
        project: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: {
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

  async findProjectAdminInvitationByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthProjectAdminInvitation | null> {
    return this.prisma.projectAdminInvitation.findFirst({
      include: {
        project: true,
        tenant: true,
      },
      where: {
        acceptedAt: null,
        expiresAt: { gt: now },
        revokedAt: null,
        status: 'pending',
        tokenHash,
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


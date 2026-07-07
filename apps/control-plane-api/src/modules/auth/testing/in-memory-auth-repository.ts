import {
  AuthProject,
  AuthProjectAdminInvitation,
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
} from '../auth.repository';

interface AuthRepositoryState {
  authSessions: AuthSession[];
  emailVerificationCodes: EmailVerificationCode[];
  oauthAccounts: OAuthAccount[];
  projectAdminInvitations: AuthProjectAdminInvitation[];
  projectAdmins: Array<{
    createdAt: Date;
    id: string;
    projectId: string;
    tenantId: string;
    updatedAt: Date;
    userId: string;
  }>;
  projects: AuthProject[];
  tenantAdmins: Array<{
    createdAt: Date;
    id: string;
    tenantId: string;
    updatedAt: Date;
    userId: string;
  }>;
  tenantMemberships: AuthTenantMembership[];
  tenants: AuthTenant[];
  users: AuthUser[];
}

function cloneState(state: AuthRepositoryState): AuthRepositoryState {
  return {
    authSessions: [...state.authSessions],
    emailVerificationCodes: [...state.emailVerificationCodes],
    oauthAccounts: [...state.oauthAccounts],
    projectAdminInvitations: [...state.projectAdminInvitations],
    projectAdmins: [...state.projectAdmins],
    projects: [...state.projects],
    tenantAdmins: [...state.tenantAdmins],
    tenantMemberships: [...state.tenantMemberships],
    tenants: [...state.tenants],
    users: [...state.users],
  };
}

export function createInMemoryAuthRepository(): AuthRepository & {
  dump(): AuthRepositoryState;
} {
  const state: AuthRepositoryState = {
    authSessions: [],
    emailVerificationCodes: [],
    oauthAccounts: [],
    projectAdminInvitations: [],
    projectAdmins: [],
    projects: [],
    tenantAdmins: [],
    tenantMemberships: [],
    tenants: [],
    users: [],
  };
  let nextId = 1;

  function id(): string {
    const value = String(nextId).padStart(12, '0');
    nextId += 1;
    return `00000000-0000-4000-8000-${value}`;
  }

  function now(): Date {
    return new Date();
  }

  function ensureTenant(tenantId: string): AuthTenant {
    let tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant) {
      const createdAt = now();
      tenant = {
        createdAt,
        id: tenantId,
        name: 'Invited Tenant',
        status: 'ACTIVE',
        updatedAt: createdAt,
      };
      state.tenants.push(tenant);
    }

    return tenant;
  }

  function ensureProject(projectId: string, tenantId: string): AuthProject {
    let project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      const createdAt = now();
      project = {
        createdAt,
        id: projectId,
        name: 'Invited Project',
        status: 'ACTIVE',
        tenantId,
        updatedAt: createdAt,
      };
      state.projects.push(project);
    }

    return project;
  }

  const repository: AuthRepository & { dump(): AuthRepositoryState } = {
    async acceptProjectAdminInvitation(input) {
      const invitation = state.projectAdminInvitations.find(
        (item) =>
          item.tokenHash === input.tokenHash &&
          item.email === input.email &&
          item.status === 'pending' &&
          item.acceptedAt === null &&
          item.revokedAt === null &&
          item.expiresAt > input.acceptedAt,
      );
      if (!invitation) {
        throw new Error('Project admin invitation not found.');
      }

      const tenant = ensureTenant(invitation.tenantId);
      const project = ensureProject(invitation.projectId, invitation.tenantId);
      const existingMembership = state.tenantMemberships.find(
        (item) =>
          item.tenantId === invitation.tenantId &&
          item.userId === input.userId &&
          item.status === 'active' &&
          item.deletedAt === null,
      );
      if (!existingMembership) {
        state.tenantMemberships.push({
          createdAt: input.acceptedAt,
          deletedAt: null,
          id: id(),
          joinedAt: input.acceptedAt,
          role: 'project_admin',
          status: 'active',
          tenant,
          tenantId: invitation.tenantId,
          updatedAt: input.acceptedAt,
          userId: input.userId,
        });
      }

      if (
        !state.projectAdmins.some(
          (item) =>
            item.projectId === invitation.projectId &&
            item.userId === input.userId,
        )
      ) {
        state.projectAdmins.push({
          createdAt: input.acceptedAt,
          id: id(),
          projectId: invitation.projectId,
          tenantId: invitation.tenantId,
          updatedAt: input.acceptedAt,
          userId: input.userId,
        });
      }

      invitation.acceptedAt = input.acceptedAt;
      invitation.project = project;
      invitation.status = 'accepted';
      invitation.tenant = tenant;
      invitation.updatedAt = input.acceptedAt;
      return invitation;
    },

    async consumeOpenVerificationCodes(userId, consumedAt) {
      for (const code of state.emailVerificationCodes) {
        if (code.userId === userId && code.consumedAt === null) {
          code.consumedAt = consumedAt;
        }
      }
    },

    async consumeVerificationCode(codeId, consumedAt) {
      const code = state.emailVerificationCodes.find((item) => item.id === codeId);
      if (code) {
        code.consumedAt = consumedAt;
      }
    },

    async createGoogleUserWithOAuth(input) {
      const user = await repository.createUser({
        authProvider: input.provider,
        email: input.email,
        emailVerifiedAt: input.emailVerifiedAt,
        name: input.name,
        passwordHash: null,
        status: 'active',
      });
      const oauthAccount = await repository.createOAuthAccount({
        email: input.email,
        provider: input.provider,
        providerSubject: input.providerSubject,
        userId: user.id,
      });

      return { oauthAccount, user };
    },

    async createOAuthAccount(input) {
      const createdAt = now();
      const oauthAccount: OAuthAccount = {
        createdAt,
        email: input.email,
        id: id(),
        provider: input.provider,
        providerSubject: input.providerSubject,
        updatedAt: createdAt,
        userId: input.userId,
      };
      state.oauthAccounts.push(oauthAccount);
      return oauthAccount;
    },

    async createProjectAdminInvitation(input) {
      const createdAt = now();
      const tenant = ensureTenant(input.tenantId);
      const project = ensureProject(input.projectId, input.tenantId);
      const invitation: AuthProjectAdminInvitation = {
        acceptedAt: null,
        createdAt,
        email: input.email,
        expiresAt: input.expiresAt,
        id: id(),
        invitedByUserId: input.invitedByUserId ?? null,
        name: input.name?.trim() || input.email,
        project,
        projectId: input.projectId,
        revokedAt: null,
        status: 'pending',
        tenant,
        tenantId: input.tenantId,
        tokenHash: input.tokenHash,
        updatedAt: createdAt,
      };
      state.projectAdminInvitations.push(invitation);
      return invitation;
    },

    async createSession(input) {
      const authSession: AuthSession = {
        createdAt: now(),
        expiresAt: input.expiresAt,
        id: id(),
        kind: input.kind,
        revokedAt: null,
        sessionTokenHash: input.sessionTokenHash,
        userId: input.userId,
      };
      state.authSessions.push(authSession);
      return authSession;
    },

    async createTenantAndMembership(input) {
      const createdAt = now();
      const tenant: AuthTenant = {
        createdAt,
        id: id(),
        name: input.organizationName,
        status: 'ACTIVE',
        updatedAt: createdAt,
      };
      const membership: AuthTenantMembership = {
        createdAt,
        deletedAt: null,
        id: id(),
        joinedAt: createdAt,
        role: 'tenant_admin',
        status: 'active',
        tenant,
        tenantId: tenant.id,
        updatedAt: createdAt,
        userId: input.userId,
      };
      state.tenants.push(tenant);
      state.tenantMemberships.push(membership);
      state.tenantAdmins.push({
        createdAt,
        id: id(),
        tenantId: tenant.id,
        updatedAt: createdAt,
        userId: input.userId,
      });

      return { membership, tenant };
    },

    async createUser(input) {
      const createdAt = now();
      const user: AuthUser = {
        authProvider: input.authProvider,
        createdAt,
        deletedAt: null,
        email: input.email,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        id: id(),
        lastLoginAt: null,
        name: input.name,
        passwordHash: input.passwordHash,
        status: input.status,
        updatedAt: createdAt,
      };
      state.users.push(user);
      return user;
    },

    async createVerificationCode(input) {
      const verificationCode: EmailVerificationCode = {
        codeHash: input.codeHash,
        consumedAt: null,
        createdAt: now(),
        expiresAt: input.expiresAt,
        failedAttemptCount: 0,
        id: id(),
        userId: input.userId,
      };
      state.emailVerificationCodes.push(verificationCode);
      return verificationCode;
    },

    dump() {
      return cloneState(state);
    },

    async findActiveSessionByTokenHash(
      sessionTokenHash: string,
      activeAt: Date,
    ): Promise<AuthSessionWithUser | null> {
      const session = state.authSessions.find(
        (item) =>
          item.sessionTokenHash === sessionTokenHash &&
          item.revokedAt === null &&
          item.expiresAt > activeAt,
      );
      if (!session) {
        return null;
      }

      const user = state.users.find((item) => item.id === session.userId);
      return user ? { ...session, user } : null;
    },

    async findLatestOpenVerificationCode(userId, activeAt) {
      return (
        [...state.emailVerificationCodes]
          .reverse()
          .find(
            (item) =>
              item.userId === userId &&
              item.consumedAt === null &&
              item.expiresAt > activeAt,
          ) ?? null
      );
    },

    async findMembershipsByUserId(userId) {
      return state.tenantMemberships.filter(
        (item) =>
          item.userId === userId &&
          item.status === 'active' &&
          item.deletedAt === null,
      );
    },

    async findOAuthAccount(provider, providerSubject) {
      const oauthAccount = state.oauthAccounts.find(
        (item) =>
          item.provider === provider && item.providerSubject === providerSubject,
      );
      if (!oauthAccount) {
        return null;
      }

      const user = state.users.find((item) => item.id === oauthAccount.userId);
      return user ? { ...oauthAccount, user } : null;
    },

    async findProjectAdminInvitationByTokenHash(tokenHash, activeAt) {
      return (
        state.projectAdminInvitations.find(
          (item) =>
            item.tokenHash === tokenHash &&
            item.status === 'pending' &&
            item.acceptedAt === null &&
            item.revokedAt === null &&
            item.expiresAt > activeAt,
        ) ?? null
      );
    },

    async findUserByEmail(email) {
      return (
        state.users.find(
          (item) => item.email === email && item.deletedAt === null,
        ) ?? null
      );
    },

    async recordVerificationCodeFailure(codeId, input) {
      const code = state.emailVerificationCodes.find((item) => item.id === codeId);
      if (code) {
        code.failedAttemptCount += 1;
        code.consumedAt = input.consumedAt;
      }
    },

    async revokeSession(sessionId, revokedAt) {
      const session = state.authSessions.find((item) => item.id === sessionId);
      if (session) {
        session.revokedAt = revokedAt;
      }
    },

    async updateUserEmailVerified(userId, verifiedAt) {
      const user = state.users.find((item) => item.id === userId);
      if (!user) {
        throw new Error('User not found.');
      }

      user.emailVerifiedAt = verifiedAt;
      user.status = 'active';
      user.updatedAt = verifiedAt;
      return user;
    },

    async updateUserLastLogin(userId, lastLoginAt) {
      const user = state.users.find((item) => item.id === userId);
      if (user) {
        user.lastLoginAt = lastLoginAt;
      }
    },
  };

  return repository;
}

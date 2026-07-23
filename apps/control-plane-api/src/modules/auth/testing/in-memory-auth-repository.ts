import {
  AuthEmployeeInvitation,
  AuthProject,
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
  PasswordResetToken,
  OAuthAccount,
  OAuthAccountWithUser,
} from '../auth.repository';

interface AuthRepositoryState {
  authSessions: AuthSession[];
  emailVerificationCodes: EmailVerificationCode[];
  passwordResetTokens: PasswordResetToken[];
  oauthAccounts: OAuthAccount[];
  projectAdminInvitations: AuthProjectAdminInvitation[];
  projectAdmins: AuthProjectAdmin[];
  projects: AuthProject[];
  tenantAdmins: AuthTenantAdmin[];
  tenantMemberships: AuthTenantMembership[];
  tenants: AuthTenant[];
  users: AuthUser[];
}

function cloneState(state: AuthRepositoryState): AuthRepositoryState {
  return {
    authSessions: [...state.authSessions],
    emailVerificationCodes: [...state.emailVerificationCodes],
    passwordResetTokens: [...state.passwordResetTokens],
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
    passwordResetTokens: [],
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
    async acceptEmployeeInvitation(input) {
      let user = state.users.find(
        (item) => item.email === input.email && item.deletedAt === null,
      );
      if (user) {
        user.authProvider = 'local';
        user.emailVerifiedAt = input.acceptedAt;
        user.name = input.name ?? user.name;
        user.passwordHash = input.passwordHash;
        user.status = 'active';
        user.updatedAt = input.acceptedAt;
      } else {
        user = await repository.createUser({
          authProvider: 'local',
          email: input.email,
          emailVerifiedAt: input.acceptedAt,
          name: input.name,
          passwordHash: input.passwordHash,
          status: 'active',
        });
      }

      const tenant = ensureTenant('00000000-0000-4000-8000-000000000777');
      let membership = state.tenantMemberships.find(
        (item) => item.tenantId === tenant.id && item.userId === user.id,
      );
      if (membership) {
        membership.deletedAt = null;
        membership.joinedAt = input.acceptedAt;
        membership.role = 'employee';
        membership.status = 'active';
        membership.updatedAt = input.acceptedAt;
      } else {
        membership = {
          createdAt: input.acceptedAt,
          deletedAt: null,
          id: id(),
          joinedAt: input.acceptedAt,
          role: 'employee',
          status: 'active',
          tenant,
          tenantId: tenant.id,
          updatedAt: input.acceptedAt,
          userId: user.id,
        };
        state.tenantMemberships.push(membership);
      }

      const employeeInvitation: AuthEmployeeInvitation = {
        acceptedAt: input.acceptedAt,
        email: input.email,
        employeeId: id(),
        expiresAt: input.acceptedAt,
        name: input.name,
        status: 'accepted',
        tenant,
        tenantId: tenant.id,
      };

      return { employeeInvitation, membership, user };
    },

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

    async createLocalUserTenantAndMembership(input) {
      const existingUser = state.users.find(
        (item) => item.email === input.email && item.deletedAt === null,
      );
      let user: AuthUser;

      if (existingUser) {
        const hasActiveMembership = state.tenantMemberships.some(
          (item) =>
            item.userId === existingUser.id &&
            item.status === 'active' &&
            item.deletedAt === null,
        );
        if (hasActiveMembership || existingUser.authProvider !== 'local') {
          throw new Error('EMAIL_ALREADY_REGISTERED');
        }

        existingUser.authProvider = 'local';
        existingUser.emailVerifiedAt = input.emailVerifiedAt;
        existingUser.name = input.name;
        existingUser.passwordHash = input.passwordHash;
        existingUser.status = 'active';
        existingUser.updatedAt = input.emailVerifiedAt;
        user = existingUser;
      } else {
        user = await repository.createUser({
          authProvider: 'local',
          email: input.email,
          emailVerifiedAt: input.emailVerifiedAt,
          name: input.name,
          passwordHash: input.passwordHash,
          status: 'active',
        });
      }

      const created = await repository.createTenantAndMembership({
        organizationName: input.organizationName,
        userId: user.id,
      });

      return {
        ...created,
        user,
      };
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
        actorAuthzVersion: 1,
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

    async findTenantAdminsByUserId(userId) {
      return state.tenantAdmins.filter((item) => item.userId === userId);
    },
    async findProjectAdminsByUserId(userId) {
      return state.projectAdmins
        .filter((item) => item.userId === userId)
        .map((item) => ({
          ...item,
          project: state.projects.find((project) => project.id === item.projectId),
        }));
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

    async findUserById(userId) {
      return (
        state.users.find(
          (item) => item.id === userId && item.deletedAt === null,
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

    async countPasswordResetTokensSince(userId, since) {
      return state.passwordResetTokens.filter(
        (item) => item.userId === userId && item.createdAt >= since,
      ).length;
    },

    async createPasswordResetToken(input) {
      const token: PasswordResetToken = {
        consumedAt: null,
        createdAt: now(),
        expiresAt: input.expiresAt,
        id: id(),
        tokenHash: input.tokenHash,
        userId: input.userId,
      };
      state.passwordResetTokens.push(token);
      return token;
    },

    async findActivePasswordResetTokenByHash(tokenHash, activeAt) {
      const token = state.passwordResetTokens.find(
        (item) =>
          item.tokenHash === tokenHash &&
          item.consumedAt === null &&
          item.expiresAt > activeAt,
      );
      if (!token) {
        return null;
      }

      const user = state.users.find(
        (item) => item.id === token.userId && item.deletedAt === null,
      );
      return user ? { ...token, user } : null;
    },

    async completePasswordReset(input) {
      const token = state.passwordResetTokens.find(
        (item) =>
          item.id === input.tokenId &&
          item.userId === input.userId &&
          item.consumedAt === null &&
          item.expiresAt > input.changedAt,
      );
      const user = state.users.find(
        (item) => item.id === input.userId && item.deletedAt === null,
      );
      if (
        !token ||
        !user ||
        user.passwordHash !== input.expectedPasswordHash ||
        user.status !== 'active'
      ) {
        return null;
      }

      for (const resetToken of state.passwordResetTokens) {
        if (resetToken.userId === input.userId && resetToken.consumedAt === null) {
          resetToken.consumedAt = input.changedAt;
        }
      }
      for (const session of state.authSessions) {
        if (session.userId === input.userId && session.revokedAt === null) {
          session.revokedAt = input.changedAt;
        }
      }
      user.actorAuthzVersion += 1;
      user.passwordHash = input.passwordHash;
      user.updatedAt = input.changedAt;
      return user;
    },

    async rotatePasswordAndSession(input) {
      const currentSession = state.authSessions.find(
        (item) =>
          item.id === input.currentSessionId &&
          item.userId === input.userId &&
          item.kind === 'full' &&
          item.revokedAt === null &&
          item.expiresAt > input.changedAt,
      );
      const user = state.users.find(
        (item) => item.id === input.userId && item.deletedAt === null,
      );
      if (
        !currentSession ||
        !user ||
        user.passwordHash !== input.expectedPasswordHash ||
        user.status !== 'active'
      ) {
        return null;
      }

      for (const resetToken of state.passwordResetTokens) {
        if (resetToken.userId === input.userId && resetToken.consumedAt === null) {
          resetToken.consumedAt = input.changedAt;
        }
      }
      for (const session of state.authSessions) {
        if (session.userId === input.userId && session.revokedAt === null) {
          session.revokedAt = input.changedAt;
        }
      }
      user.actorAuthzVersion += 1;
      user.passwordHash = input.passwordHash;
      user.updatedAt = input.changedAt;

      const replacementSession: AuthSession = {
        createdAt: input.changedAt,
        expiresAt: input.session.expiresAt,
        id: id(),
        kind: input.session.kind,
        revokedAt: null,
        sessionTokenHash: input.session.sessionTokenHash,
        userId: input.userId,
      };
      state.authSessions.push(replacementSession);
      return replacementSession;
    },

    async changePasswordAndRevokeSessions(input) {
      const user = state.users.find(
        (item) => item.id === input.userId && item.deletedAt === null,
      );
      if (
        !user ||
        user.passwordHash !== input.expectedPasswordHash ||
        user.status !== 'active'
      ) {
        return null;
      }

      for (const resetToken of state.passwordResetTokens) {
        if (resetToken.userId === input.userId && resetToken.consumedAt === null) {
          resetToken.consumedAt = input.changedAt;
        }
      }
      for (const session of state.authSessions) {
        if (session.userId === input.userId && session.revokedAt === null) {
          session.revokedAt = input.changedAt;
        }
      }
      user.actorAuthzVersion += 1;
      user.passwordHash = input.passwordHash;
      user.updatedAt = input.changedAt;
      return user;
    },
  };

  return repository;
}

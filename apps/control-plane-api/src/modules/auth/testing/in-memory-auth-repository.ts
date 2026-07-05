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
} from '../auth.repository';

interface AuthRepositoryState {
  authSessions: AuthSession[];
  emailVerificationCodes: EmailVerificationCode[];
  oauthAccounts: OAuthAccount[];
  tenantMemberships: AuthTenantMembership[];
  tenants: AuthTenant[];
  users: AuthUser[];
}

function cloneState(state: AuthRepositoryState): AuthRepositoryState {
  return {
    authSessions: [...state.authSessions],
    emailVerificationCodes: [...state.emailVerificationCodes],
    oauthAccounts: [...state.oauthAccounts],
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

  const repository: AuthRepository & { dump(): AuthRepositoryState } = {
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

    async findUserByEmail(email) {
      return (
        state.users.find(
          (item) => item.email === email && item.deletedAt === null,
        ) ?? null
      );
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

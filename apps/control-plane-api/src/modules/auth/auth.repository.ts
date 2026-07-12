export type AuthSessionKind = 'full' | 'onboarding';

export class EmployeeInvitationNotFoundError extends Error {
  constructor() {
    super('Employee invitation not found.');
    this.name = 'EmployeeInvitationNotFoundError';
  }
}

export class EmployeeInvitationExistingAccountError extends Error {
  constructor() {
    super('Employee invitation belongs to an existing account.');
    this.name = 'EmployeeInvitationExistingAccountError';
  }
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  authProvider: string;
  status: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface AuthTenant {
  id: string;
  name: string;
  status: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthProject {
  id: string;
  tenantId: string;
  name: string;
  status: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthProjectAdmin {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  project?: AuthProject;
}

export interface AuthTenantAdmin {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  tenant?: AuthTenant;
}

export interface AuthProjectAdminInvitation {
  id: string;
  tenantId: string;
  projectId: string;
  email: string;
  name: string;
  tokenHash: string;
  status: string;
  invitedByUserId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tenant?: AuthTenant;
  project?: AuthProject;
}

export interface AuthEmployeeInvitation {
  acceptedAt: Date | null;
  email: string;
  employeeId: string;
  expiresAt: Date;
  name: string | null;
  status: string;
  tenant?: AuthTenant;
  tenantId: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  sessionTokenHash: string;
  kind: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface AuthSessionWithUser extends AuthSession {
  user: AuthUser;
}

export interface EmailVerificationCode {
  id: string;
  userId: string;
  codeHash: string;
  failedAttemptCount: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface OAuthAccount {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthAccountWithUser extends OAuthAccount {
  user: AuthUser;
}

export interface CreateUserInput {
  authProvider: string;
  email: string;
  emailVerifiedAt?: Date | null;
  name: string | null;
  passwordHash: string | null;
  status: string;
}

export interface AuthRepository {
  acceptEmployeeInvitation(input: {
    acceptedAt: Date;
    email: string;
    name: string | null;
    passwordHash: string;
    tokenHash: string;
  }): Promise<{
    employeeInvitation: AuthEmployeeInvitation;
    membership: AuthTenantMembership;
    user: AuthUser;
  }>;
  acceptProjectAdminInvitation(input: {
    acceptedAt: Date;
    email: string;
    tokenHash: string;
    userId: string;
  }): Promise<AuthProjectAdminInvitation>;
  consumeOpenVerificationCodes(userId: string, consumedAt: Date): Promise<void>;
  consumeVerificationCode(id: string, consumedAt: Date): Promise<void>;
  createGoogleUserWithOAuth(input: {
    email: string;
    emailVerifiedAt: Date;
    name: string | null;
    provider: string;
    providerSubject: string;
  }): Promise<{ oauthAccount: OAuthAccount; user: AuthUser }>;
  createOAuthAccount(input: {
    email: string;
    provider: string;
    providerSubject: string;
    userId: string;
  }): Promise<OAuthAccount>;
  createProjectAdminInvitation(input: {
    email: string;
    expiresAt: Date;
    invitedByUserId?: string | null;
    name?: string | null;
    projectId: string;
    tenantId: string;
    tokenHash: string;
  }): Promise<AuthProjectAdminInvitation>;
  createSession(input: {
    expiresAt: Date;
    kind: AuthSessionKind;
    sessionTokenHash: string;
    userId: string;
  }): Promise<AuthSession>;
  createLocalUserTenantAndMembership(input: {
    email: string;
    emailVerifiedAt: Date;
    name: string | null;
    organizationName: string;
    passwordHash: string;
  }): Promise<{
    membership: AuthTenantMembership;
    tenant: AuthTenant;
    user: AuthUser;
  }>;
  createTenantAndMembership(input: {
    organizationName: string;
    userId: string;
  }): Promise<{ membership: AuthTenantMembership; tenant: AuthTenant }>;
  createUser(input: CreateUserInput): Promise<AuthUser>;
  createVerificationCode(input: {
    codeHash: string;
    expiresAt: Date;
    userId: string;
  }): Promise<EmailVerificationCode>;
  findActiveSessionByTokenHash(
    sessionTokenHash: string,
    now: Date,
  ): Promise<AuthSessionWithUser | null>;
  findLatestOpenVerificationCode(
    userId: string,
    now: Date,
  ): Promise<EmailVerificationCode | null>;
  findMembershipsByUserId(userId: string): Promise<AuthTenantMembership[]>;
  findTenantAdminsByUserId(userId: string): Promise<AuthTenantAdmin[]>;
  findProjectAdminsByUserId(userId: string): Promise<AuthProjectAdmin[]>;
  findOAuthAccount(
    provider: string,
    providerSubject: string,
  ): Promise<OAuthAccountWithUser | null>;
  findProjectAdminInvitationByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthProjectAdminInvitation | null>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  recordVerificationCodeFailure(
    id: string,
    input: { consumedAt: Date | null },
  ): Promise<void>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
  updateUserEmailVerified(userId: string, verifiedAt: Date): Promise<AuthUser>;
  updateUserLastLogin(userId: string, lastLoginAt: Date): Promise<void>;
}

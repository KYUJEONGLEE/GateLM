import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  createOpaqueToken,
  createVerificationCode,
  hashPassword,
  hashSecret,
  normalizeEmail,
  verifyPassword,
} from './auth.crypto';
import {
  AuthProjectAdmin,
  AuthProjectAdminInvitation,
  AuthRepository,
  AuthSessionKind,
  AuthTenant,
  AuthTenantMembership,
  AuthUser,
} from './auth.repository';
import { AUTH_REPOSITORY, EMAIL_SENDER, GOOGLE_OAUTH_CLIENT } from './auth.tokens';
import {
  CreateOrganizationDto,
  LoginDto,
  SignupDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { EmailSender } from './email-sender';
import { GoogleOAuthClient } from './google-oauth-client';

interface PublicUser {
  email: string;
  emailVerifiedAt: string | null;
  id: string;
  name: string | null;
}

interface PublicTenant {
  id: string;
  name: string;
  status: unknown;
}

interface PublicMembership {
  id: string;
  role: string;
  status: string;
  tenantId: string;
  userId: string;
}

interface PublicProjectAdmin {
  id: string;
  projectId: string;
  projectName: string | null;
  tenantId: string;
  userId: string;
}

interface PublicProjectAdminInvitation {
  acceptedAt?: string | null;
  email: string;
  expiresAt: string;
  projectId: string;
  projectName: string | null;
  status: string;
  tenantId: string;
  tenantName: string | null;
}

const MAX_EMAIL_VERIFICATION_FAILURES = 5;

export interface SessionIssue {
  expiresAt: Date;
  kind: AuthSessionKind;
  token: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly repository: AuthRepository,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
    @Inject(GOOGLE_OAUTH_CLIENT)
    private readonly googleOAuthClient: GoogleOAuthClient,
    private readonly config: ConfigService,
  ) {}

  async signup(dto: SignupDto): Promise<{
    acceptedProjectInvitation?: PublicProjectAdminInvitation;
    session?: SessionIssue;
    user: PublicUser;
    verificationRequired: boolean;
  }> {
    const email = normalizeEmail(dto.email);
    const devAutoVerify = this.isDevAutoVerifyEnabled();
    const now = new Date();
    if (dto.projectInviteToken) {
      await this.getProjectAdminInvitationOrThrow(
        dto.projectInviteToken,
        email,
        now,
      );
    }

    const existingUser = await this.repository.findUserByEmail(email);
    if (existingUser) {
      return this.resumeIncompleteSignup(existingUser, dto, devAutoVerify, now);
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.repository.createUser({
      authProvider: 'local',
      email,
      emailVerifiedAt: devAutoVerify ? now : null,
      name: dto.name,
      passwordHash,
      status: devAutoVerify ? 'active' : 'pending_email_verification',
    });

    if (devAutoVerify) {
      if (dto.projectInviteToken) {
        const acceptedInvitation = await this.acceptProjectAdminInvitationOrThrow(
          dto.projectInviteToken,
          email,
          user.id,
          now,
        );
        const session = await this.issueSession(user.id, 'full');

        return {
          acceptedProjectInvitation:
            this.toPublicProjectAdminInvitation(acceptedInvitation),
          session,
          user: this.toPublicUser(user),
          verificationRequired: false,
        };
      }

      const session = await this.issueSession(user.id, 'onboarding');

      return {
        session,
        user: this.toPublicUser(user),
        verificationRequired: false,
      };
    }

    const code = createVerificationCode();
    const expiresAt = addMinutes(new Date(), 15);

    await this.repository.consumeOpenVerificationCodes(user.id, now);
    await this.repository.createVerificationCode({
      codeHash: hashSecret(code),
      expiresAt,
      userId: user.id,
    });
    await this.emailSender.sendVerificationEmail({
      code,
      email,
      expiresAt,
    });

    return {
      user: this.toPublicUser(user),
      verificationRequired: true,
    };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{
    acceptedProjectInvitation?: PublicProjectAdminInvitation;
    session: SessionIssue;
    user: PublicUser;
  }> {
    const email = normalizeEmail(dto.email);
    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    const now = new Date();
    if (dto.projectInviteToken) {
      await this.getProjectAdminInvitationOrThrow(
        dto.projectInviteToken,
        email,
        now,
      );
    }

    const verificationCode =
      await this.repository.findLatestOpenVerificationCode(user.id, now);
    if (!verificationCode) {
      throw new UnauthorizedException('Invalid verification code.');
    }
    if (verificationCode.codeHash !== hashSecret(dto.code)) {
      const nextFailedAttemptCount = verificationCode.failedAttemptCount + 1;
      await this.repository.recordVerificationCodeFailure(verificationCode.id, {
        consumedAt:
          nextFailedAttemptCount >= MAX_EMAIL_VERIFICATION_FAILURES
            ? now
            : null,
      });

      throw new UnauthorizedException('Invalid verification code.');
    }

    await this.repository.consumeVerificationCode(verificationCode.id, now);
    const verifiedUser = await this.repository.updateUserEmailVerified(
      user.id,
      now,
    );

    if (dto.projectInviteToken) {
      const acceptedInvitation = await this.acceptProjectAdminInvitationOrThrow(
        dto.projectInviteToken,
        email,
        verifiedUser.id,
        now,
      );
      const session = await this.issueSession(verifiedUser.id, 'full');

      return {
        acceptedProjectInvitation:
          this.toPublicProjectAdminInvitation(acceptedInvitation),
        session,
        user: this.toPublicUser(verifiedUser),
      };
    }

    const session = await this.issueSession(verifiedUser.id, 'onboarding');

    return {
      session,
      user: this.toPublicUser(verifiedUser),
    };
  }

  async getProjectAdminInvitation(
    token: string,
  ): Promise<PublicProjectAdminInvitation> {
    return this.toPublicProjectAdminInvitation(
      await this.getProjectAdminInvitationOrThrow(token),
    );
  }

  async createOrganization(
    onboardingToken: string | undefined,
    dto: CreateOrganizationDto,
  ): Promise<{
    membership: PublicMembership;
    session: SessionIssue;
    tenant: PublicTenant;
    user: PublicUser;
  }> {
    const session = await this.requireSession(onboardingToken, 'onboarding');
    if (!session.user.emailVerifiedAt) {
      throw new UnauthorizedException('Email verification is required.');
    }

    const created = await this.repository.createTenantAndMembership({
      organizationName: dto.organizationName,
      userId: session.user.id,
    });
    await this.repository.revokeSession(session.id, new Date());
    const fullSession = await this.issueSession(session.user.id, 'full');

    return {
      membership: this.toPublicMembership(created.membership),
      session: fullSession,
      tenant: this.toPublicTenant(created.tenant),
      user: this.toPublicUser(session.user),
    };
  }

  async login(dto: LoginDto): Promise<{
    memberships: PublicMembership[];
    session: SessionIssue;
    user: PublicUser;
  }> {
    const email = normalizeEmail(dto.email);
    const user = await this.repository.findUserByEmail(email);
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await verifyPassword(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const now = new Date();
    let loginUser = user;
    if (!loginUser.emailVerifiedAt) {
      if (
        loginUser.authProvider !== 'local' ||
        !this.isDevAutoVerifyEnabled()
      ) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      loginUser = await this.repository.updateUserEmailVerified(
        loginUser.id,
        now,
      );
    }

    await this.repository.updateUserLastLogin(loginUser.id, now);
    const memberships = await this.repository.findMembershipsByUserId(
      loginUser.id,
    );
    const sessionKind: AuthSessionKind =
      memberships.length > 0 ? 'full' : 'onboarding';
    const session = await this.issueSession(loginUser.id, sessionKind);

    return {
      memberships: memberships.map((membership) =>
        this.toPublicMembership(membership),
      ),
      session,
      user: this.toPublicUser(loginUser),
    };
  }

  async logout(tokens: Array<string | undefined>): Promise<{ loggedOut: true }> {
    const now = new Date();
    for (const token of tokens) {
      if (!token) {
        continue;
      }

      const session = await this.repository.findActiveSessionByTokenHash(
        hashSecret(token),
        now,
      );
      if (session) {
        await this.repository.revokeSession(session.id, now);
      }
    }

    return { loggedOut: true };
  }

  async me(token: string | undefined): Promise<{
    memberships: PublicMembership[];
    projectAdmins: PublicProjectAdmin[];
    session: { kind: string };
    user: PublicUser;
  }> {
    const session = await this.requireSession(token);
    const [memberships, projectAdmins] = await Promise.all([
      this.repository.findMembershipsByUserId(session.user.id),
      this.repository.findProjectAdminsByUserId(session.user.id),
    ]);

    return {
      memberships: memberships.map((membership) =>
        this.toPublicMembership(membership),
      ),
      projectAdmins: projectAdmins.map((projectAdmin) =>
        this.toPublicProjectAdmin(projectAdmin),
      ),
      session: { kind: session.kind },
      user: this.toPublicUser(session.user),
    };
  }

  startGoogleOAuth(): { authorizationUrl: string; state: string } {
    const state = createOpaqueToken();
    return {
      authorizationUrl: this.googleOAuthClient.buildAuthorizationUrl(state),
      state,
    };
  }

  async completeGoogleOAuth(input: {
    code: string | undefined;
    expectedState: string | undefined;
    state: string | undefined;
  }): Promise<{
    redirectUrl: string;
    session: SessionIssue;
  }> {
    if (
      !input.code ||
      !input.state ||
      !input.expectedState ||
      input.state !== input.expectedState
    ) {
      throw new UnauthorizedException('Invalid Google OAuth callback.');
    }

    const token = await this.googleOAuthClient.exchangeCode(input.code);
    const profile = await this.googleOAuthClient.getProfile(token.accessToken);
    if (!profile.emailVerified) {
      throw new UnauthorizedException('Google email is not verified.');
    }

    const email = normalizeEmail(profile.email);
    let user: AuthUser;
    const oauthAccount = await this.repository.findOAuthAccount(
      'google',
      profile.providerSubject,
    );

    if (oauthAccount) {
      user = oauthAccount.user;
    } else {
      const existingUser = await this.repository.findUserByEmail(email);
      if (existingUser) {
        user = await this.repository.updateUserEmailVerified(
          existingUser.id,
          new Date(),
        );
        await this.repository.createOAuthAccount({
          email,
          provider: 'google',
          providerSubject: profile.providerSubject,
          userId: user.id,
        });
      } else {
        const created = await this.repository.createGoogleUserWithOAuth({
          email,
          emailVerifiedAt: new Date(),
          name: profile.name,
          provider: 'google',
          providerSubject: profile.providerSubject,
        });
        user = created.user;
      }
    }

    const memberships = await this.repository.findMembershipsByUserId(user.id);
    const kind: AuthSessionKind = memberships.length > 0 ? 'full' : 'onboarding';
    const session = await this.issueSession(user.id, kind);

    return {
      redirectUrl: this.webHomeUrl(),
      session,
    };
  }

  private async acceptProjectAdminInvitationOrThrow(
    token: string,
    email: string,
    userId: string,
    now: Date,
  ): Promise<AuthProjectAdminInvitation> {
    try {
      return await this.repository.acceptProjectAdminInvitation({
        acceptedAt: now,
        email,
        tokenHash: hashSecret(token),
        userId,
      });
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired project admin invitation.',
      );
    }
  }

  private async getProjectAdminInvitationOrThrow(
    token: string,
    email?: string,
    now = new Date(),
  ): Promise<AuthProjectAdminInvitation> {
    const invitation = await this.repository.findProjectAdminInvitationByTokenHash(
      hashSecret(token),
      now,
    );
    if (!invitation) {
      throw new UnauthorizedException(
        'Invalid or expired project admin invitation.',
      );
    }
    if (email && invitation.email !== email) {
      throw new UnauthorizedException(
        'Project admin invitation email does not match.',
      );
    }

    return invitation;
  }

  private async issueSession(
    userId: string,
    kind: AuthSessionKind,
  ): Promise<SessionIssue> {
    const token = createOpaqueToken();
    const expiresAt =
      kind === 'full' ? addDays(new Date(), 7) : addHours(new Date(), 2);
    await this.repository.createSession({
      expiresAt,
      kind,
      sessionTokenHash: hashSecret(token),
      userId,
    });

    return { expiresAt, kind, token };
  }

  private async requireSession(
    token: string | undefined,
    kind?: AuthSessionKind,
  ) {
    if (!token) {
      throw new UnauthorizedException('Authentication is required.');
    }

    const session = await this.repository.findActiveSessionByTokenHash(
      hashSecret(token),
      new Date(),
    );
    if (!session || (kind && session.kind !== kind)) {
      throw new UnauthorizedException('Authentication is required.');
    }

    return session;
  }

  private toPublicProjectAdmin(
    projectAdmin: AuthProjectAdmin,
  ): PublicProjectAdmin {
    return {
      id: projectAdmin.id,
      projectId: projectAdmin.projectId,
      projectName: projectAdmin.project?.name ?? null,
      tenantId: projectAdmin.tenantId,
      userId: projectAdmin.userId,
    };
  }

  private toPublicMembership(
    membership: AuthTenantMembership,
  ): PublicMembership {
    return {
      id: membership.id,
      role: membership.role,
      status: membership.status,
      tenantId: membership.tenantId,
      userId: membership.userId,
    };
  }

  private toPublicProjectAdminInvitation(
    invitation: AuthProjectAdminInvitation,
  ): PublicProjectAdminInvitation {
    return {
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      projectId: invitation.projectId,
      projectName: invitation.project?.name ?? null,
      status: invitation.status,
      tenantId: invitation.tenantId,
      tenantName: invitation.tenant?.name ?? null,
    };
  }

  private toPublicTenant(tenant: AuthTenant): PublicTenant {
    return {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
    };
  }

  private toPublicUser(user: AuthUser): PublicUser {
    return {
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      id: user.id,
      name: user.name,
    };
  }

  private webOrigin(): string {
    return this.config.get<string>('CONTROL_PLANE_WEB_ORIGIN') ?? 'http://localhost:3005';
  }

  private webHomeUrl(): string {
    return `${this.webOrigin().replace(/\/+$/, '')}/`;
  }

  private isDevAutoVerifyEnabled(): boolean {
    const emailTransport =
      this.config.get<string>('AUTH_EMAIL_TRANSPORT') ?? 'dev_memory';
    const devAutoVerify =
      this.config.get<string>('CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY') ??
      (emailTransport === 'dev_memory' ? 'true' : 'false');

    return (
      emailTransport === 'dev_memory' &&
      devAutoVerify === 'true'
    );
  }

  private async resumeIncompleteSignup(
    user: AuthUser,
    dto: SignupDto,
    devAutoVerify: boolean,
    now: Date,
  ): Promise<{
    acceptedProjectInvitation?: PublicProjectAdminInvitation;
    session?: SessionIssue;
    user: PublicUser;
    verificationRequired: boolean;
  }> {
    const memberships = await this.repository.findMembershipsByUserId(user.id);
    if (
      memberships.length > 0 ||
      user.authProvider !== 'local' ||
      !user.passwordHash
    ) {
      throw new ConflictException('Email is already registered.');
    }

    const passwordMatches = await verifyPassword(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new ConflictException(
        'Email signup is already in progress. Use the original password to finish onboarding.',
      );
    }

    if (devAutoVerify || user.emailVerifiedAt) {
      const verifiedUser = user.emailVerifiedAt
        ? user
        : await this.repository.updateUserEmailVerified(user.id, now);

      if (dto.projectInviteToken) {
        const acceptedInvitation = await this.acceptProjectAdminInvitationOrThrow(
          dto.projectInviteToken,
          user.email,
          verifiedUser.id,
          now,
        );
        const session = await this.issueSession(verifiedUser.id, 'full');

        return {
          acceptedProjectInvitation:
            this.toPublicProjectAdminInvitation(acceptedInvitation),
          session,
          user: this.toPublicUser(verifiedUser),
          verificationRequired: false,
        };
      }

      const session = await this.issueSession(verifiedUser.id, 'onboarding');

      return {
        session,
        user: this.toPublicUser(verifiedUser),
        verificationRequired: false,
      };
    }

    const code = createVerificationCode();
    const expiresAt = addMinutes(now, 15);

    await this.repository.consumeOpenVerificationCodes(user.id, now);
    await this.repository.createVerificationCode({
      codeHash: hashSecret(code),
      expiresAt,
      userId: user.id,
    });
    await this.emailSender.sendVerificationEmail({
      code,
      email: user.email,
      expiresAt,
    });

    return {
      user: this.toPublicUser(user),
      verificationRequired: true,
    };
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

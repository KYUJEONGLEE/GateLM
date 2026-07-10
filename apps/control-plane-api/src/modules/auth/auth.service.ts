import {
  BadRequestException,
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
  AuthEmployeeInvitation,
  AuthProjectAdmin,
  AuthProjectAdminInvitation,
  AuthRepository,
  AuthSessionKind,
  AuthTenant,
  AuthTenantAdmin,
  AuthTenantMembership,
  AuthUser,
  EmployeeInvitationNotFoundError,
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
import {
  SignupDraft,
  SignupDraftTokenCodec,
} from './signup-draft-token';

interface PublicUser {
  email: string;
  emailVerifiedAt: string | null;
  id: string | null;
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

interface PublicEmployeeInvitation {
  acceptedAt?: string | null;
  email: string;
  employeeId: string;
  expiresAt: string;
  name: string | null;
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

export interface SignupDraftIssue {
  expiresAt: Date;
  token: string;
}

export class SignupDraftUnauthorizedException extends UnauthorizedException {
  constructor(
    message: string,
    readonly signupDraft?: SignupDraftIssue,
  ) {
    super(message);
  }
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
    acceptedEmployeeInvitation?: PublicEmployeeInvitation;
    acceptedProjectInvitation?: PublicProjectAdminInvitation;
    session?: SessionIssue;
    signupDraft?: SignupDraftIssue;
    user: PublicUser;
    verificationRequired: boolean;
  }> {
    const email = normalizeEmail(dto.email);
    const devAutoVerify = this.isDevAutoVerifyEnabled();
    const now = new Date();
    if (dto.projectInviteToken && dto.employeeInviteToken) {
      throw new BadRequestException('Only one invitation token can be used.');
    }
    if (dto.projectInviteToken) {
      await this.getProjectAdminInvitationOrThrow(
        dto.projectInviteToken,
        email,
        now,
      );
    }

    const passwordHash = await hashPassword(dto.password);

    if (dto.employeeInviteToken) {
      let accepted: Awaited<ReturnType<AuthRepository['acceptEmployeeInvitation']>>;
      try {
        accepted = await this.repository.acceptEmployeeInvitation({
          acceptedAt: now,
          email,
          name: dto.name,
          passwordHash,
          tokenHash: hashSecret(dto.employeeInviteToken),
        });
      } catch (error) {
        if (error instanceof EmployeeInvitationNotFoundError) {
          throw new UnauthorizedException('Invalid or expired employee invitation.');
        }
        throw error;
      }
      const session = await this.issueSession(accepted.user.id, 'full');

      return {
        acceptedEmployeeInvitation: this.toPublicEmployeeInvitation(
          accepted.employeeInvitation,
        ),
        session,
        user: this.toPublicUser(accepted.user),
        verificationRequired: false,
      };
    }

    const existingUser = await this.repository.findUserByEmail(email);
    if (existingUser) {
      await this.ensureEmailCanStartLocalSignup(existingUser);
    }

    if (dto.projectInviteToken) {
      if (existingUser) {
        throw new ConflictException('Email is already registered.');
      }

      const user = await this.repository.createUser({
        authProvider: 'local',
        email,
        emailVerifiedAt: devAutoVerify ? now : null,
        name: dto.name,
        passwordHash,
        status: devAutoVerify ? 'active' : 'pending_email_verification',
      });

      if (devAutoVerify) {
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

      const code = createVerificationCode();
      const codeExpiresAt = addMinutes(now, 15);
      await this.repository.createVerificationCode({
        codeHash: hashSecret(code),
        expiresAt: codeExpiresAt,
        userId: user.id,
      });
      await this.emailSender.sendVerificationEmail({
        code,
        email,
        expiresAt: codeExpiresAt,
      });

      return {
        user: this.toPublicUser(user),
        verificationRequired: true,
      };
    }

    const draft: SignupDraft = {
      email,
      emailVerifiedAt: devAutoVerify ? now.toISOString() : null,
      expiresAt: addHours(now, 2).toISOString(),
      name: dto.name,
      passwordHash,
    };

    if (devAutoVerify) {
      return {
        signupDraft: this.issueSignupDraft(draft),
        user: this.toPublicSignupUser(draft),
        verificationRequired: false,
      };
    }

    const code = createVerificationCode();
    const codeExpiresAt = addMinutes(now, 15);

    draft.expiresAt = codeExpiresAt.toISOString();
    draft.verification = {
      codeHash: hashSecret(code),
      expiresAt: codeExpiresAt.toISOString(),
      failedAttemptCount: 0,
    };
    await this.emailSender.sendVerificationEmail({
      code,
      email,
      expiresAt: codeExpiresAt,
    });

    return {
      signupDraft: this.issueSignupDraft(draft),
      user: this.toPublicSignupUser(draft),
      verificationRequired: true,
    };
  }

  async verifyEmail(
    signupDraftToken: string | undefined,
    dto: VerifyEmailDto,
  ): Promise<{
    acceptedProjectInvitation?: PublicProjectAdminInvitation;
    session?: SessionIssue;
    signupDraft?: SignupDraftIssue;
    user: PublicUser;
  }> {
    if (dto.projectInviteToken) {
      return this.verifyProjectAdminInvitationEmail(dto);
    }

    const email = normalizeEmail(dto.email);
    const draft = this.requireSignupDraft(signupDraftToken);
    if (draft.email !== email) {
      throw new SignupDraftUnauthorizedException('Invalid verification code.');
    }

    const now = new Date();
    if (draft.emailVerifiedAt) {
      const renewedDraft: SignupDraft = {
        ...draft,
        expiresAt: addHours(now, 2).toISOString(),
      };

      return {
        signupDraft: this.issueSignupDraft(renewedDraft),
        user: this.toPublicSignupUser(renewedDraft),
      };
    }

    if (
      !draft.verification ||
      isInvalidDate(new Date(draft.verification.expiresAt)) ||
      new Date(draft.verification.expiresAt) <= now ||
      draft.verification.failedAttemptCount >= MAX_EMAIL_VERIFICATION_FAILURES
    ) {
      throw new SignupDraftUnauthorizedException('Invalid verification code.');
    }

    if (draft.verification.codeHash !== hashSecret(dto.code)) {
      const nextFailedAttemptCount =
        draft.verification.failedAttemptCount + 1;
      const failedDraft: SignupDraft = {
        ...draft,
        verification:
          nextFailedAttemptCount >= MAX_EMAIL_VERIFICATION_FAILURES
            ? undefined
            : {
                ...draft.verification,
                failedAttemptCount: nextFailedAttemptCount,
              },
      };

      throw new SignupDraftUnauthorizedException(
        'Invalid verification code.',
        this.issueSignupDraft(failedDraft),
      );
    }

    const verifiedDraft: SignupDraft = {
      ...draft,
      emailVerifiedAt: now.toISOString(),
      expiresAt: addHours(now, 2).toISOString(),
      verification: undefined,
    };

    return {
      signupDraft: this.issueSignupDraft(verifiedDraft),
      user: this.toPublicSignupUser(verifiedDraft),
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
    tokens: {
      onboardingToken: string | undefined;
      signupDraftToken: string | undefined;
    },
    dto: CreateOrganizationDto,
  ): Promise<{
    membership: PublicMembership;
    session: SessionIssue;
    tenant: PublicTenant;
    user: PublicUser;
  }> {
    if (tokens.signupDraftToken) {
      const draft = this.requireSignupDraft(tokens.signupDraftToken);
      if (!draft.emailVerifiedAt) {
        throw new UnauthorizedException('Email verification is required.');
      }

      const verifiedAt = new Date(draft.emailVerifiedAt);
      if (isInvalidDate(verifiedAt)) {
        throw new UnauthorizedException('Email verification is required.');
      }
      const existingUser = await this.repository.findUserByEmail(draft.email);
      if (existingUser) {
        await this.ensureEmailCanStartLocalSignup(existingUser);
      }

      let created: {
        membership: AuthTenantMembership;
        tenant: AuthTenant;
        user: AuthUser;
      };
      try {
        created = await this.repository.createLocalUserTenantAndMembership({
          email: draft.email,
          emailVerifiedAt: verifiedAt,
          name: draft.name,
          organizationName: dto.organizationName,
          passwordHash: draft.passwordHash,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'EMAIL_ALREADY_REGISTERED'
        ) {
          throw new ConflictException('Email is already registered.');
        }
        throw error;
      }

      const fullSession = await this.issueSession(created.user.id, 'full');

      return {
        membership: this.toPublicMembership(created.membership),
        session: fullSession,
        tenant: this.toPublicTenant(created.tenant),
        user: this.toPublicUser(created.user),
      };
    }

    const session = await this.requireSession(
      tokens.onboardingToken,
      'onboarding',
    );
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

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const [memberships, tenantAdmins] = await Promise.all([
      this.repository.findMembershipsByUserId(user.id),
      this.repository.findTenantAdminsByUserId(user.id),
    ]);
    const mergedMemberships = this.mergeTenantAdminMemberships(
      memberships,
      tenantAdmins,
    );
    if (mergedMemberships.length === 0) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.repository.updateUserLastLogin(user.id, new Date());
    const session = await this.issueSession(user.id, 'full');

    return {
      memberships: mergedMemberships,
      session,
      user: this.toPublicUser(user),
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
    const [memberships, tenantAdmins, projectAdmins] = await Promise.all([
      this.repository.findMembershipsByUserId(session.user.id),
      this.repository.findTenantAdminsByUserId(session.user.id),
      this.repository.findProjectAdminsByUserId(session.user.id),
    ]);

    return {
      memberships: this.mergeTenantAdminMemberships(memberships, tenantAdmins),
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

    const [memberships, tenantAdmins, projectAdmins] = await Promise.all([
      this.repository.findMembershipsByUserId(user.id),
      this.repository.findTenantAdminsByUserId(user.id),
      this.repository.findProjectAdminsByUserId(user.id),
    ]);
    const mergedMemberships = this.mergeTenantAdminMemberships(
      memberships,
      tenantAdmins,
    );
    const consoleTenantId = this.resolveConsoleTenantId(
      mergedMemberships,
      projectAdmins,
    );
    const kind: AuthSessionKind = consoleTenantId ? 'full' : 'onboarding';
    const session = await this.issueSession(user.id, kind);

    return {
      redirectUrl: consoleTenantId
        ? this.webDashboardUrl(consoleTenantId)
        : this.webOrganizationSetupUrl(),
      session,
    };
  }

  private async verifyProjectAdminInvitationEmail(
    dto: VerifyEmailDto,
  ): Promise<{
    acceptedProjectInvitation: PublicProjectAdminInvitation;
    session: SessionIssue;
    user: PublicUser;
  }> {
    const email = normalizeEmail(dto.email);
    const now = new Date();
    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    await this.getProjectAdminInvitationOrThrow(
      dto.projectInviteToken,
      email,
      now,
    );

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

  private async acceptProjectAdminInvitationOrThrow(
    token: string | undefined,
    email: string,
    userId: string,
    now: Date,
  ): Promise<AuthProjectAdminInvitation> {
    if (!token) {
      throw new UnauthorizedException(
        'Invalid or expired project admin invitation.',
      );
    }

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
    token: string | undefined,
    email?: string,
    now = new Date(),
  ): Promise<AuthProjectAdminInvitation> {
    if (!token) {
      throw new UnauthorizedException(
        'Invalid or expired project admin invitation.',
      );
    }

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

  private issueSignupDraft(draft: SignupDraft): SignupDraftIssue {
    return {
      expiresAt: new Date(draft.expiresAt),
      token: this.signupDraftCodec().seal(draft),
    };
  }

  private requireSignupDraft(token: string | undefined): SignupDraft {
    const draft = this.signupDraftCodec().open(token);
    const expiresAt = draft ? new Date(draft.expiresAt) : null;
    if (!draft || !expiresAt || isInvalidDate(expiresAt) || expiresAt <= new Date()) {
      throw new UnauthorizedException('Signup session expired. Start signup again.');
    }

    return draft;
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

  private mergeTenantAdminMemberships(
    memberships: AuthTenantMembership[],
    tenantAdmins: AuthTenantAdmin[],
  ): PublicMembership[] {
    const publicMemberships = memberships.map((membership) =>
      this.toPublicMembership(membership),
    );
    const membershipKeys = new Set(
      publicMemberships.map(
        (membership) => `${membership.tenantId}:${membership.userId}:tenant_admin`,
      ),
    );

    for (const tenantAdmin of tenantAdmins) {
      const key = `${tenantAdmin.tenantId}:${tenantAdmin.userId}:tenant_admin`;
      if (membershipKeys.has(key)) {
        continue;
      }
      publicMemberships.push({
        id: tenantAdmin.id,
        role: 'tenant_admin',
        status: 'active',
        tenantId: tenantAdmin.tenantId,
        userId: tenantAdmin.userId,
      });
      membershipKeys.add(key);
    }

    return publicMemberships;
  }

  private resolveConsoleTenantId(
    memberships: PublicMembership[],
    projectAdmins: AuthProjectAdmin[],
  ): string | null {
    const activeMembership = memberships.find(
      (membership) => membership.status === 'active' && membership.tenantId,
    );
    if (activeMembership) {
      return activeMembership.tenantId;
    }

    return projectAdmins[0]?.tenantId ?? null;
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

  private toPublicEmployeeInvitation(
    invitation: AuthEmployeeInvitation,
  ): PublicEmployeeInvitation {
    return {
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      email: invitation.email,
      employeeId: invitation.employeeId,
      expiresAt: invitation.expiresAt.toISOString(),
      name: invitation.name,
      status: invitation.status,
      tenantId: invitation.tenantId,
      tenantName: invitation.tenant?.name ?? null,
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

  private toPublicTenant(tenant: AuthTenant): PublicTenant {
    return {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
    };
  }

  private toPublicSignupUser(draft: SignupDraft): PublicUser {
    return {
      email: draft.email,
      emailVerifiedAt: draft.emailVerifiedAt,
      id: null,
      name: draft.name,
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
    return this.config.getOrThrow<string>('CONTROL_PLANE_WEB_ORIGIN');
  }

  private webDashboardUrl(tenantId: string): string {
    return `${this.webOrigin().replace(/\/+$/, '')}/tenants/${encodeURIComponent(tenantId)}/dashboard`;
  }

  private webOrganizationSetupUrl(): string {
    return `${this.webOrigin().replace(/\/+$/, '')}/?auth=organization`;
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

  private signupDraftCodec(): SignupDraftTokenCodec {
    return new SignupDraftTokenCodec(
      this.config.getOrThrow<string>('CONTROL_PLANE_AUTH_STATE_SECRET'),
    );
  }

  private async ensureEmailCanStartLocalSignup(user: AuthUser): Promise<void> {
    const memberships = await this.repository.findMembershipsByUserId(user.id);
    if (
      memberships.length > 0 ||
      user.authProvider !== 'local' ||
      !user.passwordHash
    ) {
      throw new ConflictException('Email is already registered.');
    }
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

function isInvalidDate(date: Date): boolean {
  return Number.isNaN(date.getTime());
}

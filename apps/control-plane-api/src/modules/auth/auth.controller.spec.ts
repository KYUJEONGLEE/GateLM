import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import {
  AUTH_REPOSITORY,
  EMAIL_SENDER,
  GOOGLE_OAUTH_CLIENT,
} from './auth.tokens';
import { hashPassword, hashSecret } from './auth.crypto';
import { EmployeeInvitationNotFoundError } from './auth.repository';
import { createInMemoryAuthRepository } from './testing/in-memory-auth-repository';

describe('Auth HTTP API', () => {
  let app: INestApplication;
  let authService: AuthService;
  let repository: ReturnType<typeof createInMemoryAuthRepository>;
  let emailSender: {
    passwordChangesSent: Array<{ changedAt: Date; email: string }>;
    passwordResetsSent: Array<{ email: string; expiresAt: Date; resetUrl: string }>;
    sent: Array<{ email: string; code: string }>;
    sendEmployeeInvitationEmail: jest.Mock;
    sendPasswordChangedEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
    sendProjectAdminInvitationEmail: jest.Mock;
    sendVerificationEmail: jest.Mock;
  };
  let googleOAuthClient: {
    profile: {
      email: string;
      emailVerified: boolean;
      name: string;
      providerSubject: string;
    };
    buildAuthorizationUrl: jest.Mock;
    exchangeCode: jest.Mock;
    getProfile: jest.Mock;
  };

  async function createAuthTestApp(
    options: { devAutoVerify?: boolean; omitDevAutoVerify?: boolean } = {},
  ) {
    repository = createInMemoryAuthRepository();
    emailSender = {
      passwordChangesSent: [],
      passwordResetsSent: [],
      sent: [],
      sendEmployeeInvitationEmail: jest.fn(async () => undefined),
      sendPasswordChangedEmail: jest.fn(async (message) => {
        emailSender.passwordChangesSent.push(message);
      }),
      sendPasswordResetEmail: jest.fn(async (message) => {
        emailSender.passwordResetsSent.push(message);
      }),
      sendProjectAdminInvitationEmail: jest.fn(async () => undefined),
      sendVerificationEmail: jest.fn(async (message) => {
        emailSender.sent.push(message);
      }),
    };
    googleOAuthClient = {
      profile: {
        email: 'google-admin@example.com',
        emailVerified: true,
        name: 'Google Admin',
        providerSubject: 'google-subject-001',
      },
      buildAuthorizationUrl: jest.fn((state: string) => {
        return `https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client&state=${state}`;
      }),
      exchangeCode: jest.fn(async (code: string) => {
        return { accessToken: `access-token-for-${code}` };
      }),
      getProfile: jest.fn(async () => googleOAuthClient.profile),
    };
    const readConfigValue = (key: string) => {
      const values: Record<string, string> = {
        AUTH_EMAIL_TRANSPORT: 'dev_memory',
        CONTROL_PLANE_AUTH_COOKIE_SECURE: 'false',
        CONTROL_PLANE_AUTH_STATE_SECRET: 'test-control-plane-auth-state-secret',
        CONTROL_PLANE_WEB_ORIGIN: 'http://localhost:3000',
      };
      if (!options.omitDevAutoVerify) {
        values.CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY = options.devAutoVerify
          ? 'true'
          : 'false';
      }

      return values[key];
    };
    const configService = {
      get: jest.fn(readConfigValue),
      getOrThrow: jest.fn((key: string) => {
        const value = readConfigValue(key);
        if (value === undefined) {
          throw new Error(`Missing config value: ${key}`);
        }

        return value;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(repository)
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .overrideProvider(GOOGLE_OAUTH_CLIENT)
      .useValue(googleOAuthClient)
      .overrideProvider(ConfigService)
      .useValue(configService)
      .compile();

    authService = moduleRef.get(AuthService);
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
  }

  async function createVerifiedAccount(
    email: string,
    password = 'Valid1!Pass',
  ) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/signup')
      .send({ email, name: 'Account Owner', password })
      .expect(201);
    const code = emailSender.sent.at(-1)?.code;
    await agent
      .post('/api/auth/email/verify')
      .send({ code, email })
      .expect(200);
    await agent
      .post('/api/auth/organizations')
      .send({ organizationName: 'Account Recovery Tenant' })
      .expect(201);
    return agent;
  }

  beforeEach(async () => {
    await createAuthTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('starts signup and emails a verification code without persistent user records', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'Admin@Example.com',
        name: 'Kim Admin',
        password: 'Valid1!Pass',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      data: {
        verificationRequired: true,
        user: {
          email: 'admin@example.com',
          name: 'Kim Admin',
        },
      },
    });
    expect(String(response.headers['set-cookie'])).toContain('gatelm_signup=');
    expect(String(response.headers['set-cookie'])).not.toContain(
      'gatelm_onboarding=',
    );
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.email).toBe('admin@example.com');
    expect(emailSender.sent[0]?.code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(response.body)).not.toContain(
      emailSender.sent[0]?.code,
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(repository.dump().users).toHaveLength(0);
    expect(repository.dump().emailVerificationCodes).toHaveLength(0);
  });

  it('returns unauthorized when an employee invitation cannot be found', async () => {
    jest
      .spyOn(repository, 'acceptEmployeeInvitation')
      .mockRejectedValueOnce(new EmployeeInvitationNotFoundError());

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'employee@example.com',
        employeeInviteToken: 'invalid-employee-invite-token',
        name: 'Employee',
        password: 'Valid1!Pass',
      })
      .expect(401);
  });

  it('does not hide employee invitation storage errors as unauthorized', async () => {
    jest
      .spyOn(repository, 'acceptEmployeeInvitation')
      .mockRejectedValueOnce(new Error('database unavailable'));

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'employee@example.com',
        employeeInviteToken: 'employee-invite-token',
        name: 'Employee',
        password: 'Valid1!Pass',
      })
      .expect(500);
  });

  it('auto-verifies local dev signups without returning plaintext secrets', async () => {
    await app.close();
    await createAuthTestApp({ devAutoVerify: true });

    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'dev-owner@example.com',
        name: 'Dev Owner',
        password: 'Valid1!Pass',
      })
      .expect(201);

    expect(String(response.headers['set-cookie'])).toContain('gatelm_signup=');
    expect(String(response.headers['set-cookie'])).not.toContain(
      'gatelm_onboarding=',
    );
    expect(response.body).toMatchObject({
      data: {
        user: {
          email: 'dev-owner@example.com',
          name: 'Dev Owner',
        },
        verificationRequired: false,
      },
    });
    expect(emailSender.sent).toHaveLength(0);
    expect(repository.dump().users).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('defaults dev memory signup to fake email verification when the auto verify flag is unset', async () => {
    await app.close();
    await createAuthTestApp({ omitDevAutoVerify: true });

    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'default-fake-owner@example.com',
        name: 'Default Fake Owner',
        password: 'Valid1!Pass',
      })
      .expect(201);

    expect(String(response.headers['set-cookie'])).toContain('gatelm_signup=');
    expect(String(response.headers['set-cookie'])).not.toContain(
      'gatelm_onboarding=',
    );
    expect(response.body).toMatchObject({
      data: {
        user: {
          email: 'default-fake-owner@example.com',
        },
        verificationRequired: false,
      },
    });
    expect(emailSender.sent).toHaveLength(0);
    expect(repository.dump().users).toHaveLength(0);
    expect(repository.dump().emailVerificationCodes).toHaveLength(0);
  });

  it('resends verification for an incomplete local signup instead of returning a duplicate account conflict', async () => {
    const firstResponse = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'retry-owner@example.com',
        name: 'Retry Owner',
        password: 'Valid1!Pass',
      })
      .expect(201);

    const secondResponse = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'retry-owner@example.com',
        name: 'Retry Owner',
        password: 'Valid1!Pass',
      })
      .expect(201);

    expect(firstResponse.body).toMatchObject({
      data: {
        verificationRequired: true,
        user: {
          email: 'retry-owner@example.com',
        },
      },
    });
    expect(secondResponse.body).toMatchObject({
      data: {
        verificationRequired: true,
        user: {
          email: 'retry-owner@example.com',
        },
      },
    });
    expect(repository.dump().users).toHaveLength(0);
    expect(repository.dump().emailVerificationCodes).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(2);
  });

  it('restarts an incomplete fake-verified local signup without creating a user', async () => {
    await app.close();
    await createAuthTestApp({ devAutoVerify: true });

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'resume-owner@example.com',
        name: 'Resume Owner',
        password: 'Valid1!Pass',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'resume-owner@example.com',
        name: 'Resume Owner',
        password: 'Valid1!Pass',
      })
      .expect(201);

    expect(String(response.headers['set-cookie'])).toContain('gatelm_signup=');
    expect(String(response.headers['set-cookie'])).not.toContain(
      'gatelm_onboarding=',
    );
    expect(response.body).toMatchObject({
      data: {
        user: {
          email: 'resume-owner@example.com',
        },
        verificationRequired: false,
      },
    });
    expect(repository.dump().users).toHaveLength(0);
    expect(repository.dump().tenantMemberships).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it('verifies email, creates an organization, and grants tenant_admin membership', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post('/api/auth/signup').send({
      email: 'owner@example.com',
      name: 'Owner User',
      password: 'Valid1!Pass',
    });
    const code = emailSender.sent[0]?.code;
    expect(repository.dump().users).toHaveLength(0);
    expect(repository.dump().tenantMemberships).toHaveLength(0);

    const verifyResponse = await agent
      .post('/api/auth/email/verify')
      .send({ code, email: 'owner@example.com' })
      .expect(200);

    expect(String(verifyResponse.headers['set-cookie'])).toContain(
      'gatelm_signup=',
    );
    expect(String(verifyResponse.headers['set-cookie'])).not.toContain(
      'gatelm_onboarding=',
    );
    expect(repository.dump().users).toHaveLength(0);

    const organizationResponse = await agent
      .post('/api/auth/organizations')
      .send({ organizationName: 'Acme AI Operations' })
      .expect(201);

    expect(String(organizationResponse.headers['set-cookie'])).toContain(
      'gatelm_session=',
    );
    expect(organizationResponse.body).toMatchObject({
      data: {
        membership: {
          role: 'tenant_admin',
          status: 'active',
        },
        tenant: {
          name: 'Acme AI Operations',
        },
      },
    });
    expect(JSON.stringify(organizationResponse.body)).not.toContain(
      'sessionToken',
    );
    expect(repository.dump().users).toHaveLength(1);
    expect(repository.dump().tenants).toHaveLength(1);
    expect(repository.dump().tenantMemberships).toHaveLength(1);
  });

  it('accepts a project admin invitation during email verification', async () => {
    const agent = request.agent(app.getHttpServer());
    const invitation = await repository.createProjectAdminInvitation({
      email: 'project-admin@example.com',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      projectId: '00000000-0000-4000-8000-000000000201',
      tenantId: '00000000-0000-4000-8000-000000000101',
      tokenHash:
        'sha256:30bb50742c146614848437b28da7c55eff7be239672e6e81bdcdec676e35e33b',
    });

    await agent.post('/api/auth/signup').send({
      email: 'project-admin@example.com',
      name: 'Project Admin',
      password: 'Valid1!Pass',
      projectInviteToken: 'project-admin-invite-token',
    });

    const verifyResponse = await agent
      .post('/api/auth/email/verify')
      .send({
        code: emailSender.sent[0]?.code,
        email: 'project-admin@example.com',
        projectInviteToken: 'project-admin-invite-token',
      })
      .expect(200);

    expect(String(verifyResponse.headers['set-cookie'])).toContain(
      'gatelm_session=',
    );
    expect(verifyResponse.body).toMatchObject({
      data: {
        acceptedProjectInvitation: {
          email: 'project-admin@example.com',
          projectId: invitation.projectId,
          status: 'accepted',
          tenantId: invitation.tenantId,
        },
        session: {
          kind: 'full',
        },
      },
    });

    const state = repository.dump();
    expect(state.tenantMemberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'project_admin',
          tenantId: invitation.tenantId,
        }),
      ]),
    );
    expect(state.projectAdmins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: invitation.projectId,
          tenantId: invitation.tenantId,
        }),
      ]),
    );
  });
  it('expires an email verification code after repeated invalid attempts', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post('/api/auth/signup').send({
      email: 'limited@example.com',
      name: 'Limited User',
      password: 'Valid1!Pass',
    });
    const code = emailSender.sent[0]?.code;
    const invalidCode = code === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await agent
        .post('/api/auth/email/verify')
        .send({ code: invalidCode, email: 'limited@example.com' })
        .expect(401);
    }

    expect(repository.dump().users).toHaveLength(0);
    expect(repository.dump().emailVerificationCodes).toHaveLength(0);

    await agent
      .post('/api/auth/email/verify')
      .send({ code, email: 'limited@example.com' })
      .expect(401);
  });

  it('logs in with email and password using an httpOnly full session cookie', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post('/api/auth/signup').send({
      email: 'login@example.com',
      name: 'Login User',
      password: 'Valid1!Pass',
    });
    await agent
      .post('/api/auth/email/verify')
      .send({ code: emailSender.sent[0]?.code, email: 'login@example.com' });
    await agent
      .post('/api/auth/organizations')
      .send({ organizationName: 'Login Tenant' });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: 'Valid1!Pass',
      })
      .expect(200);

    const cookie = String(loginResponse.headers['set-cookie']);
    expect(cookie).toContain('gatelm_session=');
    expect(cookie).toContain('HttpOnly');
    expect(loginResponse.body).toMatchObject({
      data: {
        user: { hasLocalPassword: true },
      },
    });
    expect(JSON.stringify(loginResponse.body)).not.toContain('accessToken');
    expect(JSON.stringify(loginResponse.body)).not.toContain('refreshToken');
  });

  it('allows an existing verified account to log in with a legacy password outside the new policy', async () => {
    const email = 'legacy-login@example.com';
    const legacyPassword = 'legacy password longer than fifteen';
    const user = await repository.createUser({
      authProvider: 'local',
      email,
      emailVerifiedAt: new Date(),
      name: 'Legacy Login',
      passwordHash: await hashPassword(legacyPassword),
      status: 'active',
    });
    await repository.createTenantAndMembership({
      organizationName: 'Legacy Tenant',
      userId: user.id,
    });

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: legacyPassword })
      .expect(200);
  });

  it('rejects passwords missing a required character class', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'weak-password@example.com',
        name: 'Weak Password',
        password: 'alllower1!',
      })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'WEAK_PASSWORD' });
    expect(emailSender.sent).toHaveLength(0);
    expect(repository.dump().users).toHaveLength(0);
  });

  it('resets a local password with a hashed single-use token and revokes old sessions', async () => {
    const email = 'reset-owner@example.com';
    const oldPassword = 'Valid1!Pass';
    const newPassword = 'NewValid2!Pass';
    const existingAgent = await createVerifiedAccount(email, oldPassword);

    const resetResponse = await request(app.getHttpServer())
      .post('/api/auth/password-reset/request')
      .send({ email })
      .expect(202);
    const missingAccountResponse = await request(app.getHttpServer())
      .post('/api/auth/password-reset/request')
      .send({ email: 'missing@example.com' })
      .expect(202);

    expect(resetResponse.body).toEqual({ data: { accepted: true } });
    expect(missingAccountResponse.body).toEqual(resetResponse.body);
    expect(emailSender.passwordResetsSent).toHaveLength(1);
    const resetUrl = emailSender.passwordResetsSent[0]!.resetUrl;
    const resetToken = decodeURIComponent(
      new URL(resetUrl).hash.slice('#token='.length),
    );
    expect(resetUrl).toContain('/auth/reset-password#token=');
    expect(JSON.stringify(repository.dump().passwordResetTokens)).not.toContain(
      resetToken,
    );

    await request(app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({ newPassword, token: resetToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({ newPassword: 'Other3!Pass', token: resetToken })
      .expect(400);

    await existingAgent.get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
    expect(emailSender.passwordChangesSent).toHaveLength(1);
  });

  it('rejects an expired reset token without changing the password or session', async () => {
    const email = 'expired-reset@example.com';
    const password = 'Valid1!Pass';
    const accountAgent = await createVerifiedAccount(email, password);
    const user = repository.dump().users.find((item) => item.email === email);
    expect(user).toBeDefined();

    const expiredToken = 'expired-reset-token-with-at-least-32-characters';
    await repository.createPasswordResetToken({
      expiresAt: new Date(Date.now() - 1_000),
      tokenHash: hashSecret(expiredToken),
      userId: user!.id,
    });

    const response = await request(app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({
        newPassword: 'Other4!Pass',
        token: expiredToken,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'INVALID_PASSWORD_RESET_TOKEN',
    });
    await accountAgent.get('/api/auth/me').expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
  });

  it('limits reset link issuance to five per account per hour without changing the public response', async () => {
    const email = 'reset-rate-limit@example.com';
    await createVerifiedAccount(email);

    for (let requestIndex = 0; requestIndex < 6; requestIndex += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/password-reset/request')
        .send({ email })
        .expect(202);
      expect(response.body).toEqual({ data: { accepted: true } });
    }

    expect(emailSender.passwordResetsSent).toHaveLength(5);
    expect(repository.dump().passwordResetTokens).toHaveLength(5);
  });

  it('changes a Tenant Chat authenticated user password and revokes every existing session', async () => {
    const email = 'tenant-chat-change@example.com';
    const oldPassword = 'Valid1!Pass';
    const newPassword = 'Tenant2!Pass';
    const currentAgent = await createVerifiedAccount(email, oldPassword);
    const user = repository.dump().users.find((item) => item.email === email);
    expect(user).toBeDefined();
    const actorVersionBefore = user!.actorAuthzVersion;

    await expect(
      authService.changePasswordForUser(user!.id, {
        currentPassword: oldPassword,
        newPassword,
      }),
    ).resolves.toEqual({ passwordChanged: true });

    await currentAgent.get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
    expect(
      repository.dump().users.find((item) => item.id === user!.id)
        ?.actorAuthzVersion,
    ).toBe(actorVersionBefore + 1);
  });

  it('changes a signed-in local password and revokes every existing session', async () => {
    const email = 'change-owner@example.com';
    const oldPassword = 'Valid1!Pass';
    const newPassword = 'Changed3!Pass';
    const currentAgent = await createVerifiedAccount(email, oldPassword);
    const otherAgent = request.agent(app.getHttpServer());
    await otherAgent
      .post('/api/auth/login')
      .send({ email, password: oldPassword })
      .expect(200);

    const changeResponse = await currentAgent
      .post('/api/auth/password/change')
      .send({ currentPassword: oldPassword, newPassword })
      .expect(200);

    expect(changeResponse.body).toEqual({
      data: { passwordChanged: true },
    });
    expect(String(changeResponse.headers['set-cookie'])).toContain(
      'gatelm_session=;',
    );
    await currentAgent.get('/api/auth/me').expect(401);
    await otherAgent.get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
    expect(emailSender.passwordChangesSent).toHaveLength(1);
  });

  it('rejects reusing the current password without revoking the active session', async () => {
    const email = 'unchanged-password@example.com';
    const password = 'Valid1!Pass';
    const agent = await createVerifiedAccount(email, password);

    const response = await agent
      .post('/api/auth/password/change')
      .send({ currentPassword: password, newPassword: password })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'PASSWORD_UNCHANGED' });
    await agent.get('/api/auth/me').expect(200);
  });

  it('does not log in a legacy pending local signup without tenant membership', async () => {
    await app.close();
    await createAuthTestApp({ devAutoVerify: true });
    await repository.createUser({
      authProvider: 'local',
      email: 'pending-login@example.com',
      emailVerifiedAt: null,
      name: 'Pending Login',
      passwordHash: await hashPassword('Valid1!Pass'),
      status: 'pending_email_verification',
    });

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'pending-login@example.com',
        password: 'Valid1!Pass',
      })
      .expect(401);
    expect(repository.dump().users[0]?.emailVerifiedAt).toBeNull();
  });

  it('starts Google OAuth and returns verified Google users to the app with a login session without storing Google tokens', async () => {
    const agent = request.agent(app.getHttpServer());

    const startResponse = await agent
      .get('/api/auth/google/start')
      .expect(302);
    const startLocation = startResponse.headers.location as string;
    const state = new URL(startLocation).searchParams.get('state');

    expect(startLocation).toContain('accounts.google.com');
    expect(state).toBeTruthy();

    const callbackResponse = await agent
      .get(`/api/auth/google/callback?code=oauth-code&state=${state}`)
      .expect(302);

    expect(callbackResponse.headers.location).toBe(
      'http://localhost:3000/?auth=organization',
    );
    expect(String(callbackResponse.headers['set-cookie'])).toContain(
      'gatelm_onboarding=',
    );
    const meResponse = await agent.get('/api/auth/me').expect(200);
    expect(meResponse.body).toMatchObject({
      data: {
        session: {
          kind: 'onboarding',
        },
        user: {
          email: 'google-admin@example.com',
          hasLocalPassword: false,
        },
      },
    });
    expect(repository.dump().oauthAccounts[0]).toMatchObject({
      email: 'google-admin@example.com',
      provider: 'google',
      providerSubject: 'google-subject-001',
    });
    expect(JSON.stringify(repository.dump())).not.toContain(
      'access-token-for-oauth-code',
    );
  });
});

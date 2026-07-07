import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { AuthModule } from './auth.module';
import {
  AUTH_REPOSITORY,
  EMAIL_SENDER,
  GOOGLE_OAUTH_CLIENT,
} from './auth.tokens';
import { hashPassword } from './auth.crypto';
import { createInMemoryAuthRepository } from './testing/in-memory-auth-repository';

describe('Auth HTTP API', () => {
  let app: INestApplication;
  let repository: ReturnType<typeof createInMemoryAuthRepository>;
  let emailSender: {
    sent: Array<{ email: string; code: string }>;
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
      sent: [],
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
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AUTH_EMAIL_TRANSPORT: 'dev_memory',
          CONTROL_PLANE_AUTH_COOKIE_SECURE: 'false',
          CONTROL_PLANE_WEB_ORIGIN: 'http://localhost:3000',
        };
        if (!options.omitDevAutoVerify) {
          values.CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY = options.devAutoVerify
            ? 'true'
            : 'false';
        }

        return values[key];
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

  beforeEach(async () => {
    await createAuthTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('signs up and emails a verification code without returning plaintext secrets', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'Admin@Example.com',
        name: 'Kim Admin',
        password: 'correct-horse-battery-staple',
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
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.email).toBe('admin@example.com');
    expect(emailSender.sent[0]?.code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(response.body)).not.toContain(
      emailSender.sent[0]?.code,
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(repository.dump().emailVerificationCodes[0]?.codeHash).not.toContain(
      emailSender.sent[0]?.code,
    );
  });

  it('auto-verifies local dev signups without returning plaintext secrets', async () => {
    await app.close();
    await createAuthTestApp({ devAutoVerify: true });

    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'dev-owner@example.com',
        name: 'Dev Owner',
        password: 'correct-horse-battery-staple',
      })
      .expect(201);

    expect(String(response.headers['set-cookie'])).toContain(
      'gatelm_onboarding=',
    );
    expect(response.body).toMatchObject({
      data: {
        session: {
          kind: 'onboarding',
        },
        user: {
          email: 'dev-owner@example.com',
          name: 'Dev Owner',
        },
        verificationRequired: false,
      },
    });
    expect(emailSender.sent).toHaveLength(0);
    expect(repository.dump().users[0]?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(response.body)).not.toContain('gatelm_onboarding');
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
        password: 'correct-horse-battery-staple',
      })
      .expect(201);

    expect(String(response.headers['set-cookie'])).toContain(
      'gatelm_onboarding=',
    );
    expect(response.body).toMatchObject({
      data: {
        session: {
          kind: 'onboarding',
        },
        user: {
          email: 'default-fake-owner@example.com',
        },
        verificationRequired: false,
      },
    });
    expect(emailSender.sent).toHaveLength(0);
    expect(repository.dump().emailVerificationCodes).toHaveLength(0);
  });

  it('resends verification for an incomplete local signup instead of returning a duplicate account conflict', async () => {
    const firstResponse = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'retry-owner@example.com',
        name: 'Retry Owner',
        password: 'correct-horse-battery-staple',
      })
      .expect(201);

    const secondResponse = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'retry-owner@example.com',
        name: 'Retry Owner',
        password: 'correct-horse-battery-staple',
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
    expect(repository.dump().users).toHaveLength(1);
    expect(repository.dump().emailVerificationCodes).toHaveLength(2);
    expect(repository.dump().emailVerificationCodes[0]?.consumedAt).toBeInstanceOf(
      Date,
    );
    expect(emailSender.sent).toHaveLength(2);
  });

  it('resumes an incomplete fake-verified local signup with an onboarding session', async () => {
    await app.close();
    await createAuthTestApp({ devAutoVerify: true });

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'resume-owner@example.com',
        name: 'Resume Owner',
        password: 'correct-horse-battery-staple',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        email: 'resume-owner@example.com',
        name: 'Resume Owner',
        password: 'correct-horse-battery-staple',
      })
      .expect(201);

    expect(String(response.headers['set-cookie'])).toContain(
      'gatelm_onboarding=',
    );
    expect(response.body).toMatchObject({
      data: {
        session: {
          kind: 'onboarding',
        },
        user: {
          email: 'resume-owner@example.com',
        },
        verificationRequired: false,
      },
    });
    expect(repository.dump().users).toHaveLength(1);
    expect(repository.dump().tenantMemberships).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it('verifies email, creates an organization, and grants tenant_admin membership', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post('/api/auth/signup').send({
      email: 'owner@example.com',
      name: 'Owner User',
      password: 'correct-horse-battery-staple',
    });
    const code = emailSender.sent[0]?.code;

    const verifyResponse = await agent
      .post('/api/auth/email/verify')
      .send({ code, email: 'owner@example.com' })
      .expect(200);

    expect(String(verifyResponse.headers['set-cookie'])).toContain(
      'gatelm_onboarding=',
    );

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
      password: 'correct-horse-battery-staple',
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
      password: 'correct-horse-battery-staple',
    });
    const code = emailSender.sent[0]?.code;
    const invalidCode = code === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await agent
        .post('/api/auth/email/verify')
        .send({ code: invalidCode, email: 'limited@example.com' })
        .expect(401);
    }

    const verificationCode = repository.dump().emailVerificationCodes[0];
    expect(verificationCode?.failedAttemptCount).toBe(5);
    expect(verificationCode?.consumedAt).toBeInstanceOf(Date);

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
      password: 'correct-horse-battery-staple',
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
        password: 'correct-horse-battery-staple',
      })
      .expect(200);

    const cookie = String(loginResponse.headers['set-cookie']);
    expect(cookie).toContain('gatelm_session=');
    expect(cookie).toContain('HttpOnly');
    expect(JSON.stringify(loginResponse.body)).not.toContain('accessToken');
    expect(JSON.stringify(loginResponse.body)).not.toContain('refreshToken');
  });

  it('logs in to resume a pending local signup in fake verification mode', async () => {
    await app.close();
    await createAuthTestApp({ devAutoVerify: true });
    await repository.createUser({
      authProvider: 'local',
      email: 'pending-login@example.com',
      emailVerifiedAt: null,
      name: 'Pending Login',
      passwordHash: await hashPassword('correct-horse-battery-staple'),
      status: 'pending_email_verification',
    });

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'pending-login@example.com',
        password: 'correct-horse-battery-staple',
      })
      .expect(200);

    expect(String(response.headers['set-cookie'])).toContain(
      'gatelm_onboarding=',
    );
    expect(response.body).toMatchObject({
      data: {
        memberships: [],
        session: {
          kind: 'onboarding',
        },
        user: {
          email: 'pending-login@example.com',
        },
      },
    });
    expect(response.body.data.user.emailVerifiedAt).toEqual(expect.any(String));
    expect(repository.dump().users[0]?.emailVerifiedAt).toBeInstanceOf(Date);
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

    expect(callbackResponse.headers.location).toBe('http://localhost:3000/');
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


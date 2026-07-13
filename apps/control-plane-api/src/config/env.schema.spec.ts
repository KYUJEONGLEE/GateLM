import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('keeps local dev_memory auto verify defaults outside production-like envs', () => {
    const env = validateEnv(baseEnv());

    expect(env.AUTH_EMAIL_TRANSPORT).toBe('dev_memory');
    expect(env.CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY).toBe('true');
    expect(env.CONTROL_PLANE_ADMIN_AUTH_MODE).toBe('session_cookie');
    expect(env.TENANT_CHAT_PROJECTOR_ENABLED).toBe('false');
    expect(env.TENANT_CHAT_PROJECTOR_BATCH_SIZE).toBe(50);
    expect(env.TENANT_CHAT_PROJECTOR_INTERVAL_MS).toBe(1000);
    expect(env.TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS).toBe(5);
  });

  it('validates Tenant Chat projector bounds without changing ports', () => {
    const env = validateEnv({
      ...baseEnv(),
      TENANT_CHAT_PROJECTOR_ENABLED: 'true',
      TENANT_CHAT_PROJECTOR_BATCH_SIZE: '25',
      TENANT_CHAT_PROJECTOR_INTERVAL_MS: '500',
      TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS: '7',
    });

    expect(env.CONTROL_PLANE_PORT).toBe(3001);
    expect(env.TENANT_CHAT_PROJECTOR_ENABLED).toBe('true');
    expect(env.TENANT_CHAT_PROJECTOR_BATCH_SIZE).toBe(25);
    expect(env.TENANT_CHAT_PROJECTOR_INTERVAL_MS).toBe(500);
    expect(env.TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS).toBe(7);
  });

  it('does not treat a local AWS region setting as production-like by itself', () => {
    const env = validateEnv({
      ...baseEnv(),
      AWS_DEFAULT_REGION: 'ap-northeast-2',
      AWS_REGION: 'ap-northeast-2',
    });

    expect(env.AUTH_EMAIL_TRANSPORT).toBe('dev_memory');
    expect(env.CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY).toBe('true');
  });

  it('rejects demo admin auth mode in production-like envs', () => {
    expect(() =>
      validateEnv({
        ...prodEnv(),
        CONTROL_PLANE_ADMIN_AUTH_MODE: 'demo_admin_placeholder',
      }),
    ).toThrow(
      'CONTROL_PLANE_ADMIN_AUTH_MODE must be session_cookie in production-like environments',
    );
  });

  it('rejects dev memory email transport in production-like envs', () => {
    expect(() =>
      validateEnv({
        ...prodEnv(),
        AUTH_EMAIL_TRANSPORT: 'dev_memory',
        CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY: 'false',
      }),
    ).toThrow(
      'AUTH_EMAIL_TRANSPORT=dev_memory is not allowed in production-like environments',
    );
  });

  it('rejects dev auto verify in production-like envs', () => {
    expect(() =>
      validateEnv({
        ...prodEnv(),
        CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY: 'true',
      }),
    ).toThrow(
      'CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY=true is not allowed in production-like environments',
    );
  });

  it('rejects missing or placeholder internal service tokens in production-like envs', () => {
    expect(() =>
      validateEnv({
        ...prodEnv(),
        CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: '',
      }),
    ).toThrow(
      'CONTROL_PLANE_INTERNAL_SERVICE_TOKEN must be a non-placeholder value of at least 32 characters in production-like environments',
    );

    expect(() =>
      validateEnv({
        ...prodEnv(),
        CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: 'replace-me-internal-token-1234567890',
      }),
    ).toThrow(
      'CONTROL_PLANE_INTERNAL_SERVICE_TOKEN must be a non-placeholder value of at least 32 characters in production-like environments',
    );

    expect(() =>
      validateEnv({
        ...prodEnv(),
        CONTROL_PLANE_INTERNAL_SERVICE_TOKEN:
          'local-control-plane-internal-token-for-dev-only',
      }),
    ).toThrow(
      'CONTROL_PLANE_INTERNAL_SERVICE_TOKEN must be a non-placeholder value of at least 32 characters in production-like environments',
    );
  });

  it('accepts session cookie, smtp, and strong internal token in production-like envs', () => {
    const env = validateEnv(prodEnv());

    expect(env.CONTROL_PLANE_ADMIN_AUTH_MODE).toBe('session_cookie');
    expect(env.AUTH_EMAIL_TRANSPORT).toBe('smtp');
    expect(env.CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY).toBe('false');
    expect(env.CONTROL_PLANE_INTERNAL_SERVICE_TOKEN).toBe(
      'prod-internal-token-1234567890abcdef123456',
    );
    expect(env.TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN).toBe(
      'prod-chat-service-token-1234567890abcdef',
    );
  });

  function baseEnv() {
    return {
      CONTROL_PLANE_AUTH_STATE_SECRET: 'state-secret-for-test',
      DATABASE_URL: 'postgresql://gatelm:gatelm@localhost:5432/gatelm',
      REDIS_URL: 'redis://localhost:6379',
    };
  }

  function prodEnv() {
    return {
      ...baseEnv(),
      AUTH_EMAIL_TRANSPORT: 'smtp',
      CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY: 'false',
      CONTROL_PLANE_INTERNAL_SERVICE_TOKEN:
        'prod-internal-token-1234567890abcdef123456',
      TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN:
        'prod-chat-service-token-1234567890abcdef',
      NODE_ENV: 'production',
      SMTP_FROM: 'security@example.test',
      SMTP_HOST: 'smtp.example.test',
    };
  }
});

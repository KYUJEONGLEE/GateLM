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
    expect(env.TENANT_CHAT_CACHE_KEY_SET_ID).toBe(
      'tenant_chat_cache_keys_v1',
    );
    expect(env.DASHBOARD_ROLLUP_ENABLED).toBe('false');
    expect(env.DASHBOARD_ROLLUP_BUILD_MODE).toBe('legacy');
    expect(env.DASHBOARD_ROLLUP_INTERVAL_MS).toBe(1000);
    expect(env.DASHBOARD_ROLLUP_PROJECT_APPLICATION_ENABLED).toBe('true');
    expect(env.DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE).toBe(500);
    expect(env.DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE).toBe(8);
    expect(env.DASHBOARD_ROLLUP_DISCOVERY_LAG_MS).toBe(60000);
    expect(env.DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS).toBe(60000);
    expect(env.DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS).toBe(900000);
    expect(env.CLICKHOUSE_ANALYTICS_READ_ENABLED).toBe('false');
    expect(env.CLICKHOUSE_DATABASE).toBe('analytics');
    expect(env.CLICKHOUSE_TABLE).toBe('llm_invocations');
    expect(env.CLICKHOUSE_USERNAME).toBe('analytics_reader');
    expect(env.CLICKHOUSE_QUERY_TIMEOUT_MS).toBe(1500);
    expect(env.TENANT_CHAT_RAG_ENABLED).toBe('false');
    expect(env.RAG_EMBEDDING_PROVIDER).toBe('openai');
    expect(env.RAG_EMBEDDING_MODEL).toBe('text-embedding-3-large');
    expect(env.RAG_EMBEDDING_DIMENSIONS).toBe(1536);
    expect(env.RAG_EMBEDDING_PROFILE_VERSION).toBe(1);
    expect(env.RAG_DISTANCE_METRIC).toBe('cosine');
    expect(env.RAG_OBJECT_STORE_DRIVER).toBe('fake');
    expect(env.RAG_MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
    expect(env.RAG_S3_FORCE_PATH_STYLE).toBe('false');
  });

  it('accepts a bounded Tenant Chat cache key-set identifier', () => {
    const env = validateEnv({
      ...baseEnv(),
      TENANT_CHAT_CACHE_KEY_SET_ID: 'tenant-chat-local-cache-1',
    });

    expect(env.TENANT_CHAT_CACHE_KEY_SET_ID).toBe(
      'tenant-chat-local-cache-1',
    );
  });

  it('rejects an unsafe Tenant Chat cache key-set identifier', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        TENANT_CHAT_CACHE_KEY_SET_ID: 'invalid cache key set',
      }),
    ).toThrow(
      'TENANT_CHAT_CACHE_KEY_SET_ID must be a bounded opaque identifier',
    );
  });

  it('validates dashboard rollup bounds without changing ports', () => {
    const env = validateEnv({
      ...baseEnv(),
      DASHBOARD_ROLLUP_ENABLED: 'true',
      DASHBOARD_ROLLUP_BUILD_MODE: 'shadow',
      DASHBOARD_ROLLUP_INTERVAL_MS: '500',
      DASHBOARD_ROLLUP_PROJECT_APPLICATION_ENABLED: 'false',
      DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE: '750',
      DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE: '12',
      DASHBOARD_ROLLUP_DISCOVERY_LAG_MS: '30000',
      DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS: '120000',
      DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS: '1800000',
    });

    expect(env.CONTROL_PLANE_PORT).toBe(3001);
    expect(env.DASHBOARD_ROLLUP_ENABLED).toBe('true');
    expect(env.DASHBOARD_ROLLUP_BUILD_MODE).toBe('shadow');
    expect(env.DASHBOARD_ROLLUP_INTERVAL_MS).toBe(500);
    expect(env.DASHBOARD_ROLLUP_PROJECT_APPLICATION_ENABLED).toBe('false');
    expect(env.DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE).toBe(750);
    expect(env.DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE).toBe(12);
    expect(env.DASHBOARD_ROLLUP_DISCOVERY_LAG_MS).toBe(30000);
    expect(env.DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS).toBe(120000);
    expect(env.DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS).toBe(1800000);
  });

  it('rejects an unknown dashboard rollup build mode', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        DASHBOARD_ROLLUP_BUILD_MODE: 'unsafe-active',
      }),
    ).toThrow(
      'DASHBOARD_ROLLUP_BUILD_MODE must be legacy, shadow, or minute',
    );
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

  it('validates ClickHouse analytics read settings only when enabled', () => {
    const env = validateEnv({
      ...baseEnv(),
      CLICKHOUSE_ANALYTICS_READ_ENABLED: 'true',
      CLICKHOUSE_URL: 'http://10.78.2.60:8123',
      CLICKHOUSE_DATABASE: 'analytics',
      CLICKHOUSE_TABLE: 'llm_invocations',
      CLICKHOUSE_USERNAME: 'analytics_writer',
      CLICKHOUSE_PASSWORD: 'strong-test-password',
      CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET:
        'employee-identity-hmac-secret-at-least-32-characters',
      CLICKHOUSE_QUERY_TIMEOUT_MS: '2000',
    });

    expect(env.CLICKHOUSE_ANALYTICS_READ_ENABLED).toBe('true');
    expect(env.CLICKHOUSE_URL).toBe('http://10.78.2.60:8123');
    expect(env.CLICKHOUSE_QUERY_TIMEOUT_MS).toBe(2000);
  });

  it('rejects incomplete or credential-bearing ClickHouse read settings', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        CLICKHOUSE_ANALYTICS_READ_ENABLED: 'true',
        CLICKHOUSE_URL: 'http://10.78.2.60:8123',
        CLICKHOUSE_PASSWORD: 'strong-test-password',
      }),
    ).toThrow(
      'CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET must be at least 32 characters',
    );

    expect(() =>
      validateEnv({
        ...baseEnv(),
        CLICKHOUSE_ANALYTICS_READ_ENABLED: 'true',
        CLICKHOUSE_URL: 'http://user:password@10.78.2.60:8123',
        CLICKHOUSE_PASSWORD: 'strong-test-password',
        CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET:
          'employee-identity-hmac-secret-at-least-32-characters',
      }),
    ).toThrow('without embedded credentials');
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
    expect(env.RAG_OBJECT_STORE_DRIVER).toBe('s3');
    expect(env.RAG_S3_BUCKET).toBe('gatelm-rag-prod');
  });

  it('starts in production-like mode with RAG disabled and no RAG storage or wrapping key', () => {
    const env = validateEnv({
      ...prodEnv(),
      TENANT_CHAT_RAG_ENABLED: 'false',
      RAG_CONTENT_WRAPPING_KEYS_FILE: undefined,
      RAG_OBJECT_STORE_DRIVER: undefined,
      RAG_S3_BUCKET: undefined,
      RAG_S3_KMS_KEY_ID: undefined,
      RAG_S3_REGION: undefined,
    });

    expect(env.TENANT_CHAT_RAG_ENABLED).toBe('false');
    expect(env.RAG_OBJECT_STORE_DRIVER).toBe('s3');
    expect(env.RAG_S3_BUCKET).toBeUndefined();
    expect(env.RAG_CONTENT_WRAPPING_KEYS_FILE).toBeUndefined();
  });

  it('accepts an explicitly configured local S3-compatible endpoint', () => {
    const env = validateEnv({
      ...baseEnv(),
      RAG_OBJECT_STORE_DRIVER: 's3',
      RAG_S3_BUCKET: 'gatelm-rag-local',
      RAG_S3_ENDPOINT: 'http://localhost:9000',
      RAG_S3_FORCE_PATH_STYLE: 'true',
      RAG_S3_KMS_KEY_ID: 'local-kms-key',
      RAG_S3_REGION: 'ap-northeast-2',
      RAG_MAX_UPLOAD_BYTES: '1048576',
    });

    expect(env.RAG_OBJECT_STORE_DRIVER).toBe('s3');
    expect(env.RAG_S3_FORCE_PATH_STYLE).toBe('true');
    expect(env.RAG_MAX_UPLOAD_BYTES).toBe(1048576);
  });

  it('recognizes the repository DEPLOYMENT_MODE marker for local and release environments', () => {
    const local = validateEnv({
      ...baseEnv(),
      NODE_ENV: undefined,
      DEPLOYMENT_MODE: 'local',
      RAG_OBJECT_STORE_DRIVER: 'fake',
    });
    expect(local.RAG_OBJECT_STORE_DRIVER).toBe('fake');

    expect(() =>
      validateEnv({
        ...prodEnv(),
        NODE_ENV: undefined,
        DEPLOYMENT_MODE: 'self_host',
        RAG_OBJECT_STORE_DRIVER: 'fake',
      }),
    ).toThrow('RAG_OBJECT_STORE_DRIVER must be s3');
  });

  it('rejects fake storage, custom endpoints, and static AWS credentials in production', () => {
    expect(() =>
      validateEnv({ ...prodEnv(), RAG_OBJECT_STORE_DRIVER: 'fake' }),
    ).toThrow('RAG_OBJECT_STORE_DRIVER must be s3');
    expect(() =>
      validateEnv({ ...prodEnv(), RAG_S3_ENDPOINT: 'http://localhost:9000' }),
    ).toThrow('RAG_S3_ENDPOINT is not allowed');
    expect(() =>
      validateEnv({ ...prodEnv(), AWS_ACCESS_KEY_ID: 'static-key' }),
    ).toThrow('AWS_ACCESS_KEY_ID is not allowed');
    expect(() =>
      validateEnv({
        ...prodEnv(),
        TENANT_CHAT_RAG_ENABLED: 'false',
        RAG_OBJECT_STORE_DRIVER: 'fake',
      }),
    ).toThrow('RAG_OBJECT_STORE_DRIVER must be s3');
    expect(() =>
      validateEnv({
        ...prodEnv(),
        TENANT_CHAT_RAG_ENABLED: 'false',
        AWS_SECRET_ACCESS_KEY: 'static-secret',
      }),
    ).toThrow('AWS_SECRET_ACCESS_KEY is not allowed');
    expect(() =>
      validateEnv({
        ...prodEnv(),
        TENANT_CHAT_CONTENT_KEYS_FILE:
          '/run/secrets/tenant-chat/content-keys.json',
      }),
    ).toThrow('TENANT_CHAT_CONTENT_KEYS_FILE must not be mounted');
  });

  it('fails closed when the environment is unknown and fake storage is requested', () => {
    const unknown = { ...baseEnv(), NODE_ENV: undefined };
    expect(() =>
      validateEnv({ ...unknown, RAG_OBJECT_STORE_DRIVER: 'fake' }),
    ).toThrow('allowed only in explicit local/test');
    expect(validateEnv(unknown).RAG_OBJECT_STORE_DRIVER).toBe('s3');
    expect(() =>
      validateEnv({ ...unknown, TENANT_CHAT_RAG_ENABLED: 'true' }),
    ).toThrow('must be explicitly configured outside local/test');
    expect(() =>
      validateEnv({
        ...unknown,
        RAG_OBJECT_STORE_DRIVER: 's3',
        RAG_S3_BUCKET: 'local-bucket',
        RAG_S3_ENDPOINT: 'http://localhost:9000',
        RAG_S3_FORCE_PATH_STYLE: 'true',
        RAG_S3_KMS_KEY_ID: 'local-kms',
        RAG_S3_REGION: 'ap-northeast-2',
      }),
    ).toThrow('allowed only in explicit local/test');
  });

  it('rejects upload limits that exceed the database constraint', () => {
    expect(() =>
      validateEnv({ ...baseEnv(), RAG_MAX_UPLOAD_BYTES: '20971521' }),
    ).toThrow('RAG_MAX_UPLOAD_BYTES');
  });

  it.each([
    ['TENANT_CHAT_RAG_ENABLED', 'enabled'],
    ['RAG_EMBEDDING_PROVIDER', 'unsupported'],
    ['RAG_EMBEDDING_MODEL', 'text-embedding-3-small'],
    ['RAG_EMBEDDING_DIMENSIONS', '3072'],
    ['RAG_EMBEDDING_PROFILE_VERSION', '2'],
    ['RAG_DISTANCE_METRIC', 'euclidean'],
  ])('rejects invalid fixed RAG setting %s', (key, value) => {
    expect(() => validateEnv({ ...baseEnv(), [key]: value })).toThrow(key);
  });

  function baseEnv() {
    return {
      CONTROL_PLANE_AUTH_STATE_SECRET: 'state-secret-for-test',
      DATABASE_URL: 'postgresql://gatelm:gatelm@localhost:5432/gatelm',
      NODE_ENV: 'test',
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
      TENANT_CHAT_RAG_ENABLED: 'true',
      RAG_CONTENT_WRAPPING_KEYS_FILE:
        '/run/secrets/rag/content-wrapping-keys.json',
      NODE_ENV: 'production',
      SMTP_FROM: 'security@example.test',
      SMTP_HOST: 'smtp.example.test',
      RAG_OBJECT_STORE_DRIVER: 's3',
      RAG_S3_BUCKET: 'gatelm-rag-prod',
      RAG_S3_KMS_KEY_ID: 'arn:aws:kms:ap-northeast-2:123456789012:key/test',
      RAG_S3_REGION: 'ap-northeast-2',
    };
  }
});

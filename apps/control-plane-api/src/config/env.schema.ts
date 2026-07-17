import { validateRagRuntimeConfig, type RagRuntimeConfig } from '@gatelm/rag-config';

type RawEnv = Record<string, string | undefined>;

interface ControlPlaneEnv extends RagRuntimeConfig {
  AUTH_EMAIL_TRANSPORT?: string;
  CONTROL_PLANE_INTERNAL_SERVICE_TOKEN?: string;
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN?: string;
  TENANT_CHAT_CACHE_KEY_SET_ID?: string;
  TENANT_CHAT_GOOGLE_REDIRECT_URI?: string;
  TENANT_CHAT_WEB_ORIGIN?: string;
  CONTROL_PLANE_AUTH_COOKIE_SECURE?: string;
  CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY?: string;
  CONTROL_PLANE_AUTH_STATE_SECRET: string;
  CONTROL_PLANE_PORT: number;
  CONTROL_PLANE_WEB_ORIGIN?: string;
  DATABASE_URL: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  REDIS_URL: string;
  SMTP_FROM?: string;
  SMTP_HOST?: string;
  SMTP_PASSWORD?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: string;
  SMTP_TLS_MODE?: string;
  SMTP_USER?: string;
  CONTROL_PLANE_ADMIN_AUTH_MODE: string;
  DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE?: number;
  DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE?: number;
  DASHBOARD_ROLLUP_DISCOVERY_LAG_MS?: number;
  DASHBOARD_ROLLUP_ENABLED?: string;
  DASHBOARD_ROLLUP_INTERVAL_MS?: number;
  DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS?: number;
  DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS?: number;
  TENANT_CHAT_PROJECTOR_BATCH_SIZE?: number;
  TENANT_CHAT_PROJECTOR_ENABLED?: string;
  TENANT_CHAT_PROJECTOR_INTERVAL_MS?: number;
  TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS?: number;
  TENANT_CHAT_CONTENT_KEYS_FILE?: string;
  RAG_CONTENT_WRAPPING_KEYS_FILE?: string;
  RAG_OBJECT_STORE_DRIVER: 's3' | 'fake';
  RAG_MAX_UPLOAD_BYTES: number;
  RAG_S3_REGION?: string;
  RAG_S3_BUCKET?: string;
  RAG_S3_KMS_KEY_ID?: string;
  RAG_S3_ENDPOINT?: string;
  RAG_S3_FORCE_PATH_STYLE: string;
}

type ValidatedControlPlaneEnv = Record<string, string | number | undefined> &
  ControlPlaneEnv;

const DEFAULT_CONTROL_PLANE_PORT = 3001;
const DEFAULT_ADMIN_AUTH_MODE = 'session_cookie';
const DEFAULT_CONTROL_PLANE_WEB_ORIGIN = 'http://localhost:3000';
const DEFAULT_AUTH_EMAIL_TRANSPORT = 'dev_memory';
const DEMO_ADMIN_AUTH_MODE = 'demo_admin_placeholder';
const MAX_RAG_UPLOAD_BYTES = 20 * 1024 * 1024;

function requireString(env: RawEnv, key: keyof ControlPlaneEnv): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readPort(env: RawEnv): number {
  const raw = env.CONTROL_PLANE_PORT;
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_CONTROL_PLANE_PORT;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('CONTROL_PLANE_PORT must be an integer between 1 and 65535');
  }

  return value;
}

function readOptionalPort(env: RawEnv, key: keyof ControlPlaneEnv): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }

  return value;
}

function readOptionalInteger(
  env: RawEnv,
  key: keyof ControlPlaneEnv,
  minimum: number,
  maximum: number,
): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }

  return value;
}

function readBooleanString(env: RawEnv, key: keyof ControlPlaneEnv): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`${key} must be either "true" or "false"`);
  }

  return raw;
}

function readEmailTransport(env: RawEnv): string {
  const value = env.AUTH_EMAIL_TRANSPORT ?? DEFAULT_AUTH_EMAIL_TRANSPORT;
  if (value !== 'dev_memory' && value !== 'smtp') {
    throw new Error('AUTH_EMAIL_TRANSPORT must be either dev_memory or smtp');
  }

  return value;
}

function readAdminAuthMode(env: RawEnv): string {
  const value = env.CONTROL_PLANE_ADMIN_AUTH_MODE ?? DEFAULT_ADMIN_AUTH_MODE;
  if (value !== DEFAULT_ADMIN_AUTH_MODE && value !== DEMO_ADMIN_AUTH_MODE) {
    throw new Error(
      'CONTROL_PLANE_ADMIN_AUTH_MODE must be session_cookie or demo_admin_placeholder',
    );
  }

  return value;
}

function readOptionalString(env: RawEnv, key: keyof ControlPlaneEnv): string | undefined {
  const value = env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function readCacheKeySetId(env: RawEnv): string {
  const value =
    readOptionalString(env, 'TENANT_CHAT_CACHE_KEY_SET_ID') ??
    'tenant_chat_cache_keys_v1';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(
      'TENANT_CHAT_CACHE_KEY_SET_ID must be a bounded opaque identifier',
    );
  }
  return value;
}

function readSmtpTlsMode(env: RawEnv): string | undefined {
  const value = env.SMTP_TLS_MODE;
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  if (
    value !== 'disabled' &&
    value !== 'opportunistic' &&
    value !== 'required'
  ) {
    throw new Error(
      'SMTP_TLS_MODE must be disabled, opportunistic, or required',
    );
  }

  return value;
}

export function validateEnv(config: RawEnv): ValidatedControlPlaneEnv {
  const emailTransport = readEmailTransport(config);
  const defaultDevAutoVerify =
    emailTransport === 'dev_memory' ? 'true' : 'false';
  const devAutoVerify =
    readBooleanString(config, 'CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY') ??
    defaultDevAutoVerify;
  const adminAuthMode = readAdminAuthMode(config);
  const internalServiceToken = readOptionalString(
    config,
    'CONTROL_PLANE_INTERNAL_SERVICE_TOKEN',
  );
  const tenantChatServiceToken = readOptionalString(
    config,
    'TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN',
  );
  const ragRuntimeConfig = validateRagRuntimeConfig(config);
  const ragEnabled = ragRuntimeConfig.TENANT_CHAT_RAG_ENABLED === 'true';
  const productionLike = isProductionLikeEnv(config);
  const ragObjectStoreDriver = readRagObjectStoreDriver(
    config,
    productionLike,
    ragEnabled,
  );
  const ragS3Region = readOptionalString(config, 'RAG_S3_REGION');
  const ragS3Bucket = readOptionalString(config, 'RAG_S3_BUCKET');
  const ragS3KmsKeyId = readOptionalString(config, 'RAG_S3_KMS_KEY_ID');
  const ragS3Endpoint = readOptionalString(config, 'RAG_S3_ENDPOINT');
  const ragContentWrappingKeysFile = readOptionalString(
    config,
    'RAG_CONTENT_WRAPPING_KEYS_FILE',
  );
  const ragS3ForcePathStyle =
    readBooleanString(config, 'RAG_S3_FORCE_PATH_STYLE') ?? 'false';
  if (
    (ragS3Endpoint || ragS3ForcePathStyle === 'true') &&
    !productionLike &&
    !isExplicitLocalOrTestEnv(config)
  ) {
    throw new Error(
      'RAG_S3_ENDPOINT and RAG_S3_FORCE_PATH_STYLE are allowed only in explicit local/test environments',
    );
  }
  if (emailTransport === 'smtp') {
    requireString(config, 'SMTP_HOST');
    requireString(config, 'SMTP_FROM');

    if (
      (config.SMTP_USER && !config.SMTP_PASSWORD) ||
      (!config.SMTP_USER && config.SMTP_PASSWORD)
    ) {
      throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
    }
  }
  if (productionLike) {
    if (adminAuthMode !== DEFAULT_ADMIN_AUTH_MODE) {
      throw new Error(
        'CONTROL_PLANE_ADMIN_AUTH_MODE must be session_cookie in production-like environments',
      );
    }
    if (emailTransport === 'dev_memory') {
      throw new Error(
        'AUTH_EMAIL_TRANSPORT=dev_memory is not allowed in production-like environments',
      );
    }
    if (devAutoVerify === 'true') {
      throw new Error(
        'CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY=true is not allowed in production-like environments',
      );
    }
    if (
      !internalServiceToken ||
      isWeakInternalServiceToken(internalServiceToken)
    ) {
      throw new Error(
        'CONTROL_PLANE_INTERNAL_SERVICE_TOKEN must be a non-placeholder value of at least 32 characters in production-like environments',
      );
    }
    if (
      !tenantChatServiceToken ||
      isWeakInternalServiceToken(tenantChatServiceToken)
    ) {
      throw new Error(
        'TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN must be a non-placeholder value of at least 32 characters in production-like environments',
      );
    }
    const ragStorage = {
      driver: ragObjectStoreDriver,
      endpoint: ragS3Endpoint,
      forcePathStyle: ragS3ForcePathStyle,
      region: ragS3Region,
      bucket: ragS3Bucket,
      kmsKeyId: ragS3KmsKeyId,
    } as const;
    assertProductionRagStorageSafety(config, ragStorage);
    if (ragEnabled) {
      assertProductionRagStorage(config, ragStorage);
    }
    if (readOptionalString(config, 'TENANT_CHAT_CONTENT_KEYS_FILE')) {
      throw new Error(
        'TENANT_CHAT_CONTENT_KEYS_FILE must not be mounted in Control Plane production-like environments',
      );
    }
    if (ragEnabled && !ragContentWrappingKeysFile) {
      throw new Error(
        'Missing required environment variable: RAG_CONTENT_WRAPPING_KEYS_FILE',
      );
    }
  }

  if (ragEnabled && ragObjectStoreDriver === 's3') {
    requireConfiguredRagS3(ragS3Region, ragS3Bucket, ragS3KmsKeyId);
  }

  return {
    ...config,
    ...ragRuntimeConfig,
    AUTH_EMAIL_TRANSPORT: emailTransport,
    CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: internalServiceToken,
    TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN: tenantChatServiceToken,
    TENANT_CHAT_CACHE_KEY_SET_ID: readCacheKeySetId(config),
    TENANT_CHAT_GOOGLE_REDIRECT_URI:
      config.TENANT_CHAT_GOOGLE_REDIRECT_URI ??
      'http://chat.localhost:3002/api/tenant-chat/auth/google/callback',
    TENANT_CHAT_WEB_ORIGIN:
      config.TENANT_CHAT_WEB_ORIGIN ?? 'http://chat.localhost:3002',
    CONTROL_PLANE_PORT: readPort(config),
    CONTROL_PLANE_AUTH_COOKIE_SECURE:
      readBooleanString(config, 'CONTROL_PLANE_AUTH_COOKIE_SECURE') ?? 'false',
    CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY: devAutoVerify,
    CONTROL_PLANE_AUTH_STATE_SECRET: requireString(
      config,
      'CONTROL_PLANE_AUTH_STATE_SECRET',
    ),
    DATABASE_URL: requireString(config, 'DATABASE_URL'),
    CONTROL_PLANE_WEB_ORIGIN:
      config.CONTROL_PLANE_WEB_ORIGIN ?? DEFAULT_CONTROL_PLANE_WEB_ORIGIN,
    GOOGLE_OAUTH_CLIENT_ID: config.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: config.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: config.GOOGLE_OAUTH_REDIRECT_URI,
    REDIS_URL: requireString(config, 'REDIS_URL'),
    SMTP_FROM: config.SMTP_FROM,
    SMTP_HOST: config.SMTP_HOST,
    SMTP_PASSWORD: config.SMTP_PASSWORD,
    SMTP_PORT: readOptionalPort(config, 'SMTP_PORT'),
    SMTP_SECURE: readBooleanString(config, 'SMTP_SECURE') ?? 'false',
    SMTP_TLS_MODE: readSmtpTlsMode(config) ?? 'opportunistic',
    SMTP_USER: config.SMTP_USER,
    CONTROL_PLANE_ADMIN_AUTH_MODE: adminAuthMode,
    DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE:
      readOptionalInteger(config, 'DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE', 1, 100) ??
      8,
    DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE:
      readOptionalInteger(
        config,
        'DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE',
        1,
        5000,
      ) ?? 500,
    DASHBOARD_ROLLUP_DISCOVERY_LAG_MS:
      readOptionalInteger(
        config,
        'DASHBOARD_ROLLUP_DISCOVERY_LAG_MS',
        1000,
        600000,
      ) ?? 60000,
    DASHBOARD_ROLLUP_ENABLED:
      readBooleanString(config, 'DASHBOARD_ROLLUP_ENABLED') ?? 'false',
    DASHBOARD_ROLLUP_INTERVAL_MS:
      readOptionalInteger(config, 'DASHBOARD_ROLLUP_INTERVAL_MS', 100, 60000) ??
      1000,
    DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS:
      readOptionalInteger(
        config,
        'DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS',
        1000,
        3600000,
      ) ?? 60000,
    DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS:
      readOptionalInteger(
        config,
        'DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS',
        60000,
        86400000,
      ) ?? 900000,
    TENANT_CHAT_PROJECTOR_BATCH_SIZE:
      readOptionalInteger(config, 'TENANT_CHAT_PROJECTOR_BATCH_SIZE', 1, 500) ??
      50,
    TENANT_CHAT_PROJECTOR_ENABLED:
      readBooleanString(config, 'TENANT_CHAT_PROJECTOR_ENABLED') ?? 'false',
    TENANT_CHAT_PROJECTOR_INTERVAL_MS:
      readOptionalInteger(
        config,
        'TENANT_CHAT_PROJECTOR_INTERVAL_MS',
        100,
        60000,
      ) ?? 1000,
    TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS:
      readOptionalInteger(
        config,
        'TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS',
        1,
        100,
      ) ?? 5,
    RAG_CONTENT_WRAPPING_KEYS_FILE: ragContentWrappingKeysFile,
    RAG_OBJECT_STORE_DRIVER: ragObjectStoreDriver,
    RAG_MAX_UPLOAD_BYTES:
      readOptionalInteger(
        config,
        'RAG_MAX_UPLOAD_BYTES',
        1,
        MAX_RAG_UPLOAD_BYTES,
      ) ?? MAX_RAG_UPLOAD_BYTES,
    RAG_S3_REGION: ragS3Region,
    RAG_S3_BUCKET: ragS3Bucket,
    RAG_S3_KMS_KEY_ID: ragS3KmsKeyId,
    RAG_S3_ENDPOINT: ragS3Endpoint,
    RAG_S3_FORCE_PATH_STYLE: ragS3ForcePathStyle,
  };
}

function readRagObjectStoreDriver(
  env: RawEnv,
  productionLike: boolean,
  ragEnabled: boolean,
): 's3' | 'fake' {
  const explicitlyLocal = isExplicitLocalOrTestEnv(env);
  const configured = env.RAG_OBJECT_STORE_DRIVER?.trim();
  let value = configured;
  if (!value) {
    if (!ragEnabled) value = explicitlyLocal ? 'fake' : 's3';
    else if (productionLike) value = 's3';
    else if (explicitlyLocal) value = 'fake';
    else value = '';
  }
  if (value !== 's3' && value !== 'fake') {
    throw new Error(
      'RAG_OBJECT_STORE_DRIVER must be explicitly configured outside local/test environments',
    );
  }
  if (productionLike && value !== 's3') {
    throw new Error(
      'RAG_OBJECT_STORE_DRIVER must be s3 in production-like environments',
    );
  }
  if (value === 'fake' && !explicitlyLocal) {
    throw new Error(
      'RAG_OBJECT_STORE_DRIVER=fake is allowed only in explicit local/test environments',
    );
  }
  return value;
}

function requireConfiguredRagS3(
  region: string | undefined,
  bucket: string | undefined,
  kmsKeyId: string | undefined,
): void {
  if (!region) {
    throw new Error('Missing required environment variable: RAG_S3_REGION');
  }
  if (!bucket) {
    throw new Error('Missing required environment variable: RAG_S3_BUCKET');
  }
  if (!kmsKeyId) {
    throw new Error('Missing required environment variable: RAG_S3_KMS_KEY_ID');
  }
}

function assertProductionRagStorage(
  env: RawEnv,
  storage: Readonly<{
    driver: 's3' | 'fake';
    endpoint: string | undefined;
    forcePathStyle: string;
    region: string | undefined;
    bucket: string | undefined;
    kmsKeyId: string | undefined;
  }>,
): void {
  assertProductionRagStorageSafety(env, storage);
  requireConfiguredRagS3(storage.region, storage.bucket, storage.kmsKeyId);
}

function assertProductionRagStorageSafety(
  env: RawEnv,
  storage: Readonly<{
    driver: 's3' | 'fake';
    endpoint: string | undefined;
    forcePathStyle: string;
    region: string | undefined;
    bucket: string | undefined;
    kmsKeyId: string | undefined;
  }>,
): void {
  if (storage.driver !== 's3') {
    throw new Error(
      'RAG_OBJECT_STORE_DRIVER must be s3 in production-like environments',
    );
  }
  if (storage.endpoint) {
    throw new Error(
      'RAG_S3_ENDPOINT is not allowed in production-like environments',
    );
  }
  if (storage.forcePathStyle === 'true') {
    throw new Error(
      'RAG_S3_FORCE_PATH_STYLE=true is not allowed in production-like environments',
    );
  }
  for (const key of [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_PROFILE',
    'AWS_SHARED_CREDENTIALS_FILE',
  ]) {
    if (env[key]?.trim()) {
      throw new Error(
        `${key} is not allowed in production-like environments; use an IAM role`,
      );
    }
  }
}

function isProductionLikeEnv(env: RawEnv): boolean {
  if (env.NODE_ENV === 'production') {
    return true;
  }
  if (
    env.AWS_EXECUTION_ENV ||
    env.ECS_CONTAINER_METADATA_URI ||
    env.ECS_CONTAINER_METADATA_URI_V4
  ) {
    return true;
  }

  const deploymentEnv = (
    env.GATELM_DEPLOYMENT_ENV ??
    env.CONTROL_PLANE_DEPLOYMENT_ENV ??
    env.DEPLOYMENT_ENV ??
    env.DEPLOYMENT_MODE ??
    env.APP_ENV ??
    ''
  )
    .trim()
    .toLowerCase();

  return [
    'aws',
    'aws-triage',
    'aws_triage',
    'prod',
    'production',
    'release',
    'selfhost',
    'self_host',
    'staging',
    'stage',
  ].includes(deploymentEnv);
}

function isExplicitLocalOrTestEnv(env: RawEnv): boolean {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'development' || nodeEnv === 'test') return true;

  const deploymentEnv = (
    env.GATELM_DEPLOYMENT_ENV ??
    env.CONTROL_PLANE_DEPLOYMENT_ENV ??
    env.DEPLOYMENT_ENV ??
    env.DEPLOYMENT_MODE ??
    env.APP_ENV ??
    ''
  )
    .trim()
    .toLowerCase();
  return deploymentEnv === 'local' || deploymentEnv === 'test';
}

function isWeakInternalServiceToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return (
    value.trim().length < 32 ||
    normalized.includes('changeme') ||
    normalized.includes('demo') ||
    normalized.includes('dev-only') ||
    normalized.includes('example') ||
    normalized.includes('placeholder') ||
    normalized.includes('replace-me')
  );
}

type RawEnv = Record<string, string | undefined>;

interface ControlPlaneEnv {
  AUTH_EMAIL_TRANSPORT?: string;
  CONTROL_PLANE_INTERNAL_SERVICE_TOKEN?: string;
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN?: string;
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
}

type ValidatedControlPlaneEnv = Record<string, string | number | undefined> &
  ControlPlaneEnv;

const DEFAULT_CONTROL_PLANE_PORT = 3001;
const DEFAULT_ADMIN_AUTH_MODE = 'session_cookie';
const DEFAULT_CONTROL_PLANE_WEB_ORIGIN = 'http://localhost:3000';
const DEFAULT_AUTH_EMAIL_TRANSPORT = 'dev_memory';
const DEMO_ADMIN_AUTH_MODE = 'demo_admin_placeholder';

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
  if (isProductionLikeEnv(config)) {
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
  }

  return {
    ...config,
    AUTH_EMAIL_TRANSPORT: emailTransport,
    CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: internalServiceToken,
    TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN: tenantChatServiceToken,
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
  };
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
    env.APP_ENV ??
    ''
  )
    .trim()
    .toLowerCase();

  return [
    'aws',
    'aws-triage',
    'prod',
    'production',
    'release',
    'selfhost',
    'staging',
    'stage',
  ].includes(deploymentEnv);
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

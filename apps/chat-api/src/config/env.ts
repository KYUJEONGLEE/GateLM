type RawEnv = Record<string, string | undefined>;

export type ChatApiEnv = {
  CHAT_API_PORT: number;
  DATABASE_URL: string;
  TENANT_CHAT_ACCESS_JWT_SECRET: string;
  TENANT_CHAT_CONTROL_PLANE_BASE_URL: string;
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN: string;
  TENANT_CHAT_INTENT_SECRET: string;
  TENANT_CHAT_WEB_SERVICE_TOKEN: string;
};

export function validateEnv(env: RawEnv): ChatApiEnv {
  const port = Number(env.CHAT_API_PORT ?? '3003');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('CHAT_API_PORT must be a valid port.');
  }
  return {
    CHAT_API_PORT: port,
    DATABASE_URL: required(env, 'DATABASE_URL'),
    TENANT_CHAT_ACCESS_JWT_SECRET: strong(env, 'TENANT_CHAT_ACCESS_JWT_SECRET'),
    TENANT_CHAT_CONTROL_PLANE_BASE_URL: httpOrigin(
      env,
      'TENANT_CHAT_CONTROL_PLANE_BASE_URL',
    ),
    TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN: strong(
      env,
      'TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN',
    ),
    TENANT_CHAT_INTENT_SECRET: strong(env, 'TENANT_CHAT_INTENT_SECRET'),
    TENANT_CHAT_WEB_SERVICE_TOKEN: strong(env, 'TENANT_CHAT_WEB_SERVICE_TOKEN'),
  };
}

function required(env: RawEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function strong(env: RawEnv, key: string): string {
  const value = required(env, key);
  if (value.length < 32 || /replace-me|placeholder/i.test(value)) {
    throw new Error(`${key} must be a non-placeholder value of at least 32 characters.`);
  }
  return value;
}

function httpOrigin(env: RawEnv, key: string): string {
  const value = required(env, key);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${key} must be an http(s) URL without credentials.`);
  }
  return url.toString().replace(/\/$/, '');
}

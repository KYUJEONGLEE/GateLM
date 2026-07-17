import { validateRagRuntimeConfig, type RagRuntimeConfig } from '@gatelm/rag-config';

type RawEnv = Record<string, string | undefined>;

export type ChatApiEnv = RagRuntimeConfig & {
  CHAT_API_PORT: number;
  DATABASE_URL: string;
  TENANT_CHAT_ACCESS_JWT_SECRET: string;
  TENANT_CHAT_CONTROL_PLANE_BASE_URL: string;
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN: string;
  TENANT_CHAT_INTENT_SECRET: string;
  TENANT_CHAT_WEB_SERVICE_TOKEN: string;
  TENANT_CHAT_GATEWAY_BASE_URL?: string;
  RAG_QUERY_EMBEDDING_ACTIVE_KID?: string;
  RAG_QUERY_EMBEDDING_SIGNING_JWK_FILE?: string;
  RAG_QUERY_EMBEDDING_BINDING_HMAC_KEYS_FILE?: string;
  RAG_QUERY_EMBEDDING_TIMEOUT_MS: number;
  RAG_TOP_K: number;
  RAG_MIN_SCORE: number;
  RAG_CONTEXT_MAX_TOKENS: number;
  RAG_PROMPT_VERSION: 1;
  RAG_RETRIEVAL_QUERY_MAX_UTF8_BYTES: number;
  TENANT_CHAT_WORKLOAD_ACTIVE_KID?: string;
  TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE?: string;
  TENANT_CHAT_BINDING_HMAC_KEYS_FILE?: string;
  TENANT_CHAT_CONTENT_KEYS_FILE?: string;
  TENANT_CHAT_CONTROL_PLANE_TIMEOUT_MS: number;
  TENANT_CHAT_GATEWAY_ADMISSION_TIMEOUT_MS: number;
  TENANT_CHAT_GATEWAY_CANCEL_TIMEOUT_MS: number;
  TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS: number;
  TENANT_CHAT_GATEWAY_JSON_MAX_BYTES: number;
  TENANT_CHAT_GATEWAY_REQUEST_MAX_BYTES: number;
  TENANT_CHAT_GATEWAY_SSE_FRAME_MAX_BYTES: number;
  TENANT_CHAT_GATEWAY_STREAM_MAX_BYTES: number;
  TENANT_CHAT_HISTORY_RETENTION_DAYS: 0 | 7 | 30 | 90;
  TENANT_CHAT_RETENTION_BATCH_SIZE: number;
  TENANT_CHAT_RETENTION_INTERVAL_MS: number;
  TENANT_CHAT_ASSISTANT_MAX_BYTES: number;
  TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN: number;
};

export function validateEnv(env: RawEnv): ChatApiEnv {
  const port = Number(env.CHAT_API_PORT ?? '3003');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('CHAT_API_PORT must be a valid port.');
  }
  const validated: ChatApiEnv = {
    ...validateRagRuntimeConfig(env),
    CHAT_API_PORT: port,
    DATABASE_URL: boundedDatabaseUrl(env),
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
    TENANT_CHAT_GATEWAY_BASE_URL: optionalHttpOrigin(env, 'TENANT_CHAT_GATEWAY_BASE_URL'),
    RAG_QUERY_EMBEDDING_ACTIVE_KID: optional(env, 'RAG_QUERY_EMBEDDING_ACTIVE_KID'),
    RAG_QUERY_EMBEDDING_SIGNING_JWK_FILE: optional(env, 'RAG_QUERY_EMBEDDING_SIGNING_JWK_FILE'),
    RAG_QUERY_EMBEDDING_BINDING_HMAC_KEYS_FILE: optional(
      env,
      'RAG_QUERY_EMBEDDING_BINDING_HMAC_KEYS_FILE',
    ),
    RAG_QUERY_EMBEDDING_TIMEOUT_MS: boundedInteger(
      env,
      'RAG_QUERY_EMBEDDING_TIMEOUT_MS',
      10_000,
      100,
      120_000,
    ),
    RAG_TOP_K: boundedInteger(
      env,
      'RAG_TOP_K',
      6,
      1,
      12,
    ),
    RAG_MIN_SCORE: boundedDecimal(
      env,
      'RAG_MIN_SCORE',
      0.3,
      0,
      1,
    ),
    RAG_CONTEXT_MAX_TOKENS: boundedInteger(
      env,
      'RAG_CONTEXT_MAX_TOKENS',
      6_000,
      1,
      6_000,
    ),
    RAG_PROMPT_VERSION: fixedInteger(env, 'RAG_PROMPT_VERSION', 1),
    RAG_RETRIEVAL_QUERY_MAX_UTF8_BYTES: boundedInteger(
      env,
      'RAG_RETRIEVAL_QUERY_MAX_UTF8_BYTES',
      8192,
      1,
      8192,
    ),
    TENANT_CHAT_WORKLOAD_ACTIVE_KID: optional(env, 'TENANT_CHAT_WORKLOAD_ACTIVE_KID'),
    TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE: optional(env, 'TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE'),
    TENANT_CHAT_BINDING_HMAC_KEYS_FILE: optional(env, 'TENANT_CHAT_BINDING_HMAC_KEYS_FILE'),
    TENANT_CHAT_CONTENT_KEYS_FILE: optional(env, 'TENANT_CHAT_CONTENT_KEYS_FILE'),
    TENANT_CHAT_CONTROL_PLANE_TIMEOUT_MS: boundedInteger(
      env,
      'TENANT_CHAT_CONTROL_PLANE_TIMEOUT_MS',
      1500,
      100,
      10_000,
    ),
    TENANT_CHAT_GATEWAY_ADMISSION_TIMEOUT_MS: boundedInteger(
      env,
      'TENANT_CHAT_GATEWAY_ADMISSION_TIMEOUT_MS',
      2000,
      100,
      10_000,
    ),
    TENANT_CHAT_GATEWAY_CANCEL_TIMEOUT_MS: boundedInteger(
      env,
      'TENANT_CHAT_GATEWAY_CANCEL_TIMEOUT_MS',
      2000,
      100,
      10_000,
    ),
    TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS: boundedInteger(
      env,
      'TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS',
      130_000,
      1000,
      300_000,
    ),
    TENANT_CHAT_GATEWAY_JSON_MAX_BYTES: boundedInteger(
      env,
      'TENANT_CHAT_GATEWAY_JSON_MAX_BYTES',
      64 * 1024,
      1024,
      1024 * 1024,
    ),
    TENANT_CHAT_GATEWAY_REQUEST_MAX_BYTES: boundedInteger(
      env,
      'TENANT_CHAT_GATEWAY_REQUEST_MAX_BYTES',
      4 * 1024 * 1024,
      64 * 1024,
      8 * 1024 * 1024,
    ),
    TENANT_CHAT_GATEWAY_SSE_FRAME_MAX_BYTES: boundedInteger(
      env,
      'TENANT_CHAT_GATEWAY_SSE_FRAME_MAX_BYTES',
      64 * 1024,
      1024,
      256 * 1024,
    ),
    TENANT_CHAT_GATEWAY_STREAM_MAX_BYTES: boundedInteger(
      env,
      'TENANT_CHAT_GATEWAY_STREAM_MAX_BYTES',
      8 * 1024 * 1024,
      64 * 1024,
      16 * 1024 * 1024,
    ),
    TENANT_CHAT_HISTORY_RETENTION_DAYS: retentionDays(env),
    TENANT_CHAT_RETENTION_BATCH_SIZE: boundedInteger(
      env,
      'TENANT_CHAT_RETENTION_BATCH_SIZE',
      50,
      1,
      500,
    ),
    TENANT_CHAT_RETENTION_INTERVAL_MS: boundedInteger(
      env,
      'TENANT_CHAT_RETENTION_INTERVAL_MS',
      60_000,
      1_000,
      3_600_000,
    ),
    TENANT_CHAT_ASSISTANT_MAX_BYTES: boundedInteger(
      env,
      'TENANT_CHAT_ASSISTANT_MAX_BYTES',
      1024 * 1024,
      1024,
      1024 * 1024,
    ),
    TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN: boundedInteger(
      env,
      'TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN',
      4,
      1,
      16,
    ),
  };
  assertRagQueryConfiguration(validated);
  return validated;
}

function retentionDays(env: RawEnv): 0 | 7 | 30 | 90 {
  const value = Number(env.TENANT_CHAT_HISTORY_RETENTION_DAYS ?? '30');
  if (![0, 7, 30, 90].includes(value)) {
    throw new Error('TENANT_CHAT_HISTORY_RETENTION_DAYS must be one of 0, 7, 30, or 90.');
  }
  return value as 0 | 7 | 30 | 90;
}

function boundedDatabaseUrl(env: RawEnv): string {
  const url = new URL(required(env, 'DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  }
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '12');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '5');
  return url.toString();
}

function required(env: RawEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(env: RawEnv, key: string): string | undefined {
  return env[key]?.trim() || undefined;
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

function optionalHttpOrigin(env: RawEnv, key: string): string | undefined {
  return optional(env, key) ? httpOrigin(env, key) : undefined;
}

function boundedInteger(
  env: RawEnv,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(env[key] ?? defaultValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedDecimal(
  env: RawEnv,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(env[key] ?? defaultValue);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function fixedInteger(env: RawEnv, key: string, expected: 1): 1 {
  const value = Number(env[key] ?? expected);
  if (value !== expected) throw new Error(`${key} must be ${expected}.`);
  return expected;
}

function assertRagQueryConfiguration(env: ChatApiEnv): void {
  if (env.TENANT_CHAT_RAG_ENABLED !== 'true') return;
  if (!env.TENANT_CHAT_GATEWAY_BASE_URL) {
    throw new Error('TENANT_CHAT_GATEWAY_BASE_URL is required when Tenant Chat RAG is enabled.');
  }
  for (const key of [
    'RAG_QUERY_EMBEDDING_ACTIVE_KID',
    'RAG_QUERY_EMBEDDING_SIGNING_JWK_FILE',
    'RAG_QUERY_EMBEDDING_BINDING_HMAC_KEYS_FILE',
  ] as const) {
    if (!env[key]) throw new Error(`${key} is required when Tenant Chat RAG is enabled.`);
  }
}

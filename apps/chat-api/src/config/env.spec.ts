import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://db.example.test/gatelm?schema=public',
  TENANT_CHAT_ACCESS_JWT_SECRET: 'test-only-access-secret-with-safe-length',
  TENANT_CHAT_CONTROL_PLANE_BASE_URL: 'https://control.example.test',
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN: 'test-only-control-service-token-safe-length',
  TENANT_CHAT_INTENT_SECRET: 'test-only-intent-secret-with-safe-length',
  TENANT_CHAT_WEB_SERVICE_TOKEN: 'test-only-web-service-token-with-safe-length',
};

describe('Chat API environment', () => {
  it('adds bounded PostgreSQL pool defaults', () => {
    const validated = validateEnv(base);
    const url = new URL(validated.DATABASE_URL);
    expect(url.searchParams.get('connection_limit')).toBe('12');
    expect(url.searchParams.get('pool_timeout')).toBe('5');
    expect(validated.TENANT_CHAT_RAG_ENABLED).toBe('false');
    expect(validated.RAG_EMBEDDING_PROVIDER).toBe('openai');
    expect(validated.RAG_EMBEDDING_MODEL).toBe('text-embedding-3-large');
    expect(validated.RAG_EMBEDDING_DIMENSIONS).toBe(1536);
    expect(validated.RAG_EMBEDDING_PROFILE_VERSION).toBe(1);
    expect(validated.RAG_DISTANCE_METRIC).toBe('cosine');
  });

  it('preserves an explicitly smaller pool limit', () => {
    const url = new URL(validateEnv({ ...base, DATABASE_URL: `${base.DATABASE_URL}&connection_limit=4` }).DATABASE_URL);
    expect(url.searchParams.get('connection_limit')).toBe('4');
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'https://db.example.test/gatelm' })).toThrow('PostgreSQL');
  });

  it('keeps execution configuration optional for liveness but bounds transport settings', () => {
    const value = validateEnv(base);
    expect(value.TENANT_CHAT_GATEWAY_BASE_URL).toBeUndefined();
    expect(value.TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS).toBe(130_000);
    expect(() => validateEnv({ ...base, TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS: '300001' }))
      .toThrow('TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS');
  });

  it('accepts only server-owned retention choices and bounds assistant persistence', () => {
    expect(validateEnv(base).TENANT_CHAT_HISTORY_RETENTION_DAYS).toBe(30);
    expect(validateEnv({ ...base, TENANT_CHAT_HISTORY_RETENTION_DAYS: '0' }).TENANT_CHAT_HISTORY_RETENTION_DAYS).toBe(0);
    expect(() => validateEnv({ ...base, TENANT_CHAT_HISTORY_RETENTION_DAYS: '31' }))
      .toThrow('TENANT_CHAT_HISTORY_RETENTION_DAYS');
    expect(() => validateEnv({ ...base, TENANT_CHAT_ASSISTANT_MAX_BYTES: '1048577' }))
      .toThrow('TENANT_CHAT_ASSISTANT_MAX_BYTES');
    expect(validateEnv(base).TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN).toBe(4);
    expect(() => validateEnv({ ...base, TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN: '17' }))
      .toThrow('TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN');
  });

  it('rejects explicitly empty numeric settings instead of using defaults', () => {
    expect(() => validateEnv({ ...base, CHAT_API_PORT: '' }))
      .toThrow('CHAT_API_PORT');
    expect(() => validateEnv({ ...base, TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS: '' }))
      .toThrow('TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS');
  });

  it.each([
    ['TENANT_CHAT_RAG_ENABLED', 'enabled'],
    ['RAG_EMBEDDING_PROVIDER', 'unsupported'],
    ['RAG_EMBEDDING_MODEL', 'text-embedding-3-small'],
    ['RAG_EMBEDDING_DIMENSIONS', '3072'],
    ['RAG_EMBEDDING_PROFILE_VERSION', '2'],
    ['RAG_DISTANCE_METRIC', 'euclidean'],
  ])('rejects invalid fixed RAG setting %s', (key, value) => {
    expect(() => validateEnv({ ...base, [key]: value })).toThrow(key);
  });
});

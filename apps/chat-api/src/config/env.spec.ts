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
    const url = new URL(validateEnv(base).DATABASE_URL);
    expect(url.searchParams.get('connection_limit')).toBe('12');
    expect(url.searchParams.get('pool_timeout')).toBe('5');
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
});

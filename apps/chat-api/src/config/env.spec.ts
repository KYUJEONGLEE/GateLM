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
});

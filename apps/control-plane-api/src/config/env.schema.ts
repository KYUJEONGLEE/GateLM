type RawEnv = Record<string, string | undefined>;

interface ControlPlaneEnv {
  CONTROL_PLANE_PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  CONTROL_PLANE_ADMIN_AUTH_MODE: string;
}

type ValidatedControlPlaneEnv = Record<string, string | number | undefined> &
  ControlPlaneEnv;

const DEFAULT_CONTROL_PLANE_PORT = 3001;
const DEFAULT_ADMIN_AUTH_MODE = 'demo_admin_placeholder';

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

export function validateEnv(config: RawEnv): ValidatedControlPlaneEnv {
  return {
    ...config,
    CONTROL_PLANE_PORT: readPort(config),
    DATABASE_URL: requireString(config, 'DATABASE_URL'),
    REDIS_URL: requireString(config, 'REDIS_URL'),
    CONTROL_PLANE_ADMIN_AUTH_MODE:
      config.CONTROL_PLANE_ADMIN_AUTH_MODE ?? DEFAULT_ADMIN_AUTH_MODE,
  };
}

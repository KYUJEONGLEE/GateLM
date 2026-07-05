import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const PASSWORD_KEY_LENGTH = 64;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await deriveScrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: SCRYPT_N,
    p: SCRYPT_P,
    r: SCRYPT_R,
  });

  return `scrypt:v1:N=${SCRYPT_N}:r=${SCRYPT_R}:p=${SCRYPT_P}:${salt}:${derived.toString(
    'base64url',
  )}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
    return false;
  }

  const n = Number(parts[2]?.replace('N=', ''));
  const r = Number(parts[3]?.replace('r=', ''));
  const p = Number(parts[4]?.replace('p=', ''));
  const salt = parts[5];
  const expectedHash = parts[6];

  if (!salt || !expectedHash || !Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const expected = Buffer.from(expectedHash, 'base64url');
  const actual = await deriveScrypt(password, salt, expected.length, {
    N: n,
    p,
    r,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function deriveScrypt(
  password: string,
  salt: string,
  keyLength: number,
  options: { N: number; p: number; r: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const CREDENTIAL_HASH_ALGORITHM = 'scrypt-v1';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export interface GeneratedCredentialSecret {
  plaintext: string;
  prefix: string;
  last4: string;
  secretHash: string;
  hashAlgorithm: typeof CREDENTIAL_HASH_ALGORITHM;
}

export function hashCredentialSecret(plaintext: string): string {
  const normalized = normalizeCredentialSecret(plaintext);
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const derivedKey = deriveCredentialKey(normalized, salt);

  return [
    CREDENTIAL_HASH_ALGORITHM,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export function verifyCredentialSecret(
  plaintext: string,
  encodedHash: string,
): boolean {
  const parts = encodedHash.split('$');
  if (
    parts.length !== 6 ||
    parts[0] !== CREDENTIAL_HASH_ALGORITHM ||
    parts[1] !== String(SCRYPT_N) ||
    parts[2] !== String(SCRYPT_R) ||
    parts[3] !== String(SCRYPT_P)
  ) {
    return false;
  }

  try {
    const encodedSalt = parts[4];
    const encodedExpected = parts[5];
    if (encodedSalt === undefined || encodedExpected === undefined) {
      return false;
    }
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expected = Buffer.from(encodedExpected, 'base64url');
    if (salt.length !== SCRYPT_SALT_LENGTH || expected.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const actual = deriveCredentialKey(normalizeCredentialSecret(plaintext), salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function normalizeCredentialSecret(plaintext: string): string {
  return plaintext.trim();
}

function deriveCredentialKey(plaintext: string, salt: Buffer): Buffer {
  return scryptSync(plaintext, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
}

export function generateCredentialSecret(
  prefix: string,
): GeneratedCredentialSecret {
  const body = randomBytes(24).toString('base64url');
  const plaintext = `${prefix}${body}`;

  return {
    plaintext,
    prefix,
    last4: plaintext.slice(-4),
    secretHash: hashCredentialSecret(plaintext),
    hashAlgorithm: CREDENTIAL_HASH_ALGORITHM,
  };
}

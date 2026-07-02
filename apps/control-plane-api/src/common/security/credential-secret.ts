import { createHash, randomBytes } from 'node:crypto';

export const CREDENTIAL_HASH_ALGORITHM = 'sha256';

export interface GeneratedCredentialSecret {
  plaintext: string;
  prefix: string;
  last4: string;
  secretHash: string;
  hashAlgorithm: typeof CREDENTIAL_HASH_ALGORITHM;
}

export function hashCredentialSecret(plaintext: string): string {
  return createHash(CREDENTIAL_HASH_ALGORITHM)
    .update(plaintext.trim(), 'utf8')
    .digest('hex');
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

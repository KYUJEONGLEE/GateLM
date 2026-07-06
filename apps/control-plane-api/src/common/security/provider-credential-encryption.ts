import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const DEFAULT_KEY_VERSION = 'v1';

export type EncryptedProviderCredential = {
  encryptedValue: string;
  encryptionNonce: string;
  encryptionTag: string;
  encryptionKeyVersion: string;
};

export type ProviderCredentialCiphertext = EncryptedProviderCredential & {
  credentialRefId: string;
};

export function encryptProviderCredential(
  credentialValue: string,
  credentialRefId: string,
): EncryptedProviderCredential {
  const key = providerCredentialEncryptionKeyFromEnv();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(credentialRefId, 'utf8'));

  const encrypted = Buffer.concat([
    cipher.update(credentialValue, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('base64'),
    encryptionNonce: nonce.toString('base64'),
    encryptionTag: tag.toString('base64'),
    encryptionKeyVersion: providerCredentialEncryptionKeyVersionFromEnv(),
  };
}

export function decryptProviderCredential(
  ciphertext: ProviderCredentialCiphertext,
): string {
  const key = providerCredentialEncryptionKeyFromEnv();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ciphertext.encryptionNonce, 'base64'),
  );
  decipher.setAAD(Buffer.from(ciphertext.credentialRefId, 'utf8'));
  decipher.setAuthTag(Buffer.from(ciphertext.encryptionTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext.encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function providerCredentialEncryptionKeyVersionFromEnv(): string {
  return (
    process.env.GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION?.trim() ||
    process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION?.trim() ||
    DEFAULT_KEY_VERSION
  );
}

function providerCredentialEncryptionKeyFromEnv(): Buffer {
  const raw =
    process.env.GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY?.trim() ||
    process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY?.trim() ||
    '';

  if (!raw) {
    throw new Error('Provider credential encryption key is not configured.');
  }

  const key = parseProviderCredentialEncryptionKey(raw);
  if (key.length !== KEY_BYTES) {
    throw new Error('Provider credential encryption key must be 32 bytes.');
  }
  return key;
}

function parseProviderCredentialEncryptionKey(raw: string): Buffer {
  const prefixedBase64 = raw.match(/^base64:(.+)$/i);
  if (prefixedBase64?.[1]) {
    return Buffer.from(prefixedBase64[1], 'base64');
  }

  const prefixedHex = raw.match(/^hex:([0-9a-f]+)$/i);
  if (prefixedHex?.[1]) {
    return Buffer.from(prefixedHex[1], 'hex');
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const base64 = Buffer.from(raw, 'base64');
  if (base64.length === KEY_BYTES && base64RoundTrips(raw, base64)) {
    return base64;
  }

  return Buffer.from(raw, 'utf8');
}

function base64RoundTrips(raw: string, decoded: Buffer): boolean {
  const normalized = raw.replace(/=+$/, '');
  const reencoded = decoded.toString('base64').replace(/=+$/, '');

  if (normalized.length !== reencoded.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(normalized), Buffer.from(reencoded));
}

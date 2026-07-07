import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export interface SignupDraftVerification {
  codeHash: string;
  expiresAt: string;
  failedAttemptCount: number;
}

export interface SignupDraft {
  email: string;
  emailVerifiedAt: string | null;
  expiresAt: string;
  name: string | null;
  passwordHash: string;
  verification?: SignupDraftVerification;
}

export class SignupDraftTokenCodec {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(secret).digest();
  }

  seal(draft: SignupDraft): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(draft), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  open(token: string | undefined): SignupDraft | null {
    if (!token) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      return null;
    }

    try {
      const [, rawIv, rawCiphertext, rawTag] = parts;
      if (!rawIv || !rawCiphertext || !rawTag) {
        return null;
      }

      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(rawIv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(rawTag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(rawCiphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      const value = JSON.parse(plaintext) as unknown;

      return isSignupDraft(value) ? value : null;
    } catch {
      return null;
    }
  }
}

function isSignupDraft(value: unknown): value is SignupDraft {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const draft = value as Partial<SignupDraft>;
  return (
    typeof draft.email === 'string' &&
    (typeof draft.name === 'string' || draft.name === null) &&
    typeof draft.passwordHash === 'string' &&
    (typeof draft.emailVerifiedAt === 'string' ||
      draft.emailVerifiedAt === null) &&
    typeof draft.expiresAt === 'string' &&
    (draft.verification === undefined ||
      (typeof draft.verification.codeHash === 'string' &&
        typeof draft.verification.expiresAt === 'string' &&
        typeof draft.verification.failedAttemptCount === 'number'))
  );
}

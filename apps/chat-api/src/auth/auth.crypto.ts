import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type AccessClaims = {
  actorAuthzVersion: number;
  actorKind?: 'tenant_admin' | 'employee';
  aud: 'gatelm-chat-web';
  deviceIdHash: string;
  employeeId?: string;
  exp: number;
  iat: number;
  iss: 'gatelm-chat-api';
  jti: string;
  nbf: number;
  sessionVersion: number;
  sid: string;
  sub: string;
  tenantAuthzVersion?: number;
  tenantId?: string;
};

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashValue(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function sealIntent(value: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function openIntent(value: string, secret: string): string | null {
  try {
    const [ivText, tagText, encryptedText] = value.split('.');
    if (!ivText || !tagText || !encryptedText) return null;
    const key = createHash('sha256').update(secret).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signAccessJwt(claims: AccessClaims, secret: string): string {
  const header = encodeJson({ alg: 'HS256', typ: 'gatelm-chat-access+jwt' });
  const payload = encodeJson(claims);
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessJwt(token: string, secret: string): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length > 4096)) return null;
  const [headerText, payloadText, signature] = parts;
  if (!headerText || !payloadText || !signature) return null;
  const expected = createHmac('sha256', secret)
    .update(`${headerText}.${payloadText}`)
    .digest('base64url');
  if (!safeEqual(expected, signature)) return null;
  try {
    const header = JSON.parse(Buffer.from(headerText, 'base64url').toString('utf8')) as Record<string, unknown>;
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8')) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (
      header.alg !== 'HS256' ||
      header.typ !== 'gatelm-chat-access+jwt' ||
      payload.iss !== 'gatelm-chat-api' ||
      payload.aud !== 'gatelm-chat-web' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.deviceIdHash !== 'string' ||
      typeof payload.sessionVersion !== 'number' ||
      typeof payload.actorAuthzVersion !== 'number' ||
      typeof payload.iat !== 'number' ||
      typeof payload.nbf !== 'number' ||
      typeof payload.exp !== 'number' ||
      typeof payload.jti !== 'string' ||
      payload.nbf > now + 5 ||
      payload.exp <= now - 5
    ) {
      return null;
    }
    return payload as AccessClaims;
  } catch {
    return null;
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

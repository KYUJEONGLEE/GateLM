import { openIntent, sealIntent, signAccessJwt, verifyAccessJwt, type AccessClaims } from './auth.crypto';

const secret = 'test-only-access-secret-that-is-long-enough';

function claims(overrides: Partial<AccessClaims> = {}): AccessClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    actorAuthzVersion: 3,
    aud: 'gatelm-chat-web',
    deviceIdHash: 'sha256:device',
    exp: now + 300,
    iat: now,
    iss: 'gatelm-chat-api',
    jti: '00000000-0000-4000-8000-000000000001',
    nbf: now - 1,
    sessionVersion: 2,
    sid: '00000000-0000-4000-8000-000000000002',
    sub: '00000000-0000-4000-8000-000000000003',
    ...overrides,
  };
}

describe('Tenant Chat auth crypto', () => {
  it('round-trips a fixed-algorithm access token and rejects tampering', () => {
    const token = signAccessJwt(claims(), secret);
    expect(verifyAccessJwt(token, secret)?.sessionVersion).toBe(2);
    expect(verifyAccessJwt(`${token.slice(0, -1)}x`, secret)).toBeNull();
    expect(verifyAccessJwt(token, `${secret}-other`)).toBeNull();
  });

  it('rejects expired access tokens', () => {
    expect(verifyAccessJwt(signAccessJwt(claims({ exp: 1 }), secret), secret)).toBeNull();
  });

  it('authenticates invitation intent ciphertext and fails closed for a different key', () => {
    const sealed = sealIntent('{"purpose":"invitation"}', secret);
    const parts = sealed.split('.');
    parts[2] = `${parts[2]![0] === 'a' ? 'b' : 'a'}${parts[2]!.slice(1)}`;
    expect(openIntent(sealed, secret)).toBe('{"purpose":"invitation"}');
    expect(openIntent(sealed, `${secret}-other`)).toBeNull();
    expect(openIntent(parts.join('.'), secret)).toBeNull();
  });
});

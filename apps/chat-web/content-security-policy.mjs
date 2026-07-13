export function createContentSecurityPolicy(environment, nonce) {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9+/_-]+={0,2}$/u.test(nonce)) {
    throw new TypeError('CSP nonce must be a non-empty base64 value');
  }

  const development = environment === 'development';
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
  ].join(' ');
  const styleSrc = development
    ? "style-src 'self' 'unsafe-inline'"
    : `style-src 'self' 'nonce-${nonce}'`;

  return [
    "default-src 'self'",
    scriptSrc,
    styleSrc,
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

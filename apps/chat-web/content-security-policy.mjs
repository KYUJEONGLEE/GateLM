const DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

export function createContentSecurityPolicy(environment = process.env.NODE_ENV) {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (environment === 'development') scriptSources.push("'unsafe-eval'");

  return [
    DIRECTIVES[0],
    `script-src ${scriptSources.join(' ')}`,
    ...DIRECTIVES.slice(1),
  ].join('; ');
}

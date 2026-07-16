import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createContentSecurityPolicy } from './content-security-policy.mjs';

const nonce = 'dGVzdC1ub25jZQ==';
const productionPolicy = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;

test('development CSP permits React Refresh eval without relaxing other directives', () => {
  const developmentPolicy = createContentSecurityPolicy('development', nonce);

  assert.equal(
    developmentPolicy,
    productionPolicy.replace(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'`,
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'`,
    ),
  );
});

test('production CSP rejects unsafe inline scripts and styles', () => {
  const policy = createContentSecurityPolicy('production', nonce);

  assert.equal(policy, productionPolicy);
  assert.doesNotMatch(policy, /(?:^|\s)'unsafe-(?:eval|inline)'(?:\s|;|$)/u);
});

test('non-development environments use the production-safe CSP', () => {
  assert.equal(createContentSecurityPolicy('test', nonce), productionPolicy);
  assert.equal(createContentSecurityPolicy(undefined, nonce), productionPolicy);
});

test('CSP requires a base64 nonce', () => {
  assert.throws(() => createContentSecurityPolicy('production'), /nonce/u);
  assert.throws(() => createContentSecurityPolicy('production', ''), /nonce/u);
  assert.throws(() => createContentSecurityPolicy('production', "bad'nonce"), /nonce/u);
});

test('security headers preserve same-origin mutations without leaking cross-origin referrers', () => {
  const nextConfig = readFileSync(new URL('./next.config.ts', import.meta.url), 'utf8');

  assert.match(nextConfig, /Referrer-Policy', value: 'same-origin'/u);
  assert.doesNotMatch(nextConfig, /Referrer-Policy', value: 'no-referrer'/u);
});

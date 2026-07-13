import assert from 'node:assert/strict';
import test from 'node:test';

import { createContentSecurityPolicy } from './content-security-policy.mjs';

const productionPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

test('development CSP permits React Refresh eval without relaxing other directives', () => {
  const developmentPolicy = createContentSecurityPolicy('development');

  assert.equal(
    developmentPolicy,
    productionPolicy.replace(
      "script-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    ),
  );
});

test('production CSP never permits unsafe-eval', () => {
  const policy = createContentSecurityPolicy('production');

  assert.equal(policy, productionPolicy);
  assert.doesNotMatch(policy, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/u);
});

test('unknown environments use the production-safe CSP', () => {
  assert.equal(createContentSecurityPolicy('test'), productionPolicy);
  assert.equal(createContentSecurityPolicy(undefined), productionPolicy);
});

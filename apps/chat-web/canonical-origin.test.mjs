import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalLocalBrowserUrl } from './src/lib/canonical-origin.mjs';

test('redirects the localhost browser alias to the configured chat.localhost origin', () => {
  assert.equal(
    canonicalLocalBrowserUrl(
      'http://localhost:3002/login?passwordReset=1',
      'http://chat.localhost:3002',
    ),
    'http://chat.localhost:3002/login?passwordReset=1',
  );
});

test('redirects numeric loopback aliases without changing the requested path or query', () => {
  assert.equal(
    canonicalLocalBrowserUrl(
      'http://127.0.0.1:3002/invitations/accept?token=test-token',
      'http://chat.localhost:3002',
    ),
    'http://chat.localhost:3002/invitations/accept?token=test-token',
  );
});

test('does not redirect the canonical host or unrelated production origins', () => {
  assert.equal(
    canonicalLocalBrowserUrl(
      'http://chat.localhost:3002/login',
      'http://chat.localhost:3002',
    ),
    null,
  );
  assert.equal(
    canonicalLocalBrowserUrl(
      'https://localhost/login',
      'https://chat.example.com',
    ),
    null,
  );
});

test('does not redirect aliases using a different protocol or port', () => {
  assert.equal(
    canonicalLocalBrowserUrl(
      'http://localhost:3003/login',
      'http://chat.localhost:3002',
    ),
    null,
  );
  assert.equal(
    canonicalLocalBrowserUrl(
      'https://localhost:3002/login',
      'http://chat.localhost:3002',
    ),
    null,
  );
});

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

test('uses the incoming Host header when the Next.js request URL has an internal host', () => {
  assert.equal(
    canonicalLocalBrowserUrl(
      'http://0.0.0.0:3002/login?source=test',
      'http://chat.localhost:3002',
      'localhost:3002',
    ),
    'http://chat.localhost:3002/login?source=test',
  );
});

test('derives the local canonical origin when the Edge runtime environment is unavailable', () => {
  assert.equal(
    canonicalLocalBrowserUrl(
      'http://0.0.0.0:3002/login?source=test',
      undefined,
      'localhost:3002',
    ),
    'http://chat.localhost:3002/login?source=test',
  );
});

test('does not redirect a canonical incoming Host when the request URL uses an internal host', () => {
  assert.equal(
    canonicalLocalBrowserUrl(
      'http://localhost:3002/login',
      undefined,
      'chat.localhost:3002',
    ),
    null,
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

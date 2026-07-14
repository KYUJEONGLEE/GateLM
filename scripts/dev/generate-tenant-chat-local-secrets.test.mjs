import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateTenantChatLocalSecrets } from './generate-tenant-chat-local-secrets.mjs';

test('atomically creates split private/public and Gateway support secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gatelm-secret-helper-'));
  const target = join(root, 'tenant-chat');
  try {
    const result = await generateTenantChatLocalSecrets({ target, kid: 'test-kid' });
    assert.deepEqual(result.files.sort(), [
      'binding-hmac-keys.json', 'cache-keysets.json', 'content-keys.json', 'jwks.json',
      'signing.jwk.json', 'usage-receipt-token',
    ].sort());
    const privateJwk = JSON.parse(await readFile(join(target, 'signing.jwk.json'), 'utf8'));
    const publicJwks = JSON.parse(await readFile(join(target, 'jwks.json'), 'utf8'));
    assert.equal(privateJwk.d.length > 0, true);
    assert.equal('d' in publicJwks.keys[0], false);
    await assert.rejects(
      generateTenantChatLocalSecrets({ target, kid: 'test-kid' }),
      /Refusing to overwrite/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

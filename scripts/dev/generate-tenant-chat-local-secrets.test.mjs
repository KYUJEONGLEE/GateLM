import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
    if (process.platform !== 'win32') {
      assert.equal((await stat(target)).mode & 0o777, 0o700);
    }
    await assert.rejects(
      generateTenantChatLocalSecrets({ target, kid: 'test-kid' }),
      /Refusing to overwrite/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps generated local secrets out of Docker build contexts', async () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const dockerignore = await readFile(join(repositoryRoot, '.dockerignore'), 'utf8');
  assert.match(dockerignore, /^\.secrets\/?$/m);
});

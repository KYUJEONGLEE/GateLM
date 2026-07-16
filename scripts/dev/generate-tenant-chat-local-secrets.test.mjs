import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  generateTenantChatLocalSecrets,
  localSecretsTargetFromGitCommonDirectory,
  resolveTenantChatLocalSecretsTarget,
} from './generate-tenant-chat-local-secrets.mjs';

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

test('resolves one shared secret directory from the Git common directory', async () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const resolved = await resolveTenantChatLocalSecretsTarget({ cwd: repositoryRoot });
  const expected = localSecretsTargetFromGitCommonDirectory(
    resolve(repositoryRoot, await gitCommonDirectory(repositoryRoot)),
  );
  assert.equal(resolved, expected);
  assert.equal(resolved.endsWith(join('.secrets', 'tenant-chat')), true);
});

test('local Compose and wrapper use the resolved shared secret directory', async () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const compose = await readFile(
    join(repositoryRoot, 'scripts/dev/docker-compose.tenant-chat-execution.yml'),
    'utf8',
  );
  const wrapper = await readFile(
    join(repositoryRoot, 'scripts/dev/tenant-chat-local-compose.ps1'),
    'utf8',
  );
  assert.match(compose, /GATELM_TENANT_CHAT_LOCAL_SECRET_DIR/);
  assert.match(wrapper, /--resolve-target/);
  assert.match(wrapper, /GATELM_TENANT_CHAT_LOCAL_SECRET_DIR/);
});

async function gitCommonDirectory(repositoryRoot) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)(
    'git',
    ['-C', repositoryRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', windowsHide: true },
  );
  return stdout.trim();
}

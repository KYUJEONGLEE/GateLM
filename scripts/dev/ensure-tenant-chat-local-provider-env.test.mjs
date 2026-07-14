import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureTenantChatLocalProviderEnv } from './ensure-tenant-chat-local-provider-env.mjs';

test('adds a non-exported 32-byte encryption key and version without changing existing values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gatelm-provider-env-'));
  const envFile = join(directory, '.env');
  try {
    await writeFile(envFile, 'EXISTING_VALUE=keep\nGATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=\n');
    const result = await ensureTenantChatLocalProviderEnv({
      envFile,
      randomBytesImpl: () => Buffer.alloc(32, 7),
    });
    const source = await readFile(envFile, 'utf8');

    assert.deepEqual(result.changed, [
      'GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY',
      'GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION',
    ]);
    assert.match(source, /EXISTING_VALUE=keep/);
    assert.match(source, /GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=0707[0-9a-f]{60}/);
    assert.match(source, /GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION=v1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preserves a valid existing key and rejects an invalid one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gatelm-provider-env-'));
  const envFile = join(directory, '.env');
  try {
    const existingKey = Buffer.alloc(32, 9).toString('hex');
    await writeFile(envFile, `GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=${existingKey}\nGATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION=v2\n`);
    const unchanged = await ensureTenantChatLocalProviderEnv({ envFile });
    assert.equal(unchanged.status, 'unchanged');
    assert.match(await readFile(envFile, 'utf8'), new RegExp(existingKey));

    await writeFile(envFile, 'GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=too-short\n');
    await assert.rejects(
      ensureTenantChatLocalProviderEnv({ envFile }),
      /must encode exactly 32 bytes/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

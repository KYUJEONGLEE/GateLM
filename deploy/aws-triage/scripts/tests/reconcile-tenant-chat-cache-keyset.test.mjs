import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyTenantChatCacheKeySetReconciliation,
  inspectTenantChatCacheKeySet,
  rollbackTenantChatCacheKeySetReconciliation,
} from '../reconcile-tenant-chat-cache-keyset.mjs';

const SOURCE_ID = 'tenant-chat-local-cache-1';
const CANONICAL_ID = 'tenant_chat_cache_keys_v1';
const KEY = Buffer.alloc(32, 7).toString('base64url');

test('plans, applies, validates, and rolls back without deleting the compatible alias', async () => {
  const fixture = await createFixture();
  try {
    const options = {
      activeKeySetIds: [CANONICAL_ID],
      backupRoot: fixture.backupRoot,
      canonicalId: CANONICAL_ID,
      envFile: fixture.envFile,
      keySetsFile: fixture.keySetsFile,
      sourceId: SOURCE_ID,
    };
    const planned = await inspectTenantChatCacheKeySet(options);
    assert.equal(planned.status, 'changes_required');
    assert.equal(planned.envAction, 'add');
    assert.equal(planned.keySetAction, 'add_alias');

    const applied = await applyTenantChatCacheKeySetReconciliation({
      ...options,
      backupId: '20260717T010203Z-a1b2c3d4',
    });
    assert.equal(applied.status, 'aligned');
    assert.equal(applied.backupId, '20260717T010203Z-a1b2c3d4');
    const updatedEnv = await readFile(fixture.envFile, 'utf8');
    assert.match(updatedEnv, /^TENANT_CHAT_CACHE_KEY_SET_ID=tenant_chat_cache_keys_v1$/m);
    const updatedKeySets = JSON.parse(await readFile(fixture.keySetsFile, 'utf8'));
    assert.deepEqual(updatedKeySets.keySets.map((entry) => entry.keySetId), [SOURCE_ID, CANONICAL_ID]);
    assert.equal(updatedKeySets.keySets[0].fingerprintKey, updatedKeySets.keySets[1].fingerprintKey);
    assert.equal(updatedKeySets.keySets[0].encryptionKey, updatedKeySets.keySets[1].encryptionKey);

    const rolledBack = await rollbackTenantChatCacheKeySetReconciliation({
      ...options,
      backupId: applied.backupId,
    });
    assert.equal(rolledBack.status, 'compatibility_preserved');
    assert.match(
      await readFile(fixture.envFile, 'utf8'),
      /^TENANT_CHAT_CACHE_KEY_SET_ID=tenant_chat_cache_keys_v1$/m,
    );
    const restoredKeySets = JSON.parse(await readFile(fixture.keySetsFile, 'utf8'));
    assert.deepEqual(restoredKeySets.keySets.map((entry) => entry.keySetId), [SOURCE_ID, CANONICAL_ID]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('is idempotent when the canonical environment and alias already exist', async () => {
  const fixture = await createFixture({ canonical: true });
  try {
    const result = await applyTenantChatCacheKeySetReconciliation({
      activeKeySetIds: [CANONICAL_ID],
      backupRoot: fixture.backupRoot,
      canonicalId: CANONICAL_ID,
      envFile: fixture.envFile,
      keySetsFile: fixture.keySetsFile,
      sourceId: SOURCE_ID,
    });
    assert.equal(result.changed, false);
    assert.equal(result.backupId, null);
    assert.equal(result.status, 'aligned');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('rejects an active RuntimeSnapshot that neither current nor planned key sets can resolve', async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      inspectTenantChatCacheKeySet({
        activeKeySetIds: ['unrelated-key-set'],
        backupRoot: fixture.backupRoot,
        canonicalId: CANONICAL_ID,
        envFile: fixture.envFile,
        keySetsFile: fixture.keySetsFile,
        sourceId: SOURCE_ID,
      }),
      /Active RuntimeSnapshot references an unavailable cache key-set/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture({ canonical = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gatelm-cache-keyset-reconcile-'));
  const envFile = join(root, '.env');
  const keySetsFile = join(root, 'cache-keysets.json');
  const backupRoot = join(root, 'backups');
  await writeFile(
    envFile,
    canonical ? `SAFE_SETTING=true\nTENANT_CHAT_CACHE_KEY_SET_ID=${CANONICAL_ID}\n` : 'SAFE_SETTING=true\n',
    { mode: 0o600 },
  );
  const keySets = [{ keySetId: SOURCE_ID, fingerprintKey: KEY, encryptionKey: KEY }];
  if (canonical) keySets.push({ ...keySets[0], keySetId: CANONICAL_ID });
  await writeFile(keySetsFile, `${JSON.stringify({ keySets }, null, 2)}\n`, { mode: 0o600 });
  await chmod(envFile, 0o600);
  await chmod(keySetsFile, 0o600);
  return { backupRoot, envFile, keySetsFile, root };
}

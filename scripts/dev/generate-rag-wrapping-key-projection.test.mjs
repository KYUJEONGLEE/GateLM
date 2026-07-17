import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateRagWrappingKeyProjection } from './generate-rag-wrapping-key-projection.mjs';

test('creates a wrapping-only projection without Tenant Chat integrity material', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gatelm-rag-key-projection-'));
  const input = join(root, 'tenant-chat', 'content-keys.json');
  const target = join(root, 'rag', 'content-wrapping-keys.json');
  const wrappingKey = randomBytes(32).toString('base64url');
  try {
    await mkdir(join(root, 'tenant-chat'));
    await writeFile(
      input,
      JSON.stringify({
        schemaVersion: 1,
        activeVersion: 1,
        keys: [
          {
            version: 1,
            wrappingKey,
            integrityKey: randomBytes(32).toString('base64url'),
          },
        ],
      }),
    );

    await generateRagWrappingKeyProjection({ input, target });
    const projected = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(projected, {
      schemaVersion: 1,
      activeVersion: 1,
      keys: [{ version: 1, wrappingKey }],
    });
    assert.equal(JSON.stringify(projected).includes('integrityKey'), false);
    await assert.rejects(
      generateRagWrappingKeyProjection({ input, target }),
      /Refusing to overwrite/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

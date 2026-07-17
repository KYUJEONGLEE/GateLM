import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ContentKeyUnavailable } from './content.errors';
import { RagWrappingKeyProvider } from './wrapping-key-provider';

describe('RagWrappingKeyProvider', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gatelm-rag-content-keys-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('loads the least-privilege active and grace wrapping-key format', async () => {
    const file = join(root, 'keys.json');
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        activeVersion: 2,
        keys: [key(1), key(2)],
      }),
      { flag: 'wx' },
    );
    const provider = new RagWrappingKeyProvider(config(file));

    const loaded = await provider.load();

    expect(loaded.activeVersion).toBe(2);
    expect([...loaded.keys.keys()]).toEqual([1, 2]);
    await expect(provider.isReady()).resolves.toBe(true);
  });

  it.each([
    undefined,
    { schemaVersion: 1, activeVersion: 2, keys: [key(1)] },
    { schemaVersion: 1, activeVersion: 1, keys: [{ ...key(1), extra: true }] },
    {
      schemaVersion: 1,
      activeVersion: 1,
      keys: [{ ...key(1), wrappingKey: 'invalid' }],
    },
    {
      schemaVersion: 1,
      activeVersion: 1,
      keys: [{ ...key(1), integrityKey: randomBytes(32).toString('base64url') }],
    },
    { schemaVersion: 2, activeVersion: 1, keys: [key(1)] },
  ])('fails closed for a missing or invalid key set', async (value) => {
    const file = join(root, 'keys.json');
    if (value !== undefined) {
      await writeFile(file, JSON.stringify(value), { flag: 'wx' });
    }
    const provider = new RagWrappingKeyProvider(config(file));

    await expect(provider.load()).rejects.toBeInstanceOf(ContentKeyUnavailable);
    await expect(provider.isReady()).resolves.toBe(false);
  });
});

function key(version: number) {
  return {
    version,
    wrappingKey: randomBytes(32).toString('base64url'),
  };
}

function config(file: string): ConfigService {
  return {
    get: (name: string) =>
      name === 'RAG_CONTENT_WRAPPING_KEYS_FILE' ? file : undefined,
  } as ConfigService;
}

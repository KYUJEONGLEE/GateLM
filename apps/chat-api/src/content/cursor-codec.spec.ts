import { randomBytes } from 'node:crypto';

import { ContentIntegrityService } from './content-integrity.service';
import { CursorCodec, InvalidCursor } from './cursor-codec';

describe('CursorCodec', () => {
  it('binds actor, scope, boundary, limit and cache epoch', async () => {
    const codec = createCodec(2, new Map([[1, key()], [2, key()]]));
    const payload = {
      schemaVersion: 1,
      scope: 'messages',
      tenantId: 'tenant-a',
      userId: 'user-a',
      conversationId: 'conversation-a',
      afterSequence: 10,
      limit: 50,
      cacheEpoch: 3,
    };
    const encoded = await codec.encode(payload);
    await expect(codec.decode(encoded)).resolves.toEqual(payload);
  });

  it('rejects payload, MAC, key version and shape tamper', async () => {
    const codec = createCodec(1, new Map([[1, key()]]));
    const encoded = await codec.encode({ schemaVersion: 1, scope: 'conversations', limit: 20 });
    const [payload, version, digest] = encoded.split('.');
    const replacement = payload.endsWith('A') ? 'B' : 'A';
    await expect(codec.decode(`${payload.slice(0, -1)}${replacement}.${version}.${digest}`))
      .rejects.toBeInstanceOf(InvalidCursor);
    await expect(codec.decode(`${payload}.2.${digest}`)).rejects.toBeInstanceOf(InvalidCursor);
    await expect(codec.decode(`${payload}.${version}.${digest.slice(0, -1)}A`))
      .rejects.toBeInstanceOf(InvalidCursor);
    await expect(codec.decode('not-a-cursor')).rejects.toBeInstanceOf(InvalidCursor);
  });

  it('keeps grace cursor reads across reader-first rotation', async () => {
    const old = key();
    const next = key();
    const before = createCodec(1, new Map([[1, old]]));
    const cursor = await before.encode({ schemaVersion: 1, scope: 'messages', limit: 10 });
    const after = createCodec(2, new Map([[1, old], [2, next]]));
    await expect(after.decode(cursor)).resolves.toMatchObject({ scope: 'messages' });
  });
});

function key() {
  return Object.freeze({ version: 1, wrappingKey: randomBytes(32), integrityKey: randomBytes(32) });
}

function createCodec(activeVersion: number, values: Map<number, ReturnType<typeof key>>) {
  const keys = new Map(
    [...values.entries()].map(([version, value]) => [version, Object.freeze({ ...value, version })]),
  );
  const provider = { load: async () => Object.freeze({ activeVersion, keys }) };
  return new CursorCodec(new ContentIntegrityService(provider as never));
}

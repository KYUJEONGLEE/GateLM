import type { PrismaService } from '@/database/prisma.service';

import * as contentCrypto from './content-crypto';
import { TenantContentKeyService } from './tenant-content-key.service';
import type { WrappingKeyProvider, WrappingKeySet } from './wrapping-key-provider';

describe('TenantContentKeyService readiness', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails closed when a durable row references an unavailable reader version', async () => {
    const persistedKeys = keySet([1, 2]);
    const service = new TenantContentKeyService(
      prismaReferences([
        wrappedContentKey(persistedKeys, 'tenant', 1, 1),
        wrappedContentKey(persistedKeys, 'tenant', 2, 2),
      ]),
      provider(keySet([2])) as WrappingKeyProvider,
    );

    await expect(service.isReady()).resolves.toBe(false);
  });

  it('accepts active and grace versions required by durable rows', async () => {
    const availableKeys = keySet([1, 2]);
    const service = new TenantContentKeyService(
      prismaReferences([
        wrappedContentKey(availableKeys, 'tenant', 1, 1),
        wrappedContentKey(availableKeys, 'tenant', 2, 2),
      ]),
      provider(availableKeys) as WrappingKeyProvider,
    );

    await expect(service.isReady()).resolves.toBe(true);
  });

  it('fails closed when the configured key material changed under the same version', async () => {
    const persistedKeys = keySet([1, 2]);
    const replacedKeys = keySet([1, 2], 20);
    const service = new TenantContentKeyService(
      prismaReferences([
        wrappedContentKey(persistedKeys, 'tenant', 1, 1),
        wrappedContentKey(persistedKeys, 'tenant', 2, 2),
      ]),
      provider(replacedKeys) as WrappingKeyProvider,
    );

    await expect(service.isReady()).resolves.toBe(false);
  });

  it('zeroes every tenant key unwrapped during readiness', async () => {
    const availableKeys = keySet([1, 2]);
    const unwrappedKeys = [Buffer.alloc(32, 3), Buffer.alloc(32, 4)];
    const unwrapSpy = jest.spyOn(contentCrypto, 'unwrapTenantKey')
      .mockReturnValueOnce(unwrappedKeys[0])
      .mockReturnValueOnce(unwrappedKeys[1]);
    const service = new TenantContentKeyService(
      prismaReferences([
        wrappedContentKey(availableKeys, 'tenant', 1, 1),
        wrappedContentKey(availableKeys, 'tenant', 2, 2),
      ]),
      provider(availableKeys) as WrappingKeyProvider,
    );

    try {
      await expect(service.isReady()).resolves.toBe(true);
      expect(unwrappedKeys.every((key) => key.every((byte) => byte === 0))).toBe(true);
    } finally {
      unwrapSpy.mockRestore();
    }
  });

  it('zeroes an unwrapped tenant key when rewrap persistence fails', async () => {
    const unwrapped = Buffer.alloc(32, 7);
    jest.spyOn(contentCrypto, 'unwrapTenantKey').mockReturnValue(unwrapped);
    const prisma = {
      tenantChatContentKeyState: {
        upsert: jest.fn().mockResolvedValue({
          activeContentKeyVersion: 1,
          wrappingKeyRollbackFloor: 1,
        }),
      },
      tenantChatContentKey: {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: 'tenant',
          contentKeyVersion: 1,
          wrappingKeyVersion: 1,
          wrappedKey: Uint8Array.from([1]),
          wrapNonce: Uint8Array.from([1]),
          wrapTag: Uint8Array.from([1]),
          status: 'active',
        }),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('rewrap failed')),
    } as unknown as PrismaService;
    const service = new TenantContentKeyService(
      prisma,
      provider(keySet([1, 2])) as WrappingKeyProvider,
    );

    await expect(service.withActiveKey('tenant', async () => undefined)).rejects.toThrow('rewrap failed');
    expect(unwrapped.every((value) => value === 0)).toBe(true);
  });
});

function prismaReferences(contentKeys: ReturnType<typeof wrappedContentKey>[]): PrismaService {
  return {
    tenantChatContentKeyState: {
      findFirst: jest.fn().mockResolvedValue({ wrappingKeyRollbackFloor: 2 }),
    },
    tenantChatContentKey: {
      findMany: jest.fn().mockResolvedValue(contentKeys),
    },
    tenantChatConversation: {
      groupBy: jest.fn().mockResolvedValue([{ creationBindingKeyVersion: 1 }]),
    },
    tenantChatTurn: {
      groupBy: jest.fn().mockResolvedValue([{ requestBindingKeyVersion: 2 }]),
    },
  } as unknown as PrismaService;
}

function provider(value: WrappingKeySet): Pick<WrappingKeyProvider, 'load'> {
  return { load: jest.fn().mockResolvedValue(value) };
}

function keySet(versions: number[], offset = 0): WrappingKeySet {
  return Object.freeze({
    activeVersion: Math.max(...versions),
    keys: new Map(versions.map((version) => [version, Object.freeze({
      version,
      wrappingKey: Buffer.alloc(32, version + offset),
      integrityKey: Buffer.alloc(32, version + offset + 8),
    })])),
  });
}

function wrappedContentKey(
  keySetValue: WrappingKeySet,
  tenantId: string,
  contentKeyVersion: number,
  wrappingKeyVersion: number,
) {
  const wrapping = keySetValue.keys.get(wrappingKeyVersion);
  if (!wrapping) throw new Error('test wrapping key is missing');
  const encrypted = contentCrypto.wrapTenantKey(
    Buffer.alloc(32, contentKeyVersion + 32),
    wrapping.wrappingKey,
    tenantId,
    contentKeyVersion,
    wrappingKeyVersion,
  );
  return {
    tenantId,
    contentKeyVersion,
    wrappingKeyVersion,
    wrappedKey: Uint8Array.from(encrypted.wrappedKey),
    wrapNonce: Uint8Array.from(encrypted.wrapNonce),
    wrapTag: Uint8Array.from(encrypted.wrapTag),
  };
}

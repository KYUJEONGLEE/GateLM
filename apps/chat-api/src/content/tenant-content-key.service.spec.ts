import type { PrismaService } from '@/database/prisma.service';

import * as contentCrypto from './content-crypto';
import { TenantContentKeyService } from './tenant-content-key.service';
import type { WrappingKeyProvider, WrappingKeySet } from './wrapping-key-provider';

describe('TenantContentKeyService readiness', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails closed when a durable row references an unavailable reader version', async () => {
    const service = new TenantContentKeyService(
      prismaReferences(),
      provider(keySet([2])) as WrappingKeyProvider,
    );

    await expect(service.isReady()).resolves.toBe(false);
  });

  it('accepts active and grace versions required by durable rows', async () => {
    const service = new TenantContentKeyService(
      prismaReferences(),
      provider(keySet([1, 2])) as WrappingKeyProvider,
    );

    await expect(service.isReady()).resolves.toBe(true);
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

function prismaReferences(): PrismaService {
  return {
    tenantChatContentKeyState: {
      findFirst: jest.fn().mockResolvedValue({ wrappingKeyRollbackFloor: 2 }),
    },
    tenantChatContentKey: {
      groupBy: jest.fn().mockResolvedValue([{ wrappingKeyVersion: 1 }, { wrappingKeyVersion: 2 }]),
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

function keySet(versions: number[]): WrappingKeySet {
  return Object.freeze({
    activeVersion: 2,
    keys: new Map(versions.map((version) => [version, Object.freeze({
      version,
      wrappingKey: Buffer.alloc(32),
      integrityKey: Buffer.alloc(32),
    })])),
  });
}

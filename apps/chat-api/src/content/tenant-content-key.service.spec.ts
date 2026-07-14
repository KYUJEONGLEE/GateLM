import type { PrismaService } from '@/database/prisma.service';

import { TenantContentKeyService } from './tenant-content-key.service';
import type { WrappingKeyProvider, WrappingKeySet } from './wrapping-key-provider';

describe('TenantContentKeyService readiness', () => {
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

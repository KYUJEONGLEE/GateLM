import type { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import * as tenantCrypto from './tenant-crypto';
import { ContentKeyUnavailable } from './content.errors';
import { ControlPlaneTenantContentKeyService } from './tenant-content-key.service';
import type {
  RagWrappingKeyProvider,
  WrappingKeySet,
} from './wrapping-key-provider';

describe('ControlPlaneTenantContentKeyService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails readiness when the configured active version is below the rollback floor', async () => {
    const service = new ControlPlaneTenantContentKeyService(
      prismaReferences({ rollbackFloor: 2 }),
      provider(keySet([1])) as RagWrappingKeyProvider,
    );

    await expect(service.isReady()).resolves.toBe(false);
  });

  it('accepts every active/grace reader version referenced by durable rows', async () => {
    const service = new ControlPlaneTenantContentKeyService(
      prismaReferences({ rollbackFloor: 2 }),
      provider(keySet([1, 2])) as RagWrappingKeyProvider,
    );

    await expect(service.isReady()).resolves.toBe(true);
  });

  it('refuses an active-key resolution below the durable rollback floor', async () => {
    const prisma = {
      tenantChatContentKeyState: {
        upsert: jest.fn().mockResolvedValue({
          activeContentKeyVersion: 1,
          wrappingKeyRollbackFloor: 2,
        }),
      },
    } as unknown as PrismaService;
    const service = new ControlPlaneTenantContentKeyService(
      prisma,
      provider(keySet([1])) as RagWrappingKeyProvider,
    );

    await expect(
      service.withActiveKey('tenant', async () => undefined),
    ).rejects.toBeInstanceOf(ContentKeyUnavailable);
  });

  it('rewraps under the active wrapping key and zeroes the unwrapped key on failure', async () => {
    const unwrapped = Buffer.alloc(32, 7);
    jest.spyOn(tenantCrypto, 'unwrapTenantKey').mockReturnValue(unwrapped);
    const prisma = {
      tenantChatContentKeyState: {
        upsert: jest.fn().mockResolvedValue({
          activeContentKeyVersion: 1,
          wrappingKeyRollbackFloor: 1,
        }),
      },
      tenantChatContentKey: {
        findUnique: jest.fn().mockResolvedValue(contentKeyRow()),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('rewrap failed')),
    } as unknown as PrismaService;
    const service = new ControlPlaneTenantContentKeyService(
      prisma,
      provider(keySet([1, 2])) as RagWrappingKeyProvider,
    );

    await expect(
      service.withActiveKey('tenant', async () => undefined),
    ).rejects.toThrow('rewrap failed');
    expect(unwrapped.every((value) => value === 0)).toBe(true);
  });

  it('zeroes a newly generated tenant key if initial persistence fails', async () => {
    const generated = Buffer.alloc(32, 9);
    jest.spyOn(tenantCrypto, 'newTenantKey').mockReturnValue(generated);
    const prisma = {
      tenantChatContentKeyState: {
        upsert: jest.fn().mockResolvedValue({
          activeContentKeyVersion: 1,
          wrappingKeyRollbackFloor: 1,
        }),
        update: jest.fn(),
      },
      tenantChatContentKey: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('write failed')),
    } as unknown as PrismaService;
    const service = new ControlPlaneTenantContentKeyService(
      prisma,
      provider(keySet([1])) as RagWrappingKeyProvider,
    );

    await expect(
      service.withActiveKey('tenant', async () => undefined),
    ).rejects.toThrow('write failed');
    expect(generated.every((value) => value === 0)).toBe(true);
  });

  it('zeroes an unwrapped key after a successful versioned-key callback', async () => {
    const unwrapped = Buffer.alloc(32, 7);
    jest.spyOn(tenantCrypto, 'unwrapTenantKey').mockReturnValue(unwrapped);
    const prisma = {
      tenantChatContentKeyState: {
        findUnique: jest.fn().mockResolvedValue({ wrappingKeyRollbackFloor: 1 }),
      },
      tenantChatContentKey: {
        findUnique: jest.fn().mockResolvedValue(contentKeyRow()),
      },
    } as unknown as PrismaService;
    const service = new ControlPlaneTenantContentKeyService(
      prisma,
      provider(keySet([1])) as RagWrappingKeyProvider,
    );

    await expect(
      service.withKeyVersion('tenant', 1, async (key) => key[0]),
    ).resolves.toBe(7);
    expect(unwrapped.every((value) => value === 0)).toBe(true);
  });

  it('rejects a versioned key row below the durable rollback floor', async () => {
    const prisma = {
      tenantChatContentKeyState: {
        findUnique: jest.fn().mockResolvedValue({ wrappingKeyRollbackFloor: 2 }),
      },
      tenantChatContentKey: {
        findUnique: jest.fn().mockResolvedValue(contentKeyRow()),
      },
    } as unknown as PrismaService;
    const service = new ControlPlaneTenantContentKeyService(
      prisma,
      provider(keySet([1, 2])) as RagWrappingKeyProvider,
    );

    await expect(
      service.withKeyVersion('tenant', 1, async () => undefined),
    ).rejects.toBeInstanceOf(ContentKeyUnavailable);
  });

  it('loads and resolves a rotation-heavy key batch with one provider and DB read set', async () => {
    const resolvedKeys: Buffer[] = [];
    jest.spyOn(tenantCrypto, 'unwrapTenantKey').mockImplementation(() => {
      const key = Buffer.alloc(32, resolvedKeys.length + 1);
      resolvedKeys.push(key);
      return key;
    });
    const keyProvider = provider(keySet([1, 2]));
    const prisma = {
      tenantChatContentKeyState: {
        findUnique: jest.fn().mockResolvedValue({ wrappingKeyRollbackFloor: 1 }),
      },
      tenantChatContentKey: {
        findMany: jest.fn().mockResolvedValue([
          contentKeyRow({ contentKeyVersion: 1, wrappingKeyVersion: 1 }),
          contentKeyRow({ contentKeyVersion: 2, wrappingKeyVersion: 2 }),
        ]),
      },
    } as unknown as PrismaService;
    const service = new ControlPlaneTenantContentKeyService(
      prisma,
      keyProvider as RagWrappingKeyProvider,
    );

    await expect(
      service.withKeyVersions('tenant', [1, 2, 1], async (keys) => [
        keys.get(1)?.[0],
        keys.get(2)?.[0],
      ]),
    ).resolves.toEqual([1, 2]);

    expect(keyProvider.load).toHaveBeenCalledTimes(1);
    expect(prisma.tenantChatContentKeyState.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.tenantChatContentKey.findMany).toHaveBeenCalledTimes(1);
    expect(resolvedKeys).toHaveLength(2);
    expect(resolvedKeys.every((key) => key.every((value) => value === 0))).toBe(
      true,
    );
  });
});

function prismaReferences(input: { rollbackFloor: number }): PrismaService {
  return {
    tenantChatContentKeyState: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ wrappingKeyRollbackFloor: input.rollbackFloor }),
    },
    tenantChatContentKey: {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ wrappingKeyVersion: 1 }, { wrappingKeyVersion: 2 }]),
    },
  } as unknown as PrismaService;
}

function provider(
  value: WrappingKeySet,
): Pick<RagWrappingKeyProvider, 'load'> {
  return { load: jest.fn().mockResolvedValue(value) };
}

function keySet(versions: number[]): WrappingKeySet {
  return Object.freeze({
    activeVersion: versions.at(-1) ?? 1,
    keys: new Map(
      versions.map((version) => [
        version,
        Object.freeze({
          version,
          wrappingKey: Buffer.alloc(32, version),
        }),
      ]),
    ),
  });
}

function contentKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant',
    contentKeyVersion: 1,
    wrappingKeyVersion: 1,
    wrappedKey: Uint8Array.from([1]),
    wrapNonce: Uint8Array.from([1]),
    wrapTag: Uint8Array.from([1]),
    status: 'active',
    ...overrides,
  };
}

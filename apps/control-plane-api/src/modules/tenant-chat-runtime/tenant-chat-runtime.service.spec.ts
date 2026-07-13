import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { TenantChatRuntimeService } from './tenant-chat-runtime.service';
import type { TenantChatRuntimeSnapshotDocument } from './tenant-chat-runtime.types';

describe('TenantChatRuntimeService persistence boundary', () => {
  const findActiveSnapshot = jest.fn();
  const transaction = jest.fn();
  const prisma = {
    $transaction: transaction,
    tenantChatActiveRuntimeSnapshot: { findUnique: findActiveSnapshot },
  } as unknown as PrismaService;
  const service = new TenantChatRuntimeService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a non-UUID tenant before querying an active snapshot', async () => {
    await expect(service.getActiveSnapshot('tenant_fixture_001')).rejects.toThrow(
      'tenantId must be a UUID at the Control Plane persistence boundary.',
    );
    expect(findActiveSnapshot).not.toHaveBeenCalled();
  });

  it('keeps opaque IDs valid in the contract but rejects them before persistence', async () => {
    const snapshot = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../docs/tenant-chat/fixtures/tenant-runtime-snapshot.fixture.json',
        ),
        'utf8',
      ),
    ) as TenantChatRuntimeSnapshotDocument;

    await expect(service.publishSnapshot({ snapshot })).rejects.toThrow(
      'tenantId must be a UUID at the Control Plane persistence boundary.',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid cache-read price before starting a publish transaction', async () => {
    const snapshot = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../docs/tenant-chat/fixtures/tenant-runtime-snapshot.fixture.json',
        ),
        'utf8',
      ),
    ) as TenantChatRuntimeSnapshotDocument;
    snapshot.pricing.routes[0]!.cacheReadInputMicroUsdPerMillionTokens =
      snapshot.pricing.routes[0]!.inputMicroUsdPerMillionTokens + 1;

    await expect(service.publishSnapshot({ snapshot })).rejects.toThrow(
      'cacheReadInputMicroUsdPerMillionTokens must not exceed regular input price',
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

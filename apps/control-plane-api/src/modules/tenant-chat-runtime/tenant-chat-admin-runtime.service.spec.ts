import {
  ProviderConnectionStatus,
  ResourceStatus,
  RuntimeConfigPublishState,
} from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { computeTenantChatSnapshotDigest } from './tenant-chat-runtime.contract';
import { TenantChatRuntimeService } from './tenant-chat-runtime.service';
import type { TenantChatRuntimeSnapshotDocument } from './tenant-chat-runtime.types';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

function createPersistenceHarness(options?: {
  providerConfig?: Record<string, unknown>;
  providerAvailable?: boolean;
}) {
  const snapshots: TenantChatRuntimeSnapshotDocument[] = [];
  const pricingCatalogs: Array<{
    id: string;
    version: bigint;
    digest: string;
  }> = [];
  const runtimeConfigs: Array<{
    id: string;
    version: bigint;
    contentHash: string;
    publishState: RuntimeConfigPublishState;
  }> = [];
  let activeSnapshotId: string | null = null;
  const provider = {
    id: PROVIDER_ID,
    tenantId: TENANT_ID,
    projectId: null,
    status: ProviderConnectionStatus.ACTIVE,
    provider: 'openai',
    displayName: 'OpenAI production',
    providerConfig: options?.providerConfig ?? {
      providerFamily: 'openai',
      models: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4'],
    },
  };

  const activePointer = () => {
    const snapshot = snapshots.find(
      (candidate) => candidate.snapshotId === activeSnapshotId,
    );
    return snapshot
      ? {
          snapshotId: snapshot.snapshotId,
          snapshot: { snapshotBody: snapshot },
        }
      : null;
  };
  const latestByVersion = <T extends { version: bigint | number }>(items: T[]) =>
    [...items].sort((left, right) =>
      BigInt(left.version) < BigInt(right.version) ? 1 : -1,
    )[0] ?? null;

  const tx = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ status: ResourceStatus.ACTIVE }),
    },
    providerConnection: {
      findMany: jest
        .fn()
        .mockImplementation(async () =>
          options?.providerAvailable === false ? [] : [provider],
        ),
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          options?.providerAvailable === false ? null : provider,
        ),
    },
    tenantChatActiveRuntimeSnapshot: {
      findUnique: jest.fn().mockImplementation(async () => activePointer()),
      upsert: jest.fn().mockImplementation(async ({ create, update }) => {
        activeSnapshotId = create.snapshotId ?? update.snapshotId;
        return { tenantId: TENANT_ID, snapshotId: activeSnapshotId };
      }),
    },
    tenantChatRuntimeSnapshot: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const version = where.tenantId_version?.version;
        const snapshot = snapshots.find(
          (candidate) => BigInt(candidate.version) === version,
        );
        return snapshot
          ? {
              snapshotId: snapshot.snapshotId,
              digest: snapshot.digest,
              snapshotBody: snapshot,
            }
          : null;
      }),
      findFirst: jest.fn().mockImplementation(async () => {
        const latest = latestByVersion(snapshots);
        return latest ? { version: BigInt(latest.version) } : null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const snapshot = data.snapshotBody as TenantChatRuntimeSnapshotDocument;
        snapshots.push(snapshot);
        return { snapshotId: snapshot.snapshotId };
      }),
    },
    tenantChatPricingCatalog: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const version = where.tenantId_version.version as bigint;
        return (
          pricingCatalogs.find((candidate) => candidate.version === version) ??
          null
        );
      }),
      findFirst: jest.fn().mockImplementation(async () => {
        const latest = latestByVersion(pricingCatalogs);
        return latest ? { version: latest.version } : null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const record = {
          id: `pricing-${data.version.toString()}`,
          version: data.version as bigint,
          digest: data.digest as string,
        };
        pricingCatalogs.push(record);
        return record;
      }),
    },
    tenantChatRuntimeConfig: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const version = where.tenantId_version.version as bigint;
        return (
          runtimeConfigs.find((candidate) => candidate.version === version) ??
          null
        );
      }),
      findFirst: jest.fn().mockImplementation(async () => {
        const latest = latestByVersion(runtimeConfigs);
        return latest ? { version: latest.version } : null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const record = {
          id: `policy-${data.version.toString()}`,
          version: data.version as bigint,
          contentHash: data.contentHash as string,
          publishState: RuntimeConfigPublishState.ACTIVE,
        };
        runtimeConfigs.push(record);
        return record;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const record = runtimeConfigs.find(
          (candidate) => candidate.id === where.id,
        );
        if (record) {
          record.publishState = data.publishState;
        }
        return record;
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
  } as unknown as PrismaService;

  return {
    prisma,
    tx,
    snapshots,
    get activeSnapshot() {
      return snapshots.find(
        (candidate) => candidate.snapshotId === activeSnapshotId,
      );
    },
  };
}

describe('TenantChatRuntimeService administrator activation', () => {
  it('returns only active tenant Provider candidates and disables unsupported pricing', async () => {
    const harness = createPersistenceHarness();
    const service = new TenantChatRuntimeService(harness.prisma);

    const setup = await service.getAdminRuntimeSetup(TENANT_ID);

    expect(setup.readiness).toBe('needs_activation');
    expect(setup.providers).toEqual([
      expect.objectContaining({
        providerConnectionId: PROVIDER_ID,
        providerFamily: 'openai',
        displayName: 'OpenAI production',
      }),
    ]);
    expect(setup.providers[0]?.models).toEqual([
      expect.objectContaining({
        modelKey: 'gpt-5.4-mini',
        activationStatus: 'available',
        pricing: {
          inputMicroUsdPerMillionTokens: 750_000,
          outputMicroUsdPerMillionTokens: 4_500_000,
          cacheReadInputMicroUsdPerMillionTokens: 75_000,
        },
      }),
      expect.objectContaining({
        modelKey: 'gpt-5.4-nano',
        activationStatus: 'available',
      }),
      {
        modelKey: 'gpt-5.4',
        activationStatus: 'pricing_unavailable',
        pricing: null,
      },
    ]);
    expect(harness.tx.providerConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT_ID,
          projectId: null,
          status: ProviderConnectionStatus.ACTIVE,
        },
      }),
    );
  });

  it('publishes defaults, reads them back, and treats the same request as idempotent', async () => {
    const harness = createPersistenceHarness();
    const service = new TenantChatRuntimeService(harness.prisma);
    const input = {
      tenantId: TENANT_ID,
      providerConnectionId: PROVIDER_ID,
      modelKey: 'gpt-5.4-mini',
      publishedBy: ADMIN_ID,
    };

    const first = await service.activateAdminRuntime(input);
    const second = await service.activateAdminRuntime(input);
    const snapshot = harness.snapshots[0];

    expect(first.readiness).toBe('ready');
    expect(second).toEqual(first);
    expect(harness.snapshots).toHaveLength(1);
    expect(snapshot).toEqual(
      expect.objectContaining({
        version: 1,
        policyVersion: 1,
        employeeNoticeVersion: 1,
        publishedBy: ADMIN_ID,
      }),
    );
    expect(snapshot?.policies.rateLimit).toEqual({
      requests: 60,
      windowSeconds: 60,
    });
    expect(snapshot?.policies.concurrency).toEqual({
      maxActiveAdmissionsPerUser: 2,
      admissionTtlSeconds: 30,
    });
    expect(snapshot?.policies.routing.routes).toEqual([
      expect.objectContaining({
        tier: 'standard',
        providerId: PROVIDER_ID,
        modelKey: 'gpt-5.4-mini',
      }),
      expect.objectContaining({
        tier: 'economy',
        providerId: PROVIDER_ID,
        modelKey: 'gpt-5.4-mini',
      }),
    ]);
    expect(snapshot?.policies.fallback).toEqual({
      enabled: false,
      routeIds: [],
      maxAttempts: 1,
      allowedReasons: [],
    });
    expect(first.activeSnapshot).toEqual(
      expect.objectContaining({
        providerConnectionId: PROVIDER_ID,
        modelKey: 'gpt-5.4-mini',
        pricingStatus: 'current',
      }),
    );
  });

  it('preserves non-routing policies while publishing monotonic versions for a new model', async () => {
    const harness = createPersistenceHarness();
    const service = new TenantChatRuntimeService(harness.prisma);

    await service.activateAdminRuntime({
      tenantId: TENANT_ID,
      providerConnectionId: PROVIDER_ID,
      modelKey: 'gpt-5.4-mini',
      publishedBy: ADMIN_ID,
    });
    const previous = harness.activeSnapshot;
    if (!previous) {
      throw new Error('Expected an active snapshot after initial activation.');
    }
    previous.policies.rateLimit = { requests: 7, windowSeconds: 45 };
    previous.policies.concurrency = {
      maxActiveAdmissionsPerUser: 1,
      admissionTtlSeconds: 30,
    };
    previous.employeeNoticeVersion = 9;
    previous.digest = computeTenantChatSnapshotDigest(previous);

    const setup = await service.activateAdminRuntime({
      tenantId: TENANT_ID,
      providerConnectionId: PROVIDER_ID,
      modelKey: 'gpt-5.4-nano',
      publishedBy: ADMIN_ID,
    });
    const current = harness.activeSnapshot;

    expect(harness.snapshots).toHaveLength(2);
    expect(current).toEqual(
      expect.objectContaining({
        version: 2,
        policyVersion: 2,
        employeeNoticeVersion: 9,
      }),
    );
    expect(current?.pricing.version).toBe(2);
    expect(current?.policies.rateLimit).toEqual({
      requests: 7,
      windowSeconds: 45,
    });
    expect(current?.policies.concurrency).toEqual({
      maxActiveAdmissionsPerUser: 1,
      admissionTtlSeconds: 30,
    });
    expect(current?.policies.routing.routes).toEqual([
      expect.objectContaining({ modelKey: 'gpt-5.4-nano' }),
      expect.objectContaining({ modelKey: 'gpt-5.4-nano' }),
    ]);
    expect(setup.activeSnapshot?.modelKey).toBe('gpt-5.4-nano');
  });

  it('rejects a Provider model whose exact price cannot be represented', async () => {
    const harness = createPersistenceHarness();
    const service = new TenantChatRuntimeService(harness.prisma);

    await expect(
      service.activateAdminRuntime({
        tenantId: TENANT_ID,
        providerConnectionId: PROVIDER_ID,
        modelKey: 'gpt-5.4',
        publishedBy: ADMIN_ID,
      }),
    ).rejects.toThrow(
      'Tenant Chat pricing is unavailable for the selected Provider model.',
    );
    expect(harness.snapshots).toHaveLength(0);
  });

  it('rejects inactive, project-scoped, or cross-tenant Provider identifiers', async () => {
    const harness = createPersistenceHarness({ providerAvailable: false });
    const service = new TenantChatRuntimeService(harness.prisma);

    await expect(
      service.activateAdminRuntime({
        tenantId: TENANT_ID,
        providerConnectionId: PROVIDER_ID,
        modelKey: 'gpt-5.4-mini',
        publishedBy: ADMIN_ID,
      }),
    ).rejects.toThrow('Active tenant Provider connection not found.');
    expect(harness.tx.providerConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: PROVIDER_ID,
          tenantId: TENANT_ID,
          projectId: null,
          status: ProviderConnectionStatus.ACTIVE,
        },
      }),
    );
  });
});

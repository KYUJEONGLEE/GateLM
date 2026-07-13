import { randomUUID } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  computeTenantChatPricingDigest,
  computeTenantChatSnapshotDigest,
} from './tenant-chat-runtime.contract';
import { TenantChatRuntimeService } from './tenant-chat-runtime.service';
import type { TenantChatRuntimeSnapshotDocument } from './tenant-chat-runtime.types';

const databaseUrl = process.env.GATELM_TEST_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('TenantChatRuntimeService integration', () => {
  let prisma: PrismaService;
  let service: TenantChatRuntimeService;
  let tenantId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    service = new TenantChatRuntimeService(prisma);
    const tenant = await prisma.tenant.create({
      data: { name: `tenant-chat-runtime-test-${randomUUID()}` },
      select: { id: true },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (!prisma || !tenantId) {
      return;
    }
    await prisma.tenantChatActiveRuntimeSnapshot.deleteMany({ where: { tenantId } });
    await prisma.tenantChatRuntimeSnapshot.deleteMany({ where: { tenantId } });
    await prisma.tenantChatRuntimeConfig.deleteMany({ where: { tenantId } });
    await prisma.tenantChatPricingCatalog.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('publishes, replays, advances, and protects immutable tenant snapshots', async () => {
    const first = runtimeSnapshot(tenantId, 1);

    await expect(service.publishSnapshot({ snapshot: first })).resolves.toEqual(first);
    await expect(service.publishSnapshot({ snapshot: first })).resolves.toEqual(first);
    await expect(service.getActiveSnapshot(tenantId)).resolves.toEqual(first);

    const second = runtimeSnapshot(tenantId, 2);
    await expect(service.publishSnapshot({ snapshot: second })).resolves.toEqual(second);
    await expect(service.getActiveSnapshot(tenantId)).resolves.toEqual(second);
    await expect(service.publishSnapshot({ snapshot: first })).rejects.toThrow(
      'A historical Tenant Chat snapshot cannot be reactivated',
    );

    const persisted = await prisma.tenantChatRuntimeSnapshot.findMany({
      where: { tenantId },
      orderBy: { version: 'asc' },
      select: { version: true, digest: true, pricingDigest: true },
    });
    expect(persisted).toEqual([
      {
        version: 1n,
        digest: first.digest,
        pricingDigest: first.pricing.digest,
      },
      {
        version: 2n,
        digest: second.digest,
        pricingDigest: second.pricing.digest,
      },
    ]);
  });

  it('reuses an active runtime config without rewriting it for a pricing-only publish', async () => {
    const policySnapshot = runtimeSnapshot(tenantId, 3);
    await service.publishSnapshot({ snapshot: policySnapshot });

    const before = await prisma.tenantChatRuntimeConfig.findUniqueOrThrow({
      where: {
        tenantId_version: {
          tenantId,
          version: BigInt(policySnapshot.policyVersion),
        },
      },
      select: { id: true, updatedAt: true },
    });

    const pricingOnlySnapshot = runtimeSnapshot(tenantId, 4);
    pricingOnlySnapshot.policyVersion = policySnapshot.policyVersion;
    pricingOnlySnapshot.policies = structuredClone(policySnapshot.policies);
    pricingOnlySnapshot.pricing.routes = structuredClone(policySnapshot.pricing.routes);
    pricingOnlySnapshot.pricing.digest = computeTenantChatPricingDigest(
      pricingOnlySnapshot.pricing,
    );
    pricingOnlySnapshot.digest = computeTenantChatSnapshotDigest(pricingOnlySnapshot);

    await service.publishSnapshot({ snapshot: pricingOnlySnapshot });

    const after = await prisma.tenantChatRuntimeConfig.findUniqueOrThrow({
      where: {
        tenantId_version: {
          tenantId,
          version: BigInt(policySnapshot.policyVersion),
        },
      },
      select: { id: true, updatedAt: true },
    });
    expect(after).toEqual(before);
  });
});

function runtimeSnapshot(
  tenantId: string,
  version: number,
): TenantChatRuntimeSnapshotDocument {
  const routeId = `route_economy_${version}`;
  const snapshot: TenantChatRuntimeSnapshotDocument = {
    snapshotId: `tenant_chat_snapshot_${randomUUID().replaceAll('-', '_')}`,
    version,
    digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tenantId,
    policyVersion: version,
    employeeNoticeVersion: 1,
    pricing: {
      version,
      digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      currency: 'USD',
      unit: 'micro_usd_per_1m_tokens',
      effectiveAt: `2026-07-${String(version).padStart(2, '0')}T00:00:00Z`,
      routes: [
        {
          routeId,
          providerId: 'provider_mock',
          modelKey: 'mock_economy',
          inputMicroUsdPerMillionTokens: 100000,
          outputMicroUsdPerMillionTokens: 400000,
        },
      ],
    },
    policies: {
      rateLimit: { requests: 60, windowSeconds: 60 },
      concurrency: {
        maxActiveAdmissionsPerUser: 2,
        admissionTtlSeconds: 30,
      },
      quota: {
        period: 'calendar_month',
        timezone: 'Asia/Seoul',
        defaultMonthlyTokenLimit: 1000000,
        warningPercent: 80,
        economyPercent: 100,
        hardStopPercent: 120,
      },
      budget: {
        period: 'calendar_month',
        timezone: 'Asia/Seoul',
        currency: 'USD',
        monthlyLimitMicroUsd: 1000000000,
        warningPercent: 80,
        economyPercent: 90,
        hardStopPercent: 100,
      },
      routing: {
        routes: [
          {
            routeId,
            tier: 'economy',
            providerId: 'provider_mock',
            modelKey: 'mock_economy',
            enabled: true,
          },
        ],
      },
      fallback: {
        enabled: false,
        routeIds: [],
        maxAttempts: 1,
        allowedReasons: [],
      },
      cache: {
        strategy: 'exact',
        enabled: true,
        ttlSeconds: 300,
        maxEntriesPerUser: 100,
      },
      safety: {
        enabled: true,
        policyDigest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      streaming: {
        enabled: true,
        maxDurationSeconds: 120,
        finalEventRequired: true,
      },
    },
    publishedAt: `2026-07-${String(version).padStart(2, '0')}T09:00:00Z`,
    publishedBy: 'tenant_chat_integration_test',
  };
  snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
  snapshot.digest = computeTenantChatSnapshotDigest(snapshot);
  return snapshot;
}

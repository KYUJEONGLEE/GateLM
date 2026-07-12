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

describeIntegration('Tenant Chat tenant isolation integration', () => {
  let prisma: PrismaService;
  let service: TenantChatRuntimeService;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    service = new TenantChatRuntimeService(prisma);
    const [tenant, otherTenant, user] = await Promise.all([
      prisma.tenant.create({
        data: { name: `tenant-chat-isolation-a-${randomUUID()}` },
        select: { id: true },
      }),
      prisma.tenant.create({
        data: { name: `tenant-chat-isolation-b-${randomUUID()}` },
        select: { id: true },
      }),
      prisma.user.create({
        data: { email: `tenant-chat-isolation-${randomUUID()}@example.com` },
        select: { id: true },
      }),
    ]);
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
    userId = user.id;
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.tenantChatUsageLedgerEntry.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.tenantChatProviderAttempt.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.tenantChatUsageReservation.deleteMany({ where: { tenantId } });
    await prisma.tenantChatUserTokenPeriod.deleteMany({ where: { tenantId } });
    await prisma.tenantChatTenantCostPeriod.deleteMany({ where: { tenantId } });
    await prisma.tenantChatActiveRuntimeSnapshot.deleteMany({ where: { tenantId } });
    await prisma.tenantChatRuntimeSnapshot.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.tenantChatRuntimeConfig.deleteMany({ where: { tenantId } });
    await prisma.tenantChatPricingCatalog.deleteMany({ where: { tenantId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it('rejects a RuntimeSnapshot that points to another tenant runtime and pricing', async () => {
    const snapshot = runtimeSnapshot(tenantId);
    await service.publishSnapshot({ snapshot });
    const persisted = await prisma.tenantChatRuntimeSnapshot.findUniqueOrThrow({
      where: { snapshotId: snapshot.snapshotId },
      select: { pricingCatalogId: true, runtimeConfigId: true },
    });
    const crossTenantSnapshot = runtimeSnapshot(otherTenantId);

    await expect(
      prisma.$executeRaw`
        INSERT INTO tenant_chat_runtime_snapshots (
          snapshot_id, tenant_id, runtime_config_id, pricing_catalog_id, version,
          digest, policy_version, employee_notice_version, pricing_version,
          pricing_digest, snapshot_body, published_at, published_by
        ) VALUES (
          ${crossTenantSnapshot.snapshotId}, ${otherTenantId}::uuid,
          ${persisted.runtimeConfigId}::uuid, ${persisted.pricingCatalogId}::uuid,
          ${BigInt(crossTenantSnapshot.version)}, ${crossTenantSnapshot.digest},
          ${BigInt(crossTenantSnapshot.policyVersion)},
          ${BigInt(crossTenantSnapshot.employeeNoticeVersion)},
          ${BigInt(crossTenantSnapshot.pricing.version)},
          ${crossTenantSnapshot.pricing.digest},
          ${JSON.stringify(crossTenantSnapshot)}::jsonb,
          ${new Date(crossTenantSnapshot.publishedAt)}, ${crossTenantSnapshot.publishedBy}
        )
      `,
    ).rejects.toThrow('tenant_chat_snapshot_runtime_config_tenant_fkey');
  });

  it('rejects ProviderAttempt and Ledger rows for another tenant reservation', async () => {
    const periodStart = new Date('2026-07-01T00:00:00Z');
    const periodEnd = new Date('2026-08-01T00:00:00Z');
    const reservationId = randomUUID();
    const requestId = `request_${randomUUID()}`;

    await prisma.tenantChatUserTokenPeriod.create({
      data: {
        tenantId,
        userId,
        periodStart,
        periodEnd,
        periodTimezone: 'UTC',
        limitTokens: 1000,
        warningThresholdTokens: 800,
        economyThresholdTokens: 900,
        hardStopTokens: 1000,
      },
    });
    await prisma.tenantChatTenantCostPeriod.create({
      data: {
        tenantId,
        periodStart,
        periodEnd,
        periodTimezone: 'UTC',
        limitMicroUsd: 1000,
        warningThresholdMicroUsd: 800,
        economyThresholdMicroUsd: 900,
        hardStopMicroUsd: 1000,
      },
    });
    await prisma.tenantChatUsageReservation.create({
      data: {
        reservationId,
        tenantId,
        userId,
        requestId,
        turnId: `turn_${randomUUID()}`,
        idempotencyKey: `idempotency_${randomUUID()}`,
        userPeriodStart: periodStart,
        tenantPeriodStart: periodStart,
        snapshotVersion: 1,
        snapshotDigest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        pricingVersion: 1,
        reservedAt: new Date(),
      },
    });

    await prisma.$executeRaw`
      INSERT INTO tenant_chat_provider_attempts (
        request_id, attempt_no, reservation_id, tenant_id, kind, provider_id,
        model_key, pricing_version, input_micro_usd_per_million_tokens,
        output_micro_usd_per_million_tokens,
        cache_read_input_micro_usd_per_million_tokens, estimated_input_tokens,
        max_output_tokens, reserved_cost_micro_usd
      ) VALUES (
        ${requestId}, 1, ${reservationId}::uuid, ${tenantId}::uuid,
        'primary', 'provider_test', 'model_test', 1, 100, 200, 300, 10, 20, 1
      )
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO tenant_chat_provider_attempts (
          request_id, attempt_no, reservation_id, tenant_id, kind, provider_id,
          model_key, pricing_version, input_micro_usd_per_million_tokens,
          output_micro_usd_per_million_tokens,
          cache_read_input_micro_usd_per_million_tokens, estimated_input_tokens,
          max_output_tokens, reserved_cost_micro_usd
        ) VALUES (
          ${requestId}, 2, ${reservationId}::uuid, ${otherTenantId}::uuid,
          'primary', 'provider_test', 'model_test', 1, 100, 200, 300, 10, 20, 1
        )
      `,
    ).rejects.toThrow('tenant_chat_attempt_reservation_request_fkey');

    await expect(
      prisma.$executeRaw`
        INSERT INTO tenant_chat_usage_ledger_entries (
          request_id, ledger_version, event_id, reservation_id, tenant_id,
          event_type, occurred_at
        ) VALUES (
          ${requestId}, 1, ${randomUUID()}::uuid, ${reservationId}::uuid,
          ${otherTenantId}::uuid, 'usage_reserved', ${new Date()}
        )
      `,
    ).rejects.toThrow('tenant_chat_ledger_reservation_request_fkey');
  });
});

function runtimeSnapshot(tenantId: string): TenantChatRuntimeSnapshotDocument {
  const routeId = `route_${randomUUID().replaceAll('-', '_')}`;
  const snapshot: TenantChatRuntimeSnapshotDocument = {
    snapshotId: `snapshot_${randomUUID().replaceAll('-', '_')}`,
    version: 1,
    digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tenantId,
    policyVersion: 1,
    employeeNoticeVersion: 1,
    pricing: {
      version: 1,
      digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      currency: 'USD',
      unit: 'micro_usd_per_1m_tokens',
      effectiveAt: '2026-07-01T00:00:00Z',
      routes: [{
        routeId,
        providerId: 'provider_test',
        modelKey: 'model_test',
        inputMicroUsdPerMillionTokens: 100,
        outputMicroUsdPerMillionTokens: 200,
      }],
    },
    policies: {
      rateLimit: { requests: 60, windowSeconds: 60 },
      concurrency: { maxActiveAdmissionsPerUser: 2, admissionTtlSeconds: 30 },
      quota: {
        period: 'calendar_month',
        timezone: 'UTC',
        defaultMonthlyTokenLimit: 1000,
        warningPercent: 80,
        economyPercent: 100,
        hardStopPercent: 120,
      },
      budget: {
        period: 'calendar_month',
        timezone: 'UTC',
        currency: 'USD',
        monthlyLimitMicroUsd: 1000,
        warningPercent: 80,
        economyPercent: 90,
        hardStopPercent: 100,
      },
      routing: {
        routes: [{
          routeId,
          tier: 'economy',
          providerId: 'provider_test',
          modelKey: 'model_test',
          enabled: true,
        }],
      },
      fallback: { enabled: false, routeIds: [], maxAttempts: 1, allowedReasons: [] },
      cache: { strategy: 'exact', enabled: true, ttlSeconds: 300, maxEntriesPerUser: 100 },
      safety: {
        enabled: true,
        policyDigest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      streaming: { enabled: true, maxDurationSeconds: 120, finalEventRequired: true },
    },
    publishedAt: '2026-07-12T09:00:00Z',
    publishedBy: 'tenant_chat_isolation_test',
  };
  snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
  snapshot.digest = computeTenantChatSnapshotDigest(snapshot);
  return snapshot;
}

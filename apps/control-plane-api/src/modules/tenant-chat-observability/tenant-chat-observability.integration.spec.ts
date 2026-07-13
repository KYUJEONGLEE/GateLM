import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import {
  computeTenantChatPricingDigest,
  computeTenantChatSnapshotDigest,
} from '@/modules/tenant-chat-runtime/tenant-chat-runtime.contract';
import { TenantChatRuntimeService } from '@/modules/tenant-chat-runtime/tenant-chat-runtime.service';
import type { TenantChatRuntimeSnapshotDocument } from '@/modules/tenant-chat-runtime/tenant-chat-runtime.types';

import { TenantChatObservabilityService } from './tenant-chat-observability.service';
import { TenantChatProjectionService } from './tenant-chat-projection.service';

const databaseUrl = process.env.GATELM_TEST_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Tenant Chat observability integration', () => {
  let prisma: PrismaService;
  let tenantId: string;
  let userId: string;
  let requestId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    const [tenant, user] = await Promise.all([
      prisma.tenant.create({
        data: { name: `tenant-chat-projection-${randomUUID()}` },
        select: { id: true },
      }),
      prisma.user.create({
        data: { email: `tenant-chat-projection-${randomUUID()}@example.com` },
        select: { id: true },
      }),
    ]);
    tenantId = tenant.id;
    userId = user.id;
    requestId = `request_${randomUUID().replaceAll('-', '_')}`;
    const snapshot = runtimeSnapshot(tenantId);
    await new TenantChatRuntimeService(prisma).publishSnapshot({ snapshot });
    await seedUsage(snapshot);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.tenantChatInvocationLog.deleteMany({ where: { tenantId } });
    await prisma.tenantChatInvocationOutbox.deleteMany({ where: { tenantId } });
    await prisma.tenantChatUsageLedgerEntry.deleteMany({ where: { tenantId } });
    await prisma.tenantChatProviderAttempt.deleteMany({ where: { tenantId } });
    await prisma.tenantChatUsageReservation.deleteMany({ where: { tenantId } });
    await prisma.tenantChatRequestAdmission.deleteMany({ where: { tenantId } });
    await prisma.tenantChatUserTokenPeriod.deleteMany({ where: { tenantId } });
    await prisma.tenantChatTenantCostPeriod.deleteMany({ where: { tenantId } });
    await prisma.tenantChatActiveRuntimeSnapshot.deleteMany({ where: { tenantId } });
    await prisma.tenantChatRuntimeSnapshot.deleteMany({ where: { tenantId } });
    await prisma.tenantChatRuntimeConfig.deleteMany({ where: { tenantId } });
    await prisma.tenantChatPricingCatalog.deleteMany({ where: { tenantId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('projects an ordered outbox event and exposes tenant-scoped aggregates', async () => {
    const config = new ConfigService({
      TENANT_CHAT_PROJECTOR_BATCH_SIZE: 50,
      TENANT_CHAT_PROJECTOR_ENABLED: 'false',
      TENANT_CHAT_PROJECTOR_INTERVAL_MS: 1000,
      TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS: 5,
    });
    const projector = new TenantChatProjectionService(prisma, config);

    await expect(projector.runOnce()).resolves.toBe(1);
    await expect(projector.runOnce()).resolves.toBe(0);

    const projected = await prisma.tenantChatInvocationLog.findUniqueOrThrow({
      where: { requestId },
    });
    expect(projected).toMatchObject({
      tenantId,
      userId,
      surface: 'tenant_chat',
      executionScopeKind: 'tenant_chat',
      terminalOutcome: 'succeeded',
      confirmedInputTokens: 20n,
      confirmedOutputTokens: 10n,
      confirmedTotalTokens: 30n,
      confirmedCostMicroUsd: 50n,
      projectedEventVersion: 2n,
    });

    const service = new TenantChatObservabilityService(prisma);
    const dashboard = await service.getDashboard(tenantId, {
      from: '2026-07-01T00:00:00Z',
      to: '2026-08-01T00:00:00Z',
      surface: 'tenant_chat',
    });
    expect(dashboard.data.requests.total).toBe(1);
    expect(dashboard.data.requests.billableAttempts).toBe(1);
    expect(dashboard.data.usage.confirmedTotalTokens).toBe(30);
    expect(dashboard.data.usage.confirmedCostMicroUsd).toBe(50);
    expect(dashboard.data.requests.cacheEligible).toBe(1);
    expect(dashboard.data.requests.cacheHitRate).toBe(0);
    expect(dashboard.data.breakdowns).toEqual([
      expect.objectContaining({
        providerId: 'provider_projection',
        modelKey: 'model_projection',
        routeTier: 'economy',
      }),
    ]);

    const costSeries = await service.getCostSeries(tenantId, {
      from: '2026-07-01T00:00:00Z',
      to: '2026-08-01T00:00:00Z',
      bucket: '1d',
    });
    expect(costSeries.data.points).toEqual([
      expect.objectContaining({
        requestCount: 1,
        totalTokens: 30,
        confirmedCostMicroUsd: 50,
      }),
    ]);
  });

  async function seedUsage(snapshot: TenantChatRuntimeSnapshotDocument) {
    const periodStart = new Date('2026-07-01T00:00:00Z');
    const periodEnd = new Date('2026-08-01T00:00:00Z');
    const occurredAt = new Date('2026-07-12T12:00:02Z');
    const reservationId = randomUUID();
    const admissionId = randomUUID();
    const reservedEventId = randomUUID();
    const settledEventId = randomUUID();
    const turnId = `turn_${randomUUID().replaceAll('-', '_')}`;
    const idempotencyKey = `idempotency_${randomUUID().replaceAll('-', '_')}`;

    await prisma.tenantChatRequestAdmission.create({
      data: {
        admissionId,
        tenantId,
        userId,
        actorKind: 'tenant_admin',
        requestId,
        turnId,
        idempotencyKey,
        bindingDigest: `hmac-sha256:${'A'.repeat(43)}`,
        snapshotVersion: BigInt(snapshot.version),
        state: 'consumed',
        expiresAt: new Date('2026-07-12T12:00:30Z'),
        consumedAt: new Date('2026-07-12T12:00:01Z'),
        createdAt: new Date('2026-07-12T12:00:00Z'),
      },
    });
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
        hardStopTokens: 1200,
        confirmedInputTokens: 20,
        confirmedOutputTokens: 10,
        confirmedTotalTokens: 30,
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
        confirmedCostMicroUsd: 50,
      },
    });
    await prisma.tenantChatUsageReservation.create({
      data: {
        reservationId,
        tenantId,
        userId,
        requestId,
        turnId,
        idempotencyKey,
        userPeriodStart: periodStart,
        tenantPeriodStart: periodStart,
        snapshotVersion: BigInt(snapshot.version),
        snapshotDigest: snapshot.digest,
        pricingVersion: BigInt(snapshot.pricing.version),
        state: 'settled',
        confirmedInputTokens: 20,
        confirmedOutputTokens: 10,
        confirmedCostMicroUsd: 50,
        ledgerVersion: 2,
        reservedAt: new Date('2026-07-12T12:00:01Z'),
        terminalAt: occurredAt,
        createdAt: new Date('2026-07-12T12:00:01Z'),
      },
    });
    await prisma.tenantChatProviderAttempt.create({
      data: {
        requestId,
        attemptNo: 1,
        reservationId,
        tenantId,
        kind: 'primary',
        providerId: 'provider_projection',
        modelKey: 'model_projection',
        pricingVersion: BigInt(snapshot.pricing.version),
        inputMicroUsdPerMillionTokens: 100,
        outputMicroUsdPerMillionTokens: 200,
        estimatedInputTokens: 20,
        maxOutputTokens: 10,
        reservedCostMicroUsd: 50,
        confirmedInputTokens: 20,
        confirmedOutputTokens: 10,
        confirmedCostMicroUsd: 50,
        outcome: 'succeeded',
        usageQuality: 'confirmed',
        startedAt: new Date('2026-07-12T12:00:01Z'),
        completedAt: occurredAt,
      },
    });
    await prisma.tenantChatInvocationOutbox.createMany({
      data: [
        {
          eventId: reservedEventId,
          tenantId,
          aggregateId: requestId,
          eventType: 'usage_reserved',
          eventVersion: 1,
          payload: eventPayload({
            eventId: reservedEventId,
            eventType: 'usage_reserved',
            eventVersion: 1,
            reservationId,
            requestId,
            userId,
            turnId,
            idempotencyKey,
            snapshot,
            occurredAt: new Date('2026-07-12T12:00:01Z'),
            terminal: false,
          }),
          occurredAt: new Date('2026-07-12T12:00:01Z'),
          availableAt: new Date('2026-07-12T12:00:01Z'),
          publishedAt: new Date('2026-07-12T12:00:01Z'),
        },
        {
          eventId: settledEventId,
          tenantId,
          aggregateId: requestId,
          eventType: 'usage_settled',
          eventVersion: 2,
          payload: eventPayload({
            eventId: settledEventId,
            eventType: 'usage_settled',
            eventVersion: 2,
            reservationId,
            requestId,
            userId,
            turnId,
            idempotencyKey,
            snapshot,
            occurredAt,
            terminal: true,
          }),
          occurredAt,
          availableAt: occurredAt,
        },
      ],
    });
  }
});

function eventPayload(input: {
  eventId: string;
  eventType: 'usage_reserved' | 'usage_settled';
  eventVersion: number;
  reservationId: string;
  requestId: string;
  userId: string;
  turnId: string;
  idempotencyKey: string;
  snapshot: TenantChatRuntimeSnapshotDocument;
  occurredAt: Date;
  terminal: boolean;
}) {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    occurredAt: input.occurredAt.toISOString(),
    aggregateId: input.requestId,
    requestId: input.requestId,
    turnId: input.turnId,
    idempotencyKey: input.idempotencyKey,
    reservationId: input.reservationId,
    executionScope: {
      kind: 'tenant_chat',
      tenantId: input.snapshot.tenantId,
      userId: input.userId,
      actorKind: 'tenant_admin',
    },
    period: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
      timezone: 'UTC',
      currency: 'USD',
    },
    snapshotVersion: input.snapshot.version,
    pricingVersion: input.snapshot.pricing.version,
    quota: {
      state: 'normal',
      reservedTokensDelta: input.terminal ? -100 : 100,
      confirmedInputTokensDelta: input.terminal ? 20 : 0,
      confirmedOutputTokensDelta: input.terminal ? 10 : 0,
      confirmedTotalTokensDelta: input.terminal ? 30 : 0,
      unconfirmedTokensDelta: 0,
    },
    budget: {
      state: 'normal',
      reservedCostMicroUsdDelta: input.terminal ? -100 : 100,
      confirmedCostMicroUsdDelta: input.terminal ? 50 : 0,
      unconfirmedExposureMicroUsdDelta: 0,
    },
    attempts: input.terminal
      ? [
          {
            attemptNo: 1,
            kind: 'primary',
            providerId: 'provider_projection',
            modelKey: 'model_projection',
            outcome: 'succeeded',
            usageQuality: 'confirmed',
            inputTokens: 20,
            outputTokens: 10,
            costMicroUsd: 50,
          },
        ]
      : [],
    ...(input.terminal ? { terminalOutcome: 'succeeded' } : {}),
  };
}

function runtimeSnapshot(tenantId: string): TenantChatRuntimeSnapshotDocument {
  const routeId = `route_${randomUUID().replaceAll('-', '_')}`;
  const snapshot: TenantChatRuntimeSnapshotDocument = {
    snapshotId: `snapshot_${randomUUID().replaceAll('-', '_')}`,
    version: 1,
    digest: `sha256:${'A'.repeat(43)}`,
    tenantId,
    policyVersion: 1,
    employeeNoticeVersion: 1,
    pricing: {
      version: 1,
      digest: `sha256:${'A'.repeat(43)}`,
      currency: 'USD',
      unit: 'micro_usd_per_1m_tokens',
      effectiveAt: '2026-07-01T00:00:00Z',
      routes: [
        {
          routeId,
          providerId: 'provider_projection',
          modelKey: 'model_projection',
          inputMicroUsdPerMillionTokens: 100,
          outputMicroUsdPerMillionTokens: 200,
        },
      ],
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
        routes: [
          {
            routeId,
            tier: 'economy',
            providerId: 'provider_projection',
            modelKey: 'model_projection',
            enabled: true,
          },
        ],
      },
      fallback: { enabled: false, routeIds: [], maxAttempts: 1, allowedReasons: [] },
      providerTokenRate: {
        providers: [
          { providerId: 'provider_projection', limitTokens: 120000, windowSeconds: 60 },
        ],
      },
      cache: { strategy: 'exact', enabled: true, ttlSeconds: 300, maxEntriesPerUser: 100, keySetId: 'tenant_chat_cache_keys_projection' },
      safety: {
        enabled: true,
        policyDigest: `sha256:${'A'.repeat(43)}`,
        detectorSet: [
          { detectorType: 'email', action: 'redact' },
          { detectorType: 'api_key', action: 'block' },
        ],
      },
      streaming: { enabled: true, maxDurationSeconds: 120, finalEventRequired: true },
    },
    publishedAt: '2026-07-12T09:00:00Z',
    publishedBy: 'tenant_chat_projection_test',
  };
  snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
  snapshot.digest = computeTenantChatSnapshotDigest(snapshot);
  return snapshot;
}

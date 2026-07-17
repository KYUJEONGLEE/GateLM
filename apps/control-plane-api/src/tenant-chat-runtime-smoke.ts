import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from './app.module';
import { PrismaService } from './infrastructure/database/prisma/prisma.service';
import { hashPassword } from './modules/auth/auth.crypto';
import {
  computeTenantChatPricingDigest,
  computeTenantChatSnapshotDigest,
} from './modules/tenant-chat-runtime/tenant-chat-runtime.contract';
import { TenantChatRuntimeService } from './modules/tenant-chat-runtime/tenant-chat-runtime.service';
import type { TenantChatRuntimeSnapshotDocument } from './modules/tenant-chat-runtime/tenant-chat-runtime.types';

const DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000100';
const DEMO_MOCK_PROVIDER_ID = '00000000-0000-4000-8000-000000000600';

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const readback = process.argv.find((value) => value.startsWith('--readback='));
    if (readback) {
      await verifyReadback(app.get(PrismaService), readback.slice('--readback='.length));
      return;
    }
    const prisma = app.get(PrismaService);
    const passwordHash = await hashPassword('tenant-chat-local-smoke-password');
    await prisma.user.upsert({
      where: { id: '00000000-0000-4000-8000-000000000900' },
      create: {
        id: '00000000-0000-4000-8000-000000000900',
        email: 'tenant-chat-smoke@example.invalid',
        name: 'Tenant Chat Smoke',
        passwordHash,
        status: 'active',
        actorAuthzVersion: 1,
        emailVerifiedAt: new Date('2026-07-14T00:00:00.000Z'),
      },
      update: { passwordHash, status: 'active', actorAuthzVersion: 1, deletedAt: null },
    });
    await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: DEMO_TENANT_ID,
          userId: '00000000-0000-4000-8000-000000000900',
        },
      },
      create: {
        id: '00000000-0000-4000-8000-000000000901',
        tenantId: DEMO_TENANT_ID,
        userId: '00000000-0000-4000-8000-000000000900',
        role: 'tenant_admin',
        status: 'active',
        joinedAt: new Date('2026-07-14T00:00:00.000Z'),
      },
      update: { role: 'tenant_admin', status: 'active', deletedAt: null },
    });
    await prisma.user.upsert({
      where: { id: '00000000-0000-4000-8000-000000000903' },
      create: {
        id: '00000000-0000-4000-8000-000000000903',
        email: 'tenant-chat-idor-smoke@example.invalid',
        name: 'Tenant Chat IDOR Smoke',
        passwordHash,
        status: 'active',
        actorAuthzVersion: 1,
        emailVerifiedAt: new Date('2026-07-14T00:00:00.000Z'),
      },
      update: { passwordHash, status: 'active', actorAuthzVersion: 1, deletedAt: null },
    });
    await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: DEMO_TENANT_ID,
          userId: '00000000-0000-4000-8000-000000000903',
        },
      },
      create: {
        id: '00000000-0000-4000-8000-000000000904',
        tenantId: DEMO_TENANT_ID,
        userId: '00000000-0000-4000-8000-000000000903',
        role: 'tenant_admin',
        status: 'active',
        joinedAt: new Date('2026-07-14T00:00:00.000Z'),
      },
      update: { role: 'tenant_admin', status: 'active', deletedAt: null },
    });
    const service = app.get(TenantChatRuntimeService);
    const snapshot = smokeSnapshot();
    const published = await service.publishSnapshot({ snapshot });
    process.stdout.write(`${JSON.stringify({
      status: 'published',
      tenantId: published.tenantId,
      version: published.version,
      digest: published.digest,
      providerId: DEMO_MOCK_PROVIDER_ID,
      modelKey: 'mock-balanced',
    })}\n`);
  } finally {
    await app.close();
  }
}

async function verifyReadback(prisma: PrismaService, requestId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new Error('Invalid readback request ID.');
  const rows = await prisma.$queryRaw<Array<{
    request_id: string;
    surface: string;
    terminal_outcome: string;
    confirmed_total_tokens: bigint;
  }>>(Prisma.sql`
    SELECT request_id, surface, terminal_outcome, confirmed_total_tokens
    FROM tenant_chat_invocation_logs
    WHERE tenant_id = ${DEMO_TENANT_ID}::uuid
      AND request_id = ${requestId}
      AND surface = 'tenant_chat'
    LIMIT 1
  `);
  const row = rows[0];
  if (!row || rows.length !== 1) throw new Error('Tenant Chat Dashboard readback is not available.');
  process.stdout.write(`${JSON.stringify({
    status: 'projected',
    requestId: row.request_id,
    surface: row.surface,
    terminalOutcome: row.terminal_outcome,
    totalTokens: Number(row.confirmed_total_tokens),
  })}\n`);
}

function smokeSnapshot(): TenantChatRuntimeSnapshotDocument {
  const snapshotVersion = positiveIntegerEnv('TENANT_CHAT_SMOKE_SNAPSHOT_VERSION', 3);
  const rateLimitRequests = positiveIntegerEnv('TENANT_CHAT_SMOKE_RATE_LIMIT_REQUESTS', 60);
  const standardRoute = {
    routeId: 'tenant_chat_smoke_standard',
    providerId: DEMO_MOCK_PROVIDER_ID,
    modelKey: 'mock-balanced',
  };
  const economyRoute = {
    routeId: 'tenant_chat_smoke_economy',
    providerId: DEMO_MOCK_PROVIDER_ID,
    modelKey: 'mock-fast',
  };
  const pricing: TenantChatRuntimeSnapshotDocument['pricing'] = {
    version: 1,
    digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    currency: 'USD',
    unit: 'micro_usd_per_1m_tokens',
    effectiveAt: '2026-07-01T00:00:00.000Z',
    routes: [
      { ...standardRoute, inputMicroUsdPerMillionTokens: 1000, outputMicroUsdPerMillionTokens: 2000 },
      { ...economyRoute, inputMicroUsdPerMillionTokens: 500, outputMicroUsdPerMillionTokens: 1000 },
    ],
  };
  pricing.digest = computeTenantChatPricingDigest(pricing);
  const snapshot: TenantChatRuntimeSnapshotDocument = {
    snapshotId: `tenant_chat_local_smoke_snapshot_${snapshotVersion}`,
    version: snapshotVersion,
    digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tenantId: DEMO_TENANT_ID,
    policyVersion: snapshotVersion,
    employeeNoticeVersion: 1,
    pricing,
    policies: {
      rateLimit: { requests: rateLimitRequests, windowSeconds: 60 },
      concurrency: { maxActiveAdmissionsPerUser: 2, admissionTtlSeconds: 30 },
      quota: {
        period: 'calendar_month', timezone: 'Asia/Seoul', defaultMonthlyTokenLimit: 1_000_000,
        warningPercent: 80, economyPercent: 100, hardStopPercent: 120,
      },
      budget: {
        period: 'calendar_month', timezone: 'Asia/Seoul', currency: 'USD',
        monthlyLimitMicroUsd: 1_000_000_000, warningPercent: 80, economyPercent: 90, hardStopPercent: 100,
      },
      routing: {
        routes: [
          { ...standardRoute, tier: 'standard', enabled: true },
          { ...economyRoute, tier: 'economy', enabled: true },
        ],
      },
      fallback: { enabled: false, routeIds: [], maxAttempts: 1, allowedReasons: [] },
      providerTokenRate: {
        providers: [{ providerId: DEMO_MOCK_PROVIDER_ID, limitTokens: 120_000, windowSeconds: 60 }],
      },
      cache: {
        strategy: 'off', enabled: false, ttlSeconds: 300, maxEntriesPerUser: 100,
        keySetId: 'tenant-chat-local-cache-1',
      },
      safety: {
        enabled: true,
        policyDigest: 'sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        detectorSet: [
          { detectorType: 'email', action: 'redact' },
          { detectorType: 'api_key', action: 'block' },
          { detectorType: 'organization_name', action: 'redact' },
          { detectorType: 'person_name', action: 'redact' },
          { detectorType: 'phone_number', action: 'redact' },
          { detectorType: 'postal_address', action: 'redact' },
        ],
      },
      streaming: { enabled: true, maxDurationSeconds: 120, finalEventRequired: true },
    },
    publishedAt: '2026-07-14T00:00:00.000Z',
    publishedBy: 'tenant_chat_local_smoke',
  };
  snapshot.digest = computeTenantChatSnapshotDigest(snapshot);
  return snapshot;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Tenant Chat runtime smoke failed.'}\n`);
  process.exitCode = 1;
});

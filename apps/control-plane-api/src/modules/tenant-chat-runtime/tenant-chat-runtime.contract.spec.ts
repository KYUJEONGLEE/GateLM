import {
  computeTenantChatPricingDigest,
  computeTenantChatSnapshotDigest,
  validateTenantChatRuntimeSnapshot,
} from './tenant-chat-runtime.contract';
import type { TenantChatRuntimeSnapshotDocument } from './tenant-chat-runtime.types';

describe('Tenant Chat runtime contract', () => {
  it('reproduces the tenant-chat/v1 snapshot and pricing digest vectors', () => {
    const snapshot = contractSnapshotFixture();

    expect(computeTenantChatPricingDigest(snapshot.pricing)).toBe(
      'sha256:C5SCy-tbYwbIrspYHZGb4qUwneWVrkNRiIdVf0iD6BE',
    );
    expect(computeTenantChatSnapshotDigest(snapshot)).toBe(
      'sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M',
    );
    expect(() => validateTenantChatRuntimeSnapshot(snapshot)).not.toThrow();
  });

  it('rejects a published policy without an enabled economy route', () => {
    const snapshot = contractSnapshotFixture();
    snapshot.policies.routing.routes[1]!.enabled = false;
    snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
    snapshot.digest = computeTenantChatSnapshotDigest(snapshot);

    expect(() => validateTenantChatRuntimeSnapshot(snapshot)).toThrow(
      'at least one enabled economy route is required',
    );
  });

  it('rejects pricing provenance that does not match the runtime route', () => {
    const snapshot = contractSnapshotFixture();
    snapshot.policies.routing.routes[0]!.modelKey = 'model_different_001';
    snapshot.digest = computeTenantChatSnapshotDigest(snapshot);

    expect(() => validateTenantChatRuntimeSnapshot(snapshot)).toThrow(
      'must have matching immutable pricing provenance',
    );
  });
});

function contractSnapshotFixture(): TenantChatRuntimeSnapshotDocument {
  return {
    snapshotId: 'tenant_chat_snapshot_fixture_001',
    version: 12,
    digest: 'sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M',
    tenantId: 'tenant_fixture_001',
    policyVersion: 8,
    employeeNoticeVersion: 3,
    pricing: {
      version: 5,
      digest: 'sha256:C5SCy-tbYwbIrspYHZGb4qUwneWVrkNRiIdVf0iD6BE',
      currency: 'USD',
      unit: 'micro_usd_per_1m_tokens',
      effectiveAt: '2026-07-01T00:00:00Z',
      routes: [
        {
          routeId: 'route_standard_001',
          providerId: 'provider_fixture_001',
          modelKey: 'model_standard_001',
          inputMicroUsdPerMillionTokens: 250000,
          outputMicroUsdPerMillionTokens: 1000000,
          cacheReadInputMicroUsdPerMillionTokens: 25000,
        },
        {
          routeId: 'route_economy_001',
          providerId: 'provider_fixture_002',
          modelKey: 'model_economy_001',
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
            routeId: 'route_standard_001',
            tier: 'standard',
            providerId: 'provider_fixture_001',
            modelKey: 'model_standard_001',
            enabled: true,
          },
          {
            routeId: 'route_economy_001',
            tier: 'economy',
            providerId: 'provider_fixture_002',
            modelKey: 'model_economy_001',
            enabled: true,
          },
        ],
      },
      fallback: {
        enabled: true,
        routeIds: ['route_economy_001'],
        maxAttempts: 2,
        allowedReasons: ['provider_timeout', 'provider_error_pre_delta'],
      },
      cache: {
        strategy: 'exact',
        enabled: true,
        ttlSeconds: 300,
        maxEntriesPerUser: 100,
      },
      safety: {
        enabled: true,
        policyDigest: 'sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      },
      streaming: {
        enabled: true,
        maxDurationSeconds: 120,
        finalEventRequired: true,
      },
    },
    publishedAt: '2026-07-12T09:00:00Z',
    publishedBy: 'system_fixture_publisher',
  };
}

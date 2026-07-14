import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  computeTenantChatPricingDigest,
  computeTenantChatSnapshotDigest,
  TenantChatRuntimeContractError,
  validateTenantChatRuntimeSnapshot,
} from './tenant-chat-runtime.contract';
import type { TenantChatRuntimeSnapshotDocument } from './tenant-chat-runtime.types';
import runtimeSnapshotSchema = require('./tenant-runtime-snapshot.schema.json');

const runtimeSnapshotValidationVectors = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../../../../docs/tenant-chat/vectors/runtime-snapshot-validation-vectors.json',
    ),
    'utf8',
  ),
) as {
  cases: Array<{
    id: string;
    path?: string;
    paths?: string[];
    value: unknown;
    valid: boolean;
  }>;
};

describe('Tenant Chat runtime contract', () => {
  it('executes the same RuntimeSnapshot schema published in tenant-chat/v1 docs', () => {
    const contractSchema = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../docs/tenant-chat/schemas/tenant-runtime-snapshot.schema.json',
        ),
        'utf8',
      ),
    ) as unknown;

    expect(runtimeSnapshotSchema).toEqual(contractSchema);
  });

  it('reproduces the tenant-chat/v1 snapshot and pricing digest vectors', () => {
    const snapshot = contractSnapshotFixture();

    expect(computeTenantChatPricingDigest(snapshot.pricing)).toBe(
      'sha256:C5SCy-tbYwbIrspYHZGb4qUwneWVrkNRiIdVf0iD6BE',
    );
    expect(computeTenantChatSnapshotDigest(snapshot)).toBe(
      'sha256:bkdxdG94ChFSQxch7b_LGnstjbozBj4ngd3uWIRdD7c',
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

  it.each(['gpt-5.4-mini', 'models/gemini-2.5-flash', 'vendor:model.v1'])(
    'accepts catalog model key %s',
    (modelKey) => {
      const snapshot = contractSnapshotFixture();
      snapshot.pricing.routes[0]!.modelKey = modelKey;
      snapshot.policies.routing.routes[0]!.modelKey = modelKey;
      snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
      snapshot.digest = computeTenantChatSnapshotDigest(snapshot);

      expect(() => validateTenantChatRuntimeSnapshot(snapshot)).not.toThrow();
    },
  );

  it.each(['model key', 'model\nkey', `m${'x'.repeat(200)}`])(
    'rejects invalid catalog model key %p',
    (modelKey) => {
      const snapshot = contractSnapshotFixture();
      snapshot.pricing.routes[0]!.modelKey = modelKey;
      snapshot.policies.routing.routes[0]!.modelKey = modelKey;
      snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
      snapshot.digest = computeTenantChatSnapshotDigest(snapshot);

      expect(() => validateTenantChatRuntimeSnapshot(snapshot)).toThrow(
        TenantChatRuntimeContractError,
      );
    },
  );

  it('rejects a cache-read input price above the regular input price', () => {
    const snapshot = contractSnapshotFixture();
    snapshot.pricing.routes[0]!.cacheReadInputMicroUsdPerMillionTokens =
      snapshot.pricing.routes[0]!.inputMicroUsdPerMillionTokens + 1;
    snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
    snapshot.digest = computeTenantChatSnapshotDigest(snapshot);

    expect(() => validateTenantChatRuntimeSnapshot(snapshot)).toThrow(
      'cacheReadInputMicroUsdPerMillionTokens must not exceed regular input price',
    );
  });

  it.each(runtimeSnapshotValidationVectors.cases)(
    'enforces RuntimeSnapshot validation vector $id',
    ({ path, paths, value, valid }) => {
      const snapshot = contractSnapshotFixture();
      const mutationPaths = paths ?? (path ? [path] : []);
      if (mutationPaths.length === 0) {
        throw new Error('Validation vector requires path or paths.');
      }
      for (const mutationPath of mutationPaths) {
        setValueAtPath(snapshot, mutationPath, value);
      }
      snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
      snapshot.digest = computeTenantChatSnapshotDigest(snapshot);

      if (valid) {
        expect(() => validateTenantChatRuntimeSnapshot(snapshot)).not.toThrow();
        return;
      }

      expect(() => validateTenantChatRuntimeSnapshot(snapshot)).toThrow(
        TenantChatRuntimeContractError,
      );
    },
  );

  it('rejects an invalid IANA timezone after JSON Schema validation', () => {
    const snapshot = contractSnapshotFixture();
    snapshot.policies.quota.timezone = 'Not/A_Timezone';
    snapshot.pricing.digest = computeTenantChatPricingDigest(snapshot.pricing);
    snapshot.digest = computeTenantChatSnapshotDigest(snapshot);

    expect(() => validateTenantChatRuntimeSnapshot(snapshot)).toThrow(
      'policies.quota.timezone is not an IANA timezone',
    );
  });
});

function setValueAtPath(target: unknown, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      throw new Error(`Validation vector path is invalid at ${segment}`);
    }
  }

  const finalSegment = segments.at(-1);
  if (!finalSegment) {
    throw new Error('Validation vector path cannot be empty');
  }
  if (Array.isArray(current)) {
    current[Number(finalSegment)] = structuredClone(value);
  } else if (current !== null && typeof current === 'object') {
    (current as Record<string, unknown>)[finalSegment] = structuredClone(value);
  } else {
    throw new Error(`Validation vector path is invalid at ${finalSegment}`);
  }
}

function contractSnapshotFixture(): TenantChatRuntimeSnapshotDocument {
  return {
    snapshotId: 'tenant_chat_snapshot_fixture_001',
    version: 12,
    digest: 'sha256:bkdxdG94ChFSQxch7b_LGnstjbozBj4ngd3uWIRdD7c',
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
      providerTokenRate: {
        providers: [
          { providerId: 'provider_fixture_001', limitTokens: 120000, windowSeconds: 60 },
          { providerId: 'provider_fixture_002', limitTokens: 120000, windowSeconds: 60 },
        ],
      },
      cache: {
        strategy: 'exact',
        enabled: true,
        ttlSeconds: 300,
        maxEntriesPerUser: 100,
        keySetId: 'tenant_chat_cache_keys_fixture_001',
      },
      safety: {
        enabled: true,
        policyDigest: 'sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        detectorSet: [
          { detectorType: 'email', action: 'redact' },
          { detectorType: 'api_key', action: 'block' },
        ],
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

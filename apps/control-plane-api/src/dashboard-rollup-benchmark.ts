import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { performance } from 'node:perf_hooks';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import {
  type DashboardRollupGrain,
  DashboardRollupService,
} from '@/modules/dashboard-rollup/dashboard-rollup.service';

type BenchmarkBucket = {
  tenant_id: string;
  surface: 'project_application';
  grain: DashboardRollupGrain;
  bucket_start: Date;
};

type BenchmarkService = {
  markBucketBuilding: (
    tx: Prisma.TransactionClient,
    bucket: BenchmarkBucket,
  ) => Promise<void>;
  clearBucket: (
    tx: Prisma.TransactionClient,
    bucket: BenchmarkBucket,
  ) => Promise<void>;
  rebuildProjectApplicationSourceBucket: (
    tx: Prisma.TransactionClient,
    bucket: BenchmarkBucket,
    bucketEnd: Date,
  ) => Promise<void>;
  rebuildParentGrain: (
    tx: Prisma.TransactionClient,
    bucket: BenchmarkBucket,
  ) => Promise<void>;
  markBucketReady: (
    tx: Prisma.TransactionClient,
    bucket: BenchmarkBucket,
  ) => Promise<void>;
};

type AggregateRow = {
  request_count: bigint;
  cost_micro_usd: bigint;
  saved_cost_micro_usd: bigint;
  cache_hit_count: bigint;
  complex_count: bigint;
  model_count: bigint;
};

const tenantId = requiredEnv('ROLLUP_BENCHMARK_TENANT_ID');
const rangeStart = new Date(requiredEnv('ROLLUP_BENCHMARK_FROM_UTC'));
const rangeEnd = new Date(requiredEnv('ROLLUP_BENCHMARK_TO_UTC'));
if (
  Number.isNaN(rangeStart.getTime()) ||
  Number.isNaN(rangeEnd.getTime()) ||
  rangeStart >= rangeEnd ||
  rangeStart.getUTCSeconds() !== 0 ||
  rangeStart.getUTCMilliseconds() !== 0 ||
  rangeEnd.getUTCSeconds() !== 0 ||
  rangeEnd.getUTCMilliseconds() !== 0
) {
  throw new Error('benchmark range must be an ordered UTC minute-aligned range');
}

const prisma = new PrismaService();
const config = new ConfigService({
  DASHBOARD_ROLLUP_BUILD_MODE: 'minute',
  DASHBOARD_ROLLUP_ENABLED: 'false',
});
const service = new DashboardRollupService(prisma, config);
const internals = service as unknown as BenchmarkService;

async function main(): Promise<void> {
  try {
    await clearBenchmarkRollups();
    const legacyBucket: BenchmarkBucket = {
      tenant_id: tenantId,
      surface: 'project_application',
      grain: 'hour',
      bucket_start: rangeStart,
    };
    const legacyRebuildMs = await measureBucket(
      legacyBucket,
      rangeEnd,
      false,
    );
    const legacyAggregate = await readAggregate('hour');

    await clearBenchmarkRollups();
    const minuteDurations: number[] = [];
    for (
      let bucketStart = rangeStart;
      bucketStart < rangeEnd;
      bucketStart = new Date(bucketStart.getTime() + 60_000)
    ) {
      const bucket: BenchmarkBucket = {
        tenant_id: tenantId,
        surface: 'project_application',
        grain: 'minute',
        bucket_start: bucketStart,
      };
      minuteDurations.push(
        await measureBucket(
          bucket,
          new Date(bucketStart.getTime() + 60_000),
          false,
        ),
      );
    }
    const parentBucket: BenchmarkBucket = {
      tenant_id: tenantId,
      surface: 'project_application',
      grain: 'hour',
      bucket_start: rangeStart,
    };
    const parentMergeMs = await measureBucket(parentBucket, rangeEnd, true);
    const minuteAggregate = await readAggregate('hour');
    const rawAggregate = await readRawAggregate();

    const sortedMinuteDurations = [...minuteDurations].sort(
      (left, right) => left - right,
    );
    const minuteP95Index = Math.max(
      0,
      Math.ceil(sortedMinuteDurations.length * 0.95) - 1,
    );
    const result = {
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      rawRequestCount: Number(rawAggregate.request_count),
      legacyRebuildMs: round(legacyRebuildMs),
      legacyRequestCount: Number(legacyAggregate.request_count),
      minuteBucketCount: minuteDurations.length,
      minuteRebuildTotalMs: round(
        minuteDurations.reduce((sum, value) => sum + value, 0),
      ),
      minuteRebuildMaxMs: round(Math.max(...minuteDurations)),
      minuteRebuildP95Ms: round(sortedMinuteDurations[minuteP95Index] ?? 0),
      parentMergeMs: round(parentMergeMs),
      minuteParentRequestCount: Number(minuteAggregate.request_count),
      parity: {
        requestCount:
          rawAggregate.request_count === legacyAggregate.request_count &&
          rawAggregate.request_count === minuteAggregate.request_count,
        cost:
          rawAggregate.cost_micro_usd === legacyAggregate.cost_micro_usd &&
          rawAggregate.cost_micro_usd === minuteAggregate.cost_micro_usd,
        savedCost:
          rawAggregate.saved_cost_micro_usd ===
          legacyAggregate.saved_cost_micro_usd &&
          rawAggregate.saved_cost_micro_usd ===
          minuteAggregate.saved_cost_micro_usd,
        cacheHit:
          rawAggregate.cache_hit_count === legacyAggregate.cache_hit_count &&
          rawAggregate.cache_hit_count === minuteAggregate.cache_hit_count,
        complexRouting:
          rawAggregate.complex_count === legacyAggregate.complex_count &&
          rawAggregate.complex_count === minuteAggregate.complex_count,
        model:
          rawAggregate.model_count === legacyAggregate.model_count &&
          rawAggregate.model_count === minuteAggregate.model_count,
      },
    };
    if (Object.values(result.parity).some((matches) => !matches)) {
      throw new Error(
        `raw/legacy/minute parity failed: ${JSON.stringify(result)}`,
      );
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`Dashboard rollup benchmark failed: ${message}\n`);
  process.exitCode = 1;
});

async function measureBucket(
  bucket: BenchmarkBucket,
  bucketEnd: Date,
  parent: boolean,
): Promise<number> {
  const startedAt = performance.now();
  await prisma.$transaction(
    async (tx) => {
      await internals.markBucketBuilding(tx, bucket);
      await internals.clearBucket(tx, bucket);
      if (parent) {
        await internals.rebuildParentGrain(tx, bucket);
      } else {
        await internals.rebuildProjectApplicationSourceBucket(
          tx,
          bucket,
          bucketEnd,
        );
      }
      await internals.markBucketReady(tx, bucket);
    },
    { timeout: 120_000 },
  );
  return performance.now() - startedAt;
}

async function clearBenchmarkRollups(): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM employee_usage_rollups WHERE tenant_id = ${tenantId}::uuid`,
    prisma.$executeRaw`DELETE FROM dashboard_rollup_dimensions WHERE tenant_id = ${tenantId}::uuid`,
    prisma.$executeRaw`DELETE FROM dashboard_rollup_totals WHERE tenant_id = ${tenantId}::uuid`,
    prisma.$executeRaw`DELETE FROM dashboard_rollup_bucket_states WHERE tenant_id = ${tenantId}::uuid`,
    prisma.$executeRaw`DELETE FROM dashboard_rollup_dirty_buckets WHERE tenant_id = ${tenantId}::uuid`,
  ]);
}

async function readAggregate(grain: 'hour'): Promise<AggregateRow> {
  const rows = await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    SELECT
      coalesce(sum(request_count), 0)::bigint AS request_count,
      coalesce(sum(cost_micro_usd), 0)::bigint AS cost_micro_usd,
      coalesce(sum(saved_cost_micro_usd), 0)::bigint AS saved_cost_micro_usd,
      coalesce(sum(cache_hit_request_count), 0)::bigint AS cache_hit_count,
      coalesce(sum(high_performance_request_count), 0)::bigint AS complex_count,
      coalesce(sum(model_known_request_count), 0)::bigint AS model_count
    FROM dashboard_rollup_totals
    WHERE tenant_id = ${tenantId}::uuid
      AND surface = 'project_application'
      AND grain = ${grain}
      AND bucket_start >= ${rangeStart}
      AND bucket_start < ${rangeEnd}
  `);
  return rows[0] ?? zeroAggregate();
}

async function readRawAggregate(): Promise<AggregateRow> {
  const rows = await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    SELECT
      count(*)::bigint AS request_count,
      coalesce(sum(cost_micro_usd), 0)::bigint AS cost_micro_usd,
      coalesce(sum(saved_cost_micro_usd), 0)::bigint AS saved_cost_micro_usd,
      count(*) FILTER (WHERE cache_status = 'hit')::bigint AS cache_hit_count,
      count(*) FILTER (
        WHERE lower(metadata ->> 'promptDifficulty') = 'complex'
      )::bigint AS complex_count,
      count(*) FILTER (
        WHERE provider IS NOT NULL AND provider <> ''
          AND model IS NOT NULL AND model <> ''
      )::bigint AS model_count
    FROM p0_llm_invocation_logs
    WHERE tenant_id = ${tenantId}::uuid
      AND created_at >= ${rangeStart}
      AND created_at < ${rangeEnd}
  `);
  return rows[0] ?? zeroAggregate();
}

function zeroAggregate(): AggregateRow {
  return {
    request_count: 0n,
    cost_micro_usd: 0n,
    saved_cost_micro_usd: 0n,
    cache_hit_count: 0n,
    complex_count: 0n,
    model_count: 0n,
  };
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

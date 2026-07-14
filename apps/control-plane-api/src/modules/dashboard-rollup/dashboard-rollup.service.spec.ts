import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS,
  DashboardRollupService,
  dashboardHistogramPercentileUpperBound,
  enqueueDashboardRollupDirtyBucket,
  utcBucketEnd,
  utcBucketStart,
} from './dashboard-rollup.service';

const tenantA = '00000000-0000-4000-8000-000000000100';
const tenantB = '00000000-0000-4000-8000-000000000200';
const migrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260714113000_dashboard_rollups/migration.sql',
);
const discoveryIndexMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260714113100_dashboard_rollup_tenant_chat_discovery_index/migration.sql',
);

describe('DashboardRollupService', () => {
  it('aligns hour, day, and month buckets in UTC', () => {
    const value = new Date('2026-07-14T23:45:12.345+09:00');

    expect(utcBucketStart(value, 'hour').toISOString()).toBe(
      '2026-07-14T14:00:00.000Z',
    );
    expect(utcBucketStart(value, 'day').toISOString()).toBe(
      '2026-07-14T00:00:00.000Z',
    );
    expect(utcBucketStart(value, 'month').toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(utcBucketEnd(value, 'month').toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('derives a percentile from mergeable histogram counts', () => {
    const histogram = DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS.map(() => 0);
    histogram.push(0);
    histogram[1] = 5;
    histogram[5] = 95;

    expect(dashboardHistogramPercentileUpperBound(histogram, 0.5)).toBe(500);
    expect(dashboardHistogramPercentileUpperBound(histogram, 0.95)).toBe(500);
    expect(dashboardHistogramPercentileUpperBound([], 0.95)).toBeNull();
  });

  it('uses tenant-first conflict identity for repeated dirty marks', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest.fn().mockResolvedValue([{ updated: true }]);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
    const bucketStart = new Date('2026-07-14T12:34:56Z');

    await enqueueDashboardRollupDirtyBucket(tx as never, {
      tenantId: tenantA,
      surface: 'project_application',
      grain: 'hour',
      bucketStart,
      reasonCode: 'SOURCE_DISCOVERED',
    });
    await enqueueDashboardRollupDirtyBucket(tx as never, {
      tenantId: tenantA,
      surface: 'project_application',
      grain: 'hour',
      bucketStart,
      reasonCode: 'SOURCE_DISCOVERED',
    });
    await enqueueDashboardRollupDirtyBucket(tx as never, {
      tenantId: tenantB,
      surface: 'project_application',
      grain: 'hour',
      bucketStart,
      reasonCode: 'SOURCE_DISCOVERED',
    });

    expect(executeRaw).toHaveBeenCalledTimes(3);
    const first = rawQuery(executeRaw.mock.calls[0]?.[0]);
    const second = rawQuery(executeRaw.mock.calls[1]?.[0]);
    const third = rawQuery(executeRaw.mock.calls[2]?.[0]);
    expect(first.sql).toContain(
      'ON CONFLICT (tenant_id, surface, grain, bucket_start)',
    );
    expect(first.values).toContain(tenantA);
    expect(second.values).toContain(tenantA);
    expect(third.values).toContain(tenantB);
    expect(first.values).toContainEqual(new Date('2026-07-14T12:00:00Z'));
  });

  it('does not overlap repeated runs in one process', async () => {
    const service = createService();
    let finishDiscovery: ((value: number) => void) | undefined;
    const internals = service as unknown as {
      discoverSource: () => Promise<number>;
      processNextDirtyBucket: () => Promise<boolean>;
    };
    jest
      .spyOn(internals, 'discoverSource')
      .mockImplementationOnce(
        () =>
        new Promise<number>((resolve) => {
          finishDiscovery = resolve;
        }),
      )
      .mockResolvedValue(0);
    jest.spyOn(internals, 'processNextDirtyBucket').mockResolvedValue(false);

    const first = service.runOnce();
    await Promise.resolve();
    await expect(service.runOnce()).resolves.toEqual({ discovered: 0, aggregated: 0 });
    finishDiscovery?.(0);
    await expect(first).resolves.toEqual({ discovered: 0, aggregated: 0 });
  });

  it('reconciles the recent cutoff window instead of a stale cursor window', async () => {
    const cutoff = new Date('2026-07-14T12:00:00Z');
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
    const service = createService();
    const internals = service as unknown as {
      discoverProjectApplication: (
        client: typeof tx,
        cursor: {
          cursor_at: Date;
          cursor_key: string;
          last_reconciled_at: null;
        },
        batchSize: number,
        discoveryCutoff: Date,
      ) => Promise<number>;
    };

    await internals.discoverProjectApplication(
      tx,
      {
        cursor_at: new Date('2026-01-01T00:00:00Z'),
        cursor_key: 'stale-request',
        last_reconciled_at: null,
      },
      500,
      cutoff,
    );

    expect(queryRaw).toHaveBeenCalledTimes(2);
    const reconciliation = rawQuery(queryRaw.mock.calls[1]?.[0]);
    expect(reconciliation.sql).toContain('WHERE ingested_at >=');
    expect(reconciliation.values).toContainEqual(
      new Date('2026-07-14T11:45:00Z'),
    );
    expect(reconciliation.values).not.toContainEqual(
      new Date('2025-12-31T23:45:00Z'),
    );
  });

  it('records poison bucket backoff in a separate transaction', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest.fn().mockResolvedValue([{ updated: true }]);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = createService(prisma);
    const internals = service as unknown as {
      recordBucketFailure: (bucket: {
        tenant_id: string;
        surface: 'project_application';
        grain: 'hour';
        bucket_start: Date;
      }) => Promise<void>;
    };

    await internals.recordBucketFailure({
      tenant_id: tenantA,
      surface: 'project_application',
      grain: 'hour',
      bucket_start: new Date('2026-07-14T12:00:00Z'),
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(rawQuery(queryRaw.mock.calls[0]?.[0]).sql).toContain(
      'attempts = attempts + 1',
    );
    expect(rawQuery(queryRaw.mock.calls[0]?.[0]).sql).toContain(
      'available_at = now() + make_interval',
    );
    expect(rawQuery(executeRaw.mock.calls[0]?.[0]).values).toContain(tenantA);
  });

  it('does not overwrite ready state after another replica removed a failed dirty row', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest.fn().mockResolvedValue([]);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = createService(prisma);
    const internals = service as unknown as {
      recordBucketFailure: (bucket: {
        tenant_id: string;
        surface: 'project_application';
        grain: 'hour';
        bucket_start: Date;
      }) => Promise<void>;
    };

    await internals.recordBucketFailure({
      tenant_id: tenantA,
      surface: 'project_application',
      grain: 'hour',
      bucket_start: new Date('2026-07-14T12:00:00Z'),
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('reads the physical TTFT column without serializing each source row', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw };
    const service = createService();
    const internals = service as unknown as {
      rebuildProjectApplicationHour: (
        client: typeof tx,
        bucket: {
          tenant_id: string;
          surface: 'project_application';
          grain: 'hour';
          bucket_start: Date;
        },
        bucketEnd: Date,
      ) => Promise<void>;
    };
    const bucketStart = new Date('2026-07-14T12:00:00Z');

    await internals.rebuildProjectApplicationHour(
      tx,
      {
        tenant_id: tenantA,
        surface: 'project_application',
        grain: 'hour',
        bucket_start: bucketStart,
      },
      new Date('2026-07-14T13:00:00Z'),
    );

    expect(executeRaw).toHaveBeenCalledTimes(2);
    for (const [query] of executeRaw.mock.calls) {
      const sql = rawQuery(query).sql;
      expect(sql).toContain('WHEN ttft_ms IS NOT NULL THEN ttft_ms::bigint');
      expect(sql).not.toContain('to_jsonb(p0_llm_invocation_logs)');
    }
  });

  it('keeps the migration additive, tenant-first, and content-free', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const discoveryIndexSql = readFileSync(discoveryIndexMigrationPath, 'utf8');

    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(sql).toContain(
      'PRIMARY KEY (tenant_id, surface, grain, bucket_start)',
    );
    expect(sql).toContain('budget_scope_resolved_by text NOT NULL');
    expect(sql).toContain('gateway_internal_latency_histogram bigint[]');
    expect(sql).toContain('ttft_histogram bigint[]');
    expect(sql).toContain('caught_up_through timestamptz');
    expect(discoveryIndexSql).toContain(
      'CREATE INDEX CONCURRENTLY tenant_chat_log_rollup_discovery_idx',
    );
    expect(discoveryIndexSql).toContain(
      'ON tenant_chat_invocation_logs (updated_at, request_id)',
    );
    expect(sql).not.toContain("'active_user'");
    expect(sql).not.toMatch(/raw_prompt|raw_response|authorization|api_key|app_token/i);
  });
});

function createService(prisma?: PrismaService): DashboardRollupService {
  const database =
    prisma ??
    ({
      $transaction: jest.fn(),
    } as unknown as PrismaService);
  const values: Record<string, unknown> = {
    DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE: 8,
    DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE: 500,
    DASHBOARD_ROLLUP_ENABLED: 'false',
    DASHBOARD_ROLLUP_INTERVAL_MS: 1000,
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new DashboardRollupService(database, config);
}

function rawQuery(value: unknown): { sql: string; values: unknown[] } {
  const query = value as { sql?: string; values?: unknown[] };
  return { sql: query.sql ?? '', values: query.values ?? [] };
}

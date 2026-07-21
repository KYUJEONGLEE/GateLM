import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS,
  DashboardRollupService,
  dashboardHistogramPercentileUpperBound,
  enqueueDashboardRollupDirtyBucket,
  enqueueDashboardRollupDirtyHierarchy,
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
const employeeUsageMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260714190000_employee_usage_rollups/migration.sql',
);
const minuteMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260721100000_dashboard_rollup_minute_buckets/migration.sql',
);
const minuteDirtyIndexMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260721100100_dashboard_rollup_minute_dirty_index/migration.sql',
);
const minuteStateIndexMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260721100200_dashboard_rollup_minute_state_index/migration.sql',
);
const policyImpactMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260721101000_dashboard_rollup_policy_impact_metrics/migration.sql',
);
const policyOutcomeIndexMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260721101100_dashboard_rollup_policy_outcome_index/migration.sql',
);

describe('DashboardRollupService', () => {
  it('aligns minute, hour, day, and month buckets in UTC', () => {
    const value = new Date('2026-07-14T23:45:12.345+09:00');

    expect(utcBucketStart(value, 'minute').toISOString()).toBe(
      '2026-07-14T14:45:00.000Z',
    );
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
    expect(utcBucketEnd(value, 'minute').toISOString()).toBe(
      '2026-07-14T14:46:00.000Z',
    );
  });

  it('keeps legacy, shadow, and minute dirty hierarchies isolated', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw };
    const base = {
      tenantId: tenantA,
      surface: 'project_application' as const,
      occurredAt: new Date('2026-07-14T12:34:56Z'),
      reasonCode: 'SOURCE_DISCOVERED' as const,
    };

    await enqueueDashboardRollupDirtyHierarchy(tx as never, {
      ...base,
      buildMode: 'legacy',
    });
    expect(executeRaw).toHaveBeenCalledTimes(3);

    executeRaw.mockClear();
    await enqueueDashboardRollupDirtyHierarchy(tx as never, {
      ...base,
      buildMode: 'shadow',
    });
    expect(executeRaw).toHaveBeenCalledTimes(4);

    executeRaw.mockClear();
    await enqueueDashboardRollupDirtyHierarchy(tx as never, {
      ...base,
      buildMode: 'minute',
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(rawQuery(executeRaw.mock.calls[0]?.[0]).values).toContainEqual(
      new Date('2026-07-14T12:34:00Z'),
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

  it('skips Project/Application discovery and dirty buckets when ClickHouse reads are enabled', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: { $queryRaw: typeof queryRaw }) => unknown) =>
          callback({ $queryRaw: queryRaw }),
      ),
    } as unknown as PrismaService;
    const service = createService(prisma, {
      DASHBOARD_ROLLUP_PROJECT_APPLICATION_ENABLED: 'false',
    });
    const internals = service as unknown as {
      discoverSource: (source: string) => Promise<number>;
      processNextDirtyBucket: () => Promise<boolean>;
    };
    const discover = jest
      .spyOn(internals, 'discoverSource')
      .mockResolvedValue(0);

    await expect(service.runOnce()).resolves.toEqual({
      discovered: 0,
      aggregated: 0,
    });

    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith('tenant_chat');
    const claim = rawQuery(queryRaw.mock.calls[0]?.[0]);
    expect(claim.sql).toContain("dirty.surface <> 'project_application'");
    expect(claim.values).toContain(false);
  });

  it('waits for source coverage and child completion before minute parents', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: { $queryRaw: typeof queryRaw }) => unknown) =>
          callback({ $queryRaw: queryRaw }),
      ),
    } as unknown as PrismaService;
    const service = createService(prisma, {
      DASHBOARD_ROLLUP_BUILD_MODE: 'minute',
    });
    const internals = service as unknown as {
      processNextDirtyBucket: () => Promise<boolean>;
    };

    await expect(internals.processNextDirtyBucket()).resolves.toBe(false);

    const claim = rawQuery(queryRaw.mock.calls[0]?.[0]);
    expect(claim.sql).toContain('cursor.caught_up_through');
    expect(claim.sql).toContain("dirty.grain <> 'minute'");
    expect(claim.sql).toContain("= 'legacy'");
    expect(claim.sql).toContain('NOT EXISTS');
    expect(claim.sql).toContain('FROM dashboard_rollup_dirty_buckets child');
    expect(claim.values).toContain('minute');
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
          cursor_at: string;
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
        cursor_at: '2026-01-01 00:00:00.123456+00',
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

  it.each([
    {
      source: 'project_application' as const,
      sourceTimestampColumn: 'ingested_at',
      sourceRow: {
        request_id: 'request-tail',
        tenant_id: tenantA,
        created_at: new Date('2026-07-20T12:00:00Z'),
        ingested_at: '2026-07-20 12:47:21.705353+00',
      },
    },
    {
      source: 'tenant_chat' as const,
      sourceTimestampColumn: 'updated_at',
      sourceRow: {
        request_id: 'request-tail',
        tenant_id: tenantA,
        completed_at: new Date('2026-07-20T12:00:00Z'),
        updated_at: '2026-07-20 12:47:21.705353+00',
      },
    },
  ])(
    'preserves the $source discovery cursor below millisecond precision',
    async ({ source, sourceRow, sourceTimestampColumn }) => {
      const preciseTimestamp = '2026-07-20 12:47:21.705353+00';
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([
          {
            cursor_at: preciseTimestamp,
            cursor_key: 'request-before-tail',
            last_reconciled_at: new Date(),
          },
        ])
        .mockResolvedValueOnce([sourceRow]);
      const executeRaw = jest.fn().mockResolvedValue(1);
      const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
      const prisma = {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => unknown) => callback(tx),
        ),
      } as unknown as PrismaService;
      const service = createService(prisma);
      const internals = service as unknown as {
        discoverSource: (value: typeof source) => Promise<number>;
      };

      await expect(internals.discoverSource(source)).resolves.toBe(1);

      const cursorRead = rawQuery(queryRaw.mock.calls[0]?.[0]);
      const sourceRead = rawQuery(queryRaw.mock.calls[1]?.[0]);
      const cursorAdvance = rawQuery(executeRaw.mock.calls.at(-1)?.[0]);
      expect(cursorRead.sql).toContain('cursor_at::text AS cursor_at');
      expect(sourceRead.sql).toContain(
        `${sourceTimestampColumn}::text AS ${sourceTimestampColumn}`,
      );
      expect(sourceRead.sql).toContain('::timestamptz');
      expect(sourceRead.values).toContain(preciseTimestamp);
      expect(cursorAdvance.sql).toContain(
        'cursor_at = coalesce(?::timestamptz, cursor_at)',
      );
      expect(cursorAdvance.values).toContain(preciseTimestamp);
    },
  );

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
      rebuildProjectApplicationSourceBucket: (
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

    await internals.rebuildProjectApplicationSourceBucket(
      tx,
      {
        tenant_id: tenantA,
        surface: 'project_application',
        grain: 'hour',
        bucket_start: bucketStart,
      },
      new Date('2026-07-14T13:00:00Z'),
    );

    expect(executeRaw).toHaveBeenCalledTimes(3);
    for (const [query] of executeRaw.mock.calls.slice(0, 2)) {
      const sql = rawQuery(query).sql;
      expect(sql).toContain('WITH filtered AS MATERIALIZED');
      expect(sql).toContain('WHEN ttft_ms IS NOT NULL THEN ttft_ms::bigint');
      expect(sql).not.toContain('to_jsonb(p0_llm_invocation_logs)');
    }
    const employeeUsageSql = rawQuery(executeRaw.mock.calls[2]?.[0]).sql;
    expect(employeeUsageSql).toContain('INSERT INTO employee_usage_rollups');
    expect(employeeUsageSql).toContain('WHERE candidate_count = 1');
    expect(employeeUsageSql).toContain('"deletedAt" IS NULL');
  });

  it('keeps unknown project routing difficulty out of routing dimensions', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw };
    const service = createService();
    const internals = service as unknown as {
      rebuildProjectApplicationSourceBucket: (
        client: typeof tx,
        bucket: {
          tenant_id: string;
          surface: 'project_application';
          grain: 'minute';
          bucket_start: Date;
        },
        bucketEnd: Date,
      ) => Promise<void>;
    };

    await internals.rebuildProjectApplicationSourceBucket(
      tx,
      {
        tenant_id: tenantA,
        surface: 'project_application',
        grain: 'minute',
        bucket_start: new Date('2026-07-14T12:00:00Z'),
      },
      new Date('2026-07-14T12:01:00Z'),
    );

    const dimensionSql = rawQuery(executeRaw.mock.calls[1]?.[0]).sql;
    expect(dimensionSql).toContain(
      "CASE lower(nullif(metadata ->> 'promptDifficulty', ''))",
    );
    expect(dimensionSql).toContain("WHEN 'simple' THEN 'simple'");
    expect(dimensionSql).toContain('ELSE NULL');
    expect(dimensionSql).toContain(
      "('routing', prompt_category, prompt_difficulty, routing_reason, prompt_difficulty IS NOT NULL)",
    );
    expect(dimensionSql).not.toContain(
      "coalesce(nullif(metadata ->> 'promptDifficulty', ''), 'simple')",
    );
  });

  it('rolls up persisted Tenant Chat TTFT rather than a synthetic null value', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw };
    const service = createService();
    const internals = service as unknown as {
      rebuildTenantChatSourceBucket: (
        client: typeof tx,
        bucket: {
          tenant_id: string;
          surface: 'tenant_chat';
          grain: 'hour';
          bucket_start: Date;
        },
        bucketEnd: Date,
      ) => Promise<void>;
    };

    await internals.rebuildTenantChatSourceBucket(
      tx,
      {
        tenant_id: tenantA,
        surface: 'tenant_chat',
        grain: 'hour',
        bucket_start: new Date('2026-07-14T12:00:00Z'),
      },
      new Date('2026-07-14T13:00:00Z'),
    );

    for (const [query] of executeRaw.mock.calls.slice(0, 2)) {
      const sql = rawQuery(query).sql;
      expect(sql).toContain('true AS stream');
      expect(sql).toContain('ttft_ms,');
      expect(sql).not.toContain('NULL::bigint AS ttft_ms');
    }
  });

  it('rolls up only projected confirmed Tenant Chat employee usage', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw };
    const service = createService();
    const internals = service as unknown as {
      rebuildTenantChatEmployeeUsage: (
        client: typeof tx,
        bucket: {
          tenant_id: string;
          surface: 'tenant_chat';
          grain: 'hour';
          bucket_start: Date;
        },
        bucketEnd: Date,
      ) => Promise<void>;
    };

    await internals.rebuildTenantChatEmployeeUsage(
      tx,
      {
        tenant_id: tenantA,
        surface: 'tenant_chat',
        grain: 'hour',
        bucket_start: new Date('2026-07-14T12:00:00Z'),
      },
      new Date('2026-07-14T13:00:00Z'),
    );

    const sql = rawQuery(executeRaw.mock.calls[0]?.[0]).sql;
    expect(sql).toContain('logs.confirmed_input_tokens');
    expect(sql).toContain('logs.confirmed_output_tokens');
    expect(sql).toContain('logs.confirmed_cost_micro_usd');
    expect(sql).toContain('logs.employee_id IS NOT NULL');
    expect(sql).toContain('employee."deletedAt" IS NULL');
    expect(sql).not.toContain('reserved_tokens');
    expect(sql).not.toContain('unconfirmed_tokens');
  });

  it('keeps the migration additive, tenant-first, and content-free', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const discoveryIndexSql = readFileSync(discoveryIndexMigrationPath, 'utf8');
    const employeeUsageSql = readFileSync(employeeUsageMigrationPath, 'utf8');
    const minuteSql = readFileSync(minuteMigrationPath, 'utf8');
    const minuteDirtyIndexSql = readFileSync(
      minuteDirtyIndexMigrationPath,
      'utf8',
    );
    const minuteStateIndexSql = readFileSync(
      minuteStateIndexMigrationPath,
      'utf8',
    );
    const policyImpactSql = readFileSync(policyImpactMigrationPath, 'utf8');
    const policyOutcomeIndexSql = readFileSync(
      policyOutcomeIndexMigrationPath,
      'utf8',
    );

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
    expect(employeeUsageSql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(employeeUsageSql).toContain('CREATE TABLE employee_usage_rollups');
    expect(employeeUsageSql).toContain(
      'FOREIGN KEY (employee_id, tenant_id)',
    );
    expect(employeeUsageSql).toContain('employee_usage_rollups_period_idx');
    expect(employeeUsageSql).not.toMatch(
      /raw_prompt|raw_response|authorization|api_key|app_token/i,
    );
    expect(minuteSql).toContain("'minute', 'hour', 'day', 'month'");
    expect(minuteDirtyIndexSql).toContain(
      'CREATE INDEX CONCURRENTLY dashboard_rollup_minute_dirty_idx',
    );
    expect(minuteStateIndexSql).toContain(
      'CREATE INDEX CONCURRENTLY dashboard_rollup_minute_state_idx',
    );
    expect(policyImpactSql).toContain('saved_cost_known_request_count');
    expect(policyImpactSql).toContain("'policy_outcome'");
    expect(policyOutcomeIndexSql).toContain(
      'CREATE INDEX CONCURRENTLY dashboard_rollup_policy_outcome_idx',
    );
    expect(minuteSql).not.toMatch(
      /raw_prompt|raw_response|authorization|api_key|app_token/i,
    );
    expect(policyImpactSql).not.toMatch(
      /raw_prompt|raw_response|authorization|api_key|app_token/i,
    );
  });
});

function createService(
  prisma?: PrismaService,
  overrides: Record<string, unknown> = {},
): DashboardRollupService {
  const database =
    prisma ??
    ({
      $transaction: jest.fn(),
    } as unknown as PrismaService);
  const values: Record<string, unknown> = {
    DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE: 8,
    DASHBOARD_ROLLUP_BUILD_MODE: 'legacy',
    DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE: 500,
    DASHBOARD_ROLLUP_ENABLED: 'false',
    DASHBOARD_ROLLUP_INTERVAL_MS: 1000,
    ...overrides,
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

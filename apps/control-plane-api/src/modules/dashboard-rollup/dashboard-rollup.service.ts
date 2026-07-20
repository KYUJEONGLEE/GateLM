import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

export const DASHBOARD_HISTOGRAM_VERSION = 1;
export const DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS = [
  25,
  50,
  100,
  200,
  300,
  500,
  750,
  1_000,
  1_500,
  2_000,
  3_000,
  5_000,
  7_500,
  10_000,
  15_000,
  30_000,
  60_000,
] as const;

export type DashboardRollupSurface = 'project_application' | 'tenant_chat';
export type DashboardRollupGrain = 'hour' | 'day' | 'month';

type RollupTransaction = Prisma.TransactionClient;

type DirtyBucketRow = {
  tenant_id: string;
  surface: DashboardRollupSurface;
  grain: DashboardRollupGrain;
  bucket_start: Date;
};

type SourceCursorRow = {
  cursor_at: string | null;
  cursor_key: string;
  last_reconciled_at: Date | null;
};

type ReconciliationRow = {
  tenant_id: string;
  bucket_start: Date;
};

type ProjectApplicationDiscoveryRow = {
  request_id: string;
  tenant_id: string;
  created_at: Date;
  ingested_at: string;
};

type TenantChatDiscoveryRow = {
  request_id: string;
  tenant_id: string;
  completed_at: Date;
  updated_at: string;
};

class DashboardRollupBucketRebuildError extends Error {
  constructor(readonly bucket: DirtyBucketRow) {
    super('Dashboard rollup bucket rebuild failed');
  }
}

export type DashboardRollupRunResult = {
  discovered: number;
  aggregated: number;
};

@Injectable()
export class DashboardRollupService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DashboardRollupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private destroyed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('DASHBOARD_ROLLUP_ENABLED') !== 'true') {
      return;
    }
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<DashboardRollupRunResult> {
    if (this.running) {
      return { discovered: 0, aggregated: 0 };
    }
    this.running = true;
    try {
      const discovered =
        (await this.discoverSource('project_application')) +
        (await this.discoverSource('tenant_chat'));
      const bucketBatchSize =
        this.config.get<number>('DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE') ?? 8;
      let aggregated = 0;
      while (aggregated < bucketBatchSize) {
        const processed = await this.processNextDirtyBucket();
        if (!processed) {
          break;
        }
        aggregated += 1;
      }
      return { discovered, aggregated };
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.destroyed) {
      return;
    }
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce();
      } catch {
        // Do not include SQL text, row identifiers, metadata, or source payloads.
        this.logger.error('Dashboard rollup batch failed');
      } finally {
        this.schedule(
          this.config.get<number>('DASHBOARD_ROLLUP_INTERVAL_MS') ?? 1_000,
        );
      }
    }, delayMs);
    this.timer.unref();
  }

  private async discoverSource(source: DashboardRollupSurface): Promise<number> {
    const batchSize =
      this.config.get<number>('DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE') ?? 500;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO dashboard_rollup_source_cursors (
            source, cursor_at, cursor_key, created_at, updated_at
          ) VALUES (${source}, NULL, '', now(), now())
          ON CONFLICT (source) DO NOTHING
        `);
        const cursorRows = await tx.$queryRaw<SourceCursorRow[]>(Prisma.sql`
          SELECT cursor_at::text AS cursor_at, cursor_key, last_reconciled_at
          FROM dashboard_rollup_source_cursors
          WHERE source = ${source}
          FOR UPDATE SKIP LOCKED
        `);
        const cursor = cursorRows[0];
        if (!cursor) {
          return 0;
        }
        const discoveryLagMs =
          this.config.get<number>('DASHBOARD_ROLLUP_DISCOVERY_LAG_MS') ?? 60_000;
        const cutoff = new Date(Date.now() - discoveryLagMs);
        if (source === 'project_application') {
          return this.discoverProjectApplication(tx, cursor, batchSize, cutoff);
        }
        return this.discoverTenantChat(tx, cursor, batchSize, cutoff);
      },
      { timeout: 30_000 },
    );
  }

  private async discoverProjectApplication(
    tx: RollupTransaction,
    cursor: SourceCursorRow,
    batchSize: number,
    cutoff: Date,
  ): Promise<number> {
    const rows = await tx.$queryRaw<ProjectApplicationDiscoveryRow[]>(Prisma.sql`
      SELECT request_id, tenant_id::text, created_at,
             ingested_at::text AS ingested_at
      FROM p0_llm_invocation_logs
      WHERE (
          ${cursor.cursor_at}::timestamptz IS NULL
          OR (ingested_at, request_id) > (
            ${cursor.cursor_at}::timestamptz, ${cursor.cursor_key}
          )
        )
        AND ingested_at <= ${cutoff}
      ORDER BY ingested_at, request_id
      LIMIT ${batchSize}
    `);
    for (const row of uniqueDirtyHours(
      rows.map((item) => ({ tenantId: item.tenant_id, occurredAt: item.created_at })),
    )) {
      await enqueueDashboardRollupDirtyHierarchy(tx, {
        tenantId: row.tenantId,
        surface: 'project_application',
        occurredAt: row.bucketStart,
        reasonCode: 'SOURCE_DISCOVERED',
      });
    }
    const last = rows.at(-1);
    await this.advanceCursor(
      tx,
      'project_application',
      last?.ingested_at ?? null,
      last?.request_id ?? null,
      rows.length < batchSize,
      cutoff,
    );
    if (rows.length < batchSize && this.shouldReconcile(cursor.last_reconciled_at)) {
      await this.reconcileProjectApplication(tx, cutoff);
    }
    return rows.length;
  }

  private async discoverTenantChat(
    tx: RollupTransaction,
    cursor: SourceCursorRow,
    batchSize: number,
    cutoff: Date,
  ): Promise<number> {
    const rows = await tx.$queryRaw<TenantChatDiscoveryRow[]>(Prisma.sql`
      SELECT request_id, tenant_id::text, completed_at,
             updated_at::text AS updated_at
      FROM tenant_chat_invocation_logs
      WHERE (
          ${cursor.cursor_at}::timestamptz IS NULL
          OR (updated_at, request_id) > (
            ${cursor.cursor_at}::timestamptz, ${cursor.cursor_key}
          )
        )
        AND updated_at <= ${cutoff}
      ORDER BY updated_at, request_id
      LIMIT ${batchSize}
    `);
    for (const row of uniqueDirtyHours(
      rows.map((item) => ({ tenantId: item.tenant_id, occurredAt: item.completed_at })),
    )) {
      await enqueueDashboardRollupDirtyHierarchy(tx, {
        tenantId: row.tenantId,
        surface: 'tenant_chat',
        occurredAt: row.bucketStart,
        reasonCode: 'SOURCE_DISCOVERED',
      });
    }
    const last = rows.at(-1);
    await this.advanceCursor(
      tx,
      'tenant_chat',
      last?.updated_at ?? null,
      last?.request_id ?? null,
      rows.length < batchSize,
      cutoff,
    );
    if (rows.length < batchSize && this.shouldReconcile(cursor.last_reconciled_at)) {
      await this.reconcileTenantChat(tx, cutoff);
    }
    return rows.length;
  }

  private async advanceCursor(
    tx: RollupTransaction,
    source: DashboardRollupSurface,
    cursorAt: string | null,
    cursorKey: string | null,
    caughtUp: boolean,
    caughtUpThrough: Date,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      UPDATE dashboard_rollup_source_cursors
      SET cursor_at = coalesce(${cursorAt}::timestamptz, cursor_at),
          cursor_key = coalesce(${cursorKey}, cursor_key),
          last_discovered_at = now(),
          caught_up_at = CASE WHEN ${caughtUp} THEN now() ELSE NULL END,
          caught_up_through = CASE
            WHEN ${caughtUp} THEN ${caughtUpThrough}::timestamptz
            ELSE NULL
          END,
          updated_at = now()
      WHERE source = ${source}
    `);
  }

  private shouldReconcile(lastReconciledAt: Date | null): boolean {
    if (!lastReconciledAt) {
      return true;
    }
    const intervalMs =
      this.config.get<number>('DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS') ??
      60_000;
    return Date.now() - lastReconciledAt.getTime() >= intervalMs;
  }

  private reconciliationLowerBound(anchor: Date): Date {
    const lookbackMs =
      this.config.get<number>('DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS') ??
      900_000;
    return new Date(anchor.getTime() - lookbackMs);
  }

  private async reconcileProjectApplication(
    tx: RollupTransaction,
    cutoff: Date,
  ): Promise<void> {
    const rows = await tx.$queryRaw<ReconciliationRow[]>(Prisma.sql`
      SELECT DISTINCT tenant_id::text, date_trunc('hour', created_at) AS bucket_start
      FROM p0_llm_invocation_logs
      WHERE ingested_at >= ${this.reconciliationLowerBound(cutoff)}
        AND ingested_at <= ${cutoff}
    `);
    await this.enqueueReconciledRows(tx, 'project_application', rows);
    await this.markReconciled(tx, 'project_application');
  }

  private async reconcileTenantChat(
    tx: RollupTransaction,
    cutoff: Date,
  ): Promise<void> {
    const rows = await tx.$queryRaw<ReconciliationRow[]>(Prisma.sql`
      SELECT DISTINCT tenant_id::text, date_trunc('hour', completed_at) AS bucket_start
      FROM tenant_chat_invocation_logs
      WHERE updated_at >= ${this.reconciliationLowerBound(cutoff)}
        AND updated_at <= ${cutoff}
    `);
    await this.enqueueReconciledRows(tx, 'tenant_chat', rows);
    await this.markReconciled(tx, 'tenant_chat');
  }

  private async enqueueReconciledRows(
    tx: RollupTransaction,
    surface: DashboardRollupSurface,
    rows: ReconciliationRow[],
  ): Promise<void> {
    for (const row of rows) {
      await enqueueDashboardRollupDirtyHierarchy(tx, {
        tenantId: row.tenant_id,
        surface,
        occurredAt: row.bucket_start,
        reasonCode: 'SOURCE_DISCOVERED',
      });
    }
  }

  private async markReconciled(
    tx: RollupTransaction,
    source: DashboardRollupSurface,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      UPDATE dashboard_rollup_source_cursors
      SET last_reconciled_at = now(), updated_at = now()
      WHERE source = ${source}
    `);
  }

  private async processNextDirtyBucket(): Promise<boolean> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
        const rows = await tx.$queryRaw<DirtyBucketRow[]>(Prisma.sql`
          SELECT tenant_id::text, surface, grain, bucket_start
          FROM dashboard_rollup_dirty_buckets
          WHERE available_at <= now()
          ORDER BY available_at,
            CASE grain WHEN 'hour' THEN 1 WHEN 'day' THEN 2 ELSE 3 END,
            bucket_start,
            tenant_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `);
        const bucket = rows[0];
        if (!bucket) {
          return false;
        }
        try {
          await this.markBucketBuilding(tx, bucket);
          await this.clearBucket(tx, bucket);
          if (bucket.grain === 'hour') {
            await this.rebuildHour(tx, bucket);
          } else {
            await this.rebuildParentGrain(tx, bucket);
          }
          await this.markBucketReady(tx, bucket);
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM dashboard_rollup_dirty_buckets
            WHERE tenant_id = ${bucket.tenant_id}::uuid
              AND surface = ${bucket.surface}
              AND grain = ${bucket.grain}
              AND bucket_start = ${bucket.bucket_start}
          `);
          await this.enqueueParentBucket(tx, bucket);
          return true;
        } catch {
          throw new DashboardRollupBucketRebuildError(bucket);
        }
        },
        { timeout: 60_000 },
      );
    } catch (error) {
      if (!(error instanceof DashboardRollupBucketRebuildError)) {
        throw error;
      }
      await this.recordBucketFailure(error.bucket);
      return true;
    }
  }

  private async recordBucketFailure(bucket: DirtyBucketRow): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<Array<{ updated: boolean }>>(Prisma.sql`
        UPDATE dashboard_rollup_dirty_buckets
        SET attempts = attempts + 1,
            available_at = now() + make_interval(
              secs => least(300, power(2, least(attempts + 1, 8))::integer)
            ),
            updated_at = now()
        WHERE tenant_id = ${bucket.tenant_id}::uuid
          AND surface = ${bucket.surface}
          AND grain = ${bucket.grain}
          AND bucket_start = ${bucket.bucket_start}
        RETURNING true AS updated
      `);
      if (updated.length === 0) {
        return;
      }
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO dashboard_rollup_bucket_states (
          tenant_id, surface, grain, bucket_start, state,
          histogram_version, last_error_code, created_at, updated_at
        ) VALUES (
          ${bucket.tenant_id}::uuid, ${bucket.surface}, ${bucket.grain},
          ${bucket.bucket_start}, 'error', ${DASHBOARD_HISTOGRAM_VERSION},
          'ROLLUP_REBUILD_FAILED', now(), now()
        )
        ON CONFLICT (tenant_id, surface, grain, bucket_start)
        DO UPDATE SET
          state = 'error',
          last_error_code = 'ROLLUP_REBUILD_FAILED',
          updated_at = now()
      `);
    });
  }

  private async markBucketBuilding(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO dashboard_rollup_bucket_states (
        tenant_id, surface, grain, bucket_start, state,
        histogram_version, created_at, updated_at
      ) VALUES (
        ${bucket.tenant_id}::uuid, ${bucket.surface}, ${bucket.grain},
        ${bucket.bucket_start}, 'building', ${DASHBOARD_HISTOGRAM_VERSION},
        now(), now()
      )
      ON CONFLICT (tenant_id, surface, grain, bucket_start)
      DO UPDATE SET
        state = 'building',
        employee_usage_ready = false,
        employee_usage_row_count = 0,
        last_error_code = NULL,
        updated_at = now()
    `);
  }

  private async clearBucket(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM employee_usage_rollups
      WHERE tenant_id = ${bucket.tenant_id}::uuid
        AND surface = ${bucket.surface}
        AND grain = ${bucket.grain}
        AND bucket_start = ${bucket.bucket_start}
    `);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM dashboard_rollup_dimensions
      WHERE tenant_id = ${bucket.tenant_id}::uuid
        AND surface = ${bucket.surface}
        AND grain = ${bucket.grain}
        AND bucket_start = ${bucket.bucket_start}
    `);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM dashboard_rollup_totals
      WHERE tenant_id = ${bucket.tenant_id}::uuid
        AND surface = ${bucket.surface}
        AND grain = ${bucket.grain}
        AND bucket_start = ${bucket.bucket_start}
    `);
  }

  private async rebuildHour(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
  ): Promise<void> {
    const bucketEnd = utcBucketEnd(bucket.bucket_start, 'hour');
    if (bucket.surface === 'project_application') {
      await this.rebuildProjectApplicationHour(tx, bucket, bucketEnd);
      return;
    }
    await this.rebuildTenantChatHour(tx, bucket, bucketEnd);
  }

  private async markBucketReady(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
  ): Promise<void> {
    const counts = await tx.$queryRaw<
      Array<{
        total_count: bigint;
        dimension_count: bigint;
        employee_usage_count: bigint;
        source_max_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        (SELECT count(*)::bigint FROM dashboard_rollup_totals
          WHERE tenant_id = ${bucket.tenant_id}::uuid
            AND surface = ${bucket.surface}
            AND grain = ${bucket.grain}
            AND bucket_start = ${bucket.bucket_start}) AS total_count,
        (SELECT count(*)::bigint FROM dashboard_rollup_dimensions
          WHERE tenant_id = ${bucket.tenant_id}::uuid
            AND surface = ${bucket.surface}
            AND grain = ${bucket.grain}
            AND bucket_start = ${bucket.bucket_start}) AS dimension_count,
        (SELECT count(*)::bigint FROM employee_usage_rollups
          WHERE tenant_id = ${bucket.tenant_id}::uuid
            AND surface = ${bucket.surface}
            AND grain = ${bucket.grain}
            AND bucket_start = ${bucket.bucket_start}) AS employee_usage_count,
        greatest(
          (SELECT max(source_max_at) FROM dashboard_rollup_totals
            WHERE tenant_id = ${bucket.tenant_id}::uuid
              AND surface = ${bucket.surface}
              AND grain = ${bucket.grain}
              AND bucket_start = ${bucket.bucket_start}),
          (SELECT max(source_max_at) FROM employee_usage_rollups
          WHERE tenant_id = ${bucket.tenant_id}::uuid
            AND surface = ${bucket.surface}
            AND grain = ${bucket.grain}
            AND bucket_start = ${bucket.bucket_start})
        ) AS source_max_at
    `);
    const state = counts[0] ?? {
      total_count: 0n,
      dimension_count: 0n,
      employee_usage_count: 0n,
      source_max_at: null,
    };
    await tx.$executeRaw(Prisma.sql`
      UPDATE dashboard_rollup_bucket_states
      SET state = 'ready',
          source_max_at = ${state.source_max_at},
          aggregated_at = now(),
          histogram_version = ${DASHBOARD_HISTOGRAM_VERSION},
          last_error_code = NULL,
          total_row_count = ${Number(state.total_count)},
          dimension_row_count = ${Number(state.dimension_count)},
          employee_usage_ready = true,
          employee_usage_row_count = ${Number(state.employee_usage_count)},
          updated_at = now()
      WHERE tenant_id = ${bucket.tenant_id}::uuid
        AND surface = ${bucket.surface}
        AND grain = ${bucket.grain}
        AND bucket_start = ${bucket.bucket_start}
    `);
  }

  private async enqueueParentBucket(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
  ): Promise<void> {
    const parentGrain = parentGrainFor(bucket.grain);
    if (!parentGrain) {
      return;
    }
    await enqueueDashboardRollupDirtyBucket(tx, {
      tenantId: bucket.tenant_id,
      surface: bucket.surface,
      grain: parentGrain,
      bucketStart: utcBucketStart(bucket.bucket_start, parentGrain),
      reasonCode: 'CHILD_REBUILT',
    });
  }

  // Raw-source and parent-grain replacement queries are kept below. Each query
  // reads the complete UTC bucket and inserts a fresh replacement after DELETE.
  private async rebuildProjectApplicationHour(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
    bucketEnd: Date,
  ): Promise<void> {
    const latencyEligible = "terminal_status IN ('success', 'failed')";
    const providerLatencyEligible = `${latencyEligible} AND provider_latency_ms IS NOT NULL`;
    const ttftEligible = 'stream = true AND ttft_ms IS NOT NULL';
    await tx.$executeRaw(Prisma.sql`
      WITH filtered AS MATERIALIZED (
        SELECT
          tenant_id,
          project_id::text AS project_id,
          coalesce(application_id::text, '') AS application_id,
          coalesce(nullif(metadata #>> '{budgetScope,budgetScopeType}', ''), 'application') AS budget_scope_type,
          coalesce(nullif(metadata #>> '{budgetScope,budgetScopeId}', ''), application_id::text, '') AS budget_scope_id,
          coalesce(nullif(metadata #>> '{budgetScope,resolvedBy}', ''), 'default_application') AS budget_scope_resolved_by,
          coalesce(
            nullif(metadata #>> '{terminalStatus}', ''),
            nullif(metadata #>> '{gatewayStageOutcomes,terminalStatus}', ''),
            status
          ) AS terminal_status,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          cost_micro_usd,
          saved_cost_micro_usd,
          latency_ms::bigint AS latency_ms,
          greatest(latency_ms - coalesce(provider_latency_ms, 0), 0)::bigint AS gateway_internal_latency_ms,
          provider_latency_ms::bigint AS provider_latency_ms,
          stream,
          CASE
            WHEN ttft_ms IS NOT NULL THEN ttft_ms::bigint
            WHEN (metadata #>> '{streaming,ttftMs}') ~ '^[0-9]+$'
            THEN (metadata #>> '{streaming,ttftMs}')::bigint
            ELSE NULL
          END AS ttft_ms,
          coalesce(
            nullif(metadata #>> '{domainOutcomes,cache,outcome}', ''),
            nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,cache,outcome}', ''),
            CASE coalesce(nullif(cache_status, ''), 'bypass')
              WHEN 'hit' THEN 'hit'
              WHEN 'miss' THEN 'miss'
              WHEN 'error' THEN 'error'
              WHEN 'bypass' THEN 'bypassed'
              ELSE 'not_used'
            END
          ) AS cache_outcome,
          coalesce(nullif(cache_type, ''), 'none') AS cache_type,
          coalesce(
            nullif(metadata #>> '{domainOutcomes,fallback,outcome}', ''),
            nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,fallback,outcome}', ''),
            'not_called'
          ) AS fallback_outcome,
          ingested_at AS source_max_at
        FROM p0_llm_invocation_logs
        WHERE tenant_id = ${bucket.tenant_id}::uuid
          AND created_at >= ${bucket.bucket_start}
          AND created_at < ${bucketEnd}
      )
      INSERT INTO dashboard_rollup_totals (
        tenant_id, surface, grain, bucket_start,
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        request_count, successful_request_count, failed_request_count,
        blocked_request_count, rate_limited_request_count, cancelled_request_count,
        cache_hit_request_count, cache_eligible_request_count,
        fallback_success_request_count,
        prompt_tokens, completion_tokens, total_tokens,
        cost_micro_usd, saved_cost_micro_usd,
        attempt_count, billable_attempt_count, fallback_request_count,
        latency_count, latency_sum_ms, latency_histogram,
        gateway_internal_latency_count, gateway_internal_latency_sum_ms,
        gateway_internal_latency_histogram,
        provider_latency_count, provider_latency_sum_ms, provider_latency_histogram,
        stream_request_count, ttft_count, ttft_sum_ms, ttft_histogram,
        histogram_version, source_max_at, created_at, updated_at
      )
      SELECT
        tenant_id, 'project_application', 'hour', ${bucket.bucket_start},
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        count(*)::bigint,
        count(*) FILTER (WHERE terminal_status = 'success')::bigint,
        count(*) FILTER (WHERE terminal_status = 'failed')::bigint,
        count(*) FILTER (WHERE terminal_status = 'blocked')::bigint,
        count(*) FILTER (WHERE terminal_status = 'rate_limited')::bigint,
        count(*) FILTER (WHERE terminal_status = 'cancelled')::bigint,
        count(*) FILTER (WHERE cache_outcome = 'hit' AND cache_type = 'exact')::bigint,
        count(*) FILTER (WHERE cache_outcome IN ('hit', 'miss', 'error') AND cache_type = 'exact')::bigint,
        count(*) FILTER (WHERE fallback_outcome = 'success')::bigint,
        coalesce(sum(prompt_tokens), 0)::bigint,
        coalesce(sum(completion_tokens), 0)::bigint,
        coalesce(sum(total_tokens), 0)::bigint,
        coalesce(sum(cost_micro_usd), 0)::bigint,
        coalesce(sum(saved_cost_micro_usd), 0)::bigint,
        0::bigint, 0::bigint, 0::bigint,
        count(*) FILTER (WHERE ${Prisma.raw(latencyEligible)})::bigint,
        coalesce(sum(latency_ms) FILTER (WHERE ${Prisma.raw(latencyEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('latency_ms', latencyEligible))},
        count(*) FILTER (WHERE ${Prisma.raw(latencyEligible)})::bigint,
        coalesce(sum(gateway_internal_latency_ms) FILTER (WHERE ${Prisma.raw(latencyEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('gateway_internal_latency_ms', latencyEligible))},
        count(*) FILTER (WHERE ${Prisma.raw(providerLatencyEligible)})::bigint,
        coalesce(sum(provider_latency_ms) FILTER (WHERE ${Prisma.raw(providerLatencyEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('provider_latency_ms', providerLatencyEligible))},
        count(*) FILTER (WHERE stream = true)::bigint,
        count(*) FILTER (WHERE ${Prisma.raw(ttftEligible)})::bigint,
        coalesce(sum(ttft_ms) FILTER (WHERE ${Prisma.raw(ttftEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('ttft_ms', ttftEligible))},
        ${DASHBOARD_HISTOGRAM_VERSION}, max(source_max_at), now(), now()
      FROM filtered
      GROUP BY
        tenant_id, project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by
    `);

    await tx.$executeRaw(Prisma.sql`
      WITH filtered AS MATERIALIZED (
        SELECT
          tenant_id,
          project_id::text AS project_id,
          coalesce(application_id::text, '') AS application_id,
          coalesce(nullif(metadata #>> '{budgetScope,budgetScopeType}', ''), 'application') AS budget_scope_type,
          coalesce(nullif(metadata #>> '{budgetScope,budgetScopeId}', ''), application_id::text, '') AS budget_scope_id,
          coalesce(nullif(metadata #>> '{budgetScope,resolvedBy}', ''), 'default_application') AS budget_scope_resolved_by,
          coalesce(nullif(metadata #>> '{terminalStatus}', ''), nullif(metadata #>> '{gatewayStageOutcomes,terminalStatus}', ''), status) AS terminal_status,
          prompt_tokens, completion_tokens, total_tokens,
          cost_micro_usd, saved_cost_micro_usd,
          latency_ms::bigint AS latency_ms,
          greatest(latency_ms - coalesce(provider_latency_ms, 0), 0)::bigint AS gateway_internal_latency_ms,
          provider_latency_ms::bigint AS provider_latency_ms,
          stream,
          CASE
            WHEN ttft_ms IS NOT NULL THEN ttft_ms::bigint
            WHEN (metadata #>> '{streaming,ttftMs}') ~ '^[0-9]+$'
            THEN (metadata #>> '{streaming,ttftMs}')::bigint
            ELSE NULL
          END AS ttft_ms,
          coalesce(nullif(masking_action, ''), 'none') AS masking_action,
          coalesce(nullif(provider, ''), '') AS provider,
          coalesce(nullif(model, ''), '') AS model,
          coalesce(nullif(routing_reason, ''), '') AS routing_reason,
          CASE lower(coalesce(nullif(metadata ->> 'promptCategory', ''), 'general'))
            WHEN 'code' THEN 'code'
            WHEN 'translation' THEN 'translation'
            WHEN 'summarization' THEN 'summarization'
            WHEN 'reasoning' THEN 'reasoning'
            ELSE 'general'
          END AS prompt_category,
          CASE lower(coalesce(nullif(metadata ->> 'promptDifficulty', ''), 'simple'))
            WHEN 'complex' THEN 'complex'
            ELSE 'simple'
          END AS prompt_difficulty,
          coalesce(
            nullif(metadata #>> '{domainOutcomes,safety,outcome}', ''),
            nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,safety,outcome}', ''),
            CASE coalesce(nullif(masking_action, ''), 'none')
              WHEN 'blocked' THEN 'blocked'
              WHEN 'redacted' THEN 'redacted'
              ELSE 'passed'
            END
          ) AS safety_outcome,
          coalesce(
            nullif(metadata #>> '{domainOutcomes,cache,outcome}', ''),
            nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,cache,outcome}', ''),
            CASE coalesce(nullif(cache_status, ''), 'bypass')
              WHEN 'hit' THEN 'hit'
              WHEN 'miss' THEN 'miss'
              WHEN 'error' THEN 'error'
              WHEN 'bypass' THEN 'bypassed'
              ELSE 'not_used'
            END
          ) AS cache_outcome,
          coalesce(nullif(cache_type, ''), 'none') AS cache_type,
          coalesce(nullif(metadata #>> '{domainOutcomes,fallback,outcome}', ''), nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,fallback,outcome}', ''), 'not_called') AS fallback_outcome,
          coalesce(nullif(metadata #>> '{domainOutcomes,budget,outcome}', ''), nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,budget,outcome}', ''), 'not_checked') AS budget_outcome,
          ingested_at AS source_max_at
        FROM p0_llm_invocation_logs
        WHERE tenant_id = ${bucket.tenant_id}::uuid
          AND created_at >= ${bucket.bucket_start}
          AND created_at < ${bucketEnd}
      ), dimension_rows AS (
        SELECT filtered.*, dimension.dimension_type,
          dimension.dimension_value, dimension.dimension_value_2,
          dimension.dimension_value_3
        FROM filtered
        CROSS JOIN LATERAL (
          VALUES
            ('terminal_status', terminal_status, '', ''),
            ('provider_model', provider, model, ''),
            ('masking_action', masking_action, '', ''),
            ('safety_outcome', safety_outcome, '', ''),
            ('cache_outcome', cache_outcome, cache_type, ''),
            ('fallback_outcome', fallback_outcome, '', ''),
            ('budget_outcome', budget_outcome, '', ''),
            ('routing', prompt_category, prompt_difficulty, routing_reason)
        ) AS dimension(dimension_type, dimension_value, dimension_value_2, dimension_value_3)
        WHERE dimension.dimension_type <> 'provider_model'
           OR (filtered.provider <> '' AND filtered.model <> '')
      )
      INSERT INTO dashboard_rollup_dimensions (
        tenant_id, surface, grain, bucket_start,
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3,
        request_count, successful_request_count, failed_request_count,
        cache_hit_request_count, cache_eligible_request_count,
        fallback_success_request_count,
        prompt_tokens, completion_tokens, total_tokens,
        cost_micro_usd, saved_cost_micro_usd,
        attempt_count, billable_attempt_count, fallback_request_count,
        latency_count, latency_sum_ms, latency_histogram,
        gateway_internal_latency_count, gateway_internal_latency_sum_ms,
        gateway_internal_latency_histogram,
        provider_latency_count, provider_latency_sum_ms, provider_latency_histogram,
        stream_request_count, ttft_count, ttft_sum_ms, ttft_histogram,
        histogram_version, source_max_at, created_at, updated_at
      )
      SELECT
        tenant_id, 'project_application', 'hour', ${bucket.bucket_start},
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3,
        count(*)::bigint,
        count(*) FILTER (WHERE terminal_status = 'success')::bigint,
        count(*) FILTER (WHERE terminal_status = 'failed')::bigint,
        count(*) FILTER (WHERE cache_outcome = 'hit' AND cache_type = 'exact')::bigint,
        count(*) FILTER (WHERE cache_outcome IN ('hit', 'miss', 'error') AND cache_type = 'exact')::bigint,
        count(*) FILTER (WHERE fallback_outcome = 'success')::bigint,
        coalesce(sum(prompt_tokens), 0)::bigint,
        coalesce(sum(completion_tokens), 0)::bigint,
        coalesce(sum(total_tokens), 0)::bigint,
        coalesce(sum(cost_micro_usd), 0)::bigint,
        coalesce(sum(saved_cost_micro_usd), 0)::bigint,
        0::bigint, 0::bigint, 0::bigint,
        count(*) FILTER (WHERE ${Prisma.raw(latencyEligible)})::bigint,
        coalesce(sum(latency_ms) FILTER (WHERE ${Prisma.raw(latencyEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('latency_ms', latencyEligible))},
        count(*) FILTER (WHERE ${Prisma.raw(latencyEligible)})::bigint,
        coalesce(sum(gateway_internal_latency_ms) FILTER (WHERE ${Prisma.raw(latencyEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('gateway_internal_latency_ms', latencyEligible))},
        count(*) FILTER (WHERE ${Prisma.raw(providerLatencyEligible)})::bigint,
        coalesce(sum(provider_latency_ms) FILTER (WHERE ${Prisma.raw(providerLatencyEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('provider_latency_ms', providerLatencyEligible))},
        count(*) FILTER (WHERE stream = true)::bigint,
        count(*) FILTER (WHERE ${Prisma.raw(ttftEligible)})::bigint,
        coalesce(sum(ttft_ms) FILTER (WHERE ${Prisma.raw(ttftEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('ttft_ms', ttftEligible))},
        ${DASHBOARD_HISTOGRAM_VERSION}, max(source_max_at), now(), now()
      FROM dimension_rows
      GROUP BY
        tenant_id, project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3
    `);

    await tx.$executeRaw(Prisma.sql`
      WITH identity_candidates AS (
        SELECT id AS employee_id, lower(id::text) AS identity_key, 1 AS priority
        FROM employees
        WHERE "tenantId" = ${bucket.tenant_id}::uuid
          AND "deletedAt" IS NULL
        UNION ALL
        SELECT id, lower("userId"::text), 2
        FROM employees
        WHERE "tenantId" = ${bucket.tenant_id}::uuid
          AND "userId" IS NOT NULL
          AND "deletedAt" IS NULL
        UNION ALL
        SELECT id, lower(btrim(email)), 3
        FROM employees
        WHERE "tenantId" = ${bucket.tenant_id}::uuid
          AND "deletedAt" IS NULL
      ), candidate_groups AS (
        SELECT
          identity_key,
          priority,
          min(employee_id::text)::uuid AS employee_id,
          count(*)::bigint AS candidate_count
        FROM identity_candidates
        GROUP BY identity_key, priority
      ), preferred_keys AS (
        SELECT DISTINCT ON (identity_key)
          identity_key, employee_id, candidate_count
        FROM candidate_groups
        ORDER BY identity_key, priority
      ), resolved_keys AS (
        SELECT identity_key, employee_id
        FROM preferred_keys
        WHERE candidate_count = 1
      ), attributed AS (
        SELECT
          resolved.employee_id,
          log.project_id::text AS project_id,
          log.prompt_tokens,
          log.completion_tokens,
          log.total_tokens,
          log.cost_micro_usd,
          log.ingested_at AS source_max_at
        FROM p0_llm_invocation_logs log
        JOIN resolved_keys resolved
          ON resolved.identity_key = lower(btrim(log.end_user_id))
        WHERE log.tenant_id = ${bucket.tenant_id}::uuid
          AND log.created_at >= ${bucket.bucket_start}
          AND log.created_at < ${bucketEnd}
          AND log.end_user_id IS NOT NULL
      )
      INSERT INTO employee_usage_rollups (
        tenant_id, employee_id, surface, grain, bucket_start, project_id,
        request_count, input_tokens, output_tokens, total_tokens,
        cost_micro_usd, source_max_at, created_at, updated_at
      )
      SELECT
        ${bucket.tenant_id}::uuid,
        employee_id,
        'project_application',
        'hour',
        ${bucket.bucket_start},
        project_id,
        count(*)::bigint,
        coalesce(sum(prompt_tokens), 0)::bigint,
        coalesce(sum(completion_tokens), 0)::bigint,
        coalesce(sum(total_tokens), 0)::bigint,
        coalesce(sum(cost_micro_usd), 0)::bigint,
        max(source_max_at),
        now(),
        now()
      FROM attributed
      GROUP BY employee_id, project_id
    `);
  }

  private async rebuildTenantChatHour(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
    bucketEnd: Date,
  ): Promise<void> {
    const logLatencyEligible = 'latency_ms IS NOT NULL';
    const attemptLatencyEligible =
      'completed_at IS NOT NULL AND started_at IS NOT NULL';
    await tx.$executeRaw(Prisma.sql`
      WITH log_rows AS (
        SELECT
          terminal_outcome,
          confirmed_input_tokens,
          confirmed_output_tokens,
          confirmed_total_tokens,
          confirmed_cost_micro_usd,
          latency_ms,
          cache_outcome,
          true AS stream,
          ttft_ms,
          updated_at AS source_max_at
        FROM tenant_chat_invocation_logs
        WHERE tenant_id = ${bucket.tenant_id}::uuid
          AND surface = 'tenant_chat'
          AND execution_scope_kind = 'tenant_chat'
          AND completed_at >= ${bucket.bucket_start}
          AND completed_at < ${bucketEnd}
      ), log_aggregate AS (
        SELECT
          count(*)::bigint AS request_count,
          count(*) FILTER (WHERE terminal_outcome IN ('succeeded', 'cache_hit'))::bigint AS successful_request_count,
          count(*) FILTER (WHERE terminal_outcome IN (
            'failed', 'provider_failed', 'provider_timeout',
            'runtime_unavailable', 'no_eligible_route'
          ))::bigint AS failed_request_count,
          count(*) FILTER (WHERE terminal_outcome IN (
            'concurrency_limited', 'safety_blocked', 'quota_blocked', 'budget_blocked'
          ))::bigint AS blocked_request_count,
          count(*) FILTER (WHERE terminal_outcome = 'rate_limited')::bigint AS rate_limited_request_count,
          count(*) FILTER (WHERE terminal_outcome = 'cancelled')::bigint AS cancelled_request_count,
          count(*) FILTER (WHERE cache_outcome = 'hit' OR terminal_outcome = 'cache_hit')::bigint AS cache_hit_request_count,
          count(*) FILTER (WHERE cache_outcome IN ('hit', 'miss') OR terminal_outcome = 'cache_hit')::bigint AS cache_eligible_request_count,
          coalesce(sum(confirmed_input_tokens), 0)::bigint AS prompt_tokens,
          coalesce(sum(confirmed_output_tokens), 0)::bigint AS completion_tokens,
          coalesce(sum(confirmed_total_tokens), 0)::bigint AS total_tokens,
          coalesce(sum(confirmed_cost_micro_usd), 0)::bigint AS cost_micro_usd,
          count(*) FILTER (WHERE ${Prisma.raw(logLatencyEligible)})::bigint AS latency_count,
          coalesce(sum(latency_ms) FILTER (WHERE ${Prisma.raw(logLatencyEligible)}), 0)::bigint AS latency_sum_ms,
          ${Prisma.raw(histogramAggregateSQL('latency_ms', logLatencyEligible))} AS latency_histogram,
          count(*) FILTER (WHERE stream = true)::bigint AS stream_request_count,
          count(*) FILTER (WHERE stream = true AND ttft_ms IS NOT NULL)::bigint AS ttft_count,
          coalesce(sum(ttft_ms) FILTER (WHERE stream = true AND ttft_ms IS NOT NULL), 0)::bigint AS ttft_sum_ms,
          ${Prisma.raw(histogramAggregateSQL('ttft_ms', 'stream = true AND ttft_ms IS NOT NULL'))} AS ttft_histogram,
          max(source_max_at) AS source_max_at
        FROM log_rows
      ), attempt_rows AS (
        SELECT
          request_id,
          kind,
          outcome,
          usage_quality,
          completed_at,
          started_at,
          extract(epoch FROM (completed_at - started_at))::double precision * 1000 AS provider_latency_ms
        FROM tenant_chat_provider_attempts
        WHERE tenant_id = ${bucket.tenant_id}::uuid
          AND completed_at >= ${bucket.bucket_start}
          AND completed_at < ${bucketEnd}
      ), attempt_aggregate AS (
        SELECT
          count(*)::bigint AS attempt_count,
          count(*) FILTER (WHERE usage_quality = 'confirmed')::bigint AS billable_attempt_count,
          count(DISTINCT request_id) FILTER (WHERE kind = 'fallback')::bigint AS fallback_request_count,
          count(DISTINCT request_id) FILTER (
            WHERE kind = 'fallback' AND outcome = 'succeeded'
          )::bigint AS fallback_success_request_count,
          count(*) FILTER (WHERE ${Prisma.raw(attemptLatencyEligible)})::bigint AS provider_latency_count,
          coalesce(sum(provider_latency_ms) FILTER (WHERE ${Prisma.raw(attemptLatencyEligible)}), 0)::bigint AS provider_latency_sum_ms,
          ${Prisma.raw(histogramAggregateSQL('provider_latency_ms', attemptLatencyEligible))} AS provider_latency_histogram
        FROM attempt_rows
      )
      INSERT INTO dashboard_rollup_totals (
        tenant_id, surface, grain, bucket_start,
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        request_count, successful_request_count, failed_request_count,
        blocked_request_count, rate_limited_request_count, cancelled_request_count,
        cache_hit_request_count, cache_eligible_request_count,
        fallback_success_request_count,
        prompt_tokens, completion_tokens, total_tokens,
        cost_micro_usd, saved_cost_micro_usd,
        attempt_count, billable_attempt_count, fallback_request_count,
        latency_count, latency_sum_ms, latency_histogram,
        gateway_internal_latency_count, gateway_internal_latency_sum_ms,
        gateway_internal_latency_histogram,
        provider_latency_count, provider_latency_sum_ms, provider_latency_histogram,
        stream_request_count, ttft_count, ttft_sum_ms, ttft_histogram,
        histogram_version, source_max_at, created_at, updated_at
      )
      SELECT
        ${bucket.tenant_id}::uuid, 'tenant_chat', 'hour', ${bucket.bucket_start},
        '', '', '', '', '',
        logs.request_count,
        logs.successful_request_count,
        logs.failed_request_count,
        logs.blocked_request_count,
        logs.rate_limited_request_count,
        logs.cancelled_request_count,
        logs.cache_hit_request_count,
        logs.cache_eligible_request_count,
        attempts.fallback_success_request_count,
        logs.prompt_tokens, logs.completion_tokens, logs.total_tokens,
        logs.cost_micro_usd, 0::bigint,
        attempts.attempt_count, attempts.billable_attempt_count,
        attempts.fallback_request_count,
        logs.latency_count, logs.latency_sum_ms, logs.latency_histogram,
        0::bigint, 0::bigint, ${Prisma.raw(zeroHistogramSQL())},
        attempts.provider_latency_count, attempts.provider_latency_sum_ms,
        attempts.provider_latency_histogram,
        logs.stream_request_count, logs.ttft_count, logs.ttft_sum_ms,
        logs.ttft_histogram,
        ${DASHBOARD_HISTOGRAM_VERSION}, logs.source_max_at, now(), now()
      FROM log_aggregate logs
      CROSS JOIN attempt_aggregate attempts
      WHERE logs.request_count > 0 OR attempts.attempt_count > 0
    `);

    await this.rebuildTenantChatLogDimensions(tx, bucket, bucketEnd);
    await this.rebuildTenantChatAttemptDimensions(tx, bucket, bucketEnd);
    await this.rebuildTenantChatEmployeeUsage(tx, bucket, bucketEnd);
  }

  private async rebuildTenantChatEmployeeUsage(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
    bucketEnd: Date,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO employee_usage_rollups (
        tenant_id, employee_id, surface, grain, bucket_start, project_id,
        request_count, input_tokens, output_tokens, total_tokens,
        cost_micro_usd, source_max_at, created_at, updated_at
      )
      SELECT
        logs.tenant_id,
        logs.employee_id,
        'tenant_chat',
        'hour',
        ${bucket.bucket_start},
        '',
        count(*)::bigint,
        coalesce(sum(logs.confirmed_input_tokens), 0)::bigint,
        coalesce(sum(logs.confirmed_output_tokens), 0)::bigint,
        coalesce(sum(logs.confirmed_total_tokens), 0)::bigint,
        coalesce(sum(logs.confirmed_cost_micro_usd), 0)::bigint,
        max(logs.updated_at),
        now(),
        now()
      FROM tenant_chat_invocation_logs logs
      JOIN employees employee
        ON employee.id = logs.employee_id
       AND employee."tenantId" = logs.tenant_id
       AND employee."deletedAt" IS NULL
      WHERE logs.tenant_id = ${bucket.tenant_id}::uuid
        AND logs.surface = 'tenant_chat'
        AND logs.execution_scope_kind = 'tenant_chat'
        AND logs.employee_id IS NOT NULL
        AND logs.completed_at >= ${bucket.bucket_start}
        AND logs.completed_at < ${bucketEnd}
      GROUP BY logs.tenant_id, logs.employee_id
    `);
  }

  private async rebuildTenantChatLogDimensions(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
    bucketEnd: Date,
  ): Promise<void> {
    const latencyEligible = 'latency_ms IS NOT NULL';
    await tx.$executeRaw(Prisma.sql`
      WITH filtered AS (
        SELECT
          terminal_outcome,
          confirmed_input_tokens,
          confirmed_output_tokens,
          confirmed_total_tokens,
          confirmed_cost_micro_usd,
          latency_ms,
          cache_outcome,
          quota_state,
          budget_state,
          snapshot_version::text AS snapshot_version,
          pricing_version::text AS pricing_version,
          true AS stream,
          ttft_ms,
          updated_at AS source_max_at
        FROM tenant_chat_invocation_logs
        WHERE tenant_id = ${bucket.tenant_id}::uuid
          AND surface = 'tenant_chat'
          AND execution_scope_kind = 'tenant_chat'
          AND completed_at >= ${bucket.bucket_start}
          AND completed_at < ${bucketEnd}
      ), dimension_rows AS (
        SELECT filtered.*, dimension.dimension_type,
          dimension.dimension_value, dimension.dimension_value_2,
          dimension.dimension_value_3
        FROM filtered
        CROSS JOIN LATERAL (
          VALUES
            ('terminal_status', terminal_outcome, '', ''),
            ('cache_outcome', cache_outcome, '', ''),
            ('quota_state', quota_state, '', ''),
            ('budget_state', budget_state, '', ''),
            ('snapshot_pricing', snapshot_version, pricing_version, '')
        ) AS dimension(dimension_type, dimension_value, dimension_value_2, dimension_value_3)
      )
      INSERT INTO dashboard_rollup_dimensions (
        tenant_id, surface, grain, bucket_start,
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3,
        request_count, successful_request_count, failed_request_count,
        cache_hit_request_count, cache_eligible_request_count,
        fallback_success_request_count,
        prompt_tokens, completion_tokens, total_tokens,
        cost_micro_usd, saved_cost_micro_usd,
        attempt_count, billable_attempt_count, fallback_request_count,
        latency_count, latency_sum_ms, latency_histogram,
        gateway_internal_latency_count, gateway_internal_latency_sum_ms,
        gateway_internal_latency_histogram,
        provider_latency_count, provider_latency_sum_ms, provider_latency_histogram,
        stream_request_count, ttft_count, ttft_sum_ms, ttft_histogram,
        histogram_version, source_max_at, created_at, updated_at
      )
      SELECT
        ${bucket.tenant_id}::uuid, 'tenant_chat', 'hour', ${bucket.bucket_start},
        '', '', '', '', '',
        dimension_type, dimension_value, dimension_value_2, dimension_value_3,
        count(*)::bigint,
        count(*) FILTER (WHERE terminal_outcome IN ('succeeded', 'cache_hit'))::bigint,
        count(*) FILTER (WHERE terminal_outcome IN (
          'failed', 'provider_failed', 'provider_timeout',
          'runtime_unavailable', 'no_eligible_route'
        ))::bigint,
        count(*) FILTER (WHERE cache_outcome = 'hit' OR terminal_outcome = 'cache_hit')::bigint,
        count(*) FILTER (WHERE cache_outcome IN ('hit', 'miss') OR terminal_outcome = 'cache_hit')::bigint,
        0::bigint,
        coalesce(sum(confirmed_input_tokens), 0)::bigint,
        coalesce(sum(confirmed_output_tokens), 0)::bigint,
        coalesce(sum(confirmed_total_tokens), 0)::bigint,
        coalesce(sum(confirmed_cost_micro_usd), 0)::bigint,
        0::bigint, 0::bigint, 0::bigint, 0::bigint,
        count(*) FILTER (WHERE ${Prisma.raw(latencyEligible)})::bigint,
        coalesce(sum(latency_ms) FILTER (WHERE ${Prisma.raw(latencyEligible)}), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('latency_ms', latencyEligible))},
        0::bigint, 0::bigint, ${Prisma.raw(zeroHistogramSQL())},
        0::bigint, 0::bigint, ${Prisma.raw(zeroHistogramSQL())},
        count(*) FILTER (WHERE stream = true)::bigint,
        count(*) FILTER (WHERE stream = true AND ttft_ms IS NOT NULL)::bigint,
        coalesce(sum(ttft_ms) FILTER (WHERE stream = true AND ttft_ms IS NOT NULL), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('ttft_ms', 'stream = true AND ttft_ms IS NOT NULL'))},
        ${DASHBOARD_HISTOGRAM_VERSION}, max(source_max_at), now(), now()
      FROM dimension_rows
      GROUP BY dimension_type, dimension_value, dimension_value_2, dimension_value_3
    `);
  }

  private async rebuildTenantChatAttemptDimensions(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
    bucketEnd: Date,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      WITH attempt_rows AS (
        SELECT
          attempts.request_id,
          attempts.provider_id,
          attempts.model_key,
          coalesce(route.route_tier, 'standard') AS route_tier,
          attempts.kind,
          attempts.outcome,
          attempts.usage_quality,
          attempts.confirmed_input_tokens,
          attempts.confirmed_output_tokens,
          attempts.confirmed_cost_micro_usd,
          extract(epoch FROM (attempts.completed_at - attempts.started_at))::double precision * 1000 AS provider_latency_ms,
          logs.updated_at AS source_max_at
        FROM tenant_chat_provider_attempts attempts
        JOIN tenant_chat_usage_reservations reservations
          ON reservations.reservation_id = attempts.reservation_id
         AND reservations.request_id = attempts.request_id
         AND reservations.tenant_id = attempts.tenant_id
        JOIN tenant_chat_runtime_snapshots snapshots
          ON snapshots.tenant_id = attempts.tenant_id
         AND snapshots.version = reservations.snapshot_version
        LEFT JOIN tenant_chat_invocation_logs logs
          ON logs.request_id = attempts.request_id
         AND logs.tenant_id = attempts.tenant_id
        LEFT JOIN LATERAL (
          SELECT candidate ->> 'tier' AS route_tier
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(snapshots.snapshot_body #> '{policies,routing,routes}') = 'array'
                THEN snapshots.snapshot_body #> '{policies,routing,routes}'
              ELSE '[]'::jsonb
            END
          ) candidate
          WHERE candidate ->> 'providerId' = attempts.provider_id
            AND candidate ->> 'modelKey' = attempts.model_key
          LIMIT 1
        ) route ON true
        WHERE attempts.tenant_id = ${bucket.tenant_id}::uuid
          AND attempts.completed_at >= ${bucket.bucket_start}
          AND attempts.completed_at < ${bucketEnd}
      )
      INSERT INTO dashboard_rollup_dimensions (
        tenant_id, surface, grain, bucket_start,
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3,
        request_count, successful_request_count, failed_request_count,
        cache_hit_request_count, cache_eligible_request_count,
        fallback_success_request_count,
        prompt_tokens, completion_tokens, total_tokens,
        cost_micro_usd, saved_cost_micro_usd,
        attempt_count, billable_attempt_count, fallback_request_count,
        latency_count, latency_sum_ms, latency_histogram,
        gateway_internal_latency_count, gateway_internal_latency_sum_ms,
        gateway_internal_latency_histogram,
        provider_latency_count, provider_latency_sum_ms, provider_latency_histogram,
        stream_request_count, ttft_count, ttft_sum_ms, ttft_histogram,
        histogram_version, source_max_at, created_at, updated_at
      )
      SELECT
        ${bucket.tenant_id}::uuid, 'tenant_chat', 'hour', ${bucket.bucket_start},
        '', '', '', '', '',
        'provider_model', provider_id, model_key, route_tier,
        count(DISTINCT request_id)::bigint,
        0::bigint, 0::bigint, 0::bigint, 0::bigint,
        count(DISTINCT request_id) FILTER (
          WHERE kind = 'fallback' AND outcome = 'succeeded'
        )::bigint,
        coalesce(sum(confirmed_input_tokens), 0)::bigint,
        coalesce(sum(confirmed_output_tokens), 0)::bigint,
        coalesce(sum(confirmed_input_tokens + confirmed_output_tokens), 0)::bigint,
        coalesce(sum(confirmed_cost_micro_usd), 0)::bigint,
        0::bigint,
        count(*)::bigint,
        count(*) FILTER (WHERE usage_quality = 'confirmed')::bigint,
        count(DISTINCT request_id) FILTER (WHERE kind = 'fallback')::bigint,
        0::bigint, 0::bigint, ${Prisma.raw(zeroHistogramSQL())},
        0::bigint, 0::bigint, ${Prisma.raw(zeroHistogramSQL())},
        count(*) FILTER (WHERE provider_latency_ms IS NOT NULL)::bigint,
        coalesce(sum(provider_latency_ms) FILTER (WHERE provider_latency_ms IS NOT NULL), 0)::bigint,
        ${Prisma.raw(histogramAggregateSQL('provider_latency_ms', 'provider_latency_ms IS NOT NULL'))},
        0::bigint, 0::bigint, 0::bigint, ${Prisma.raw(zeroHistogramSQL())},
        ${DASHBOARD_HISTOGRAM_VERSION}, max(source_max_at), now(), now()
      FROM attempt_rows attempts
      GROUP BY provider_id, model_key, route_tier
    `);
  }

  private async rebuildParentGrain(
    tx: RollupTransaction,
    bucket: DirtyBucketRow,
  ): Promise<void> {
    const childGrain: DashboardRollupGrain =
      bucket.grain === 'day' ? 'hour' : 'day';
    const bucketEnd = utcBucketEnd(bucket.bucket_start, bucket.grain);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO dashboard_rollup_totals (
        tenant_id, surface, grain, bucket_start,
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        request_count, successful_request_count, failed_request_count,
        blocked_request_count, rate_limited_request_count, cancelled_request_count,
        cache_hit_request_count, cache_eligible_request_count,
        fallback_success_request_count,
        prompt_tokens, completion_tokens, total_tokens,
        cost_micro_usd, saved_cost_micro_usd,
        attempt_count, billable_attempt_count, fallback_request_count,
        latency_count, latency_sum_ms, latency_histogram,
        gateway_internal_latency_count, gateway_internal_latency_sum_ms,
        gateway_internal_latency_histogram,
        provider_latency_count, provider_latency_sum_ms, provider_latency_histogram,
        stream_request_count, ttft_count, ttft_sum_ms, ttft_histogram,
        histogram_version, source_max_at, created_at, updated_at
      )
      SELECT
        tenant_id, surface, ${bucket.grain}, ${bucket.bucket_start},
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        coalesce(sum(request_count), 0)::bigint,
        coalesce(sum(successful_request_count), 0)::bigint,
        coalesce(sum(failed_request_count), 0)::bigint,
        coalesce(sum(blocked_request_count), 0)::bigint,
        coalesce(sum(rate_limited_request_count), 0)::bigint,
        coalesce(sum(cancelled_request_count), 0)::bigint,
        coalesce(sum(cache_hit_request_count), 0)::bigint,
        coalesce(sum(cache_eligible_request_count), 0)::bigint,
        coalesce(sum(fallback_success_request_count), 0)::bigint,
        coalesce(sum(prompt_tokens), 0)::bigint,
        coalesce(sum(completion_tokens), 0)::bigint,
        coalesce(sum(total_tokens), 0)::bigint,
        coalesce(sum(cost_micro_usd), 0)::bigint,
        coalesce(sum(saved_cost_micro_usd), 0)::bigint,
        coalesce(sum(attempt_count), 0)::bigint,
        coalesce(sum(billable_attempt_count), 0)::bigint,
        coalesce(sum(fallback_request_count), 0)::bigint,
        coalesce(sum(latency_count), 0)::bigint,
        coalesce(sum(latency_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('latency_histogram'))},
        coalesce(sum(gateway_internal_latency_count), 0)::bigint,
        coalesce(sum(gateway_internal_latency_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('gateway_internal_latency_histogram'))},
        coalesce(sum(provider_latency_count), 0)::bigint,
        coalesce(sum(provider_latency_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('provider_latency_histogram'))},
        coalesce(sum(stream_request_count), 0)::bigint,
        coalesce(sum(ttft_count), 0)::bigint,
        coalesce(sum(ttft_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('ttft_histogram'))},
        ${DASHBOARD_HISTOGRAM_VERSION}, max(source_max_at), now(), now()
      FROM dashboard_rollup_totals
      WHERE tenant_id = ${bucket.tenant_id}::uuid
        AND surface = ${bucket.surface}
        AND grain = ${childGrain}
        AND bucket_start >= ${bucket.bucket_start}
        AND bucket_start < ${bucketEnd}
        AND histogram_version = ${DASHBOARD_HISTOGRAM_VERSION}
      GROUP BY
        tenant_id, surface, project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by
    `);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO dashboard_rollup_dimensions (
        tenant_id, surface, grain, bucket_start,
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3,
        request_count, successful_request_count, failed_request_count,
        cache_hit_request_count, cache_eligible_request_count,
        fallback_success_request_count,
        prompt_tokens, completion_tokens, total_tokens,
        cost_micro_usd, saved_cost_micro_usd,
        attempt_count, billable_attempt_count, fallback_request_count,
        latency_count, latency_sum_ms, latency_histogram,
        gateway_internal_latency_count, gateway_internal_latency_sum_ms,
        gateway_internal_latency_histogram,
        provider_latency_count, provider_latency_sum_ms, provider_latency_histogram,
        stream_request_count, ttft_count, ttft_sum_ms, ttft_histogram,
        histogram_version, source_max_at, created_at, updated_at
      )
      SELECT
        tenant_id, surface, ${bucket.grain}, ${bucket.bucket_start},
        project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3,
        coalesce(sum(request_count), 0)::bigint,
        coalesce(sum(successful_request_count), 0)::bigint,
        coalesce(sum(failed_request_count), 0)::bigint,
        coalesce(sum(cache_hit_request_count), 0)::bigint,
        coalesce(sum(cache_eligible_request_count), 0)::bigint,
        coalesce(sum(fallback_success_request_count), 0)::bigint,
        coalesce(sum(prompt_tokens), 0)::bigint,
        coalesce(sum(completion_tokens), 0)::bigint,
        coalesce(sum(total_tokens), 0)::bigint,
        coalesce(sum(cost_micro_usd), 0)::bigint,
        coalesce(sum(saved_cost_micro_usd), 0)::bigint,
        coalesce(sum(attempt_count), 0)::bigint,
        coalesce(sum(billable_attempt_count), 0)::bigint,
        coalesce(sum(fallback_request_count), 0)::bigint,
        coalesce(sum(latency_count), 0)::bigint,
        coalesce(sum(latency_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('latency_histogram'))},
        coalesce(sum(gateway_internal_latency_count), 0)::bigint,
        coalesce(sum(gateway_internal_latency_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('gateway_internal_latency_histogram'))},
        coalesce(sum(provider_latency_count), 0)::bigint,
        coalesce(sum(provider_latency_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('provider_latency_histogram'))},
        coalesce(sum(stream_request_count), 0)::bigint,
        coalesce(sum(ttft_count), 0)::bigint,
        coalesce(sum(ttft_sum_ms), 0)::bigint,
        ${Prisma.raw(histogramSumSQL('ttft_histogram'))},
        ${DASHBOARD_HISTOGRAM_VERSION}, max(source_max_at), now(), now()
      FROM dashboard_rollup_dimensions
      WHERE tenant_id = ${bucket.tenant_id}::uuid
        AND surface = ${bucket.surface}
        AND grain = ${childGrain}
        AND bucket_start >= ${bucket.bucket_start}
        AND bucket_start < ${bucketEnd}
        AND histogram_version = ${DASHBOARD_HISTOGRAM_VERSION}
      GROUP BY
        tenant_id, surface, project_id, application_id,
        budget_scope_type, budget_scope_id, budget_scope_resolved_by,
        dimension_type, dimension_value, dimension_value_2, dimension_value_3
    `);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO employee_usage_rollups (
        tenant_id, employee_id, surface, grain, bucket_start, project_id,
        request_count, input_tokens, output_tokens, total_tokens,
        cost_micro_usd, source_max_at, created_at, updated_at
      )
      SELECT
        tenant_id,
        employee_id,
        surface,
        ${bucket.grain},
        ${bucket.bucket_start},
        project_id,
        coalesce(sum(request_count), 0)::bigint,
        coalesce(sum(input_tokens), 0)::bigint,
        coalesce(sum(output_tokens), 0)::bigint,
        coalesce(sum(total_tokens), 0)::bigint,
        coalesce(sum(cost_micro_usd), 0)::bigint,
        max(source_max_at),
        now(),
        now()
      FROM employee_usage_rollups
      WHERE tenant_id = ${bucket.tenant_id}::uuid
        AND surface = ${bucket.surface}
        AND grain = ${childGrain}
        AND bucket_start >= ${bucket.bucket_start}
        AND bucket_start < ${bucketEnd}
      GROUP BY tenant_id, employee_id, surface, project_id
    `);
  }
}

export async function enqueueDashboardRollupDirtyBucket(
  tx: Pick<RollupTransaction, '$executeRaw'>,
  input: {
    tenantId: string;
    surface: DashboardRollupSurface;
    grain: DashboardRollupGrain;
    bucketStart: Date;
    reasonCode: 'SOURCE_DISCOVERED' | 'PROJECTION_CHANGED' | 'CHILD_REBUILT';
  },
): Promise<void> {
  const bucketStart = utcBucketStart(input.bucketStart, input.grain);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO dashboard_rollup_dirty_buckets (
      tenant_id, surface, grain, bucket_start, reason_code,
      available_at, attempts, created_at, updated_at
    ) VALUES (
      ${input.tenantId}::uuid, ${input.surface}, ${input.grain},
      ${bucketStart}, ${input.reasonCode}, now(), 0, now(), now()
    )
    ON CONFLICT (tenant_id, surface, grain, bucket_start)
    DO UPDATE SET
      reason_code = EXCLUDED.reason_code,
      available_at = least(dashboard_rollup_dirty_buckets.available_at, now()),
      updated_at = now()
  `);
}

export async function enqueueDashboardRollupDirtyHierarchy(
  tx: Pick<RollupTransaction, '$executeRaw'>,
  input: {
    tenantId: string;
    surface: DashboardRollupSurface;
    occurredAt: Date;
    reasonCode: 'SOURCE_DISCOVERED' | 'PROJECTION_CHANGED';
  },
): Promise<void> {
  for (const grain of ['hour', 'day', 'month'] as const) {
    await enqueueDashboardRollupDirtyBucket(tx, {
      tenantId: input.tenantId,
      surface: input.surface,
      grain,
      bucketStart: input.occurredAt,
      reasonCode: input.reasonCode,
    });
  }
}

export function utcBucketStart(
  value: Date,
  grain: DashboardRollupGrain,
): Date {
  const result = new Date(value.getTime());
  if (grain === 'month') {
    return new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), 1));
  }
  result.setUTCMinutes(0, 0, 0);
  if (grain === 'day') {
    result.setUTCHours(0, 0, 0, 0);
  }
  return result;
}

export function utcBucketEnd(
  bucketStart: Date,
  grain: DashboardRollupGrain,
): Date {
  const start = utcBucketStart(bucketStart, grain);
  if (grain === 'hour') {
    return new Date(start.getTime() + 60 * 60 * 1_000);
  }
  if (grain === 'day') {
    return new Date(start.getTime() + 24 * 60 * 60 * 1_000);
  }
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export function dashboardHistogramPercentileUpperBound(
  histogram: readonly (number | bigint)[],
  percentile: number,
): number | null {
  const counts = histogram.map((value) => Number(value));
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || percentile <= 0 || percentile > 1) {
    return null;
  }
  const target = Math.ceil(total * percentile);
  let cumulative = 0;
  for (let index = 0; index < counts.length; index += 1) {
    cumulative += counts[index] ?? 0;
    if (cumulative >= target) {
      return DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS[index] ?? 60_000;
    }
  }
  return 60_000;
}

function parentGrainFor(
  grain: DashboardRollupGrain,
): DashboardRollupGrain | null {
  if (grain === 'hour') {
    return 'day';
  }
  if (grain === 'day') {
    return 'month';
  }
  return null;
}

function uniqueDirtyHours(
  values: Array<{ tenantId: string; occurredAt: Date }>,
): Array<{ tenantId: string; bucketStart: Date }> {
  const unique = new Map<string, { tenantId: string; bucketStart: Date }>();
  for (const value of values) {
    const bucketStart = utcBucketStart(value.occurredAt, 'hour');
    unique.set(`${value.tenantId}:${bucketStart.toISOString()}`, {
      tenantId: value.tenantId,
      bucketStart,
    });
  }
  return [...unique.values()];
}

function histogramAggregateSQL(valueSQL: string, eligibleSQL: string): string {
  const buckets = DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS.map((upper, index) => {
    const lower = index === 0 ? '' : `${valueSQL} > ${DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS[index - 1]} AND `;
    return `count(*) FILTER (WHERE ${eligibleSQL} AND ${lower}${valueSQL} <= ${upper})::bigint`;
  });
  buckets.push(
    `count(*) FILTER (WHERE ${eligibleSQL} AND ${valueSQL} > ${DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS.at(-1)})::bigint`,
  );
  return `ARRAY[${buckets.join(', ')}]::bigint[]`;
}

function histogramSumSQL(column: string): string {
  const values = Array.from(
    { length: DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS.length + 1 },
    (_, index) => `coalesce(sum(${column}[${index + 1}]), 0)::bigint`,
  );
  return `ARRAY[${values.join(', ')}]::bigint[]`;
}

function zeroHistogramSQL(): string {
  return `ARRAY[${Array.from(
    { length: DASHBOARD_HISTOGRAM_UPPER_BOUNDS_MS.length + 1 },
    () => '0',
  ).join(',')}]::bigint[]`;
}

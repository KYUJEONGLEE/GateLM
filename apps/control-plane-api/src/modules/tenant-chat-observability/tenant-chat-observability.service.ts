import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, TenantChatInvocationLog } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ListTenantChatInvocationsQueryDto,
  TenantChatCostSeriesQueryDto,
  TenantChatDashboardQueryDto,
} from './dto/tenant-chat-observability.dto';
import { TenantChatInvocationResponse } from './tenant-chat-observability.types';

@Injectable()
export class TenantChatObservabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async listInvocations(
    tenantId: string,
    query: ListTenantChatInvocationsQueryDto,
  ): Promise<ListEnvelope<TenantChatInvocationResponse>> {
    const limit = query.limit ?? 50;
    const where: Prisma.TenantChatInvocationLogWhereInput = {
      tenantId,
      surface: 'tenant_chat',
      executionScopeKind: 'tenant_chat',
      ...(query.from || query.to
        ? {
            completedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.status ? { terminalOutcome: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.providerId ? { effectiveProviderId: query.providerId } : {}),
      ...(query.modelKey ? { effectiveModelKey: query.modelKey } : {}),
    };
    const rows = await this.prisma.tenantChatInvocationLog.findMany({
      where,
      orderBy: [{ completedAt: 'desc' }, { requestId: 'desc' }],
      take: limit + 1,
      ...(query.cursor
        ? { cursor: { requestId: query.cursor }, skip: 1 }
        : {}),
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      data: page.map(toInvocationResponse),
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]?.requestId ?? null : null,
      },
    };
  }

  async getInvocation(
    tenantId: string,
    requestId: string,
  ): Promise<TenantChatInvocationResponse> {
    const row = await this.prisma.tenantChatInvocationLog.findFirst({
      where: {
        requestId,
        tenantId,
        surface: 'tenant_chat',
        executionScopeKind: 'tenant_chat',
      },
    });
    if (!row) {
      throw new NotFoundException('Tenant Chat invocation was not found.');
    }
    return toInvocationResponse(row);
  }

  async getCostSeries(tenantId: string, query: TenantChatCostSeriesQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const interval = costSeriesInterval(query.bucket);
    const rows = await this.prisma.$queryRaw<
      Array<{
        period_start: Date;
        request_count: bigint;
        total_tokens: bigint;
        confirmed_cost_micro_usd: bigint;
      }>
    >(Prisma.sql`
      SELECT
        date_bin(${interval}::interval, completed_at, ${from}) AS period_start,
        count(*)::bigint AS request_count,
        coalesce(sum(confirmed_total_tokens), 0)::bigint AS total_tokens,
        coalesce(sum(confirmed_cost_micro_usd), 0)::bigint
          AS confirmed_cost_micro_usd
      FROM tenant_chat_invocation_logs
      WHERE tenant_id = ${tenantId}::uuid
        AND surface = 'tenant_chat'
        AND execution_scope_kind = 'tenant_chat'
        AND completed_at >= ${from}
        AND completed_at < ${to}
      GROUP BY period_start
      ORDER BY period_start
    `);
    return {
      data: {
        surface: 'tenant_chat' as const,
        from: from.toISOString(),
        to: to.toISOString(),
        bucket: query.bucket,
        generatedAt: new Date().toISOString(),
        points: rows.map((row) => ({
          periodStart: row.period_start.toISOString(),
          requestCount: Number(row.request_count),
          totalTokens: Number(row.total_tokens),
          confirmedCostMicroUsd: Number(row.confirmed_cost_micro_usd),
        })),
      },
    };
  }

  async getDashboard(tenantId: string, query: TenantChatDashboardQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const [
      aggregate,
      policyStates,
      attemptAggregate,
      unconfirmedAggregate,
      provenance,
      breakdowns,
      securityDetectorTypes,
      securityCoverage,
      pendingOutbox,
      activeSnapshot,
    ] =
      await Promise.all([
        this.prisma.$queryRaw<Array<Record<string, bigint | Date | null>>>(Prisma.sql`
          SELECT
            count(*)::bigint AS total,
            count(DISTINCT user_id)::bigint AS active_users,
            count(*) FILTER (WHERE terminal_outcome IN ('succeeded', 'cache_hit'))::bigint AS succeeded,
            count(*) FILTER (WHERE terminal_outcome IN ('failed', 'provider_failed', 'provider_timeout', 'runtime_unavailable', 'no_eligible_route'))::bigint AS failed,
            count(*) FILTER (WHERE terminal_outcome = 'cancelled')::bigint AS cancelled,
            count(*) FILTER (
              WHERE cache_outcome = 'hit' OR terminal_outcome = 'cache_hit'
            )::bigint AS cache_hits,
            count(*) FILTER (WHERE cache_outcome = 'miss')::bigint AS cache_misses,
            count(*) FILTER (WHERE cache_outcome = 'off')::bigint AS cache_off,
            count(*) FILTER (WHERE terminal_outcome = 'rate_limited')::bigint AS rate_limited,
            count(*) FILTER (WHERE terminal_outcome = 'concurrency_limited')::bigint AS concurrency_limited,
            count(*) FILTER (WHERE terminal_outcome = 'safety_blocked')::bigint AS safety_blocked,
            count(*) FILTER (WHERE masking_action = 'redacted')::bigint AS security_redacted,
            count(*) FILTER (
              WHERE masking_action = 'blocked' OR terminal_outcome = 'safety_blocked'
            )::bigint AS security_blocked,
            count(*) FILTER (WHERE terminal_outcome = 'quota_blocked')::bigint AS quota_blocked,
            count(*) FILTER (WHERE terminal_outcome = 'budget_blocked')::bigint AS budget_blocked,
            coalesce(sum(attempt_count), 0)::bigint AS provider_attempts,
            coalesce(sum(confirmed_input_tokens), 0)::bigint AS confirmed_input_tokens,
            coalesce(sum(confirmed_output_tokens), 0)::bigint AS confirmed_output_tokens,
            coalesce(sum(confirmed_total_tokens), 0)::bigint AS confirmed_total_tokens,
            coalesce(sum(confirmed_cost_micro_usd), 0)::bigint AS confirmed_cost_micro_usd,
            coalesce(avg(latency_ms), 0)::bigint AS average_ms,
            coalesce(percentile_disc(0.50) WITHIN GROUP (ORDER BY latency_ms), 0)::bigint AS p50_ms,
            coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::bigint AS p95_ms,
            coalesce(percentile_disc(0.99) WITHIN GROUP (ORDER BY latency_ms), 0)::bigint AS p99_ms,
            max(updated_at) AS projected_at
          FROM tenant_chat_invocation_logs
          WHERE tenant_id = ${tenantId}::uuid
            AND surface = 'tenant_chat'
            AND execution_scope_kind = 'tenant_chat'
            AND completed_at >= ${from}
            AND completed_at < ${to}
        `),
        this.prisma.tenantChatInvocationLog.groupBy({
          by: ['quotaState', 'budgetState'],
          where: {
            tenantId,
            surface: 'tenant_chat',
            executionScopeKind: 'tenant_chat',
            completedAt: { gte: from, lt: to },
          },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<Array<Record<string, bigint | null>>>(Prisma.sql`
          SELECT
            count(*)::bigint AS provider_attempts,
            count(*) FILTER (WHERE usage_quality = 'confirmed')::bigint AS billable_attempts,
            count(DISTINCT request_id) FILTER (WHERE kind = 'fallback')::bigint AS fallback_requests,
            count(DISTINCT request_id) FILTER (
              WHERE kind = 'fallback' AND outcome = 'succeeded'
            )::bigint AS fallback_succeeded,
            coalesce(
              percentile_disc(0.95) WITHIN GROUP (
                ORDER BY extract(epoch FROM (completed_at - started_at)) * 1000
              ) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL),
              0
            )::bigint AS provider_p95_ms
          FROM tenant_chat_provider_attempts
          WHERE tenant_id = ${tenantId}::uuid
            AND completed_at >= ${from}
            AND completed_at < ${to}
        `),
        this.prisma.$queryRaw<Array<Record<string, bigint | null>>>(Prisma.sql`
          SELECT
            count(*) FILTER (
              WHERE state = 'pending_unconfirmed' OR unconfirmed_tokens > 0
                OR unconfirmed_exposure_micro_usd > 0
            )::bigint AS unconfirmed_incident_count,
            coalesce(sum(unconfirmed_exposure_micro_usd), 0)::bigint AS unconfirmed_exposure_micro_usd
          FROM tenant_chat_usage_reservations
          WHERE tenant_id = ${tenantId}::uuid
            AND created_at >= ${from}
            AND created_at < ${to}
        `),
        this.prisma.$queryRaw<
          Array<{
            snapshot_version: bigint;
            pricing_version: bigint;
            request_count: bigint;
            confirmed_cost_micro_usd: bigint;
          }>
        >(Prisma.sql`
          SELECT
            snapshot_version,
            pricing_version,
            count(*)::bigint AS request_count,
            coalesce(sum(confirmed_cost_micro_usd), 0)::bigint AS confirmed_cost_micro_usd
          FROM tenant_chat_invocation_logs
          WHERE tenant_id = ${tenantId}::uuid
            AND surface = 'tenant_chat'
            AND execution_scope_kind = 'tenant_chat'
            AND completed_at >= ${from}
            AND completed_at < ${to}
          GROUP BY snapshot_version, pricing_version
          ORDER BY snapshot_version, pricing_version
          LIMIT 100
        `),
        this.prisma.$queryRaw<
          Array<{
            provider_id: string;
            model_key: string;
            route_tier: string;
            request_count: bigint;
            attempt_count: bigint;
            billable_attempt_count: bigint;
            fallback_success_count: bigint;
            confirmed_cost_micro_usd: bigint;
          }>
        >(Prisma.sql`
          WITH grouped_attempts AS (
            SELECT
              attempts.provider_id,
              attempts.model_key,
              reservations.snapshot_version,
              count(DISTINCT attempts.request_id)::bigint AS request_count,
              count(*)::bigint AS attempt_count,
              count(*) FILTER (
                WHERE attempts.usage_quality = 'confirmed'
              )::bigint AS billable_attempt_count,
              count(*) FILTER (
                WHERE attempts.kind = 'fallback' AND attempts.outcome = 'succeeded'
              )::bigint AS fallback_success_count,
              coalesce(sum(attempts.confirmed_cost_micro_usd), 0)::bigint
                AS confirmed_cost_micro_usd
            FROM tenant_chat_provider_attempts attempts
            JOIN tenant_chat_usage_reservations reservations
              ON reservations.reservation_id = attempts.reservation_id
             AND reservations.request_id = attempts.request_id
             AND reservations.tenant_id = attempts.tenant_id
            WHERE attempts.tenant_id = ${tenantId}::uuid
              AND attempts.completed_at >= ${from}
              AND attempts.completed_at < ${to}
            GROUP BY
              attempts.provider_id,
              attempts.model_key,
              reservations.snapshot_version
          )
          SELECT
            grouped.provider_id,
            grouped.model_key,
            coalesce(route.route_tier, 'standard') AS route_tier,
            sum(grouped.request_count)::bigint AS request_count,
            sum(grouped.attempt_count)::bigint AS attempt_count,
            sum(grouped.billable_attempt_count)::bigint AS billable_attempt_count,
            sum(grouped.fallback_success_count)::bigint AS fallback_success_count,
            sum(grouped.confirmed_cost_micro_usd)::bigint AS confirmed_cost_micro_usd
          FROM grouped_attempts grouped
          JOIN tenant_chat_runtime_snapshots snapshots
            ON snapshots.tenant_id = ${tenantId}::uuid
           AND snapshots.version = grouped.snapshot_version
          LEFT JOIN LATERAL (
            SELECT candidate->>'tier' AS route_tier
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(
                  snapshots.snapshot_body #> '{policies,routing,routes}'
                ) = 'array'
                  THEN snapshots.snapshot_body #> '{policies,routing,routes}'
                ELSE '[]'::jsonb
              END
            ) candidate
            WHERE candidate->>'providerId' = grouped.provider_id
              AND candidate->>'modelKey' = grouped.model_key
            LIMIT 1
          ) route ON true
          GROUP BY grouped.provider_id, grouped.model_key, route.route_tier
          ORDER BY confirmed_cost_micro_usd DESC, grouped.provider_id, grouped.model_key
          LIMIT 100
        `),
        this.prisma.$queryRaw<
          Array<{ detector_type: string; request_count: bigint }>
        >(Prisma.sql`
          SELECT detected.detector_type, count(DISTINCT logs.request_id)::bigint AS request_count
          FROM tenant_chat_invocation_logs logs
          CROSS JOIN LATERAL jsonb_array_elements_text(logs.masking_detected_types) detected(detector_type)
          WHERE logs.tenant_id = ${tenantId}::uuid
            AND logs.surface = 'tenant_chat'
            AND logs.execution_scope_kind = 'tenant_chat'
            AND logs.completed_at >= ${from}
            AND logs.completed_at < ${to}
            AND logs.safety_policy_digest IS NOT NULL
            AND jsonb_typeof(logs.masking_detected_types) = 'array'
          GROUP BY detected.detector_type
          ORDER BY request_count DESC, detected.detector_type
          LIMIT 32
        `),
        this.prisma.$queryRaw<Array<{ observed_from: Date | null }>>(Prisma.sql`
          SELECT min(completed_at) AS observed_from
          FROM tenant_chat_invocation_logs
          WHERE tenant_id = ${tenantId}::uuid
            AND surface = 'tenant_chat'
            AND execution_scope_kind = 'tenant_chat'
            AND completed_at < ${to}
            AND safety_policy_digest IS NOT NULL
        `),
        this.prisma.tenantChatInvocationOutbox.count({
          where: { tenantId, publishedAt: null },
        }),
        this.prisma.tenantChatActiveRuntimeSnapshot.findUnique({
          where: { tenantId },
          select: {
            snapshot: {
              select: { version: true, pricingVersion: true },
            },
          },
        }),
      ]);
    const row = aggregate[0] ?? {};
    const attemptRow = attemptAggregate[0] ?? {};
    const unconfirmedRow = unconfirmedAggregate[0] ?? {};
    const projectedAt = row.projected_at instanceof Date ? row.projected_at : null;
    const securityObservedFrom = securityCoverage[0]?.observed_from ?? null;
    const securityRedacted = numberFrom(row.security_redacted);
    const securityBlocked = numberFrom(row.security_blocked);
    const cacheHits = numberFrom(row.cache_hits);
    const cacheMisses = numberFrom(row.cache_misses);
    const cacheOff = numberFrom(row.cache_off);
    const cacheEligible = cacheHits + cacheMisses;
    const lagSeconds = projectedAt
      ? Math.max(0, Math.floor((Date.now() - projectedAt.getTime()) / 1000))
      : 0;
    if (provenance.length === 0 && !activeSnapshot) {
      throw new ServiceUnavailableException(
        'Tenant Chat runtime provenance is unavailable.',
      );
    }
    const fallbackProvenance = activeSnapshot
      ? {
          snapshotVersion: Number(activeSnapshot.snapshot.version),
          pricingVersion: Number(activeSnapshot.snapshot.pricingVersion),
          requestCount: 0,
          confirmedCostMicroUsd: 0,
        }
      : null;
    const provenanceResponse =
      provenance.length > 0
        ? provenance.map((item) => ({
            snapshotVersion: Number(item.snapshot_version),
            pricingVersion: Number(item.pricing_version),
            requestCount: Number(item.request_count),
            confirmedCostMicroUsd: Number(item.confirmed_cost_micro_usd),
          }))
        : fallbackProvenance
          ? [fallbackProvenance]
          : [];
    return {
      data: {
        surface: 'tenant_chat' as const,
        from: from.toISOString(),
        to: to.toISOString(),
        freshness: {
          projectedAt: (projectedAt ?? new Date(0)).toISOString(),
          lagSeconds,
          state: pendingOutbox > 0 ? 'partial' : lagSeconds > 30 ? 'stale' : 'fresh',
        },
        requests: {
          total: numberFrom(row.total),
          activeUsers: numberFrom(row.active_users),
          succeeded: numberFrom(row.succeeded),
          failed: numberFrom(row.failed),
          cancelled: numberFrom(row.cancelled),
          cacheHits,
          cacheMisses,
          cacheOff,
          cacheEligible,
          cacheHitRate: cacheEligible > 0 ? cacheHits / cacheEligible : 0,
          rateLimited: numberFrom(row.rate_limited),
          concurrencyLimited: numberFrom(row.concurrency_limited),
          safetyBlocked: numberFrom(row.safety_blocked),
          quotaBlocked: numberFrom(row.quota_blocked),
          budgetBlocked: numberFrom(row.budget_blocked),
          fallbackRequests: numberFrom(attemptRow.fallback_requests),
          fallbackSucceeded: numberFrom(attemptRow.fallback_succeeded),
          providerAttempts: numberFrom(attemptRow.provider_attempts),
          billableAttempts: numberFrom(attemptRow.billable_attempts),
        },
        usage: {
          confirmedInputTokens: numberFrom(row.confirmed_input_tokens),
          confirmedOutputTokens: numberFrom(row.confirmed_output_tokens),
          confirmedTotalTokens: numberFrom(row.confirmed_total_tokens),
          confirmedCostMicroUsd: numberFrom(row.confirmed_cost_micro_usd),
          unconfirmedIncidentCount: numberFrom(
            unconfirmedRow.unconfirmed_incident_count,
          ),
          unconfirmedExposureMicroUsd: numberFrom(
            unconfirmedRow.unconfirmed_exposure_micro_usd,
          ),
        },
        policyStates: buildPolicyStates(policyStates),
        latency: {
          averageMs: numberFrom(row.average_ms),
          p50Ms: numberFrom(row.p50_ms),
          p95Ms: numberFrom(row.p95_ms),
          p99Ms: numberFrom(row.p99_ms),
          providerP95Ms: numberFrom(attemptRow.provider_p95_ms),
        },
        provenance: provenanceResponse,
        breakdowns: breakdowns.map((item) => ({
          providerId: item.provider_id,
          modelKey: item.model_key,
          routeTier: item.route_tier,
          requestCount: Number(item.request_count),
          attemptCount: Number(item.attempt_count),
          billableAttemptCount: Number(item.billable_attempt_count),
          fallbackSuccessCount: Number(item.fallback_success_count),
          confirmedCostMicroUsd: Number(item.confirmed_cost_micro_usd),
        })),
        security: {
          protectedRequests: securityRedacted + securityBlocked,
          redactedRequests: securityRedacted,
          blockedRequests: securityBlocked,
          byDetectorType: securityDetectorTypes.map((item) => ({
            detectorType: item.detector_type,
            requestCount: Number(item.request_count),
          })),
          coverage: {
            state: !securityObservedFrom
              ? ('unavailable' as const)
              : securityObservedFrom.getTime() > from.getTime() || pendingOutbox > 0
                ? ('partial' as const)
                : ('complete' as const),
            observedFrom: securityObservedFrom?.toISOString() ?? null,
          },
        },
      },
    };
  }
}

function toInvocationResponse(
  row: TenantChatInvocationLog,
): TenantChatInvocationResponse {
  return {
    requestId: row.requestId,
    surface: 'tenant_chat',
    executionScopeKind: 'tenant_chat',
    tenantId: row.tenantId,
    userId: row.userId,
    employeeId: row.employeeId,
    actorKind: row.actorKind,
    turnId: row.turnId,
    terminalOutcome: row.terminalOutcome,
    providerId: row.effectiveProviderId,
    modelKey: row.effectiveModelKey,
    attemptCount: row.attemptCount,
    confirmedInputTokens: Number(row.confirmedInputTokens),
    confirmedOutputTokens: Number(row.confirmedOutputTokens),
    confirmedTotalTokens: Number(row.confirmedTotalTokens),
    confirmedCostMicroUsd: Number(row.confirmedCostMicroUsd),
    maskingAction:
      row.maskingAction === 'none' ||
      row.maskingAction === 'redacted' ||
      row.maskingAction === 'blocked'
        ? row.maskingAction
        : null,
    maskingDetectedTypes: jsonStringArray(row.maskingDetectedTypes),
    maskingDetectedCount: row.maskingDetectedCount ?? 0,
    quotaState: row.quotaState,
    budgetState: row.budgetState,
    cacheOutcome: row.cacheOutcome,
    latencyMs: Number(row.latencyMs),
    snapshotVersion: Number(row.snapshotVersion),
    pricingVersion: Number(row.pricingVersion),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    projectionVersion: Number(row.projectedEventVersion),
  };
}

function numberFrom(value: bigint | Date | null | undefined): number {
  return typeof value === 'bigint' ? Number(value) : 0;
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function costSeriesInterval(bucket: TenantChatCostSeriesQueryDto['bucket']): string {
  return {
    '1s': '1 second',
    '7s': '7 seconds',
    '1m': '1 minute',
    '5m': '5 minutes',
    '1h': '1 hour',
    '1d': '1 day',
  }[bucket];
}

function buildPolicyStates(
  rows: Array<{
    quotaState: string;
    budgetState: string;
    _count: { _all: number };
  }>,
) {
  const result = {
    quota: { normal: 0, warning: 0, economy: 0, blocked: 0 },
    budget: { normal: 0, warning: 0, economy: 0, blocked: 0 },
  };
  for (const row of rows) {
    if (row.quotaState in result.quota) {
      result.quota[row.quotaState as keyof typeof result.quota] += row._count._all;
    }
    if (row.budgetState in result.budget) {
      result.budget[row.budgetState as keyof typeof result.budget] += row._count._all;
    }
  }
  return result;
}

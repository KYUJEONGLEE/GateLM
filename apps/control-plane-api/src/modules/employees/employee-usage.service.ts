import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  EmployeeUsageMetric,
  EmployeeUsageMetricDto,
  EmployeeUsageOrder,
  EmployeeUsageSource,
  EmployeeUsageResponseDto,
  ListEmployeeUsageQueryDto,
} from './dto/employee-usage.dto';
import type { EmployeeStatus } from './dto/employee.dto';

const MAX_USAGE_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;

type EmployeeUsageCursor = {
  employeeId: string;
  metric: EmployeeUsageMetric;
  order: EmployeeUsageOrder;
  source?: EmployeeUsageSource;
  value: string;
  version: 1;
};

type EmployeeUsageDatabaseRow = {
  employeeId: string;
  name: string | null;
  email: string;
  department: string | null;
  status: string;
  rank: bigint;
  sortValue: bigint;
  projectRequestCount: bigint;
  projectInputTokens: bigint;
  projectOutputTokens: bigint;
  projectTotalTokens: bigint;
  projectCostMicroUsd: bigint;
  tenantChatRequestCount: bigint;
  tenantChatInputTokens: bigint;
  tenantChatOutputTokens: bigint;
  tenantChatTotalTokens: bigint;
  tenantChatCostMicroUsd: bigint;
};

type UnattributedDatabaseRow = {
  projectRequestCount: bigint;
  projectInputTokens: bigint;
  projectOutputTokens: bigint;
  projectTotalTokens: bigint;
  projectCostMicroUsd: bigint;
  tenantChatRequestCount: bigint;
  tenantChatInputTokens: bigint;
  tenantChatOutputTokens: bigint;
  tenantChatTotalTokens: bigint;
  tenantChatCostMicroUsd: bigint;
  projectSourceMaxAt: Date | null;
  tenantChatSourceMaxAt: Date | null;
};

type EmployeeUsageCoverageRow = {
  coveredBucketCount: bigint;
  hasRawUsage: boolean;
};

export type EmployeeCostTotalPeriod = {
  from: Date;
  to: Date;
};

@Injectable()
export class EmployeeUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployeeUsage(
    tenantId: string,
    query: ListEmployeeUsageQueryDto,
  ): Promise<EmployeeUsageResponseDto> {
    await this.assertTenantExists(tenantId);
    const period = this.validatePeriod(query.from, query.to);
    const metric = query.metric ?? 'tokens';
    const order = query.order ?? 'desc';
    const source = query.source;
    const limit = query.limit ?? 50;
    const cursor = query.cursor
      ? this.decodeCursor(query.cursor, metric, order, source)
      : null;

    const [coverageRows, rows, unattributedRows] = await Promise.all([
      this.queryCoverage(tenantId, period.from, period.to),
      this.queryRows(tenantId, period.from, period.to, metric, order, limit, cursor, undefined, source),
      this.queryUnattributed(tenantId, period.from, period.to),
    ]);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const unattributed = unattributedRows[0] ?? emptyUnattributedRow();
    const projectApplication = toMetric(unattributed, 'project');
    const tenantChat = toMetric(unattributed, 'tenantChat');
    const lastSourceAt = source === 'tenant_chat'
      ? unattributed.tenantChatSourceMaxAt
      : source === 'project_application'
        ? unattributed.projectSourceMaxAt
        : maxDate(unattributed.projectSourceMaxAt, unattributed.tenantChatSourceMaxAt);
    const coverage = coverageRows[0] ?? {
      coveredBucketCount: 0n,
      hasRawUsage: false,
    };

    return {
      data: page.map((row) => toResponseRow(row, source)),
      pagination: {
        hasMore,
        limit,
        nextCursor:
          hasMore && last
            ? this.encodeCursor({
                employeeId: last.employeeId,
                metric,
                order,
                source,
                value: last.sortValue.toString(),
                version: 1,
              })
            : null,
      },
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        timezone: 'UTC',
      },
      unattributed: {
        sources: { projectApplication, tenantChat },
        total: source === 'tenant_chat'
          ? tenantChat
          : source === 'project_application'
            ? projectApplication
            : addMetrics(projectApplication, tenantChat),
      },
      provenance: {
        generatedAt: new Date().toISOString(),
        lastSourceAt: lastSourceAt?.toISOString() ?? null,
        source:
          coverage.coveredBucketCount === 0n
            ? 'raw'
            : coverage.hasRawUsage
              ? 'hybrid'
              : 'rollup',
      },
    };
  }

  async readEmployeeCostTotals(
    tenantId: string,
    employeeIds: string[],
    periods: EmployeeCostTotalPeriod[],
  ): Promise<Array<Map<string, number>>> {
    await this.assertTenantExists(tenantId);
    const validatedPeriods = periods.map((period) =>
      this.validatePeriod(period.from.toISOString(), period.to.toISOString()),
    );
    if (employeeIds.length === 0) {
      return validatedPeriods.map(() => new Map<string, number>());
    }

    const rowsByPeriod = await Promise.all(
      validatedPeriods.map((period) =>
        this.queryRows(
          tenantId,
          period.from,
          period.to,
          'cost',
          'desc',
          employeeIds.length,
          null,
          employeeIds,
          'tenant_chat',
        ),
      ),
    );
    return rowsByPeriod.map(
      (rows) =>
        new Map(
          rows.map((row) => [
            row.employeeId,
            Number(row.projectCostMicroUsd + row.tenantChatCostMicroUsd),
          ]),
        ),
    );
  }

  private validatePeriod(fromValue: string, toValue: string) {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    const duration = to.getTime() - from.getTime();
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new BadRequestException('Employee usage range must satisfy from < to.');
    }
    if (duration > MAX_USAGE_RANGE_MS) {
      throw new BadRequestException('Employee usage range cannot exceed 31 days.');
    }
    return { from, to };
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }
  }

  private async queryCoverage(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<EmployeeUsageCoverageRow[]> {
    return this.prisma.$queryRaw<EmployeeUsageCoverageRow[]>(Prisma.sql`
      WITH project_covered_hours AS (
        ${employeeUsageCoveredHours(tenantId, from, to, 'project_application')}
      ), tenant_chat_covered_hours AS (
        ${employeeUsageCoveredHours(tenantId, from, to, 'tenant_chat')}
      ), raw_usage AS (
        SELECT 1
        FROM p0_llm_invocation_logs log
        WHERE log.tenant_id = ${tenantId}::uuid
          AND log.created_at >= ${from}
          AND log.created_at < ${to}
          AND NOT EXISTS (
            SELECT 1 FROM project_covered_hours covered
            WHERE covered.bucket_start = date_bin(
              interval '1 hour', log.created_at,
              timestamptz '1970-01-01 00:00:00+00'
            )
          )
        UNION ALL
        SELECT 1
        FROM tenant_chat_invocation_logs logs
        WHERE logs.tenant_id = ${tenantId}::uuid
          AND logs.surface = 'tenant_chat'
          AND logs.execution_scope_kind = 'tenant_chat'
          AND logs.completed_at >= ${from}
          AND logs.completed_at < ${to}
          AND NOT EXISTS (
            SELECT 1 FROM tenant_chat_covered_hours covered
            WHERE covered.bucket_start = date_bin(
              interval '1 hour', logs.completed_at,
              timestamptz '1970-01-01 00:00:00+00'
            )
          )
        LIMIT 1
      )
      SELECT
        (
          (SELECT count(*)::bigint FROM project_covered_hours) +
          (SELECT count(*)::bigint FROM tenant_chat_covered_hours)
        ) AS "coveredBucketCount",
        EXISTS (SELECT 1 FROM raw_usage) AS "hasRawUsage"
    `);
  }

  private async queryRows(
    tenantId: string,
    from: Date,
    to: Date,
    metric: EmployeeUsageMetric,
    order: EmployeeUsageOrder,
    limit: number,
    cursor: EmployeeUsageCursor | null,
    employeeIds?: string[],
    source?: EmployeeUsageSource,
  ): Promise<EmployeeUsageDatabaseRow[]> {
    const sortColumn = {
      cost: 'cost_micro_usd',
      requests: 'request_count',
      tokens: 'total_tokens',
    }[metric];
    const direction = order === 'asc' ? 'ASC' : 'DESC';
    const cursorOperator = order === 'asc' ? '>' : '<';
    const cursorFilter = cursor
      ? Prisma.sql`
          WHERE sort_value ${Prisma.raw(cursorOperator)} ${BigInt(cursor.value)}
             OR (sort_value = ${BigInt(cursor.value)}
                 AND employee_id::text > ${cursor.employeeId})
        `
      : Prisma.sql``;
    const employeeFilter = employeeIds
      ? Prisma.sql`
          AND employee.id IN (
            ${Prisma.join(employeeIds.map((id) => Prisma.sql`${id}::uuid`))}
          )
        `
      : Prisma.sql``;

    return this.prisma.$queryRaw<EmployeeUsageDatabaseRow[]>(Prisma.sql`
      WITH project_covered_hours AS (
        ${employeeUsageCoveredHours(tenantId, from, to, 'project_application')}
      ), tenant_chat_covered_hours AS (
        ${employeeUsageCoveredHours(tenantId, from, to, 'tenant_chat')}
      ), identity_candidates AS (
        SELECT id AS employee_id, lower(id::text) AS identity_key, 1 AS priority
        FROM employees
        WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL
        UNION ALL
        SELECT id, lower("userId"::text), 2
        FROM employees
        WHERE "tenantId" = ${tenantId}::uuid
          AND "userId" IS NOT NULL
          AND "deletedAt" IS NULL
        UNION ALL
        SELECT id, lower(btrim(email)), 3
        FROM employees
        WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL
      ), candidate_groups AS (
        SELECT identity_key, priority,
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
      ), project_usage AS (
        SELECT usage.employee_id,
          coalesce(sum(usage.request_count), 0)::bigint AS request_count,
          coalesce(sum(usage.input_tokens), 0)::bigint AS input_tokens,
          coalesce(sum(usage.output_tokens), 0)::bigint AS output_tokens,
          coalesce(sum(usage.total_tokens), 0)::bigint AS total_tokens,
          coalesce(sum(usage.cost_micro_usd), 0)::bigint AS cost_micro_usd
        FROM (
          SELECT resolved.employee_id,
            1::bigint AS request_count,
            log.prompt_tokens::bigint AS input_tokens,
            log.completion_tokens::bigint AS output_tokens,
            log.total_tokens::bigint AS total_tokens,
            log.cost_micro_usd::bigint AS cost_micro_usd
          FROM p0_llm_invocation_logs log
          JOIN resolved_keys resolved
            ON resolved.identity_key = lower(btrim(log.end_user_id))
          WHERE log.tenant_id = ${tenantId}::uuid
            AND log.created_at >= ${from}
            AND log.created_at < ${to}
            AND log.end_user_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM project_covered_hours covered
              WHERE covered.bucket_start = date_bin(
                interval '1 hour', log.created_at,
                timestamptz '1970-01-01 00:00:00+00'
              )
            )
          UNION ALL
          SELECT rollup.employee_id,
            rollup.request_count,
            rollup.input_tokens,
            rollup.output_tokens,
            rollup.total_tokens,
            rollup.cost_micro_usd
          FROM employee_usage_rollups rollup
          JOIN project_covered_hours covered
            ON covered.bucket_start = rollup.bucket_start
          WHERE rollup.tenant_id = ${tenantId}::uuid
            AND rollup.surface = 'project_application'
            AND rollup.grain = 'hour'
        ) usage
        GROUP BY usage.employee_id
      ), tenant_chat_usage AS (
        SELECT usage.employee_id,
          coalesce(sum(usage.request_count), 0)::bigint AS request_count,
          coalesce(sum(usage.input_tokens), 0)::bigint AS input_tokens,
          coalesce(sum(usage.output_tokens), 0)::bigint AS output_tokens,
          coalesce(sum(usage.total_tokens), 0)::bigint AS total_tokens,
          coalesce(sum(usage.cost_micro_usd), 0)::bigint AS cost_micro_usd
        FROM (
          SELECT logs.employee_id,
            1::bigint AS request_count,
            logs.confirmed_input_tokens::bigint AS input_tokens,
            logs.confirmed_output_tokens::bigint AS output_tokens,
            logs.confirmed_total_tokens::bigint AS total_tokens,
            logs.confirmed_cost_micro_usd::bigint AS cost_micro_usd
          FROM tenant_chat_invocation_logs logs
          JOIN employees employee
            ON employee.id = logs.employee_id
           AND employee."tenantId" = logs.tenant_id
           AND employee."deletedAt" IS NULL
          WHERE logs.tenant_id = ${tenantId}::uuid
            AND logs.surface = 'tenant_chat'
            AND logs.execution_scope_kind = 'tenant_chat'
            AND logs.employee_id IS NOT NULL
            AND logs.completed_at >= ${from}
            AND logs.completed_at < ${to}
            AND NOT EXISTS (
              SELECT 1 FROM tenant_chat_covered_hours covered
              WHERE covered.bucket_start = date_bin(
                interval '1 hour', logs.completed_at,
                timestamptz '1970-01-01 00:00:00+00'
              )
            )
          UNION ALL
          SELECT rollup.employee_id,
            rollup.request_count,
            rollup.input_tokens,
            rollup.output_tokens,
            rollup.total_tokens,
            rollup.cost_micro_usd
          FROM employee_usage_rollups rollup
          JOIN tenant_chat_covered_hours covered
            ON covered.bucket_start = rollup.bucket_start
          WHERE rollup.tenant_id = ${tenantId}::uuid
            AND rollup.surface = 'tenant_chat'
            AND rollup.grain = 'hour'
        ) usage
        GROUP BY usage.employee_id
      ), employee_metrics AS (
        SELECT employee.id AS employee_id,
          employee.name,
          employee.email,
          employee.department,
          employee.status,
          (CASE WHEN ${source === 'tenant_chat'} THEN 0 ELSE coalesce(project.request_count, 0) END)::bigint AS project_request_count,
          (CASE WHEN ${source === 'tenant_chat'} THEN 0 ELSE coalesce(project.input_tokens, 0) END)::bigint AS project_input_tokens,
          (CASE WHEN ${source === 'tenant_chat'} THEN 0 ELSE coalesce(project.output_tokens, 0) END)::bigint AS project_output_tokens,
          (CASE WHEN ${source === 'tenant_chat'} THEN 0 ELSE coalesce(project.total_tokens, 0) END)::bigint AS project_total_tokens,
          (CASE WHEN ${source === 'tenant_chat'} THEN 0 ELSE coalesce(project.cost_micro_usd, 0) END)::bigint AS project_cost_micro_usd,
          (CASE WHEN ${source === 'project_application'} THEN 0 ELSE coalesce(chat.request_count, 0) END)::bigint AS tenant_chat_request_count,
          (CASE WHEN ${source === 'project_application'} THEN 0 ELSE coalesce(chat.input_tokens, 0) END)::bigint AS tenant_chat_input_tokens,
          (CASE WHEN ${source === 'project_application'} THEN 0 ELSE coalesce(chat.output_tokens, 0) END)::bigint AS tenant_chat_output_tokens,
          (CASE WHEN ${source === 'project_application'} THEN 0 ELSE coalesce(chat.total_tokens, 0) END)::bigint AS tenant_chat_total_tokens,
          (CASE WHEN ${source === 'project_application'} THEN 0 ELSE coalesce(chat.cost_micro_usd, 0) END)::bigint AS tenant_chat_cost_micro_usd,
          (CASE WHEN ${source === 'tenant_chat'} THEN coalesce(chat.request_count, 0) WHEN ${source === 'project_application'} THEN coalesce(project.request_count, 0) ELSE coalesce(project.request_count, 0) + coalesce(chat.request_count, 0) END)::bigint AS request_count,
          (CASE WHEN ${source === 'tenant_chat'} THEN coalesce(chat.total_tokens, 0) WHEN ${source === 'project_application'} THEN coalesce(project.total_tokens, 0) ELSE coalesce(project.total_tokens, 0) + coalesce(chat.total_tokens, 0) END)::bigint AS total_tokens,
          (CASE WHEN ${source === 'tenant_chat'} THEN coalesce(chat.cost_micro_usd, 0) WHEN ${source === 'project_application'} THEN coalesce(project.cost_micro_usd, 0) ELSE coalesce(project.cost_micro_usd, 0) + coalesce(chat.cost_micro_usd, 0) END)::bigint AS cost_micro_usd
        FROM employees employee
        LEFT JOIN project_usage project ON project.employee_id = employee.id
        LEFT JOIN tenant_chat_usage chat ON chat.employee_id = employee.id
        WHERE employee."tenantId" = ${tenantId}::uuid
          AND employee."deletedAt" IS NULL
          ${employeeFilter}
      ), ranked AS (
        SELECT employee_metrics.*,
          ${Prisma.raw(sortColumn)} AS sort_value,
          row_number() OVER (
            ORDER BY ${Prisma.raw(sortColumn)} ${Prisma.raw(direction)}, employee_id
          )::bigint AS rank
        FROM employee_metrics
      )
      SELECT
        employee_id::text AS "employeeId",
        name,
        email,
        department,
        status,
        rank,
        sort_value AS "sortValue",
        project_request_count AS "projectRequestCount",
        project_input_tokens AS "projectInputTokens",
        project_output_tokens AS "projectOutputTokens",
        project_total_tokens AS "projectTotalTokens",
        project_cost_micro_usd AS "projectCostMicroUsd",
        tenant_chat_request_count AS "tenantChatRequestCount",
        tenant_chat_input_tokens AS "tenantChatInputTokens",
        tenant_chat_output_tokens AS "tenantChatOutputTokens",
        tenant_chat_total_tokens AS "tenantChatTotalTokens",
        tenant_chat_cost_micro_usd AS "tenantChatCostMicroUsd"
      FROM ranked
      ${cursorFilter}
      ORDER BY sort_value ${Prisma.raw(direction)}, employee_id
      LIMIT ${limit + 1}
    `);
  }

  private async queryUnattributed(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<UnattributedDatabaseRow[]> {
    return this.prisma.$queryRaw<UnattributedDatabaseRow[]>(Prisma.sql`
      WITH project_covered_hours AS (
        ${employeeUsageCoveredHours(tenantId, from, to, 'project_application')}
      ), tenant_chat_covered_hours AS (
        ${employeeUsageCoveredHours(tenantId, from, to, 'tenant_chat')}
      ), identity_candidates AS (
        SELECT id AS employee_id, lower(id::text) AS identity_key, 1 AS priority
        FROM employees
        WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL
        UNION ALL
        SELECT id, lower("userId"::text), 2
        FROM employees
        WHERE "tenantId" = ${tenantId}::uuid
          AND "userId" IS NOT NULL
          AND "deletedAt" IS NULL
        UNION ALL
        SELECT id, lower(btrim(email)), 3
        FROM employees
        WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL
      ), candidate_groups AS (
        SELECT identity_key, priority,
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
        FROM preferred_keys WHERE candidate_count = 1
      ), project_raw_unattributed AS (
        SELECT
          count(*) FILTER (WHERE resolved.employee_id IS NULL)::bigint AS request_count,
          coalesce(sum(log.prompt_tokens) FILTER (WHERE resolved.employee_id IS NULL), 0)::bigint AS input_tokens,
          coalesce(sum(log.completion_tokens) FILTER (WHERE resolved.employee_id IS NULL), 0)::bigint AS output_tokens,
          coalesce(sum(log.total_tokens) FILTER (WHERE resolved.employee_id IS NULL), 0)::bigint AS total_tokens,
          coalesce(sum(log.cost_micro_usd) FILTER (WHERE resolved.employee_id IS NULL), 0)::bigint AS cost_micro_usd,
          max(log.ingested_at) AS source_max_at
        FROM p0_llm_invocation_logs log
        LEFT JOIN resolved_keys resolved
          ON resolved.identity_key = lower(btrim(log.end_user_id))
        WHERE log.tenant_id = ${tenantId}::uuid
          AND log.created_at >= ${from}
          AND log.created_at < ${to}
          AND NOT EXISTS (
            SELECT 1 FROM project_covered_hours covered
            WHERE covered.bucket_start = date_bin(
              interval '1 hour', log.created_at,
              timestamptz '1970-01-01 00:00:00+00'
            )
          )
      ), project_rollup_total AS (
        SELECT
          coalesce(sum(total.request_count), 0)::bigint AS request_count,
          coalesce(sum(total.prompt_tokens), 0)::bigint AS input_tokens,
          coalesce(sum(total.completion_tokens), 0)::bigint AS output_tokens,
          coalesce(sum(total.total_tokens), 0)::bigint AS total_tokens,
          coalesce(sum(total.cost_micro_usd), 0)::bigint AS cost_micro_usd,
          max(total.source_max_at) AS source_max_at
        FROM dashboard_rollup_totals total
        JOIN project_covered_hours covered
          ON covered.bucket_start = total.bucket_start
        WHERE total.tenant_id = ${tenantId}::uuid
          AND total.surface = 'project_application'
          AND total.grain = 'hour'
      ), project_rollup_attributed AS (
        SELECT
          coalesce(sum(rollup.request_count), 0)::bigint AS request_count,
          coalesce(sum(rollup.input_tokens), 0)::bigint AS input_tokens,
          coalesce(sum(rollup.output_tokens), 0)::bigint AS output_tokens,
          coalesce(sum(rollup.total_tokens), 0)::bigint AS total_tokens,
          coalesce(sum(rollup.cost_micro_usd), 0)::bigint AS cost_micro_usd
        FROM employee_usage_rollups rollup
        JOIN employees employee
          ON employee.id = rollup.employee_id
         AND employee."tenantId" = rollup.tenant_id
         AND employee."deletedAt" IS NULL
        JOIN project_covered_hours covered
          ON covered.bucket_start = rollup.bucket_start
        WHERE rollup.tenant_id = ${tenantId}::uuid
          AND rollup.surface = 'project_application'
          AND rollup.grain = 'hour'
      ), project_unattributed AS (
        SELECT
          (raw.request_count + greatest(total.request_count - attributed.request_count, 0))::bigint AS request_count,
          (raw.input_tokens + greatest(total.input_tokens - attributed.input_tokens, 0))::bigint AS input_tokens,
          (raw.output_tokens + greatest(total.output_tokens - attributed.output_tokens, 0))::bigint AS output_tokens,
          (raw.total_tokens + greatest(total.total_tokens - attributed.total_tokens, 0))::bigint AS total_tokens,
          (raw.cost_micro_usd + greatest(total.cost_micro_usd - attributed.cost_micro_usd, 0))::bigint AS cost_micro_usd,
          greatest(raw.source_max_at, total.source_max_at) AS source_max_at
        FROM project_raw_unattributed raw
        CROSS JOIN project_rollup_total total
        CROSS JOIN project_rollup_attributed attributed
      ), tenant_chat_raw_unattributed AS (
        SELECT
          count(*) FILTER (WHERE employee.id IS NULL)::bigint AS request_count,
          coalesce(sum(logs.confirmed_input_tokens) FILTER (WHERE employee.id IS NULL), 0)::bigint AS input_tokens,
          coalesce(sum(logs.confirmed_output_tokens) FILTER (WHERE employee.id IS NULL), 0)::bigint AS output_tokens,
          coalesce(sum(logs.confirmed_total_tokens) FILTER (WHERE employee.id IS NULL), 0)::bigint AS total_tokens,
          coalesce(sum(logs.confirmed_cost_micro_usd) FILTER (WHERE employee.id IS NULL), 0)::bigint AS cost_micro_usd,
          max(logs.updated_at) AS source_max_at
        FROM tenant_chat_invocation_logs logs
        LEFT JOIN employees employee
          ON employee.id = logs.employee_id
         AND employee."tenantId" = logs.tenant_id
         AND employee."deletedAt" IS NULL
        WHERE logs.tenant_id = ${tenantId}::uuid
          AND logs.surface = 'tenant_chat'
          AND logs.execution_scope_kind = 'tenant_chat'
          AND logs.completed_at >= ${from}
          AND logs.completed_at < ${to}
          AND NOT EXISTS (
            SELECT 1 FROM tenant_chat_covered_hours covered
            WHERE covered.bucket_start = date_bin(
              interval '1 hour', logs.completed_at,
              timestamptz '1970-01-01 00:00:00+00'
            )
          )
      ), tenant_chat_rollup_total AS (
        SELECT
          coalesce(sum(total.request_count), 0)::bigint AS request_count,
          coalesce(sum(total.prompt_tokens), 0)::bigint AS input_tokens,
          coalesce(sum(total.completion_tokens), 0)::bigint AS output_tokens,
          coalesce(sum(total.total_tokens), 0)::bigint AS total_tokens,
          coalesce(sum(total.cost_micro_usd), 0)::bigint AS cost_micro_usd,
          max(total.source_max_at) AS source_max_at
        FROM dashboard_rollup_totals total
        JOIN tenant_chat_covered_hours covered
          ON covered.bucket_start = total.bucket_start
        WHERE total.tenant_id = ${tenantId}::uuid
          AND total.surface = 'tenant_chat'
          AND total.grain = 'hour'
      ), tenant_chat_rollup_attributed AS (
        SELECT
          coalesce(sum(rollup.request_count), 0)::bigint AS request_count,
          coalesce(sum(rollup.input_tokens), 0)::bigint AS input_tokens,
          coalesce(sum(rollup.output_tokens), 0)::bigint AS output_tokens,
          coalesce(sum(rollup.total_tokens), 0)::bigint AS total_tokens,
          coalesce(sum(rollup.cost_micro_usd), 0)::bigint AS cost_micro_usd
        FROM employee_usage_rollups rollup
        JOIN employees employee
          ON employee.id = rollup.employee_id
         AND employee."tenantId" = rollup.tenant_id
         AND employee."deletedAt" IS NULL
        JOIN tenant_chat_covered_hours covered
          ON covered.bucket_start = rollup.bucket_start
        WHERE rollup.tenant_id = ${tenantId}::uuid
          AND rollup.surface = 'tenant_chat'
          AND rollup.grain = 'hour'
      ), tenant_chat_unattributed AS (
        SELECT
          (raw.request_count + greatest(total.request_count - attributed.request_count, 0))::bigint AS request_count,
          (raw.input_tokens + greatest(total.input_tokens - attributed.input_tokens, 0))::bigint AS input_tokens,
          (raw.output_tokens + greatest(total.output_tokens - attributed.output_tokens, 0))::bigint AS output_tokens,
          (raw.total_tokens + greatest(total.total_tokens - attributed.total_tokens, 0))::bigint AS total_tokens,
          (raw.cost_micro_usd + greatest(total.cost_micro_usd - attributed.cost_micro_usd, 0))::bigint AS cost_micro_usd,
          greatest(raw.source_max_at, total.source_max_at) AS source_max_at
        FROM tenant_chat_raw_unattributed raw
        CROSS JOIN tenant_chat_rollup_total total
        CROSS JOIN tenant_chat_rollup_attributed attributed
      )
      SELECT
        project.request_count AS "projectRequestCount",
        project.input_tokens AS "projectInputTokens",
        project.output_tokens AS "projectOutputTokens",
        project.total_tokens AS "projectTotalTokens",
        project.cost_micro_usd AS "projectCostMicroUsd",
        chat.request_count AS "tenantChatRequestCount",
        chat.input_tokens AS "tenantChatInputTokens",
        chat.output_tokens AS "tenantChatOutputTokens",
        chat.total_tokens AS "tenantChatTotalTokens",
        chat.cost_micro_usd AS "tenantChatCostMicroUsd",
        project.source_max_at AS "projectSourceMaxAt",
        chat.source_max_at AS "tenantChatSourceMaxAt"
      FROM project_unattributed project
      CROSS JOIN tenant_chat_unattributed chat
    `);
  }

  private encodeCursor(cursor: EmployeeUsageCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(
    value: string,
    metric: EmployeeUsageMetric,
    order: EmployeeUsageOrder,
    source: EmployeeUsageSource | undefined,
  ): EmployeeUsageCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as Partial<EmployeeUsageCursor>;
      if (
        parsed.version !== 1 ||
        parsed.metric !== metric ||
        parsed.order !== order ||
        parsed.source !== source ||
        typeof parsed.employeeId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.employeeId,
        ) ||
        typeof parsed.value !== 'string' ||
        !/^\d+$/.test(parsed.value)
      ) {
        throw new Error('invalid cursor');
      }
      return parsed as EmployeeUsageCursor;
    } catch {
      throw new BadRequestException('Employee usage cursor is invalid.');
    }
  }
}

function toResponseRow(row: EmployeeUsageDatabaseRow, source?: EmployeeUsageSource) {
  const projectApplication = toMetric(row, 'project');
  const tenantChat = toMetric(row, 'tenantChat');
  return {
    department: row.department,
    email: row.email,
    employeeId: row.employeeId,
    name: row.name,
    rank: Number(row.rank),
    sources: { projectApplication, tenantChat },
    status: normalizeEmployeeStatus(row.status),
    total: source === 'tenant_chat'
      ? tenantChat
      : source === 'project_application'
        ? projectApplication
        : addMetrics(projectApplication, tenantChat),
  };
}

function toMetric(
  row: EmployeeUsageDatabaseRow | UnattributedDatabaseRow,
  prefix: 'project' | 'tenantChat',
): EmployeeUsageMetricDto {
  return {
    costMicroUsd: Number(row[`${prefix}CostMicroUsd`]),
    inputTokens: Number(row[`${prefix}InputTokens`]),
    outputTokens: Number(row[`${prefix}OutputTokens`]),
    requestCount: Number(row[`${prefix}RequestCount`]),
    totalTokens: Number(row[`${prefix}TotalTokens`]),
  };
}

function addMetrics(
  left: EmployeeUsageMetricDto,
  right: EmployeeUsageMetricDto,
): EmployeeUsageMetricDto {
  return {
    costMicroUsd: left.costMicroUsd + right.costMicroUsd,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    requestCount: left.requestCount + right.requestCount,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function emptyUnattributedRow(): UnattributedDatabaseRow {
  return {
    projectCostMicroUsd: 0n,
    projectInputTokens: 0n,
    projectOutputTokens: 0n,
    projectRequestCount: 0n,
    projectSourceMaxAt: null,
    projectTotalTokens: 0n,
    tenantChatCostMicroUsd: 0n,
    tenantChatInputTokens: 0n,
    tenantChatOutputTokens: 0n,
    tenantChatRequestCount: 0n,
    tenantChatSourceMaxAt: null,
    tenantChatTotalTokens: 0n,
  };
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function employeeUsageCoveredHours(
  tenantId: string,
  from: Date,
  to: Date,
  surface: 'project_application' | 'tenant_chat',
): Prisma.Sql {
  const hasLateSource =
    surface === 'project_application'
      ? Prisma.sql`
          EXISTS (
            SELECT 1
            FROM p0_llm_invocation_logs log
            WHERE log.tenant_id = state.tenant_id
              AND log.created_at >= state.bucket_start
              AND log.created_at < state.bucket_start + interval '1 hour'
              AND log.ingested_at > state.aggregated_at
          )
        `
      : Prisma.sql`
          EXISTS (
            SELECT 1
            FROM tenant_chat_invocation_logs logs
            WHERE logs.tenant_id = state.tenant_id
              AND logs.surface = 'tenant_chat'
              AND logs.execution_scope_kind = 'tenant_chat'
              AND logs.completed_at >= state.bucket_start
              AND logs.completed_at < state.bucket_start + interval '1 hour'
              AND logs.updated_at > state.aggregated_at
          )
        `;
  return Prisma.sql`
    SELECT state.bucket_start
    FROM dashboard_rollup_bucket_states state
    WHERE state.tenant_id = ${tenantId}::uuid
      AND state.surface = ${surface}
      AND state.grain = 'hour'
      AND state.bucket_start >= ${from}
      AND state.bucket_start + interval '1 hour' <= ${to}
      AND state.state = 'ready'
      AND state.employee_usage_ready = true
      AND state.aggregated_at IS NOT NULL
      AND NOT (${hasLateSource})
  `;
}

function normalizeEmployeeStatus(value: string): EmployeeStatus {
  if (
    value === 'active' ||
    value === 'archived' ||
    value === 'staged' ||
    value === 'suspended'
  ) {
    return value;
  }
  return 'staged';
}

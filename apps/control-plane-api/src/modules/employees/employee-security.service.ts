import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import type {
  EmployeeSecurityMetricDto,
  EmployeeSecurityResponseDto,
  ListEmployeeSecurityQueryDto,
} from './dto/employee-security.dto';
import type { EmployeeStatus } from './dto/employee.dto';

const MAX_SECURITY_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;

type EmployeeSecurityDatabaseRow = {
  employeeId: string;
  name: string | null;
  email: string;
  status: string;
  rank: bigint;
  projectRequestCount: bigint;
  projectMaskedRequestCount: bigint;
  projectBlockedRequestCount: bigint;
  tenantChatRequestCount: bigint;
  tenantChatMaskedRequestCount: bigint;
  tenantChatBlockedRequestCount: bigint;
};

@Injectable()
export class EmployeeSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployeeSecurity(
    tenantId: string,
    query: ListEmployeeSecurityQueryDto,
  ): Promise<EmployeeSecurityResponseDto> {
    await this.assertTenantExists(tenantId);
    const period = this.validatePeriod(query.from, query.to);
    const rows = await this.queryRows(
      tenantId,
      period.from,
      period.to,
      query.limit ?? 100,
    );

    return {
      data: rows.map(toResponseRow),
      generatedAt: new Date().toISOString(),
      period: {
        from: period.from.toISOString(),
        timezone: 'UTC',
        to: period.to.toISOString(),
      },
    };
  }

  private validatePeriod(fromValue: string, toValue: string) {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    const duration = to.getTime() - from.getTime();
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new BadRequestException('Employee security range must satisfy from < to.');
    }
    if (duration > MAX_SECURITY_RANGE_MS) {
      throw new BadRequestException('Employee security range cannot exceed 31 days.');
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

  private queryRows(
    tenantId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<EmployeeSecurityDatabaseRow[]> {
    return this.prisma.$queryRaw<EmployeeSecurityDatabaseRow[]>(Prisma.sql`
      WITH identity_candidates AS (
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
      ), project_events AS (
        SELECT resolved.employee_id,
          coalesce(nullif(log.masking_action, ''), 'none') = 'redacted' AS is_masked,
          (
            coalesce(nullif(log.masking_action, ''), 'none') = 'blocked'
            OR lower(coalesce(
              nullif(log.metadata #>> '{domainOutcomes,safety,outcome}', ''),
              nullif(log.metadata #>> '{gatewayStageOutcomes,domainOutcomes,safety,outcome}', ''),
              ''
            )) LIKE '%block%'
          ) AS is_blocked
        FROM p0_llm_invocation_logs log
        JOIN resolved_keys resolved
          ON resolved.identity_key = lower(btrim(log.end_user_id))
        WHERE log.tenant_id = ${tenantId}::uuid
          AND log.created_at >= ${from}
          AND log.created_at < ${to}
          AND log.end_user_id IS NOT NULL
      ), project_security AS (
        SELECT employee_id,
          count(*)::bigint AS request_count,
          count(*) FILTER (WHERE is_masked)::bigint AS masked_request_count,
          count(*) FILTER (WHERE is_blocked)::bigint AS blocked_request_count
        FROM project_events
        GROUP BY employee_id
      ), tenant_chat_security AS (
        SELECT logs.employee_id,
          count(*)::bigint AS request_count,
          0::bigint AS masked_request_count,
          count(*) FILTER (WHERE logs.terminal_outcome = 'safety_blocked')::bigint
            AS blocked_request_count
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
        GROUP BY logs.employee_id
      ), employee_security AS (
        SELECT employee.id AS employee_id,
          employee.name,
          employee.email,
          employee.status,
          coalesce(project.request_count, 0)::bigint AS project_request_count,
          coalesce(project.masked_request_count, 0)::bigint AS project_masked_request_count,
          coalesce(project.blocked_request_count, 0)::bigint AS project_blocked_request_count,
          coalesce(chat.request_count, 0)::bigint AS tenant_chat_request_count,
          coalesce(chat.masked_request_count, 0)::bigint AS tenant_chat_masked_request_count,
          coalesce(chat.blocked_request_count, 0)::bigint AS tenant_chat_blocked_request_count,
          (
            coalesce(project.masked_request_count, 0) +
            coalesce(project.blocked_request_count, 0) +
            coalesce(chat.blocked_request_count, 0)
          )::bigint AS protected_request_count
        FROM employees employee
        LEFT JOIN project_security project ON project.employee_id = employee.id
        LEFT JOIN tenant_chat_security chat ON chat.employee_id = employee.id
        WHERE employee."tenantId" = ${tenantId}::uuid
          AND employee."deletedAt" IS NULL
      ), ranked AS (
        SELECT employee_security.*,
          row_number() OVER (
            ORDER BY protected_request_count DESC, employee_id
          )::bigint AS rank
        FROM employee_security
      )
      SELECT
        employee_id::text AS "employeeId",
        name,
        email,
        status,
        rank,
        project_request_count AS "projectRequestCount",
        project_masked_request_count AS "projectMaskedRequestCount",
        project_blocked_request_count AS "projectBlockedRequestCount",
        tenant_chat_request_count AS "tenantChatRequestCount",
        tenant_chat_masked_request_count AS "tenantChatMaskedRequestCount",
        tenant_chat_blocked_request_count AS "tenantChatBlockedRequestCount"
      FROM ranked
      ORDER BY protected_request_count DESC, employee_id
      LIMIT ${limit}
    `);
  }
}

function toResponseRow(row: EmployeeSecurityDatabaseRow) {
  const projectApplication = toMetric(
    row.projectRequestCount,
    row.projectMaskedRequestCount,
    row.projectBlockedRequestCount,
  );
  const tenantChat = toMetric(
    row.tenantChatRequestCount,
    row.tenantChatMaskedRequestCount,
    row.tenantChatBlockedRequestCount,
  );
  return {
    email: row.email,
    employeeId: row.employeeId,
    name: row.name,
    rank: Number(row.rank),
    sources: { projectApplication, tenantChat },
    status: normalizeEmployeeStatus(row.status),
    total: addMetrics(projectApplication, tenantChat),
  };
}

function toMetric(
  requestCount: bigint,
  maskedRequestCount: bigint,
  blockedRequestCount: bigint,
): EmployeeSecurityMetricDto {
  const masked = Number(maskedRequestCount);
  const blocked = Number(blockedRequestCount);
  return {
    blockedRequestCount: blocked,
    maskedRequestCount: masked,
    protectedRequestCount: masked + blocked,
    requestCount: Number(requestCount),
  };
}

function addMetrics(
  left: EmployeeSecurityMetricDto,
  right: EmployeeSecurityMetricDto,
): EmployeeSecurityMetricDto {
  return {
    blockedRequestCount: left.blockedRequestCount + right.blockedRequestCount,
    maskedRequestCount: left.maskedRequestCount + right.maskedRequestCount,
    protectedRequestCount: left.protectedRequestCount + right.protectedRequestCount,
    requestCount: left.requestCount + right.requestCount,
  };
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

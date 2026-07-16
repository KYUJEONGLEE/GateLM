import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, TenantEmployeeCostPolicy } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  EmployeeCostEnforcementMode,
  EmployeeCostPeriodStateResponseDto,
  EmployeeCostPoliciesResponseDto,
  EmployeeCostPolicyListItemResponseDto,
  EmployeeCostPolicyResponseDto,
  EmployeeCostPolicyState,
  EmployeeCostRolloutMode,
  ListEmployeeCostPoliciesQueryDto,
  MAX_EMPLOYEE_COST_LIMIT_MICRO_USD,
  UpdateEmployeeCostPolicyDto,
} from './dto/employee-cost-policy.dto';
import { EmployeeUsageService } from './employee-usage.service';

const DEFAULT_TIMEZONE = 'Asia/Seoul';
const DEFAULT_WARNING_THRESHOLD_PERCENT = 80;

type PolicyDocument = {
  currency: 'USD';
  daily: { enabled: boolean; limitMicroUsd: number };
  enforcementMode: EmployeeCostEnforcementMode;
  periodTimezone: string;
  version: number;
  warningThresholdPercent: number;
  weekly: { enabled: boolean; limitMicroUsd: number };
};

type UpdatePolicyArgs = {
  body: UpdateEmployeeCostPolicyDto;
  employeeId: string;
  tenantId: string;
  updatedBy: string;
};

type PeriodBounds = {
  day: { from: Date; to: Date };
  week: { from: Date; to: Date };
};

type RolloutDatabaseRow = {
  activation_boundary_at: Date | null;
  coverage_invalidated_at: Date | null;
  mode: string;
  project_application_covered_from: Date | null;
  tenant_chat_covered_from: Date | null;
};

type PeriodDatabaseRow = {
  confirmed_cost_micro_usd: bigint;
  currency: string;
  employee_id: string;
  period_end: Date;
  period_kind: string;
  period_start: Date;
  period_timezone: string;
  reserved_cost_micro_usd: bigint;
  state: string;
  unconfirmed_cost_micro_usd: bigint;
};

type LedgerSnapshotDatabaseRow = RolloutDatabaseRow & {
  confirmed_cost_micro_usd: bigint | null;
  currency: string | null;
  employee_id: string | null;
  period_end: Date | null;
  period_kind: string | null;
  period_start: Date | null;
  period_timezone: string | null;
  reserved_cost_micro_usd: bigint | null;
  state: string | null;
  unconfirmed_cost_micro_usd: bigint | null;
};

type RolloutSnapshot = {
  activationBoundaryAt: Date | null;
  coverageInvalidatedAt: Date | null;
  mode: EmployeeCostRolloutMode;
  projectApplicationCoveredFrom: Date | null;
  tenantChatCoveredFrom: Date | null;
};

type EmployeePeriodUsage = {
  bounds: PeriodBounds;
  dailyCost: number;
  timezone: string;
  weeklyCost: number;
};

type IndexedPeriodRows = {
  day?: PeriodDatabaseRow;
  invalid: boolean;
  week?: PeriodDatabaseRow;
};

type AuthoritativePeriodPair = {
  daily: EmployeeCostPeriodStateResponseDto;
  weekly: EmployeeCostPeriodStateResponseDto;
};

@Injectable()
export class EmployeeCostPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeUsage: EmployeeUsageService,
  ) {}

  async list(
    tenantId: string,
    query: ListEmployeeCostPoliciesQueryDto,
  ): Promise<EmployeeCostPoliciesResponseDto> {
    const limit = query.limit ?? 100;
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null, tenantId },
      include: { costPolicy: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = employees.length > limit;
    const page = employees.slice(0, limit);
    const now = new Date();
    const usageByEmployee = employeePeriodContexts(page, now);
    const ledger = await this.readLedgerSnapshot(
      tenantId,
      page.map((employee) => employee.id),
      now,
    );
    const periodsByEmployee = indexPeriodRows(ledger.periodRows);
    const authoritativeByEmployee = new Map<string, AuthoritativePeriodPair>();
    if (ledger.rollout.mode !== 'off') {
      for (const employee of page) {
        const usage = usageByEmployee.get(employee.id)!;
        if (!rolloutCoversCurrentPeriods(ledger.rollout, usage.bounds)) continue;
        const periods = authoritativePeriods(
          periodsByEmployee.get(employee.id),
          this.toResponse(tenantId, employee.id, employee.costPolicy),
          usage,
        );
        if (periods) authoritativeByEmployee.set(employee.id, periods);
      }
    }
    const fallbackUsage = await this.readConfirmedUsage(
      tenantId,
      page.filter((employee) => !authoritativeByEmployee.has(employee.id)),
      now,
    );
    for (const [employeeId, usage] of fallbackUsage) {
      usageByEmployee.set(employeeId, usage);
    }

    return {
      data: page.map((employee) =>
        this.toListItem(
          tenantId,
          employee.id,
          employee.costPolicy,
          usageByEmployee.get(employee.id)!,
          ledger.rollout,
          authoritativeByEmployee.get(employee.id),
          now,
        ),
      ),
      pagination: {
        hasMore,
        limit,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      },
    };
  }

  private async readConfirmedUsage(
    tenantId: string,
    employees: Array<{
      costPolicy: TenantEmployeeCostPolicy | null;
      id: string;
    }>,
    now: Date,
  ): Promise<Map<string, EmployeePeriodUsage>> {
    const groups = new Map<
      string,
      { bounds: PeriodBounds; employeeIds: string[] }
    >();
    for (const employee of employees) {
      const timezone = employee.costPolicy?.periodTimezone ?? DEFAULT_TIMEZONE;
      const existing = groups.get(timezone);
      if (existing) {
        existing.employeeIds.push(employee.id);
      } else {
        groups.set(timezone, {
          bounds: readableEmployeeCostPeriodBounds(now, timezone),
          employeeIds: [employee.id],
        });
      }
    }

    const result = new Map<string, EmployeePeriodUsage>();
    await Promise.all(
      [...groups.entries()].map(async ([timezone, group]) => {
        const totals = await this.employeeUsage.readEmployeeCostTotals(
          tenantId,
          group.employeeIds,
          [group.bounds.day, group.bounds.week],
        );
        const daily = totals[0] ?? new Map<string, number>();
        const weekly = totals[1] ?? new Map<string, number>();
        for (const employeeId of group.employeeIds) {
          result.set(employeeId, {
            bounds: group.bounds,
            dailyCost: safeReadModelCost(daily.get(employeeId) ?? 0),
            timezone,
            weeklyCost: safeReadModelCost(weekly.get(employeeId) ?? 0),
          });
        }
      }),
    );
    return result;
  }

  private async readLedgerSnapshot(
    tenantId: string,
    employeeIds: string[],
    now: Date,
  ): Promise<{ periodRows: PeriodDatabaseRow[]; rollout: RolloutSnapshot }> {
    if (employeeIds.length === 0) {
      return { periodRows: [], rollout: offRollout() };
    }
    const rows = await this.prisma.$queryRaw<LedgerSnapshotDatabaseRow[]>(Prisma.sql`
      SELECT rollout.mode, rollout.activation_boundary_at,
             rollout.project_application_covered_from,
             rollout.tenant_chat_covered_from,
             rollout.coverage_invalidated_at,
             period.employee_id::text, period.period_kind,
             period.period_start, period.period_end, period.period_timezone,
             period.currency, period.confirmed_cost_micro_usd,
             period.reserved_cost_micro_usd,
             period.unconfirmed_cost_micro_usd, period.state
      FROM tenant_employee_cost_ledger_rollouts AS rollout
      LEFT JOIN tenant_employee_cost_periods AS period
        ON period.tenant_id = rollout.tenant_id
       AND rollout.mode <> 'off'
       AND period.employee_id IN (${Prisma.join(
         employeeIds.map((employeeId) => Prisma.sql`${employeeId}::uuid`),
       )})
       AND period.period_start <= ${now}
       AND period.period_end > ${now}
       AND period.currency = 'USD'
      WHERE rollout.tenant_id = ${tenantId}::uuid
      ORDER BY period.employee_id, period.period_kind, period.period_start DESC
    `);
    const first = rows[0];
    if (!first) return { periodRows: [], rollout: offRollout() };
    const periodRows = rows.flatMap((row): PeriodDatabaseRow[] => {
      if (
        row.employee_id === null ||
        row.period_kind === null ||
        row.period_start === null ||
        row.period_end === null ||
        row.period_timezone === null ||
        row.currency === null ||
        row.confirmed_cost_micro_usd === null ||
        row.reserved_cost_micro_usd === null ||
        row.unconfirmed_cost_micro_usd === null ||
        row.state === null
      ) {
        return [];
      }
      return [{
        confirmed_cost_micro_usd: row.confirmed_cost_micro_usd,
        currency: row.currency,
        employee_id: row.employee_id,
        period_end: row.period_end,
        period_kind: row.period_kind,
        period_start: row.period_start,
        period_timezone: row.period_timezone,
        reserved_cost_micro_usd: row.reserved_cost_micro_usd,
        state: row.state,
        unconfirmed_cost_micro_usd: row.unconfirmed_cost_micro_usd,
      }];
    });
    return {
      periodRows,
      rollout: {
        activationBoundaryAt: first.activation_boundary_at,
        coverageInvalidatedAt: first.coverage_invalidated_at,
        mode: normalizeRolloutMode(first.mode),
        projectApplicationCoveredFrom:
          first.project_application_covered_from,
        tenantChatCoveredFrom: first.tenant_chat_covered_from,
      },
    };
  }

  async update(args: UpdatePolicyArgs): Promise<EmployeeCostPolicyResponseDto> {
    const next = this.normalizeUpdate(args.body);

    return this.prisma.$transaction(async (tx) => {
      const employeeRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id::text
        FROM employees
        WHERE id = ${args.employeeId}::uuid
          AND "tenantId" = ${args.tenantId}::uuid
          AND "deletedAt" IS NULL
        FOR UPDATE
      `);
      if (!employeeRows[0]) {
        throw new NotFoundException({
          code: 'EMPLOYEE_COST_POLICY_NOT_FOUND',
          message: 'Employee not found.',
        });
      }

      const existing = await tx.tenantEmployeeCostPolicy.findUnique({
        where: {
          tenantId_employeeId: {
            employeeId: args.employeeId,
            tenantId: args.tenantId,
          },
        },
      });
      const current = this.toPolicyDocument(existing);
      if (args.body.expectedVersion !== current.version) {
        throw new ConflictException({
          code: 'EMPLOYEE_COST_POLICY_VERSION_CONFLICT',
          message: 'Employee cost policy was updated by another administrator.',
        });
      }
      if (samePolicy(current, next)) {
        return this.toResponse(args.tenantId, args.employeeId, existing);
      }

      const version = current.version + 1;
      const policy = existing
        ? await tx.tenantEmployeeCostPolicy.update({
            where: {
              tenantId_employeeId: {
                employeeId: args.employeeId,
                tenantId: args.tenantId,
              },
            },
            data: {
              dailyEnabled: next.daily.enabled,
              dailyLimitMicroUsd: BigInt(next.daily.limitMicroUsd),
              enforcementMode: next.enforcementMode,
              updatedBy: args.updatedBy,
              version,
              warningThresholdPercent: next.warningThresholdPercent,
              weeklyEnabled: next.weekly.enabled,
              weeklyLimitMicroUsd: BigInt(next.weekly.limitMicroUsd),
            },
          })
        : await tx.tenantEmployeeCostPolicy.create({
            data: {
              currency: 'USD',
              dailyEnabled: next.daily.enabled,
              dailyLimitMicroUsd: BigInt(next.daily.limitMicroUsd),
              employeeId: args.employeeId,
              enforcementMode: next.enforcementMode,
              periodTimezone: DEFAULT_TIMEZONE,
              tenantId: args.tenantId,
              updatedBy: args.updatedBy,
              version,
              warningThresholdPercent: next.warningThresholdPercent,
              weeklyEnabled: next.weekly.enabled,
              weeklyLimitMicroUsd: BigInt(next.weekly.limitMicroUsd),
            },
          });

      await tx.tenantEmployeeCostPolicyAudit.create({
        data: {
          action: existing ? 'policy_updated' : 'policy_created',
          actorId: args.updatedBy,
          employeeId: args.employeeId,
          nextPolicy: toJsonPolicy({ ...next, version }),
          policyVersion: version,
          previousPolicy: toJsonPolicy(current),
          tenantId: args.tenantId,
        },
      });

      return this.toResponse(args.tenantId, args.employeeId, policy);
    });
  }

  private normalizeUpdate(body: UpdateEmployeeCostPolicyDto): PolicyDocument {
    const daily = normalizeLimit(
      body.daily.enabled,
      body.daily.limitMicroUsd,
      'daily',
    );
    const weekly = normalizeLimit(
      body.weekly.enabled,
      body.weekly.limitMicroUsd,
      'weekly',
    );
    if (
      !Number.isInteger(body.warningThresholdPercent) ||
      body.warningThresholdPercent < 1 ||
      body.warningThresholdPercent > 99 ||
      (body.enforcementMode !== 'monitor' &&
        body.enforcementMode !== 'restrict_high_cost')
    ) {
      throw invalidPolicy('Employee cost policy is invalid.');
    }
    return {
      currency: 'USD',
      daily,
      enforcementMode: body.enforcementMode,
      periodTimezone: DEFAULT_TIMEZONE,
      version: body.expectedVersion,
      warningThresholdPercent: body.warningThresholdPercent,
      weekly,
    };
  }

  private toListItem(
    tenantId: string,
    employeeId: string,
    policy: TenantEmployeeCostPolicy | null,
    usage: EmployeePeriodUsage,
    rollout: RolloutSnapshot,
    authoritative: AuthoritativePeriodPair | undefined,
    now: Date,
  ): EmployeeCostPolicyListItemResponseDto {
    const response = this.toResponse(tenantId, employeeId, policy);
    const enforcementReady =
      authoritative !== undefined &&
      rollout.mode === 'enforce' &&
      rollout.activationBoundaryAt !== null &&
      rollout.activationBoundaryAt.getTime() <= now.getTime();

    if (authoritative !== undefined) {
      return {
        daily: authoritative.daily,
        employeeId,
        enforcementReady,
        exposureSource: 'authoritative_ledger',
        policy: response,
        rolloutMode: rollout.mode,
        weekly: authoritative.weekly,
      };
    }

    return {
      employeeId,
      enforcementReady: false,
      exposureSource: 'confirmed_read_model',
      policy: response,
      rolloutMode: rollout.mode,
      daily: {
        confirmedCostMicroUsd: usage.dailyCost,
        periodEnd: usage.bounds.day.to.toISOString(),
        periodStart: usage.bounds.day.from.toISOString(),
        periodTimezone: usage.timezone,
        reservedCostMicroUsd: null,
        resetAt: usage.bounds.day.to.toISOString(),
        state: response.daily.enabled ? 'pending_ledger' : 'not_configured',
        unconfirmedCostMicroUsd: null,
      },
      weekly: {
        confirmedCostMicroUsd: usage.weeklyCost,
        periodEnd: usage.bounds.week.to.toISOString(),
        periodStart: usage.bounds.week.from.toISOString(),
        periodTimezone: usage.timezone,
        reservedCostMicroUsd: null,
        resetAt: usage.bounds.week.to.toISOString(),
        state: response.weekly.enabled ? 'pending_ledger' : 'not_configured',
        unconfirmedCostMicroUsd: null,
      },
    };
  }

  private toResponse(
    tenantId: string,
    employeeId: string,
    policy: TenantEmployeeCostPolicy | null,
  ): EmployeeCostPolicyResponseDto {
    if (!policy) {
      return {
        createdAt: null,
        currency: 'USD',
        daily: { enabled: false, limitMicroUsd: 0 },
        employeeId,
        enforcementMode: 'monitor',
        periodTimezone: DEFAULT_TIMEZONE,
        tenantId,
        updatedAt: null,
        updatedBy: null,
        version: 0,
        warningThresholdPercent: DEFAULT_WARNING_THRESHOLD_PERCENT,
        weekly: { enabled: false, limitMicroUsd: 0 },
      };
    }
    return {
      createdAt: policy.createdAt.toISOString(),
      currency: 'USD',
      daily: {
        enabled: policy.dailyEnabled,
        limitMicroUsd: Number(policy.dailyLimitMicroUsd),
      },
      employeeId,
      enforcementMode: normalizeMode(policy.enforcementMode),
      periodTimezone: policy.periodTimezone,
      tenantId,
      updatedAt: policy.updatedAt.toISOString(),
      updatedBy: policy.updatedBy,
      version: policy.version,
      warningThresholdPercent: policy.warningThresholdPercent,
      weekly: {
        enabled: policy.weeklyEnabled,
        limitMicroUsd: Number(policy.weeklyLimitMicroUsd),
      },
    };
  }

  private toPolicyDocument(
    policy: TenantEmployeeCostPolicy | null,
  ): PolicyDocument {
    const response = this.toResponse('', '', policy);
    return {
      currency: 'USD',
      daily: response.daily,
      enforcementMode: response.enforcementMode,
      periodTimezone: response.periodTimezone,
      version: response.version,
      warningThresholdPercent: response.warningThresholdPercent,
      weekly: response.weekly,
    };
  }
}

const LEDGER_PERIOD_STATES = new Set([
  'normal',
  'warning',
  'exceeded',
  'not_configured',
]);

function employeePeriodContexts(
  employees: Array<{
    costPolicy: TenantEmployeeCostPolicy | null;
    id: string;
  }>,
  now: Date,
): Map<string, EmployeePeriodUsage> {
  const result = new Map<string, EmployeePeriodUsage>();
  for (const employee of employees) {
    const timezone = employee.costPolicy?.periodTimezone ?? DEFAULT_TIMEZONE;
    result.set(employee.id, {
      bounds: readableEmployeeCostPeriodBounds(now, timezone),
      dailyCost: 0,
      timezone,
      weeklyCost: 0,
    });
  }
  return result;
}

function safeReadModelCost(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ServiceUnavailableException({
      code: 'EMPLOYEE_COST_USAGE_UNAVAILABLE',
      message: 'Employee cost usage is unavailable.',
    });
  }
  return value;
}

function readableEmployeeCostPeriodBounds(
  now: Date,
  timezone: string,
): PeriodBounds {
  try {
    return employeeCostPeriodBounds(now, timezone);
  } catch {
    throw new ServiceUnavailableException({
      code: 'EMPLOYEE_COST_USAGE_UNAVAILABLE',
      message: 'Employee cost usage is unavailable.',
    });
  }
}

function offRollout(): RolloutSnapshot {
  return {
    activationBoundaryAt: null,
    coverageInvalidatedAt: null,
    mode: 'off',
    projectApplicationCoveredFrom: null,
    tenantChatCoveredFrom: null,
  };
}

function normalizeRolloutMode(value: string | undefined): EmployeeCostRolloutMode {
  return value === 'shadow' || value === 'enforce' ? value : 'off';
}

function indexPeriodRows(
  rows: PeriodDatabaseRow[],
): Map<string, IndexedPeriodRows> {
  const result = new Map<string, IndexedPeriodRows>();
  for (const row of rows) {
    const current = result.get(row.employee_id) ?? { invalid: false };
    if (row.period_kind === 'day') {
      if (current.day) current.invalid = true;
      current.day = row;
    } else if (row.period_kind === 'week') {
      if (current.week) current.invalid = true;
      current.week = row;
    } else {
      current.invalid = true;
    }
    result.set(row.employee_id, current);
  }
  return result;
}

function rolloutCoversCurrentPeriods(
  rollout: RolloutSnapshot,
  bounds: PeriodBounds,
): boolean {
  if (
    rollout.mode === 'off' ||
    rollout.coverageInvalidatedAt !== null ||
    rollout.projectApplicationCoveredFrom === null ||
    rollout.tenantChatCoveredFrom === null
  ) {
    return false;
  }
  const starts = [bounds.day.from.getTime(), bounds.week.from.getTime()];
  return starts.every(
    (start) =>
      rollout.projectApplicationCoveredFrom!.getTime() <= start &&
      rollout.tenantChatCoveredFrom!.getTime() <= start,
  );
}

function authoritativePeriods(
  indexed: IndexedPeriodRows | undefined,
  policy: EmployeeCostPolicyResponseDto,
  usage: EmployeePeriodUsage,
): AuthoritativePeriodPair | null {
  if (indexed?.invalid) return null;
  const daily = authoritativePeriod(
    indexed?.day,
    'day',
    usage.bounds.day,
    usage.timezone,
    policy.daily,
    policy.warningThresholdPercent,
  );
  const weekly = authoritativePeriod(
    indexed?.week,
    'week',
    usage.bounds.week,
    usage.timezone,
    policy.weekly,
    policy.warningThresholdPercent,
  );
  return daily && weekly ? { daily, weekly } : null;
}

function authoritativePeriod(
  row: PeriodDatabaseRow | undefined,
  kind: 'day' | 'week',
  bounds: { from: Date; to: Date },
  timezone: string,
  limit: { enabled: boolean; limitMicroUsd: number },
  warningThresholdPercent: number,
): EmployeeCostPeriodStateResponseDto | null {
  if (
    row &&
    (row.period_kind !== kind ||
      row.currency !== 'USD' ||
      row.period_timezone !== timezone ||
      row.period_start.getTime() !== bounds.from.getTime() ||
      row.period_end.getTime() !== bounds.to.getTime() ||
      !LEDGER_PERIOD_STATES.has(row.state))
  ) {
    return null;
  }

  const confirmed = row?.confirmed_cost_micro_usd ?? 0n;
  const reserved = row?.reserved_cost_micro_usd ?? 0n;
  const unconfirmed = row?.unconfirmed_cost_micro_usd ?? 0n;
  const exposure = confirmed + reserved + unconfirmed;
  const confirmedNumber = safeCostNumber(confirmed);
  const reservedNumber = safeCostNumber(reserved);
  const unconfirmedNumber = safeCostNumber(unconfirmed);
  if (
    confirmedNumber === null ||
    reservedNumber === null ||
    unconfirmedNumber === null ||
    safeCostNumber(exposure) === null
  ) {
    return null;
  }

  return {
    confirmedCostMicroUsd: confirmedNumber,
    periodEnd: bounds.to.toISOString(),
    periodStart: bounds.from.toISOString(),
    periodTimezone: timezone,
    reservedCostMicroUsd: reservedNumber,
    resetAt: bounds.to.toISOString(),
    state: employeeCostState(
      exposure,
      limit.enabled,
      limit.limitMicroUsd,
      warningThresholdPercent,
    ),
    unconfirmedCostMicroUsd: unconfirmedNumber,
  };
}

function employeeCostState(
  exposure: bigint,
  enabled: boolean,
  limitMicroUsd: number,
  warningThresholdPercent: number,
): EmployeeCostPolicyState {
  if (!enabled) return 'not_configured';
  const limit = BigInt(limitMicroUsd);
  if (exposure >= limit) return 'exceeded';
  const warning = (limit * BigInt(warningThresholdPercent) + 99n) / 100n;
  return exposure >= warning ? 'warning' : 'normal';
}

function safeCostNumber(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function normalizeLimit(
  enabled: boolean,
  value: number,
  period: 'daily' | 'weekly',
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_EMPLOYEE_COST_LIMIT_MICRO_USD ||
    (enabled && value <= 0)
  ) {
    throw invalidPolicy(`${period} employee cost limit is invalid.`);
  }
  return { enabled, limitMicroUsd: value };
}

function invalidPolicy(message: string) {
  return new BadRequestException({
    code: 'EMPLOYEE_COST_POLICY_INVALID',
    message,
  });
}

function normalizeMode(value: string): EmployeeCostEnforcementMode {
  return value === 'restrict_high_cost' ? value : 'monitor';
}

function samePolicy(current: PolicyDocument, next: PolicyDocument): boolean {
  return (
    current.daily.enabled === next.daily.enabled &&
    current.daily.limitMicroUsd === next.daily.limitMicroUsd &&
    current.weekly.enabled === next.weekly.enabled &&
    current.weekly.limitMicroUsd === next.weekly.limitMicroUsd &&
    current.warningThresholdPercent === next.warningThresholdPercent &&
    current.enforcementMode === next.enforcementMode
  );
}

function toJsonPolicy(policy: PolicyDocument): Prisma.InputJsonObject {
  return {
    currency: policy.currency,
    daily: {
      enabled: policy.daily.enabled,
      limitMicroUsd: policy.daily.limitMicroUsd,
    },
    enforcementMode: policy.enforcementMode,
    periodTimezone: policy.periodTimezone,
    version: policy.version,
    warningThresholdPercent: policy.warningThresholdPercent,
    weekly: {
      enabled: policy.weekly.enabled,
      limitMicroUsd: policy.weekly.limitMicroUsd,
    },
  };
}

export function employeeCostPeriodBounds(
  now: Date,
  timezone: string,
): PeriodBounds {
  const local = zonedParts(now, timezone);
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const weekdayOffset = (localDate.getUTCDay() + 6) % 7;
  const weekStartDate = new Date(localDate);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekdayOffset);
  const nextDayDate = new Date(localDate);
  nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1);
  const nextWeekDate = new Date(weekStartDate);
  nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);

  return {
    day: {
      from: localMidnightToUtc(localDate, timezone),
      to: localMidnightToUtc(nextDayDate, timezone),
    },
    week: {
      from: localMidnightToUtc(weekStartDate, timezone),
      to: localMidnightToUtc(nextWeekDate, timezone),
    },
  };
}

function localMidnightToUtc(localDate: Date, timezone: string): Date {
  const target = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
  );
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const next = candidate + (target - actualAsUtc);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

function zonedParts(value: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    month: parts.month,
    second: parts.second,
    year: parts.year,
  } as Record<'day' | 'hour' | 'minute' | 'month' | 'second' | 'year', number>;
}

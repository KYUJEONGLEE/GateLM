import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantEmployeeCostPolicy } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  EmployeeCostEnforcementMode,
  EmployeeCostPoliciesResponseDto,
  EmployeeCostPolicyListItemResponseDto,
  EmployeeCostPolicyResponseDto,
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
    const bounds = employeeCostPeriodBounds(new Date(), DEFAULT_TIMEZONE);
    const usageByPeriod = await this.employeeUsage.readEmployeeCostTotals(
      tenantId,
      page.map((employee) => employee.id),
      [bounds.day, bounds.week],
    );
    const dailyUsage = usageByPeriod[0] ?? new Map<string, number>();
    const weeklyUsage = usageByPeriod[1] ?? new Map<string, number>();

    return {
      data: page.map((employee) =>
        this.toListItem(
          tenantId,
          employee.id,
          employee.costPolicy,
          dailyUsage.get(employee.id) ?? 0,
          weeklyUsage.get(employee.id) ?? 0,
          bounds,
        ),
      ),
      pagination: {
        hasMore,
        limit,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
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
    const daily = normalizeLimit(body.daily.enabled, body.daily.limitMicroUsd, 'daily');
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
    dailyCost: number,
    weeklyCost: number,
    bounds: PeriodBounds,
  ): EmployeeCostPolicyListItemResponseDto {
    const response = this.toResponse(tenantId, employeeId, policy);
    return {
      employeeId,
      enforcementReady: false,
      exposureSource: 'confirmed_read_model',
      policy: response,
      daily: {
        confirmedCostMicroUsd: dailyCost,
        periodEnd: bounds.day.to.toISOString(),
        periodStart: bounds.day.from.toISOString(),
        reservedCostMicroUsd: null,
        resetAt: bounds.day.to.toISOString(),
        state: response.daily.enabled ? 'pending_ledger' : 'not_configured',
        unconfirmedCostMicroUsd: null,
      },
      weekly: {
        confirmedCostMicroUsd: weeklyCost,
        periodEnd: bounds.week.to.toISOString(),
        periodStart: bounds.week.from.toISOString(),
        reservedCostMicroUsd: null,
        resetAt: bounds.week.to.toISOString(),
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

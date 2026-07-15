import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  EmployeeCostPolicyService,
  employeeCostPeriodBounds,
} from './employee-cost-policy.service';
import { EmployeeUsageService } from './employee-usage.service';

const tenantId = '00000000-0000-4000-8000-000000000100';
const employeeId = '00000000-0000-4000-8000-000000000101';
const adminUserId = '00000000-0000-4000-8000-000000000102';
const timestamp = new Date('2026-07-15T08:00:00.000Z');

describe('EmployeeCostPolicyService', () => {
  beforeEach(() => jest.useRealTimers());

  it('uses Asia/Seoul calendar day and ISO Monday week boundaries', () => {
    expect(employeeCostPeriodBounds(timestamp, 'Asia/Seoul')).toEqual({
      day: {
        from: new Date('2026-07-14T15:00:00.000Z'),
        to: new Date('2026-07-15T15:00:00.000Z'),
      },
      week: {
        from: new Date('2026-07-12T15:00:00.000Z'),
        to: new Date('2026-07-19T15:00:00.000Z'),
      },
    });
  });

  it('returns confirmed costs without pretending the pending ledger is authoritative', async () => {
    jest.useFakeTimers().setSystemTime(timestamp);
    const employee = {
      costPolicy: policy({
        dailyEnabled: true,
        dailyLimitMicroUsd: 10_000_000n,
        weeklyEnabled: true,
        weeklyLimitMicroUsd: 20_000_000n,
      }),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      id: employeeId,
    };
    const usage = jest.fn().mockResolvedValue([
      new Map([[employeeId, 8_000_000]]),
      new Map([[employeeId, 20_000_000]]),
    ]);
    const { service } = createService({ employees: [employee], usage });

    const result = await service.list(tenantId, { limit: 100 });

    expect(result.data[0]).toMatchObject({
      daily: {
        confirmedCostMicroUsd: 8_000_000,
        reservedCostMicroUsd: null,
        state: 'pending_ledger',
        unconfirmedCostMicroUsd: null,
      },
      enforcementReady: false,
      exposureSource: 'confirmed_read_model',
      policy: { tenantId, version: 1 },
      weekly: {
        confirmedCostMicroUsd: 20_000_000,
        state: 'pending_ledger',
      },
    });
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith(
      tenantId,
      [employeeId],
      [
        {
          from: new Date('2026-07-14T15:00:00.000Z'),
          to: new Date('2026-07-15T15:00:00.000Z'),
        },
        {
          from: new Date('2026-07-12T15:00:00.000Z'),
          to: new Date('2026-07-19T15:00:00.000Z'),
        },
      ],
    );
  });

  it('creates the first policy and append-only audit in one transaction', async () => {
    const created = policy({
      dailyEnabled: true,
      dailyLimitMicroUsd: 5_000_000n,
      enforcementMode: 'restrict_high_cost',
      updatedBy: adminUserId,
      version: 1,
      warningThresholdPercent: 75,
      weeklyEnabled: true,
      weeklyLimitMicroUsd: 25_000_000n,
    });
    const { service, tx } = createService({
      existing: null,
      lockedEmployeeRows: [{ id: employeeId }],
    });
    tx.tenantEmployeeCostPolicy.create.mockResolvedValue(created);

    const result = await service.update({
      body: updateBody(),
      employeeId,
      tenantId,
      updatedBy: adminUserId,
    });

    expect(result).toMatchObject({
      daily: { enabled: true, limitMicroUsd: 5_000_000 },
      enforcementMode: 'restrict_high_cost',
      updatedBy: adminUserId,
      version: 1,
      weekly: { enabled: true, limitMicroUsd: 25_000_000 },
    });
    expect(tx.tenantEmployeeCostPolicy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId,
        tenantId,
        updatedBy: adminUserId,
        version: 1,
      }),
    });
    expect(tx.tenantEmployeeCostPolicyAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'policy_created',
        actorId: adminUserId,
        employeeId,
        policyVersion: 1,
        previousPolicy: expect.objectContaining({
          enforcementMode: 'monitor',
          version: 0,
        }),
        tenantId,
      }),
    });
  });

  it('preserves a configured amount while its period is disabled', async () => {
    const created = policy({
      dailyEnabled: false,
      dailyLimitMicroUsd: 5_000_000n,
      updatedBy: adminUserId,
      version: 1,
    });
    const { service, tx } = createService({
      existing: null,
      lockedEmployeeRows: [{ id: employeeId }],
    });
    tx.tenantEmployeeCostPolicy.create.mockResolvedValue(created);

    const result = await service.update({
      body: {
        daily: { enabled: false, limitMicroUsd: 5_000_000 },
        enforcementMode: 'monitor',
        expectedVersion: 0,
        warningThresholdPercent: 80,
        weekly: { enabled: false, limitMicroUsd: 0 },
      },
      employeeId,
      tenantId,
      updatedBy: adminUserId,
    });

    expect(result.daily).toEqual({ enabled: false, limitMicroUsd: 5_000_000 });
    expect(tx.tenantEmployeeCostPolicy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dailyLimitMicroUsd: 5_000_000n }),
    });
  });

  it('rejects stale updates before writing policy or audit rows', async () => {
    const { service, tx } = createService({
      existing: policy({ version: 2 }),
      lockedEmployeeRows: [{ id: employeeId }],
    });

    await expect(
      service.update({
        body: updateBody({ expectedVersion: 1 }),
        employeeId,
        tenantId,
        updatedBy: adminUserId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.tenantEmployeeCostPolicy.update).not.toHaveBeenCalled();
    expect(tx.tenantEmployeeCostPolicyAudit.create).not.toHaveBeenCalled();
  });

  it('does not create a row for an unchanged disabled default', async () => {
    const { service, tx } = createService({
      existing: null,
      lockedEmployeeRows: [{ id: employeeId }],
    });

    const result = await service.update({
      body: {
        daily: { enabled: false, limitMicroUsd: 0 },
        enforcementMode: 'monitor',
        expectedVersion: 0,
        warningThresholdPercent: 80,
        weekly: { enabled: false, limitMicroUsd: 0 },
      },
      employeeId,
      tenantId,
      updatedBy: adminUserId,
    });

    expect(result).toMatchObject({ version: 0, updatedBy: null });
    expect(tx.tenantEmployeeCostPolicy.create).not.toHaveBeenCalled();
    expect(tx.tenantEmployeeCostPolicyAudit.create).not.toHaveBeenCalled();
  });

  it('rejects an enabled zero limit before opening a transaction', async () => {
    const { prisma, service } = createService();

    await expect(
      service.update({
        body: updateBody({ daily: { enabled: true, limitMicroUsd: 0 } }),
        employeeId,
        tenantId,
        updatedBy: adminUserId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hides deleted and cross-tenant employees as not found', async () => {
    const { service, tx } = createService({ lockedEmployeeRows: [] });

    await expect(
      service.update({
        body: updateBody(),
        employeeId,
        tenantId,
        updatedBy: adminUserId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const query = rawQuery(tx.$queryRaw.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"tenantId" =');
    expect(query.sql).toContain('"deletedAt" IS NULL');
    expect(query.sql).toContain('FOR UPDATE');
  });
});

function createService(
  options: {
    employees?: unknown[];
    existing?: ReturnType<typeof policy> | null;
    lockedEmployeeRows?: Array<{ id: string }>;
    usage?: jest.Mock;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(options.lockedEmployeeRows ?? []),
    tenantEmployeeCostPolicy: {
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
      update: jest.fn(),
    },
    tenantEmployeeCostPolicyAudit: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    employee: {
      findMany: jest.fn().mockResolvedValue(options.employees ?? []),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
    },
  };
  const usage =
    options.usage ?? jest.fn().mockResolvedValue([new Map(), new Map()]);
  const service = new EmployeeCostPolicyService(
    prisma as unknown as PrismaService,
    { readEmployeeCostTotals: usage } as unknown as EmployeeUsageService,
  );
  return { prisma, service, tx, usage };
}

function updateBody(
  overrides: Partial<{
    daily: { enabled: boolean; limitMicroUsd: number };
    enforcementMode: 'monitor' | 'restrict_high_cost';
    expectedVersion: number;
    warningThresholdPercent: number;
    weekly: { enabled: boolean; limitMicroUsd: number };
  }> = {},
) {
  return {
    daily: { enabled: true, limitMicroUsd: 5_000_000 },
    enforcementMode: 'restrict_high_cost' as const,
    expectedVersion: 0,
    warningThresholdPercent: 75,
    weekly: { enabled: true, limitMicroUsd: 25_000_000 },
    ...overrides,
  };
}

function policy(
  overrides: Partial<{
    createdAt: Date;
    currency: string;
    dailyEnabled: boolean;
    dailyLimitMicroUsd: bigint;
    employeeId: string;
    enforcementMode: string;
    periodTimezone: string;
    tenantId: string;
    updatedAt: Date;
    updatedBy: string;
    version: number;
    warningThresholdPercent: number;
    weeklyEnabled: boolean;
    weeklyLimitMicroUsd: bigint;
  }> = {},
) {
  return {
    createdAt: timestamp,
    currency: 'USD',
    dailyEnabled: false,
    dailyLimitMicroUsd: 0n,
    employeeId,
    enforcementMode: 'monitor',
    periodTimezone: 'Asia/Seoul',
    tenantId,
    updatedAt: timestamp,
    updatedBy: adminUserId,
    version: 1,
    warningThresholdPercent: 80,
    weeklyEnabled: false,
    weeklyLimitMicroUsd: 0n,
    ...overrides,
  };
}

function rawQuery(value: unknown): { sql: string } {
  return value as { sql: string };
}

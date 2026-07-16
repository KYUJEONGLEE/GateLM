import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { EmployeeUsageService } from './employee-usage.service';

const tenantId = '00000000-0000-4000-8000-000000000100';
const employeeA = '00000000-0000-4000-8000-000000000101';
const employeeB = '00000000-0000-4000-8000-000000000102';

describe('EmployeeUsageService', () => {
  it('returns ranked source breakdowns and an opaque next cursor', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([coverageRow()])
      .mockResolvedValueOnce([
        usageRow(employeeA, 1n, 120n, 30n),
        usageRow(employeeB, 2n, 80n, 20n),
      ])
      .mockResolvedValueOnce([unattributedRow()]);
    const service = createService(queryRaw);

    const result = await service.listEmployeeUsage(tenantId, {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
      limit: 1,
      metric: 'tokens',
      order: 'desc',
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      employeeId: employeeA,
      rank: 1,
      total: { requestCount: 5, totalTokens: 150, costMicroUsd: 30 },
      sources: {
        projectApplication: { totalTokens: 120 },
        tenantChat: { totalTokens: 30 },
      },
    });
    expect(result.pagination).toMatchObject({ hasMore: true, limit: 1 });
    expect(result.pagination.nextCursor).toEqual(expect.any(String));
    expect(result.unattributed.total).toMatchObject({
      requestCount: 2,
      totalTokens: 12,
      costMicroUsd: 3,
    });
    expect(result.provenance).toMatchObject({
      lastSourceAt: '2026-07-14T00:00:00.000Z',
      source: 'raw',
    });
  });

  it('keeps tenant filters, deterministic identity attribution, and confirmed Tenant Chat fields in SQL', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([coverageRow(1n, true)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([unattributedRow()]);
    const service = createService(queryRaw);

    await service.listEmployeeUsage(tenantId, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
    });

    const coverage = rawQuery(queryRaw.mock.calls[0]?.[0]);
    const ranking = rawQuery(queryRaw.mock.calls[1]?.[0]);
    expect(coverage.sql).toContain('employee_usage_ready');
    expect(coverage.sql).toContain('state.aggregated_at IS NOT NULL');
    expect(coverage.sql).toContain('log.ingested_at > state.aggregated_at');
    expect(coverage.sql).toContain('logs.updated_at > state.aggregated_at');
    expect(coverage.sql).toContain("date_bin(\n              interval '1 hour'");
    expect(ranking.sql).toContain('WHERE "tenantId" =');
    expect(ranking.sql).toContain('preferred_keys');
    expect(ranking.sql).toContain('WHERE candidate_count = 1');
    expect(ranking.sql).toContain('"deletedAt" IS NULL');
    expect(ranking.sql).toContain('logs.confirmed_total_tokens');
    expect(ranking.sql).toContain('FROM employee_usage_rollups rollup');
    expect(ranking.sql).not.toContain('tenant_chat_usage_reservations');
    expect(ranking.values.filter((value) => value === tenantId).length).toBeGreaterThan(2);
  });

  it('rejects periods longer than 31 days before reading usage', async () => {
    const queryRaw = jest.fn();
    const service = createService(queryRaw);

    await expect(
      service.listEmployeeUsage(tenantId, {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-07-14T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a cursor bound to another metric', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([coverageRow()])
      .mockResolvedValueOnce([
        usageRow(employeeA, 1n, 120n, 30n),
        usageRow(employeeB, 2n, 80n, 20n),
      ])
      .mockResolvedValueOnce([unattributedRow()]);
    const service = createService(queryRaw);
    const first = await service.listEmployeeUsage(tenantId, {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
      limit: 1,
      metric: 'tokens',
    });

    await expect(
      service.listEmployeeUsage(tenantId, {
        cursor: first.pagination.nextCursor ?? undefined,
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-14T00:00:00.000Z',
        metric: 'cost',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports hybrid provenance when covered and raw intervals are combined', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([coverageRow(2n, true)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([unattributedRow()]);
    const service = createService(queryRaw);

    const result = await service.listEmployeeUsage(tenantId, {
      from: '2026-07-13T00:30:00.000Z',
      to: '2026-07-14T00:30:00.000Z',
    });

    expect(result.provenance.source).toBe('hybrid');
    const unattributed = rawQuery(queryRaw.mock.calls[2]?.[0]);
    expect(unattributed.sql).toContain('project_rollup_attributed');
    expect(unattributed.sql).toContain('tenant_chat_rollup_total');
  });

  it('reads selected employee cost totals in one snapshot per period', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([usageRow(employeeA, 1n, 120n, 30n)])
      .mockResolvedValueOnce([usageRow(employeeA, 1n, 80n, 20n)]);
    const service = createService(queryRaw);

    const result = await service.readEmployeeCostTotals(
      tenantId,
      [employeeA],
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

    expect(result[0]?.get(employeeA)).toBe(30);
    expect(result[1]?.get(employeeA)).toBe(30);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of queryRaw.mock.calls) {
      const selected = rawQuery(query);
      expect(selected.sql).toContain('employee.id IN');
      expect(selected.values).toContain(employeeA);
    }
  });
});

function createService(queryRaw: jest.Mock) {
  const prisma = {
    $queryRaw: queryRaw,
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
    },
  } as unknown as PrismaService;
  return new EmployeeUsageService(prisma);
}

function usageRow(
  employeeId: string,
  rank: bigint,
  projectTokens: bigint,
  tenantChatTokens: bigint,
) {
  return {
    department: 'Platform',
    email: `${employeeId}@example.invalid`,
    employeeId,
    name: 'Employee',
    projectCostMicroUsd: 10n,
    projectInputTokens: projectTokens,
    projectOutputTokens: 0n,
    projectRequestCount: 3n,
    projectTotalTokens: projectTokens,
    rank,
    sortValue: projectTokens + tenantChatTokens,
    status: 'active',
    tenantChatCostMicroUsd: 20n,
    tenantChatInputTokens: tenantChatTokens,
    tenantChatOutputTokens: 0n,
    tenantChatRequestCount: 2n,
    tenantChatTotalTokens: tenantChatTokens,
  };
}

function unattributedRow() {
  return {
    projectCostMicroUsd: 1n,
    projectInputTokens: 5n,
    projectOutputTokens: 0n,
    projectRequestCount: 1n,
    projectSourceMaxAt: new Date('2026-07-13T23:59:59.000Z'),
    projectTotalTokens: 5n,
    tenantChatCostMicroUsd: 2n,
    tenantChatInputTokens: 7n,
    tenantChatOutputTokens: 0n,
    tenantChatRequestCount: 1n,
    tenantChatSourceMaxAt: new Date('2026-07-14T00:00:00.000Z'),
    tenantChatTotalTokens: 7n,
  };
}

function coverageRow(coveredBucketCount = 0n, hasRawUsage = false) {
  return { coveredBucketCount, hasRawUsage };
}

function rawQuery(value: unknown): { sql: string; values: unknown[] } {
  const query = value as { sql?: string; values?: unknown[] };
  return { sql: query.sql ?? '', values: query.values ?? [] };
}

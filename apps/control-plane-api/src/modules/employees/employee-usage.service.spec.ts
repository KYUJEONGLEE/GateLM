import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import type { ClickHouseEmployeeUsageReader } from './clickhouse-employee-usage.reader';
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

  it('uses ClickHouse for project usage without querying PostgreSQL invocation logs', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        employeeId: employeeA,
        requestCount: 2n,
        inputTokens: 10n,
        outputTokens: 5n,
        totalTokens: 15n,
        costMicroUsd: 4n,
        sourceMaxAt: new Date('2026-07-14T00:00:00.000Z'),
        hasRawUsage: true,
        hasRollupUsage: false,
      },
    ]);
    const reader = {
      isEnabled: jest.fn().mockReturnValue(true),
      readProjectUsage: jest.fn().mockResolvedValue({
        byEmployeeId: new Map([
          [
            employeeA,
            {
              requestCount: 3n,
              inputTokens: 100n,
              outputTokens: 20n,
              totalTokens: 120n,
              costMicroUsd: 10n,
            },
          ],
        ]),
        unattributed: {
          requestCount: 1n,
          inputTokens: 2n,
          outputTokens: 1n,
          totalTokens: 3n,
          costMicroUsd: 1n,
        },
        lastSourceAt: new Date('2026-07-13T23:59:59.000Z'),
      }),
    } as unknown as ClickHouseEmployeeUsageReader;
    const service = createClickHouseService(queryRaw, reader);

    const result = await service.listEmployeeUsage(tenantId, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
      limit: 10,
    });

    expect(result.data[0]).toMatchObject({
      employeeId: employeeA,
      total: { requestCount: 5, totalTokens: 135, costMicroUsd: 14 },
      sources: {
        projectApplication: { requestCount: 3, totalTokens: 120 },
        tenantChat: { requestCount: 2, totalTokens: 15 },
      },
    });
    expect(result.unattributed.sources.projectApplication).toMatchObject({
      requestCount: 1,
      totalTokens: 3,
    });
    expect(reader.readProjectUsage).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const tenantChat = rawQuery(queryRaw.mock.calls[0]?.[0]);
    expect(tenantChat.sql).toContain('FROM tenant_chat_invocation_logs');
    expect(tenantChat.sql).not.toContain('p0_llm_invocation_logs');
  });

  it('skips ClickHouse and PostgreSQL project logs for tenant-chat-only reads', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const reader = {
      isEnabled: jest.fn().mockReturnValue(true),
      readProjectUsage: jest.fn(),
    } as unknown as ClickHouseEmployeeUsageReader;
    const service = createClickHouseService(queryRaw, reader);

    await service.listEmployeeUsage(tenantId, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
      source: 'tenant_chat',
    });

    expect(reader.readProjectUsage).not.toHaveBeenCalled();
    expect(rawQuery(queryRaw.mock.calls[0]?.[0]).sql).not.toContain(
      'p0_llm_invocation_logs',
    );
  });

  it('returns the top 20 active employees and the viewer at the actual cost rank', async () => {
    const employeeIds = Array.from({ length: 21 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const analytics = employeeIds.map((employeeId, index) =>
      tenantChatAnalyticsRow(employeeId, {
        costMicroUsd: BigInt(21 - index),
        totalTokens: BigInt(100 + index),
      }),
    );
    analytics.push(tenantChatAnalyticsRow(
      '00000000-0000-4000-8000-000000000099',
      { costMicroUsd: 999n, totalTokens: 999n },
    ));
    const { prisma, service } = createTenantChatRankingService(
      analytics,
      employeeIds.map((id, index) => ({
        department: index === 20 ? ' 운영 ' : 'Platform',
        id,
        name: index === 20 ? ' 현재 사용자 ' : `Employee ${index + 1}`,
      })),
    );

    const result = await service.listTenantChatUsageRanking(
      tenantId,
      employeeIds[20],
      '30d',
      'cost',
      new Date('2026-07-23T12:00:00.000Z'),
    );

    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toMatchObject({
      displayName: 'Employee 1',
      estimatedCostMicroUsd: 21,
      rank: 1,
    });
    expect(result.rankedEmployeeCount).toBe(21);
    expect(result.viewer).toEqual({
      confirmedTotalTokens: 120,
      department: '운영',
      displayName: '현재 사용자',
      estimatedCostMicroUsd: 1,
      rank: 21,
    });
    expect(result.period).toEqual({
      from: '2026-06-23T12:00:00.000Z',
      timezone: 'UTC',
      to: '2026-07-23T12:00:00.000Z',
    });
    expect(result.provenance.source).toBe('raw');
    expect(prisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deletedAt: null,
        status: 'active',
        tenantId,
      }),
    }));
    const sql = rawQuery(prisma.$queryRaw.mock.calls[0]?.[0]).sql;
    expect(sql).toContain('logs.confirmed_total_tokens');
    expect(sql).toContain('logs.confirmed_cost_micro_usd');
    expect(sql).not.toContain('tenant_chat_usage_reservations');
  });

  it('sorts the same confirmed usage by tokens with a stable employee id tie-break', async () => {
    const employeeIds = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000012',
    ] as const;
    const { service } = createTenantChatRankingService(
      [
        tenantChatAnalyticsRow(employeeIds[0], { costMicroUsd: 100n, totalTokens: 20n }),
        tenantChatAnalyticsRow(employeeIds[1], { costMicroUsd: 1n, totalTokens: 20n }),
        tenantChatAnalyticsRow(employeeIds[2], { costMicroUsd: 200n, totalTokens: 10n }),
      ],
      employeeIds.map((id) => ({ department: null, id, name: id.slice(-2) })),
    );

    const result = await service.listTenantChatUsageRanking(
      tenantId,
      undefined,
      '7d',
      'tokens',
      new Date('2026-07-23T12:00:00.000Z'),
    );

    expect(result.items.map((row) => row.displayName)).toEqual(['10', '11', '12']);
    expect(result.viewer).toBeNull();
    expect(result.period.from).toBe('2026-07-16T12:00:00.000Z');
  });

  it('returns a null viewer rank for an active employee without usage', async () => {
    const viewerId = '00000000-0000-4000-8000-000000000030';
    const { service } = createTenantChatRankingService(
      [],
      [{ department: null, id: viewerId, name: null }],
    );

    const result = await service.listTenantChatUsageRanking(
      tenantId,
      viewerId,
      '24h',
      'cost',
      new Date('2026-07-23T12:00:00.000Z'),
    );

    expect(result.items).toEqual([]);
    expect(result.rankedEmployeeCount).toBe(0);
    expect(result.viewer).toEqual({
      confirmedTotalTokens: 0,
      department: null,
      displayName: '이름 미등록',
      estimatedCostMicroUsd: 0,
      rank: null,
    });
  });

  it('rejects a viewer employee that is not active in the same tenant', async () => {
    const { service } = createTenantChatRankingService(
      [],
      [],
    );

    await expect(service.listTenantChatUsageRanking(
      tenantId,
      '00000000-0000-4000-8000-000000000040',
      '30d',
      'cost',
    )).rejects.toBeInstanceOf(ForbiddenException);
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

function createClickHouseService(
  queryRaw: jest.Mock,
  reader: ClickHouseEmployeeUsageReader,
) {
  const prisma = {
    $queryRaw: queryRaw,
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: employeeA,
          userId: null,
          email: 'employee-a@example.invalid',
          name: 'Employee A',
          department: 'Platform',
          status: 'active',
        },
        {
          id: employeeB,
          userId: null,
          email: 'employee-b@example.invalid',
          name: 'Employee B',
          department: 'Platform',
          status: 'active',
        },
      ]),
    },
  } as unknown as PrismaService;
  return new EmployeeUsageService(prisma, reader);
}

function createTenantChatRankingService(
  analytics: ReturnType<typeof tenantChatAnalyticsRow>[],
  employees: Array<{ department: string | null; id: string; name: string | null }>,
) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(analytics),
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue(employees),
    },
  };
  return {
    prisma,
    service: new EmployeeUsageService(prisma as unknown as PrismaService),
  };
}

function tenantChatAnalyticsRow(
  employeeId: string,
  values: { costMicroUsd: bigint; totalTokens: bigint },
) {
  return {
    costMicroUsd: values.costMicroUsd,
    employeeId,
    hasRawUsage: true,
    hasRollupUsage: false,
    inputTokens: values.totalTokens,
    outputTokens: 0n,
    requestCount: 1n,
    sourceMaxAt: new Date('2026-07-23T11:59:00.000Z'),
    totalTokens: values.totalTokens,
  };
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

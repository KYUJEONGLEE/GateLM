import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import type { ClickHouseEmployeeUsageReader } from './clickhouse-employee-usage.reader';
import { EmployeeSecurityService } from './employee-security.service';

const tenantId = '00000000-0000-4000-8000-000000000100';
const employeeId = '00000000-0000-4000-8000-000000000101';

describe('EmployeeSecurityService', () => {
  it('returns actual masked and blocked request totals by employee', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        email: 'employee@example.invalid',
        employeeId,
        name: 'Employee',
        projectBlockedRequestCount: 1n,
        projectMaskedRequestCount: 2n,
        projectRequestCount: 7n,
        rank: 1n,
        status: 'active',
        tenantChatBlockedRequestCount: 3n,
        tenantChatMaskedRequestCount: 0n,
        tenantChatRequestCount: 5n,
      },
    ]);
    const service = createService(queryRaw);

    const result = await service.listEmployeeSecurity(tenantId, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
    });

    expect(result.data[0]).toMatchObject({
      employeeId,
      rank: 1,
      sources: {
        projectApplication: {
          blockedRequestCount: 1,
          maskedRequestCount: 2,
          protectedRequestCount: 3,
          requestCount: 7,
        },
        tenantChat: {
          blockedRequestCount: 3,
          maskedRequestCount: 0,
          protectedRequestCount: 3,
          requestCount: 5,
        },
      },
      total: {
        blockedRequestCount: 4,
        maskedRequestCount: 2,
        protectedRequestCount: 6,
        requestCount: 12,
      },
    });
  });

  it('enforces tenant scope and deterministic employee attribution in SQL', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const service = createService(queryRaw);

    await service.listEmployeeSecurity(tenantId, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
    });

    const query = rawQuery(queryRaw.mock.calls[0]?.[0]);
    expect(query.sql).toContain('WHERE "tenantId" =');
    expect(query.sql).toContain('WHERE log.tenant_id =');
    expect(query.sql).toContain('WHERE logs.tenant_id =');
    expect(query.sql).toContain('preferred_keys');
    expect(query.sql).toContain('WHERE candidate_count = 1');
    expect(query.sql).toContain('logs.employee_id IS NOT NULL');
    expect(query.sql).toContain("logs.terminal_outcome = 'safety_blocked'");
    expect(query.values.filter((value) => value === tenantId).length).toBeGreaterThan(2);
  });

  it('rejects periods longer than 31 days before reading security data', async () => {
    const queryRaw = jest.fn();
    const service = createService(queryRaw);

    await expect(
      service.listEmployeeSecurity(tenantId, {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-07-14T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('uses ClickHouse for Project/Application security without reading PostgreSQL logs', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { employeeId, requestCount: 2n, blockedRequestCount: 1n },
    ]);
    const reader = {
      isEnabled: jest.fn().mockReturnValue(true),
      readProjectSecurity: jest.fn().mockResolvedValue({
        byEmployeeId: new Map([
          [
            employeeId,
            {
              requestCount: 7n,
              maskedRequestCount: 2n,
              blockedRequestCount: 1n,
            },
          ],
        ]),
      }),
    } as unknown as ClickHouseEmployeeUsageReader;
    const service = createService(queryRaw, reader, [
      {
        id: employeeId,
        userId: null,
        email: 'employee@example.invalid',
        name: 'Employee',
        status: 'active',
      },
    ]);

    const result = await service.listEmployeeSecurity(tenantId, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
    });

    expect(result.data[0]).toMatchObject({
      employeeId,
      sources: {
        projectApplication: {
          requestCount: 7,
          maskedRequestCount: 2,
          blockedRequestCount: 1,
        },
        tenantChat: { requestCount: 2, blockedRequestCount: 1 },
      },
    });
    expect(reader.readProjectSecurity).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(rawQuery(queryRaw.mock.calls[0]?.[0]).sql).toContain(
      'FROM tenant_chat_invocation_logs',
    );
    expect(rawQuery(queryRaw.mock.calls[0]?.[0]).sql).not.toContain(
      'p0_llm_invocation_logs',
    );
  });
});

function createService(
  queryRaw: jest.Mock,
  reader?: ClickHouseEmployeeUsageReader,
  employees: Array<Record<string, unknown>> = [],
) {
  const prisma = {
    $queryRaw: queryRaw,
    employee: {
      findMany: jest.fn().mockResolvedValue(employees),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
    },
  } as unknown as PrismaService;
  return new EmployeeSecurityService(prisma, reader);
}

function rawQuery(value: unknown): { sql: string; values: unknown[] } {
  const query = value as { sql?: string; values?: unknown[] };
  return { sql: query.sql ?? '', values: query.values ?? [] };
}

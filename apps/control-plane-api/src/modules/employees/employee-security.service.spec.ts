import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

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
});

function createService(queryRaw: jest.Mock) {
  const prisma = {
    $queryRaw: queryRaw,
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
    },
  } as unknown as PrismaService;
  return new EmployeeSecurityService(prisma);
}

function rawQuery(value: unknown): { sql: string; values: unknown[] } {
  const query = value as { sql?: string; values?: unknown[] };
  return { sql: query.sql ?? '', values: query.values ?? [] };
}

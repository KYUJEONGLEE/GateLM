import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { TenantChatObservabilityService } from './tenant-chat-observability.service';

const tenantId = '00000000-0000-4000-8000-000000000100';

describe('TenantChatObservabilityService', () => {
  it('always scopes invocation lists to the requested tenant and surface', async () => {
    const prisma = createPrisma();
    prisma.tenantChatInvocationLog.findMany.mockResolvedValue([]);
    const service = new TenantChatObservabilityService(
      prisma as unknown as PrismaService,
    );

    await service.listInvocations(tenantId, { limit: 10 });

    expect(prisma.tenantChatInvocationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          surface: 'tenant_chat',
          executionScopeKind: 'tenant_chat',
        }),
      }),
    );
  });

  it('does not return a request detail from another tenant', async () => {
    const prisma = createPrisma();
    prisma.tenantChatInvocationLog.findFirst.mockResolvedValue(null);
    const service = new TenantChatObservabilityService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.getInvocation(tenantId, 'request_projection_001'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tenantChatInvocationLog.findFirst).toHaveBeenCalledWith({
      where: {
        requestId: 'request_projection_001',
        tenantId,
        surface: 'tenant_chat',
        executionScopeKind: 'tenant_chat',
      },
    });
  });

  it('returns tenant-scoped confirmed cost series points', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw.mockResolvedValue([
      {
        period_start: new Date('2026-07-12T12:00:00Z'),
        request_count: 2n,
        total_tokens: 300n,
        confirmed_cost_micro_usd: 450n,
      },
    ]);
    const service = new TenantChatObservabilityService(
      prisma as unknown as PrismaService,
    );

    const result = await service.getCostSeries(tenantId, {
      from: '2026-07-12T12:00:00Z',
      to: '2026-07-12T13:00:00Z',
      bucket: '5m',
    });

    expect(result.data).toMatchObject({
      surface: 'tenant_chat',
      bucket: '5m',
      points: [
        {
          periodStart: '2026-07-12T12:00:00.000Z',
          requestCount: 2,
          totalTokens: 300,
          confirmedCostMicroUsd: 450,
        },
      ],
    });
  });
});

function createPrisma() {
  return {
    $queryRaw: jest.fn(),
    tenantChatInvocationLog: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

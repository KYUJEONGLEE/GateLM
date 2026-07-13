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
});

function createPrisma() {
  return {
    tenantChatInvocationLog: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

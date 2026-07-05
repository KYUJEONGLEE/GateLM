import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ResourceStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { TenantsService } from './tenants.service';

describe('TenantsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000101';
  const createdAt = new Date('2026-07-01T00:00:00.000Z');

  function createService(): {
    service: TenantsService;
    prisma: {
      tenant: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
      };
    };
  } {
    const prisma = {
      tenant: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    return {
      service: new TenantsService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  function tenant(id: string) {
    return {
      id,
      name: `Tenant ${id}`,
      status: ResourceStatus.ACTIVE,
      totalBudgetUsd: new Prisma.Decimal(1000),
      createdAt,
      updatedAt: createdAt,
    };
  }

  it('creates an active tenant without exposing secrets', async () => {
    const { service, prisma } = createService();
    prisma.tenant.create.mockResolvedValue(tenant(tenantId));

    const result = await service.createTenant({ name: 'Acme Corp' });

    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Acme Corp', totalBudgetUsd: 1000 },
    });
    expect(result).toEqual({
      id: tenantId,
      name: `Tenant ${tenantId}`,
      status: ResourceStatus.ACTIVE,
      totalBudgetUsd: 1000,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('sets hasMore and nextCursor from limit plus one pagination', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findMany.mockResolvedValue([
      tenant('00000000-0000-4000-8000-000000000101'),
      tenant('00000000-0000-4000-8000-000000000102'),
      tenant('00000000-0000-4000-8000-000000000103'),
    ]);

    const result = await service.listTenants({ limit: 2 });

    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000102',
      hasMore: true,
    });
  });

  it('rejects tenant budget lower than active project allocations', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      projects: [
        { totalBudgetUsd: new Prisma.Decimal(80) },
        { totalBudgetUsd: new Prisma.Decimal(30) },
      ],
    });

    await expect(
      service.updateTenant(tenantId, { totalBudgetUsd: 100 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('updates tenant budget when it can cover active project allocations', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      projects: [{ totalBudgetUsd: new Prisma.Decimal(80) }],
    });
    prisma.tenant.update.mockResolvedValue({
      ...tenant(tenantId),
      totalBudgetUsd: new Prisma.Decimal(120),
    });

    const result = await service.updateTenant(tenantId, { totalBudgetUsd: 120 });

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: { totalBudgetUsd: 120 },
    });
    expect(result.totalBudgetUsd).toBe(120);
  });

  it('maps invalid cursor pagination failures to bad request', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Record to paginate over not found.',
        {
          code: 'P2025',
          clientVersion: 'test',
        },
      ),
    );

    await expect(
      service.listTenants({
        cursor: '00000000-0000-4000-8000-000000000999',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

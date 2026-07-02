import { BadRequestException } from '@nestjs/common';
import { Prisma, ResourceStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { TenantsService } from './tenants.service';

describe('TenantsService', () => {
  const createdAt = new Date('2026-07-01T00:00:00.000Z');

  function createService(): {
    service: TenantsService;
    prisma: {
      tenant: {
        create: jest.Mock;
        findMany: jest.Mock;
      };
    };
  } {
    const prisma = {
      tenant: {
        create: jest.fn(),
        findMany: jest.fn(),
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
      createdAt,
      updatedAt: createdAt,
    };
  }

  it('creates an active tenant without exposing secrets', async () => {
    const { service, prisma } = createService();
    prisma.tenant.create.mockResolvedValue(
      tenant('00000000-0000-4000-8000-000000000101'),
    );

    const result = await service.createTenant({ name: 'Acme Corp' });

    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Acme Corp' },
    });
    expect(result).toEqual({
      id: '00000000-0000-4000-8000-000000000101',
      name: 'Tenant 00000000-0000-4000-8000-000000000101',
      status: ResourceStatus.ACTIVE,
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

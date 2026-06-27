import { NotFoundException } from '@nestjs/common';
import { ResourceStatus } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');

  function createService(): {
    service: ProjectsService;
    prisma: {
      tenant: { findUnique: jest.Mock };
      project: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
      };
    };
  } {
    const prisma = {
      tenant: {
        findUnique: jest.fn(),
      },
      project: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    return {
      service: new ProjectsService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  function project(id: string) {
    return {
      id,
      tenantId,
      name: `Project ${id}`,
      description: null,
      status: ResourceStatus.ACTIVE,
      createdAt,
      updatedAt: createdAt,
    };
  }

  it('sets hasMore and nextCursor from limit plus one pagination', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.project.findMany.mockResolvedValue([
      project('00000000-0000-4000-8000-000000000201'),
      project('00000000-0000-4000-8000-000000000202'),
      project('00000000-0000-4000-8000-000000000203'),
    ]);

    const result = await service.listProjects(tenantId, { limit: 2 });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000202',
      hasMore: true,
    });
  });

  it('maps Prisma P2025 update failures to not found', async () => {
    const { service, prisma } = createService();
    prisma.project.update.mockRejectedValue(
      new PrismaClientKnownRequestError('No Project found.', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.updateProject('00000000-0000-4000-8000-000000000201', {
        name: 'Updated Project',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});

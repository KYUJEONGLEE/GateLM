import { NotFoundException } from '@nestjs/common';
import { ResourceStatus } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ApplicationsService } from './applications.service';

describe('ApplicationsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');

  function createService(): {
    service: ApplicationsService;
    prisma: {
      project: { findUnique: jest.Mock };
      application: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
      };
    };
  } {
    const prisma = {
      project: {
        findUnique: jest.fn(),
      },
      application: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    return {
      service: new ApplicationsService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  function application(id: string) {
    return {
      id,
      tenantId,
      projectId,
      name: `Application ${id}`,
      description: null,
      status: ResourceStatus.ACTIVE,
      createdAt,
      updatedAt: createdAt,
    };
  }

  it('sets hasMore and nextCursor from limit plus one pagination', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.application.findMany.mockResolvedValue([
      application('00000000-0000-4000-8000-000000000301'),
      application('00000000-0000-4000-8000-000000000302'),
      application('00000000-0000-4000-8000-000000000303'),
    ]);

    const result = await service.listApplications(projectId, { limit: 2 });

    expect(prisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000302',
      hasMore: true,
    });
  });

  it('maps Prisma P2025 update failures to not found', async () => {
    const { service, prisma } = createService();
    prisma.application.update.mockRejectedValue(
      new PrismaClientKnownRequestError('No Application found.', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.updateApplication('00000000-0000-4000-8000-000000000301', {
        name: 'Updated Application',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.application.findUnique).not.toHaveBeenCalled();
  });
});

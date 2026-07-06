import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, ResourceStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ApplicationsService } from './applications.service';

describe('ApplicationsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');

  type MockPrisma = {
    project: { findUnique: jest.Mock };
    application: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    applicationProviderConnection: { createMany: jest.Mock };
    providerConnection: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  function createService(): {
    service: ApplicationsService;
    prisma: MockPrisma;
  } {
    const prisma: MockPrisma = {
      project: {
        findUnique: jest.fn(),
      },
      application: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      applicationProviderConnection: {
        createMany: jest.fn(),
      },
      providerConnection: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));

    return {
      service: new ApplicationsService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  it('creates an application and links selected provider connections', async () => {
    const { service, prisma } = createService();
    const providerConnectionId = '00000000-0000-4000-8000-000000000601';
    const createdApplication = application(
      '00000000-0000-4000-8000-000000000301',
    );
    prisma.project.findUnique.mockResolvedValue({
      applications: [],
      id: projectId,
      tenantId,
      totalBudgetUsd: null,
    });
    prisma.providerConnection.findMany.mockResolvedValue([
      { id: providerConnectionId },
    ]);
    prisma.application.create.mockResolvedValue(createdApplication);

    const result = await service.createApplication(projectId, {
      budgetLimitUsd: 10,
      name: 'Support Chat',
      providerConnectionIds: [providerConnectionId],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.application.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Support Chat',
          projectId,
          tenantId,
        }),
      }),
    );
    expect(prisma.applicationProviderConnection.createMany).toHaveBeenCalledWith({
      data: [
        {
          applicationId: createdApplication.id,
          projectId,
          providerConnectionId,
          tenantId,
        },
      ],
      skipDuplicates: true,
    });
    expect(result.id).toBe(createdApplication.id);
  });

  it('rejects provider connections from another tenant before creating an application', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({
      applications: [],
      id: projectId,
      tenantId,
      totalBudgetUsd: null,
    });
    prisma.providerConnection.findMany.mockResolvedValue([]);

    await expect(
      service.createApplication(projectId, {
        name: 'Support Chat',
        providerConnectionIds: ['00000000-0000-4000-8000-000000000601'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  function application(id: string) {
    return {
      id,
      tenantId,
      projectId,
      name: `Application ${id}`,
      description: null,
      status: ResourceStatus.ACTIVE,
      budgetLimitMode: 'FIXED',
      budgetLimitPercent: null,
      budgetLimitUsd: null,
      createdAt,
      updatedAt: createdAt,
    };
  }

  it('sets hasMore and nextCursor from limit plus one pagination', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({
      id: projectId,
      tenantId,
      totalBudgetUsd: null,
    });
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
      new Prisma.PrismaClientKnownRequestError('No Application found.', {
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

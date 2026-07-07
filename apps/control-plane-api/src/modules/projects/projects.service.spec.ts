import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ResourceStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000201';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');
  const draftResourceStatus = 'DRAFT' as ResourceStatus;

  function createService(): {
    service: ProjectsService;
    prisma: {
      $transaction: jest.Mock;
      budgetAuditLog: { create: jest.Mock };
      application: { create: jest.Mock; findMany: jest.Mock };
      applicationProviderConnection: { createMany: jest.Mock };
      providerConnection: { findMany: jest.Mock };
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
      $transaction: jest.fn(),
      budgetAuditLog: {
        create: jest.fn(),
      },
      application: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      applicationProviderConnection: {
        createMany: jest.fn(),
      },
      providerConnection: {
        findMany: jest.fn(),
      },
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
    prisma.$transaction.mockImplementation((callback) => callback(prisma));

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
      totalBudgetUsd: new Prisma.Decimal(100),
      createdAt,
      updatedAt: createdAt,
    };
  }

  it('creates a project only when tenant budget can cover it', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      totalBudgetUsd: new Prisma.Decimal(150),
      projects: [{ totalBudgetUsd: new Prisma.Decimal(50) }],
    });
    prisma.project.create.mockResolvedValue(project(projectId));
    prisma.application.create.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000301',
    });

    const result = await service.createProject(tenantId, {
      name: 'New Project',
    });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        name: 'New Project',
        description: null,
        totalBudgetUsd: 100,
      },
    });
    expect(prisma.application.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        projectId,
        name: 'New Project',
        description: null,
        budgetLimitMode: 'PERCENT',
        budgetLimitPercent: 100,
        budgetLimitUsd: null,
      },
    });
    expect(result.totalBudgetUsd).toBe(100);
    expect(result.runtimeApplicationId).toBe(
      '00000000-0000-4000-8000-000000000301',
    );
  });

  it('creates a draft project without consuming tenant budget before activation', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      totalBudgetUsd: new Prisma.Decimal(100),
      projects: [{ totalBudgetUsd: new Prisma.Decimal(100) }],
    });
    prisma.project.create.mockResolvedValue({
      ...project(projectId),
      status: draftResourceStatus,
      totalBudgetUsd: new Prisma.Decimal(500),
    });
    prisma.application.create.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000301',
    });

    const result = await service.createProject(tenantId, {
      name: 'Draft Project',
      status: draftResourceStatus,
      totalBudgetUsd: 500,
    });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        name: 'Draft Project',
        description: null,
        status: draftResourceStatus,
        totalBudgetUsd: 500,
      },
    });
    expect(result.status).toBe(draftResourceStatus);
  });

  it('creates the hidden default runtime application with project values in the same transaction', async () => {
    const { service, prisma } = createService();
    const providerConnectionId = '00000000-0000-4000-8000-000000000601';
    const defaultApplicationId = '00000000-0000-4000-8000-000000000301';
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      totalBudgetUsd: new Prisma.Decimal(300),
      projects: [],
    });
    prisma.providerConnection.findMany.mockResolvedValue([
      { id: providerConnectionId },
    ]);
    prisma.project.create.mockResolvedValue({
      ...project(projectId),
      name: 'Operations',
      description: 'Ops runtime boundary',
      totalBudgetUsd: new Prisma.Decimal(200),
    });
    prisma.application.create.mockResolvedValue({
      id: defaultApplicationId,
      tenantId,
      projectId,
      name: 'Operations',
      description: 'Ops runtime boundary',
      status: ResourceStatus.ACTIVE,
      budgetLimitMode: 'PERCENT',
      budgetLimitPercent: new Prisma.Decimal(75),
      budgetLimitUsd: null,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await service.createProject(tenantId, {
      budgetLimitPercent: 75,
      description: 'Ops runtime boundary',
      name: 'Operations',
      providerConnectionIds: [providerConnectionId],
      totalBudgetUsd: 200,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        name: 'Operations',
        description: 'Ops runtime boundary',
        totalBudgetUsd: 200,
      },
    });
    expect(prisma.application.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        projectId,
        name: 'Operations',
        description: 'Ops runtime boundary',
        budgetLimitMode: 'PERCENT',
        budgetLimitPercent: 75,
        budgetLimitUsd: null,
      },
    });
    expect(prisma.applicationProviderConnection.createMany).toHaveBeenCalledWith({
      data: [
        {
          applicationId: defaultApplicationId,
          projectId,
          providerConnectionId,
          tenantId,
        },
      ],
      skipDuplicates: true,
    });
    expect(result.totalBudgetUsd).toBe(200);
    expect(result.runtimeApplicationId).toBe(defaultApplicationId);
  });

  it('rejects a project budget that exceeds the tenant budget', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      totalBudgetUsd: new Prisma.Decimal(120),
      projects: [{ totalBudgetUsd: new Prisma.Decimal(50) }],
    });

    await expect(
      service.createProject(tenantId, {
        name: 'Too Expensive',
        totalBudgetUsd: 80,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('sets hasMore and nextCursor from limit plus one pagination', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.project.findMany.mockResolvedValue([
      project('00000000-0000-4000-8000-000000000201'),
      project('00000000-0000-4000-8000-000000000202'),
      project('00000000-0000-4000-8000-000000000203'),
    ]);
    prisma.application.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000302',
        projectId: '00000000-0000-4000-8000-000000000202',
        status: ResourceStatus.DISABLED,
      },
      {
        id: '00000000-0000-4000-8000-000000000301',
        projectId: '00000000-0000-4000-8000-000000000201',
        status: ResourceStatus.ACTIVE,
      },
    ]);

    const result = await service.listProjects(tenantId, { limit: 2 });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(prisma.application.findMany).toHaveBeenCalledWith({
      where: {
        projectId: {
          in: [
            '00000000-0000-4000-8000-000000000201',
            '00000000-0000-4000-8000-000000000202',
          ],
        },
        status: {
          not: ResourceStatus.ARCHIVED,
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        projectId: true,
        status: true,
      },
    });
    expect(result.data).toHaveLength(2);
    expect(result.data.map((item) => item.runtimeApplicationId)).toEqual([
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
    ]);
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000202',
      hasMore: true,
    });
  });

  it('checks tenant budget when reactivating an archived project', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({
      ...project(projectId),
      status: ResourceStatus.ARCHIVED,
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      totalBudgetUsd: new Prisma.Decimal(150),
      projects: [{ totalBudgetUsd: new Prisma.Decimal(100) }],
    });

    await expect(
      service.updateProject(projectId, { status: ResourceStatus.ACTIVE }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('maps Prisma P2025 update failures to not found', async () => {
    const { service, prisma } = createService();
    prisma.project.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('No Project found.', {
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

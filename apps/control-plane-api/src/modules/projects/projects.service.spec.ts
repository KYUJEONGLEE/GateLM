import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ResourceStatus } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000201';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');

  function createService(): {
    service: ProjectsService;
    prisma: {
      $transaction: jest.Mock;
      budgetAuditLog: { create: jest.Mock };
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
    expect(result.totalBudgetUsd).toBe(100);
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

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Project, ResourceStatus } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from './dto/project.dto';

const DEFAULT_TENANT_BUDGET_USD = 1000;
const DEFAULT_PROJECT_BUDGET_USD = 100;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(
    tenantId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const totalBudgetUsd = dto.totalBudgetUsd ?? DEFAULT_PROJECT_BUDGET_USD;

    await this.assertTenantBudgetCanCoverProjects({
      tenantId,
      projectId: null,
      totalBudgetUsd,
      status: ResourceStatus.ACTIVE,
    });

    const project = await this.prisma.project.create({
      data: {
        tenantId,
        name: dto.name,
        description: this.toNullableDescription(dto.description),
        totalBudgetUsd,
      },
    });

    return this.toProjectResponse(project);
  }

  async listProjects(
    tenantId: string,
    query: ListProjectsQueryDto,
  ): Promise<ListEnvelope<ProjectResponseDto>> {
    await this.assertTenantExists(tenantId);

    const limit = query.limit ?? 50;
    const projects = await this.prisma.project.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = projects.length > limit;
    const page = projects.slice(0, limit);

    return {
      data: page.map((project) => this.toProjectResponse(project)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async updateProject(
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    const data: Prisma.ProjectUpdateInput = {};
    let current: Project | null = null;

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.description !== undefined) {
      data.description = this.toNullableDescription(dto.description);
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.totalBudgetUsd !== undefined || dto.status !== undefined) {
      current = await this.getProjectEntityOrThrow(projectId);
      const nextTotalBudgetUsd =
        dto.totalBudgetUsd ?? this.toProjectBudgetUsd(current.totalBudgetUsd);
      const nextStatus = dto.status ?? current.status;

      if (dto.totalBudgetUsd !== undefined) {
        await this.assertProjectBudgetCanCoverApplications(
          projectId,
          nextTotalBudgetUsd,
        );
        data.totalBudgetUsd = nextTotalBudgetUsd;
      }

      await this.assertTenantBudgetCanCoverProjects({
        tenantId: current.tenantId,
        projectId,
        totalBudgetUsd: nextTotalBudgetUsd,
        status: nextStatus,
      });
    }

    if (Object.keys(data).length === 0) {
      return current
        ? this.toProjectResponse(current)
        : this.getProjectOrThrow(projectId);
    }

    try {
      const project = await this.prisma.project.update({
        where: { id: projectId },
        data,
      });

      return this.toProjectResponse(project);
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('Project not found.');
      }

      throw error;
    }
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }
  }

  private async getProjectOrThrow(projectId: string): Promise<ProjectResponseDto> {
    return this.toProjectResponse(await this.getProjectEntityOrThrow(projectId));
  }

  private async getProjectEntityOrThrow(projectId: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private toNullableDescription(value: string | undefined): string | null {
    return value && value.length > 0 ? value : null;
  }

  private async assertTenantBudgetCanCoverProjects(args: {
    tenantId: string;
    projectId: string | null;
    totalBudgetUsd: number;
    status: ResourceStatus;
  }): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: {
        id: true,
        totalBudgetUsd: true,
        projects: {
          where: {
            ...(args.projectId
              ? {
                  id: {
                    not: args.projectId,
                  },
                }
              : {}),
            status: {
              not: 'ARCHIVED',
            },
          },
          select: {
            totalBudgetUsd: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }

    const tenantBudgetUsd =
      this.toNumber(tenant.totalBudgetUsd) ?? DEFAULT_TENANT_BUDGET_USD;
    const existingBudgetUsd = tenant.projects.reduce(
      (total, project) =>
        total + this.toProjectBudgetUsd(project.totalBudgetUsd),
      0,
    );
    const nextBudgetUsd =
      args.status === ResourceStatus.ARCHIVED
        ? 0
        : Math.max(0, args.totalBudgetUsd);

    if (existingBudgetUsd + nextBudgetUsd > tenantBudgetUsd) {
      throw new ConflictException('Project budgets exceed the tenant budget.');
    }
  }

  private async assertProjectBudgetCanCoverApplications(
    projectId: string,
    totalBudgetUsd: number,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        applications: {
          where: {
            status: {
              not: 'ARCHIVED',
            },
          },
          select: {
            budgetLimitMode: true,
            budgetLimitPercent: true,
            budgetLimitUsd: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const allocatedBudgetUsd = project.applications.reduce(
      (total, application) =>
        total +
        this.getApplicationBudgetLimitUsd({
          budgetLimitMode: application.budgetLimitMode,
          budgetLimitPercent: this.toNumber(application.budgetLimitPercent),
          budgetLimitUsd: this.toNumber(application.budgetLimitUsd),
          projectBudgetUsd: totalBudgetUsd,
        }),
      0,
    );

    if (allocatedBudgetUsd > totalBudgetUsd) {
      throw new ConflictException(
        'Application budgets exceed the project budget.',
      );
    }
  }

  private getApplicationBudgetLimitUsd(args: {
    budgetLimitMode: string;
    budgetLimitPercent: number | null;
    budgetLimitUsd: number | null;
    projectBudgetUsd: number;
  }): number {
    if (args.budgetLimitMode === 'PERCENT') {
      return (
        args.projectBudgetUsd *
        Math.max(0, Math.min(args.budgetLimitPercent ?? 0, 100)) /
        100
      );
    }

    return Math.max(0, args.budgetLimitUsd ?? 0);
  }

  private toProjectBudgetUsd(value: Prisma.Decimal | null | undefined): number {
    return this.toNumber(value) ?? DEFAULT_PROJECT_BUDGET_USD;
  }

  private toNumber(value: Prisma.Decimal | null | undefined): number | null {
    return value === null || value === undefined ? null : value.toNumber();
  }

  private isRecordNotFoundError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }

  private toProjectResponse(project: Project): ProjectResponseDto {
    return {
      id: project.id,
      tenantId: project.tenantId,
      name: project.name,
      description: project.description,
      status: project.status,
      totalBudgetUsd: this.toProjectBudgetUsd(project.totalBudgetUsd),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from './dto/project.dto';

const DEFAULT_PROJECT_BUDGET_USD = 100;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(
    tenantId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    await this.assertTenantExists(tenantId);

    const project = await this.prisma.project.create({
      data: {
        tenantId,
        name: dto.name,
        description: this.toNullableDescription(dto.description),
        totalBudgetUsd: dto.totalBudgetUsd ?? DEFAULT_PROJECT_BUDGET_USD,
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

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.description !== undefined) {
      data.description = this.toNullableDescription(dto.description);
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.totalBudgetUsd !== undefined) {
      await this.assertProjectBudgetCanCoverApplications(
        projectId,
        dto.totalBudgetUsd,
      );
      data.totalBudgetUsd = dto.totalBudgetUsd;
    }

    if (Object.keys(data).length === 0) {
      return this.getProjectOrThrow(projectId);
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
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return this.toProjectResponse(project);
  }

  private toNullableDescription(value: string | undefined): string | null {
    return value && value.length > 0 ? value : null;
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
      totalBudgetUsd:
        this.toNumber(project.totalBudgetUsd) ?? DEFAULT_PROJECT_BUDGET_USD,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

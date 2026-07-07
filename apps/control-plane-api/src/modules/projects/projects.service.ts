import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Application, Prisma, Project, ResourceStatus } from '@prisma/client';

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
const DEFAULT_RUNTIME_BUDGET_LIMIT_PERCENT = 100;

type RuntimeApplicationProjection = Pick<
  Application,
  'id' | 'projectId' | 'status'
>;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(
    tenantId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const totalBudgetUsd = dto.totalBudgetUsd ?? DEFAULT_PROJECT_BUDGET_USD;
    const budgetLimitPercent =
      dto.budgetLimitPercent ?? DEFAULT_RUNTIME_BUDGET_LIMIT_PERCENT;
    const status = dto.status ?? ResourceStatus.ACTIVE;
    const providerConnectionIds = await this.getValidProviderConnectionIdsOrThrow(
      tenantId,
      dto.providerConnectionIds ?? [],
    );

    await this.assertTenantBudgetCanCoverProjects({
      tenantId,
      projectId: null,
      totalBudgetUsd,
      status,
    });

    const { project, runtimeApplicationId } = await this.prisma.$transaction(
      async (tx) => {
        const createdProject = await tx.project.create({
          data: {
            tenantId,
            name: dto.name,
            description: this.toNullableDescription(dto.description),
            ...(status !== ResourceStatus.ACTIVE ? { status } : {}),
            totalBudgetUsd,
          },
        });
        const runtimeApplication = await tx.application.create({
          data: {
            tenantId,
            projectId: createdProject.id,
            name: dto.name,
            description: this.toNullableDescription(dto.description),
            budgetLimitMode: 'PERCENT',
            budgetLimitPercent,
            budgetLimitUsd: null,
          },
        });

        if (providerConnectionIds.length > 0) {
          await tx.applicationProviderConnection.createMany({
            data: providerConnectionIds.map((providerConnectionId) => ({
              applicationId: runtimeApplication.id,
              projectId: createdProject.id,
              providerConnectionId,
              tenantId,
            })),
            skipDuplicates: true,
          });
        }

        return {
          project: createdProject,
          runtimeApplicationId: runtimeApplication.id,
        };
      },
    );

    return this.toProjectResponse(project, runtimeApplicationId);
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
    const runtimeApplicationIdsByProjectId =
      await this.getRuntimeApplicationIdsByProjectIds(
        page.map((project) => project.id),
      );

    return {
      data: page.map((project) =>
        this.toProjectResponse(
          project,
          runtimeApplicationIdsByProjectId.get(project.id) ?? null,
        ),
      ),
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
        ? this.toProjectResponseWithRuntimeApplication(current)
        : this.getProjectOrThrow(projectId);
    }

    try {
      const oldTotalBudgetUsd = current
        ? this.toProjectBudgetUsd(current.totalBudgetUsd)
        : null;
      const newTotalBudgetUsd =
        dto.totalBudgetUsd !== undefined
          ? dto.totalBudgetUsd
          : oldTotalBudgetUsd;
      const shouldAuditBudgetChange =
        oldTotalBudgetUsd !== null &&
        newTotalBudgetUsd !== null &&
        dto.totalBudgetUsd !== undefined &&
        oldTotalBudgetUsd !== newTotalBudgetUsd;

      const project = await this.prisma.$transaction(async (tx) => {
        const updatedProject = await tx.project.update({
          where: { id: projectId },
          data,
        });

        if (shouldAuditBudgetChange) {
          await tx.budgetAuditLog.create({
            data: {
              tenantId: updatedProject.tenantId,
              projectId: updatedProject.id,
              budgetScopeType: 'project',
              budgetScopeId: updatedProject.id,
              action: 'budget_updated',
              actorType: 'admin_placeholder',
              oldLimitMicroUsd: this.usdToMicroUsd(oldTotalBudgetUsd as number),
              newLimitMicroUsd: this.usdToMicroUsd(newTotalBudgetUsd as number),
              metadata: {
                field: 'totalBudgetUsd',
                source: 'control_plane_project_update',
              },
            },
          });
        }

        return updatedProject;
      });

      return this.toProjectResponseWithRuntimeApplication(project);
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
    return this.toProjectResponseWithRuntimeApplication(
      await this.getProjectEntityOrThrow(projectId),
    );
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

  private async getValidProviderConnectionIdsOrThrow(
    tenantId: string,
    rawProviderConnectionIds: string[],
  ): Promise<string[]> {
    const providerConnectionIds = [...new Set(rawProviderConnectionIds)];

    if (providerConnectionIds.length === 0) {
      return [];
    }

    const providers = await this.prisma.providerConnection.findMany({
      where: {
        id: { in: providerConnectionIds },
        projectId: null,
        tenantId,
      },
      select: { id: true },
    });

    if (providers.length !== providerConnectionIds.length) {
      throw new BadRequestException(
        'Runtime providers must reference tenant-level providers from the same tenant.',
      );
    }

    return providerConnectionIds;
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
              notIn: [ResourceStatus.ARCHIVED, ResourceStatus.DRAFT],
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
      args.status === ResourceStatus.ARCHIVED ||
      args.status === ResourceStatus.DRAFT
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
    return Math.max(0, this.toNumber(value) ?? DEFAULT_PROJECT_BUDGET_USD);
  }

  private toNumber(value: Prisma.Decimal | null | undefined): number | null {
    return value === null || value === undefined ? null : value.toNumber();
  }

  private usdToMicroUsd(value: number): bigint {
    return BigInt(Math.round(value * 1_000_000));
  }

  private isRecordNotFoundError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }

  private async toProjectResponseWithRuntimeApplication(
    project: Project,
  ): Promise<ProjectResponseDto> {
    const runtimeApplicationIdsByProjectId =
      await this.getRuntimeApplicationIdsByProjectIds([project.id]);

    return this.toProjectResponse(
      project,
      runtimeApplicationIdsByProjectId.get(project.id) ?? null,
    );
  }

  private async getRuntimeApplicationIdsByProjectIds(
    projectIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueProjectIds = [...new Set(projectIds)].filter(Boolean);

    if (uniqueProjectIds.length === 0) {
      return new Map();
    }

    const applications = await this.prisma.application.findMany({
      where: {
        projectId: {
          in: uniqueProjectIds,
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

    return this.toRuntimeApplicationIdMap(applications);
  }

  private toRuntimeApplicationIdMap(
    applications: RuntimeApplicationProjection[],
  ): Map<string, string> {
    const selectedByProjectId = new Map<string, RuntimeApplicationProjection>();

    for (const application of applications) {
      if (!application.projectId) {
        continue;
      }

      const current = selectedByProjectId.get(application.projectId);

      if (
        !current ||
        (current.status !== ResourceStatus.ACTIVE &&
          application.status === ResourceStatus.ACTIVE)
      ) {
        selectedByProjectId.set(application.projectId, application);
      }
    }

    return new Map(
      [...selectedByProjectId.entries()].map(([projectId, application]) => [
        projectId,
        application.id,
      ]),
    );
  }

  private toProjectResponse(
    project: Project,
    runtimeApplicationId: string | null,
  ): ProjectResponseDto {
    return {
      id: project.id,
      tenantId: project.tenantId,
      name: project.name,
      description: project.description,
      status: project.status,
      totalBudgetUsd: this.toProjectBudgetUsd(project.totalBudgetUsd),
      runtimeApplicationId,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

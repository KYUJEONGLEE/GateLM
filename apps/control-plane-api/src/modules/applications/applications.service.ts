import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Application, Prisma } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ApplicationResponseDto,
  ApplicationBudgetLimitModeDto,
  CreateApplicationDto,
  ListApplicationsQueryDto,
  UpdateApplicationDto,
} from './dto/application.dto';

const DEFAULT_PROJECT_BUDGET_USD = 100;

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createApplication(
    projectId: string,
    dto: CreateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const budgetValues = this.resolveCreateBudgetValues(dto);
    await this.assertApplicationBudgetCanFitProject({
      applicationId: null,
      budgetLimitMode: budgetValues.budgetLimitMode,
      budgetLimitPercent: budgetValues.budgetLimitPercent,
      budgetLimitUsd: budgetValues.budgetLimitUsd,
      projectId: project.id,
      status: 'ACTIVE',
    });

    const application = await this.prisma.application.create({
      data: {
        tenantId: project.tenantId,
        projectId: project.id,
        name: dto.name,
        description: this.toNullableDescription(dto.description),
        budgetLimitMode: budgetValues.budgetLimitMode,
        budgetLimitUsd: budgetValues.budgetLimitUsd,
        budgetLimitPercent: budgetValues.budgetLimitPercent,
      },
    });

    return this.toApplicationResponse(
      application,
      this.toProjectBudgetUsd(project.totalBudgetUsd),
    );
  }

  async listApplications(
    projectId: string,
    query: ListApplicationsQueryDto,
  ): Promise<ListEnvelope<ApplicationResponseDto>> {
    const project = await this.getProjectOrThrow(projectId);
    const projectBudgetUsd = this.toProjectBudgetUsd(project.totalBudgetUsd);

    const limit = query.limit ?? 50;
    const applications = await this.prisma.application.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = applications.length > limit;
    const page = applications.slice(0, limit);

    return {
      data: page.map((application) =>
        this.toApplicationResponse(application, projectBudgetUsd),
      ),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async updateApplication(
    applicationId: string,
    dto: UpdateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    const data: Prisma.ApplicationUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.description !== undefined) {
      data.description = this.toNullableDescription(dto.description);
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (
      dto.budgetLimitMode !== undefined ||
      dto.budgetLimitUsd !== undefined ||
      dto.budgetLimitPercent !== undefined ||
      dto.status !== undefined
    ) {
      const current = await this.getApplicationEntityOrThrow(applicationId);
      const budgetValues = this.resolveUpdateBudgetValues(current, dto);

      await this.assertApplicationBudgetCanFitProject({
        applicationId,
        budgetLimitMode: budgetValues.budgetLimitMode,
        budgetLimitPercent: budgetValues.budgetLimitPercent,
        budgetLimitUsd: budgetValues.budgetLimitUsd,
        projectId: current.projectId,
        status: dto.status ?? current.status,
      });

      data.budgetLimitMode = budgetValues.budgetLimitMode;
      data.budgetLimitUsd = budgetValues.budgetLimitUsd;
      data.budgetLimitPercent = budgetValues.budgetLimitPercent;
    }

    if (Object.keys(data).length === 0) {
      return this.getApplicationOrThrow(applicationId);
    }

    try {
      const application = await this.prisma.application.update({
        where: { id: applicationId },
        data,
      });
      const project = await this.getProjectOrThrow(application.projectId);

      return this.toApplicationResponse(
        application,
        this.toProjectBudgetUsd(project.totalBudgetUsd),
      );
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('Application not found.');
      }

      throw error;
    }
  }

  private async getProjectOrThrow(
    projectId: string,
  ): Promise<{ id: string; tenantId: string; totalBudgetUsd: Prisma.Decimal | null }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, tenantId: true, totalBudgetUsd: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private async getApplicationOrThrow(
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    const application = await this.getApplicationEntityOrThrow(applicationId);
    const project = await this.getProjectOrThrow(application.projectId);

    return this.toApplicationResponse(
      application,
      this.toProjectBudgetUsd(project.totalBudgetUsd),
    );
  }

  private async getApplicationEntityOrThrow(
    applicationId: string,
  ): Promise<Application> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });

    if (!application) {
      throw new NotFoundException('Application not found.');
    }

    return application;
  }

  private toNullableDescription(value: string | undefined): string | null {
    return value && value.length > 0 ? value : null;
  }

  private isRecordNotFoundError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }

  private resolveCreateBudgetValues(dto: CreateApplicationDto): {
    budgetLimitMode: ApplicationBudgetLimitModeDto;
    budgetLimitPercent: number | null;
    budgetLimitUsd: number | null;
  } {
    const budgetLimitMode = dto.budgetLimitMode ?? 'FIXED';

    return this.normalizeBudgetValues({
      budgetLimitMode,
      budgetLimitPercent: dto.budgetLimitPercent ?? null,
      budgetLimitUsd: dto.budgetLimitUsd ?? null,
    });
  }

  private resolveUpdateBudgetValues(
    current: Application,
    dto: UpdateApplicationDto,
  ): {
    budgetLimitMode: ApplicationBudgetLimitModeDto;
    budgetLimitPercent: number | null;
    budgetLimitUsd: number | null;
  } {
    const budgetLimitMode = this.normalizeBudgetLimitMode(
      dto.budgetLimitMode ?? current.budgetLimitMode,
    );

    return this.normalizeBudgetValues({
      budgetLimitMode,
      budgetLimitPercent:
        dto.budgetLimitPercent ?? this.toNumber(current.budgetLimitPercent),
      budgetLimitUsd: dto.budgetLimitUsd ?? this.toNumber(current.budgetLimitUsd),
    });
  }

  private normalizeBudgetValues(args: {
    budgetLimitMode: ApplicationBudgetLimitModeDto;
    budgetLimitPercent: number | null;
    budgetLimitUsd: number | null;
  }): {
    budgetLimitMode: ApplicationBudgetLimitModeDto;
    budgetLimitPercent: number | null;
    budgetLimitUsd: number | null;
  } {
    if (args.budgetLimitMode === 'PERCENT') {
      return {
        budgetLimitMode: 'PERCENT',
        budgetLimitPercent: args.budgetLimitPercent ?? 0,
        budgetLimitUsd: null,
      };
    }

    return {
      budgetLimitMode: 'FIXED',
      budgetLimitPercent: null,
      budgetLimitUsd: args.budgetLimitUsd ?? 0,
    };
  }

  private normalizeBudgetLimitMode(
    value: string,
  ): ApplicationBudgetLimitModeDto {
    return value === 'PERCENT' ? 'PERCENT' : 'FIXED';
  }

  private async assertApplicationBudgetCanFitProject(args: {
    applicationId: string | null;
    budgetLimitMode: ApplicationBudgetLimitModeDto;
    budgetLimitPercent: number | null;
    budgetLimitUsd: number | null;
    projectId: string;
    status: Application['status'];
  }): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: args.projectId },
      select: {
        totalBudgetUsd: true,
        applications: {
          where: {
            ...(args.applicationId
              ? {
                  id: {
                    not: args.applicationId,
                  },
                }
              : {}),
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

    const projectBudgetUsd =
      this.toNumber(project.totalBudgetUsd) ?? DEFAULT_PROJECT_BUDGET_USD;
    const existingBudgetUsd = project.applications.reduce(
      (total, application) =>
        total +
        this.getApplicationBudgetLimitUsd({
          budgetLimitMode: this.normalizeBudgetLimitMode(
            application.budgetLimitMode,
          ),
          budgetLimitPercent: this.toNumber(application.budgetLimitPercent),
          budgetLimitUsd: this.toNumber(application.budgetLimitUsd),
          projectBudgetUsd,
        }),
      0,
    );
    const nextBudgetUsd =
      args.status === 'ARCHIVED'
        ? 0
        : this.getApplicationBudgetLimitUsd({
            budgetLimitMode: args.budgetLimitMode,
            budgetLimitPercent: args.budgetLimitPercent,
            budgetLimitUsd: args.budgetLimitUsd,
            projectBudgetUsd,
          });

    if (existingBudgetUsd + nextBudgetUsd > projectBudgetUsd) {
      throw new ConflictException(
        'Application budgets exceed the project budget.',
      );
    }
  }

  private getApplicationBudgetLimitUsd(args: {
    budgetLimitMode: ApplicationBudgetLimitModeDto;
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

  private toProjectBudgetUsd(value: Prisma.Decimal | null | undefined): number {
    return this.toNumber(value) ?? DEFAULT_PROJECT_BUDGET_USD;
  }

  private toApplicationResponse(
    application: Application,
    projectBudgetUsd: number,
  ): ApplicationResponseDto {
    return {
      id: application.id,
      tenantId: application.tenantId,
      projectId: application.projectId,
      name: application.name,
      description: application.description,
      status: application.status,
      budgetLimitMode: this.normalizeBudgetLimitMode(
        application.budgetLimitMode,
      ),
      budgetLimitUsd: this.toNumber(application.budgetLimitUsd),
      budgetLimitPercent: this.toNumber(application.budgetLimitPercent),
      effectiveBudgetLimitUsd: this.getApplicationBudgetLimitUsd({
        budgetLimitMode: this.normalizeBudgetLimitMode(
          application.budgetLimitMode,
        ),
        budgetLimitPercent: this.toNumber(application.budgetLimitPercent),
        budgetLimitUsd: this.toNumber(application.budgetLimitUsd),
        projectBudgetUsd,
      }),
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }

}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Application, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ApplicationResponseDto,
  CreateApplicationDto,
  ListApplicationsQueryDto,
  UpdateApplicationDto,
} from './dto/application.dto';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createApplication(
    projectId: string,
    dto: CreateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const application = await this.prisma.application.create({
      data: {
        tenantId: project.tenantId,
        projectId: project.id,
        name: dto.name,
        description: this.toNullableDescription(dto.description),
      },
    });

    return this.toApplicationResponse(application);
  }

  async listApplications(
    projectId: string,
    query: ListApplicationsQueryDto,
  ): Promise<ListEnvelope<ApplicationResponseDto>> {
    await this.getProjectOrThrow(projectId);

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
        this.toApplicationResponse(application),
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

    if (Object.keys(data).length === 0) {
      return this.getApplicationOrThrow(applicationId);
    }

    try {
      const application = await this.prisma.application.update({
        where: { id: applicationId },
        data,
      });

      return this.toApplicationResponse(application);
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('Application not found.');
      }

      throw error;
    }
  }

  private async getProjectOrThrow(
    projectId: string,
  ): Promise<{ id: string; tenantId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, tenantId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private async getApplicationOrThrow(
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });

    if (!application) {
      throw new NotFoundException('Application not found.');
    }

    return this.toApplicationResponse(application);
  }

  private toNullableDescription(value: string | undefined): string | null {
    return value && value.length > 0 ? value : null;
  }

  private isRecordNotFoundError(
    error: unknown,
  ): error is PrismaClientKnownRequestError {
    return (
      error instanceof PrismaClientKnownRequestError && error.code === 'P2025'
    );
  }

  private toApplicationResponse(
    application: Application,
  ): ApplicationResponseDto {
    return {
      id: application.id,
      tenantId: application.tenantId,
      projectId: application.projectId,
      name: application.name,
      description: application.description,
      status: application.status,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }
}

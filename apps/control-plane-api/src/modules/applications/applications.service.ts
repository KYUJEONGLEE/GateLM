import { Injectable, NotFoundException } from '@nestjs/common';
import { Application, Prisma } from '@prisma/client';

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
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return {
      data: applications.map((application) =>
        this.toApplicationResponse(application),
      ),
      pagination: {
        limit,
        nextCursor: null,
        hasMore: false,
      },
    };
  }

  async updateApplication(
    applicationId: string,
    dto: UpdateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    await this.assertApplicationExists(applicationId);

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

    const application = await this.prisma.application.update({
      where: { id: applicationId },
      data,
    });

    return this.toApplicationResponse(application);
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

  private async assertApplicationExists(applicationId: string): Promise<void> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true },
    });

    if (!application) {
      throw new NotFoundException('Application not found.');
    }
  }

  private toNullableDescription(value: string | undefined): string | null {
    return value && value.length > 0 ? value : null;
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

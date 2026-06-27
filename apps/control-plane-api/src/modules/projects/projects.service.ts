import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from './dto/project.dto';

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
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return {
      data: projects.map((project) => this.toProjectResponse(project)),
      pagination: {
        limit,
        nextCursor: null,
        hasMore: false,
      },
    };
  }

  async updateProject(
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    await this.assertProjectExists(projectId);

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

    if (Object.keys(data).length === 0) {
      return this.getProjectOrThrow(projectId);
    }

    const project = await this.prisma.project.update({
      where: { id: projectId },
      data,
    });

    return this.toProjectResponse(project);
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

  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
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

  private toProjectResponse(project: Project): ProjectResponseDto {
    return {
      id: project.id,
      tenantId: project.tenantId,
      name: project.name,
      description: project.description,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

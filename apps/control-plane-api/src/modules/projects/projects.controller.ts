import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { ProjectsService } from './projects.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post('tenants/:tenantId/projects')
  async createProject(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: CreateProjectDto,
  ): Promise<DataEnvelope<ProjectResponseDto>> {
    return {
      data: await this.projectsService.createProject(tenantId, body),
    };
  }

  @Get('tenants/:tenantId/projects')
  async listProjects(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListProjectsQueryDto,
  ): Promise<ListEnvelope<ProjectResponseDto>> {
    return this.projectsService.listProjects(tenantId, query);
  }

  @Patch('projects/:projectId')
  async updateProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: UpdateProjectDto,
  ): Promise<DataEnvelope<ProjectResponseDto>> {
    return {
      data: await this.projectsService.updateProject(projectId, body),
    };
  }
}

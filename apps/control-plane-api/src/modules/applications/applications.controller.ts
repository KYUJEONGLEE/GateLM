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

import { ApplicationsService } from './applications.service';
import {
  ApplicationResponseDto,
  CreateApplicationDto,
  ListApplicationsQueryDto,
  UpdateApplicationDto,
} from './dto/application.dto';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post('projects/:projectId/applications')
  async createApplication(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateApplicationDto,
  ): Promise<DataEnvelope<ApplicationResponseDto>> {
    return {
      data: await this.applicationsService.createApplication(projectId, body),
    };
  }

  @Get('projects/:projectId/applications')
  async listApplications(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<ListEnvelope<ApplicationResponseDto>> {
    return this.applicationsService.listApplications(projectId, query);
  }

  @Patch('applications/:applicationId')
  async updateApplication(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: UpdateApplicationDto,
  ): Promise<DataEnvelope<ApplicationResponseDto>> {
    return {
      data: await this.applicationsService.updateApplication(
        applicationId,
        body,
      ),
    };
  }
}

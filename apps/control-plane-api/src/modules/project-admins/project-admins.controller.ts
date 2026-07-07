import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import {
  CreateProjectAdminInvitationDto,
  ProjectAdminInvitationResponseDto,
  ProjectAdminListItemDto,
} from './dto/project-admin-invitation.dto';
import { ProjectAdminsService } from './project-admins.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class ProjectAdminsController {
  constructor(private readonly projectAdminsService: ProjectAdminsService) {}

  @Get('projects/:projectId/project-admins')
  async listProjectAdmins(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ListEnvelope<ProjectAdminListItemDto>> {
    const data = await this.projectAdminsService.listProjectAdmins(projectId);

    return {
      data,
      pagination: {
        hasMore: false,
        limit: data.length,
        nextCursor: null,
      },
    };
  }

  @Post('projects/:projectId/project-admin-invitations')
  async createProjectAdminInvitation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateProjectAdminInvitationDto,
  ): Promise<DataEnvelope<ProjectAdminInvitationResponseDto>> {
    return {
      data: await this.projectAdminsService.createProjectAdminInvitation(
        projectId,
        body,
      ),
    };
  }

  @Delete('projects/:projectId/project-admins/:userId')
  async removeProjectAdmin(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<DataEnvelope<ProjectAdminListItemDto>> {
    return {
      data: await this.projectAdminsService.removeProjectAdmin(projectId, userId),
    };
  }

  @Post('project-admin-invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeProjectAdminInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<DataEnvelope<ProjectAdminListItemDto>> {
    return {
      data: await this.projectAdminsService.revokeProjectAdminInvitation(invitationId),
    };
  }
}
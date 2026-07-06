import {
  Body,
  Controller,
  Delete,
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
  AttachProjectTeamDto,
  CreateTeamDto,
  ListTeamsQueryDto,
  ProjectTeamResponseDto,
  TeamResponseDto,
  UpdateTeamDto,
} from './dto/team.dto';
import { TeamsService } from './teams.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post('tenants/:tenantId/teams')
  async createTeam(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: CreateTeamDto,
  ): Promise<DataEnvelope<TeamResponseDto>> {
    return {
      data: await this.teamsService.createTeam(tenantId, body),
    };
  }

  @Get('tenants/:tenantId/teams')
  async listTeams(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListTeamsQueryDto,
  ): Promise<ListEnvelope<TeamResponseDto>> {
    return this.teamsService.listTeams(tenantId, query);
  }

  @Patch('teams/:teamId')
  async updateTeam(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() body: UpdateTeamDto,
  ): Promise<DataEnvelope<TeamResponseDto>> {
    return {
      data: await this.teamsService.updateTeam(teamId, body),
    };
  }

  @Delete('teams/:teamId')
  async archiveTeam(
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ): Promise<DataEnvelope<TeamResponseDto>> {
    return {
      data: await this.teamsService.archiveTeam(teamId),
    };
  }

  @Get('projects/:projectId/teams')
  async listProjectTeams(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ListEnvelope<ProjectTeamResponseDto>> {
    return {
      data: await this.teamsService.listProjectTeams(projectId),
      pagination: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
      },
    };
  }

  @Post('projects/:projectId/teams')
  async attachProjectTeam(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: AttachProjectTeamDto,
  ): Promise<DataEnvelope<ProjectTeamResponseDto>> {
    return {
      data: await this.teamsService.attachProjectTeam(projectId, body),
    };
  }

  @Delete('projects/:projectId/teams/:teamId')
  async detachProjectTeam(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ): Promise<DataEnvelope<ProjectTeamResponseDto>> {
    return {
      data: await this.teamsService.detachProjectTeam(projectId, teamId),
    };
  }
}

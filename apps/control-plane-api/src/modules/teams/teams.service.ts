import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProjectTeamAssignment,
  ResourceStatus,
  Team,
} from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  AttachProjectTeamDto,
  CreateTeamDto,
  ListTeamsQueryDto,
  ProjectTeamResponseDto,
  TeamResponseDto,
  UpdateTeamDto,
} from './dto/team.dto';

type TeamWithProjectCount = Team & {
  _count: {
    projectTeamAssignments: number;
  };
};

type ProjectTeamWithTeam = ProjectTeamAssignment & {
  team: Team;
};

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTeam(
    tenantId: string,
    dto: CreateTeamDto,
  ): Promise<TeamResponseDto> {
    await this.assertTenantExists(tenantId);

    try {
      const team = await this.prisma.team.create({
        data: {
          tenantId,
          name: dto.name,
          description: this.toNullableDescription(dto.description),
        },
        include: {
          _count: {
            select: {
              projectTeamAssignments: true,
            },
          },
        },
      });

      return this.toTeamResponse(team);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Team name already exists for this tenant.');
      }

      throw error;
    }
  }

  async listTeams(
    tenantId: string,
    query: ListTeamsQueryDto,
  ): Promise<ListEnvelope<TeamResponseDto>> {
    await this.assertTenantExists(tenantId);

    const limit = query.limit ?? 50;
    const teams = await this.prisma.team.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            projectTeamAssignments: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = teams.length > limit;
    const page = teams.slice(0, limit);

    return {
      data: page.map((team) => this.toTeamResponse(team)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async updateTeam(
    teamId: string,
    dto: UpdateTeamDto,
  ): Promise<TeamResponseDto> {
    const data: Prisma.TeamUpdateInput = {};

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
      return this.getTeamOrThrow(teamId);
    }

    try {
      const team = await this.prisma.team.update({
        where: { id: teamId },
        data,
        include: {
          _count: {
            select: {
              projectTeamAssignments: true,
            },
          },
        },
      });

      return this.toTeamResponse(team);
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('Team not found.');
      }
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Team name already exists for this tenant.');
      }

      throw error;
    }
  }

  async archiveTeam(teamId: string): Promise<TeamResponseDto> {
    return this.updateTeam(teamId, { status: ResourceStatus.ARCHIVED });
  }

  async listProjectTeams(projectId: string): Promise<ProjectTeamResponseDto[]> {
    await this.getProjectOrThrow(projectId);

    const projectTeams = await this.prisma.projectTeamAssignment.findMany({
      where: { projectId },
      include: { team: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return projectTeams.map((projectTeam) =>
      this.toProjectTeamResponse(projectTeam),
    );
  }

  async attachProjectTeam(
    projectId: string,
    dto: AttachProjectTeamDto,
  ): Promise<ProjectTeamResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });

    if (!team || team.tenantId !== project.tenantId) {
      throw new NotFoundException('Team not found for this project tenant.');
    }
    if (team.status === ResourceStatus.ARCHIVED) {
      throw new ConflictException('Archived teams cannot be attached.');
    }

    const existing = await this.prisma.projectTeamAssignment.findUnique({
      where: {
        projectId_teamId: {
          projectId,
          teamId: dto.teamId,
        },
      },
      include: { team: true },
    });

    if (existing) {
      return this.toProjectTeamResponse(existing);
    }

    const projectTeam = await this.prisma.projectTeamAssignment.create({
      data: {
        tenantId: project.tenantId,
        projectId,
        teamId: dto.teamId,
      },
      include: { team: true },
    });

    return this.toProjectTeamResponse(projectTeam);
  }

  async detachProjectTeam(
    projectId: string,
    teamId: string,
  ): Promise<ProjectTeamResponseDto> {
    await this.getProjectOrThrow(projectId);

    try {
      const projectTeam = await this.prisma.projectTeamAssignment.delete({
        where: {
          projectId_teamId: {
            projectId,
            teamId,
          },
        },
        include: { team: true },
      });

      return this.toProjectTeamResponse(projectTeam);
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('Project team link not found.');
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

  private async getTeamOrThrow(teamId: string): Promise<TeamResponseDto> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        _count: {
          select: {
            projectTeamAssignments: true,
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    return this.toTeamResponse(team);
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

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private toTeamResponse(team: TeamWithProjectCount): TeamResponseDto {
    return {
      id: team.id,
      tenantId: team.tenantId,
      name: team.name,
      description: team.description,
      status: team.status,
      projectCount: team._count.projectTeamAssignments,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
    };
  }

  private toProjectTeamResponse(
    projectTeam: ProjectTeamWithTeam,
  ): ProjectTeamResponseDto {
    return {
      id: projectTeam.id,
      tenantId: projectTeam.tenantId,
      projectId: projectTeam.projectId,
      teamId: projectTeam.teamId,
      teamName: projectTeam.team.name,
      teamDescription: projectTeam.team.description,
      teamStatus: projectTeam.team.status,
      assignedAt: projectTeam.createdAt.toISOString(),
    };
  }
}

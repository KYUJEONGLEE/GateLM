import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { createOpaqueToken, hashSecret, normalizeEmail } from '../auth/auth.crypto';
import { EMAIL_SENDER } from '../auth/auth.tokens';
import { EmailSender } from '../auth/email-sender';
import {
  CreateProjectAdminInvitationDto,
  ProjectAdminInvitationResponseDto,
  ProjectAdminListItemDto,
} from './dto/project-admin-invitation.dto';

@Injectable()
export class ProjectAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
  ) {}

  async listProjectAdmins(projectId: string): Promise<ProjectAdminListItemDto[]> {
    await this.getProjectOrThrow(projectId);
    const now = new Date();
    const [projectAdmins, pendingInvitations] = await Promise.all([
      this.prisma.projectAdmin.findMany({
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        where: { projectId },
      }),
      this.prisma.projectAdminInvitation.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          createdAt: true,
          email: true,
          id: true,
          name: true,
          projectId: true,
          tenantId: true,
        },
        where: {
          acceptedAt: null,
          expiresAt: { gt: now },
          projectId,
          revokedAt: null,
          status: 'pending',
        },
      }),
    ]);

    return [
      ...projectAdmins.map((projectAdmin): ProjectAdminListItemDto => ({
        connectedAt: projectAdmin.createdAt.toISOString(),
        email: projectAdmin.user.email,
        id: `project-admin:${projectAdmin.id}`,
        invitationId: null,
        name: displayProjectAdminName(projectAdmin.user.name, 'Unnamed admin'),
        projectAdminId: projectAdmin.id,
        projectId: projectAdmin.projectId,
        role: 'project_admin',
        status: 'active',
        tenantId: projectAdmin.tenantId,
        userId: projectAdmin.userId,
      })),
      ...pendingInvitations.map((invitation): ProjectAdminListItemDto => ({
        connectedAt: invitation.createdAt.toISOString(),
        email: invitation.email,
        id: `project-admin-invitation:${invitation.id}`,
        invitationId: invitation.id,
        name: displayProjectAdminName(invitation.name, 'Invited admin'),
        projectAdminId: null,
        projectId: invitation.projectId,
        role: 'project_admin',
        status: 'pending',
        tenantId: invitation.tenantId,
        userId: null,
      })),
    ];
  }

  async createProjectAdminInvitation(
    projectId: string,
    dto: CreateProjectAdminInvitationDto,
  ): Promise<ProjectAdminInvitationResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const now = new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : addDays(now, 7);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      throw new BadRequestException('Invitation expiration must be in the future.');
    }

    const email = normalizeEmail(dto.email);
    const name = dto.name.trim();
    const existingAdmin = await this.prisma.projectAdmin.findFirst({
      where: {
        projectId: project.id,
        user: { email },
      },
    });
    if (existingAdmin) {
      throw new BadRequestException('Project admin already exists.');
    }
    const existingPendingInvitation =
      await this.prisma.projectAdminInvitation.findFirst({
        where: {
          acceptedAt: null,
          email,
          expiresAt: { gt: now },
          projectId: project.id,
          revokedAt: null,
          status: 'pending',
        },
      });
    if (existingPendingInvitation) {
      throw new BadRequestException('Project admin invitation already exists.');
    }
    this.assertProjectAdminInvitationEmailDeliveryConfigured();

    const token = createOpaqueToken();
    const signupUrl = this.buildSignupUrl(token);
    const invitation = await this.prisma.projectAdminInvitation.create({
      data: {
        email,
        expiresAt,
        name,
        projectId: project.id,
        tenantId: project.tenantId,
        tokenHash: hashSecret(token),
      },
      select: {
        email: true,
        expiresAt: true,
        id: true,
        name: true,
        status: true,
      },
    });

    try {
      await this.emailSender.sendProjectAdminInvitationEmail({
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        name: invitation.name,
        projectName: project.name,
        signupUrl,
        tenantName: project.tenant.name,
      });
    } catch {
      await this.prisma.projectAdminInvitation.delete({
        where: { id: invitation.id },
      });
      throw new InternalServerErrorException('Project admin invitation email failed to send.');
    }

    return {
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      invitationId: invitation.id,
      name: invitation.name,
      projectId: project.id,
      projectName: project.name,
      signupUrl,
      status: invitation.status,
      tenantId: project.tenantId,
      tenantName: project.tenant.name,
    };
  }

  async removeProjectAdmin(projectId: string, userId: string): Promise<ProjectAdminListItemDto> {
    const now = new Date();
    const existing = await this.prisma.projectAdmin.findUnique({
      include: {
        user: {
          select: {
            email: true,
            name: true,
          },
        },
      },
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('Project admin not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.projectAdmin.delete({
        where: {
          projectId_userId: {
            projectId,
            userId,
          },
        },
      });

      const [remainingProjectAdminCount, tenantAdminCount] = await Promise.all([
        tx.projectAdmin.count({
          where: {
            tenantId: existing.tenantId,
            userId,
          },
        }),
        tx.tenantAdmin.count({
          where: {
            tenantId: existing.tenantId,
            userId,
          },
        }),
      ]);

      if (remainingProjectAdminCount === 0 && tenantAdminCount === 0) {
        await tx.tenantMembership.updateMany({
          data: {
            deletedAt: now,
            status: 'removed',
          },
          where: {
            deletedAt: null,
            role: 'project_admin',
            status: 'active',
            tenantId: existing.tenantId,
            userId,
          },
        });
      }
    });

    return {
      connectedAt: existing.createdAt.toISOString(),
      email: existing.user.email,
      id: `project-admin:${existing.id}`,
      invitationId: null,
      name: displayProjectAdminName(existing.user.name, 'Unnamed admin'),
      projectAdminId: existing.id,
      projectId: existing.projectId,
      role: 'project_admin',
      status: 'active',
      tenantId: existing.tenantId,
      userId: existing.userId,
    };
  }

  async revokeProjectAdminInvitation(invitationId: string): Promise<ProjectAdminListItemDto> {
    const invitation = await this.prisma.projectAdminInvitation.findFirst({
      where: {
        acceptedAt: null,
        id: invitationId,
        revokedAt: null,
        status: 'pending',
      },
    });
    if (!invitation) {
      throw new NotFoundException('Project admin invitation not found.');
    }

    const revoked = await this.prisma.projectAdminInvitation.update({
      data: {
        revokedAt: new Date(),
        status: 'revoked',
      },
      where: { id: invitation.id },
    });

    return {
      connectedAt: revoked.createdAt.toISOString(),
      email: revoked.email,
      id: `project-admin-invitation:${revoked.id}`,
      invitationId: revoked.id,
      name: displayProjectAdminName((revoked as { name?: string | null }).name, 'Invited admin'),
      projectAdminId: null,
      projectId: revoked.projectId,
      role: 'project_admin',
      status: 'pending',
      tenantId: revoked.tenantId,
      userId: null,
    };
  }

  private async getProjectOrThrow(projectId: string) {
    const project = await this.prisma.project.findUnique({
      select: {
        id: true,
        name: true,
        tenant: {
          select: {
            name: true,
          },
        },
        tenantId: true,
      },
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private assertProjectAdminInvitationEmailDeliveryConfigured(): void {
    if (this.config.get<string>('AUTH_EMAIL_TRANSPORT') === 'smtp') {
      return;
    }

    throw new InternalServerErrorException(
      'Project admin invitation email delivery requires AUTH_EMAIL_TRANSPORT=smtp.',
    );
  }

  private buildSignupUrl(token: string): string {
    const origin =
      this.config.get<string>('CONTROL_PLANE_WEB_ORIGIN') ?? 'http://localhost:3005';

    return `${origin.replace(/\/+$/, '')}/?projectInvite=${encodeURIComponent(token)}`;
  }
}

function displayProjectAdminName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes('@')) {
    return fallback;
  }

  return trimmed;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

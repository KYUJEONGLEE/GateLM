import { Transform } from 'class-transformer';
import { IsDateString, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateProjectAdminInvitationDto {
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @Transform(({ value }) => trimString(value))
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export interface ProjectAdminInvitationResponseDto {
  email: string;
  expiresAt: string;
  invitationId: string;
  name: string;
  projectId: string;
  projectName: string;
  signupUrl: string;
  status: string;
  tenantId: string;
  tenantName: string;
}

export type ProjectAdminListItemStatus = 'active' | 'pending';

export interface ProjectAdminListItemDto {
  connectedAt: string;
  email: string;
  id: string;
  invitationId: string | null;
  name: string;
  projectAdminId: string | null;
  projectId: string;
  role: 'project_admin';
  status: ProjectAdminListItemStatus;
  tenantId: string;
  userId: string | null;
}

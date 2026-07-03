import { ResourceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateTeamDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateTeamDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(ResourceStatus)
  status?: ResourceStatus;
}

export class ListTeamsQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class AttachProjectTeamDto {
  @IsUUID()
  teamId!: string;
}

export interface TeamResponseDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: ResourceStatus;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTeamResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  teamId: string;
  teamName: string;
  teamDescription: string | null;
  teamStatus: ResourceStatus;
  assignedAt: string;
}

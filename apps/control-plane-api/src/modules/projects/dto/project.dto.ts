import { ResourceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const RESOURCE_STATUS_VALUES = ['ACTIVE', 'DRAFT', 'DISABLED', 'ARCHIVED'];

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateProjectDto {
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

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  totalBudgetUsd?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  budgetLimitPercent?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  providerConnectionIds?: string[];

  @IsOptional()
  @IsIn(RESOURCE_STATUS_VALUES)
  status?: ResourceStatus;
}

export class UpdateProjectDto {
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
  @IsIn(RESOURCE_STATUS_VALUES)
  status?: ResourceStatus;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  totalBudgetUsd?: number;
}

export class ListProjectsQueryDto {
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

export interface ProjectResponseDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: ResourceStatus;
  totalBudgetUsd: number;
  runtimeApplicationId: string | null;
  createdAt: string;
  updatedAt: string;
}

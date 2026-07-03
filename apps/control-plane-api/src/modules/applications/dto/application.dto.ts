import { ResourceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
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

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export type ApplicationBudgetLimitModeDto = 'FIXED' | 'PERCENT';
export type LocalApplicationKeyDto = 'chat';

export class CreateApplicationDto {
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

  @IsOptional()
  @IsIn(['chat'])
  localApplicationKey?: LocalApplicationKeyDto;

  @IsOptional()
  @IsIn(['FIXED', 'PERCENT'])
  budgetLimitMode?: ApplicationBudgetLimitModeDto;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  budgetLimitUsd?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  budgetLimitPercent?: number;
}

export class UpdateApplicationDto {
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

  @IsOptional()
  @IsIn(['FIXED', 'PERCENT'])
  budgetLimitMode?: ApplicationBudgetLimitModeDto;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  budgetLimitUsd?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  budgetLimitPercent?: number;
}

export class ListApplicationsQueryDto {
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

export interface ApplicationResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  description: string | null;
  status: ResourceStatus;
  localApplicationKey: LocalApplicationKeyDto;
  budgetLimitMode: ApplicationBudgetLimitModeDto;
  budgetLimitUsd: number | null;
  budgetLimitPercent: number | null;
  effectiveBudgetLimitUsd: number;
  createdAt: string;
  updatedAt: string;
}

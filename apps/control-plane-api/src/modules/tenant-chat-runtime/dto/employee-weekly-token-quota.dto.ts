import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import type { Pagination } from '@/common/types/envelope';

export const MAX_EMPLOYEE_WEEKLY_TOKEN_LIMIT = Number.MAX_SAFE_INTEGER;

export class UpdateEmployeeWeeklyTokenQuotaDto {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_EMPLOYEE_WEEKLY_TOKEN_LIMIT)
  limitTokens!: number;

  /** Omitted on the first policy creation. */
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion?: number;
}

export interface EmployeeWeeklyTokenPeriodResponseDto {
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
  limitTokens: number;
  reservedTokens: number;
  confirmedTotalTokens: number;
  unconfirmedTokens: number;
  remainingTokens: number;
  state: 'normal' | 'blocked';
}

export interface EmployeeWeeklyTokenQuotaResponseDto {
  tenantId: string;
  employeeId: string;
  enabled: boolean;
  limitTokens: number;
  timezone: string;
  version: number;
  snapshotVersion: number | null;
  currentWeek: EmployeeWeeklyTokenPeriodResponseDto | null;
}

export interface EmployeeWeeklyTokenQuotasResponseDto {
  data: EmployeeWeeklyTokenQuotaResponseDto[];
  pagination: Pagination;
}

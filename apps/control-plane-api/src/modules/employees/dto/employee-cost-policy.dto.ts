import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type { Pagination } from '@/common/types/envelope';

export const EMPLOYEE_COST_ENFORCEMENT_MODES = [
  'monitor',
  'restrict_high_cost',
] as const;
export const EMPLOYEE_COST_POLICY_STATES = [
  'not_configured',
  'pending_ledger',
  'normal',
  'warning',
  'exceeded',
] as const;
export const MAX_EMPLOYEE_COST_LIMIT_MICRO_USD = 100_000_000_000_000;

export type EmployeeCostEnforcementMode =
  (typeof EMPLOYEE_COST_ENFORCEMENT_MODES)[number];
export type EmployeeCostPolicyState =
  (typeof EMPLOYEE_COST_POLICY_STATES)[number];

export class EmployeeCostLimitDto {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_EMPLOYEE_COST_LIMIT_MICRO_USD)
  limitMicroUsd!: number;
}

export class UpdateEmployeeCostPolicyDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => EmployeeCostLimitDto)
  daily!: EmployeeCostLimitDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => EmployeeCostLimitDto)
  weekly!: EmployeeCostLimitDto;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  warningThresholdPercent!: number;

  @IsIn(EMPLOYEE_COST_ENFORCEMENT_MODES)
  enforcementMode!: EmployeeCostEnforcementMode;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}

export class ListEmployeeCostPoliciesQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 100;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export interface EmployeeCostLimitResponseDto {
  enabled: boolean;
  limitMicroUsd: number;
}

export interface EmployeeCostPolicyResponseDto {
  tenantId: string;
  employeeId: string;
  currency: 'USD';
  periodTimezone: string;
  daily: EmployeeCostLimitResponseDto;
  weekly: EmployeeCostLimitResponseDto;
  warningThresholdPercent: number;
  enforcementMode: EmployeeCostEnforcementMode;
  version: number;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EmployeeCostPeriodStateResponseDto {
  periodStart: string;
  periodEnd: string;
  confirmedCostMicroUsd: number;
  reservedCostMicroUsd: number | null;
  unconfirmedCostMicroUsd: number | null;
  state: EmployeeCostPolicyState;
  resetAt: string;
}

export interface EmployeeCostPolicyListItemResponseDto {
  employeeId: string;
  enforcementReady: boolean;
  exposureSource: 'authoritative_ledger' | 'confirmed_read_model';
  policy: EmployeeCostPolicyResponseDto;
  daily: EmployeeCostPeriodStateResponseDto;
  weekly: EmployeeCostPeriodStateResponseDto;
}

export interface EmployeeCostPoliciesResponseDto {
  data: EmployeeCostPolicyListItemResponseDto[];
  pagination: Pagination;
}

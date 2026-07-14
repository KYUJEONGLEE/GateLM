import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { Pagination } from '@/common/types/envelope';

import type { EmployeeStatus } from './employee.dto';

export const EMPLOYEE_USAGE_METRICS = ['tokens', 'cost', 'requests'] as const;
export const EMPLOYEE_USAGE_ORDERS = ['asc', 'desc'] as const;

export type EmployeeUsageMetric = (typeof EMPLOYEE_USAGE_METRICS)[number];
export type EmployeeUsageOrder = (typeof EMPLOYEE_USAGE_ORDERS)[number];
export type EmployeeUsageSource = 'project_application' | 'tenant_chat';

export class ListEmployeeUsageQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsIn(EMPLOYEE_USAGE_METRICS)
  metric?: EmployeeUsageMetric = 'tokens';

  @IsOptional()
  @IsIn(EMPLOYEE_USAGE_ORDERS)
  order?: EmployeeUsageOrder = 'desc';

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export interface EmployeeUsageMetricDto {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicroUsd: number;
}

export interface EmployeeUsageSourcesDto {
  projectApplication: EmployeeUsageMetricDto;
  tenantChat: EmployeeUsageMetricDto;
}

export interface EmployeeUsageRowDto {
  employeeId: string;
  name: string | null;
  email: string;
  department: string | null;
  status: EmployeeStatus;
  rank: number;
  total: EmployeeUsageMetricDto;
  sources: EmployeeUsageSourcesDto;
}

export interface EmployeeUsagePeriodDto {
  from: string;
  to: string;
  timezone: 'UTC';
}

export interface EmployeeUsageProvenanceDto {
  source: 'raw' | 'rollup' | 'hybrid';
  lastSourceAt: string | null;
  generatedAt: string;
}

export interface EmployeeUsageUnattributedDto {
  total: EmployeeUsageMetricDto;
  sources: EmployeeUsageSourcesDto;
}

export interface EmployeeUsageResponseDto {
  data: EmployeeUsageRowDto[];
  pagination: Pagination;
  period: EmployeeUsagePeriodDto;
  unattributed: EmployeeUsageUnattributedDto;
  provenance: EmployeeUsageProvenanceDto;
}

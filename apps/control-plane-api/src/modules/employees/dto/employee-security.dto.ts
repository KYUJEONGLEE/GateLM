import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

import type { EmployeeStatus } from './employee.dto';

export class ListEmployeeSecurityQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 100;
}

export interface EmployeeSecurityMetricDto {
  blockedRequestCount: number;
  maskedRequestCount: number;
  protectedRequestCount: number;
  requestCount: number;
}

export interface EmployeeSecurityRowDto {
  employeeId: string;
  name: string | null;
  email: string;
  status: EmployeeStatus;
  rank: number;
  total: EmployeeSecurityMetricDto;
  sources: {
    projectApplication: EmployeeSecurityMetricDto;
    tenantChat: EmployeeSecurityMetricDto;
  };
}

export interface EmployeeSecurityResponseDto {
  data: EmployeeSecurityRowDto[];
  period: {
    from: string;
    timezone: 'UTC';
    to: string;
  };
  generatedAt: string;
}

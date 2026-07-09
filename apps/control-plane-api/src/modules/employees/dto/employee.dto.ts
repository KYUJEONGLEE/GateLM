import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
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

export const EMPLOYEE_STATUS_VALUES = [
  'staged',
  'active',
  'suspended',
  'archived',
] as const;

export const EMPLOYEE_INVITATION_STATUS_VALUES = [
  'not_sent',
  'pending',
  'accepted',
  'revoked',
] as const;

export const PROJECT_EMPLOYEE_STATUS_VALUES = [
  'active',
  'disabled',
] as const;

export type EmployeeStatus = (typeof EMPLOYEE_STATUS_VALUES)[number];
export type EmployeeInvitationStatus =
  (typeof EMPLOYEE_INVITATION_STATUS_VALUES)[number];
export type ProjectEmployeeStatus =
  (typeof PROJECT_EMPLOYEE_STATUS_VALUES)[number];

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateEmployeeDto {
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUS_VALUES)
  status?: EmployeeStatus;
}

export class UpdateEmployeeDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUS_VALUES)
  status?: EmployeeStatus;

  @IsOptional()
  @IsIn(EMPLOYEE_INVITATION_STATUS_VALUES)
  invitationStatus?: EmployeeInvitationStatus;
}

export class ImportEmployeesCsvDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000000)
  csvText!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  defaultDepartment?: string;
}

export class ImportEmployeeOrganizationCsvDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000000)
  csvText!: string;
}

export class ListEmployeesQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 100;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUS_VALUES)
  status?: EmployeeStatus;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
}

export class UpsertProjectEmployeeAssignmentDto {
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(100000000)
  monthlyBudgetLimitUsd?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  warningThresholdPercent?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  allowedProviderConnectionIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowedModelKeys?: string[];

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  policyNote?: string;

  @IsOptional()
  @IsIn(PROJECT_EMPLOYEE_STATUS_VALUES)
  status?: ProjectEmployeeStatus;
}

export interface EmployeeResponseDto {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string;
  name: string | null;
  department: string | null;
  jobTitle: string | null;
  status: EmployeeStatus;
  invitationStatus: EmployeeInvitationStatus;
  invitedAt: string | null;
  acceptedAt: string | null;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeCsvSkippedRowDto {
  reason: string;
  rowNumber: number;
}

export interface EmployeeCsvImportResponseDto {
  createdCount: number;
  updatedCount: number;
  skippedRows: EmployeeCsvSkippedRowDto[];
  employees: EmployeeResponseDto[];
}

export interface EmployeeImportProjectResponseDto {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  runtimeApplicationId: string | null;
  status: string;
  tenantId: string;
  totalBudgetUsd: number;
  updatedAt: string;
  warningThresholdPercent: number;
}

export interface EmployeeOrganizationCsvImportResponseDto extends EmployeeCsvImportResponseDto {
  assignmentCreatedCount: number;
  assignmentUpdatedCount: number;
  assignments: ProjectEmployeeAssignmentResponseDto[];
  projectCreatedCount: number;
  projectUpdatedCount: number;
  projects: EmployeeImportProjectResponseDto[];
}

export interface EmployeeInvitationResponseDto {
  employee: EmployeeResponseDto;
  expiresAt: string;
  signupUrl: string;
}

export interface ProjectEmployeePolicyDto {
  allowedModelKeys: string[];
  allowedProviderConnectionIds: string[];
  note: string | null;
}

export interface ProjectEmployeeAssignmentResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  employeeId: string;
  employeeEmail: string;
  employeeName: string | null;
  employeeDepartment: string | null;
  employeeJobTitle: string | null;
  employeeStatus: EmployeeStatus;
  invitationStatus: EmployeeInvitationStatus;
  monthlyBudgetLimitMicroUsd: number;
  monthlyBudgetLimitUsd: number;
  warningThresholdPercent: number;
  policy: ProjectEmployeePolicyDto;
  status: ProjectEmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEmployeeBudgetSummaryDto {
  assignedBudgetUsd: number;
  projectBudgetUsd: number;
  remainingBudgetUsd: number;
}

export interface ProjectEmployeesResponseDto {
  budget: ProjectEmployeeBudgetSummaryDto;
  data: ProjectEmployeeAssignmentResponseDto[];
  projectId: string;
  tenantId: string;
}

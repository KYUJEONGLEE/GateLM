import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export type BudgetScopeTypeDto = 'project' | 'application';
export type NotificationSeverityDto = 'warning' | 'exceeded';
export type NotificationStatusDto = 'pending' | 'acknowledged' | 'resolved';

export class ListBudgetAuditLogsQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsIn(['project', 'application'])
  budgetScopeType?: BudgetScopeTypeDto;

  @IsOptional()
  @IsString()
  budgetScopeId?: string;

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

export class ListNotificationEventsQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsIn(['project', 'application'])
  budgetScopeType?: BudgetScopeTypeDto;

  @IsOptional()
  @IsString()
  budgetScopeId?: string;

  @IsOptional()
  @IsIn(['warning', 'exceeded'])
  severity?: NotificationSeverityDto;

  @IsOptional()
  @IsIn(['pending', 'acknowledged', 'resolved'])
  status?: NotificationStatusDto;

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

export interface BudgetAuditLogResponseDto {
  id: string;
  tenantId: string;
  projectId: string | null;
  applicationId: string | null;
  budgetScopeType: string;
  budgetScopeId: string;
  action: string;
  actorType: string;
  actorId: string | null;
  oldLimitMicroUsd: number | null;
  newLimitMicroUsd: number | null;
  oldLimitUsd: string | null;
  newLimitUsd: string | null;
  oldBudgetLimitMode: string | null;
  newBudgetLimitMode: string | null;
  oldBudgetLimitPercent: number | null;
  newBudgetLimitPercent: number | null;
  metadata: unknown;
  createdAt: string;
}

export interface NotificationEventResponseDto {
  id: string;
  tenantId: string;
  projectId: string | null;
  applicationId: string | null;
  budgetScopeType: string;
  budgetScopeId: string;
  eventType: string;
  severity: string;
  status: string;
  recipientScopeType: string;
  recipientScopeId: string;
  recipientRole: string;
  eventKey: string;
  limitMicroUsd: number | null;
  usedMicroUsd: number | null;
  remainingMicroUsd: number | null;
  usagePercent: number | null;
  sourceRequestId: string | null;
  monthStart: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}
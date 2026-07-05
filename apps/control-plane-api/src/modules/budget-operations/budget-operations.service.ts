import { Injectable } from '@nestjs/common';
import { BudgetAuditLog, NotificationEvent, Prisma } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  BudgetAuditLogResponseDto,
  ListBudgetAuditLogsQueryDto,
  ListNotificationEventsQueryDto,
  NotificationEventResponseDto,
} from './dto/budget-operations.dto';

@Injectable()
export class BudgetOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listBudgetAuditLogs(
    tenantId: string,
    query: ListBudgetAuditLogsQueryDto,
  ): Promise<ListEnvelope<BudgetAuditLogResponseDto>> {
    const limit = query.limit ?? 50;
    const where: Prisma.BudgetAuditLogWhereInput = {
      tenantId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.applicationId ? { applicationId: query.applicationId } : {}),
      ...(query.budgetScopeType ? { budgetScopeType: query.budgetScopeType } : {}),
      ...(query.budgetScopeId ? { budgetScopeId: query.budgetScopeId } : {}),
    };

    const rows = await this.prisma.budgetAuditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    return {
      data: page.map((row) => this.toBudgetAuditLogResponse(row)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async listNotificationEvents(
    tenantId: string,
    query: ListNotificationEventsQueryDto,
  ): Promise<ListEnvelope<NotificationEventResponseDto>> {
    const limit = query.limit ?? 50;
    const where: Prisma.NotificationEventWhereInput = {
      tenantId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.applicationId ? { applicationId: query.applicationId } : {}),
      ...(query.budgetScopeType ? { budgetScopeType: query.budgetScopeType } : {}),
      ...(query.budgetScopeId ? { budgetScopeId: query.budgetScopeId } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const rows = await this.prisma.notificationEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    return {
      data: page.map((row) => this.toNotificationEventResponse(row)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  private toBudgetAuditLogResponse(
    row: BudgetAuditLog,
  ): BudgetAuditLogResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      projectId: row.projectId,
      applicationId: row.applicationId,
      budgetScopeType: row.budgetScopeType,
      budgetScopeId: row.budgetScopeId,
      action: row.action,
      actorType: row.actorType,
      actorId: row.actorId,
      oldLimitMicroUsd: this.bigIntToNumber(row.oldLimitMicroUsd),
      newLimitMicroUsd: this.bigIntToNumber(row.newLimitMicroUsd),
      oldLimitUsd: this.microUsdToUsd(row.oldLimitMicroUsd),
      newLimitUsd: this.microUsdToUsd(row.newLimitMicroUsd),
      oldBudgetLimitMode: row.oldBudgetLimitMode,
      newBudgetLimitMode: row.newBudgetLimitMode,
      oldBudgetLimitPercent: this.decimalToNumber(row.oldBudgetLimitPercent),
      newBudgetLimitPercent: this.decimalToNumber(row.newBudgetLimitPercent),
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toNotificationEventResponse(
    row: NotificationEvent,
  ): NotificationEventResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      projectId: row.projectId,
      applicationId: row.applicationId,
      budgetScopeType: row.budgetScopeType,
      budgetScopeId: row.budgetScopeId,
      eventType: row.eventType,
      severity: row.severity,
      status: row.status,
      recipientScopeType: row.recipientScopeType,
      recipientScopeId: row.recipientScopeId,
      recipientRole: row.recipientRole,
      eventKey: row.eventKey,
      limitMicroUsd: this.bigIntToNumber(row.limitMicroUsd),
      usedMicroUsd: this.bigIntToNumber(row.usedMicroUsd),
      remainingMicroUsd: this.bigIntToNumber(row.remainingMicroUsd),
      usagePercent: this.decimalToNumber(row.usagePercent),
      sourceRequestId: row.sourceRequestId,
      monthStart: row.monthStart.toISOString().slice(0, 10),
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private bigIntToNumber(value: bigint | null): number | null {
    return value === null ? null : Number(value);
  }

  private decimalToNumber(value: Prisma.Decimal | null): number | null {
    return value === null ? null : value.toNumber();
  }

  private microUsdToUsd(value: bigint | null): string | null {
    if (value === null) {
      return null;
    }
    const sign = value < 0n ? '-' : '';
    const abs = value < 0n ? -value : value;
    const whole = abs / 1000000n;
    const fraction = (abs % 1000000n).toString().padStart(6, '0');
    return `${sign}${whole}.${fraction}`;
  }
}
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { ListEnvelope } from '@/common/types/envelope';

import { BudgetOperationsService } from './budget-operations.service';
import {
  BudgetAuditLogResponseDto,
  ListBudgetAuditLogsQueryDto,
  ListNotificationEventsQueryDto,
  NotificationEventResponseDto,
} from './dto/budget-operations.dto';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class BudgetOperationsController {
  constructor(private readonly budgetOperationsService: BudgetOperationsService) {}

  @Get('tenants/:tenantId/budget-audit-logs')
  async listBudgetAuditLogs(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListBudgetAuditLogsQueryDto,
  ): Promise<ListEnvelope<BudgetAuditLogResponseDto>> {
    return this.budgetOperationsService.listBudgetAuditLogs(tenantId, query);
  }

  @Get('tenants/:tenantId/notification-events')
  async listNotificationEvents(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListNotificationEventsQueryDto,
  ): Promise<ListEnvelope<NotificationEventResponseDto>> {
    return this.budgetOperationsService.listNotificationEvents(tenantId, query);
  }
}
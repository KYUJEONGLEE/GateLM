import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import {
  ListTenantChatInvocationsQueryDto,
  TenantChatDashboardQueryDto,
} from './dto/tenant-chat-observability.dto';
import { TenantChatObservabilityService } from './tenant-chat-observability.service';
import { TenantChatInvocationResponse } from './tenant-chat-observability.types';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1/tenants/:tenantId/tenant-chat')
export class TenantChatObservabilityController {
  constructor(private readonly service: TenantChatObservabilityService) {}

  @Get('invocations')
  listInvocations(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListTenantChatInvocationsQueryDto,
  ): Promise<ListEnvelope<TenantChatInvocationResponse>> {
    return this.service.listInvocations(tenantId, query);
  }

  @Get('invocations/:requestId')
  async getInvocation(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('requestId') requestId: string,
  ): Promise<DataEnvelope<TenantChatInvocationResponse>> {
    return { data: await this.service.getInvocation(tenantId, requestId) };
  }

  @Get('dashboard')
  getDashboard(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: TenantChatDashboardQueryDto,
  ) {
    return this.service.getDashboard(tenantId, query);
  }
}

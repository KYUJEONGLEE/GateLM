import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentAdminUserId } from '@/common/authenticated-admin';
import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope } from '@/common/types/envelope';

import { ActivateTenantChatRuntimeDto } from './dto/tenant-chat-admin-runtime.dto';
import { TenantChatRuntimeService } from './tenant-chat-runtime.service';
import type { TenantChatAdminRuntimeSetup } from './tenant-chat-runtime.types';

@Controller('admin/v1/tenants/:tenantId/tenant-chat/runtime')
@UseGuards(AdminAuthGuard)
export class TenantChatAdminRuntimeController {
  constructor(private readonly service: TenantChatRuntimeService) {}

  @Get()
  async getSetup(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<DataEnvelope<TenantChatAdminRuntimeSetup>> {
    return { data: await this.service.getAdminRuntimeSetup(tenantId) };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async activate(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: ActivateTenantChatRuntimeDto,
    @CurrentAdminUserId() publishedBy: string,
  ): Promise<DataEnvelope<TenantChatAdminRuntimeSetup>> {
    return {
      data: await this.service.activateAdminRuntime({
        tenantId,
        providerConnectionId: body.providerConnectionId,
        modelKey: body.modelKey,
        publishedBy,
      }),
    };
  }
}

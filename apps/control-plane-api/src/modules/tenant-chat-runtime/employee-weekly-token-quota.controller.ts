import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { CurrentAdminUserId } from '@/common/authenticated-admin';
import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import type { DataEnvelope } from '@/common/types/envelope';

import {
  EmployeeWeeklyTokenQuotaResponseDto,
  EmployeeWeeklyTokenQuotasResponseDto,
  UpdateEmployeeWeeklyTokenQuotaDto,
} from './dto/employee-weekly-token-quota.dto';
import { TenantChatRuntimeService } from './tenant-chat-runtime.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1/tenants/:tenantId/employees')
export class EmployeeWeeklyTokenQuotaController {
  constructor(private readonly service: TenantChatRuntimeService) {}

  @Get('weekly-token-quotas')
  async list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<EmployeeWeeklyTokenQuotasResponseDto> {
    return this.service.listEmployeeWeeklyTokenQuotas(tenantId);
  }

  @Patch(':employeeId/weekly-token-quota')
  async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: UpdateEmployeeWeeklyTokenQuotaDto,
    @CurrentAdminUserId() updatedBy: string,
  ): Promise<DataEnvelope<EmployeeWeeklyTokenQuotaResponseDto>> {
    return {
      data: await this.service.updateEmployeeWeeklyTokenQuota({
        tenantId,
        employeeId,
        enabled: body.enabled,
        limitTokens: body.limitTokens,
        expectedVersion: body.expectedVersion,
        updatedBy,
      }),
    };
  }
}

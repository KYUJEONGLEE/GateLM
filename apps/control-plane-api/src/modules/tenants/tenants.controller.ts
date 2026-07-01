import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import {
  CreateTenantDto,
  ListTenantsQueryDto,
  TenantResponseDto,
} from './dto/tenant.dto';
import { TenantsService } from './tenants.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post('tenants')
  async createTenant(
    @Body() body: CreateTenantDto,
  ): Promise<DataEnvelope<TenantResponseDto>> {
    return {
      data: await this.tenantsService.createTenant(body),
    };
  }

  @Get('tenants')
  async listTenants(
    @Query() query: ListTenantsQueryDto,
  ): Promise<ListEnvelope<TenantResponseDto>> {
    return this.tenantsService.listTenants(query);
  }
}

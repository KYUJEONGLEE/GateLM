import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentAdminUserId } from '@/common/authenticated-admin';
import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope } from '@/common/types/envelope';

import {
  EmployeeCostPoliciesResponseDto,
  EmployeeCostPolicyResponseDto,
  ListEmployeeCostPoliciesQueryDto,
  UpdateEmployeeCostPolicyDto,
} from './dto/employee-cost-policy.dto';
import { EmployeeCostPolicyService } from './employee-cost-policy.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1/tenants/:tenantId/employees')
export class EmployeeCostPolicyController {
  constructor(private readonly service: EmployeeCostPolicyService) {}

  @Get('cost-policies')
  async list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListEmployeeCostPoliciesQueryDto,
  ): Promise<EmployeeCostPoliciesResponseDto> {
    return this.service.list(tenantId, query);
  }

  @Patch(':employeeId/cost-policy')
  async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: UpdateEmployeeCostPolicyDto,
    @CurrentAdminUserId() updatedBy: string,
  ): Promise<DataEnvelope<EmployeeCostPolicyResponseDto>> {
    return {
      data: await this.service.update({
        body,
        employeeId,
        tenantId,
        updatedBy,
      }),
    };
  }
}

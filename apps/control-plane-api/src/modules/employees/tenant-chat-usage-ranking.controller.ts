import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { TenantChatServiceAuthGuard } from '@/modules/tenant-chat-identity/tenant-chat-service-auth.guard';

import {
  TenantChatUsageRankingQueryDto,
  TenantChatUsageRankingResponseDto,
} from './dto/tenant-chat-usage-ranking.dto';
import { EmployeeUsageService } from './employee-usage.service';

@UseGuards(TenantChatServiceAuthGuard)
@Controller('internal/v1/tenant-chat/usage/rankings')
export class TenantChatUsageRankingController {
  constructor(private readonly employeeUsage: EmployeeUsageService) {}

  @Get(':tenantId')
  list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: TenantChatUsageRankingQueryDto,
  ): Promise<TenantChatUsageRankingResponseDto> {
    return this.employeeUsage.listTenantChatUsageRanking(
      tenantId,
      query.viewerEmployeeId,
      query.range ?? '30d',
      query.metric ?? 'cost',
    );
  }
}

import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';

import { ChatWebServiceGuard } from '@/auth/chat-web-service.guard';

import { UsageRankingQueryDto } from './usage-ranking.dto';
import { UsageRankingService } from './usage-ranking.service';

@UseGuards(ChatWebServiceGuard)
@Controller('internal/v1/tenant-chat/usage-ranking')
export class UsageRankingController {
  constructor(private readonly usageRanking: UsageRankingService) {}

  @Get()
  read(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Query() query: UsageRankingQueryDto,
  ) {
    return this.usageRanking.read(
      accessToken,
      query.range ?? '30d',
      query.metric ?? 'cost',
    );
  }
}

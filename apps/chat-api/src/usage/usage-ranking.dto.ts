import { IsIn, IsOptional } from 'class-validator';

import {
  USAGE_RANKING_METRICS,
  USAGE_RANKING_RANGES,
  type UsageRankingMetric,
  type UsageRankingRange,
} from './usage-ranking.contract';

export class UsageRankingQueryDto {
  @IsOptional()
  @IsIn(USAGE_RANKING_RANGES)
  range?: UsageRankingRange = '30d';

  @IsOptional()
  @IsIn(USAGE_RANKING_METRICS)
  metric?: UsageRankingMetric = 'cost';
}

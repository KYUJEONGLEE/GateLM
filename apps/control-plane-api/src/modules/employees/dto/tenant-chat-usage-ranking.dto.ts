import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const TENANT_CHAT_USAGE_RANGES = ['24h', '7d', '30d'] as const;
export const TENANT_CHAT_USAGE_METRICS = ['cost', 'tokens'] as const;

export type TenantChatUsageRange = (typeof TENANT_CHAT_USAGE_RANGES)[number];
export type TenantChatUsageMetric = (typeof TENANT_CHAT_USAGE_METRICS)[number];

export class TenantChatUsageRankingQueryDto {
  @IsOptional()
  @IsIn(TENANT_CHAT_USAGE_RANGES)
  range?: TenantChatUsageRange = '30d';

  @IsOptional()
  @IsIn(TENANT_CHAT_USAGE_METRICS)
  metric?: TenantChatUsageMetric = 'cost';

  @IsOptional()
  @IsUUID()
  viewerEmployeeId?: string;
}

export interface TenantChatUsageRankingRowDto {
  confirmedTotalTokens: number;
  department: string | null;
  displayName: string;
  estimatedCostMicroUsd: number;
  rank: number;
}

export interface TenantChatUsageRankingViewerDto
  extends Omit<TenantChatUsageRankingRowDto, 'rank'> {
  rank: number | null;
}

export interface TenantChatUsageRankingResponseDto {
  items: TenantChatUsageRankingRowDto[];
  metric: TenantChatUsageMetric;
  period: {
    from: string;
    timezone: 'UTC';
    to: string;
  };
  provenance: {
    generatedAt: string;
    lastSourceAt: string | null;
    source: 'raw' | 'rollup' | 'hybrid';
  };
  range: TenantChatUsageRange;
  rankedEmployeeCount: number;
  viewer: TenantChatUsageRankingViewerDto | null;
}

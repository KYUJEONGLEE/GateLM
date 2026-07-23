export const USAGE_RANKING_RANGES: readonly ['24h', '7d', '30d'];
export const USAGE_RANKING_METRICS: readonly ['cost', 'tokens'];
export type UsageRankingRange = (typeof USAGE_RANKING_RANGES)[number];
export type UsageRankingMetric = (typeof USAGE_RANKING_METRICS)[number];
export type UsageRankingRow = Readonly<{
  confirmedTotalTokens: number;
  department: string | null;
  displayName: string;
  estimatedCostMicroUsd: number;
  rank: number;
}>;
export type UsageRankingResponse = Readonly<{
  items: readonly UsageRankingRow[];
  metric: UsageRankingMetric;
  period: Readonly<{ from: string; timezone: 'UTC'; to: string }>;
  provenance: Readonly<{
    generatedAt: string;
    lastSourceAt: string | null;
    source: 'raw' | 'rollup' | 'hybrid';
  }>;
  range: UsageRankingRange;
  rankedEmployeeCount: number;
  viewer: (Omit<UsageRankingRow, 'rank'> & Readonly<{ rank: number | null }>) | null;
}>;
export class UsageRankingContractError extends Error {
  readonly code: 'CHAT_INVALID_REQUEST';
  readonly status: 400;
}
export function usageRankingQuery(value: string): Readonly<{
  metric: UsageRankingMetric;
  range: UsageRankingRange;
}>;
export function usageRankingResponse(value: unknown): UsageRankingResponse;

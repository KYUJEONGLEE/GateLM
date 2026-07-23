export const USAGE_RANKING_RANGES = ['24h', '7d', '30d'] as const;
export const USAGE_RANKING_METRICS = ['cost', 'tokens'] as const;

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

export function parseUsageRankingResponse(value: unknown): UsageRankingResponse {
  const source = exactRecord(value, [
    'items',
    'metric',
    'period',
    'provenance',
    'range',
    'rankedEmployeeCount',
    'viewer',
  ]);
  if (!USAGE_RANKING_RANGES.includes(source.range as UsageRankingRange)) invalid();
  if (!USAGE_RANKING_METRICS.includes(source.metric as UsageRankingMetric)) invalid();
  if (!Array.isArray(source.items) || source.items.length > 20) invalid();
  const items = source.items.map((item) => rankingRow(item, false));
  const ranks = items.map((item) => item.rank);
  if (new Set(ranks).size !== ranks.length || items.some((item, index) => item.rank !== index + 1)) invalid();
  const rankedEmployeeCount = boundedInteger(source.rankedEmployeeCount, 0, 1_000_000);
  if (items.some((item) => item.rank > rankedEmployeeCount)) invalid();

  const period = exactRecord(source.period, ['from', 'timezone', 'to']);
  const from = isoDate(period.from);
  const to = isoDate(period.to);
  if (period.timezone !== 'UTC' || Date.parse(from) >= Date.parse(to)) invalid();

  const provenance = exactRecord(source.provenance, [
    'generatedAt',
    'lastSourceAt',
    'source',
  ]);
  if (!['raw', 'rollup', 'hybrid'].includes(String(provenance.source))) invalid();
  const generatedAt = isoDate(provenance.generatedAt);
  const lastSourceAt = provenance.lastSourceAt === null
    ? null
    : isoDate(provenance.lastSourceAt);
  const viewer = source.viewer === null ? null : rankingRow(source.viewer, true);
  if (viewer && viewer.rank !== null && viewer.rank > rankedEmployeeCount) invalid();
  if (
    viewer &&
    viewer.rank !== null &&
    viewer.rank <= items.length &&
    !sameUsageRankingValues(viewer, items[viewer.rank - 1])
  ) invalid();

  return {
    items,
    metric: source.metric as UsageRankingMetric,
    period: { from, timezone: 'UTC', to },
    provenance: {
      generatedAt,
      lastSourceAt,
      source: provenance.source as 'raw' | 'rollup' | 'hybrid',
    },
    range: source.range as UsageRankingRange,
    rankedEmployeeCount,
    viewer,
  };
}

function sameUsageRankingValues(
  left: Omit<UsageRankingRow, 'rank'>,
  right: Omit<UsageRankingRow, 'rank'> | undefined,
): boolean {
  return Boolean(
    right &&
    left.confirmedTotalTokens === right.confirmedTotalTokens &&
    left.department === right.department &&
    left.displayName === right.displayName &&
    left.estimatedCostMicroUsd === right.estimatedCostMicroUsd,
  );
}

function rankingRow(value: unknown, nullableRank: false): UsageRankingRow;
function rankingRow(
  value: unknown,
  nullableRank: true,
): Omit<UsageRankingRow, 'rank'> & { rank: number | null };
function rankingRow(
  value: unknown,
  nullableRank: boolean,
): UsageRankingRow | (Omit<UsageRankingRow, 'rank'> & { rank: number | null }) {
  const row = exactRecord(value, [
    'confirmedTotalTokens',
    'department',
    'displayName',
    'estimatedCostMicroUsd',
    'rank',
  ]);
  const displayName = boundedText(row.displayName, 1, 120);
  const department = row.department === null
    ? null
    : boundedText(row.department, 1, 120);
  const rank = nullableRank && row.rank === null
    ? null
    : boundedInteger(row.rank, 1, 1_000_000);
  return {
    confirmedTotalTokens: boundedInteger(row.confirmedTotalTokens, 0, Number.MAX_SAFE_INTEGER),
    department,
    displayName,
    estimatedCostMicroUsd: boundedInteger(row.estimatedCostMicroUsd, 0, Number.MAX_SAFE_INTEGER),
    rank,
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid();
  return source;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function boundedText(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function isoDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) invalid();
  return value;
}

function invalid(): never {
  throw new Error('invalid_usage_ranking_response');
}

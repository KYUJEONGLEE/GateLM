export const USAGE_RANKING_RANGES = Object.freeze(['24h', '7d', '30d']);
export const USAGE_RANKING_METRICS = Object.freeze(['cost', 'tokens']);

export class UsageRankingContractError extends Error {
  constructor() {
    super('Invalid usage ranking contract.');
    this.code = 'CHAT_INVALID_REQUEST';
    this.status = 400;
  }
}

export function usageRankingQuery(value) {
  const url = new URL(value);
  for (const key of url.searchParams.keys()) {
    if (key !== 'range' && key !== 'metric') invalid();
    if (url.searchParams.getAll(key).length !== 1) invalid();
  }
  const range = url.searchParams.get('range') ?? '30d';
  const metric = url.searchParams.get('metric') ?? 'cost';
  if (!USAGE_RANKING_RANGES.includes(range) || !USAGE_RANKING_METRICS.includes(metric)) invalid();
  return Object.freeze({ metric, range });
}

export function usageRankingResponse(value) {
  const source = exactRecord(value, [
    'items',
    'metric',
    'period',
    'provenance',
    'range',
    'rankedEmployeeCount',
    'viewer',
  ]);
  if (!USAGE_RANKING_RANGES.includes(source.range)) invalid();
  if (!USAGE_RANKING_METRICS.includes(source.metric)) invalid();
  if (!Array.isArray(source.items) || source.items.length > 20) invalid();
  const items = source.items.map((item) => rankingRow(item, false));
  const ranks = items.map((item) => item.rank);
  if (new Set(ranks).size !== ranks.length || items.some((item, index) => item.rank !== index + 1)) invalid();
  const rankedEmployeeCount = integer(source.rankedEmployeeCount, 0, 1_000_000);
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
  if (!['raw', 'rollup', 'hybrid'].includes(provenance.source)) invalid();
  const viewer = source.viewer === null ? null : rankingRow(source.viewer, true);
  if (viewer?.rank !== null && viewer.rank > rankedEmployeeCount) invalid();
  if (
    viewer &&
    viewer.rank !== null &&
    viewer.rank <= items.length &&
    !sameRankingValues(viewer, items[viewer.rank - 1])
  ) invalid();
  return Object.freeze({
    items: Object.freeze(items),
    metric: source.metric,
    period: Object.freeze({ from, timezone: 'UTC', to }),
    provenance: Object.freeze({
      generatedAt: isoDate(provenance.generatedAt),
      lastSourceAt: provenance.lastSourceAt === null ? null : isoDate(provenance.lastSourceAt),
      source: provenance.source,
    }),
    range: source.range,
    rankedEmployeeCount,
    viewer,
  });
}

function sameRankingValues(left, right) {
  return Boolean(
    right &&
    left.confirmedTotalTokens === right.confirmedTotalTokens &&
    left.department === right.department &&
    left.displayName === right.displayName &&
    left.estimatedCostMicroUsd === right.estimatedCostMicroUsd,
  );
}

function rankingRow(value, nullableRank) {
  const row = exactRecord(value, [
    'confirmedTotalTokens',
    'department',
    'displayName',
    'estimatedCostMicroUsd',
    'rank',
  ]);
  const result = {
    confirmedTotalTokens: integer(row.confirmedTotalTokens, 0, Number.MAX_SAFE_INTEGER),
    department: row.department === null ? null : text(row.department, 1, 120),
    displayName: text(row.displayName, 1, 120),
    estimatedCostMicroUsd: integer(row.estimatedCostMicroUsd, 0, Number.MAX_SAFE_INTEGER),
    rank: nullableRank && row.rank === null ? null : integer(row.rank, 1, 1_000_000),
  };
  return Object.freeze(result);
}

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid();
  return value;
}

function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}

function text(value, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function isoDate(value) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) invalid();
  return value;
}

function invalid() {
  throw new UsageRankingContractError();
}

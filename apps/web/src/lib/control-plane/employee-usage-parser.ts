import type {
  EmployeeUsageMetric,
  EmployeeUsageRecord,
  EmployeeUsageResponse,
  EmployeeUsageSources,
} from '@/lib/control-plane/employee-usage-types';
import type { EmployeeStatus } from '@/lib/control-plane/employees-types';

const EMPLOYEE_STATUSES = new Set<EmployeeStatus>([
  'active',
  'archived',
  'staged',
  'suspended',
]);

export function parseEmployeeUsageResponse(
  value: unknown,
): EmployeeUsageResponse | null {
  if (!isRecord(value) || !Array.isArray(value.data)) return null;
  const data = value.data.map(parseEmployeeUsageRecord);
  if (data.some((row) => row === null)) return null;
  const pagination = parsePagination(value.pagination);
  const period = parsePeriod(value.period);
  const provenance = parseProvenance(value.provenance);
  const unattributed = parseUnattributed(value.unattributed);
  if (!pagination || !period || !provenance || !unattributed) return null;
  return {
    data: data as EmployeeUsageRecord[],
    pagination,
    period,
    provenance,
    unattributed,
  };
}

function parseEmployeeUsageRecord(value: unknown): EmployeeUsageRecord | null {
  if (
    !isRecord(value) ||
    !isNullableString(value.department) ||
    typeof value.email !== 'string' ||
    typeof value.employeeId !== 'string' ||
    !isNullableString(value.name) ||
    !isPositiveInteger(value.rank) ||
    typeof value.status !== 'string' ||
    !EMPLOYEE_STATUSES.has(value.status as EmployeeStatus)
  ) {
    return null;
  }
  const sources = parseSources(value.sources);
  const total = parseMetric(value.total);
  if (!sources || !total) return null;
  return {
    department: value.department,
    email: value.email,
    employeeId: value.employeeId,
    name: value.name,
    rank: value.rank,
    sources,
    status: value.status as EmployeeStatus,
    total,
  };
}

function parseSources(value: unknown): EmployeeUsageSources | null {
  if (!isRecord(value)) return null;
  const projectApplication = parseMetric(value.projectApplication);
  const tenantChat = parseMetric(value.tenantChat);
  return projectApplication && tenantChat
    ? { projectApplication, tenantChat }
    : null;
}

function parseMetric(value: unknown): EmployeeUsageMetric | null {
  if (!isRecord(value)) return null;
  const keys = [
    'costMicroUsd',
    'inputTokens',
    'outputTokens',
    'requestCount',
    'totalTokens',
  ] as const;
  if (keys.some((key) => !isNonNegativeSafeInteger(value[key]))) return null;
  return {
    costMicroUsd: value.costMicroUsd as number,
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    requestCount: value.requestCount as number,
    totalTokens: value.totalTokens as number,
  };
}

function parsePagination(
  value: unknown,
): EmployeeUsageResponse['pagination'] | null {
  if (
    !isRecord(value) ||
    typeof value.hasMore !== 'boolean' ||
    !isPositiveInteger(value.limit) ||
    !(value.nextCursor === null || typeof value.nextCursor === 'string')
  ) {
    return null;
  }
  return {
    hasMore: value.hasMore,
    limit: value.limit,
    nextCursor: value.nextCursor,
  };
}

function parsePeriod(value: unknown): EmployeeUsageResponse['period'] | null {
  if (
    !isRecord(value) ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    value.timezone !== 'UTC' ||
    !isIsoDate(value.from) ||
    !isIsoDate(value.to)
  ) {
    return null;
  }
  return { from: value.from, timezone: 'UTC', to: value.to };
}

function parseProvenance(
  value: unknown,
): EmployeeUsageResponse['provenance'] | null {
  if (
    !isRecord(value) ||
    typeof value.generatedAt !== 'string' ||
    !isIsoDate(value.generatedAt) ||
    !(value.lastSourceAt === null ||
      (typeof value.lastSourceAt === 'string' && isIsoDate(value.lastSourceAt))) ||
    !['hybrid', 'raw', 'rollup'].includes(String(value.source))
  ) {
    return null;
  }
  return {
    generatedAt: value.generatedAt,
    lastSourceAt: value.lastSourceAt,
    source: value.source as EmployeeUsageResponse['provenance']['source'],
  };
}

function parseUnattributed(
  value: unknown,
): EmployeeUsageResponse['unattributed'] | null {
  if (!isRecord(value)) return null;
  const sources = parseSources(value.sources);
  const total = parseMetric(value.total);
  return sources && total ? { sources, total } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isIsoDate(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

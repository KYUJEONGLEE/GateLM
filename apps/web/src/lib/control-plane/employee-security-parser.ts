import type {
  EmployeeSecurityMetric,
  EmployeeSecurityRecord,
  EmployeeSecurityResponse,
} from '@/lib/control-plane/employee-security-types';
import type { EmployeeStatus } from '@/lib/control-plane/employees-types';

const EMPLOYEE_STATUSES = new Set<EmployeeStatus>([
  'active',
  'archived',
  'staged',
  'suspended',
]);

export function parseEmployeeSecurityResponse(
  value: unknown,
): EmployeeSecurityResponse | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    typeof value.generatedAt !== 'string' ||
    !isIsoDate(value.generatedAt)
  ) {
    return null;
  }
  const data = value.data.map(parseEmployeeSecurityRecord);
  const period = parsePeriod(value.period);
  if (data.some((row) => row === null) || !period) return null;
  return {
    data: data as EmployeeSecurityRecord[],
    generatedAt: value.generatedAt,
    period,
  };
}

function parseEmployeeSecurityRecord(value: unknown): EmployeeSecurityRecord | null {
  if (
    !isRecord(value) ||
    typeof value.email !== 'string' ||
    typeof value.employeeId !== 'string' ||
    !(value.name === null || typeof value.name === 'string') ||
    !isPositiveInteger(value.rank) ||
    typeof value.status !== 'string' ||
    !EMPLOYEE_STATUSES.has(value.status as EmployeeStatus) ||
    !isRecord(value.sources)
  ) {
    return null;
  }
  const projectApplication = parseMetric(value.sources.projectApplication);
  const tenantChat = parseMetric(value.sources.tenantChat);
  const total = parseMetric(value.total);
  if (!projectApplication || !tenantChat || !total) return null;
  return {
    email: value.email,
    employeeId: value.employeeId,
    name: value.name,
    rank: value.rank,
    sources: { projectApplication, tenantChat },
    status: value.status as EmployeeStatus,
    total,
  };
}

function parseMetric(value: unknown): EmployeeSecurityMetric | null {
  if (!isRecord(value)) return null;
  const keys = [
    'blockedRequestCount',
    'maskedRequestCount',
    'protectedRequestCount',
    'requestCount',
  ] as const;
  if (keys.some((key) => !isNonNegativeSafeInteger(value[key]))) return null;
  return {
    blockedRequestCount: value.blockedRequestCount as number,
    maskedRequestCount: value.maskedRequestCount as number,
    protectedRequestCount: value.protectedRequestCount as number,
    requestCount: value.requestCount as number,
  };
}

function parsePeriod(value: unknown): EmployeeSecurityResponse['period'] | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

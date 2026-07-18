import 'server-only';

import { getControlPlaneBaseUrl } from '@/lib/control-plane/control-plane-config';
import { buildControlPlaneHeaders, type ControlPlaneRequestOptions } from '@/lib/control-plane/control-plane-request';
import type { EmployeeWeeklyTokenQuotasResponse } from './employee-weekly-token-quota-types';

export async function getEmployeeWeeklyTokenQuotas(
  tenantId: string,
  options?: ControlPlaneRequestOptions,
): Promise<{ data: EmployeeWeeklyTokenQuotasResponse; ok: true } | { error: string; ok: false }> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/employees/weekly-token-quotas`,
      { cache: 'no-store', headers: await buildControlPlaneHeaders(options) },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    const parsed = parseWeeklyTokenQuotas(payload);
    if (!response.ok || !parsed) {
      return { error: readError(payload) ?? 'Employee weekly token quotas are unavailable.', ok: false };
    }
    return { data: parsed, ok: true };
  } catch {
    return { error: 'Control Plane unavailable.', ok: false };
  }
}

function parseWeeklyTokenQuotas(value: unknown): EmployeeWeeklyTokenQuotasResponse | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.data) || !asRecord(record.pagination)) return null;
  const data = record.data.map(parseQuota);
  if (data.some((item) => item === null)) return null;
  return { data: data as EmployeeWeeklyTokenQuotasResponse['data'], pagination: record.pagination as EmployeeWeeklyTokenQuotasResponse['pagination'] };
}

function parseQuota(value: unknown) {
  const record = asRecord(value);
  if (!record || typeof record.employeeId !== 'string' || typeof record.tenantId !== 'string' ||
    typeof record.enabled !== 'boolean' || !isNonNegativeInteger(record.limitTokens) ||
    typeof record.timezone !== 'string' || !isNonNegativeInteger(record.version) ||
    !(record.snapshotVersion === null || isNonNegativeInteger(record.snapshotVersion))) return null;
  const current = record.currentWeek;
  if (current !== null && !isPeriod(current)) return null;
  return record as EmployeeWeeklyTokenQuotasResponse['data'][number];
}

function isPeriod(value: unknown) {
  const record = asRecord(value);
  return Boolean(record && typeof record.periodStart === 'string' && typeof record.periodEnd === 'string' &&
    typeof record.periodTimezone === 'string' && record.state !== undefined &&
    ['normal', 'blocked'].includes(String(record.state)) &&
    ['limitTokens', 'reservedTokens', 'confirmedTotalTokens', 'unconfirmedTokens', 'remainingTokens']
      .every((key) => isNonNegativeInteger(record[key])));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function readError(value: unknown): string | null {
  const record = asRecord(value);
  return record && (typeof record.error === 'string' ? record.error : typeof record.message === 'string' ? record.message : null);
}

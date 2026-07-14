import 'server-only';

import { getControlPlaneBaseUrl } from '@/lib/control-plane/control-plane-config';
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions,
} from '@/lib/control-plane/control-plane-request';
import { parseEmployeeUsageResponse } from '@/lib/control-plane/employee-usage-parser';
import type {
  EmployeeUsageQuery,
  EmployeeUsageRequestResult,
} from '@/lib/control-plane/employee-usage-types';

export async function getEmployeeUsage(
  query: EmployeeUsageQuery,
  options?: ControlPlaneRequestOptions,
): Promise<EmployeeUsageRequestResult> {
  const search = new URLSearchParams({ from: query.from, to: query.to });
  if (query.cursor) search.set('cursor', query.cursor);
  if (query.limit !== undefined) search.set('limit', String(query.limit));
  if (query.metric) search.set('metric', query.metric);
  if (query.order) search.set('order', query.order);

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(query.tenantId)}/employees/usage?${search.toString()}`,
      {
        cache: 'no-store',
        headers: await buildControlPlaneHeaders(options),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      return {
        error: readError(payload) ?? 'Employee usage request failed.',
        ok: false,
        status: response.status,
      };
    }
    const parsed = parseEmployeeUsageResponse(payload);
    if (!parsed) {
      return {
        error: 'Control Plane returned an invalid employee usage response.',
        ok: false,
        status: 502,
      };
    }
    return { data: parsed, ok: true, status: response.status };
  } catch {
    return { error: 'Control Plane unavailable.', ok: false, status: 0 };
  }
}

function readError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error === 'string') return value.error;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

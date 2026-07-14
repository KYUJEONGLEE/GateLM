import 'server-only';

import { getControlPlaneBaseUrl } from '@/lib/control-plane/control-plane-config';
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions,
} from '@/lib/control-plane/control-plane-request';
import { parseEmployeeUsageResponse } from '@/lib/control-plane/employee-usage-parser';
import type {
  EmployeeUsageListQuery,
  EmployeeUsageQuery,
  EmployeeUsageRequestResult,
  EmployeeUsageResponse,
} from '@/lib/control-plane/employee-usage-types';

const EMPLOYEE_USAGE_PAGE_LIMIT = 100;
const EMPLOYEE_USAGE_MAX_PAGES = 100;

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

export async function getAllEmployeeUsage(
  query: EmployeeUsageListQuery,
  options?: ControlPlaneRequestOptions,
): Promise<EmployeeUsageRequestResult> {
  const rows: EmployeeUsageResponse['data'] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < EMPLOYEE_USAGE_MAX_PAGES; page += 1) {
    const result = await getEmployeeUsage(
      { ...query, cursor, limit: EMPLOYEE_USAGE_PAGE_LIMIT },
      options,
    );
    if (!result.ok) return result;

    rows.push(...result.data.data);
    if (!result.data.pagination.hasMore) {
      return {
        data: {
          ...result.data,
          data: rows,
          pagination: {
            hasMore: false,
            limit: EMPLOYEE_USAGE_PAGE_LIMIT,
            nextCursor: null,
          },
        },
        ok: true,
        status: result.status,
      };
    }

    const nextCursor = result.data.pagination.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      return invalidPaginationResult();
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return invalidPaginationResult();
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

function invalidPaginationResult(): EmployeeUsageRequestResult {
  return {
    error: 'Control Plane employee usage pagination did not terminate.',
    ok: false,
    status: 502,
  };
}

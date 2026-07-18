import 'server-only';

import { getControlPlaneBaseUrl } from '@/lib/control-plane/control-plane-config';
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions,
} from '@/lib/control-plane/control-plane-request';
import { parseEmployeeSecurityResponse } from '@/lib/control-plane/employee-security-parser';
import type { EmployeeSecurityRequestResult } from '@/lib/control-plane/employee-security-types';

export async function getEmployeeSecurity(
  query: { from: string; tenantId: string; to: string },
  options?: ControlPlaneRequestOptions,
): Promise<EmployeeSecurityRequestResult> {
  const search = new URLSearchParams({ from: query.from, to: query.to, limit: '100' });
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(query.tenantId)}/employees/security?${search.toString()}`,
      {
        cache: 'no-store',
        headers: await buildControlPlaneHeaders(options),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      return {
        error: readError(payload) ?? 'Employee security request failed.',
        ok: false,
        status: response.status,
      };
    }
    const parsed = parseEmployeeSecurityResponse(payload);
    return parsed
      ? { data: parsed, ok: true, status: response.status }
      : {
          error: 'Control Plane returned an invalid employee security response.',
          ok: false,
          status: 502,
        };
  } catch {
    return { error: 'Control Plane unavailable.', ok: false, status: 0 };
  }
}

function readError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  return null;
}

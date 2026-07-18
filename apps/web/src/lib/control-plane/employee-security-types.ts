import type { EmployeeStatus } from '@/lib/control-plane/employees-types';

export type EmployeeSecurityMetric = {
  blockedRequestCount: number;
  maskedRequestCount: number;
  protectedRequestCount: number;
  requestCount: number;
};

export type EmployeeSecurityRecord = {
  email: string;
  employeeId: string;
  name: string | null;
  rank: number;
  sources: {
    projectApplication: EmployeeSecurityMetric;
    tenantChat: EmployeeSecurityMetric;
  };
  status: EmployeeStatus;
  total: EmployeeSecurityMetric;
};

export type EmployeeSecurityResponse = {
  data: EmployeeSecurityRecord[];
  generatedAt: string;
  period: {
    from: string;
    timezone: 'UTC';
    to: string;
  };
};

export type EmployeeSecurityRequestResult =
  | { data: EmployeeSecurityResponse; ok: true; status: number }
  | { error: string; ok: false; status: number };

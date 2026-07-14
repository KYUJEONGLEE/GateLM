import type { EmployeeStatus } from '@/lib/control-plane/employees-types';

export type EmployeeUsageMetricName = 'cost' | 'requests' | 'tokens';
export type EmployeeUsageOrder = 'asc' | 'desc';
export type EmployeeUsageReadSource = 'hybrid' | 'raw' | 'rollup';

export type EmployeeUsageMetric = {
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  totalTokens: number;
};

export type EmployeeUsageSources = {
  projectApplication: EmployeeUsageMetric;
  tenantChat: EmployeeUsageMetric;
};

export type EmployeeUsageRecord = {
  department: string | null;
  email: string;
  employeeId: string;
  name: string | null;
  rank: number;
  sources: EmployeeUsageSources;
  status: EmployeeStatus;
  total: EmployeeUsageMetric;
};

export type EmployeeUsageResponse = {
  data: EmployeeUsageRecord[];
  pagination: {
    hasMore: boolean;
    limit: number;
    nextCursor: string | null;
  };
  period: {
    from: string;
    timezone: 'UTC';
    to: string;
  };
  provenance: {
    generatedAt: string;
    lastSourceAt: string | null;
    source: EmployeeUsageReadSource;
  };
  unattributed: {
    sources: EmployeeUsageSources;
    total: EmployeeUsageMetric;
  };
};

export type EmployeeUsageQuery = {
  cursor?: string;
  from: string;
  limit?: number;
  metric?: EmployeeUsageMetricName;
  order?: EmployeeUsageOrder;
  tenantId: string;
  to: string;
};

export type EmployeeUsageRequestResult =
  | { data: EmployeeUsageResponse; ok: true; status: number }
  | { error: string; ok: false; status: number };

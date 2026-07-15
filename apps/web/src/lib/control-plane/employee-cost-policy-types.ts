export const MAX_EMPLOYEE_COST_LIMIT_MICRO_USD = 100_000_000_000_000;

export type EmployeeCostEnforcementMode = "monitor" | "restrict_high_cost";
export type EmployeeCostPolicyState =
  | "exceeded"
  | "normal"
  | "not_configured"
  | "pending_ledger"
  | "warning";
export type EmployeeCostExposureSource =
  | "authoritative_ledger"
  | "confirmed_read_model";
export type EmployeeCostRolloutMode = "off" | "shadow" | "enforce";

export type EmployeeCostLimit = {
  enabled: boolean;
  limitMicroUsd: number;
};

export type EmployeeCostPolicy = {
  createdAt: string | null;
  currency: "USD";
  daily: EmployeeCostLimit;
  employeeId: string;
  enforcementMode: EmployeeCostEnforcementMode;
  periodTimezone: string;
  tenantId: string;
  updatedAt: string | null;
  updatedBy: string | null;
  version: number;
  warningThresholdPercent: number;
  weekly: EmployeeCostLimit;
};

export type EmployeeCostPolicyPeriod = {
  confirmedCostMicroUsd: number;
  periodEnd: string;
  periodStart: string;
  periodTimezone: string;
  reservedCostMicroUsd: number | null;
  resetAt: string;
  state: EmployeeCostPolicyState;
  unconfirmedCostMicroUsd: number | null;
};

export type EmployeeCostPolicyListItem = {
  daily: EmployeeCostPolicyPeriod;
  employeeId: string;
  enforcementReady: boolean;
  exposureSource: EmployeeCostExposureSource;
  policy: EmployeeCostPolicy;
  rolloutMode: EmployeeCostRolloutMode;
  weekly: EmployeeCostPolicyPeriod;
};

export type EmployeeCostPolicyPagination = {
  hasMore: boolean;
  limit: number;
  nextCursor: string | null;
};

export type EmployeeCostPoliciesResponse = {
  data: EmployeeCostPolicyListItem[];
  pagination: EmployeeCostPolicyPagination;
};

export type EmployeeCostPolicyUpdate = {
  daily: EmployeeCostLimit;
  employeeId: string;
  enforcementMode: EmployeeCostEnforcementMode;
  expectedVersion: number;
  tenantId: string;
  warningThresholdPercent: number;
  weekly: EmployeeCostLimit;
};

export type EmployeeCostPolicyRequestResult<T = EmployeeCostPolicy> =
  | {
      data: T;
      ok: true;
      status: number;
    }
  | {
      code: string | null;
      error: string;
      ok: false;
      status: number;
    };

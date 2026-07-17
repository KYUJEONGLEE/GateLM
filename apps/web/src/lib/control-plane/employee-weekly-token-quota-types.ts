export type EmployeeWeeklyTokenPeriod = {
  confirmedTotalTokens: number;
  limitTokens: number;
  periodEnd: string;
  periodStart: string;
  periodTimezone: string;
  remainingTokens: number;
  reservedTokens: number;
  state: 'blocked' | 'normal';
  unconfirmedTokens: number;
};

export type EmployeeWeeklyTokenQuota = {
  currentWeek: EmployeeWeeklyTokenPeriod | null;
  employeeId: string;
  enabled: boolean;
  limitTokens: number;
  snapshotVersion: number | null;
  tenantId: string;
  timezone: string;
  version: number;
};

export type EmployeeWeeklyTokenQuotasResponse = {
  data: EmployeeWeeklyTokenQuota[];
  pagination: { hasMore: boolean; limit: number; nextCursor: string | null };
};

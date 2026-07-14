import { expect, test } from '@playwright/test';

import { parseEmployeeUsageResponse } from './employee-usage-parser';

test('parses a tenant-scoped employee usage response', () => {
  const parsed = parseEmployeeUsageResponse(buildResponse());

  expect(parsed).toMatchObject({
    data: [
      {
        employeeId: '00000000-0000-4000-8000-000000000101',
        rank: 1,
        total: { requestCount: 4, totalTokens: 120 },
        sources: {
          projectApplication: { totalTokens: 80 },
          tenantChat: { totalTokens: 40 },
        },
      },
    ],
    period: { timezone: 'UTC' },
    provenance: { source: 'hybrid' },
  });
});

test('rejects unsafe or malformed usage metrics', () => {
  const negative = buildResponse();
  negative.data[0].total.totalTokens = -1;
  expect(parseEmployeeUsageResponse(negative)).toBeNull();

  const wrongTimezone = buildResponse();
  wrongTimezone.period.timezone = 'Asia/Seoul';
  expect(parseEmployeeUsageResponse(wrongTimezone)).toBeNull();
});

function buildResponse() {
  const projectApplication = metric({ requestCount: 3, totalTokens: 80 });
  const tenantChat = metric({ requestCount: 1, totalTokens: 40 });
  return {
    data: [
      {
        department: 'Platform',
        email: 'employee@example.invalid',
        employeeId: '00000000-0000-4000-8000-000000000101',
        name: 'Employee',
        rank: 1,
        sources: { projectApplication, tenantChat },
        status: 'active',
        total: metric({ requestCount: 4, totalTokens: 120 }),
      },
    ],
    pagination: { hasMore: false, limit: 50, nextCursor: null },
    period: {
      from: '2026-07-13T00:00:00.000Z',
      timezone: 'UTC',
      to: '2026-07-14T00:00:00.000Z',
    },
    provenance: {
      generatedAt: '2026-07-14T00:00:01.000Z',
      lastSourceAt: '2026-07-14T00:00:00.000Z',
      source: 'hybrid',
    },
    unattributed: {
      sources: { projectApplication: metric(), tenantChat: metric() },
      total: metric(),
    },
  };
}

function metric(overrides: Partial<Record<string, number>> = {}) {
  return {
    costMicroUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    totalTokens: 0,
    ...overrides,
  };
}

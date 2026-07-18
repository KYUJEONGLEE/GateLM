import { expect, test } from '@playwright/test';

import { parseEmployeeSecurityResponse } from './employee-security-parser';

test('parses employee security metrics without raw security content', () => {
  const parsed = parseEmployeeSecurityResponse(buildResponse());

  expect(parsed).toMatchObject({
    data: [
      {
        employeeId: '00000000-0000-4000-8000-000000000101',
        rank: 1,
        total: {
          blockedRequestCount: 2,
          maskedRequestCount: 3,
          protectedRequestCount: 5,
          requestCount: 12,
        },
      },
    ],
    period: { timezone: 'UTC' },
  });
});

test('rejects malformed or negative employee security metrics', () => {
  const negative = buildResponse();
  negative.data[0].total.blockedRequestCount = -1;
  expect(parseEmployeeSecurityResponse(negative)).toBeNull();

  const wrongTimezone = buildResponse();
  wrongTimezone.period.timezone = 'Asia/Seoul';
  expect(parseEmployeeSecurityResponse(wrongTimezone)).toBeNull();
});

function buildResponse() {
  return {
    data: [
      {
        email: 'employee@example.invalid',
        employeeId: '00000000-0000-4000-8000-000000000101',
        name: 'Employee',
        rank: 1,
        sources: {
          projectApplication: metric({ maskedRequestCount: 3, protectedRequestCount: 3, requestCount: 7 }),
          tenantChat: metric({ blockedRequestCount: 2, protectedRequestCount: 2, requestCount: 5 }),
        },
        status: 'active',
        total: metric({
          blockedRequestCount: 2,
          maskedRequestCount: 3,
          protectedRequestCount: 5,
          requestCount: 12,
        }),
      },
    ],
    generatedAt: '2026-07-14T00:00:01.000Z',
    period: {
      from: '2026-07-13T00:00:00.000Z',
      timezone: 'UTC',
      to: '2026-07-14T00:00:00.000Z',
    },
  };
}

function metric(overrides: Partial<Record<string, number>> = {}) {
  return {
    blockedRequestCount: 0,
    maskedRequestCount: 0,
    protectedRequestCount: 0,
    requestCount: 0,
    ...overrides,
  };
}

import { createHmac } from 'node:crypto';

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClickHouseEmployeeUsageReader } from './clickhouse-employee-usage.reader';

const secret = 'employee-identity-test-secret-32-characters';
const employeeId = '00000000-0000-4000-8000-000000000101';

describe('ClickHouseEmployeeUsageReader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps HMAC identities and keeps unknown identities unattributed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        [
          JSON.stringify(
            aggregateRow(hash(employeeId), {
              request_count: '2',
              total_tokens: '30',
            }),
          ),
          JSON.stringify(
            aggregateRow(hash('unknown@example.invalid'), {
              request_count: '1',
              total_tokens: '7',
            }),
          ),
        ].join('\n'),
        { status: 200 },
      ),
    );
    const reader = createReader();

    const result = await reader.readProjectUsage({
      tenantId: '00000000-0000-4000-8000-000000000100',
      from: new Date('2026-07-20T00:00:00.000Z'),
      to: new Date('2026-07-21T00:00:00.000Z'),
      identities: [
        {
          employeeId,
          userId: null,
          email: 'employee@example.invalid',
        },
      ],
    });

    expect(result.byEmployeeId.get(employeeId)).toMatchObject({
      requestCount: 2n,
      totalTokens: 30n,
    });
    expect(result.unattributed).toMatchObject({
      requestCount: 1n,
      totalTokens: 7n,
    });
    expect(result.lastSourceAt?.toISOString()).toBe(
      '2026-07-21T00:00:00.000Z',
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('param_tenant_id=');
    expect(String(init?.body)).toContain('FROM `analytics`.`llm_invocations` FINAL');
    expect(String(init?.body)).not.toContain('employee@example.invalid');
  });

  it('does not resolve an ambiguous preferred identity hash', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify(aggregateRow(hash('shared@example.invalid'))),
        { status: 200 },
      ),
    );
    const reader = createReader();

    const result = await reader.readProjectUsage({
      tenantId: '00000000-0000-4000-8000-000000000100',
      from: new Date('2026-07-20T00:00:00.000Z'),
      to: new Date('2026-07-21T00:00:00.000Z'),
      identities: [
        { employeeId, userId: null, email: 'shared@example.invalid' },
        {
          employeeId: '00000000-0000-4000-8000-000000000102',
          userId: null,
          email: 'shared@example.invalid',
        },
      ],
    });

    expect(result.byEmployeeId.size).toBe(0);
    expect(result.unattributed.requestCount).toBe(1n);
  });

  it('returns a stable 503 without exposing a ClickHouse error body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('sensitive backend error', { status: 500 }),
    );

    let error: unknown;
    try {
      await createReader().readProjectUsage({
        tenantId: '00000000-0000-4000-8000-000000000100',
        from: new Date('2026-07-20T00:00:00.000Z'),
        to: new Date('2026-07-21T00:00:00.000Z'),
        identities: [],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      code: 'EMPLOYEE_USAGE_ANALYTICS_UNAVAILABLE',
      message: 'Employee usage analytics is temporarily unavailable.',
    });
  });
});

function createReader() {
  return new ClickHouseEmployeeUsageReader(
    new ConfigService({
      CLICKHOUSE_ANALYTICS_READ_ENABLED: 'true',
      CLICKHOUSE_URL: 'http://10.78.2.60:8123',
      CLICKHOUSE_DATABASE: 'analytics',
      CLICKHOUSE_TABLE: 'llm_invocations',
      CLICKHOUSE_USERNAME: 'analytics_reader',
      CLICKHOUSE_PASSWORD: 'test-password',
      CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET: secret,
      CLICKHOUSE_QUERY_TIMEOUT_MS: 1_500,
    }),
  );
}

function hash(value: string): string {
  return createHmac('sha256', secret)
    .update(value.trim().toLowerCase(), 'utf8')
    .digest('hex');
}

function aggregateRow(
  identityHash: string,
  overrides: Record<string, string> = {},
) {
  return {
    employee_identity_hash: identityHash,
    request_count: '1',
    input_tokens: '5',
    output_tokens: '2',
    total_tokens: '7',
    cost_micro_usd: '3',
    source_max_at_ms: String(Date.parse('2026-07-21T00:00:00.000Z')),
    ...overrides,
  };
}

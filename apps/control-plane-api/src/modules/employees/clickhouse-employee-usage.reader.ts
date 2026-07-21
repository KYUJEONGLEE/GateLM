import { createHmac } from 'node:crypto';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EmployeeUsageIdentity = {
  employeeId: string;
  userId: string | null;
  email: string;
};

export type EmployeeUsageAggregate = {
  requestCount: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  totalTokens: bigint;
  costMicroUsd: bigint;
};

export type ClickHouseEmployeeUsageResult = {
  byEmployeeId: Map<string, EmployeeUsageAggregate>;
  unattributed: EmployeeUsageAggregate;
  lastSourceAt: Date | null;
};

export type EmployeeSecurityAggregate = {
  requestCount: bigint;
  maskedRequestCount: bigint;
  blockedRequestCount: bigint;
};

export type ClickHouseEmployeeSecurityResult = {
  byEmployeeId: Map<string, EmployeeSecurityAggregate>;
};

export type ProjectEmployeePolicyUsage = {
  dailyUsedTokens: bigint;
  usedMicroUsd: bigint;
};

export type ClickHouseProjectEmployeePolicyUsageResult = {
  byEmployeeId: Map<string, ProjectEmployeePolicyUsage>;
};

type ClickHouseAggregateRow = {
  employee_identity_hash?: unknown;
  request_count?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  cost_micro_usd?: unknown;
  source_max_at_ms?: unknown;
};

type ClickHouseSecurityRow = {
  employee_identity_hash?: unknown;
  request_count?: unknown;
  masked_request_count?: unknown;
  blocked_request_count?: unknown;
};

type ClickHouseProjectPolicyUsageRow = {
  employee_identity_hash?: unknown;
  daily_used_tokens?: unknown;
  used_micro_usd?: unknown;
};

const EMPTY_USAGE = Object.freeze<EmployeeUsageAggregate>({
  requestCount: 0n,
  inputTokens: 0n,
  outputTokens: 0n,
  totalTokens: 0n,
  costMicroUsd: 0n,
});

@Injectable()
export class ClickHouseEmployeeUsageReader {
  private readonly enabled: boolean;
  private readonly endpointUrl: string;
  private readonly database: string;
  private readonly table: string;
  private readonly username: string;
  private readonly password: string;
  private readonly identityKey: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.enabled =
      config.get<string>('CLICKHOUSE_ANALYTICS_READ_ENABLED') === 'true';
    this.endpointUrl = config.get<string>('CLICKHOUSE_URL') ?? '';
    this.database = config.get<string>('CLICKHOUSE_DATABASE') ?? 'analytics';
    this.table = config.get<string>('CLICKHOUSE_TABLE') ?? 'llm_invocations';
    this.username =
      config.get<string>('CLICKHOUSE_USERNAME') ?? 'analytics_reader';
    this.password = config.get<string>('CLICKHOUSE_PASSWORD') ?? '';
    this.identityKey =
      config.get<string>('CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET') ?? '';
    this.timeoutMs =
      config.get<number>('CLICKHOUSE_QUERY_TIMEOUT_MS') ?? 1_500;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async readProjectUsage(input: {
    tenantId: string;
    from: Date;
    to: Date;
    identities: EmployeeUsageIdentity[];
  }): Promise<ClickHouseEmployeeUsageResult> {
    if (!this.enabled) {
      return {
        byEmployeeId: new Map(),
        unattributed: { ...EMPTY_USAGE },
        lastSourceAt: null,
      };
    }

    const identityOwners = this.buildIdentityOwners(input.identities);
    const body = await this.execute(
      this.usageQuery(),
      {
        tenant_id: input.tenantId,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
      },
      'EMPLOYEE_USAGE_ANALYTICS_UNAVAILABLE',
      'Employee usage analytics is temporarily unavailable.',
    );

    const byEmployeeId = new Map<string, EmployeeUsageAggregate>();
    let unattributed = { ...EMPTY_USAGE };
    let lastSourceAt: Date | null = null;
    try {
      for (const line of body.split('\n')) {
        if (line.trim().length === 0) continue;
        const row = JSON.parse(line) as ClickHouseAggregateRow;
        const identityHash = readIdentityHash(row.employee_identity_hash);
        const aggregate = readAggregate(row);
        const employeeId = identityOwners.get(identityHash);
        if (employeeId) {
          byEmployeeId.set(
            employeeId,
            addAggregate(byEmployeeId.get(employeeId) ?? EMPTY_USAGE, aggregate),
          );
        } else {
          unattributed = addAggregate(unattributed, aggregate);
        }
        const sourceAt = readTimestamp(row.source_max_at_ms);
        if (sourceAt && (!lastSourceAt || sourceAt > lastSourceAt)) {
          lastSourceAt = sourceAt;
        }
      }
    } catch {
      throw unavailable(
        'EMPLOYEE_USAGE_ANALYTICS_UNAVAILABLE',
        'Employee usage analytics is temporarily unavailable.',
      );
    }

    return { byEmployeeId, unattributed, lastSourceAt };
  }

  async readProjectSecurity(input: {
    tenantId: string;
    from: Date;
    to: Date;
    identities: EmployeeUsageIdentity[];
  }): Promise<ClickHouseEmployeeSecurityResult> {
    if (!this.enabled) {
      return { byEmployeeId: new Map() };
    }
    const identityOwners = this.buildIdentityOwners(input.identities);
    const body = await this.execute(
      this.securityQuery(),
      {
        tenant_id: input.tenantId,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
      },
      'EMPLOYEE_SECURITY_ANALYTICS_UNAVAILABLE',
      'Employee security analytics is temporarily unavailable.',
    );
    const byEmployeeId = new Map<string, EmployeeSecurityAggregate>();
    try {
      for (const line of body.split('\n')) {
        if (line.trim().length === 0) continue;
        const row = JSON.parse(line) as ClickHouseSecurityRow;
        const employeeId = identityOwners.get(
          readIdentityHash(row.employee_identity_hash),
        );
        if (!employeeId) continue;
        const current = byEmployeeId.get(employeeId) ?? {
          requestCount: 0n,
          maskedRequestCount: 0n,
          blockedRequestCount: 0n,
        };
        byEmployeeId.set(employeeId, {
          requestCount:
            current.requestCount + readNonNegativeBigInt(row.request_count),
          maskedRequestCount:
            current.maskedRequestCount +
            readNonNegativeBigInt(row.masked_request_count),
          blockedRequestCount:
            current.blockedRequestCount +
            readNonNegativeBigInt(row.blocked_request_count),
        });
      }
    } catch {
      throw unavailable(
        'EMPLOYEE_SECURITY_ANALYTICS_UNAVAILABLE',
        'Employee security analytics is temporarily unavailable.',
      );
    }
    return { byEmployeeId };
  }

  async readProjectPolicyUsage(input: {
    tenantId: string;
    projectId: string;
    monthFrom: Date;
    monthTo: Date;
    dayFrom: Date;
    dayTo: Date;
    identities: EmployeeUsageIdentity[];
  }): Promise<ClickHouseProjectEmployeePolicyUsageResult> {
    if (!this.enabled) {
      return { byEmployeeId: new Map() };
    }
    const identityOwners = this.buildIdentityOwners(input.identities);
    const body = await this.execute(
      this.projectPolicyUsageQuery(),
      {
        tenant_id: input.tenantId,
        project_id: input.projectId,
        month_from: input.monthFrom.toISOString(),
        month_to: input.monthTo.toISOString(),
        day_from: input.dayFrom.toISOString(),
        day_to: input.dayTo.toISOString(),
      },
      'EMPLOYEE_USAGE_ANALYTICS_UNAVAILABLE',
      'Employee usage analytics is temporarily unavailable.',
    );
    const byEmployeeId = new Map<string, ProjectEmployeePolicyUsage>();
    try {
      for (const line of body.split('\n')) {
        if (line.trim().length === 0) continue;
        const row = JSON.parse(line) as ClickHouseProjectPolicyUsageRow;
        const employeeId = identityOwners.get(
          readIdentityHash(row.employee_identity_hash),
        );
        if (!employeeId) continue;
        const current = byEmployeeId.get(employeeId) ?? {
          dailyUsedTokens: 0n,
          usedMicroUsd: 0n,
        };
        byEmployeeId.set(employeeId, {
          dailyUsedTokens:
            current.dailyUsedTokens +
            readNonNegativeBigInt(row.daily_used_tokens),
          usedMicroUsd:
            current.usedMicroUsd + readNonNegativeBigInt(row.used_micro_usd),
        });
      }
    } catch {
      throw unavailable(
        'EMPLOYEE_USAGE_ANALYTICS_UNAVAILABLE',
        'Employee usage analytics is temporarily unavailable.',
      );
    }
    return { byEmployeeId };
  }

  private async execute(
    query: string,
    parameters: Record<string, string>,
    errorCode: string,
    errorMessage: string,
  ): Promise<string> {
    const endpoint = new URL(this.endpointUrl);
    endpoint.searchParams.set('database', this.database);
    for (const [key, value] of Object.entries(parameters)) {
      endpoint.searchParams.set(`param_${key}`, value);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64')}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: query,
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw unavailable(errorCode, errorMessage);
      }
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > 8 * 1024 * 1024) {
        throw unavailable(errorCode, errorMessage);
      }
      return body;
    } catch {
      throw unavailable(errorCode, errorMessage);
    } finally {
      clearTimeout(timeout);
    }
  }

  private usageQuery(): string {
    return `
SELECT
  employee_identity_hash,
  count() AS request_count,
  sum(prompt_tokens) AS input_tokens,
  sum(completion_tokens) AS output_tokens,
  sum(total_tokens) AS total_tokens,
  sum(cost_micro_usd) AS cost_micro_usd,
  toString(max(toUnixTimestamp64Milli(ingested_at))) AS source_max_at_ms
FROM \`${this.database}\`.\`${this.table}\` FINAL
WHERE tenant_id = {tenant_id:UUID}
  AND created_at >= parseDateTime64BestEffort({from:String}, 3, 'UTC')
  AND created_at < parseDateTime64BestEffort({to:String}, 3, 'UTC')
GROUP BY employee_identity_hash
FORMAT JSONEachRow
`.trim();
  }

  private securityQuery(): string {
    return `
SELECT
  employee_identity_hash,
  count() AS request_count,
  countIf(masking_action = 'redacted') AS masked_request_count,
  countIf(
    masking_action = 'blocked'
    OR positionCaseInsensitive(safety_outcome, 'block') > 0
  ) AS blocked_request_count
FROM \`${this.database}\`.\`${this.table}\` FINAL
WHERE tenant_id = {tenant_id:UUID}
  AND created_at >= parseDateTime64BestEffort({from:String}, 3, 'UTC')
  AND created_at < parseDateTime64BestEffort({to:String}, 3, 'UTC')
GROUP BY employee_identity_hash
FORMAT JSONEachRow
`.trim();
  }

  private projectPolicyUsageQuery(): string {
    return `
SELECT
  employee_identity_hash,
  sum(cost_micro_usd) AS used_micro_usd,
  sumIf(
    total_tokens,
    created_at >= parseDateTime64BestEffort({day_from:String}, 3, 'UTC')
    AND created_at < parseDateTime64BestEffort({day_to:String}, 3, 'UTC')
  ) AS daily_used_tokens
FROM \`${this.database}\`.\`${this.table}\` FINAL
WHERE tenant_id = {tenant_id:UUID}
  AND project_id = {project_id:UUID}
  AND created_at >= parseDateTime64BestEffort({month_from:String}, 3, 'UTC')
  AND created_at < parseDateTime64BestEffort({month_to:String}, 3, 'UTC')
GROUP BY employee_identity_hash
FORMAT JSONEachRow
`.trim();
  }

  private buildIdentityOwners(
    identities: EmployeeUsageIdentity[],
  ): Map<string, string> {
    const candidates = new Map<
      string,
      Array<{ employeeId: string; priority: number }>
    >();
    for (const identity of identities) {
      const values = [
        { priority: 1, value: identity.employeeId },
        { priority: 2, value: identity.userId },
        { priority: 3, value: identity.email },
      ];
      for (const candidate of values) {
        if (!candidate.value) continue;
        const hash = this.hashIdentity(candidate.value);
        const existing = candidates.get(hash) ?? [];
        existing.push({
          employeeId: identity.employeeId,
          priority: candidate.priority,
        });
        candidates.set(hash, existing);
      }
    }

    const owners = new Map<string, string>();
    for (const [hash, values] of candidates) {
      const preferredPriority = Math.min(...values.map((value) => value.priority));
      const preferredOwners = new Set(
        values
          .filter((value) => value.priority === preferredPriority)
          .map((value) => value.employeeId),
      );
      if (preferredOwners.size === 1) {
        owners.set(hash, [...preferredOwners][0]!);
      }
    }
    return owners;
  }

  private hashIdentity(value: string): string {
    return createHmac('sha256', this.identityKey)
      .update(value.trim().toLowerCase(), 'utf8')
      .digest('hex');
  }
}

function readIdentityHash(value: unknown): string {
  if (typeof value !== 'string' || (value !== '' && !/^[0-9a-f]{64}$/.test(value))) {
    throw new Error('invalid ClickHouse employee identity hash');
  }
  return value;
}

function readAggregate(row: ClickHouseAggregateRow): EmployeeUsageAggregate {
  return {
    requestCount: readNonNegativeBigInt(row.request_count),
    inputTokens: readNonNegativeBigInt(row.input_tokens),
    outputTokens: readNonNegativeBigInt(row.output_tokens),
    totalTokens: readNonNegativeBigInt(row.total_tokens),
    costMicroUsd: readNonNegativeBigInt(row.cost_micro_usd),
  };
}

function readNonNegativeBigInt(value: unknown): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) {
    throw new Error('invalid ClickHouse aggregate');
  }
  return BigInt(value);
}

function readTimestamp(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const milliseconds = readNonNegativeBigInt(value);
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('invalid ClickHouse source timestamp');
  }
  const date = new Date(Number(milliseconds));
  if (!Number.isFinite(date.getTime())) {
    throw new Error('invalid ClickHouse source timestamp');
  }
  return date;
}

function addAggregate(
  left: EmployeeUsageAggregate,
  right: EmployeeUsageAggregate,
): EmployeeUsageAggregate {
  return {
    requestCount: left.requestCount + right.requestCount,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costMicroUsd: left.costMicroUsd + right.costMicroUsd,
  };
}

function unavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code,
    message,
  });
}

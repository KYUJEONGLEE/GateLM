import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260715180000_tenant_employee_cost_policies/migration.sql',
);
const LIMIT_CONSTRAINT_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260715180100_tenant_employee_cost_policy_limit_constraints/migration.sql',
);

describe('Tenant employee cost policy migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const limitConstraintSql = readFileSync(
    LIMIT_CONSTRAINT_MIGRATION_PATH,
    'utf8',
  );
  const compactSql = sql.replace(/\s+/g, ' ').trim();

  it('creates tenant-scoped policy and append-only audit tables', () => {
    expect(sql).toContain('CREATE TABLE tenant_employee_cost_policies');
    expect(sql).toContain('CREATE TABLE tenant_employee_cost_policy_audits');
    expect(compactSql).toContain('PRIMARY KEY (tenant_id, employee_id)');
    expect(compactSql).toContain(
      'FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, "tenantId")',
    );
    expect(compactSql).toContain(
      'UNIQUE (tenant_id, employee_id, policy_version)',
    );
  });

  it('requires explicit enabled limits and bounded policy values', () => {
    expect(compactSql).toContain(
      '(daily_enabled AND daily_limit_micro_usd > 0) OR (NOT daily_enabled AND daily_limit_micro_usd = 0)',
    );
    expect(compactSql).toContain(
      '(weekly_enabled AND weekly_limit_micro_usd > 0) OR (NOT weekly_enabled AND weekly_limit_micro_usd = 0)',
    );
    expect(sql).toContain("CHECK (currency = 'USD')");
    expect(sql).toContain('CHECK (warning_threshold_percent BETWEEN 1 AND 99)');
    expect(sql).toContain(
      "CHECK (enforcement_mode IN ('monitor', 'restrict_high_cost'))",
    );
    expect(limitConstraintSql).toContain(
      'daily_limit_micro_usd <= 100000000000000',
    );
    expect(limitConstraintSql).toContain(
      'weekly_limit_micro_usd <= 100000000000000',
    );
    expect(compactWhitespace(limitConstraintSql)).toContain(
      'AND (NOT daily_enabled OR daily_limit_micro_usd > 0)',
    );
    expect(compactWhitespace(limitConstraintSql)).toContain(
      'AND (NOT weekly_enabled OR weekly_limit_micro_usd > 0)',
    );
  });

  it('is additive and does not contain forbidden request or credential fields', () => {
    expect(sql).not.toMatch(/^\s*(?:DROP|TRUNCATE|UPDATE|DELETE\s+FROM)\b/im);
    expect(sql).not.toMatch(
      /raw_(?:prompt|response)|authorization|api_key|app_token|provider_key/i,
    );
    expect(limitConstraintSql).not.toMatch(
      /^\s*(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|UPDATE|DELETE\s+FROM)\b/im,
    );
  });
});

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

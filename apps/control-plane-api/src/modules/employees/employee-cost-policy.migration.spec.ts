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
const LEDGER_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260715180200_tenant_employee_cost_ledger/migration.sql',
);

describe('Tenant employee cost policy migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const limitConstraintSql = readFileSync(
    LIMIT_CONSTRAINT_MIGRATION_PATH,
    'utf8',
  );
  const ledgerSql = readFileSync(LEDGER_MIGRATION_PATH, 'utf8');
  const compactSql = sql.replace(/\s+/g, ' ').trim();
  const compactLedgerSql = compactWhitespace(ledgerSql);

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

  it('creates the authoritative period, request, attempt, and append-only ledger records', () => {
    expect(ledgerSql).toContain('CREATE TABLE tenant_employee_cost_periods');
    expect(ledgerSql).toContain(
      'CREATE TABLE tenant_employee_cost_reservations',
    );
    expect(ledgerSql).toContain(
      'CREATE TABLE tenant_employee_cost_provider_attempts',
    );
    expect(ledgerSql).toContain(
      'CREATE TABLE tenant_employee_cost_ledger_entries',
    );
    expect(compactLedgerSql).toContain(
      'PRIMARY KEY ( tenant_id, employee_id, period_kind, period_start, currency )',
    );
    expect(compactLedgerSql).toContain('UNIQUE (surface, request_id)');
    expect(compactLedgerSql).toContain(
      'UNIQUE (reservation_id, event_version)',
    );
    expect(compactLedgerSql).toContain(
      'UNIQUE ( reservation_id, surface, request_id, tenant_id, employee_id )',
    );
  });

  it('pins both period identities and every attempt to the same tenant employee', () => {
    expect(compactLedgerSql).toContain(
      'FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, "tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(compactLedgerSql).toContain(
      'CONSTRAINT employee_cost_periods_rollout_fkey FOREIGN KEY (tenant_id) REFERENCES tenant_employee_cost_ledger_rollouts(tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(compactLedgerSql).toContain(
      'CONSTRAINT employee_cost_reservations_day_period_fkey FOREIGN KEY ( tenant_id, employee_id, day_period_kind, day_period_start, currency ) REFERENCES tenant_employee_cost_periods ( tenant_id, employee_id, period_kind, period_start, currency ) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(compactLedgerSql).toContain(
      'CONSTRAINT employee_cost_reservations_week_period_fkey FOREIGN KEY ( tenant_id, employee_id, week_period_kind, week_period_start, currency ) REFERENCES tenant_employee_cost_periods ( tenant_id, employee_id, period_kind, period_start, currency ) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(compactLedgerSql).toContain(
      'CONSTRAINT employee_cost_attempts_reservation_fkey FOREIGN KEY ( reservation_id, surface, request_id, tenant_id, employee_id )',
    );
    expect(compactLedgerSql).toContain(
      'CONSTRAINT employee_cost_ledger_reservation_fkey FOREIGN KEY ( reservation_id, surface, request_id, tenant_id, employee_id )',
    );
    expect(ledgerSql).not.toContain('ON DELETE CASCADE');
  });

  it('bounds safe-integer accounting values and state vocabularies', () => {
    expect(ledgerSql).toContain('9007199254740991');
    expect(ledgerSql).toContain(
      "CHECK (period_kind IN ('day', 'week'))",
    );
    expect(ledgerSql).toContain(
      "CHECK (state IN ('not_configured', 'normal', 'warning', 'exceeded'))",
    );
    expect(compactLedgerSql).toContain(
      "CHECK (state IN ('reserved', 'settled', 'released', 'unconfirmed'))",
    );
    expect(compactLedgerSql).toContain(
      "event_type IN ( 'reserve', 'top_up', 'settle', 'release', 'unconfirmed', 'late_correction' )",
    );
    expect(compactLedgerSql).toContain(
      "usage_quality IN ('not_available', 'confirmed', 'pending_unconfirmed')",
    );
    expect(compactLedgerSql).toContain(
      "dispatch_state IN ('not_started', 'started')",
    );
    expect(ledgerSql.match(/pricing_version text NOT NULL/g)).toHaveLength(2);
    expect(compactLedgerSql).toContain(
      'char_length(pricing_version) BETWEEN 1 AND 128',
    );
    expect(ledgerSql).toContain(
      'cache_read_input_micro_usd_per_million_tokens bigint NULL',
    );
    expect(ledgerSql).toContain(
      'confirmed_cache_read_input_tokens bigint NOT NULL DEFAULT 0',
    );
    expect(compactLedgerSql).toContain(
      'cache_read_input_micro_usd_per_million_tokens <= input_micro_usd_per_million_tokens',
    );
    expect(compactLedgerSql).toContain(
      'confirmed_cache_read_input_tokens <= confirmed_input_tokens',
    );
  });

  it('creates traffic-off rollout coverage and append-only rollout audit evidence', () => {
    expect(ledgerSql).toContain(
      'CREATE TABLE tenant_employee_cost_ledger_rollouts',
    );
    expect(ledgerSql).toContain(
      'CREATE TABLE tenant_employee_cost_ledger_rollout_audits',
    );
    expect(ledgerSql).toContain("mode text NOT NULL DEFAULT 'off'");
    expect(ledgerSql).toContain('activation_boundary_at timestamptz NULL');
    expect(ledgerSql).toContain(
      'project_application_covered_from timestamptz NULL',
    );
    expect(ledgerSql).toContain('tenant_chat_covered_from timestamptz NULL');
    expect(ledgerSql).toContain('coverage_invalidated_at timestamptz NULL');
    expect(ledgerSql).toContain('updated_by_kind text NOT NULL');
    expect(ledgerSql).toContain('actor_kind text NOT NULL');
    expect(compactLedgerSql).toContain(
      "CHECK (mode IN ('off', 'shadow', 'enforce'))",
    );
    expect(compactLedgerSql).toContain(
      "updated_by_kind IN ('admin', 'system')",
    );
    expect(compactLedgerSql).toContain("actor_kind IN ('admin', 'system')");
    expect(compactLedgerSql).toContain(
      'UNIQUE (tenant_id, rollout_version)',
    );
  });

  it('keeps the ledger migration additive and content-free', () => {
    expect(ledgerSql).not.toMatch(
      /^\s*(?:DROP|TRUNCATE|UPDATE|DELETE\s+FROM)\b/im,
    );
    expect(ledgerSql).not.toMatch(
      /raw_(?:prompt|response|detected)|authorization|api_key|app_token|provider_key/i,
    );
  });
});

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

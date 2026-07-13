import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260712190000_tenant_chat_runtime_usage_pr1/migration.sql',
);
const ACTIVE_USAGE_DDL_PATH = resolve(
  __dirname,
  '../../../../../docs/tenant-chat/db/tenant-chat-usage.sql',
);

describe('Tenant Chat PR1 migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const activeUsageDdl = readFileSync(ACTIVE_USAGE_DDL_PATH, 'utf8');

  it.each([
    'tenant_chat_request_admissions',
    'tenant_chat_user_token_periods',
    'tenant_chat_tenant_cost_periods',
    'tenant_chat_usage_reservations',
    'tenant_chat_provider_attempts',
    'tenant_chat_usage_ledger_entries',
    'tenant_chat_invocation_outbox',
    'tenant_chat_invocation_logs',
  ])('creates the contracted usage table %s', (tableName) => {
    expect(sql).toContain(`CREATE TABLE ${tableName}`);
  });

  it('keeps the migration additive', () => {
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+(?:runtime_configs|runtime_snapshots|active_runtime_snapshots)\b/i);
  });

  it('does not introduce Project or Application columns into Tenant Chat tables', () => {
    expect(sql).not.toMatch(/\bproject_id\b/i);
    expect(sql).not.toMatch(/\bapplication_id\b/i);
  });

  it('binds RuntimeSnapshot dependencies to the same tenant', () => {
    const compactSql = compactWhitespace(sql);

    expect(compactSql).toContain(
      'CONSTRAINT tenant_chat_pricing_identity_tenant_key UNIQUE (id, tenant_id)',
    );
    expect(compactSql).toContain(
      'CONSTRAINT tenant_chat_runtime_config_identity_tenant_key UNIQUE (id, tenant_id)',
    );
    expect(compactSql).toContain(
      'FOREIGN KEY (runtime_config_id, tenant_id) REFERENCES tenant_chat_runtime_configs (id, tenant_id)',
    );
    expect(compactSql).toContain(
      'FOREIGN KEY (pricing_catalog_id, tenant_id) REFERENCES tenant_chat_pricing_catalogs (id, tenant_id)',
    );
  });

  it.each([
    ['implementation migration', sql],
    ['active usage DDL', activeUsageDdl],
  ])('binds usage children to reservation tenant in %s', (_source, sourceSql) => {
    const compactSql = compactWhitespace(sourceSql);

    expect(compactSql).toContain(
      'CONSTRAINT tenant_chat_reservation_identity_key UNIQUE (reservation_id, request_id, tenant_id)',
    );
    expect(compactSql).toContain(
      'FOREIGN KEY (reservation_id, request_id, tenant_id) REFERENCES tenant_chat_usage_reservations (reservation_id, request_id, tenant_id)',
    );
  });

  it.each([
    ['implementation migration', sql],
    ['active usage DDL', activeUsageDdl],
  ])('allows any non-negative provider cache-read price in %s', (_source, sourceSql) => {
    expect(sourceSql).not.toMatch(
      /cache_read_input_micro_usd_per_million_tokens\s*<=\s*input_micro_usd_per_million_tokens/,
    );
  });
});

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

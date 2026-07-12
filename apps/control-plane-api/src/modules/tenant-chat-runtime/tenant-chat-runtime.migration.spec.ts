import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260712190000_tenant_chat_runtime_usage_pr1/migration.sql',
);

describe('Tenant Chat PR1 migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

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
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260718120000_tenant_chat_policy_impact_observability/migration.sql',
);

describe('Tenant Chat policy-impact observability migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('adds nullable bounded observations without fabricating historical cache savings', () => {
    expect(sql).toContain('ADD COLUMN effective_route_tier text');
    expect(sql).toContain('ADD COLUMN saved_cost_micro_usd bigint');
    expect(sql).toContain('ADD COLUMN masking_action text');
    expect(sql).toContain("effective_route_tier IN ('high_quality', 'standard', 'economy')");
    expect(sql).toContain("WHERE cache_outcome <> 'hit'");
    expect(sql).not.toContain("WHERE cache_outcome = 'hit'");
  });

  it('backfills only deterministic route and safety observations', () => {
    expect(sql).toContain("route ->> 'providerId' = invocation.effective_provider_id");
    expect(sql).toContain("route ->> 'modelKey' = invocation.effective_model_key");
    expect(sql).toContain("WHERE terminal_outcome = 'safety_blocked'");
    expect(sql).not.toMatch(/prompt|response|content/i);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260718130000_tenant_chat_safety_projection/migration.sql',
);

describe('Tenant Chat safety projection migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('adds the same content-free safety evidence to admission and terminal projection', () => {
    expect(sql).toContain('ALTER TABLE tenant_chat_request_admissions');
    expect(sql).toContain('ALTER TABLE tenant_chat_invocation_logs');
    expect(sql.match(/ADD COLUMN masking_detected_types jsonb/g)).toHaveLength(2);
    expect(sql.match(/ADD COLUMN masking_detected_count integer/g)).toHaveLength(2);
    expect(sql.match(/ADD COLUMN safety_policy_digest text/g)).toHaveLength(2);
  });

  it('keeps legacy rows nullable and bounds every newly observed summary', () => {
    expect(sql).toContain("masking_action IN ('none', 'redacted', 'blocked')");
    expect(sql).toContain('jsonb_array_length(masking_detected_types) <= 32');
    expect(sql).toContain('masking_detected_count BETWEEN 0 AND 1000000');
    expect(sql).not.toMatch(/prompt|response|detected_value|span|offset/i);
  });
});

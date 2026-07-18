import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260718130000_tenant_chat_safety_projection/migration.sql',
);
const CONSTRAINT_GUARD_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260719100000_tenant_chat_safety_constraint_guard/migration.sql',
);

describe('Tenant Chat safety projection migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const constraintGuardSql = readFileSync(
    CONSTRAINT_GUARD_MIGRATION_PATH,
    'utf8',
  );

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

  it('replaces both array-length checks with guarded additive constraints', () => {
    expect(
      constraintGuardSql.match(
        /WHEN jsonb_typeof\(masking_detected_types\) = 'array'/g,
      ),
    ).toHaveLength(2);
    expect(
      constraintGuardSql.match(
        /THEN jsonb_array_length\(masking_detected_types\) <= 32/g,
      ),
    ).toHaveLength(2);
    expect(constraintGuardSql.match(/\) NOT VALID;/g)).toHaveLength(2);
    expect(constraintGuardSql.match(/VALIDATE CONSTRAINT/g)).toHaveLength(2);
    expect(constraintGuardSql).toContain(
      'RENAME CONSTRAINT tenant_chat_admission_safety_summary_guard_check',
    );
    expect(constraintGuardSql).toContain(
      'RENAME CONSTRAINT tenant_chat_log_safety_summary_guard_check',
    );
    expect(constraintGuardSql).not.toMatch(
      /prompt|response|detected_value|span|offset/i,
    );
  });
});

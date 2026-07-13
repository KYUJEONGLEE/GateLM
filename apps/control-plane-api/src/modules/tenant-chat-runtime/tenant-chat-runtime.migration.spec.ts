import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HISTORICAL_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260712190000_tenant_chat_runtime_usage_pr1/migration.sql',
);
const CACHE_READ_PRICE_CONSTRAINT_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260713120000_tenant_chat_cache_read_price_constraint/migration.sql',
);
const CACHE_READ_PRICE_VALIDATION_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260713120001_tenant_chat_cache_read_price_validation/migration.sql',
);
const ACTIVE_USAGE_DDL_PATH = resolve(
  __dirname,
  '../../../../../docs/tenant-chat/db/tenant-chat-usage.sql',
);

describe('Tenant Chat migrations', () => {
  const historicalSql = readFileSync(HISTORICAL_MIGRATION_PATH, 'utf8');
  const cacheReadPriceConstraintSql = readFileSync(
    CACHE_READ_PRICE_CONSTRAINT_MIGRATION_PATH,
    'utf8',
  );
  const cacheReadPriceValidationSql = readFileSync(
    CACHE_READ_PRICE_VALIDATION_MIGRATION_PATH,
    'utf8',
  );
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
    expect(historicalSql).toContain(`CREATE TABLE ${tableName}`);
  });

  it('keeps the historical migration additive', () => {
    expect(historicalSql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(historicalSql).not.toMatch(
      /\bALTER\s+TABLE\s+(?:runtime_configs|runtime_snapshots|active_runtime_snapshots)\b/i,
    );
  });

  it('does not introduce Project or Application columns into Tenant Chat tables', () => {
    expect(historicalSql).not.toMatch(/\bproject_id\b/i);
    expect(historicalSql).not.toMatch(/\bapplication_id\b/i);
  });

  it('binds RuntimeSnapshot dependencies to the same tenant', () => {
    const compactSql = compactWhitespace(historicalSql);

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
    ['historical implementation migration', historicalSql],
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

  it('distinguishes the historical migration, constraint add, and contracted final state', () => {
    const cacheReadPricePredicate =
      /cache_read_input_micro_usd_per_million_tokens\s*<=\s*input_micro_usd_per_million_tokens/;

    expect(historicalSql).not.toMatch(cacheReadPricePredicate);
    expect(cacheReadPriceConstraintSql).toMatch(cacheReadPricePredicate);
    expect(cacheReadPriceValidationSql).not.toMatch(cacheReadPricePredicate);
    expect(activeUsageDdl).toMatch(cacheReadPricePredicate);
    expect(cacheReadPriceConstraintSql).toContain(
      'tenant_chat_attempt_cache_read_price_check',
    );
    expect(cacheReadPriceValidationSql).toContain(
      'tenant_chat_attempt_cache_read_price_check',
    );
    expect(activeUsageDdl).toContain('tenant_chat_attempt_cache_read_price_check');
  });

  it.each([
    [
      'adding the constraint',
      cacheReadPriceConstraintSql,
      'ADD CONSTRAINT tenant_chat_attempt_cache_read_price_check',
    ],
    [
      'validating the constraint',
      cacheReadPriceValidationSql,
      'VALIDATE CONSTRAINT tenant_chat_attempt_cache_read_price_check',
    ],
  ])(
    'preflights provider attempts and active RuntimeSnapshots before %s',
    (_phase, sourceSql, operation) => {
      const compactSql = compactWhitespace(sourceSql);
      const providerAttemptPreflight = compactSql.indexOf(
        'FROM tenant_chat_provider_attempts WHERE cache_read_input_micro_usd_per_million_tokens IS NOT NULL',
      );
      const activeSnapshotPreflight = compactSql.indexOf(
        'FROM tenant_chat_active_runtime_snapshots AS active_snapshot JOIN tenant_chat_runtime_snapshots AS runtime_snapshot',
      );
      const operationIndex = compactSql.indexOf(operation);

      expect(providerAttemptPreflight).toBeGreaterThanOrEqual(0);
      expect(activeSnapshotPreflight).toBeGreaterThanOrEqual(0);
      expect(operationIndex).toBeGreaterThanOrEqual(0);
      expect(providerAttemptPreflight).toBeLessThan(operationIndex);
      expect(activeSnapshotPreflight).toBeLessThan(operationIndex);
      expect(compactSql).toContain(
        "'$.pricing.routes[*] ? (@.cacheReadInputMicroUsdPerMillionTokens > @.inputMicroUsdPerMillionTokens)'",
      );
    },
  );

  it('keeps both forward migrations non-mutating and separates add from validation', () => {
    const compactConstraintSql = compactWhitespace(cacheReadPriceConstraintSql);
    const compactValidationSql = compactWhitespace(cacheReadPriceValidationSql);

    expect(cacheReadPriceConstraintSql).not.toMatch(
      /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i,
    );
    expect(cacheReadPriceValidationSql).not.toMatch(
      /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i,
    );
    expect(compactConstraintSql).toContain(
      'CHECK ( cache_read_input_micro_usd_per_million_tokens IS NULL OR cache_read_input_micro_usd_per_million_tokens <= input_micro_usd_per_million_tokens ) NOT VALID',
    );
    expect(compactConstraintSql).not.toContain(
      'VALIDATE CONSTRAINT tenant_chat_attempt_cache_read_price_check',
    );
    expect(compactValidationSql).toContain(
      'VALIDATE CONSTRAINT tenant_chat_attempt_cache_read_price_check',
    );
    expect(compactValidationSql).not.toContain(
      'ADD CONSTRAINT tenant_chat_attempt_cache_read_price_check',
    );
  });
});

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

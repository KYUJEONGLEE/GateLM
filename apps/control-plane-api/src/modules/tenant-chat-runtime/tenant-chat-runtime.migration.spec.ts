import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HISTORICAL_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260712190000_tenant_chat_runtime_usage_pr1/migration.sql',
);
const CACHE_READ_PRICE_ADD_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260713135500_tenant_chat_cache_read_price_constraint/migration.sql',
);
const CACHE_READ_PRICE_VALIDATION_MIGRATION_PATH = resolve(
  __dirname,
  '../../../prisma/migrations/20260713135501_tenant_chat_cache_read_price_validation/migration.sql',
);
const ACTIVE_USAGE_DDL_PATH = resolve(
  __dirname,
  '../../../../../docs/tenant-chat/db/tenant-chat-usage.sql',
);

const SAFE_PREFLIGHT_MESSAGES = [
  'Tenant Chat cache-read price preflight failed: provider attempt data violates the active pricing contract.',
  'Tenant Chat cache-read price preflight failed: an active RuntimeSnapshot violates the active pricing contract.',
];

describe('Tenant Chat migrations', () => {
  const historicalSql = readFileSync(HISTORICAL_MIGRATION_PATH, 'utf8');
  const cacheReadPriceAddSql = readFileSync(CACHE_READ_PRICE_ADD_MIGRATION_PATH, 'utf8');
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
  ])('creates the contracted usage table %s in historical PR1', (tableName) => {
    expect(historicalSql).toContain(`CREATE TABLE ${tableName}`);
  });

  it('keeps the historical PR1 migration additive and unchanged in meaning', () => {
    expect(historicalSql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(historicalSql).not.toMatch(
      /\bALTER\s+TABLE\s+(?:runtime_configs|runtime_snapshots|active_runtime_snapshots)\b/i,
    );
    expect(historicalSql).not.toMatch(
      /cache_read_input_micro_usd_per_million_tokens\s*<=\s*input_micro_usd_per_million_tokens/,
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
    ['historical PR1', historicalSql],
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

  it('distinguishes historical, ADD, VALIDATE, and final DDL boundaries', () => {
    const compactAddSql = compactWhitespace(cacheReadPriceAddSql);
    const compactActiveDdl = compactWhitespace(activeUsageDdl);

    expect(historicalSql).not.toContain('tenant_chat_attempt_cache_read_price_check');
    expect(compactAddSql).toContain(
      'ADD CONSTRAINT tenant_chat_attempt_cache_read_price_check CHECK ( cache_read_input_micro_usd_per_million_tokens IS NULL OR cache_read_input_micro_usd_per_million_tokens <= input_micro_usd_per_million_tokens ) NOT VALID',
    );
    expect(cacheReadPriceAddSql).not.toContain('VALIDATE CONSTRAINT');
    expect(cacheReadPriceValidationSql).toContain(
      'VALIDATE CONSTRAINT tenant_chat_attempt_cache_read_price_check',
    );
    expect(cacheReadPriceValidationSql).not.toContain('ADD CONSTRAINT');
    expect(compactActiveDdl).toContain(
      'CONSTRAINT tenant_chat_attempt_cache_read_price_check CHECK ( cache_read_input_micro_usd_per_million_tokens IS NULL OR cache_read_input_micro_usd_per_million_tokens <= input_micro_usd_per_million_tokens )',
    );
    expect(activeUsageDdl).not.toContain('NOT VALID');
  });

  it('repeats the same safe preflight immediately before validation', () => {
    expect(extractPreflight(cacheReadPriceValidationSql)).toBe(
      extractPreflight(cacheReadPriceAddSql),
    );
  });

  it.each([
    ['ADD', cacheReadPriceAddSql, 'ADD CONSTRAINT'],
    ['VALIDATE', cacheReadPriceValidationSql, 'VALIDATE CONSTRAINT'],
  ])(
    'runs provider-attempt and active RuntimeSnapshot preflight before %s',
    (_phase, sourceSql, ddlMarker) => {
      expect(sourceSql).toContain('FROM tenant_chat_provider_attempts');
      expect(sourceSql).toContain('FROM tenant_chat_active_runtime_snapshots');
      expect(sourceSql).toContain('jsonb_path_exists');
      expect(sourceSql).toContain(`ERRCODE = '23514'`);
      expect(sourceSql.indexOf('RAISE EXCEPTION')).toBeLessThan(
        sourceSql.indexOf(ddlMarker),
      );
    },
  );

  it.each([
    ['ADD', cacheReadPriceAddSql],
    ['VALIDATE', cacheReadPriceValidationSql],
  ])('keeps the %s migration non-mutating', (_phase, sourceSql) => {
    expect(sourceSql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  });

  it.each([
    ['ADD', cacheReadPriceAddSql],
    ['VALIDATE', cacheReadPriceValidationSql],
  ])('uses fixed, identifier-free preflight messages in %s', (_phase, sourceSql) => {
    const messages = [...sourceSql.matchAll(/MESSAGE\s*=\s*'([^']+)'/g)].map(
      ([, message]) => message,
    );

    expect(messages).toEqual(SAFE_PREFLIGHT_MESSAGES);
    expect(sourceSql).not.toContain('violation_examples');
    expect(sourceSql).not.toMatch(/MESSAGE\s*=\s*format/i);
  });
});

function extractPreflight(value: string): string {
  const match = value.match(
    /DO \$tenant_chat_cache_read_price_preflight\$[\s\S]*?\$tenant_chat_cache_read_price_preflight\$;/,
  );

  expect(match).not.toBeNull();
  return compactWhitespace(match?.[0] ?? '');
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

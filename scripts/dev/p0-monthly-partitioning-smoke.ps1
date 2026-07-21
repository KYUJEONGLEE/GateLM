param(
    [switch]$KeepDatabase,
    [ValidateSet("db", "aws", "selfhost")]
    [string]$MigrationSource = "db",
    [ValidateRange(0, 500000)]
    [int]$SyntheticRows = 0
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$containerName = "gatelm-p0-partition-smoke-$stamp"
$previousDatabaseUrl = $env:DATABASE_URL
$containerStarted = $false

function Assert-LastExitCode {
    param([string]$Operation)

    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE"
    }
}

function Invoke-ContainerSql {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [string[]]$ExtraArguments = @(),
        [switch]$TuplesOnly
    )

    $arguments = @(
        "exec", "-i", $containerName,
        "psql", "-X", "-U", "gatelm", "-d", "gatelm",
        "-v", "ON_ERROR_STOP=1", "-q"
    )
    if ($TuplesOnly) {
        $arguments += @("-A", "-t", "-F", "|")
    }
    $arguments += $ExtraArguments

    $output = $Sql | & docker @arguments
    Assert-LastExitCode -Operation "PostgreSQL command"
    return $output
}

function Invoke-ContainerSqlFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string[]]$ExtraArguments = @()
    )

    $sql = Get-Content -LiteralPath (Join-Path $repoRoot $Path) -Raw
    Invoke-ContainerSql -Sql $sql -ExtraArguments $ExtraArguments | Out-Null
}

try {
    Push-Location $repoRoot

    & docker run -d --name $containerName -p "127.0.0.1::5432" `
        -e POSTGRES_USER=gatelm `
        -e POSTGRES_PASSWORD=gatelm `
        -e POSTGRES_DB=gatelm `
        "pgvector/pgvector:0.8.5-pg16-trixie" | Out-Null
    Assert-LastExitCode -Operation "Start ephemeral PostgreSQL"
    $containerStarted = $true

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        & docker exec $containerName pg_isready -U gatelm -d gatelm *> $null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw "Ephemeral PostgreSQL did not become ready"
    }

    $binding = (& docker port $containerName "5432/tcp" | Select-Object -First 1).Trim()
    if ($binding -notmatch ":\d+$") {
        throw "Could not resolve ephemeral PostgreSQL port: $binding"
    }
    $port = $binding.Substring($binding.LastIndexOf(":") + 1)
    $env:DATABASE_URL = "postgresql://gatelm:gatelm@127.0.0.1:$port/gatelm?schema=public"

    & corepack pnpm --filter "@gatelm/control-plane-api" exec prisma migrate deploy `
        --schema prisma/schema.prisma | Out-Null
    Assert-LastExitCode -Operation "Apply Control Plane migrations"

    if ($MigrationSource -eq "db") {
        $gatewayMigrations = @(
            "db/migrations/006_create_p0_invocation_logs_fallback.sql",
            "db/migrations/007_create_gateway_rate_limit_counters.sql",
            "db/migrations/008_alter_gateway_rate_limit_counters_cascade.sql",
            "db/migrations/009_alter_p0_invocation_logs_api_key_fk.sql",
            "db/migrations/010_create_budget_ledger.sql",
            "db/migrations/011_create_gateway_rate_limit_scope_counters.sql",
            "db/migrations/012_create_model_pricing_catalog_compat.sql",
            "db/migrations/013_seed_openai_canonical_pricing_aliases.sql",
            "db/migrations/014_index_employee_usage_lookup.sql",
            "db/migrations/015_drop_legacy_selected_routing_columns.sql",
            "db/migrations/016_add_p0_invocation_log_ttft.sql",
            "db/migrations/017_add_p0_dashboard_rollup_indexes.sql"
        )
        $stageAMigration = "db/migrations/018_prepare_p0_monthly_partitioning.sql"
        $repeatMigrations = @(
            "db/migrations/006_create_p0_invocation_logs_fallback.sql",
            "db/migrations/016_add_p0_invocation_log_ttft.sql",
            "db/migrations/017_add_p0_dashboard_rollup_indexes.sql",
            $stageAMigration
        )
    }
    else {
        $deploymentRoot = if ($MigrationSource -eq "aws") {
            "deploy/aws-triage/migrations"
        }
        else {
            "deploy/selfhost/migrations"
        }
        $gatewayMigrations = @(
            "$deploymentRoot/001_gateway_runtime_tables.sql",
            "$deploymentRoot/002_drop_legacy_selected_routing_columns.sql",
            "$deploymentRoot/003_add_p0_invocation_log_ttft.sql",
            "$deploymentRoot/004_add_p0_dashboard_rollup_indexes.sql"
        )
        $stageAMigration = "$deploymentRoot/005_prepare_p0_monthly_partitioning.sql"
        $repeatMigrations = @(
            "$deploymentRoot/001_gateway_runtime_tables.sql",
            "$deploymentRoot/003_add_p0_invocation_log_ttft.sql",
            "$deploymentRoot/004_add_p0_dashboard_rollup_indexes.sql",
            $stageAMigration
        )
    }
    foreach ($migration in $gatewayMigrations) {
        Invoke-ContainerSqlFile -Path $migration
    }

    Invoke-ContainerSql -Sql @'
insert into tenants (id, name, "updatedAt")
values ('00000000-0000-4000-8000-000000000100', 'Partition Test', now());

insert into projects (id, "tenantId", name, "updatedAt")
values (
  '00000000-0000-4000-8000-000000000200',
  '00000000-0000-4000-8000-000000000100',
  'Partition Project',
  now()
);

insert into applications (id, "tenantId", "projectId", name, "updatedAt")
values (
  '00000000-0000-4000-8000-000000000300',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  'Partition App',
  now()
);
'@ | Out-Null

    Invoke-ContainerSql -Sql @'
insert into p0_llm_invocation_logs (
  id, request_id, trace_id, tenant_id, project_id, application_id,
  endpoint, method, source, status, http_status,
  request_body_hash, prompt_hash, created_at
) values
  (
    '10000000-0000-4000-8000-000000000001', 'partition-june', 'trace-june',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000300',
    '/v1/chat/completions', 'POST', 'test', 'success', 200,
    'hash-june', 'prompt-june', '2026-06-30 23:59:59+00'
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'partition-july', 'trace-july',
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000300',
    '/v1/chat/completions', 'POST', 'test', 'success', 200,
    'hash-july', 'prompt-july', '2026-07-01 00:00:00+00'
  );
'@ | Out-Null

    if ($SyntheticRows -gt 0) {
        Invoke-ContainerSql -Sql @"
insert into p0_llm_invocation_logs (
  id, request_id, trace_id, tenant_id, project_id, application_id,
  endpoint, method, source, status, http_status,
  request_body_hash, prompt_hash, metadata, created_at
)
select
  md5('partition-synthetic-id-' || sequence)::uuid,
  'partition-synthetic-' || sequence,
  'trace-synthetic-' || sequence,
  '00000000-0000-4000-8000-000000000100'::uuid,
  '00000000-0000-4000-8000-000000000200'::uuid,
  '00000000-0000-4000-8000-000000000300'::uuid,
  '/v1/chat/completions',
  'POST',
  'partition-smoke',
  'success',
  200,
  md5('request-body-' || sequence),
  md5('prompt-' || sequence),
  jsonb_build_object(
    'schemaVersion', 1,
    'syntheticPadding',
      encode(gen_random_bytes(900), 'hex') || encode(gen_random_bytes(900), 'hex')
  ),
  '2026-07-15 00:00:00+00'::timestamptz + sequence * interval '1 microsecond'
from generate_series(1, $SyntheticRows) as generated(sequence);
"@ | Out-Null
    }

    $stageADuration = Measure-Command {
        Invoke-ContainerSqlFile -Path $stageAMigration
    }
    $cutoverDuration = Measure-Command {
        Invoke-ContainerSqlFile `
            -Path "db/maintenance/cutover_p0_invocation_logs_to_monthly_partitions.sql" `
            -ExtraArguments @("-v", "partition_cutover_approved=true")
    }

    Invoke-ContainerSql -Sql @'
insert into p0_llm_invocation_logs (
  id, request_id, trace_id, tenant_id, project_id, application_id,
  endpoint, method, source, status, http_status,
  request_body_hash, prompt_hash, created_at
) values (
  '10000000-0000-4000-8000-000000000003', 'partition-july', 'trace-duplicate',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  '00000000-0000-4000-8000-000000000300',
  '/v1/chat/completions', 'POST', 'test', 'success', 200,
  'hash-duplicate', 'prompt-duplicate', '2026-08-01 00:00:00+00'
) on conflict do nothing;

insert into p0_llm_invocation_logs (
  id, request_id, trace_id, tenant_id, project_id, application_id,
  endpoint, method, source, status, http_status,
  request_body_hash, prompt_hash, created_at
) values (
  '10000000-0000-4000-8000-000000000004', 'partition-september', 'trace-september',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  '00000000-0000-4000-8000-000000000300',
  '/v1/chat/completions', 'POST', 'test', 'success', 200,
  'hash-september', 'prompt-september', '2026-09-15 00:00:00+00'
) on conflict do nothing;
'@ | Out-Null

    foreach ($migration in $repeatMigrations) {
        Invoke-ContainerSqlFile -Path $migration
    }

    $summary = Invoke-ContainerSql -TuplesOnly -Sql @'
select concat_ws(
  '|',
  (select relkind from pg_class where oid = 'p0_llm_invocation_logs'::regclass),
  (select count(*) from pg_inherits where inhparent = 'p0_llm_invocation_logs'::regclass),
  (select count(*) from p0_llm_invocation_logs),
  (select count(*) from p0_llm_invocation_log_keys),
  (select count(*) from p0_llm_invocation_logs where request_id = 'partition-july'),
  (select tableoid::regclass::text from p0_llm_invocation_logs where request_id = 'partition-september'),
  (select count(*) from p0_llm_invocation_logs_legacy_unpartitioned)
);
'@
    $expectedRows = 3 + $SyntheticRows
    $expectedLegacyRows = 2 + $SyntheticRows
    $expected = "p|5|${expectedRows}|${expectedRows}|1|p0_llm_invocation_logs_y202609|${expectedLegacyRows}"
    if ($summary.Trim() -ne $expected) {
        throw "Unexpected partition verification summary: $summary (expected $expected)"
    }

    $plan = Invoke-ContainerSql -TuplesOnly -Sql @'
explain (costs off)
select count(*)
from p0_llm_invocation_logs
where tenant_id = '00000000-0000-4000-8000-000000000100'
  and created_at >= '2026-07-01 00:00:00+00'
  and created_at < '2026-08-01 00:00:00+00';
'@
    $planText = $plan -join "`n"
    if (-not $planText.Contains("p0_llm_invocation_logs_y202607")) {
        throw "Expected July partition in pruned query plan: $planText"
    }
    foreach ($unexpected in @(
        "p0_llm_invocation_logs_y202606",
        "p0_llm_invocation_logs_y202608",
        "p0_llm_invocation_logs_default"
    )) {
        if ($planText.Contains($unexpected)) {
            throw "Partition pruning retained unexpected child ${unexpected}: $planText"
        }
    }

    Write-Host "P0 monthly partitioning smoke passed (${MigrationSource}): $summary"
    Write-Host ("Stage A: {0:N3}s, Stage B: {1:N3}s" -f `
        $stageADuration.TotalSeconds, $cutoverDuration.TotalSeconds)
    Write-Host $planText
}
finally {
    Pop-Location -ErrorAction SilentlyContinue

    if ($null -eq $previousDatabaseUrl) {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
    else {
        $env:DATABASE_URL = $previousDatabaseUrl
    }

    if ($containerStarted -and -not $KeepDatabase) {
        & docker rm -f $containerName *> $null
    }
    elseif ($containerStarted) {
        Write-Host "Ephemeral PostgreSQL retained: $containerName"
    }
}

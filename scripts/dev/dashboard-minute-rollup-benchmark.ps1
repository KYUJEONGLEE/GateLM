param(
    [ValidateRange(60, 500000)]
    [int]$SyntheticRows = 180000,
    [ValidateRange(1, 5000)]
    [int]$RequestsPerSecond = 300,
    [switch]$KeepDatabase
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$containerName = "gatelm-minute-rollup-benchmark-$stamp"
$previousDatabaseUrl = $env:DATABASE_URL
$previousTenantId = $env:ROLLUP_BENCHMARK_TENANT_ID
$previousProjectId = $env:ROLLUP_BENCHMARK_PROJECT_ID
$previousFromUtc = $env:ROLLUP_BENCHMARK_FROM_UTC
$previousToUtc = $env:ROLLUP_BENCHMARK_TO_UTC
$containerStarted = $false
$tenantId = "00000000-0000-4000-8000-000000000100"
$projectId = "00000000-0000-4000-8000-000000000200"
$applicationId = "00000000-0000-4000-8000-000000000300"
$rangeStart = [DateTimeOffset]::Parse("2026-07-21T00:00:00Z")

if ($SyntheticRows % ($RequestsPerSecond * 60) -ne 0) {
    throw "SyntheticRows must represent a whole number of minutes at RequestsPerSecond"
}
$durationSeconds = [int]($SyntheticRows / $RequestsPerSecond)
$rangeEnd = $rangeStart.AddSeconds($durationSeconds)

function Assert-LastExitCode {
    param([string]$Operation)

    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE"
    }
}

function Invoke-ContainerSql {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
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
    $output = $Sql | & docker @arguments
    Assert-LastExitCode -Operation "PostgreSQL command"
    return $output
}

function Invoke-ContainerSqlFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $sql = Get-Content -LiteralPath (Join-Path $repoRoot $Path) -Raw
    Invoke-ContainerSql -Sql $sql | Out-Null
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

    & volta run --node 22 corepack pnpm --filter "@gatelm/control-plane-api" exec prisma migrate deploy `
        --schema prisma/schema.prisma | Out-Null
    Assert-LastExitCode -Operation "Apply Control Plane migrations"

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
        "db/migrations/017_add_p0_dashboard_rollup_indexes.sql",
        "db/migrations/018_prepare_p0_monthly_partitioning.sql"
    )
    foreach ($migration in $gatewayMigrations) {
        Invoke-ContainerSqlFile -Path $migration
    }

    Invoke-ContainerSql -Sql @"
insert into tenants (id, name, "updatedAt")
values ('$tenantId', 'Minute Rollup Benchmark', now());

insert into projects (id, "tenantId", name, "updatedAt")
values ('$projectId', '$tenantId', 'Minute Rollup Project', now());

insert into applications (id, "tenantId", "projectId", name, "updatedAt")
values ('$applicationId', '$tenantId', '$projectId', 'Minute Rollup App', now());
"@ | Out-Null

    $rangeStartSql = $rangeStart.ToString("yyyy-MM-dd HH:mm:ssK")
    Invoke-ContainerSql -Sql @"
insert into p0_llm_invocation_logs (
  id, request_id, trace_id, tenant_id, project_id, application_id,
  endpoint, method, source, stream, provider, model, routing_reason,
  prompt_tokens, completion_tokens, total_tokens,
  cost_micro_usd, saved_cost_micro_usd,
  latency_ms, provider_latency_ms, ttft_ms,
  status, http_status, cache_status, cache_type,
  masking_action, request_body_hash, prompt_hash, metadata,
  created_at, completed_at, ingested_at
)
select
  ('10000000-0000-4000-8000-' || lpad(to_hex(sequence), 12, '0'))::uuid,
  'minute-rollup-' || sequence,
  'trace-minute-rollup-' || sequence,
  '$tenantId'::uuid,
  '$projectId'::uuid,
  '$applicationId'::uuid,
  '/v1/chat/completions', 'POST', 'benchmark', false,
  'mock', 'mock-fast', 'benchmark_difficulty',
  20, 10, 30, 2, 1, 100, 80, 10,
  'success', 200,
  case when sequence % 10 = 0 then 'hit' else 'miss' end,
  'exact',
  case when sequence % 20 = 0 then 'redacted' else 'none' end,
  'request-hash-' || sequence,
  'prompt-hash-' || sequence,
  jsonb_build_object(
    'promptCategory', 'general',
    'promptDifficulty', case when sequence % 3 = 0 then 'complex' else 'simple' end,
    'providerCalled', 'true',
    'terminalStatus', 'success',
    'domainOutcomes', jsonb_build_object(
      'cache', jsonb_build_object(
        'outcome', case when sequence % 10 = 0 then 'hit' else 'miss' end
      ),
      'safety', jsonb_build_object(
        'outcome', case when sequence % 20 = 0 then 'redacted' else 'passed' end
      ),
      'fallback', jsonb_build_object('outcome', 'not_called'),
      'budget', jsonb_build_object('outcome', 'allowed')
    ),
    'padding', repeat(md5(sequence::text), 100)
  ),
  '$rangeStartSql'::timestamptz
    + floor((sequence - 1)::numeric / $RequestsPerSecond) * interval '1 second',
  '$rangeStartSql'::timestamptz
    + floor((sequence - 1)::numeric / $RequestsPerSecond) * interval '1 second'
    + interval '100 milliseconds',
  '$rangeStartSql'::timestamptz
    + floor((sequence - 1)::numeric / $RequestsPerSecond) * interval '1 second'
    + interval '150 milliseconds'
from generate_series(1, $SyntheticRows) sequence;

analyze p0_llm_invocation_logs;
"@ | Out-Null

    $env:ROLLUP_BENCHMARK_TENANT_ID = $tenantId
    $env:ROLLUP_BENCHMARK_PROJECT_ID = $projectId
    $env:ROLLUP_BENCHMARK_FROM_UTC = $rangeStart.ToString("o")
    $env:ROLLUP_BENCHMARK_TO_UTC = $rangeEnd.ToString("o")

    & volta run --node 22 corepack pnpm --filter "@gatelm/control-plane-api" `
        benchmark:dashboard-rollup
    Assert-LastExitCode -Operation "Run dashboard minute rollup benchmark"

    $rangeEndSql = $rangeEnd.ToString("yyyy-MM-dd HH:mm:ssK")
    Invoke-ContainerSql -Sql @"
insert into dashboard_rollup_source_cursors (
  source, cursor_at, cursor_key, last_discovered_at,
  caught_up_at, caught_up_through, created_at, updated_at
) values (
  'project_application', '$rangeEndSql'::timestamptz, 'benchmark', now(),
  now(), '$rangeEndSql'::timestamptz, now(), now()
)
on conflict (source) do update set
  cursor_at = excluded.cursor_at,
  cursor_key = excluded.cursor_key,
  last_discovered_at = excluded.last_discovered_at,
  caught_up_at = excluded.caught_up_at,
  caught_up_through = excluded.caught_up_through,
  updated_at = excluded.updated_at;
"@ | Out-Null

    & go run ./apps/gateway-core/cmd/policy-impact-benchmark
    Assert-LastExitCode -Operation "Run Gateway policy impact read benchmark"
}
finally {
    $env:DATABASE_URL = $previousDatabaseUrl
    $env:ROLLUP_BENCHMARK_TENANT_ID = $previousTenantId
    $env:ROLLUP_BENCHMARK_PROJECT_ID = $previousProjectId
    $env:ROLLUP_BENCHMARK_FROM_UTC = $previousFromUtc
    $env:ROLLUP_BENCHMARK_TO_UTC = $previousToUtc
    if ((Get-Location).Path -eq $repoRoot) {
        Pop-Location
    }
    if ($containerStarted -and -not $KeepDatabase) {
        & docker rm -f $containerName *> $null
    }
    elseif ($containerStarted) {
        Write-Output "Benchmark PostgreSQL kept as $containerName"
    }
}

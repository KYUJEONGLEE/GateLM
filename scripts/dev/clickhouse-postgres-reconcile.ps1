param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClickHouseUrl,

    [Parameter(Mandatory = $true)]
    [string]$TenantId,

    [Parameter(Mandatory = $true)]
    [datetime]$From,

    [Parameter(Mandatory = $true)]
    [datetime]$To,

    [string]$ClickHouseUsername = "analytics_writer",

    [Parameter(Mandatory = $true)]
    [string]$ClickHousePassword,

    [Parameter(Mandatory = $true)]
    [string]$EmployeeIdentityHmacSecret
)

$ErrorActionPreference = "Stop"

if ($From.ToUniversalTime() -ge $To.ToUniversalTime()) {
    throw "From must be earlier than To."
}
if ($TenantId -notmatch '^[0-9a-fA-F-]{36}$') {
    throw "TenantId must be a UUID."
}
if ($EmployeeIdentityHmacSecret.Length -lt 32 -or $EmployeeIdentityHmacSecret -notmatch '^[A-Za-z0-9_-]+$') {
    throw "EmployeeIdentityHmacSecret must be at least 32 URL-safe characters."
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    throw "psql is required."
}

$fromUtc = $From.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss.fff")
$toUtc = $To.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss.fff")
$tenant = $TenantId.ToLowerInvariant()
$clickHouseEndpoint = $ClickHouseUrl.TrimEnd('/')
$basicAuth = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes("${ClickHouseUsername}:${ClickHousePassword}")
)

function Invoke-PostgresQuery {
    param([Parameter(Mandatory = $true)][string]$Query)

    $previousPgOptions = $env:PGOPTIONS
    try {
        $env:PGOPTIONS = "-c gatelm.employee_identity_hmac_secret=$EmployeeIdentityHmacSecret"
        $output = & psql $DatabaseUrl -X -A -t -F "`t" -v ON_ERROR_STOP=1 -c $Query
        if ($LASTEXITCODE -ne 0) {
            throw "PostgreSQL reconciliation query failed."
        }
        return (($output -join "`n").Trim())
    }
    finally {
        $env:PGOPTIONS = $previousPgOptions
    }
}

function Invoke-ClickHouseQuery {
    param([Parameter(Mandatory = $true)][string]$Query)

    $response = Invoke-WebRequest `
        -Method Post `
        -Uri $clickHouseEndpoint `
        -Headers @{ Authorization = "Basic $basicAuth" } `
        -ContentType "text/plain; charset=utf-8" `
        -Body $Query `
        -TimeoutSec 15
    return $response.Content.Trim()
}

$postgresQuery = @"
WITH base AS (
  SELECT *
  FROM p0_llm_invocation_logs
  WHERE tenant_id = '$tenant'::uuid
    AND created_at >= '$fromUtc'::timestamptz
    AND created_at < '$toUtc'::timestamptz
), rows AS (
  SELECT '00_summary'::text AS section,
         ''::text AS key1,
         ''::text AS key2,
         count(*)::text AS value1,
         count(DISTINCT request_id)::text AS value2,
         count(*) FILTER (WHERE status = 'success')::text AS value3,
         count(*) FILTER (WHERE status <> 'success')::text AS value4,
         coalesce(sum(prompt_tokens), 0)::text AS value5,
         coalesce(sum(completion_tokens), 0)::text AS value6,
         coalesce(sum(total_tokens), 0)::text AS value7,
         coalesce(sum(cost_micro_usd), 0)::text AS value8
  FROM base
  UNION ALL
  SELECT '10_status', status, '', count(*)::text, '', '', '', '', '', '', ''
  FROM base GROUP BY status
  UNION ALL
  SELECT '20_model', provider, model, count(*)::text, '', '', '', '', '', '', ''
  FROM base GROUP BY provider, model
  UNION ALL
  SELECT '30_hour', to_char(date_trunc('hour', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'), '',
         count(*)::text, '', '', '', '', '', '', ''
  FROM base GROUP BY date_trunc('hour', created_at AT TIME ZONE 'UTC')
  UNION ALL
  SELECT '40_employee',
         encode(hmac(
           lower(btrim(coalesce(metadata #>> '{employeePolicyDecision,employeeId}', end_user_id))),
           current_setting('gatelm.employee_identity_hmac_secret'),
           'sha256'
         ), 'hex'),
         '', count(*)::text, coalesce(sum(total_tokens), 0)::text,
         coalesce(sum(cost_micro_usd), 0)::text, '', '', '', '', ''
  FROM base
  WHERE coalesce(metadata #>> '{employeePolicyDecision,employeeId}', end_user_id) IS NOT NULL
    AND btrim(coalesce(metadata #>> '{employeePolicyDecision,employeeId}', end_user_id)) <> ''
  GROUP BY 2
)
SELECT section, key1, key2, value1, value2, value3, value4, value5, value6, value7, value8
FROM rows
ORDER BY section, key1, key2;
"@

$clickHouseQuery = @"
WITH base AS (
  SELECT *
  FROM analytics.llm_invocations FINAL
  WHERE tenant_id = toUUID('$tenant')
    AND created_at >= toDateTime64('$fromUtc', 3, 'UTC')
    AND created_at < toDateTime64('$toUtc', 3, 'UTC')
), rows AS (
  SELECT '00_summary' AS section, '' AS key1, '' AS key2,
         toString(count()) AS value1,
         toString(uniqExact(request_id)) AS value2,
         toString(countIf(status = 'success')) AS value3,
         toString(countIf(status != 'success')) AS value4,
         toString(sum(prompt_tokens)) AS value5,
         toString(sum(completion_tokens)) AS value6,
         toString(sum(total_tokens)) AS value7,
         toString(sum(cost_micro_usd)) AS value8
  FROM base
  UNION ALL
  SELECT '10_status', status, '', toString(count()), '', '', '', '', '', '', ''
  FROM base GROUP BY status
  UNION ALL
  SELECT '20_model', provider, model, toString(count()), '', '', '', '', '', '', ''
  FROM base GROUP BY provider, model
  UNION ALL
  SELECT '30_hour', formatDateTime(toStartOfHour(created_at), '%F %T', 'UTC'), '',
         toString(count()), '', '', '', '', '', '', ''
  FROM base GROUP BY toStartOfHour(created_at)
  UNION ALL
  SELECT '40_employee', employee_identity_hash, '', toString(count()),
         toString(sum(total_tokens)), toString(sum(cost_micro_usd)), '', '', '', '', ''
  FROM base
  WHERE employee_identity_hash != ''
  GROUP BY employee_identity_hash
)
SELECT section, key1, key2, value1, value2, value3, value4, value5, value6, value7, value8
FROM rows
ORDER BY section, key1, key2
FORMAT TabSeparatedRaw
"@

$postgresResult = Invoke-PostgresQuery -Query $postgresQuery
$clickHouseResult = Invoke-ClickHouseQuery -Query $clickHouseQuery

if ($postgresResult -ne $clickHouseResult) {
    Write-Host "PostgreSQL result:"
    Write-Host $postgresResult
    Write-Host "ClickHouse result:"
    Write-Host $clickHouseResult
    throw "PostgreSQL and ClickHouse aggregates do not match."
}

Write-Host "PostgreSQL and ClickHouse aggregates match."
Write-Host "Tenant: $tenant"
Write-Host "UTC range: $fromUtc <= created_at < $toUtc"

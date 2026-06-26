Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Invoke-PostgresRows {
    param([Parameter(Mandatory = $true)][string]$Query)

    $rows = & docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1 -t -A -F "|" -c $Query
    if ($LASTEXITCODE -ne 0) {
        throw "postgres query failed with exit code $LASTEXITCODE"
    }

    return @($rows | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Invoke-PostgresScalar {
    param([Parameter(Mandatory = $true)][string]$Query)

    $rows = @(Invoke-PostgresRows -Query $Query)
    if ($rows.Count -ne 1) {
        throw "expected exactly one row, got $($rows.Count): $Query"
    }
    return $rows[0]
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)]$Actual
    )

    if ($Expected -ne $Actual) {
        throw "$Name expected '$Expected' but got '$Actual'"
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Condition
    )

    if (-not $Condition) {
        throw "$Name expected true"
    }
}

function Get-MockStats {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)

    $statsUrl = $BaseUrl.TrimEnd("/") + "/__mock/stats"
    return Invoke-RestMethod -Method Get -Uri $statsUrl -TimeoutSec 3
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$mockProviderBaseUrl = $env:MOCK_PROVIDER_BASE_URL
if ([string]::IsNullOrWhiteSpace($mockProviderBaseUrl)) {
    $mockProviderBaseUrl = "http://localhost:8090"
}

Push-Location $repoRoot
try {
    Write-Host "GateLM Day5 demo baseline check"
    Write-Host "repo:         $repoRoot"
    Write-Host "mockProvider: $mockProviderBaseUrl"

    Write-Host ""
    Write-Host "== check seed identity =="
    $identity = Invoke-PostgresScalar -Query @"
select
  t.slug,
  p.slug,
  a.slug,
  ak.key_prefix,
  at.token_prefix,
  pc.provider,
  pc.default_model
from tenants t
join projects p on p.tenant_id = t.id
join applications a on a.project_id = p.id
join api_keys ak on ak.application_id = a.id
join app_tokens at on at.application_id = a.id
join provider_connections pc on pc.project_id = p.id
where t.id = '00000000-0000-4000-8000-000000000100'
  and p.id = '00000000-0000-4000-8000-000000000200'
  and a.id = '00000000-0000-4000-8000-000000000300'
  and ak.status = 'active'
  and at.status = 'active'
  and pc.status = 'active';
"@
    Assert-Equal -Name "seed identity" -Expected "acme|campaign-bot|campaign-web|glm_api_p0_demo|glm_app_p0_demo|mock|mock-balanced" -Actual $identity

    Write-Host "identity: $identity"

    Write-Host ""
    Write-Host "== check credential storage is not plaintext =="
    $credentialLeakCount = Invoke-PostgresScalar -Query @"
select count(*)
from (
  select key_hash as value from api_keys
  union all
  select token_hash as value from app_tokens
) secrets
where value in ('glm_api_test_redacted', 'glm_app_token_test_redacted');
"@
    Assert-Equal -Name "plaintext credential leak count" -Expected "0" -Actual $credentialLeakCount

    Write-Host ""
    Write-Host "== check model catalog =="
    $models = @(Invoke-PostgresRows -Query @"
select provider || ':' || model || ':' || status
from model_catalog
where provider = 'mock'
order by model;
"@)
    Assert-Equal -Name "mock model count" -Expected 3 -Actual $models.Count
    Assert-True -Name "mock-fast active" -Condition ($models -contains "mock:mock-fast:active")
    Assert-True -Name "mock-balanced active" -Condition ($models -contains "mock:mock-balanced:active")
    Assert-True -Name "mock-smart active" -Condition ($models -contains "mock:mock-smart:active")

    Write-Host ($models -join ", ")

    Write-Host ""
    Write-Host "== check pricing rules =="
    $pricingCount = Invoke-PostgresScalar -Query @"
select count(*)
from model_pricing_rules
where provider = 'mock'
  and pricing_version = 'p0-demo'
  and effective_from = '2024-01-01 00:00:00+00';
"@
    Assert-Equal -Name "mock pricing rule count" -Expected "3" -Actual $pricingCount

    Write-Host ""
    Write-Host "== check redis =="
    $redisPing = & docker compose exec -T redis redis-cli ping
    if ($LASTEXITCODE -ne 0) {
        throw "redis ping failed with exit code $LASTEXITCODE"
    }
    Assert-Equal -Name "redis ping" -Expected "PONG" -Actual ([string]$redisPing).Trim()

    Write-Host ""
    Write-Host "== check mock provider stats reset =="
    $stats = Get-MockStats -BaseUrl $mockProviderBaseUrl
    $calls = $null
    if ($null -ne $stats.PSObject.Properties["calls"]) {
        $calls = [int]$stats.calls
    }
    elseif ($null -ne $stats.PSObject.Properties["data"] -and $null -ne $stats.data.PSObject.Properties["totalCalls"]) {
        $calls = [int]$stats.data.totalCalls
    }
    else {
        throw "mock stats response is missing calls or data.totalCalls"
    }
    Assert-Equal -Name "mock provider calls after reset" -Expected 0 -Actual $calls

    Write-Host ""
    Write-Host "Day5 demo baseline check passed"
}
finally {
    Pop-Location
}

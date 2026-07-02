param(
    [string]$GatewayBaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:GATEWAY_BASE_URL)) { "http://localhost:8080" } else { $env:GATEWAY_BASE_URL }),
    [string]$MockProviderBaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:MOCK_PROVIDER_BASE_URL)) { "http://localhost:8090" } else { $env:MOCK_PROVIDER_BASE_URL }),
    [string]$ProjectId = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_DEMO_PROJECT_ID)) { "00000000-0000-4000-8000-000000000200" } else { $env:GATELM_DEMO_PROJECT_ID }),
    [switch]$SkipDockerUp,
    [switch]$SkipDbPrepare,
    [switch]$SkipRun
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Join-Url {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function New-QueryString {
    param([Parameter(Mandatory = $true)][hashtable]$Values)

    $pairs = New-Object System.Collections.Generic.List[string]
    foreach ($key in ($Values.Keys | Sort-Object)) {
        $value = $Values[$key]
        if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
            continue
        }
        $encodedKey = [System.Uri]::EscapeDataString([string]$key)
        $encodedValue = [System.Uri]::EscapeDataString([string]$value)
        $pairs.Add("${encodedKey}=${encodedValue}")
    }
    return ($pairs -join "&")
}

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Wait-Postgres {
    for ($i = 0; $i -lt 30; $i++) {
        & docker compose exec -T postgres pg_isready -U gatelm -d gatelm *> $null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "postgres did not become ready"
}

function Wait-Redis {
    for ($i = 0; $i -lt 30; $i++) {
        $result = & docker compose exec -T redis redis-cli ping 2>$null
        if ($LASTEXITCODE -eq 0 -and ([string]$result).Trim() -eq "PONG") {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "redis did not become ready"
}

function Wait-MockProvider {
    $healthUrl = Join-Url $MockProviderBaseUrl "/healthz"
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $statusCode = Invoke-StatusCode -Uri $healthUrl
            if ($statusCode -eq 200) {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "mock provider did not become ready at $healthUrl"
}

function Invoke-SqlFiles {
    param([Parameter(Mandatory = $true)][string[]]$SqlFiles)

    Get-Content -LiteralPath $SqlFiles |
        docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1

    if ($LASTEXITCODE -ne 0) {
        throw "local demo schema preparation failed with exit code $LASTEXITCODE"
    }
}

function Invoke-StatusCode {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Uri -TimeoutSec 5
        return [int]$response.StatusCode
    }
    catch {
        if ($null -ne $_.Exception.Response) {
            return [int]$_.Exception.Response.StatusCode
        }
        throw
    }
}

function Assert-GatewayReady {
    $healthUrl = Join-Url $GatewayBaseUrl "/healthz"
    $statusCode = Invoke-StatusCode -Uri $healthUrl
    if ($statusCode -ne 200) {
        throw "Gateway URL check failed: $healthUrl returned HTTP $statusCode. Start apps/gateway-core first, then rerun this wrapper."
    }
}

function Assert-K6Installed {
    $command = Get-Command k6 -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    Write-Host ""
    Write-Host "k6 executable was not found."
    Write-Host ""
    Write-Host "Install one of:"
    Write-Host "  winget install k6.k6"
    Write-Host "  choco install k6"
    Write-Host ""
    Write-Host "Then rerun:"
    Write-Host "  .\scripts\dev\v1-k6-baseline.ps1 -GatewayBaseUrl $GatewayBaseUrl"
    throw "k6 is required for v1.0.0 baseline execution"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$k6Script = Join-Path $repoRoot "scripts/perf/k6-gateway-baseline.js"
$fromIso = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString("yyyy-MM-ddTHH:mm:ssZ")
$toIso = (Get-Date).ToUniversalTime().AddMinutes(15).ToString("yyyy-MM-ddTHH:mm:ssZ")
$logsQuery = New-QueryString -Values @{
    from  = $fromIso
    to    = $toIso
    limit = "50"
}
$dashboardQuery = New-QueryString -Values @{
    from      = $fromIso
    to        = $toIso
    projectId = $ProjectId
}

Write-Host ""
Write-Host "GateLM v1 k6 baseline"
Write-Host "======================"
Write-Host "gateway:      $GatewayBaseUrl"
Write-Host "mockProvider: $MockProviderBaseUrl"
Write-Host "projectId:    $ProjectId"
Write-Host "range:        $fromIso -> $toIso"

if (-not $SkipDockerUp) {
    Write-Host ""
    Write-Host "== ensure dependencies =="
    Invoke-Docker -Arguments @("compose", "up", "-d", "postgres", "redis", "mock-provider")
}

Write-Host ""
Write-Host "== wait dependencies =="
Wait-Postgres
Wait-Redis
Wait-MockProvider
Write-Host "dependencies: OK"

if (-not $SkipDbPrepare) {
    Write-Host ""
    Write-Host "== prepare local demo schema =="
    $sqlFiles = @(
        "db/migrations/001_create_identity_tables.sql",
        "db/migrations/002_create_project_tables.sql",
        "db/migrations/003_create_gateway_credentials.sql",
        "db/migrations/004_create_provider_and_models.sql",
        "db/migrations/005_harden_config_store_constraints.sql",
        "db/migrations/006_create_p0_invocation_logs_fallback.sql",
        "db/migrations/007_create_gateway_rate_limit_counters.sql",
        "db/migrations/008_alter_gateway_rate_limit_counters_cascade.sql",
        "db/seeds/001_seed_p0_demo_data.sql"
    )
    Push-Location $repoRoot
    try {
        Invoke-SqlFiles -SqlFiles $sqlFiles
    }
    finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "== check Gateway URL =="
Assert-GatewayReady
Write-Host "Gateway healthz: OK"

Write-Host ""
Write-Host "== check k6 =="
$k6Path = Assert-K6Installed
Write-Host "k6: $k6Path"

Write-Host ""
Write-Host "Evidence URLs after the run:"
Write-Host "  metrics:   $(Join-Url $GatewayBaseUrl "/metrics")"
Write-Host "  logs:      $(Join-Url $GatewayBaseUrl "/api/projects/$ProjectId/logs")?$logsQuery"
Write-Host "  dashboard: $(Join-Url $GatewayBaseUrl "/api/dashboard/overview")?$dashboardQuery"

if ($SkipRun) {
    Write-Host ""
    Write-Host "SkipRun was set; k6 execution was not started."
    exit 0
}

$previousGatewayBaseUrl = $env:GATEWAY_BASE_URL
$previousMockProviderBaseUrl = $env:MOCK_PROVIDER_BASE_URL
$previousProjectId = $env:GATELM_DEMO_PROJECT_ID

try {
    $env:GATEWAY_BASE_URL = $GatewayBaseUrl
    $env:MOCK_PROVIDER_BASE_URL = $MockProviderBaseUrl
    $env:GATELM_DEMO_PROJECT_ID = $ProjectId

    Write-Host ""
    Write-Host "== run k6 baseline =="
    & $k6Path run $k6Script
}
finally {
    $env:GATEWAY_BASE_URL = $previousGatewayBaseUrl
    $env:MOCK_PROVIDER_BASE_URL = $previousMockProviderBaseUrl
    $env:GATELM_DEMO_PROJECT_ID = $previousProjectId
}

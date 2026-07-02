param(
    [string]$ControlPlaneBaseUrl = $(if ($env:CONTROL_PLANE_BASE_URL) { $env:CONTROL_PLANE_BASE_URL } elseif ($env:GATEWAY_CONTROL_PLANE_BASE_URL) { $env:GATEWAY_CONTROL_PLANE_BASE_URL } else { "http://localhost:3001" }),
    [string]$GatewayBaseUrl = $(if ($env:GATEWAY_BASE_URL) { $env:GATEWAY_BASE_URL } else { "http://localhost:8080" }),
    [string]$MockProviderBaseUrl = $(if ($env:MOCK_PROVIDER_BASE_URL) { $env:MOCK_PROVIDER_BASE_URL } else { "http://localhost:8090" }),
    [string]$DatabaseUrl = $(if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public" }),
    [string]$TenantId = $(if ($env:GATELM_E2E_TENANT_ID) { $env:GATELM_E2E_TENANT_ID } else { "00000000-0000-4000-8000-000000000100" }),
    [string]$ProjectId = $(if ($env:GATELM_E2E_PROJECT_ID) { $env:GATELM_E2E_PROJECT_ID } else { "00000000-0000-4000-8000-000000000200" }),
    [string]$RunId = $(if ($env:GATELM_K6_RUN_ID) { $env:GATELM_K6_RUN_ID } else { "v201_mock_smoke_$(Get-Date -Format "yyyyMMdd_HHmmss")" }),
    [string]$ReportDir = "",
    [ValidateSet("mock")]
    [string]$ProviderMode = $(if ($env:K6_GATEWAY_PROVIDER_MODE) { $env:K6_GATEWAY_PROVIDER_MODE } else { "mock" }),
    [string]$ProviderFailureModels = $(if ($env:K6_PROVIDER_FAILURE_MODELS) { $env:K6_PROVIDER_FAILURE_MODELS } else { "mock-fast" }),
    [switch]$EnableDependencyScenarios,
    [switch]$SkipSeed,
    [switch]$SkipRun,
    [switch]$DescribeOnly
)

# v2.0.1 k6 / smoke evidence wrapper.
# This wrapper runs the canonical scripts/perf/k6-gateway-baseline.js against
# a live Gateway in mock-provider mode and saves a sanitized k6 summary. It
# does not persist raw prompts, raw responses, API keys, app tokens, provider
# keys, or headers.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Convert-ToSafeArray {
    param($Value)

    if ($null -eq $Value) {
        return ,@()
    }

    return ,@($Value | Where-Object { $null -ne $_ })
}

function Join-Url {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Invoke-StatusCode {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Uri -TimeoutSec 5
        return [int]$response.StatusCode
    }
    catch {
        $errorResponse = $null
        $exception = $_.Exception
        if ($null -ne $exception) {
            $responseProperty = $exception.PSObject.Properties["Response"]
            if ($null -ne $responseProperty) {
                $errorResponse = $responseProperty.Value
            }
        }
        if ($null -ne $errorResponse) {
            return [int]$errorResponse.StatusCode
        }
        throw
    }
}

function Assert-HttpOk {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Uri
    )

    $statusCode = Invoke-StatusCode -Uri $Uri
    if ($statusCode -ne 200) {
        throw "$Name check failed: $Uri returned HTTP $statusCode"
    }
}

function Assert-K6Installed {
    $command = Get-Command k6 -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    Write-Host ""
    Write-Host "k6 executable was not found."
    Write-Host "Install one of:"
    Write-Host "  winget install k6.k6"
    Write-Host "  choco install k6"
    Write-Host ""
    throw "k6 is required for v2.0.1 smoke execution"
}

function Invoke-ControlPlaneDemoSeed {
    param(
        [Parameter(Mandatory = $true)][string]$MockProviderUrl,
        [Parameter(Mandatory = $true)][string]$SeedDatabaseUrl
    )

    $previousProviderMode = $env:GATELM_DEMO_PROVIDER_MODE
    $previousMockProviderBaseUrl = $env:GATELM_DEMO_MOCK_PROVIDER_BASE_URL
    $previousDatabaseUrl = $env:DATABASE_URL

    try {
        $env:GATELM_DEMO_PROVIDER_MODE = "mock"
        $env:GATELM_DEMO_MOCK_PROVIDER_BASE_URL = $MockProviderUrl
        $env:DATABASE_URL = $SeedDatabaseUrl

        Write-Host ""
        Write-Host "== seed Control Plane demo data for mock k6 smoke =="
        corepack pnpm --filter @gatelm/control-plane-api db:seed
        if ($LASTEXITCODE -ne 0) {
            throw "Control Plane demo seed failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        $env:GATELM_DEMO_PROVIDER_MODE = $previousProviderMode
        $env:GATELM_DEMO_MOCK_PROVIDER_BASE_URL = $previousMockProviderBaseUrl
        $env:DATABASE_URL = $previousDatabaseUrl
    }
}

function New-QueryString {
    param([Parameter(Mandatory = $true)][hashtable]$Values)

    $pairs = New-Object System.Collections.Generic.List[string]
    foreach ($key in ($Values.Keys | Sort-Object)) {
        $value = $Values[$key]
        if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
            continue
        }
        $pairs.Add("$([uri]::EscapeDataString([string]$key))=$([uri]::EscapeDataString([string]$value))")
    }

    return ($pairs -join "&")
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$k6Script = Join-Path $repoRoot "scripts/perf/k6-gateway-baseline.js"
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot "reports/e2e"
}

$invariantCulture = [System.Globalization.CultureInfo]::InvariantCulture
$fromIso = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString("yyyy-MM-ddTHH:mm:ssZ", $invariantCulture)
$toIso = (Get-Date).ToUniversalTime().AddMinutes(20).ToString("yyyy-MM-ddTHH:mm:ssZ", $invariantCulture)
$logsQuery = New-QueryString -Values @{
    tenantId = $TenantId
    from = $fromIso
    to = $toIso
    limit = "50"
}
$dashboardQuery = New-QueryString -Values @{
    tenantId = $TenantId
    projectId = $ProjectId
    from = $fromIso
    to = $toIso
}

Write-Host ""
Write-Host "GateLM v2.0.1 k6 / mock smoke verification"
Write-Host "=========================================="
Write-Host "controlPlane:   $ControlPlaneBaseUrl"
Write-Host "gateway:        $GatewayBaseUrl"
Write-Host "mockProvider:   $MockProviderBaseUrl"
Write-Host "tenantId:       $TenantId"
Write-Host "projectId:      $ProjectId"
Write-Host "runId:          $RunId"
Write-Host "provider mode:  $ProviderMode"
Write-Host "failure models: $ProviderFailureModels"
Write-Host "dependency scenarios: $EnableDependencyScenarios"
Write-Host ""

if ($DescribeOnly) {
    Write-Host "Describe-only mode. No HTTP requests or k6 run will be started."
    Write-Host "Planned checks:"
    Write-Host "- Control Plane /healthz readiness."
    Write-Host "- Seed demo RuntimeSnapshot/Provider Catalog in mock-provider mode unless -SkipSeed is set."
    Write-Host "- Gateway /healthz readiness."
    Write-Host "- mock-provider /healthz readiness."
    Write-Host "- local k6 executable presence."
    Write-Host "- scripts/perf/k6-gateway-baseline.js execution with summary export."
    Write-Host "- Evidence URLs for metrics, project logs, and dashboard overview."
    exit 0
}

Assert-HttpOk -Name "Control Plane" -Uri (Join-Url $ControlPlaneBaseUrl "/healthz")
Assert-HttpOk -Name "Gateway" -Uri (Join-Url $GatewayBaseUrl "/healthz")
Assert-HttpOk -Name "mock-provider" -Uri (Join-Url $MockProviderBaseUrl "/healthz")
$k6Path = Assert-K6Installed

if (-not $SkipSeed) {
    Invoke-ControlPlaneDemoSeed -MockProviderUrl $MockProviderBaseUrl -SeedDatabaseUrl $DatabaseUrl
}

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$safeRunId = $RunId -replace "[^A-Za-z0-9_]", "_"
$summaryPath = Join-Path $ReportDir "v2-k6-smoke-$safeRunId-summary.json"

Write-Host "Control Plane healthz: OK"
Write-Host "Gateway healthz: OK"
Write-Host "mock-provider healthz: OK"
Write-Host "k6: $k6Path"
Write-Host ""
Write-Host "Evidence URLs after the run:"
Write-Host "  metrics:   $(Join-Url $GatewayBaseUrl "/metrics")"
Write-Host "  logs:      $(Join-Url $GatewayBaseUrl "/api/projects/$ProjectId/logs")?$logsQuery"
Write-Host "  dashboard: $(Join-Url $GatewayBaseUrl "/api/dashboard/overview")?$dashboardQuery"
Write-Host "  summary:   $summaryPath"

if ($SkipRun) {
    Write-Host ""
    Write-Host "SkipRun was set; k6 execution was not started."
    exit 0
}

$previousGatewayBaseUrl = $env:GATEWAY_BASE_URL
$previousMockProviderBaseUrl = $env:MOCK_PROVIDER_BASE_URL
$previousFailureControlUrl = $env:K6_PROVIDER_FAILURE_CONTROL_URL
$previousFailureModels = $env:K6_PROVIDER_FAILURE_MODELS
$previousProviderMode = $env:K6_GATEWAY_PROVIDER_MODE
$previousProviderFailureScenarios = $env:K6_ENABLE_PROVIDER_FAILURE_SCENARIOS
$previousRunId = $env:GATELM_K6_RUN_ID
$previousDependencyScenarios = $env:K6_ENABLE_V2_DEPENDENCY_SCENARIOS
$previousTenantId = $env:GATELM_DEMO_TENANT_ID
$previousProjectId = $env:GATELM_DEMO_PROJECT_ID

try {
    $env:GATEWAY_BASE_URL = $GatewayBaseUrl
    $env:MOCK_PROVIDER_BASE_URL = $MockProviderBaseUrl
    $env:K6_PROVIDER_FAILURE_CONTROL_URL = $MockProviderBaseUrl
    $env:K6_PROVIDER_FAILURE_MODELS = $ProviderFailureModels
    $env:K6_GATEWAY_PROVIDER_MODE = $ProviderMode
    $env:K6_ENABLE_PROVIDER_FAILURE_SCENARIOS = "true"
    $env:GATELM_K6_RUN_ID = $safeRunId
    $env:K6_ENABLE_V2_DEPENDENCY_SCENARIOS = $(if ($EnableDependencyScenarios) { "true" } else { "false" })
    $env:GATELM_DEMO_TENANT_ID = $TenantId
    $env:GATELM_DEMO_PROJECT_ID = $ProjectId

    Write-Host ""
    Write-Host "== run k6 v2 smoke =="
    & $k6Path run --summary-export $summaryPath $k6Script
    if ($LASTEXITCODE -ne 0) {
        throw "k6 v2 smoke failed with exit code $LASTEXITCODE"
    }
}
finally {
    $env:GATEWAY_BASE_URL = $previousGatewayBaseUrl
    $env:MOCK_PROVIDER_BASE_URL = $previousMockProviderBaseUrl
    $env:K6_PROVIDER_FAILURE_CONTROL_URL = $previousFailureControlUrl
    $env:K6_PROVIDER_FAILURE_MODELS = $previousFailureModels
    $env:K6_GATEWAY_PROVIDER_MODE = $previousProviderMode
    $env:K6_ENABLE_PROVIDER_FAILURE_SCENARIOS = $previousProviderFailureScenarios
    $env:GATELM_K6_RUN_ID = $previousRunId
    $env:K6_ENABLE_V2_DEPENDENCY_SCENARIOS = $previousDependencyScenarios
    $env:GATELM_DEMO_TENANT_ID = $previousTenantId
    $env:GATELM_DEMO_PROJECT_ID = $previousProjectId
}

Write-Host ""
Write-Host "k6 v2 smoke completed."
Write-Host "summary: $summaryPath"

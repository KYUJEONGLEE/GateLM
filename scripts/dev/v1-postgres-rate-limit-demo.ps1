$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gatewayRoot = Join-Path $repoRoot "apps/gateway-core"
if ([string]::IsNullOrWhiteSpace($env:GOCACHE)) {
    $env:GOCACHE = Join-Path $repoRoot ".tmp/gocache"
}
if ([string]::IsNullOrWhiteSpace($env:GOMODCACHE)) {
    $env:GOMODCACHE = Join-Path $repoRoot ".tmp/gomodcache"
}

Write-Host ""
Write-Host "GateLM v1 PostgreSQL RateLimiter Demo"
Write-Host "====================================="
Write-Host "Runs the PostgreSQL fixed-window adapter demo test and prints input/output decisions."
Write-Host ""
Write-Host "[Command]"
Write-Host "go test ./internal/adapters/ratelimit/postgres -run TestLimiterDemoPostgresFixedWindow -v"
Write-Host "GOCACHE=$env:GOCACHE"
Write-Host "GOMODCACHE=$env:GOMODCACHE"
Write-Host ""

Push-Location $gatewayRoot
try {
    go test ./internal/adapters/ratelimit/postgres -run TestLimiterDemoPostgresFixedWindow -v

    if (-not [string]::IsNullOrWhiteSpace($env:GATELM_TEST_DATABASE_URL)) {
        Write-Host ""
        Write-Host "[Optional Integration]"
        Write-Host "GATELM_TEST_DATABASE_URL is set, running PostgreSQL concurrency test."
        go test ./internal/adapters/ratelimit/postgres -run TestLimiterIntegrationConcurrentFixedWindow -v
    }
    else {
        Write-Host ""
        Write-Host "[Optional Integration]"
        Write-Host "Skipped. Set GATELM_TEST_DATABASE_URL to run the real PostgreSQL concurrency test."
    }
}
finally {
    Pop-Location
}

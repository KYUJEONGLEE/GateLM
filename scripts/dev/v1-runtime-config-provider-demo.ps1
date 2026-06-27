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
Write-Host "GateLM v1 RuntimeConfigProvider Demo"
Write-Host "===================================="
Write-Host "Runs the RuntimeConfigProvider demo test and prints GatewayContext runtime outputs."
Write-Host ""
Write-Host "[Command]"
Write-Host "go test ./internal/pipeline/stages/runtimeconfig -run TestRuntimeConfigProviderDemo -v"
Write-Host "GOCACHE=$env:GOCACHE"
Write-Host "GOMODCACHE=$env:GOMODCACHE"
Write-Host ""

Push-Location $gatewayRoot
try {
    go test ./internal/pipeline/stages/runtimeconfig -run TestRuntimeConfigProviderDemo -v
}
finally {
    Pop-Location
}

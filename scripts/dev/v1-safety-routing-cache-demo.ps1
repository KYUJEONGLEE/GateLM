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
Write-Host "GateLM v1 Safety/Routing/Cache Demo"
Write-Host "===================================="
Write-Host "Runs the Gateway Phase 3 demo test and prints request/response evidence."
Write-Host "Sensitive raw values are shown only as placeholders."
Write-Host ""
Write-Host "[Command]"
Write-Host "go test ./internal/http/handlers -run TestChatCompletionsSafetyRoutingCacheDemo -v"
Write-Host "GOCACHE=$env:GOCACHE"
Write-Host "GOMODCACHE=$env:GOMODCACHE"
Write-Host ""

Push-Location $gatewayRoot
try {
    go test ./internal/http/handlers -run TestChatCompletionsSafetyRoutingCacheDemo -v
}
finally {
    Pop-Location
}

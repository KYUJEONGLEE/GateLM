$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gatewayRoot = Join-Path $repoRoot "apps/gateway-core"
if ([string]::IsNullOrWhiteSpace($env:GOCACHE)) {
    $env:GOCACHE = Join-Path $env:TEMP "gatelm-gocache"
}

Write-Host ""
Write-Host "GateLM v1 Rate Limit Stage Demo"
Write-Host "================================"
Write-Host "Runs the real Go handler test and prints input, output, and provider call count."
Write-Host ""
Write-Host "[Command]"
Write-Host "go test ./internal/http/handlers -run TestChatCompletionsRateLimitStageDemo -v"
Write-Host "GOCACHE=$env:GOCACHE"
Write-Host ""

Push-Location $gatewayRoot
try {
    go test ./internal/http/handlers -run TestChatCompletionsRateLimitStageDemo -v
}
finally {
    Pop-Location
}

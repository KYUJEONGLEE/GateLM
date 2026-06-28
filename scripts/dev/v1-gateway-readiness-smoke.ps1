$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$gatewayDir = Join-Path $repoRoot "apps\gateway-core"
$env:GOCACHE = Join-Path $repoRoot ".tmp\gocache"
$env:GOMODCACHE = Join-Path $repoRoot ".tmp\gomodcache"

New-Item -ItemType Directory -Force -Path $env:GOCACHE | Out-Null
New-Item -ItemType Directory -Force -Path $env:GOMODCACHE | Out-Null

Write-Host ""
Write-Host "GateLM v1 Gateway Readiness Smoke"
Write-Host "=================================="
Write-Host "Runs the router-level Gateway v1 readiness smoke test."
Write-Host "The Go test output below prints Korean Given/When/Then evidence with redacted inputs."
Write-Host ""
Write-Host "[Command]"
Write-Host "go test ./internal/app -run TestGatewayV1ReadinessSmoke -v"
Write-Host "GOCACHE=$env:GOCACHE"
Write-Host "GOMODCACHE=$env:GOMODCACHE"
Write-Host ""

$exitCode = 0

Push-Location $gatewayDir
try {
  go test ./internal/app -run TestGatewayV1ReadinessSmoke -v
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($exitCode -ne 0) {
  exit $exitCode
}

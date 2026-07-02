$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

$env:GOCACHE = Join-Path $RepoRoot ".gocache"
$env:GOTELEMETRY = "off"

$RemainingArgs = @($args)
if ($RemainingArgs.Count -gt 0 -and $RemainingArgs[0] -eq "--") {
    $RemainingArgs = @($RemainingArgs | Select-Object -Skip 1)
}

Push-Location $RepoRoot
try {
    & go run ./apps/gateway-core/cmd/routing-eval @RemainingArgs
    if ($LASTEXITCODE -ne 0) {
        throw "routing evaluation failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

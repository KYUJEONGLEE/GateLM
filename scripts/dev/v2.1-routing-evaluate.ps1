$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

$env:GOCACHE = Join-Path $RepoRoot ".gocache"
$env:GOTELEMETRY = "off"

$RemainingArgs = @($args)
if ($RemainingArgs.Count -gt 0 -and $RemainingArgs[0] -eq "--") {
    if ($RemainingArgs.Count -gt 1) {
        $RemainingArgs = $RemainingArgs[1..($RemainingArgs.Count - 1)]
    }
    else {
        $RemainingArgs = @()
    }
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

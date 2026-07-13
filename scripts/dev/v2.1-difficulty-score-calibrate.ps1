$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

$env:GOCACHE = Join-Path $RepoRoot ".gocache"
$env:GOTELEMETRY = "off"

Push-Location $RepoRoot
try {
    & go test ./apps/gateway-core/internal/domain/routing -run '^TestDifficultyScoreCalibration$' -count=1 -v
    if ($LASTEXITCODE -ne 0) {
        throw "difficulty score calibration failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

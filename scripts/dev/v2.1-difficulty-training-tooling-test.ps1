$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$env:GOCACHE = Join-Path $RepoRoot ".gocache"
$env:GOTELEMETRY = "off"
$env:PYTHONPATH = Join-Path $RepoRoot "scripts\routing_difficulty_model"

Push-Location $RepoRoot
try {
    & node --test scripts/verify-v2.1-difficulty-eval.test.mjs
    if ($LASTEXITCODE -ne 0) { throw "difficulty verifier tests failed with exit code $LASTEXITCODE" }

    & go test ./apps/gateway-core/internal/domain/routing ./apps/gateway-core/internal/tools/difficultymodel ./apps/gateway-core/cmd/difficulty-training-vector-export ./apps/gateway-core/cmd/difficulty-model-codegen ./apps/gateway-core/cmd/difficulty-model-verify
    if ($LASTEXITCODE -ne 0) { throw "difficulty Go tooling tests failed with exit code $LASTEXITCODE" }

    & python -m unittest discover -s scripts/routing_difficulty_model/tests -p "test_*.py" -v
    if ($LASTEXITCODE -ne 0) { throw "difficulty Python tooling tests failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

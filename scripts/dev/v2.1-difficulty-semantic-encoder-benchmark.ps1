param(
    [ValidateSet("Setup", "Prepare", "Run", "Test", "Verify")]
    [string]$Mode = "Test",
    [string]$Python = "",
    [string]$ArtifactRoot = ".tmp/difficulty-semantic-encoder-artifacts"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$ToolRoot = Join-Path $RepoRoot "scripts/routing_difficulty_model"
$VenvRoot = Join-Path $RepoRoot ".tmp/difficulty-semantic-encoder-venv"
$VenvPython = Join-Path $VenvRoot "Scripts/python.exe"
$Config = Join-Path $ToolRoot "encoder-candidates.v1.json"
$RequirementsLock = Join-Path $ToolRoot "encoder-benchmark-requirements.lock.txt"
$Report = Join-Path $ToolRoot "evidence/difficulty-semantic-encoder-benchmark.windows-2026-07-14.json"
$Lock = Join-Path $ToolRoot "evidence/selected-encoder.provisional-v1.lock.json"
$Projection = Join-Path $ToolRoot "evidence/difficulty-projection.provisional-v1.bin"
$ResolvedArtifactRoot = Join-Path $RepoRoot $ArtifactRoot

if ($Mode -eq "Setup") {
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        & python -m venv $VenvRoot
        if ($LASTEXITCODE -ne 0) { throw "failed to create semantic encoder benchmark virtual environment" }
    }
    & $VenvPython -m pip install -r $RequirementsLock
    if ($LASTEXITCODE -ne 0) { throw "failed to install locked semantic encoder benchmark dependencies" }
    & $VenvPython -m pip install --no-deps -e $ToolRoot
    if ($LASTEXITCODE -ne 0) { throw "failed to install semantic encoder benchmark dependencies" }
    & $VenvPython -m pip check
    if ($LASTEXITCODE -ne 0) { throw "semantic encoder benchmark dependency check failed" }
    Write-Output "semantic encoder benchmark environment ready: $VenvPython"
    exit 0
}

if (-not $Python) {
    if (Test-Path -LiteralPath $VenvPython) {
        $Python = $VenvPython
    } elseif ($env:GATELM_DIFFICULTY_PYTHON) {
        $Python = $env:GATELM_DIFFICULTY_PYTHON
    } else {
        $Python = "python"
    }
}

$env:PYTHONPATH = if ($env:PYTHONPATH) { "$ToolRoot$([IO.Path]::PathSeparator)$env:PYTHONPATH" } else { $ToolRoot }
Push-Location $RepoRoot
try {
    switch ($Mode) {
        "Prepare" {
            & $Python -m gatelm_difficulty_model.encoder_benchmark prepare --config $Config --artifact-root $ResolvedArtifactRoot
        }
        "Run" {
            & $Python -m gatelm_difficulty_model.encoder_benchmark run --config $Config --artifact-root $ResolvedArtifactRoot --report $Report --lock $Lock --projection $Projection
        }
        "Test" {
            & $Python -m unittest discover -s scripts/routing_difficulty_model/tests -p "test_*.py" -v
        }
        "Verify" {
            & $Python -m gatelm_difficulty_model.encoder_benchmark verify --config $Config --artifact-root $ResolvedArtifactRoot --report $Report --lock $Lock --projection $Projection
        }
    }
    if ($LASTEXITCODE -ne 0) { throw "semantic encoder benchmark mode $Mode failed" }
} finally {
    Pop-Location
}

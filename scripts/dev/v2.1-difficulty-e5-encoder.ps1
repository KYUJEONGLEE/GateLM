param(
    [ValidateSet("Setup", "Prepare", "Fit", "Candidates", "Test", "Verify")]
    [string]$Mode = "Test",
    [string]$Python = "",
    [string]$ArtifactRoot = ".tmp/difficulty-semantic-encoder-artifacts"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$ToolRoot = Join-Path $RepoRoot "scripts/routing_difficulty_model"
$VenvRoot = Join-Path $RepoRoot ".tmp/difficulty-semantic-encoder-venv"
$VenvPython = Join-Path $VenvRoot "Scripts/python.exe"
$RequirementsLock = Join-Path $ToolRoot "e5-encoder-requirements.lock.txt"
$Manifest = Join-Path $ToolRoot "artifacts/difficulty-e5-encoder-manifest.v2.json"
$ResolvedArtifactRoot = Join-Path $RepoRoot $ArtifactRoot

if ($Mode -eq "Setup") {
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        & python -m venv $VenvRoot
        if ($LASTEXITCODE -ne 0) { throw "failed to create E5 encoder virtual environment" }
    }
    & $VenvPython -m pip install -r $RequirementsLock
    if ($LASTEXITCODE -ne 0) { throw "failed to install locked E5 encoder dependencies" }
    & $VenvPython -m pip install --no-deps -e $ToolRoot
    if ($LASTEXITCODE -ne 0) { throw "failed to install E5 encoder tooling" }
    & $VenvPython -m pip check
    if ($LASTEXITCODE -ne 0) { throw "E5 encoder dependency check failed" }
    Write-Output "E5 encoder environment ready: $VenvPython"
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
            & $Python -m gatelm_difficulty_model.e5_encoder_cli --artifact-root $ResolvedArtifactRoot --manifest $Manifest prepare
        }
        "Fit" {
            & $Python -m gatelm_difficulty_model.e5_encoder_cli --artifact-root $ResolvedArtifactRoot --manifest $Manifest fit-pca
        }
        "Candidates" {
            & $Python -m gatelm_difficulty_model.candidate_cli --artifact-root $ResolvedArtifactRoot --encoder-manifest $Manifest
        }
        "Test" {
            & $Python -m unittest discover -s scripts/routing_difficulty_model/tests -p "test_*.py" -v
        }
        "Verify" {
            & $Python -m gatelm_difficulty_model.e5_encoder_cli --artifact-root $ResolvedArtifactRoot --manifest $Manifest verify
        }
    }
    if ($LASTEXITCODE -ne 0) { throw "E5 encoder mode $Mode failed" }
} finally {
    Pop-Location
}

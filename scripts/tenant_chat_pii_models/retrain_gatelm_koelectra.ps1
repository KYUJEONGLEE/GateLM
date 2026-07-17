[CmdletBinding()]
param(
    [string]$Python = "",
    [int]$Epochs = 8,
    [int]$CpuThreads = 6
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if ([string]::IsNullOrWhiteSpace($Python)) {
    $Python = Join-Path $RepoRoot "apps\ai-service\.venv\Scripts\python.exe"
}
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "AI Service Python was not found: $Python"
}
if ($Epochs -lt 1 -or $CpuThreads -lt 1) {
    throw "Epochs and CpuThreads must be positive."
}

$DatasetDir = Join-Path $RepoRoot ".tmp\pii-ner-training-v2"
$TrainedDir = Join-Path $RepoRoot ".tmp\pii-ner-trained-v2"
$CandidateRoot = Join-Path $RepoRoot ".tmp\pii-ner-candidate-v2"
$CandidateDir = Join-Path $CandidateRoot "gatelm--koelectra-small-v3-pii-ner-quantized"
$EvaluationDir = Join-Path $RepoRoot ".tmp\pii-ner-evaluation-v2"
$env:PYTHONPATH = Join-Path $RepoRoot "apps\ai-service"

function Invoke-GateLmPython {
    param([string[]]$CommandArguments)
    & $Python @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "GateLM PII command failed with exit code $LASTEXITCODE"
    }
}

Push-Location $RepoRoot
try {
    Invoke-GateLmPython -CommandArguments @(
        "-m", "app.services.pii_ner_training_dataset_cli",
        "--out", $DatasetDir
    )
    Invoke-GateLmPython -CommandArguments @(
        "-m", "app.services.pii_ner_train_cli",
        "--dataset-dir", $DatasetDir,
        "--out", $TrainedDir,
        "--epochs", $Epochs,
        "--cpu-threads", $CpuThreads
    )
    Invoke-GateLmPython -CommandArguments @(
        "-m", "app.services.pii_ner_export_cli",
        "--model-dir", $TrainedDir,
        "--out", $CandidateDir
    )

    & $Python -m app.services.pii_ner_candidate_eval_cli `
        --model-dir $CandidateDir `
        --dataset-dir $DatasetDir `
        --out $EvaluationDir
    $EvaluationExitCode = $LASTEXITCODE
    if ($EvaluationExitCode -ne 0) {
        Write-Error "Candidate gate failed. The model was not activated. See $EvaluationDir"
        exit $EvaluationExitCode
    }

    Write-Host "Candidate engineering gate passed."
    Write-Host "The model is still inactive until production promotion evidence and Tenant Chat E2E pass."
    Write-Host "Evaluation: $EvaluationDir"
}
finally {
    Pop-Location
}

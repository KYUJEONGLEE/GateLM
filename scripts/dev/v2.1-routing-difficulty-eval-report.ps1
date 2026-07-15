param(
    [string]$Dataset = "docs/v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl",
    [string]$ReportDir = "reports/routing-difficulty-eval",
    [int]$LatencyIterations = 100,
    [int]$LatencyWarmupIterations = 5,
    [int]$LatencyBatchSize = 32,
    [int]$DifficultyLatencyBatchSize = 4096,
    [double]$MinAccuracy = 0,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

$env:GOCACHE = Join-Path $RepoRoot ".gocache"
$env:GOTELEMETRY = "off"
$env:GOTELEMETRYDIR = Join-Path $RepoRoot ".gotelemetry"
New-Item -ItemType Directory -Force -Path $env:GOCACHE | Out-Null
New-Item -ItemType Directory -Force -Path $env:GOTELEMETRYDIR | Out-Null

if ($RemainingArgs.Count -gt 0 -and $RemainingArgs[0] -eq "--") {
    if ($RemainingArgs.Count -gt 1) {
        $RemainingArgs = $RemainingArgs[1..($RemainingArgs.Count - 1)]
    }
    else {
        $RemainingArgs = @()
    }
}

$ReportDirPath = Join-Path $RepoRoot $ReportDir
New-Item -ItemType Directory -Force -Path $ReportDirPath | Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReportPath = Join-Path $ReportDirPath "difficulty-eval-$Timestamp.json"
$LatestPath = Join-Path $ReportDirPath "latest.json"

Push-Location $RepoRoot
try {
    $EvalArgs = @(
        "run",
        "./apps/gateway-core/cmd/routing-eval",
        "-evaluation-scope",
        "difficulty",
        "-dataset",
        $Dataset,
        "-output",
        $ReportPath,
        "-latency-iterations",
        "$LatencyIterations",
        "-latency-warmup-iterations",
        "$LatencyWarmupIterations",
        "-latency-batch-size",
        "$LatencyBatchSize",
        "-difficulty-latency-batch-size",
        "$DifficultyLatencyBatchSize",
        "-min-accuracy",
        "$MinAccuracy"
    ) + $RemainingArgs

    & go @EvalArgs
    if ($LASTEXITCODE -ne 0) {
        throw "routing difficulty evaluation failed with exit code $LASTEXITCODE"
    }

    Copy-Item -LiteralPath $ReportPath -Destination $LatestPath -Force

    $Report = Get-Content -LiteralPath $ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json

    ""
    "GateLM difficulty classification contract-smoke report"
    "========================================================"
    "dataset:                    $($Report.datasetPath)"
    "total samples:              $($Report.totalSamples)"
    "difficulty accuracy:        $($Report.accuracy)"
    "difficulty error rate:      $($Report.errorRate)"
    "simple -> complex:         $($Report.directionalErrors.simpleToComplexCount)/$($Report.directionalErrors.simpleExpectedSamples) ($($Report.directionalErrors.simpleToComplexRate))"
    "complex -> simple:         $($Report.directionalErrors.complexToSimpleCount)/$($Report.directionalErrors.complexExpectedSamples) ($($Report.directionalErrors.complexToSimpleRate))"
    "category latency p95 (us): $($Report.classificationLatency.category.p95Micros)"
    "difficulty latency p95:    $($Report.classificationLatency.difficulty.p95Micros)"
    "total latency p95 (us):    $($Report.classificationLatency.total.p95Micros)"
    "failures:                   $($Report.failures.Count)"
    ""
    "category x difficulty results:"
    foreach ($Category in ($Report.byCategoryDifficulty.PSObject.Properties | Sort-Object Name)) {
        foreach ($Difficulty in ($Category.Value.PSObject.Properties | Sort-Object Name)) {
            $Stats = $Difficulty.Value
            "  - $($Category.Name) / $($Difficulty.Name): total $($Stats.total), correct $($Stats.correct), incorrect $($Stats.incorrect), accuracy $($Stats.accuracy)"
        }
    }
    ""
    "failed samples:"
    if ($Report.failures.Count -eq 0) {
        "  - none"
    }
    else {
        foreach ($Failure in $Report.failures) {
            $Sample = $Report.samples | Where-Object { $_.sampleId -eq $Failure.sampleId } | Select-Object -First 1
            "  - $($Failure.sampleId): difficulty $($Failure.expectedDifficulty) -> $($Failure.actualDifficulty), categoryMatched=$($Sample.categoryMatched)"
        }
    }
    ""
    "note: the default 10-record fixture is contract smoke only, not performance or promotion evidence."
    "report file:                $ReportPath"
    "latest report:              $LatestPath"
}
finally {
    Pop-Location
}

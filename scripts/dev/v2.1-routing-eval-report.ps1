param(
    [string]$Dataset = "docs/v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl",
    [string]$ReportDir = "reports/routing-eval",
    [int]$LatencyIterations = 100,
    [double]$MinAccuracy = 0,
    [double]$MinTierAccuracy = 0,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

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
$ReportPath = Join-Path $ReportDirPath "routing-eval-$Timestamp.json"
$LatestPath = Join-Path $ReportDirPath "latest.json"

Push-Location $RepoRoot
try {
    $EvalArgs = @(
        "run",
        "./apps/gateway-core/cmd/routing-eval",
        "-dataset",
        $Dataset,
        "-output",
        $ReportPath,
        "-latency-iterations",
        "$LatencyIterations",
        "-min-accuracy",
        "$MinAccuracy",
        "-min-tier-accuracy",
        "$MinTierAccuracy"
    ) + $RemainingArgs

    & go @EvalArgs
    if ($LASTEXITCODE -ne 0) {
        throw "routing evaluation failed with exit code $LASTEXITCODE"
    }

    Copy-Item -LiteralPath $ReportPath -Destination $LatestPath -Force

    $Report = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json

    ""
    "GateLM v2.1 routing evaluation report"
    "======================================"
    "dataset:             $($Report.datasetPath)"
    "samples:             $($Report.totalSamples)"
    "category accuracy:   $($Report.accuracy)"
    "category errorRate:  $($Report.errorRate)"
    "tier accuracy:       $($Report.tierAccuracy)"
    "tier errorRate:      $($Report.tierErrorRate)"
    "latency avg micros:  $($Report.latency.avgMicros)"
    "latency p50 micros:  $($Report.latency.p50Micros)"
    "latency p95 micros:  $($Report.latency.p95Micros)"
    "latency max micros:  $($Report.latency.maxMicros)"
    "cost saving rate:    $($Report.costEstimate.savingRate)"
    "failures:            $($Report.failures.Count)"
    "report:              $ReportPath"
    "latest:              $LatestPath"
}
finally {
    Pop-Location
}

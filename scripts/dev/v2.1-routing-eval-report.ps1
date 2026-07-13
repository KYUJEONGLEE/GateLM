param(
    [string]$Dataset = "docs/v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl",
    [string]$ReportDir = "reports/routing-eval",
    [int]$LatencyIterations = 100,
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
        "$MinAccuracy"
    ) + $RemainingArgs

    & go @EvalArgs
    if ($LASTEXITCODE -ne 0) {
        throw "routing evaluation failed with exit code $LASTEXITCODE"
    }

    Copy-Item -LiteralPath $ReportPath -Destination $LatestPath -Force

    $Report = Get-Content -LiteralPath $ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json

    ""
    "GateLM v2.1 카테고리 분류 정답 평가 리포트"
    "=========================================="
    "데이터셋:             $($Report.datasetPath)"
    "전체 샘플 수:         $($Report.totalSamples)"
    "카테고리 정확도:      $($Report.accuracy)"
    "카테고리 오답률:      $($Report.errorRate)"
    "평균 지연시간(μs):    $($Report.latency.avgMicros)"
    "P50 지연시간(μs):     $($Report.latency.p50Micros)"
    "P95 지연시간(μs):     $($Report.latency.p95Micros)"
    "최대 지연시간(μs):    $($Report.latency.maxMicros)"
    "실패 수:              $($Report.failures.Count)"
    ""
    "카테고리별 결과:"
    foreach ($Category in ($Report.byCategory.PSObject.Properties | Sort-Object Name)) {
        $Label = $Category.Value.labelKo
        if ([string]::IsNullOrWhiteSpace($Label)) {
            $Label = $Category.Name
        }
        "  - $Label [$($Category.Name)]: 전체 $($Category.Value.total), 정답 $($Category.Value.correct), 오답 $($Category.Value.incorrect), 정확도 $($Category.Value.accuracy), 오답률 $($Category.Value.incorrectRate)"
    }
    ""
    "카테고리 혼동 행렬 (예상 -> 실제):"
    foreach ($Expected in ($Report.confusionMatrix.PSObject.Properties | Sort-Object Name)) {
        "  - $($Expected.Name):"
        foreach ($Actual in ($Expected.Value.PSObject.Properties | Sort-Object Name)) {
            "      $($Actual.Name): $($Actual.Value)"
        }
    }
    ""
    "샘플 판단 예시(최대 10개):"
    foreach ($Sample in ($Report.samples | Select-Object -First 10)) {
        "  - $($Sample.sampleId): $($Sample.redactedPrompt)"
        "    예상: $($Sample.expectedCategoryKo) [$($Sample.expectedCategory)]"
        "    실제: $($Sample.actualCategoryKo) [$($Sample.actualCategory)]"
    }
    ""
    "리포트 파일:          $ReportPath"
    "최신 리포트:          $LatestPath"
}
finally {
    Pop-Location
}

param(
    [string]$Dataset = "docs/v2.1.0/fixtures/routing-random-probe.fixture.jsonl",
    [string]$ReportDir = "reports/routing-probe",
    [int]$LatencyIterations = 20,
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
$ReportPath = Join-Path $ReportDirPath "routing-probe-$Timestamp.json"
$LatestPath = Join-Path $ReportDirPath "latest.json"

Push-Location $RepoRoot
try {
    $EvalArgs = @(
        "run",
        "./apps/gateway-core/cmd/routing-eval",
        "-mode",
        "probe",
        "-dataset",
        $Dataset,
        "-output",
        $ReportPath,
        "-latency-iterations",
        "$LatencyIterations"
    ) + $RemainingArgs

    & go @EvalArgs
    if ($LASTEXITCODE -ne 0) {
        throw "routing probe failed with exit code $LASTEXITCODE"
    }

    Copy-Item -LiteralPath $ReportPath -Destination $LatestPath -Force

    $Report = Get-Content -LiteralPath $ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json

    ""
    "GateLM v2.1 라우팅 분포 관찰 리포트"
    "===================================="
    "데이터셋:             $($Report.datasetPath)"
    "전체 샘플 수:         $($Report.totalSamples)"
    "평균 지연시간(μs):    $($Report.latency.avgMicros)"
    "P50 지연시간(μs):     $($Report.latency.p50Micros)"
    "P95 지연시간(μs):     $($Report.latency.p95Micros)"
    "최대 지연시간(μs):    $($Report.latency.maxMicros)"
    "예상 비용 절감률:     $($Report.costEstimate.savingRate)"
    ""
    "카테고리 분포:"
    foreach ($Category in ($Report.byCategory.PSObject.Properties | Sort-Object Name)) {
        $Label = $Category.Value.labelKo
        if ([string]::IsNullOrWhiteSpace($Label)) {
            $Label = $Category.Name
        }
        "  - $Label [$($Category.Name)]: $($Category.Value.total)개, 비율 $($Category.Value.rate)"
    }
    "티어 분포:"
    foreach ($Tier in ($Report.byTier.PSObject.Properties | Sort-Object Name)) {
        $Label = $Tier.Value.labelKo
        if ([string]::IsNullOrWhiteSpace($Label)) {
            $Label = $Tier.Name
        }
        "  - $Label [$($Tier.Name)]: $($Tier.Value.total)개, 비율 $($Tier.Value.rate)"
    }
    ""
    "리포트 파일:          $ReportPath"
    "최신 리포트:          $LatestPath"
}
finally {
    Pop-Location
}

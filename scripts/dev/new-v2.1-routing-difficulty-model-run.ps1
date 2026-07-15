param(
    [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($RunId -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]*$") {
    throw "RunId must start with an alphanumeric character and contain only alphanumeric characters, dot, underscore, or hyphen."
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$ReportRoot = Join-Path $RepoRoot "reports/routing-difficulty-model"
$RunDirectory = Join-Path $ReportRoot $RunId

if (Test-Path -LiteralPath $RunDirectory) {
    throw "Difficulty model run already exists: $RunDirectory"
}

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$CreatedAt = [DateTimeOffset]::Now.ToString("o")

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $Json = $Value | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($Path, $Json + [Environment]::NewLine, $Utf8NoBom)
}

New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null

$Files = [ordered]@{
    pcaSweep = "pca-sweep.json"
    semanticHeadReport = "semantic-head-report.json"
    logisticComparison = "logistic-comparison.json"
    calibrationReport = "calibration-report.json"
    thresholdSweep = "threshold-sweep.json"
    consoleLog = "console.log"
}

Write-JsonFile -Path (Join-Path $RunDirectory "run-manifest.json") -Value ([ordered]@{
    runId = $RunId
    createdAt = $CreatedAt
    status = "initialized"
    files = $Files
    stages = @(
        [ordered]@{ name = "pca_sweep"; status = "pending" }
        [ordered]@{ name = "semantic_head"; status = "pending" }
        [ordered]@{ name = "logistic_regression"; status = "pending" }
        [ordered]@{ name = "calibration"; status = "pending" }
        [ordered]@{ name = "threshold_sweep"; status = "pending" }
    )
})

$StageReports = [ordered]@{
    "pca-sweep.json" = [ordered]@{
        runId = $RunId
        stage = "pca_sweep"
        status = "pending"
        candidates = @()
    }
    "semantic-head-report.json" = [ordered]@{
        runId = $RunId
        stage = "semantic_head"
        status = "pending"
        heads = @()
    }
    "logistic-comparison.json" = [ordered]@{
        runId = $RunId
        stage = "logistic_regression"
        status = "pending"
        candidates = @()
    }
    "calibration-report.json" = [ordered]@{
        runId = $RunId
        stage = "calibration"
        status = "pending"
        candidates = @()
    }
    "threshold-sweep.json" = [ordered]@{
        runId = $RunId
        stage = "threshold_sweep"
        status = "pending"
        operatingPoints = @()
    }
}

foreach ($Entry in $StageReports.GetEnumerator()) {
    Write-JsonFile -Path (Join-Path $RunDirectory $Entry.Key) -Value $Entry.Value
}

$InitialLogLine = "[$CreatedAt] initialized routing difficulty model run $RunId"
[System.IO.File]::WriteAllText(
    (Join-Path $RunDirectory "console.log"),
    $InitialLogLine + [Environment]::NewLine,
    $Utf8NoBom
)

Write-Output $RunDirectory

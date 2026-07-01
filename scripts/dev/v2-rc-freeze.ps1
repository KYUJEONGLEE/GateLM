param(
    [string]$ReportDir = "",
    [switch]$RunFullVerify,
    [switch]$RequireLiveEvidence,
    [switch]$DescribeOnly
)

# v2.0.0 RC freeze gate.
# This script is the last local gate before an RC tag candidate. It validates
# repo cleanliness, docs checks, optional full verify, and sanitized live
# evidence report presence. It never writes raw prompts, responses, credentials,
# provider keys, or Authorization headers.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @()
    )

    Write-Host ""
    Write-Host "== $Name =="
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Convert-ToSafeArray {
    param($Value)

    if ($null -eq $Value) {
        return ,@()
    }

    return ,@($Value | Where-Object { $null -ne $_ })
}

function Get-LatestEvidencePath {
    param([Parameter(Mandatory = $true)][string]$Pattern)

    $matchedFiles = Get-ChildItem -LiteralPath $ReportDir -Filter $Pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending
    $items = Convert-ToSafeArray -Value $matchedFiles
    if ($items.Count -eq 0) {
        return $null
    }

    return $items[0].FullName
}

function Assert-NoSensitiveMarkers {
    param([Parameter(Mandatory = $true)][string]$Path)

    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $forbiddenMarkers = @(
        '"rawPrompt"',
        '"rawResponse"',
        '"authorizationHeader"',
        '"apiKeyPlaintext"',
        '"appTokenPlaintext"',
        '"providerApiKey"',
        '"providerKey"',
        '"Authorization"',
        'Bearer ',
        'sk-',
        'glm_api_',
        'glm_app_'
    )

    foreach ($marker in $forbiddenMarkers) {
        if ($content -like "*$marker*") {
            throw "Evidence file contains forbidden sensitive marker [$marker]: $Path"
        }
    }
}

function Resolve-Evidence {
    $patterns = [ordered]@{
        providerE2E = "v2-provider-e2e-*.json"
        requestLogConsistency = "v2-request-log-consistency-*.json"
        k6Smoke = "v2-k6-smoke-*-summary.json"
        finalHardening = "v2-final-hardening-*.json"
    }

    $result = [ordered]@{}
    foreach ($name in $patterns.Keys) {
        $path = Get-LatestEvidencePath -Pattern $patterns[$name]
        if ([string]::IsNullOrWhiteSpace($path)) {
            if ($RequireLiveEvidence) {
                throw "Required RC evidence is missing: $name ($($patterns[$name]))"
            }
            $result[$name] = [ordered]@{
                present = $false
                path = $null
            }
            continue
        }

        Assert-NoSensitiveMarkers -Path $path
        $result[$name] = [ordered]@{
            present = $true
            path = Resolve-Path -LiteralPath $path -Relative
        }
    }

    return $result
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot "reports/e2e"
}
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host ""
Write-Host "GateLM v2.0.0 RC freeze gate"
Write-Host "============================"
Write-Host "repo:                $repoRoot"
Write-Host "reportDir:           $ReportDir"
Write-Host "runFullVerify:       $RunFullVerify"
Write-Host "requireLiveEvidence: $RequireLiveEvidence"
Write-Host ""

if ($DescribeOnly) {
    Write-Host "Describe-only mode. No commands will be executed."
    Write-Host "Planned checks:"
    Write-Host "- git diff --check"
    Write-Host "- corepack pnpm verify:v2-docs"
    Write-Host "- corepack pnpm verify:v2-final when -RunFullVerify is set"
    Write-Host "- latest Provider E2E, Request Log consistency, k6 smoke, final hardening evidence presence"
    Write-Host "- sensitive marker scan for evidence files"
    Write-Host "- sanitized RC freeze report under reports/e2e"
    exit 0
}

Push-Location $repoRoot
try {
    Invoke-CheckedCommand -Name "git diff --check" -FilePath "git" -Arguments @("diff", "--check")
    Invoke-CheckedCommand -Name "verify:v2-docs" -FilePath "corepack" -Arguments @("pnpm", "verify:v2-docs")
    if ($RunFullVerify) {
        Invoke-CheckedCommand -Name "verify:v2-final" -FilePath "corepack" -Arguments @("pnpm", "verify:v2-final")
    }

    New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
    $evidence = Resolve-Evidence
    $report = [ordered]@{
        runId = "v2_rc_freeze_$timestamp"
        generatedAt = [DateTime]::UtcNow.ToString("o")
        checks = [ordered]@{
            gitDiffCheck = "passed"
            docsVerify = "passed"
            fullVerify = if ($RunFullVerify) { "passed" } else { "skipped" }
            liveEvidenceRequired = [bool]$RequireLiveEvidence
        }
        evidence = $evidence
        releaseNote = "RC candidate only. Production readiness still depends on team review, live provider evidence, and explicit release approval."
        securityNote = "This report intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext."
    }

    $reportPath = Join-Path $ReportDir "v2-rc-freeze-$timestamp.json"
    ConvertTo-Json -InputObject $report -Depth 20 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Host ""
    Write-Host "RC freeze report written:"
    Write-Host $reportPath
}
finally {
    Pop-Location
}

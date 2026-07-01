param(
    [string]$ReportDir = "",
    [switch]$RunFullVerify,
    [switch]$SkipDocsVerify,
    [switch]$SkipGitDiffCheck,
    [switch]$DescribeOnly
)

# v2.0.1 final hardening wrapper.
# This script keeps the last release check repeatable without forcing the
# heaviest test suite on every local run. It never writes raw prompts,
# raw responses, API keys, app tokens, provider keys, or Authorization headers.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $repoRoot
    )

    Write-Host ""
    Write-Host "== $Name =="
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Get-CommandVersion {
    param(
        [Parameter(Mandatory = $true)][string]$CommandName,
        [string[]]$Arguments = @("--version")
    )

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return [ordered]@{
            available = $false
            source = $null
            version = $null
        }
    }

    $version = ""
    try {
        $version = (& $command.Source @Arguments 2>$null | Select-Object -First 1)
    }
    catch {
        $version = "unavailable"
    }

    return [ordered]@{
        available = $true
        source = $command.Source
        version = [string]$version
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Assert-ToolingBaseline {
    $packageJson = Read-JsonFile -Path (Join-Path $repoRoot "package.json")
    $nvmrc = (Get-Content -LiteralPath (Join-Path $repoRoot ".nvmrc") -Raw).Trim()
    $nodeVersionFile = (Get-Content -LiteralPath (Join-Path $repoRoot ".node-version") -Raw).Trim()

    if ($nvmrc -ne "22") {
        throw ".nvmrc must be 22."
    }
    if ($nodeVersionFile -ne "22") {
        throw ".node-version must be 22."
    }
    if ($packageJson.packageManager -ne "pnpm@9.15.0") {
        throw "package.json packageManager must be pnpm@9.15.0."
    }
    if ($packageJson.engines.node -ne ">=22 <23") {
        throw "package.json engines.node must be >=22 <23."
    }
}

function Assert-ExpectedScripts {
    $packageJson = Read-JsonFile -Path (Join-Path $repoRoot "package.json")
    $required = @("verify:v2-docs", "verify:v2-final", "v2:final:hardening")

    foreach ($scriptName in $required) {
        if ($null -eq $packageJson.scripts.PSObject.Properties[$scriptName]) {
            throw "package.json is missing required script: $scriptName"
        }
    }

    $phaseScripts = @(
        "v2:p0:bootstrap",
        "v2:provider:e2e",
        "v2:request-log:consistency",
        "v2:k6:smoke"
    )
    $missingPhaseScripts = @($phaseScripts | Where-Object { $null -eq $packageJson.scripts.PSObject.Properties[$_] })

    return $missingPhaseScripts
}

function Get-ReportObject {
    param(
        [string[]]$MissingPhaseScripts,
        [bool]$DocsVerifyRan,
        [bool]$FullVerifyRan
    )

    return [ordered]@{
        runId = "v2_final_hardening_$timestamp"
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        tooling = [ordered]@{
            node = Get-CommandVersion -CommandName "node"
            pnpm = Get-CommandVersion -CommandName "corepack" -Arguments @("pnpm", "--version")
            go = Get-CommandVersion -CommandName "go" -Arguments @("version")
            k6 = Get-CommandVersion -CommandName "k6" -Arguments @("version")
        }
        checks = [ordered]@{
            toolingBaseline = "passed"
            gitDiffCheck = if ($SkipGitDiffCheck) { "skipped" } else { "passed" }
            docsVerify = if ($DocsVerifyRan) { "passed" } elseif ($SkipDocsVerify) { "skipped" } else { "not_run" }
            fullVerify = if ($FullVerifyRan) { "passed" } elseif ($RunFullVerify) { "failed_before_report" } else { "skipped" }
            missingPhaseScripts = $MissingPhaseScripts
        }
        notes = @(
            "Phase scripts can be missing when this branch is reviewed before earlier v2.0.1 branches are merged.",
            "Run with -RunFullVerify before release candidate tagging.",
            "This report intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext."
        )
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot "reports/e2e"
}

Write-Host ""
Write-Host "GateLM v2.0.1 final hardening"
Write-Host "============================="
Write-Host "repo:          $repoRoot"
Write-Host "reportDir:     $ReportDir"
Write-Host "runFullVerify: $RunFullVerify"
Write-Host ""

if ($DescribeOnly) {
    Write-Host "Describe-only mode. No checks will be executed."
    Write-Host "Planned checks:"
    Write-Host "- Node/pnpm baseline from .nvmrc, .node-version, package.json."
    Write-Host "- Required package scripts."
    Write-Host "- git diff --check."
    Write-Host "- verify:v2-docs unless -SkipDocsVerify is set."
    Write-Host "- verify:v2-final only when -RunFullVerify is set."
    Write-Host "- sanitized hardening report under reports/e2e."
    exit 0
}

Assert-ToolingBaseline
$missingPhaseScripts = @(Assert-ExpectedScripts)

if (-not $SkipGitDiffCheck) {
    Invoke-CheckedCommand -Name "git diff --check" -FilePath "git" -Arguments @("diff", "--check") -WorkingDirectory $repoRoot
}

$docsVerifyRan = $false
if (-not $SkipDocsVerify) {
    Invoke-CheckedCommand -Name "verify:v2-docs" -FilePath "corepack" -Arguments @("pnpm", "verify:v2-docs") -WorkingDirectory $repoRoot
    $docsVerifyRan = $true
}

$fullVerifyRan = $false
if ($RunFullVerify) {
    Invoke-CheckedCommand -Name "verify:v2-final" -FilePath "corepack" -Arguments @("pnpm", "verify:v2-final") -WorkingDirectory $repoRoot
    $fullVerifyRan = $true
}

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$report = Get-ReportObject -MissingPhaseScripts $missingPhaseScripts -DocsVerifyRan $docsVerifyRan -FullVerifyRan $fullVerifyRan
$reportPath = Join-Path $ReportDir "v2-final-hardening-$timestamp.json"
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportPath -Encoding utf8

Write-Host ""
Write-Host "final hardening report written:"
Write-Host $reportPath

if ($missingPhaseScripts.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing phase scripts on this branch:"
    foreach ($scriptName in $missingPhaseScripts) {
        Write-Host "- $scriptName"
    }
    Write-Host "This is acceptable before earlier v2.0.1 phase branches are merged."
}

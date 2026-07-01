param(
    [string]$ReportDir = "",
    [switch]$RequireProviderE2E,
    [switch]$RequireRequestLogConsistency,
    [switch]$RequireK6Smoke,
    [switch]$RequireFinalHardening,
    [switch]$DescribeOnly
)

# v2 release evidence gate.
# This script validates sanitized evidence reports produced by the v2 E2E,
# request-log consistency, k6 smoke, and final hardening scripts. It does not
# execute live traffic and never writes raw prompts, responses, credentials, or
# Authorization headers.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Convert-ToSafeArray {
    param($Value)

    if ($null -eq $Value) {
        return ,@()
    }

    return ,@($Value | Where-Object { $null -ne $_ })
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-LatestReport {
    param([Parameter(Mandatory = $true)][string]$Pattern)

    $matches = Get-ChildItem -LiteralPath $ReportDir -Filter $Pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending

    $items = Convert-ToSafeArray -Value $matches
    if ($items.Count -eq 0) {
        return $null
    }

    return $items[0]
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Value {
    param(
        $Value,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        throw $Message
    }
}

function Assert-NoSensitiveMarkers {
    param([Parameter(Mandatory = $true)][string]$Path)

    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $forbiddenMarkers = @(
        '"rawPrompt"',
        '"rawResponse"',
        '"prompt"',
        '"response"',
        '"messages"',
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
        if ($content.Contains($marker)) {
            throw "Evidence report contains forbidden sensitive marker [$marker]: $Path"
        }
    }
}

function Get-NestedProperty {
    param(
        $Value,
        [Parameter(Mandatory = $true)][string[]]$Path
    )

    $current = $Value
    foreach ($name in $Path) {
        if ($null -eq $current) {
            return $null
        }
        $property = $current.PSObject.Properties[$name]
        if ($null -eq $property) {
            return $null
        }
        $current = $property.Value
    }

    return $current
}

function New-EvidenceItem {
    param(
        [Parameter(Mandatory = $true)][string]$ScenarioName,
        [Parameter(Mandatory = $true)]$File,
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][hashtable]$Assertions
    )

    return [ordered]@{
        scenarioName = $ScenarioName
        path = Resolve-Path -LiteralPath $File.FullName -Relative
        generatedAt = if ($Json.generatedAt) { [string]$Json.generatedAt } else { $null }
        requestId = if ($Json.requestId) { [string]$Json.requestId } elseif ($Json.lookupKey.requestId) { [string]$Json.lookupKey.requestId } else { $null }
        terminalStatus = if ($Json.requestDetail.terminalStatus) { [string]$Json.requestDetail.terminalStatus } elseif ($Json.checks.terminalStatus) { [string]$Json.checks.terminalStatus } else { $null }
        domainOutcomes = if ($Json.requestDetail.domainOutcomes) { $Json.requestDetail.domainOutcomes } elseif ($Json.domainOutcomes) { $Json.domainOutcomes } else { $null }
        runtimeSnapshot = if ($Json.runtimeSnapshot) { $Json.runtimeSnapshot } elseif ($Json.checks.runtimeSnapshotId) {
            [ordered]@{
                runtimeSnapshotId = $Json.checks.runtimeSnapshotId
                runtimeSnapshotVersion = $Json.checks.runtimeSnapshotVersion
                contentHash = $Json.checks.contentHash
            }
        } else { $null }
        provider = [ordered]@{
            providerOutcome = if ($Json.checks.providerOutcome) { [string]$Json.checks.providerOutcome } elseif ($Json.domainOutcomes.provider) { [string]$Json.domainOutcomes.provider } else { $null }
            fallbackOutcome = if ($Json.checks.fallbackOutcome) { [string]$Json.checks.fallbackOutcome } elseif ($Json.domainOutcomes.fallback) { [string]$Json.domainOutcomes.fallback } else { $null }
            routedProvider = if ($Json.responseHeaders.routedProvider) { [string]$Json.responseHeaders.routedProvider } else { $null }
            routedModel = if ($Json.responseHeaders.routedModel) { [string]$Json.responseHeaders.routedModel } else { $null }
        }
        assertions = $Assertions
    }
}

function Validate-ProviderE2E {
    $file = Get-LatestReport -Pattern "v2-provider-e2e-*.json"
    if ($null -eq $file) {
        if ($RequireProviderE2E) {
            throw "Required Provider E2E report was not found."
        }
        return $null
    }

    Assert-NoSensitiveMarkers -Path $file.FullName
    $json = Read-JsonFile -Path $file.FullName
    Assert-Value $json.requestId "Provider E2E report is missing requestId."
    Assert-Value $json.runtimeSnapshot.runtimeSnapshotId "Provider E2E report is missing runtimeSnapshotId."
    Assert-Value $json.providerCatalog.catalogId "Provider E2E report is missing providerCatalog.catalogId."

    $assertions = @{
        chatStatusOk = ([int]$json.checks.chatStatus -eq 200)
        detailStatusOk = ([int]$json.checks.detailStatus -eq 200)
        dashboardStatusOk = ([int]$json.checks.dashboardStatus -eq 200)
        providerOrFallbackSucceeded = ([string]$json.checks.providerOutcome -eq "success" -or [string]$json.checks.fallbackOutcome -eq "success")
    }

    foreach ($key in $assertions.Keys) {
        Assert-True ([bool]$assertions[$key]) "Provider E2E assertion failed: $key"
    }

    return New-EvidenceItem -ScenarioName "provider_e2e" -File $file -Json $json -Assertions $assertions
}

function Validate-RequestLogConsistency {
    $file = Get-LatestReport -Pattern "v2-request-log-consistency-*.json"
    if ($null -eq $file) {
        if ($RequireRequestLogConsistency) {
            throw "Required Request Log consistency report was not found."
        }
        return $null
    }

    Assert-NoSensitiveMarkers -Path $file.FullName
    $json = Read-JsonFile -Path $file.FullName
    Assert-Value $json.lookupKey.requestId "Request Log consistency report is missing requestId."
    Assert-Value $json.checks.runtimeSnapshotId "Request Log consistency report is missing runtimeSnapshotId."

    $assertions = @{
        requestDetailStatusOk = ([int]$json.checks.requestDetailStatus -eq 200)
        projectLogsStatusOk = ([int]$json.checks.projectLogsStatus -eq 200)
        dashboardStatusOk = ([int]$json.checks.dashboardStatus -eq 200)
        detailMatchesProjectLog = ([bool]$json.consistency.detailMatchesProjectLog)
        dashboardContainsScope = ([bool]$json.consistency.dashboardContainsScope)
        sensitiveFieldsNotExposed = ([bool]$json.consistency.sensitiveFieldsNotExposed)
    }

    foreach ($key in $assertions.Keys) {
        Assert-True ([bool]$assertions[$key]) "Request Log consistency assertion failed: $key"
    }

    return New-EvidenceItem -ScenarioName "request_log_consistency" -File $file -Json $json -Assertions $assertions
}

function Validate-K6Smoke {
    $file = Get-LatestReport -Pattern "v2-k6-smoke-*-summary.json"
    if ($null -eq $file) {
        if ($RequireK6Smoke) {
            throw "Required k6 smoke summary was not found."
        }
        return $null
    }

    Assert-NoSensitiveMarkers -Path $file.FullName
    $json = Read-JsonFile -Path $file.FullName
    $checksRate = Get-NestedProperty -Value $json -Path @("metrics", "checks", "values", "rate")
    $httpReqFailedRate = Get-NestedProperty -Value $json -Path @("metrics", "http_req_failed", "values", "rate")

    $assertions = @{
        checksSucceeded = ($null -ne $checksRate -and [double]$checksRate -eq 1.0)
        httpRequestsDidNotFail = ($null -eq $httpReqFailedRate -or [double]$httpReqFailedRate -eq 0.0)
    }

    foreach ($key in $assertions.Keys) {
        Assert-True ([bool]$assertions[$key]) "k6 smoke assertion failed: $key"
    }

    return [ordered]@{
        scenarioName = "k6_smoke"
        path = Resolve-Path -LiteralPath $file.FullName -Relative
        generatedAt = $null
        requestId = $null
        terminalStatus = $null
        domainOutcomes = $null
        runtimeSnapshot = $null
        provider = $null
        assertions = $assertions
    }
}

function Validate-FinalHardening {
    $file = Get-LatestReport -Pattern "v2-final-hardening-*.json"
    if ($null -eq $file) {
        if ($RequireFinalHardening) {
            throw "Required final hardening report was not found."
        }
        return $null
    }

    Assert-NoSensitiveMarkers -Path $file.FullName
    $json = Read-JsonFile -Path $file.FullName
    $assertions = @{
        toolingBaselinePassed = ([string]$json.checks.toolingBaseline -eq "passed")
        gitDiffCheckPassedOrSkipped = (@("passed", "skipped") -contains [string]$json.checks.gitDiffCheck)
        docsVerifyPassedOrSkipped = (@("passed", "skipped") -contains [string]$json.checks.docsVerify)
        fullVerifyPassedOrSkipped = (@("passed", "skipped") -contains [string]$json.checks.fullVerify)
    }

    foreach ($key in $assertions.Keys) {
        Assert-True ([bool]$assertions[$key]) "Final hardening assertion failed: $key"
    }

    return [ordered]@{
        scenarioName = "final_hardening"
        path = Resolve-Path -LiteralPath $file.FullName -Relative
        generatedAt = if ($json.generatedAt) { [string]$json.generatedAt } else { $null }
        requestId = $null
        terminalStatus = $null
        domainOutcomes = $null
        runtimeSnapshot = $null
        provider = $null
        assertions = $assertions
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot "reports/e2e"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host ""
Write-Host "GateLM v2 release evidence gate"
Write-Host "==============================="
Write-Host "repo:      $repoRoot"
Write-Host "reportDir: $ReportDir"
Write-Host ""

if ($DescribeOnly) {
    Write-Host "Describe-only mode. No report files will be read."
    Write-Host "Planned checks:"
    Write-Host "- Read the latest Provider E2E, Request Log consistency, k6 smoke, and final hardening reports."
    Write-Host "- Validate required status/outcome/assertion fields."
    Write-Host "- Reject evidence files containing sensitive markers such as credentials or raw prompt/response fields."
    Write-Host "- Write a sanitized release evidence manifest."
    exit 0
}

if (-not (Test-Path -LiteralPath $ReportDir)) {
    throw "ReportDir does not exist: $ReportDir"
}

$items = @(
    (Validate-ProviderE2E),
    (Validate-RequestLogConsistency),
    (Validate-K6Smoke),
    (Validate-FinalHardening)
) | Where-Object { $null -ne $_ }

$evidenceItems = Convert-ToSafeArray -Value $items
Assert-True ($evidenceItems.Count -gt 0) "No v2 evidence reports were found."

$manifest = [ordered]@{
    runId = "v2_release_evidence_$timestamp"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    reportDir = Resolve-Path -LiteralPath $ReportDir -Relative
    required = [ordered]@{
        providerE2E = [bool]$RequireProviderE2E
        requestLogConsistency = [bool]$RequireRequestLogConsistency
        k6Smoke = [bool]$RequireK6Smoke
        finalHardening = [bool]$RequireFinalHardening
    }
    evidence = $evidenceItems
    securityNote = "This manifest intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext."
}

$manifestPath = Join-Path $ReportDir "v2-release-evidence-manifest-$timestamp.json"
(ConvertTo-Json -InputObject $manifest -Depth 24) | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "release evidence manifest written:"
Write-Host $manifestPath
Write-Host "evidence files: $($evidenceItems.Count)"

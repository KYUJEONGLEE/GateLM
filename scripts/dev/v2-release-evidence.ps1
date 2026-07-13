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
        if ($content.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
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

function Assert-NestedValue {
    param(
        $Value,
        [Parameter(Mandatory = $true)][string[]]$Path,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $nestedValue = Get-NestedProperty -Value $Value -Path $Path
    Assert-Value $nestedValue $Message
}

function New-EvidenceItem {
    param(
        [Parameter(Mandatory = $true)][string]$ScenarioName,
        [Parameter(Mandatory = $true)]$File,
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][hashtable]$Assertions
    )

    $generatedAt = Get-NestedProperty -Value $Json -Path @("generatedAt")
    $requestId = Get-NestedProperty -Value $Json -Path @("requestId")
    if ($null -eq $requestId) {
        $requestId = Get-NestedProperty -Value $Json -Path @("lookupKey", "requestId")
    }

    $terminalStatus = Get-NestedProperty -Value $Json -Path @("requestDetail", "terminalStatus")
    if ($null -eq $terminalStatus) {
        $terminalStatus = Get-NestedProperty -Value $Json -Path @("checks", "terminalStatus")
    }

    $domainOutcomes = Get-NestedProperty -Value $Json -Path @("requestDetail", "domainOutcomes")
    if ($null -eq $domainOutcomes) {
        $domainOutcomes = Get-NestedProperty -Value $Json -Path @("domainOutcomes")
    }

    $runtimeSnapshot = Get-NestedProperty -Value $Json -Path @("runtimeSnapshot")
    if ($null -eq $runtimeSnapshot) {
        $runtimeSnapshotId = Get-NestedProperty -Value $Json -Path @("checks", "runtimeSnapshotId")
        if ($null -ne $runtimeSnapshotId) {
            $runtimeSnapshot = [ordered]@{
                runtimeSnapshotId = $runtimeSnapshotId
                runtimeSnapshotVersion = Get-NestedProperty -Value $Json -Path @("checks", "runtimeSnapshotVersion")
                contentHash = Get-NestedProperty -Value $Json -Path @("checks", "contentHash")
            }
        }
    }

    $providerOutcome = Get-NestedProperty -Value $Json -Path @("checks", "providerOutcome")
    if ($null -eq $providerOutcome) {
        $providerOutcome = Get-NestedProperty -Value $Json -Path @("domainOutcomes", "provider")
    }

    $fallbackOutcome = Get-NestedProperty -Value $Json -Path @("checks", "fallbackOutcome")
    if ($null -eq $fallbackOutcome) {
        $fallbackOutcome = Get-NestedProperty -Value $Json -Path @("domainOutcomes", "fallback")
    }

    return [ordered]@{
        scenarioName = $ScenarioName
        path = Resolve-Path -LiteralPath $File.FullName -Relative
        generatedAt = if ($generatedAt) { [string]$generatedAt } else { $null }
        requestId = if ($requestId) { [string]$requestId } else { $null }
        terminalStatus = if ($terminalStatus) { [string]$terminalStatus } else { $null }
        domainOutcomes = $domainOutcomes
        runtimeSnapshot = $runtimeSnapshot
        provider = [ordered]@{
            providerOutcome = if ($providerOutcome) { [string]$providerOutcome } else { $null }
            fallbackOutcome = if ($fallbackOutcome) { [string]$fallbackOutcome } else { $null }
            providerAttemptProviderId = Get-NestedProperty -Value $Json -Path @("providerAttempt", "providerId")
            providerAttemptModelId = Get-NestedProperty -Value $Json -Path @("providerAttempt", "modelId")
        }
        routing = [ordered]@{
            category = Get-NestedProperty -Value $Json -Path @("routing", "category")
            difficulty = Get-NestedProperty -Value $Json -Path @("routing", "difficulty")
            routingReason = Get-NestedProperty -Value $Json -Path @("routing", "routingReason")
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
    Assert-NestedValue -Value $json -Path @("requestId") -Message "Provider E2E report is missing requestId."
    Assert-NestedValue -Value $json -Path @("runtimeSnapshot", "runtimeSnapshotId") -Message "Provider E2E report is missing runtimeSnapshotId."
    Assert-NestedValue -Value $json -Path @("providerCatalog", "catalogId") -Message "Provider E2E report is missing providerCatalog.catalogId."

    $assertions = @{
        chatStatusOk = ([int](Get-NestedProperty -Value $json -Path @("checks", "chatStatus")) -eq 200)
        detailStatusOk = ([int](Get-NestedProperty -Value $json -Path @("checks", "detailStatus")) -eq 200)
        dashboardStatusOk = ([int](Get-NestedProperty -Value $json -Path @("checks", "dashboardStatus")) -eq 200)
        providerOrFallbackSucceeded = ([string](Get-NestedProperty -Value $json -Path @("checks", "providerOutcome")) -eq "success" -or [string](Get-NestedProperty -Value $json -Path @("checks", "fallbackOutcome")) -eq "success")
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
    Assert-NestedValue -Value $json -Path @("lookupKey", "requestId") -Message "Request Log consistency report is missing requestId."
    Assert-NestedValue -Value $json -Path @("checks", "runtimeSnapshotId") -Message "Request Log consistency report is missing runtimeSnapshotId."

    $assertions = @{
        requestDetailStatusOk = ([int](Get-NestedProperty -Value $json -Path @("checks", "requestDetailStatus")) -eq 200)
        projectLogsStatusOk = ([int](Get-NestedProperty -Value $json -Path @("checks", "projectLogsStatus")) -eq 200)
        dashboardStatusOk = ([int](Get-NestedProperty -Value $json -Path @("checks", "dashboardStatus")) -eq 200)
        detailMatchesProjectLog = ([bool](Get-NestedProperty -Value $json -Path @("consistency", "detailMatchesProjectLog")))
        dashboardContainsScope = ([bool](Get-NestedProperty -Value $json -Path @("consistency", "dashboardContainsScope")))
        sensitiveFieldsNotExposed = ([bool](Get-NestedProperty -Value $json -Path @("consistency", "sensitiveFieldsNotExposed")))
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
        toolingBaselinePassed = ([string](Get-NestedProperty -Value $json -Path @("checks", "toolingBaseline")) -eq "passed")
        gitDiffCheckPassedOrSkipped = (@("passed", "skipped") -contains [string](Get-NestedProperty -Value $json -Path @("checks", "gitDiffCheck")))
        docsVerifyPassedOrSkipped = (@("passed", "skipped") -contains [string](Get-NestedProperty -Value $json -Path @("checks", "docsVerify")))
        fullVerifyPassedOrSkipped = (@("passed", "skipped") -contains [string](Get-NestedProperty -Value $json -Path @("checks", "fullVerify")))
    }

    foreach ($key in $assertions.Keys) {
        Assert-True ([bool]$assertions[$key]) "Final hardening assertion failed: $key"
    }

    return [ordered]@{
        scenarioName = "final_hardening"
        path = Resolve-Path -LiteralPath $file.FullName -Relative
        generatedAt = if (Get-NestedProperty -Value $json -Path @("generatedAt")) { [string](Get-NestedProperty -Value $json -Path @("generatedAt")) } else { $null }
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

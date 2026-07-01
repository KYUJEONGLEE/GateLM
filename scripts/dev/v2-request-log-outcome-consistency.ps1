param(
    [string]$GatewayBaseUrl = $(if ($env:GATEWAY_BASE_URL) { $env:GATEWAY_BASE_URL } else { "http://localhost:8080" }),
    [string]$TenantId = $(if ($env:GATELM_E2E_TENANT_ID) { $env:GATELM_E2E_TENANT_ID } else { "00000000-0000-4000-8000-000000000100" }),
    [string]$ProjectId = $(if ($env:GATELM_E2E_PROJECT_ID) { $env:GATELM_E2E_PROJECT_ID } else { "00000000-0000-4000-8000-000000000200" }),
    [string]$RequestId = $(if ($env:GATELM_E2E_REQUEST_ID) { $env:GATELM_E2E_REQUEST_ID } else { "" }),
    [string]$From = "",
    [string]$To = "",
    [string]$ReportDir = "",
    [switch]$DescribeOnly
)

# v2.0.1 request log / outcome consistency evidence.
# This script checks that Request Detail, Project Logs, and Dashboard Overview
# describe the same request with consistent scope, runtime snapshot, and
# canonical outcome fields. It intentionally does not persist raw prompts,
# raw responses, API keys, app tokens, provider keys, or Authorization headers.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Convert-ToSafeArray {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    return @($Value | Where-Object { $null -ne $_ })
}

function Join-Url {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Invoke-Http {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri
    )

    try {
        $response = Invoke-WebRequest -Method $Method -Uri $Uri -UseBasicParsing -TimeoutSec 20
        return [ordered]@{
            statusCode = [int]$response.StatusCode
            body = [string]$response.Content
        }
    }
    catch {
        $statusCode = 0
        $body = ""
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $body = $reader.ReadToEnd()
            }
            catch {
                $body = ""
            }
        }

        return [ordered]@{
            statusCode = $statusCode
            body = $body
        }
    }
}

function Convert-JsonBody {
    param([string]$Body)

    if ([string]::IsNullOrWhiteSpace($Body)) {
        return $null
    }

    return $Body | ConvertFrom-Json
}

function Get-EnvelopeData {
    param($Payload)

    if ($null -eq $Payload) {
        return $null
    }

    if ($null -ne $Payload.data) {
        return $Payload.data
    }

    return $Payload
}

function New-ScopeQuery {
    param(
        [Parameter(Mandatory = $true)][string]$TenantId,
        [Parameter(Mandatory = $true)][string]$ProjectId
    )

    return "tenantId=$([uri]::EscapeDataString($TenantId))&projectId=$([uri]::EscapeDataString($ProjectId))"
}

function New-TimeRangeQuery {
    param(
        [Parameter(Mandatory = $true)][datetime]$FromValue,
        [Parameter(Mandatory = $true)][datetime]$ToValue
    )

    return "from=$([uri]::EscapeDataString($FromValue.ToUniversalTime().ToString("o")))&to=$([uri]::EscapeDataString($ToValue.ToUniversalTime().ToString("o")))"
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

function Get-Outcome {
    param(
        $DomainOutcomes,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $DomainOutcomes) {
        return ""
    }

    $property = $DomainOutcomes.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return ""
    }

    return [string]$property.Value.outcome
}

function Assert-SameString {
    param(
        [string]$Expected,
        [string]$Actual,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($Expected -ne $Actual) {
        throw "$Name mismatch. expected=[$Expected], actual=[$Actual]"
    }
}

function Assert-ResponseDoesNotExposeSensitiveFields {
    param(
        [Parameter(Mandatory = $true)][string]$Body,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $forbidden = @(
        "rawPrompt",
        "rawResponse",
        "authorizationHeader",
        "apiKeyPlaintext",
        "appTokenPlaintext",
        "providerApiKey",
        "providerKey",
        "secretHash",
        "Authorization"
    )

    foreach ($term in $forbidden) {
        if ($Body.Contains($term)) {
            throw "$Name response exposed forbidden field or token marker: $term"
        }
    }
}

function Select-SafeOutcomeSummary {
    param($DomainOutcomes)

    return [ordered]@{
        auth = Get-Outcome $DomainOutcomes "auth"
        runtime = Get-Outcome $DomainOutcomes "runtime"
        rateLimit = Get-Outcome $DomainOutcomes "rateLimit"
        budget = Get-Outcome $DomainOutcomes "budget"
        safety = Get-Outcome $DomainOutcomes "safety"
        routing = Get-Outcome $DomainOutcomes "routing"
        cache = Get-Outcome $DomainOutcomes "cache"
        provider = Get-Outcome $DomainOutcomes "provider"
        fallback = Get-Outcome $DomainOutcomes "fallback"
        streaming = Get-Outcome $DomainOutcomes "streaming"
        logging = Get-Outcome $DomainOutcomes "logging"
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot "reports/e2e"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host ""
Write-Host "GateLM v2.0.1 Request Log / Outcome Consistency"
Write-Host "================================================"
Write-Host "gateway:   $GatewayBaseUrl"
Write-Host "tenantId:  $TenantId"
Write-Host "projectId: $ProjectId"
Write-Host "requestId: $RequestId"
Write-Host ""

if ($DescribeOnly) {
    Write-Host "Describe-only mode. No HTTP requests will be sent."
    Write-Host "Planned checks:"
    Write-Host "- Request Detail lookup with tenantId/projectId/requestId."
    Write-Host "- Project Logs lookup with the same tenantId/projectId/requestId."
    Write-Host "- Dashboard Overview lookup with the same tenantId/projectId time range."
    Write-Host "- Cross-check terminalStatus, provider, model, token, cost, and domain outcomes."
    Write-Host "- Verify responses do not expose raw prompt, raw response, credentials, or secret hashes."
    exit 0
}

Assert-Value $RequestId "RequestId is required. Pass -RequestId or set GATELM_E2E_REQUEST_ID."
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

$scopeQuery = New-ScopeQuery -TenantId $TenantId -ProjectId $ProjectId

$detailResponse = Invoke-Http -Method GET -Uri "$(Join-Url $GatewayBaseUrl "/api/llm-requests/$([uri]::EscapeDataString($RequestId))")?$scopeQuery"
Assert-True ($detailResponse.statusCode -eq 200) "Request Detail lookup failed: HTTP $($detailResponse.statusCode)"
Assert-ResponseDoesNotExposeSensitiveFields -Body $detailResponse.body -Name "Request Detail"
$detail = Get-EnvelopeData -Payload (Convert-JsonBody -Body $detailResponse.body)

Assert-SameString $RequestId ([string]$detail.requestId) "requestId"
Assert-SameString $TenantId ([string]$detail.tenantId) "tenantId"
Assert-SameString $ProjectId ([string]$detail.projectId) "projectId"
Assert-Value $detail.terminalStatus "Request Detail terminalStatus is empty."
Assert-Value $detail.domainOutcomes "Request Detail domainOutcomes is empty."
Assert-Value $detail.runtimeSnapshot.runtimeSnapshotId "Request Detail runtimeSnapshotId is empty."
Assert-Value $detail.runtimeSnapshot.contentHash "Request Detail runtimeSnapshot contentHash is empty."

$requiredOutcomeNames = @("auth", "runtime", "rateLimit", "budget", "safety", "routing", "cache", "provider", "fallback", "streaming", "logging")
foreach ($name in $requiredOutcomeNames) {
    Assert-Value (Get-Outcome $detail.domainOutcomes $name) "Request Detail domainOutcomes.$name.outcome is empty."
}

$createdAt = [datetime]$detail.createdAt
$fromValue = if ([string]::IsNullOrWhiteSpace($From)) { $createdAt.AddMinutes(-10) } else { [datetime]$From }
$toValue = if ([string]::IsNullOrWhiteSpace($To)) { (Get-Date).ToUniversalTime().AddMinutes(5) } else { [datetime]$To }
$rangeQuery = New-TimeRangeQuery -FromValue $fromValue -ToValue $toValue

$projectLogsUri = "$(Join-Url $GatewayBaseUrl "/api/projects/$([uri]::EscapeDataString($ProjectId))/logs")?tenantId=$([uri]::EscapeDataString($TenantId))&$rangeQuery&requestId=$([uri]::EscapeDataString($RequestId))&limit=10"
$projectLogsResponse = Invoke-Http -Method GET -Uri $projectLogsUri
Assert-True ($projectLogsResponse.statusCode -eq 200) "Project Logs lookup failed: HTTP $($projectLogsResponse.statusCode)"
Assert-ResponseDoesNotExposeSensitiveFields -Body $projectLogsResponse.body -Name "Project Logs"
$projectLogs = Convert-JsonBody -Body $projectLogsResponse.body
$items = @(Convert-ToSafeArray -Value $projectLogs.data)
$listItem = $items | Where-Object { $_.requestId -eq $RequestId } | Select-Object -First 1
Assert-True ($null -ne $listItem) "Project Logs response did not include requestId=$RequestId."

Assert-SameString ([string]$detail.terminalStatus) ([string]$listItem.terminalStatus) "terminalStatus detail/list"
Assert-SameString ([string]$detail.provider) ([string]$listItem.provider) "provider detail/list"
Assert-SameString ([string]$detail.model) ([string]$listItem.model) "model detail/list"
Assert-SameString ([string]$detail.requestedModel) ([string]$listItem.requestedModel) "requestedModel detail/list"
Assert-SameString ([string]$detail.selectedModel) ([string]$listItem.selectedModel) "selectedModel detail/list"
Assert-True ([int64]$detail.usage.promptTokens -eq [int64]$listItem.promptTokens) "promptTokens detail/list mismatch."
Assert-True ([int64]$detail.usage.completionTokens -eq [int64]$listItem.completionTokens) "completionTokens detail/list mismatch."
Assert-True ([int64]$detail.usage.totalTokens -eq [int64]$listItem.totalTokens) "totalTokens detail/list mismatch."
Assert-True ([int64]$detail.cost.costMicroUsd -eq [int64]$listItem.costMicroUsd) "costMicroUsd detail/list mismatch."

foreach ($name in @("rateLimit", "budget", "safety", "routing", "cache", "provider", "fallback")) {
    Assert-SameString (Get-Outcome $detail.domainOutcomes $name) (Get-Outcome $listItem.domainOutcomes $name) "domainOutcomes.$name detail/list"
}

$dashboardUri = "$(Join-Url $GatewayBaseUrl "/api/dashboard/overview")?$scopeQuery&$rangeQuery"
$dashboardResponse = Invoke-Http -Method GET -Uri $dashboardUri
Assert-True ($dashboardResponse.statusCode -eq 200) "Dashboard Overview lookup failed: HTTP $($dashboardResponse.statusCode)"
Assert-ResponseDoesNotExposeSensitiveFields -Body $dashboardResponse.body -Name "Dashboard Overview"
$dashboard = Get-EnvelopeData -Payload (Convert-JsonBody -Body $dashboardResponse.body)

Assert-SameString $TenantId ([string]$dashboard.filters.tenantId) "dashboard.filters.tenantId"
Assert-SameString $ProjectId ([string]$dashboard.filters.projectId) "dashboard.filters.projectId"
Assert-True ([int64]$dashboard.totals.totalRequests -ge 1) "Dashboard totals.totalRequests should be at least 1 for the selected range."

$report = [ordered]@{
    runId = "v2_request_log_consistency_$timestamp"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gatewayBaseUrl = $GatewayBaseUrl
    lookupKey = [ordered]@{
        tenantId = $TenantId
        projectId = $ProjectId
        requestId = $RequestId
    }
    checks = [ordered]@{
        requestDetailStatus = $detailResponse.statusCode
        projectLogsStatus = $projectLogsResponse.statusCode
        dashboardStatus = $dashboardResponse.statusCode
        terminalStatus = $detail.terminalStatus
        runtimeSnapshotId = $detail.runtimeSnapshot.runtimeSnapshotId
        runtimeSnapshotVersion = $detail.runtimeSnapshot.runtimeSnapshotVersion
        contentHash = $detail.runtimeSnapshot.contentHash
        provider = $detail.provider
        model = $detail.model
        dashboardTotalRequests = $dashboard.totals.totalRequests
    }
    domainOutcomes = Select-SafeOutcomeSummary -DomainOutcomes $detail.domainOutcomes
    consistency = [ordered]@{
        detailMatchesProjectLog = $true
        dashboardContainsScope = $true
        sensitiveFieldsNotExposed = $true
    }
    securityNote = "This report intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext."
}

$reportPath = Join-Path $ReportDir "v2-request-log-consistency-$timestamp.json"
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportPath -Encoding utf8

Write-Host "Request log consistency report written:"
Write-Host $reportPath
Write-Host "terminalStatus: $($detail.terminalStatus)"
Write-Host "provider.outcome: $(Get-Outcome $detail.domainOutcomes "provider")"
Write-Host "cache.outcome: $(Get-Outcome $detail.domainOutcomes "cache")"
Write-Host "runtimeSnapshotId: $($detail.runtimeSnapshot.runtimeSnapshotId)"

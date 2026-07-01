param(
    [string]$ControlPlaneBaseUrl = $(if ($env:CONTROL_PLANE_BASE_URL) { $env:CONTROL_PLANE_BASE_URL } else { "http://localhost:3001" }),
    [string]$GatewayBaseUrl = $(if ($env:GATEWAY_BASE_URL) { $env:GATEWAY_BASE_URL } else { "http://localhost:8080" }),
    [string]$ApplicationId = $(if ($env:GATELM_DEMO_APPLICATION_ID) { $env:GATELM_DEMO_APPLICATION_ID } else { "00000000-0000-4000-8000-000000000300" }),
    [string]$ApiKey = $(if ($env:GATELM_DEMO_API_KEY) { $env:GATELM_DEMO_API_KEY } else { "glm_api_test_redacted" }),
    [string]$AppToken = $(if ($env:GATELM_DEMO_APP_TOKEN) { $env:GATELM_DEMO_APP_TOKEN } else { "glm_app_token_test_redacted" }),
    [string]$EndUserId = $(if ($env:GATELM_E2E_END_USER_ID) { $env:GATELM_E2E_END_USER_ID } else { "user_v2_provider_e2e" }),
    [string]$ReportDir = "",
    [switch]$AllowFallbackSuccess,
    [switch]$IssueFreshCredentials,
    [switch]$DescribeOnly,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

# v2.0.1 Provider E2E main path evidence.
# This script verifies that Gateway can consume the published RuntimeSnapshot,
# resolve the Provider Catalog, execute a safe chat request, and expose
# sanitized request outcomes. It does not write raw API keys, app tokens,
# provider keys, Authorization headers, prompts, or responses to the report.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Convert-ToSafeArray {
    param($Value)

    if ($null -eq $Value) {
        return ,@()
    }

    return ,@($Value | Where-Object { $null -ne $_ })
}

function Join-Url {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function New-RequestId {
    param([Parameter(Mandatory = $true)][string]$RunId)

    return "request_v201_provider_e2e_$RunId"
}

function Invoke-Http {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [hashtable]$Headers = @{},
        [string]$Body = $null
    )

    try {
        $request = @{
            Method = $Method
            Uri = $Uri
            Headers = $Headers
            UseBasicParsing = $true
            TimeoutSec = 20
        }
        if ($Method -ne "GET" -and -not [string]::IsNullOrEmpty($Body)) {
            $request.Body = $Body
        }

        $response = Invoke-WebRequest @request
        return [ordered]@{
            statusCode = [int]$response.StatusCode
            headers = $response.Headers
            body = [string]$response.Content
            errorType = $null
            errorMessage = $null
        }
    }
    catch {
        $statusCode = 0
        $body = ""
        $headers = @{}
        $errorType = $_.Exception.GetType().FullName
        $errorMessage = $_.Exception.Message
        $errorResponse = $null
        if ($_.Exception -is [System.Net.WebException]) {
            $errorResponse = $_.Exception.Response
        }
        if ($null -ne $errorResponse) {
            $statusCode = [int]$errorResponse.StatusCode
            $headers = $errorResponse.Headers
            try {
                $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
                $body = $reader.ReadToEnd()
            }
            catch {
                $body = ""
            }
        }

        return [ordered]@{
            statusCode = $statusCode
            headers = $headers
            body = $body
            errorType = $errorType
            errorMessage = $errorMessage
        }
    }
}

function Format-HttpDiagnostic {
    param($Response)

    $parts = @("HTTP $($Response.statusCode)")
    if (-not [string]::IsNullOrWhiteSpace([string]$Response.errorType)) {
        $parts += [string]$Response.errorType
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$Response.errorMessage)) {
        $parts += [string]$Response.errorMessage
    }

    return ($parts -join " - ")
}

function Convert-JsonBody {
    param([string]$Body)

    if ([string]::IsNullOrWhiteSpace($Body)) {
        return $null
    }

    return $Body | ConvertFrom-Json
}

function Convert-ToJsonBody {
    param([hashtable]$Value)

    return ($Value | ConvertTo-Json -Depth 12)
}

function Get-ObjectProperty {
    param(
        $Value,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Value) {
        return $null
    }

    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-EnvelopeData {
    param($Payload)

    if ($null -eq $Payload) {
        return $null
    }

    $data = Get-ObjectProperty -Value $Payload -Name "data"
    if ($null -ne $data) {
        return $data
    }

    return $Payload
}

function New-ScopeQuery {
    param(
        [Parameter(Mandatory = $true)][string]$TenantId,
        [Parameter(Mandatory = $true)][string]$ProjectId
    )

    $tenant = [uri]::EscapeDataString($TenantId)
    $project = [uri]::EscapeDataString($ProjectId)

    return "tenantId=$tenant&projectId=$project"
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

function Get-HeaderValue {
    param(
        $Headers,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Headers) {
        return $null
    }

    if ($Headers -is [System.Collections.IDictionary]) {
        foreach ($key in $Headers.Keys) {
            if ([string]::Equals([string]$key, $Name, [System.StringComparison]::OrdinalIgnoreCase)) {
                $value = $Headers[$key]
                if ($value -is [array]) {
                    return ($value -join ",")
                }
                return [string]$value
            }
        }
    }

    return $null
}

function Select-SafeProviderSummary {
    param($Provider)

    return [ordered]@{
        providerName = $Provider.providerName
        adapterType = $Provider.adapterType
        enabled = $Provider.enabled
        credentialRequired = $Provider.credentialRequired
        fallbackEligible = $Provider.fallbackEligible
        modelIds = Convert-ToSafeArray -Value ($Provider.models | ForEach-Object { $_.modelId })
    }
}

function Select-SafeRuntimeSnapshotSummary {
    param($Snapshot)

    return [ordered]@{
        runtimeSnapshotId = $Snapshot.runtimeSnapshotId
        runtimeSnapshotVersion = $Snapshot.runtimeSnapshotVersion
        runtimeState = $Snapshot.runtimeState
        contentHash = $Snapshot.contentHash
        lookupKey = $Snapshot.lookupKey
        providerCatalogRef = $Snapshot.providerCatalogRef
        routing = [ordered]@{
            defaultProvider = $Snapshot.policies.routing.defaultProvider
            defaultModel = $Snapshot.policies.routing.defaultModel
        }
        fallback = [ordered]@{
            fallbackProvider = $Snapshot.policies.fallback.fallbackProvider
            fallbackModel = $Snapshot.policies.fallback.fallbackModel
        }
        cache = [ordered]@{
            exactCacheEnabled = $Snapshot.policies.cache.exactCacheEnabled
        }
        budget = [ordered]@{
            enabled = $Snapshot.policies.budget.enabled
            enforcementMode = $Snapshot.policies.budget.enforcementMode
            warningThresholdPercent = $Snapshot.policies.budget.warningThresholdPercent
        }
    }
}

function Select-SafeRequestDetailSummary {
    param($Detail)

    $data = $Detail
    $envelopedData = Get-ObjectProperty -Value $Detail -Name "data"
    if ($null -ne $envelopedData) {
        $data = $envelopedData
    }
    $domainOutcomes = $data.domainOutcomes

    return [ordered]@{
        requestId = $data.requestId
        terminalStatus = $data.terminalStatus
        httpStatus = $data.httpStatus
        runtimeSnapshot = $data.runtimeSnapshot
        domainOutcomes = $domainOutcomes
    }
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot "reports/e2e"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = $timestamp
$requestId = New-RequestId -RunId $runId
$prompt = "Write a short safe customer support reply for GateLM provider E2E run $runId."

Write-Host ""
Write-Host "GateLM v2.0.1 Provider E2E main path"
Write-Host "===================================="
Write-Host "controlPlane: $ControlPlaneBaseUrl"
Write-Host "gateway:      $GatewayBaseUrl"
Write-Host "application:  $ApplicationId"
Write-Host "requestId:    $requestId"
Write-Host "fresh creds:  $IssueFreshCredentials"
Write-Host ""

if ($DescribeOnly) {
    Write-Host "Describe-only mode. No HTTP requests will be sent."
    Write-Host "Planned checks:"
    Write-Host "- Control Plane and Gateway health checks."
    Write-Host "- Active RuntimeSnapshot and Provider Catalog lookup."
    Write-Host "- Optional one-time API Key/App Token issuing for the target Application."
    Write-Host "- OpenAI-compatible Gateway chat request through published RuntimeSnapshot."
    Write-Host "- Request Detail lookup with tenantId/projectId scope."
    Write-Host "- Dashboard overview lookup with tenantId/projectId scope."
    exit 0
}

$controlPlaneHealth = Invoke-Http -Method GET -Uri (Join-Url $ControlPlaneBaseUrl "/healthz")
$gatewayHealth = Invoke-Http -Method GET -Uri (Join-Url $GatewayBaseUrl "/healthz")
Assert-True ($controlPlaneHealth.statusCode -eq 200) "Control Plane health check failed: $(Format-HttpDiagnostic $controlPlaneHealth)"
Assert-True ($gatewayHealth.statusCode -eq 200) "Gateway health check failed: $(Format-HttpDiagnostic $gatewayHealth)"

$snapshotResponse = Invoke-Http -Method GET -Uri (Join-Url $ControlPlaneBaseUrl "/admin/v1/applications/$ApplicationId/runtime-snapshot/active")
Assert-True ($snapshotResponse.statusCode -eq 200) "Active RuntimeSnapshot check failed: HTTP $($snapshotResponse.statusCode)"
$snapshot = Convert-JsonBody -Body $snapshotResponse.body

$catalogId = [string]$snapshot.providerCatalogRef.catalogId
Assert-True (-not [string]::IsNullOrWhiteSpace($catalogId)) "RuntimeSnapshot providerCatalogRef.catalogId is empty."
Assert-Value $snapshot.lookupKey.tenantId "RuntimeSnapshot lookupKey.tenantId is empty."
Assert-Value $snapshot.lookupKey.projectId "RuntimeSnapshot lookupKey.projectId is empty."
Assert-Value $snapshot.lookupKey.applicationId "RuntimeSnapshot lookupKey.applicationId is empty."

$tenantId = [string]$snapshot.lookupKey.tenantId
$projectId = [string]$snapshot.lookupKey.projectId
$scopedQuery = New-ScopeQuery -TenantId $tenantId -ProjectId $projectId

if ($IssueFreshCredentials) {
    $credentialLabel = "v2-provider-e2e-$runId"

    $issueApiKeyResponse = Invoke-Http `
        -Method POST `
        -Uri (Join-Url $ControlPlaneBaseUrl "/admin/v1/projects/$projectId/api-keys") `
        -Headers @{"Content-Type" = "application/json"} `
        -Body (Convert-ToJsonBody @{
            displayName = "$credentialLabel-api-key"
            scopes = @("chat:completions", "models:read")
        })
    Assert-True (@(200, 201) -contains $issueApiKeyResponse.statusCode) "API Key issue failed: HTTP $($issueApiKeyResponse.statusCode)"
    $issuedApiKey = Get-EnvelopeData -Payload (Convert-JsonBody -Body $issueApiKeyResponse.body)
    Assert-Value $issuedApiKey.plaintext "Issued API Key response did not include one-time plaintext."
    $ApiKey = [string]$issuedApiKey.plaintext

    $issueAppTokenResponse = Invoke-Http `
        -Method POST `
        -Uri (Join-Url $ControlPlaneBaseUrl "/admin/v1/applications/$ApplicationId/app-tokens") `
        -Headers @{"Content-Type" = "application/json"} `
        -Body (Convert-ToJsonBody @{
            displayName = "$credentialLabel-app-token"
            scopes = @("chat:completions", "models:read")
        })
    Assert-True (@(200, 201) -contains $issueAppTokenResponse.statusCode) "App Token issue failed: HTTP $($issueAppTokenResponse.statusCode)"
    $issuedAppToken = Get-EnvelopeData -Payload (Convert-JsonBody -Body $issueAppTokenResponse.body)
    Assert-Value $issuedAppToken.plaintext "Issued App Token response did not include one-time plaintext."
    $AppToken = [string]$issuedAppToken.plaintext
}

$catalogResponse = Invoke-Http -Method GET -Uri (Join-Url $ControlPlaneBaseUrl "/admin/v1/provider-catalogs/$([uri]::EscapeDataString($catalogId))")
Assert-True ($catalogResponse.statusCode -eq 200) "Provider Catalog check failed: HTTP $($catalogResponse.statusCode)"
$catalog = Get-EnvelopeData -Payload (Convert-JsonBody -Body $catalogResponse.body)

$providers = Convert-ToSafeArray -Value $catalog.providers
$filteredOpenAI = $providers | Where-Object { $_.adapterType -eq "openai_compatible" -and $_.enabled -eq $true }
$filteredMock = $providers | Where-Object { $_.adapterType -eq "mock" -and $_.fallbackEligible -eq $true -and $_.enabled -eq $true }
$hasOpenAICompatible = (Convert-ToSafeArray -Value $filteredOpenAI).Count -gt 0
$hasMockFallback = (Convert-ToSafeArray -Value $filteredMock).Count -gt 0
Assert-True $hasOpenAICompatible "Provider Catalog has no enabled openai_compatible provider."
Assert-True $hasMockFallback "Provider Catalog has no enabled mock fallback provider."

$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $ApiKey"
    "X-GateLM-App-Token" = $AppToken
    "X-GateLM-End-User-Id" = $EndUserId
    "X-GateLM-Feature-Id" = "v2_provider_e2e_main_path"
    "X-GateLM-Request-Id" = $requestId
}
$body = @{
    model = "auto"
    messages = @(
        @{
            role = "user"
            content = $prompt
        }
    )
    temperature = 0.2
    max_tokens = 128
    stream = $false
} | ConvertTo-Json -Depth 8

$requestStartedAt = (Get-Date).ToUniversalTime()
$chatResponse = Invoke-Http -Method POST -Uri (Join-Url $GatewayBaseUrl "/v1/chat/completions") -Headers $headers -Body $body
$requestCompletedAt = (Get-Date).ToUniversalTime()
Assert-True ($chatResponse.statusCode -eq 200) "Gateway chat completion failed: HTTP $($chatResponse.statusCode)"

$detailResponse = Invoke-Http -Method GET -Uri "$(Join-Url $GatewayBaseUrl "/api/llm-requests/$requestId")?$scopedQuery"
Assert-True ($detailResponse.statusCode -eq 200) "Request detail lookup failed: HTTP $($detailResponse.statusCode)"
$detail = Convert-JsonBody -Body $detailResponse.body
$detailSummary = Select-SafeRequestDetailSummary -Detail $detail
$domainOutcomes = $detailSummary.domainOutcomes

$providerOutcome = $null
$fallbackOutcome = $null
if ($domainOutcomes) {
    $providerOutcome = $domainOutcomes.provider.outcome
    $fallbackOutcome = $domainOutcomes.fallback.outcome
}

$mainPathSucceeded = $providerOutcome -eq "success"
$fallbackSucceeded = $fallbackOutcome -eq "success"
if ($AllowFallbackSuccess) {
    Assert-True ($mainPathSucceeded -or $fallbackSucceeded) "Provider E2E did not finish with provider success or fallback success."
} else {
    Assert-True $mainPathSucceeded "Provider E2E did not finish with provider.outcome=success. Use -AllowFallbackSuccess only when testing degraded fallback."
}

$dashboardQuery = "$scopedQuery&from=$([uri]::EscapeDataString($requestStartedAt.AddMinutes(-1).ToString("o")))&to=$([uri]::EscapeDataString($requestCompletedAt.AddMinutes(1).ToString("o")))&grain=1h"
$dashboardResponse = Invoke-Http -Method GET -Uri "$(Join-Url $GatewayBaseUrl "/api/dashboard/overview")?$dashboardQuery"
Assert-True ($dashboardResponse.statusCode -eq 200) "Dashboard overview lookup failed: HTTP $($dashboardResponse.statusCode)"
$dashboardOverview = Get-EnvelopeData -Payload (Convert-JsonBody -Body $dashboardResponse.body)

$report = [ordered]@{
    runId = "v2_provider_e2e_$runId"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    controlPlaneBaseUrl = $ControlPlaneBaseUrl
    gatewayBaseUrl = $GatewayBaseUrl
    lookupKey = [ordered]@{
        tenantId = $tenantId
        projectId = $projectId
        applicationId = [string]$snapshot.lookupKey.applicationId
    }
    applicationId = $ApplicationId
    requestId = $requestId
    issuedFreshCredentials = [bool]$IssueFreshCredentials
    checks = [ordered]@{
        controlPlaneHealth = $controlPlaneHealth.statusCode
        gatewayHealth = $gatewayHealth.statusCode
        hasOpenAICompatibleProvider = $hasOpenAICompatible
        hasMockFallbackProvider = $hasMockFallback
        chatStatus = $chatResponse.statusCode
        detailStatus = $detailResponse.statusCode
        dashboardStatus = $dashboardResponse.statusCode
        providerOutcome = $providerOutcome
        fallbackOutcome = $fallbackOutcome
    }
    responseHeaders = [ordered]@{
        cacheStatus = Get-HeaderValue $chatResponse.headers "X-GateLM-Cache-Status"
        maskingAction = Get-HeaderValue $chatResponse.headers "X-GateLM-Masking-Action"
        routedProvider = Get-HeaderValue $chatResponse.headers "X-GateLM-Routed-Provider"
        routedModel = Get-HeaderValue $chatResponse.headers "X-GateLM-Routed-Model"
    }
    runtimeSnapshot = Select-SafeRuntimeSnapshotSummary -Snapshot $snapshot
    dashboardOverview = [ordered]@{
        totalRequests = $dashboardOverview.totals.totalRequests
        successfulRequests = $dashboardOverview.totals.successfulRequests
        blockedRequests = $dashboardOverview.totals.blockedRequests
        cacheHitRate = $dashboardOverview.totals.cacheHitRate
        totalCostUsd = $dashboardOverview.totals.totalCostUsd
    }
    providerCatalog = [ordered]@{
        catalogId = $catalog.catalogId
        catalogVersion = $catalog.catalogVersion
        contentHash = $catalog.contentHash
        providers = Convert-ToSafeArray -Value ($providers | ForEach-Object { Select-SafeProviderSummary -Provider $_ })
    }
    requestDetail = $detailSummary
    securityNote = "This report intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext."
}

$reportPath = Join-Path $ReportDir "v2-provider-e2e-$timestamp.json"
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportPath -Encoding utf8

Write-Host "Provider E2E report written:"
Write-Host $reportPath
Write-Host "provider.outcome: $providerOutcome"
Write-Host "fallback.outcome: $fallbackOutcome"

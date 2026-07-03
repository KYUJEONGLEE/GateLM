param(
    [string]$GatewayBaseUrl = "",
    [string]$ApiKey = "",
    [string]$AppToken = "",
    [string]$EndUserId = "",
    [string]$ReportDir = "reports/routing-gateway-e2e",
    [int]$MaxTokens = 96,
    [switch]$DescribeOnly
)

# v2.1 Routing Gateway E2E evidence.
# Sends synthetic safe prompts through a live Gateway and stores sanitized
# routing/provider/cache/outcome metadata only.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($GatewayBaseUrl)) {
    $GatewayBaseUrl = $(if ($env:GATEWAY_BASE_URL) { $env:GATEWAY_BASE_URL } else { "http://localhost:8080" })
}
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    $ApiKey = $(if ($env:GATELM_DEMO_API_KEY) { $env:GATELM_DEMO_API_KEY } else { "glm_api_test_redacted" })
}
if ([string]::IsNullOrWhiteSpace($AppToken)) {
    $AppToken = $(if ($env:GATELM_DEMO_APP_TOKEN) { $env:GATELM_DEMO_APP_TOKEN } else { "glm_app_token_test_redacted" })
}
if ([string]::IsNullOrWhiteSpace($EndUserId)) {
    $EndUserId = $(if ($env:GATELM_ROUTING_E2E_END_USER_ID) { $env:GATELM_ROUTING_E2E_END_USER_ID } else { "routing-e2e-user" })
}

function Join-Url {
    param([string]$BaseUrl, [string]$Path)
    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Get-HeaderValue {
    param($Headers, [string]$Name)
    if ($null -eq $Headers) { return $null }
    foreach ($key in $Headers.Keys) {
        if ([string]::Equals([string]$key, $Name, [System.StringComparison]::OrdinalIgnoreCase)) {
            $value = $Headers[$key]
            if ($value -is [array]) { return [string]($value -join ",") }
            return [string]$value
        }
    }
    return $null
}

function Get-Property {
    param($Value, [string]$Name)
    if ($null -eq $Value) { return $null }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-PathValue {
    param($Value, [string[]]$Path)
    $current = $Value
    foreach ($part in $Path) {
        $current = Get-Property -Value $current -Name $part
        if ($null -eq $current) { return $null }
    }
    return $current
}

function Get-Percentile {
    param([double[]]$Values, [double]$Percentile)
    if ($null -eq $Values -or $Values.Count -eq 0) { return 0 }
    $sorted = @($Values | Sort-Object)
    $index = [int][Math]::Ceiling(($Percentile / 100.0) * $sorted.Count) - 1
    if ($index -lt 0) { $index = 0 }
    if ($index -ge $sorted.Count) { $index = $sorted.Count - 1 }
    return [Math]::Round([double]$sorted[$index], 3)
}

function New-Distribution {
    param([array]$Rows, [string]$PropertyName)
    $result = [ordered]@{}
    foreach ($row in $Rows) {
        $value = [string](Get-Property -Value $row -Name $PropertyName)
        if ([string]::IsNullOrWhiteSpace($value)) { $value = "unknown" }
        if (-not $result.Contains($value)) { $result[$value] = 0 }
        $result[$value] += 1
    }
    return $result
}

function Invoke-Healthz {
    param([string]$BaseUrl)
    $uri = Join-Url $BaseUrl "/healthz"
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $uri -TimeoutSec 5
        if ([int]$response.StatusCode -ne 200) {
            throw "Gateway healthz failed: HTTP $($response.StatusCode)"
        }
    }
    catch {
        throw "Gateway is not reachable at $uri. Start Control Plane/Gateway first, then rerun v2.1:routing:e2e. Detail: $($_.Exception.Message)"
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$reportDirPath = Join-Path $repoRoot $ReportDir
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $reportDirPath "routing-gateway-e2e-$timestamp.json"
$latestPath = Join-Path $reportDirPath "latest.json"

$cases = @(
    [ordered]@{ sampleId = "routing-e2e-general-summary"; expectedCategory = "general"; prompt = "Summarize a meeting note in three short bullet points." },
    [ordered]@{ sampleId = "routing-e2e-code-help"; expectedCategory = "code"; prompt = "Explain the difference between a Go map and a Go slice briefly." },
    [ordered]@{ sampleId = "routing-e2e-translation"; expectedCategory = "translation"; prompt = "Translate to English: The meeting starts at 3 PM today." },
    [ordered]@{ sampleId = "routing-e2e-support-refund"; expectedCategory = "support_refund"; prompt = "I want to cancel my previous order and check whether a refund is possible." },
    [ordered]@{ sampleId = "routing-e2e-reasoning"; expectedCategory = "reasoning"; prompt = "If A is faster than B and B is faster than C, who is the fastest?" }
)

Write-Host ""
Write-Host "GateLM v2.1 Routing Gateway E2E Report"
Write-Host "======================================="
Write-Host "gateway:        $GatewayBaseUrl"
Write-Host "samples:        $($cases.Count)"
Write-Host "report:         $reportPath"
Write-Host "raw response:   not stored"
Write-Host "credentials:    not stored"

if ($DescribeOnly) {
    Write-Host ""
    Write-Host "Describe-only mode. No Gateway request will be sent."
    Write-Host "Checks: Gateway healthz, chat completion, selected provider/model, routing/provider/cache outcome, latency."
    exit 0
}

New-Item -ItemType Directory -Force -Path $reportDirPath | Out-Null
Invoke-Healthz -BaseUrl $GatewayBaseUrl

$rows = New-Object System.Collections.Generic.List[object]
$latencies = New-Object System.Collections.Generic.List[double]
$successCount = 0

foreach ($case in $cases) {
    $requestId = "$($case.sampleId)-$timestamp"
    $body = [ordered]@{
        model = "auto"
        messages = @([ordered]@{ role = "user"; content = $case.prompt })
        temperature = 0.1
        max_tokens = $MaxTokens
        stream = $false
    } | ConvertTo-Json -Depth 8

    $headers = @{
        "Authorization" = "Bearer $ApiKey"
        "X-GateLM-App-Token" = $AppToken
        "X-GateLM-End-User-Id" = $EndUserId
        "X-GateLM-Feature-Id" = "routing-gateway-e2e"
        "X-GateLM-Request-Id" = $requestId
    }

    $statusCode = 0
    $payload = $null
    $responseHeaders = $null
    $errorMessage = $null
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri (Join-Url $GatewayBaseUrl "/v1/chat/completions") -Headers $headers -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 60
        $timer.Stop()
        $statusCode = [int]$response.StatusCode
        $responseHeaders = $response.Headers
        if (-not [string]::IsNullOrWhiteSpace([string]$response.Content)) {
            $payload = $response.Content | ConvertFrom-Json
        }
    }
    catch {
        $timer.Stop()
        $errorMessage = $_.Exception.Message
        $errorResponse = $_.Exception.Response
        if ($null -ne $errorResponse) {
            $statusCode = [int]$errorResponse.StatusCode
            $responseHeaders = $errorResponse.Headers
        }
    }

    $clientLatencyMs = [Math]::Round([double]$timer.Elapsed.TotalMilliseconds, 3)
    $latencies.Add($clientLatencyMs)

    $gateLm = Get-Property -Value $payload -Name "gate_lm"
    $domainOutcomes = Get-Property -Value $gateLm -Name "domainOutcomes"
    $routingOutcome = Get-PathValue -Value $domainOutcomes -Path @("routing", "outcome")
    $routingReason = Get-PathValue -Value $domainOutcomes -Path @("routing", "routingReason")
    $providerOutcome = Get-PathValue -Value $domainOutcomes -Path @("provider", "outcome")
    $cacheOutcome = Get-PathValue -Value $domainOutcomes -Path @("cache", "outcome")
    $budgetOutcome = Get-PathValue -Value $domainOutcomes -Path @("budget", "outcome")
    $terminalStatus = Get-Property -Value $gateLm -Name "terminalStatus"
    $gatewayLatencyMs = Get-Property -Value $gateLm -Name "latencyMs"
    $providerLatencyMs = Get-PathValue -Value $domainOutcomes -Path @("provider", "latencyMs")
    $selectedProvider = Get-Property -Value $gateLm -Name "selectedProvider"
    if ([string]::IsNullOrWhiteSpace([string]$selectedProvider)) { $selectedProvider = Get-HeaderValue -Headers $responseHeaders -Name "X-GateLM-Routed-Provider" }
    $selectedModel = Get-Property -Value $gateLm -Name "selectedModel"
    if ([string]::IsNullOrWhiteSpace([string]$selectedModel)) { $selectedModel = Get-HeaderValue -Headers $responseHeaders -Name "X-GateLM-Routed-Model" }

    $ok = $statusCode -ge 200 -and $statusCode -lt 300
    if ($ok) { $successCount += 1 }

    $row = [ordered]@{
        sampleId = $case.sampleId
        requestId = $requestId
        syntheticPrompt = $case.prompt
        expectedCategory = $case.expectedCategory
        statusCode = $statusCode
        ok = $ok
        terminalStatus = $terminalStatus
        selectedProvider = $selectedProvider
        selectedModel = $selectedModel
        routingOutcome = $routingOutcome
        routingReason = $routingReason
        providerOutcome = $providerOutcome
        cacheOutcome = $cacheOutcome
        budgetOutcome = $budgetOutcome
        clientLatencyMs = $clientLatencyMs
        gatewayLatencyMs = $gatewayLatencyMs
        providerLatencyMs = $providerLatencyMs
        errorMessage = $(if ($ok) { $null } else { $errorMessage })
    }
    $rows.Add($row)

    Write-Host ""
    Write-Host "- $($case.sampleId)"
    Write-Host "  status:   HTTP $statusCode"
    Write-Host "  provider: $selectedProvider"
    Write-Host "  model:    $selectedModel"
    Write-Host "  routing:  $routingOutcome / $routingReason"
    Write-Host "  provider outcome: $providerOutcome"
    Write-Host "  latency:  client $clientLatencyMs ms / gateway $gatewayLatencyMs ms / provider $providerLatencyMs ms"
}

$avgLatency = 0
if ($latencies.Count -gt 0) { $avgLatency = [Math]::Round(($latencies | Measure-Object -Average).Average, 3) }

$report = [ordered]@{
    title = "GateLM v2.1 Routing Gateway E2E Report"
    purpose = "Live Gateway path evidence for routing, provider execution, cache/provider outcomes, and observed latency."
    generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    gatewayBaseUrl = $GatewayBaseUrl
    totalSamples = $rows.Count
    successSamples = $successCount
    failedSamples = $rows.Count - $successCount
    latency = [ordered]@{
        avgMs = $avgLatency
        p50Ms = Get-Percentile -Values ([double[]]$latencies.ToArray()) -Percentile 50
        p95Ms = Get-Percentile -Values ([double[]]$latencies.ToArray()) -Percentile 95
        maxMs = Get-Percentile -Values ([double[]]$latencies.ToArray()) -Percentile 100
    }
    bySelectedProvider = New-Distribution -Rows $rows -PropertyName "selectedProvider"
    bySelectedModel = New-Distribution -Rows $rows -PropertyName "selectedModel"
    byRoutingReason = New-Distribution -Rows $rows -PropertyName "routingReason"
    byProviderOutcome = New-Distribution -Rows $rows -PropertyName "providerOutcome"
    byCacheOutcome = New-Distribution -Rows $rows -PropertyName "cacheOutcome"
    samples = $rows
    security = [ordered]@{
        rawResponseStored = $false
        credentialsStored = $false
        authorizationHeaderStored = $false
        providerKeyStored = $false
        promptsAreSynthetic = $true
    }
}

$reportJson = $report | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($reportPath, $reportJson, [System.Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $reportPath -Destination $latestPath -Force

Write-Host ""
Write-Host "Summary"
Write-Host "-------"
Write-Host "success samples:        $successCount / $($rows.Count)"
Write-Host "avg latency ms:         $avgLatency"
Write-Host "p50 latency ms:         $(Get-Percentile -Values ([double[]]$latencies.ToArray()) -Percentile 50)"
Write-Host "p95 latency ms:         $(Get-Percentile -Values ([double[]]$latencies.ToArray()) -Percentile 95)"
Write-Host "report:                 $reportPath"
Write-Host "latest:                 $latestPath"
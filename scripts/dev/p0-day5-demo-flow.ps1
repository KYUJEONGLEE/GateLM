Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

function Get-EnvOrDefault {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$DefaultValue
    )

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }
    return $value
}

function Join-Url {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function New-QueryString {
    param([Parameter(Mandatory = $true)][hashtable]$Values)

    $pairs = New-Object System.Collections.Generic.List[string]
    foreach ($key in ($Values.Keys | Sort-Object)) {
        $value = $Values[$key]
        if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
            continue
        }
        $encodedKey = [System.Uri]::EscapeDataString([string]$key)
        $encodedValue = [System.Uri]::EscapeDataString([string]$value)
        $pairs.Add("${encodedKey}=${encodedValue}")
    }
    return ($pairs -join "&")
}

function Invoke-DemoHttp {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [hashtable]$Headers = @{},
        [string]$Body = $null
    )

    $client = $null
    $request = $null
    $response = $null
    $requestHeaders = @{}
    $contentType = $null
    foreach ($key in $Headers.Keys) {
        if ($key -eq "Content-Type") {
            $contentType = [string]$Headers[$key]
            continue
        }
        $requestHeaders[$key] = [string]$Headers[$key]
    }

    try {
        $client = [System.Net.Http.HttpClient]::new()
        $httpMethod = [System.Net.Http.HttpMethod]::Get
        if ($Method -eq "POST") {
            $httpMethod = [System.Net.Http.HttpMethod]::Post
        }
        $request = [System.Net.Http.HttpRequestMessage]::new($httpMethod, $Uri)
        foreach ($key in $requestHeaders.Keys) {
            [void]$request.Headers.TryAddWithoutValidation($key, [string]$requestHeaders[$key])
        }
        if ($null -ne $Body) {
            if ([string]::IsNullOrWhiteSpace($contentType)) {
                $contentType = "application/json"
            }
            $request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, $contentType)
        }

        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $responseHeaders = @{}
        foreach ($header in $response.Headers.GetEnumerator()) {
            $responseHeaders[$header.Key] = ($header.Value -join ",")
        }
        foreach ($header in $response.Content.Headers.GetEnumerator()) {
            $responseHeaders[$header.Key] = ($header.Value -join ",")
        }

        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Body       = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            Headers    = $responseHeaders
        }
    }
    finally {
        if ($null -ne $response) {
            $response.Dispose()
        }
        if ($null -ne $request) {
            $request.Dispose()
        }
        if ($null -ne $client) {
            $client.Dispose()
        }
    }
}

function Get-HeaderValue {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Name
    )

    foreach ($key in $Response.Headers.Keys) {
        if ($key -ieq $Name) {
            return [string]$Response.Headers[$key]
        }
    }
    return ""
}

function Convert-JsonBody {
    param([Parameter(Mandatory = $true)][string]$Body)

    if ([string]::IsNullOrWhiteSpace($Body)) {
        throw "expected JSON response body"
    }
    return ($Body | ConvertFrom-Json)
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        $Expected,
        $Actual
    )

    if ($Expected -ne $Actual) {
        throw "$Name expected '$Expected' but got '$Actual'"
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Condition
    )

    if (-not $Condition) {
        throw "$Name expected true"
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Needle
    )

    if (-not $Text.Contains($Needle)) {
        throw "$Name expected to contain '$Needle' but got '$Text'"
    }
}

function Assert-NotContains {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Needle
    )

    if ($Text.Contains($Needle)) {
        throw "$Name must not contain '$Needle': '$Text'"
    }
}

function Assert-ArrayContains {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Values,
        [Parameter(Mandatory = $true)][string]$Expected
    )

    foreach ($value in @($Values)) {
        if ([string]$value -eq $Expected) {
            return
        }
    }
    throw "$Name expected to contain '$Expected' but got '$(@($Values) -join ',')'"
}

function Assert-NoForbiddenFields {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Body,
        [bool]$AllowRedactedPromptPreview = $false
    )

    $forbidden = @(
        "rawPrompt",
        "rawResponse",
        "authorizationHeader",
        "apiKeyPlaintext",
        "appTokenPlaintext",
        "providerApiKey",
        "rawProviderErrorBody",
        "metadata"
    )
    if (-not $AllowRedactedPromptPreview) {
        $forbidden += "redactedPromptPreview"
    }

    foreach ($field in $forbidden) {
        Assert-NotContains -Name "$Name forbidden field" -Text $Body -Needle $field
    }
}

function Reset-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/reset"
    $response = Invoke-DemoHttp -Method POST -Uri $uri -Headers @{ "Content-Type" = "application/json" } -Body "{}"
    Assert-Equal -Name "mock reset HTTP" -Expected 200 -Actual $response.StatusCode
}

function Get-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/stats"
    $response = Invoke-DemoHttp -Method GET -Uri $uri
    Assert-Equal -Name "mock stats HTTP" -Expected 200 -Actual $response.StatusCode
    return (Convert-JsonBody -Body $response.Body)
}

function Get-MockCallCount {
    param([Parameter(Mandatory = $true)]$Stats)

    $callsProperty = $Stats.PSObject.Properties["calls"]
    if ($null -ne $callsProperty) {
        return [int]$callsProperty.Value
    }

    $dataProperty = $Stats.PSObject.Properties["data"]
    if ($null -ne $dataProperty -and $null -ne $dataProperty.Value) {
        $totalCallsProperty = $dataProperty.Value.PSObject.Properties["totalCalls"]
        if ($null -ne $totalCallsProperty) {
            return [int]$totalCallsProperty.Value
        }
    }

    throw "mock stats response is missing calls or data.totalCalls"
}

function Invoke-GatewayChat {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$Feature,
        [string]$Model = "auto"
    )

    $headers = @{
        "Content-Type"          = "application/json"
        "Authorization"         = ("Bearer " + $ValidApiKey)
        "X-GateLM-App-Token"   = $ValidAppToken
        "X-GateLM-End-User-Id" = $EndUserId
        "X-GateLM-Feature-Id"  = $Feature
    }

    $payload = [ordered]@{
        model       = $Model
        messages    = @(
            [ordered]@{
                role    = "user"
                content = $Prompt
            }
        )
        temperature = 0.2
        max_tokens  = 128
        stream      = $false
    } | ConvertTo-Json -Depth 5

    $uri = Join-Url $GatewayBaseUrl "/v1/chat/completions"
    return Invoke-DemoHttp -Method POST -Uri $uri -Headers $headers -Body $payload
}

function Get-RequestId {
    param([Parameter(Mandatory = $true)]$Response)

    $requestId = Get-HeaderValue -Response $Response -Name "X-GateLM-Request-Id"
    if ([string]::IsNullOrWhiteSpace($requestId)) {
        throw "response is missing X-GateLM-Request-Id"
    }
    return $requestId
}

function Get-ProjectLogs {
    param(
        [string]$RequestId = $null,
        [int]$Limit = 50
    )

    $query = @{
        from  = $FromIso
        to    = $ToIso
        limit = [string]$Limit
    }
    if (-not [string]::IsNullOrWhiteSpace($RequestId)) {
        $query["requestId"] = $RequestId
    }

    $uri = (Join-Url $GatewayBaseUrl "/api/projects/$ProjectId/logs") + "?" + (New-QueryString -Values $query)
    $response = Invoke-DemoHttp -Method GET -Uri $uri
    Assert-Equal -Name "project logs HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-NoForbiddenFields -Name "project logs" -Body $response.Body
    return (Convert-JsonBody -Body $response.Body)
}

function Get-RequestDetailResponse {
    param([Parameter(Mandatory = $true)][string]$RequestId)

    $uri = Join-Url $GatewayBaseUrl "/api/llm-requests/$RequestId"
    return Invoke-DemoHttp -Method GET -Uri $uri
}

function Wait-RequestDetail {
    param([Parameter(Mandatory = $true)][string]$RequestId)

    $lastStatus = $null
    $lastBody = ""
    for ($i = 0; $i -lt 10; $i++) {
        $response = Get-RequestDetailResponse -RequestId $RequestId
        $lastStatus = $response.StatusCode
        $lastBody = $response.Body
        if ($response.StatusCode -eq 200) {
            Assert-NoForbiddenFields -Name "request detail" -Body $response.Body -AllowRedactedPromptPreview $true
            return (Convert-JsonBody -Body $response.Body)
        }
        Start-Sleep -Milliseconds 200
    }

    throw "request detail for $RequestId was not available; lastStatus=$lastStatus body=$lastBody"
}

function Assert-LogItem {
    param(
        [Parameter(Mandatory = $true)][string]$RequestId,
        [Parameter(Mandatory = $true)][string]$ExpectedStatus,
        [Parameter(Mandatory = $true)][string]$ExpectedCacheStatus
    )

    $logs = Get-ProjectLogs -RequestId $RequestId -Limit 20
    $items = @($logs.data)
    Assert-True -Name "log list contains $RequestId" -Condition ($items.Count -gt 0)
    $item = $items[0]
    Assert-Equal -Name "log item requestId" -Expected $RequestId -Actual ([string]$item.requestId)
    Assert-Equal -Name "log item status" -Expected $ExpectedStatus -Actual ([string]$item.status)
    Assert-Equal -Name "log item cacheStatus" -Expected $ExpectedCacheStatus -Actual ([string]$item.cacheStatus)
}

function Get-DashboardOverview {
    $query = @{
        from      = $FromIso
        to        = $ToIso
        projectId = $ProjectId
    }
    $uri = (Join-Url $GatewayBaseUrl "/api/dashboard/overview") + "?" + (New-QueryString -Values $query)
    $response = Invoke-DemoHttp -Method GET -Uri $uri
    Assert-Equal -Name "dashboard HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-NoForbiddenFields -Name "dashboard" -Body $response.Body
    return (Convert-JsonBody -Body $response.Body)
}

function Invoke-DemoCase {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Body
    )

    Write-Host ""
    Write-Host "== $Name =="
    try {
        & $Body
        Write-Host "result: PASS"
    }
    catch {
        Write-Host "result: FAIL"
        Write-Host $_.Exception.Message
        $script:Failures++
    }
}

$GatewayBaseUrl = Get-EnvOrDefault -Name "GATEWAY_BASE_URL" -DefaultValue "http://localhost:8080"
$MockProviderBaseUrl = Get-EnvOrDefault -Name "MOCK_PROVIDER_BASE_URL" -DefaultValue "http://localhost:8090"
$ValidApiKey = Get-EnvOrDefault -Name "GATELM_API_KEY" -DefaultValue "glm_api_test_redacted"
$ValidAppToken = Get-EnvOrDefault -Name "GATELM_APP_TOKEN" -DefaultValue "glm_app_token_test_redacted"
$ProjectId = Get-EnvOrDefault -Name "GATELM_DEMO_PROJECT_ID" -DefaultValue "00000000-0000-4000-8000-000000000200"
$EndUserId = Get-EnvOrDefault -Name "GATELM_END_USER_ID" -DefaultValue "user_demo_001"
$RunId = Get-Date -Format "yyyyMMddHHmmssfff"
$FromIso = (Get-Date).ToUniversalTime().AddMinutes(-10).ToString("yyyy-MM-ddTHH:mm:ssZ")
$ToIso = (Get-Date).ToUniversalTime().AddMinutes(20).ToString("yyyy-MM-ddTHH:mm:ssZ")
$Failures = 0

Write-Host "GateLM Day5 demo flow"
Write-Host "gateway:      $GatewayBaseUrl"
Write-Host "mockProvider: $MockProviderBaseUrl"
Write-Host "projectId:    $ProjectId"
Write-Host "endUserId:    $EndUserId"
Write-Host "range:        $FromIso -> $ToIso"
Write-Host "runId:        $RunId"

$script:SafeMissRequestId = ""
$script:SafeHitRequestId = ""
$script:RoutingRequestId = ""
$script:RedactionRequestId = ""
$script:BlockedRequestId = ""

Invoke-DemoCase -Name "safe request first pass then exact cache hit" -Body {
    Reset-MockStats
    $prompt = "Summarize this week's campaign performance for day5 demo $RunId."

    $first = Invoke-GatewayChat -Prompt $prompt -Feature "day5-safe-demo"
    Assert-Equal -Name "first safe HTTP" -Expected 200 -Actual $first.StatusCode
    Assert-Equal -Name "first safe cache header" -Expected "miss" -Actual (Get-HeaderValue -Response $first -Name "X-GateLM-Cache-Status")
    $script:SafeMissRequestId = Get-RequestId -Response $first
    Assert-Equal -Name "provider calls after first safe request" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $firstDetail = Wait-RequestDetail -RequestId $script:SafeMissRequestId
    Assert-Equal -Name "first detail status" -Expected "success" -Actual ([string]$firstDetail.data.status)
    Assert-Equal -Name "first detail cache status" -Expected "miss" -Actual ([string]$firstDetail.data.cache.cacheStatus)
    Assert-Equal -Name "first selected model" -Expected "mock-fast" -Actual ([string]$firstDetail.data.selectedModel)
    Assert-Equal -Name "first routing reason" -Expected "short_prompt_low_cost" -Actual ([string]$firstDetail.data.routing.routingReason)
    Assert-LogItem -RequestId $script:SafeMissRequestId -ExpectedStatus "success" -ExpectedCacheStatus "miss"

    $second = Invoke-GatewayChat -Prompt $prompt -Feature "day5-cache-demo"
    Assert-Equal -Name "second safe HTTP" -Expected 200 -Actual $second.StatusCode
    Assert-Equal -Name "second safe cache header" -Expected "hit" -Actual (Get-HeaderValue -Response $second -Name "X-GateLM-Cache-Status")
    $script:SafeHitRequestId = Get-RequestId -Response $second
    Assert-Equal -Name "provider calls after cache hit" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $secondDetail = Wait-RequestDetail -RequestId $script:SafeHitRequestId
    Assert-Equal -Name "second detail status" -Expected "cache_hit" -Actual ([string]$secondDetail.data.status)
    Assert-Equal -Name "second detail cache status" -Expected "hit" -Actual ([string]$secondDetail.data.cache.cacheStatus)
    Assert-Equal -Name "second detail cost" -Expected 0 -Actual ([int64]$secondDetail.data.cost.costMicroUsd)
    Assert-LogItem -RequestId $script:SafeHitRequestId -ExpectedStatus "cache_hit" -ExpectedCacheStatus "hit"
}

Invoke-DemoCase -Name "model auto short prompt routes to mock-fast" -Body {
    Reset-MockStats
    $prompt = "Give one short campaign insight for day5 routing $RunId."

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day5-routing-demo"
    Assert-Equal -Name "routing HTTP" -Expected 200 -Actual $response.StatusCode
    $script:RoutingRequestId = Get-RequestId -Response $response
    Assert-Equal -Name "provider calls after routing request" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $detail = Wait-RequestDetail -RequestId $script:RoutingRequestId
    Assert-Equal -Name "routing requested model" -Expected "auto" -Actual ([string]$detail.data.requestedModel)
    Assert-Equal -Name "routing selected model" -Expected "mock-fast" -Actual ([string]$detail.data.selectedModel)
    Assert-Equal -Name "routing reason" -Expected "short_prompt_low_cost" -Actual ([string]$detail.data.routing.routingReason)
    Assert-LogItem -RequestId $script:RoutingRequestId -ExpectedStatus "success" -ExpectedCacheStatus ([string]$detail.data.cache.cacheStatus)
}

Invoke-DemoCase -Name "email and phone are redacted before provider call" -Body {
    Reset-MockStats
    $rawEmail = "customer-$RunId@example.test"
    $rawPhone = "010-0000-1234"
    $prompt = "Draft a follow-up note for $rawEmail and call $rawPhone."

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day5-redaction-demo"
    Assert-Equal -Name "redacted HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-Equal -Name "redacted masking header" -Expected "redacted" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Masking-Action")
    Assert-NotContains -Name "redacted chat response email" -Text $response.Body -Needle $rawEmail
    Assert-NotContains -Name "redacted chat response phone" -Text $response.Body -Needle $rawPhone
    $script:RedactionRequestId = Get-RequestId -Response $response
    Assert-Equal -Name "provider calls after redacted request" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $detail = Wait-RequestDetail -RequestId $script:RedactionRequestId
    Assert-Equal -Name "redaction detail status" -Expected "success" -Actual ([string]$detail.data.status)
    Assert-Equal -Name "redaction masking action" -Expected "redacted" -Actual ([string]$detail.data.masking.maskingAction)
    Assert-ArrayContains -Name "redaction detected types" -Values $detail.data.masking.maskingDetectedTypes -Expected "email"
    Assert-ArrayContains -Name "redaction detected types" -Values $detail.data.masking.maskingDetectedTypes -Expected "phone_number"
    $preview = [string]$detail.data.masking.redactedPromptPreview
    Assert-Contains -Name "redacted detail preview" -Text $preview -Needle "[EMAIL_REDACTED]"
    Assert-Contains -Name "redacted detail preview" -Text $preview -Needle "[PHONE_NUMBER_REDACTED]"
    Assert-NotContains -Name "redacted detail preview email" -Text $preview -Needle $rawEmail
    Assert-NotContains -Name "redacted detail preview phone" -Text $preview -Needle $rawPhone
    Assert-NotContains -Name "redacted detail body email" -Text ($detail | ConvertTo-Json -Depth 20) -Needle $rawEmail
    Assert-NotContains -Name "redacted detail body phone" -Text ($detail | ConvertTo-Json -Depth 20) -Needle $rawPhone
    Assert-LogItem -RequestId $script:RedactionRequestId -ExpectedStatus "success" -ExpectedCacheStatus ([string]$detail.data.cache.cacheStatus)
}

Invoke-DemoCase -Name "credential-like marker is blocked without provider call" -Body {
    Reset-MockStats
    $marker = "test_secret_token_redacted_for_demo_only_$RunId"
    $prompt = "This message contains a synthetic credential marker: api_key=$marker"

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day5-block-demo"
    Assert-Equal -Name "blocked HTTP" -Expected 403 -Actual $response.StatusCode
    Assert-Equal -Name "blocked cache header" -Expected "bypass" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Cache-Status")
    Assert-NotContains -Name "blocked response marker" -Text $response.Body -Needle $marker
    $script:BlockedRequestId = Get-RequestId -Response $response
    Assert-Equal -Name "provider calls after blocked request" -Expected 0 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $detail = Wait-RequestDetail -RequestId $script:BlockedRequestId
    Assert-Equal -Name "blocked detail status" -Expected "blocked" -Actual ([string]$detail.data.status)
    Assert-Equal -Name "blocked detail HTTP" -Expected 403 -Actual ([int]$detail.data.httpStatus)
    Assert-Equal -Name "blocked detail error code" -Expected "sensitive_data_blocked" -Actual ([string]$detail.data.error.errorCode)
    Assert-Equal -Name "blocked detail masking action" -Expected "blocked" -Actual ([string]$detail.data.masking.maskingAction)
    Assert-Equal -Name "blocked detail cache status" -Expected "bypass" -Actual ([string]$detail.data.cache.cacheStatus)
    Assert-Equal -Name "blocked detail cost" -Expected 0 -Actual ([int64]$detail.data.cost.costMicroUsd)
    Assert-NotContains -Name "blocked detail body marker" -Text ($detail | ConvertTo-Json -Depth 20) -Needle $marker
    Assert-LogItem -RequestId $script:BlockedRequestId -ExpectedStatus "blocked" -ExpectedCacheStatus "bypass"
}

Invoke-DemoCase -Name "dashboard reflects Day5 log source" -Body {
    $dashboard = Get-DashboardOverview
    $totals = $dashboard.data.totals
    Assert-True -Name "dashboard totalRequests includes day5 flow" -Condition ([int64]$totals.totalRequests -ge 5)
    Assert-True -Name "dashboard successfulRequests includes success/cache_hit" -Condition ([int64]$totals.successfulRequests -ge 4)
    Assert-True -Name "dashboard blockedRequests includes blocked request" -Condition ([int64]$totals.blockedRequests -ge 1)
    Assert-True -Name "dashboard cacheHitRequests includes cache hit request" -Condition ([int64]$totals.cacheHitRequests -ge 1)
    Assert-True -Name "dashboard totalCostMicroUsd present" -Condition ($null -ne $totals.totalCostMicroUsd)

    foreach ($requestId in @($script:SafeMissRequestId, $script:SafeHitRequestId, $script:RoutingRequestId, $script:RedactionRequestId, $script:BlockedRequestId)) {
        Assert-True -Name "recorded requestId is not empty" -Condition (-not [string]::IsNullOrWhiteSpace($requestId))
        $logs = Get-ProjectLogs -RequestId $requestId -Limit 20
        $matching = @($logs.data | Where-Object { [string]$_.requestId -eq $requestId })
        Assert-True -Name "log list contains $requestId" -Condition ($matching.Count -gt 0)
    }
}

Write-Host ""
if ($Failures -gt 0) {
    Write-Host "Day5 demo flow failed: $Failures failure(s)"
    exit 1
}

Write-Host "Day5 demo flow passed"
Write-Host "requestIds:"
Write-Host "  safeMiss:  $script:SafeMissRequestId"
Write-Host "  cacheHit:  $script:SafeHitRequestId"
Write-Host "  routing:   $script:RoutingRequestId"
Write-Host "  redaction: $script:RedactionRequestId"
Write-Host "  blocked:   $script:BlockedRequestId"

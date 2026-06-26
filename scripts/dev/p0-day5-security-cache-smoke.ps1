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

function Invoke-SmokeHttp {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [hashtable]$Headers = @{},
        [string]$Body = $null
    )

    $requestHeaders = @{}
    $contentType = $null
    foreach ($key in $Headers.Keys) {
        if ($key -eq "Content-Type") {
            $contentType = [string]$Headers[$key]
            continue
        }
        $requestHeaders[$key] = [string]$Headers[$key]
    }

    $client = [System.Net.Http.HttpClient]::new()
    $httpMethod = [System.Net.Http.HttpMethod]::Get
    if ($Method -eq "POST") {
        $httpMethod = [System.Net.Http.HttpMethod]::Post
    }
    $request = [System.Net.Http.HttpRequestMessage]::new($httpMethod, $Uri)

    foreach ($key in $requestHeaders.Keys) {
        [void]$request.Headers.TryAddWithoutValidation($key, [string]$requestHeaders[$key])
    }
    if ($Method -eq "POST" -and $null -ne $Body) {
        if ([string]::IsNullOrWhiteSpace($contentType)) {
            $contentType = "application/json"
        }
        $request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, $contentType)
    }

    try {
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

    $items = @($Values)
    $matches = @($items | Where-Object { [string]$_ -eq $Expected })
    if ($matches.Count -eq 0) {
        throw "$Name expected to contain '$Expected' but got '$($items -join ",")'"
    }
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
        "fullRequestBody",
        "fullResponseBody",
        "authorizationHeader",
        "apiKeyPlaintext",
        "appTokenPlaintext",
        "providerApiKey",
        "rawProviderErrorBody",
        "maskingSampleRawValue",
        "cookie",
        "metadata"
    )
    if (-not $AllowRedactedPromptPreview) {
        $forbidden += "redactedPromptPreview"
    }

    foreach ($field in $forbidden) {
        Assert-NotContains -Name "$Name forbidden field" -Text $Body -Needle $field
    }
}

function Assert-BodyDoesNotExpose {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Body,
        [Parameter(Mandatory = $true)][string[]]$RawValues
    )

    foreach ($rawValue in $RawValues) {
        if ([string]::IsNullOrWhiteSpace($rawValue)) {
            continue
        }
        Assert-NotContains -Name "$Name raw value" -Text $Body -Needle $rawValue
    }
}

function Get-ErrorCode {
    param([Parameter(Mandatory = $true)][string]$Body)

    if ([string]::IsNullOrWhiteSpace($Body)) {
        return $null
    }

    try {
        $json = $Body | ConvertFrom-Json
        if ($null -ne $json.error -and $null -ne $json.error.code) {
            return [string]$json.error.code
        }
    }
    catch {
        return $null
    }

    return $null
}

function Invoke-HealthCheck {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Uri
    )

    $response = Invoke-SmokeHttp -Method GET -Uri $Uri
    Assert-Equal -Name "$Name HTTP" -Expected 200 -Actual $response.StatusCode
}

function Reset-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/reset"
    $response = Invoke-SmokeHttp -Method POST -Uri $uri -Headers @{ "Content-Type" = "application/json" } -Body "{}"
    Assert-Equal -Name "mock reset HTTP" -Expected 200 -Actual $response.StatusCode
}

function Get-MockStatsResponse {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/stats"
    $response = Invoke-SmokeHttp -Method GET -Uri $uri
    Assert-Equal -Name "mock stats HTTP" -Expected 200 -Actual $response.StatusCode
    return $response
}

function Get-MockStats {
    return (Convert-JsonBody -Body (Get-MockStatsResponse).Body)
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

function Get-LastMockCall {
    param([Parameter(Mandatory = $true)]$Stats)

    $dataProperty = $Stats.PSObject.Properties["data"]
    if ($null -eq $dataProperty -or $null -eq $dataProperty.Value) {
        throw "mock stats response is missing data"
    }

    $lastCalls = @($dataProperty.Value.lastCalls)
    if ($lastCalls.Count -eq 0) {
        throw "mock stats response has no lastCalls"
    }

    return $lastCalls[$lastCalls.Count - 1]
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
    return Invoke-SmokeHttp -Method POST -Uri $uri -Headers $headers -Body $payload
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
    $response = Invoke-SmokeHttp -Method GET -Uri $uri
    Assert-Equal -Name "project logs HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-NoForbiddenFields -Name "project logs" -Body $response.Body
    return (Convert-JsonBody -Body $response.Body)
}

function Get-RequestDetailResponse {
    param([Parameter(Mandatory = $true)][string]$RequestId)

    $uri = Join-Url $GatewayBaseUrl "/api/llm-requests/$RequestId"
    return Invoke-SmokeHttp -Method GET -Uri $uri
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

function Assert-BlockedRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$RawValue,
        [Parameter(Mandatory = $true)][string]$ExpectedDetectorType
    )

    Reset-MockStats
    $response = Invoke-GatewayChat -Prompt $Prompt -Feature "day5-block-demo"
    Assert-Equal -Name "$Name HTTP" -Expected 403 -Actual $response.StatusCode
    Assert-Equal -Name "$Name error code" -Expected "sensitive_data_blocked" -Actual (Get-ErrorCode -Body $response.Body)
    Assert-Equal -Name "$Name cache header" -Expected "bypass" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Cache-Status")
    Assert-Equal -Name "$Name masking header" -Expected "blocked" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Masking-Action")
    Assert-BodyDoesNotExpose -Name "$Name response" -Body $response.Body -RawValues @($RawValue)
    $requestId = Get-RequestId -Response $response

    $stats = Get-MockStats
    Assert-Equal -Name "$Name provider calls" -Expected 0 -Actual (Get-MockCallCount -Stats $stats)

    $detail = Wait-RequestDetail -RequestId $requestId
    Assert-Equal -Name "$Name detail status" -Expected "blocked" -Actual ([string]$detail.data.status)
    Assert-Equal -Name "$Name detail HTTP" -Expected 403 -Actual ([int]$detail.data.httpStatus)
    Assert-Equal -Name "$Name detail error code" -Expected "sensitive_data_blocked" -Actual ([string]$detail.data.error.errorCode)
    Assert-Equal -Name "$Name detail cache status" -Expected "bypass" -Actual ([string]$detail.data.cache.cacheStatus)
    Assert-Equal -Name "$Name detail cache type" -Expected "none" -Actual ([string]$detail.data.cache.cacheType)
    Assert-Equal -Name "$Name detail cost" -Expected 0 -Actual ([int64]$detail.data.cost.costMicroUsd)
    Assert-Equal -Name "$Name detail masking action" -Expected "blocked" -Actual ([string]$detail.data.masking.maskingAction)
    Assert-ArrayContains -Name "$Name detected types" -Values $detail.data.masking.maskingDetectedTypes -Expected $ExpectedDetectorType
    Assert-BodyDoesNotExpose -Name "$Name detail" -Body ($detail | ConvertTo-Json -Depth 20) -RawValues @($RawValue)
    Assert-LogItem -RequestId $requestId -ExpectedStatus "blocked" -ExpectedCacheStatus "bypass"
}

function Invoke-SmokeCase {
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
$EndUserId = Get-EnvOrDefault -Name "GATELM_DEMO_END_USER_ID" -DefaultValue "user_demo_001"
$RunId = Get-Date -Format "yyyyMMddHHmmssfff"
$FromIso = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString("yyyy-MM-ddTHH:mm:ssZ")
$ToIso = (Get-Date).ToUniversalTime().AddMinutes(15).ToString("yyyy-MM-ddTHH:mm:ssZ")
$Failures = 0

Write-Host "GateLM Day5 Role D security/cache smoke"
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

Invoke-SmokeCase -Name "baseline health checks" -Body {
    Invoke-HealthCheck -Name "gateway healthz" -Uri (Join-Url $GatewayBaseUrl "/healthz")
    Invoke-HealthCheck -Name "gateway readyz" -Uri (Join-Url $GatewayBaseUrl "/readyz")
    Invoke-HealthCheck -Name "mock provider healthz" -Uri (Join-Url $MockProviderBaseUrl "/healthz")
}

Invoke-SmokeCase -Name "day5 safe request miss then cache hit" -Body {
    Reset-MockStats
    $prompt = "Write a short safe refund response for day5 smoke $RunId."

    $first = Invoke-GatewayChat -Prompt $prompt -Feature "day5-safe-demo"
    Assert-Equal -Name "first safe HTTP" -Expected 200 -Actual $first.StatusCode
    Assert-Equal -Name "first safe cache header" -Expected "miss" -Actual (Get-HeaderValue -Response $first -Name "X-GateLM-Cache-Status")
    Assert-BodyDoesNotExpose -Name "first safe response" -Body $first.Body -RawValues @($ValidApiKey, $ValidAppToken)
    $script:SafeMissRequestId = Get-RequestId -Response $first
    Assert-Equal -Name "provider calls after first safe request" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $firstDetail = Wait-RequestDetail -RequestId $script:SafeMissRequestId
    Assert-Equal -Name "first detail status" -Expected "success" -Actual ([string]$firstDetail.data.status)
    Assert-Equal -Name "first detail cache status" -Expected "miss" -Actual ([string]$firstDetail.data.cache.cacheStatus)
    Assert-Equal -Name "first detail cache type" -Expected "exact" -Actual ([string]$firstDetail.data.cache.cacheType)
    Assert-LogItem -RequestId $script:SafeMissRequestId -ExpectedStatus "success" -ExpectedCacheStatus "miss"

    $second = Invoke-GatewayChat -Prompt $prompt -Feature "day5-cache-demo"
    Assert-Equal -Name "second safe HTTP" -Expected 200 -Actual $second.StatusCode
    Assert-Equal -Name "second safe cache header" -Expected "hit" -Actual (Get-HeaderValue -Response $second -Name "X-GateLM-Cache-Status")
    Assert-BodyDoesNotExpose -Name "second safe response" -Body $second.Body -RawValues @($ValidApiKey, $ValidAppToken)
    $script:SafeHitRequestId = Get-RequestId -Response $second
    Assert-Equal -Name "provider calls after cache hit" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $secondDetail = Wait-RequestDetail -RequestId $script:SafeHitRequestId
    Assert-Equal -Name "second detail status" -Expected "cache_hit" -Actual ([string]$secondDetail.data.status)
    Assert-Equal -Name "second detail cache status" -Expected "hit" -Actual ([string]$secondDetail.data.cache.cacheStatus)
    Assert-Equal -Name "second detail cache type" -Expected "exact" -Actual ([string]$secondDetail.data.cache.cacheType)
    Assert-Equal -Name "second detail cache hit request id" -Expected $script:SafeMissRequestId -Actual ([string]$secondDetail.data.cache.cacheHitRequestId)
    Assert-Equal -Name "second detail cost" -Expected 0 -Actual ([int64]$secondDetail.data.cost.costMicroUsd)
    Assert-LogItem -RequestId $script:SafeHitRequestId -ExpectedStatus "cache_hit" -ExpectedCacheStatus "hit"
}

Invoke-SmokeCase -Name "day5 model auto short prompt routes to mock-fast" -Body {
    Reset-MockStats
    $response = Invoke-GatewayChat -Prompt "Summarize campaign ROI for day5 $RunId." -Feature "day5-routing-demo"
    Assert-Equal -Name "routing HTTP" -Expected 200 -Actual $response.StatusCode
    $script:RoutingRequestId = Get-RequestId -Response $response
    Assert-Equal -Name "routing provider calls" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $detail = Wait-RequestDetail -RequestId $script:RoutingRequestId
    Assert-Equal -Name "routing requested model" -Expected "auto" -Actual ([string]$detail.data.requestedModel)
    Assert-Equal -Name "routing selected model" -Expected "mock-fast" -Actual ([string]$detail.data.selectedModel)
    Assert-Equal -Name "routing nested selected model" -Expected "mock-fast" -Actual ([string]$detail.data.routing.selectedModel)
    Assert-Equal -Name "routing reason" -Expected "short_prompt_low_cost" -Actual ([string]$detail.data.routing.routingReason)
    Assert-LogItem -RequestId $script:RoutingRequestId -ExpectedStatus "success" -ExpectedCacheStatus ([string]$detail.data.cache.cacheStatus)
}

Invoke-SmokeCase -Name "day5 redaction applies before provider and log detail" -Body {
    Reset-MockStats
    $rawEmail = "day5-$RunId@example.invalid"
    $rawPhone = "010-0000-1234"
    $prompt = "Send a safe follow-up for day5 $RunId to $rawEmail and call $rawPhone."

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day5-redaction-demo"
    Assert-Equal -Name "redaction HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-Equal -Name "redaction masking header" -Expected "redacted" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Masking-Action")
    Assert-BodyDoesNotExpose -Name "redaction response" -Body $response.Body -RawValues @($rawEmail, $rawPhone, $ValidApiKey, $ValidAppToken)
    $script:RedactionRequestId = Get-RequestId -Response $response

    $statsResponse = Get-MockStatsResponse
    $stats = Convert-JsonBody -Body $statsResponse.Body
    Assert-Equal -Name "provider calls after redaction" -Expected 1 -Actual (Get-MockCallCount -Stats $stats)
    Assert-BodyDoesNotExpose -Name "mock stats" -Body $statsResponse.Body -RawValues @($rawEmail, $rawPhone)

    $lastCall = Get-LastMockCall -Stats $stats
    $preview = [string]$lastCall.redactedPromptPreview
    Assert-Contains -Name "mock redacted preview" -Text $preview -Needle "[EMAIL_REDACTED]"
    Assert-Contains -Name "mock redacted preview" -Text $preview -Needle "[PHONE_NUMBER_REDACTED]"
    Assert-NotContains -Name "mock redacted preview" -Text $preview -Needle "[UNREDACTED_PROVIDER_INPUT_BLOCKED_FROM_STATS]"
    Assert-NotContains -Name "mock redacted preview raw email" -Text $preview -Needle $rawEmail
    Assert-NotContains -Name "mock redacted preview raw phone" -Text $preview -Needle $rawPhone

    $detail = Wait-RequestDetail -RequestId $script:RedactionRequestId
    Assert-Equal -Name "redaction detail status" -Expected "success" -Actual ([string]$detail.data.status)
    Assert-Equal -Name "redaction detail masking action" -Expected "redacted" -Actual ([string]$detail.data.masking.maskingAction)
    Assert-ArrayContains -Name "redaction detail detected types" -Values $detail.data.masking.maskingDetectedTypes -Expected "email"
    Assert-ArrayContains -Name "redaction detail detected types" -Values $detail.data.masking.maskingDetectedTypes -Expected "phone_number"
    $detailPreview = [string]$detail.data.masking.redactedPromptPreview
    Assert-Contains -Name "redaction detail preview" -Text $detailPreview -Needle "[EMAIL_REDACTED]"
    Assert-Contains -Name "redaction detail preview" -Text $detailPreview -Needle "[PHONE_NUMBER_REDACTED]"
    Assert-BodyDoesNotExpose -Name "redaction detail" -Body ($detail | ConvertTo-Json -Depth 20) -RawValues @($rawEmail, $rawPhone)
    Assert-LogItem -RequestId $script:RedactionRequestId -ExpectedStatus "success" -ExpectedCacheStatus ([string]$detail.data.cache.cacheStatus)
}

Invoke-SmokeCase -Name "day5 API-key-like marker blocks before cache and provider" -Body {
    $apiKeyMarker = ("api" + "_key=" + "test_secret_token_redacted_for_demo_only_" + $RunId)
    Assert-BlockedRequest `
        -Name "api key block" `
        -Prompt "This day5 request includes a synthetic credential marker: $apiKeyMarker" `
        -RawValue $apiKeyMarker `
        -ExpectedDetectorType "api_key"
}

Invoke-SmokeCase -Name "day5 JWT marker blocks before cache and provider" -Body {
    $jwtMarker = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJkYXk1In0.signature_for_day5_$RunId"
    Assert-BlockedRequest `
        -Name "jwt block" `
        -Prompt "This day5 request includes a synthetic JWT marker: $jwtMarker" `
        -RawValue $jwtMarker `
        -ExpectedDetectorType "jwt"
}

Invoke-SmokeCase -Name "day5 RRN marker blocks before cache and provider" -Body {
    $rrnMarker = "000101-3000000"
    Assert-BlockedRequest `
        -Name "rrn block" `
        -Prompt "This day5 request includes a synthetic resident registration marker: $rrnMarker" `
        -RawValue $rrnMarker `
        -ExpectedDetectorType "resident_registration_number"
}

Write-Host ""
if ($Failures -gt 0) {
    Write-Host "Day5 Role D security/cache smoke failed: $Failures failure(s)"
    exit 1
}

Write-Host "Day5 Role D security/cache smoke passed"
Write-Host "safeMissRequestId:   $script:SafeMissRequestId"
Write-Host "safeHitRequestId:    $script:SafeHitRequestId"
Write-Host "routingRequestId:    $script:RoutingRequestId"
Write-Host "redactionRequestId:  $script:RedactionRequestId"

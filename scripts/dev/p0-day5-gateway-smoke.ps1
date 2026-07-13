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

function Get-FirstEnvOrDefault {
    param(
        [Parameter(Mandatory = $true)][string[]]$Names,
        [Parameter(Mandatory = $true)][string]$DefaultValue
    )

    foreach ($name in $Names) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }
    return $DefaultValue
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
        $responseBody = ""
        if ($null -ne $response.Content) {
            foreach ($header in $response.Content.Headers.GetEnumerator()) {
                $responseHeaders[$header.Key] = ($header.Value -join ",")
            }
            $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        }

        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Body       = $responseBody
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
        throw "$Name expected to contain '$Needle'"
    }
}

function Assert-NotContains {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Needle
    )

    if ($Text.Contains($Needle)) {
        throw "$Name must not contain '$Needle'"
    }
}

function Assert-NoForbiddenFields {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Body,
        [bool]$AllowRedactedPromptPreview = $false
    )

    $forbidden = @(
        ("raw" + "Prompt"),
        ("raw" + "Response"),
        ("authorization" + "Header"),
        ("apiKey" + "Plaintext"),
        ("appToken" + "Plaintext"),
        ("provider" + "ApiKey"),
        ("rawProvider" + "ErrorBody")
    )
    if (-not $AllowRedactedPromptPreview) {
        $forbidden += "redactedPromptPreview"
    }

    foreach ($field in $forbidden) {
        Assert-NotContains -Name "$Name forbidden field" -Text $Body -Needle $field
    }
}

function Convert-ToSafeArray {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }
    return @($Value)
}

function New-SmokeTag {
    $chars = "abcdefghijkmnopqrstuvwxyz".ToCharArray()
    $builder = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt 10; $i++) {
        [void]$builder.Append($chars[(Get-Random -Minimum 0 -Maximum $chars.Length)])
    }
    return $builder.ToString()
}

function New-GatewayHeaders {
    param([string]$Feature = "day5-demo")

    return @{
        "Content-Type"          = "application/json"
        "Authorization"         = ("Bearer " + $ValidApiKey)
        "X-GateLM-App-Token"   = $ValidAppToken
        "X-GateLM-End-User-Id" = "user_demo_001"
        "X-GateLM-Feature-Id"  = $Feature
    }
}

function Reset-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/reset"
    $response = Invoke-SmokeHttp -Method POST -Uri $uri -Headers @{ "Content-Type" = "application/json" } -Body "{}"
    Assert-Equal -Name "mock reset HTTP" -Expected 200 -Actual $response.StatusCode
}

function Get-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/stats"
    $response = Invoke-SmokeHttp -Method GET -Uri $uri
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

function Get-LastMockCall {
    param([Parameter(Mandatory = $true)]$Stats)

    $dataProperty = $Stats.PSObject.Properties["data"]
    if ($null -eq $dataProperty -or $null -eq $dataProperty.Value) {
        throw "mock stats response is missing data"
    }

    $lastCalls = @(Convert-ToSafeArray -Value $dataProperty.Value.lastCalls)
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
    return Invoke-SmokeHttp -Method POST -Uri $uri -Headers (New-GatewayHeaders -Feature $Feature) -Body $payload
}

function Get-RequestId {
    param([Parameter(Mandatory = $true)]$Response)

    $requestId = Get-HeaderValue -Response $Response -Name "X-GateLM-Request-Id"
    if ([string]::IsNullOrWhiteSpace($requestId)) {
        throw "response is missing X-GateLM-Request-Id"
    }
    return $requestId
}

function Get-GateLMMetadata {
    param([Parameter(Mandatory = $true)]$Response)

    $body = Convert-JsonBody -Body $Response.Body
    if ($null -eq $body.gate_lm) {
        throw "response is missing gate_lm metadata"
    }
    return $body.gate_lm
}

function Get-ErrorCode {
    param([string]$Body)

    if ([string]::IsNullOrWhiteSpace($Body)) {
        return ""
    }

    try {
        $json = $Body | ConvertFrom-Json
        if ($null -ne $json.error -and $null -ne $json.error.code) {
            return [string]$json.error.code
        }
    }
    catch {
        return ""
    }

    return ""
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
    for ($i = 0; $i -lt 10; $i++) {
        $response = Get-RequestDetailResponse -RequestId $RequestId
        $lastStatus = $response.StatusCode
        if ($response.StatusCode -eq 200) {
            Assert-NoForbiddenFields -Name "request detail" -Body $response.Body -AllowRedactedPromptPreview $true
            return (Convert-JsonBody -Body $response.Body)
        }
        Start-Sleep -Milliseconds 200
    }

    throw "request detail for $RequestId was not available; lastStatus=$lastStatus"
}

function Assert-LogItem {
    param(
        [Parameter(Mandatory = $true)][string]$RequestId,
        [Parameter(Mandatory = $true)][string]$ExpectedStatus,
        [Parameter(Mandatory = $true)][string]$ExpectedCacheStatus
    )

    $logs = Get-ProjectLogs -RequestId $RequestId -Limit 20
    $items = @(Convert-ToSafeArray -Value $logs.data)
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
    $response = Invoke-SmokeHttp -Method GET -Uri $uri
    Assert-Equal -Name "dashboard HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-NoForbiddenFields -Name "dashboard" -Body $response.Body
    return (Convert-JsonBody -Body $response.Body)
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
$ValidApiKey = Get-FirstEnvOrDefault -Names @("GATELM_DEMO_API_KEY", "GATELM_API_KEY") -DefaultValue "glm_api_test_redacted"
$ValidAppToken = Get-FirstEnvOrDefault -Names @("GATELM_DEMO_APP_TOKEN", "GATELM_APP_TOKEN") -DefaultValue "glm_app_token_test_redacted"
$ProjectId = Get-EnvOrDefault -Name "GATELM_DEMO_PROJECT_ID" -DefaultValue "00000000-0000-4000-8000-000000000200"
$RunTag = New-SmokeTag
$FromIso = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString("yyyy-MM-ddTHH:mm:ssZ")
$ToIso = (Get-Date).ToUniversalTime().AddMinutes(15).ToString("yyyy-MM-ddTHH:mm:ssZ")
$Failures = 0

Write-Host "GateLM Day5 Gateway smoke"
Write-Host "gateway:      $GatewayBaseUrl"
Write-Host "mockProvider: $MockProviderBaseUrl"
Write-Host "projectId:    $ProjectId"
Write-Host "range:        $FromIso -> $ToIso"
Write-Host "runTag:       $RunTag"

$script:SafeMissRequestId = ""
$script:SafeHitRequestId = ""
$script:RedactionRequestId = ""
$script:BlockedRequestId = ""

Invoke-SmokeCase -Name "health readiness and model catalog" -Body {
    $health = Invoke-SmokeHttp -Method GET -Uri (Join-Url $GatewayBaseUrl "/healthz")
    Assert-Equal -Name "health HTTP" -Expected 200 -Actual $health.StatusCode
    Assert-Equal -Name "health status" -Expected "ok" -Actual ([string](Convert-JsonBody -Body $health.Body).status)

    $ready = Invoke-SmokeHttp -Method GET -Uri (Join-Url $GatewayBaseUrl "/readyz")
    Assert-Equal -Name "ready HTTP" -Expected 200 -Actual $ready.StatusCode

    $models = Invoke-SmokeHttp -Method GET -Uri (Join-Url $GatewayBaseUrl "/v1/models") -Headers (New-GatewayHeaders -Feature "day5-models-demo")
    Assert-Equal -Name "models HTTP" -Expected 200 -Actual $models.StatusCode
    $modelBody = Convert-JsonBody -Body $models.Body
    $modelIds = @($modelBody.data | ForEach-Object { [string]$_.id })
    Assert-True -Name "models include mock-fast" -Condition ($modelIds -contains "mock-fast")
    Assert-True -Name "models include mock-balanced" -Condition ($modelIds -contains "mock-balanced")
}

Invoke-SmokeCase -Name "safe request miss then cache hit without provider recall" -Body {
    Reset-MockStats
    $prompt = "Write a short safe refund response for day five gateway smoke $RunTag."

    $first = Invoke-GatewayChat -Prompt $prompt -Feature "day5-safe-demo"
    Assert-Equal -Name "first safe HTTP" -Expected 200 -Actual $first.StatusCode
    Assert-Equal -Name "first safe cache header" -Expected "miss" -Actual (Get-HeaderValue -Response $first -Name "X-GateLM-Cache-Status")
    Assert-Equal -Name "first safe masking header" -Expected "none" -Actual (Get-HeaderValue -Response $first -Name "X-GateLM-Masking-Action")
    $script:SafeMissRequestId = Get-RequestId -Response $first
    $firstMeta = Get-GateLMMetadata -Response $first
    Assert-Equal -Name "first requested model" -Expected "auto" -Actual ([string]$firstMeta.requestedModel)
    Assert-Equal -Name "first execution mode" -Expected "mock" -Actual ([string]$firstMeta.executionMode)
    Assert-Equal -Name "first routing reason" -Expected "category_difficulty_matrix" -Actual ([string]$firstMeta.routingReason)
    Assert-Equal -Name "provider calls after first safe request" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $firstDetail = Wait-RequestDetail -RequestId $script:SafeMissRequestId
    Assert-Equal -Name "first detail status" -Expected "success" -Actual ([string]$firstDetail.data.status)
    Assert-Equal -Name "first detail cache status" -Expected "miss" -Actual ([string]$firstDetail.data.cache.cacheStatus)
    Assert-Equal -Name "first detail category" -Expected "general" -Actual ([string]$firstDetail.data.routing.category)
    Assert-Equal -Name "first detail difficulty" -Expected "simple" -Actual ([string]$firstDetail.data.routing.difficulty)
    Assert-Equal -Name "first detail routing reason" -Expected "category_difficulty_matrix" -Actual ([string]$firstDetail.data.routing.routingReason)
    Assert-Equal -Name "first detail provider attempt model" -Expected "mock-balanced" -Actual ([string]$firstDetail.data.providerAttempt.modelId)
    Assert-LogItem -RequestId $script:SafeMissRequestId -ExpectedStatus "success" -ExpectedCacheStatus "miss"

    $second = Invoke-GatewayChat -Prompt $prompt -Feature "day5-cache-demo"
    Assert-Equal -Name "second safe HTTP" -Expected 200 -Actual $second.StatusCode
    Assert-Equal -Name "second safe cache header" -Expected "hit" -Actual (Get-HeaderValue -Response $second -Name "X-GateLM-Cache-Status")
    $script:SafeHitRequestId = Get-RequestId -Response $second
    $secondMeta = Get-GateLMMetadata -Response $second
    Assert-Equal -Name "second cache metadata" -Expected "hit" -Actual ([string]$secondMeta.cacheStatus)
    Assert-Equal -Name "provider calls after cache hit" -Expected 1 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $secondDetail = Wait-RequestDetail -RequestId $script:SafeHitRequestId
    Assert-Equal -Name "second detail status" -Expected "success" -Actual ([string]$secondDetail.data.status)
    Assert-Equal -Name "second detail cache status" -Expected "hit" -Actual ([string]$secondDetail.data.cache.cacheStatus)
    Assert-Equal -Name "second detail cost" -Expected 0 -Actual ([int64]$secondDetail.data.cost.costMicroUsd)
    Assert-LogItem -RequestId $script:SafeHitRequestId -ExpectedStatus "success" -ExpectedCacheStatus "hit"
}

Invoke-SmokeCase -Name "redaction happens before provider and detail stays redacted" -Body {
    Reset-MockStats
    $rawEmail = "day5-$RunTag@example.invalid"
    $rawPhone = "010-0000-1234"
    $prompt = "Send a safe follow up note to $rawEmail and call $rawPhone."

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day5-redaction-demo"
    Assert-Equal -Name "redacted HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-Equal -Name "redacted masking header" -Expected "redacted" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Masking-Action")
    $script:RedactionRequestId = Get-RequestId -Response $response
    $redactionMeta = Get-GateLMMetadata -Response $response
    Assert-Equal -Name "redacted metadata action" -Expected "redacted" -Actual ([string]$redactionMeta.maskingAction)

    $stats = Get-MockStats
    Assert-Equal -Name "provider calls after redacted request" -Expected 1 -Actual (Get-MockCallCount -Stats $stats)
    $last = Get-LastMockCall -Stats $stats
    $providerPreview = [string]$last.redactedPromptPreview
    Assert-Contains -Name "provider preview email" -Text $providerPreview -Needle "[EMAIL_REDACTED]"
    Assert-Contains -Name "provider preview phone" -Text $providerPreview -Needle "[PHONE_NUMBER_REDACTED]"
    Assert-NotContains -Name "provider preview raw email" -Text $providerPreview -Needle $rawEmail
    Assert-NotContains -Name "provider preview raw phone" -Text $providerPreview -Needle $rawPhone
    Assert-NotContains -Name "provider preview guard marker" -Text $providerPreview -Needle "[UNREDACTED_PROVIDER_INPUT_BLOCKED_FROM_STATS]"

    $detail = Wait-RequestDetail -RequestId $script:RedactionRequestId
    Assert-Equal -Name "redaction detail status" -Expected "success" -Actual ([string]$detail.data.status)
    Assert-Equal -Name "redaction masking action" -Expected "redacted" -Actual ([string]$detail.data.masking.maskingAction)
    $detailBody = $detail | ConvertTo-Json -Depth 20
    Assert-Contains -Name "redaction detail email placeholder" -Text $detailBody -Needle "[EMAIL_REDACTED]"
    Assert-Contains -Name "redaction detail phone placeholder" -Text $detailBody -Needle "[PHONE_NUMBER_REDACTED]"
    Assert-NotContains -Name "redaction detail raw email" -Text $detailBody -Needle $rawEmail
    Assert-NotContains -Name "redaction detail raw phone" -Text $detailBody -Needle $rawPhone
    Assert-LogItem -RequestId $script:RedactionRequestId -ExpectedStatus "success" -ExpectedCacheStatus ([string]$detail.data.cache.cacheStatus)
}

Invoke-SmokeCase -Name "credential-like content blocks before provider" -Body {
    Reset-MockStats
    $prompt = "This message contains a credential-like placeholder: api_key=test_secret_token_redacted_for_demo_only"

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day5-block-demo"
    Assert-Equal -Name "blocked HTTP" -Expected 403 -Actual $response.StatusCode
    Assert-Equal -Name "blocked error code" -Expected "sensitive_data_blocked" -Actual (Get-ErrorCode -Body $response.Body)
    Assert-Equal -Name "blocked cache header" -Expected "bypass" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Cache-Status")
    Assert-Equal -Name "blocked masking header" -Expected "blocked" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Masking-Action")
    $script:BlockedRequestId = Get-RequestId -Response $response
    Assert-Equal -Name "provider calls after blocked request" -Expected 0 -Actual (Get-MockCallCount -Stats (Get-MockStats))

    $detail = Wait-RequestDetail -RequestId $script:BlockedRequestId
    Assert-Equal -Name "blocked detail status" -Expected "blocked" -Actual ([string]$detail.data.status)
    Assert-Equal -Name "blocked detail HTTP" -Expected 403 -Actual ([int]$detail.data.httpStatus)
    Assert-Equal -Name "blocked detail error code" -Expected "sensitive_data_blocked" -Actual ([string]$detail.data.error.errorCode)
    Assert-Equal -Name "blocked detail cache status" -Expected "bypass" -Actual ([string]$detail.data.cache.cacheStatus)
    Assert-Equal -Name "blocked detail masking action" -Expected "blocked" -Actual ([string]$detail.data.masking.maskingAction)
    Assert-Equal -Name "blocked detail cost" -Expected 0 -Actual ([int64]$detail.data.cost.costMicroUsd)
    Assert-LogItem -RequestId $script:BlockedRequestId -ExpectedStatus "blocked" -ExpectedCacheStatus "bypass"
}

Invoke-SmokeCase -Name "dashboard and log list include day5 request ids" -Body {
    $dashboard = Get-DashboardOverview
    $totals = $dashboard.data.totals
    Assert-True -Name "dashboard totalRequests includes smoke requests" -Condition ([int64]$totals.totalRequests -ge 4)
    Assert-True -Name "dashboard successfulRequests includes successful cache hit" -Condition ([int64]$totals.successfulRequests -ge 3)
    Assert-True -Name "dashboard blockedRequests includes blocked smoke" -Condition ([int64]$totals.blockedRequests -ge 1)
    Assert-True -Name "dashboard cacheHitRequests includes cache hit smoke" -Condition ([int64]$totals.cacheHitRequests -ge 1)

    $logs = Get-ProjectLogs -Limit 100
    $logItems = @(Convert-ToSafeArray -Value $logs.data)
    foreach ($requestId in @($script:SafeMissRequestId, $script:SafeHitRequestId, $script:RedactionRequestId, $script:BlockedRequestId)) {
        $matching = @($logItems | Where-Object { [string]$_.requestId -eq $requestId })
        Assert-True -Name "project log list contains $requestId" -Condition ($matching.Count -gt 0)
    }
}

Write-Host ""
if ($Failures -gt 0) {
    Write-Host "Day5 Gateway smoke failed: $Failures failure(s)"
    exit 1
}

Write-Host "Day5 Gateway smoke passed"

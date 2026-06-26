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

function Invoke-SmokeHttp {
    param(
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
    $method = [System.Net.Http.HttpMethod]::Get
    if (-not [string]::IsNullOrEmpty($Body)) {
        $method = [System.Net.Http.HttpMethod]::Post
    }
    $request = [System.Net.Http.HttpRequestMessage]::new($method, $Uri)

    foreach ($key in $requestHeaders.Keys) {
        [void]$request.Headers.TryAddWithoutValidation($key, [string]$requestHeaders[$key])
    }
    if (-not [string]::IsNullOrEmpty($Body)) {
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

    $value = $Response.Headers[$Name]
    if ($null -eq $value) {
        return ""
    }
    return [string]$value
}

function Get-ErrorCode {
    param([string]$Body)

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

function Reset-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/reset"
    $response = Invoke-SmokeHttp -Uri $uri -Headers @{ "Content-Type" = "application/json" } -Body "{}"
    Assert-Equal -Name "mock reset HTTP" -Expected 200 -Actual $response.StatusCode
}

function Get-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/stats"
    $response = Invoke-SmokeHttp -Uri $uri
    Assert-Equal -Name "mock stats HTTP" -Expected 200 -Actual $response.StatusCode
    return ($response.Body | ConvertFrom-Json)
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
        [Parameter(Mandatory = $true)][string]$Feature
    )

    $headers = @{
        "Content-Type"          = "application/json"
        "Authorization"         = ("Bearer " + $ValidApiKey)
        "X-GateLM-App-Token"   = $ValidAppToken
        "X-GateLM-End-User-Id" = "user_demo_001"
        "X-GateLM-Feature-Id"  = $Feature
    }

    $payload = [ordered]@{
        model       = "auto"
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
    return Invoke-SmokeHttp -Uri $uri -Headers $headers -Body $payload
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
$RunId = Get-Date -Format "yyyyMMddHHmmssfff"
$Failures = 0

Write-Host "GateLM Day3 safety/cache smoke"
Write-Host "gateway:      $GatewayBaseUrl"
Write-Host "mockProvider: $MockProviderBaseUrl"
Write-Host "runId:        $RunId"

Invoke-SmokeCase -Name "safe request miss then hit" -Body {
    Reset-MockStats
    $prompt = "Write a short safe refund response for smoke $RunId."

    $first = Invoke-GatewayChat -Prompt $prompt -Feature "day3-cache-smoke"
    Assert-Equal -Name "first safe HTTP" -Expected 200 -Actual $first.StatusCode
    Assert-Equal -Name "first safe cache status" -Expected "miss" -Actual (Get-HeaderValue -Response $first -Name "X-GateLM-Cache-Status")
    $stats = Get-MockStats
    Assert-Equal -Name "provider calls after first safe request" -Expected 1 -Actual (Get-MockCallCount -Stats $stats)

    $second = Invoke-GatewayChat -Prompt $prompt -Feature "day3-cache-smoke"
    Assert-Equal -Name "second safe HTTP" -Expected 200 -Actual $second.StatusCode
    Assert-Equal -Name "second safe cache status" -Expected "hit" -Actual (Get-HeaderValue -Response $second -Name "X-GateLM-Cache-Status")
    $stats = Get-MockStats
    Assert-Equal -Name "provider calls after cache hit" -Expected 1 -Actual (Get-MockCallCount -Stats $stats)
}

Invoke-SmokeCase -Name "blocked request no provider" -Body {
    Reset-MockStats
    $prompt = "Summarize this synthetic credential marker: api_key=test_secret_token_redacted_for_demo_only_$RunId"

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day3-block-smoke"
    Assert-Equal -Name "blocked HTTP" -Expected 403 -Actual $response.StatusCode
    $blockedCacheStatus = Get-HeaderValue -Response $response -Name "X-GateLM-Cache-Status"
    $blockedErrorCode = Get-ErrorCode -Body $response.Body
    Assert-Equal -Name "blocked error code" -Expected "sensitive_data_blocked" -Actual $blockedErrorCode
    Assert-Equal -Name "blocked cache status" -Expected "bypass" -Actual $blockedCacheStatus
    $stats = Get-MockStats
    Assert-Equal -Name "provider calls after blocked request" -Expected 0 -Actual (Get-MockCallCount -Stats $stats)
}

Invoke-SmokeCase -Name "redacted provider input" -Body {
    Reset-MockStats
    $rawEmail = "user-$RunId@example.invalid"
    $rawPhone = "010-0000-0000"
    $prompt = "Send a safe note for smoke $RunId to $rawEmail and call $rawPhone."

    $response = Invoke-GatewayChat -Prompt $prompt -Feature "day3-redaction-smoke"
    Assert-Equal -Name "redacted HTTP" -Expected 200 -Actual $response.StatusCode
    Assert-Equal -Name "redacted masking action" -Expected "redacted" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Masking-Action")

    $stats = Get-MockStats
    Assert-Equal -Name "provider calls after redacted request" -Expected 1 -Actual (Get-MockCallCount -Stats $stats)

    $last = Get-LastMockCall -Stats $stats
    $preview = [string]$last.redactedPromptPreview
    Assert-Contains -Name "mock redacted preview" -Text $preview -Needle "[EMAIL_REDACTED]"
    Assert-Contains -Name "mock redacted preview" -Text $preview -Needle "[PHONE_NUMBER_REDACTED]"
    Assert-NotContains -Name "mock redacted preview" -Text $preview -Needle $rawEmail
    Assert-NotContains -Name "mock redacted preview" -Text $preview -Needle $rawPhone
    Assert-NotContains -Name "mock redacted preview" -Text $preview -Needle "[UNREDACTED_PROVIDER_INPUT_BLOCKED_FROM_STATS]"
}

Write-Host ""
if ($Failures -gt 0) {
    Write-Host "Day3 safety/cache smoke failed: $Failures failure(s)"
    exit 1
}

Write-Host "Day3 safety/cache smoke passed"

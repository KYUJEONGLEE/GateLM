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
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [hashtable]$Headers = @{},
        [string]$RequestBody = $null
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
    if ($null -ne $RequestBody) {
        if ([string]::IsNullOrWhiteSpace($contentType)) {
            $contentType = "application/json"
        }
        $request.Content = [System.Net.Http.StringContent]::new($RequestBody, [System.Text.Encoding]::UTF8, $contentType)
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

function Get-SafeProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Object -or $null -eq $Object.PSObject) {
        return $null
    }

    $prop = $Object.PSObject.Properties[$Name]
    if ($null -ne $prop) {
        return $prop.Value
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

function Assert-NotEmpty {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()]$Value
    )

    if ([string]::IsNullOrWhiteSpace([string]$Value)) {
        throw "$Name must not be empty"
    }
}

function Reset-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/reset"
    $response = Invoke-MockProviderCurl -Method "POST" -Uri $uri
    Assert-Equal -Name "mock reset HTTP" -Expected 200 -Actual $response.StatusCode
}

function Get-MockStats {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/stats"
    $response = Invoke-MockProviderCurl -Method "GET" -Uri $uri
    Assert-Equal -Name "mock stats HTTP" -Expected 200 -Actual $response.StatusCode
    return (Convert-JsonBody -Body $response.Body)
}

function Invoke-MockProviderCurl {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri
    )

    $output = (& curl.exe -sS -w "`nGATELM_STATUS:%{http_code}" -X $Method $Uri) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        throw "curl.exe failed for mock-provider $Method $Uri with exit code $LASTEXITCODE"
    }
    if ($output -notmatch "(?s)^(.*)\r?\nGATELM_STATUS:(\d{3})$") {
        throw "mock-provider curl output is missing HTTP status"
    }

    return [pscustomobject]@{
        StatusCode = [int]$Matches[2]
        Body       = [string]$Matches[1]
    }
}

function Get-MockCallCount {
    param([Parameter(Mandatory = $true)]$Stats)

    $calls = Get-SafeProperty -Object $Stats -Name "calls"
    if ($null -ne $calls) {
        return [int]$calls
    }

    $data = Get-SafeProperty -Object $Stats -Name "data"
    $totalCalls = Get-SafeProperty -Object $data -Name "totalCalls"
    if ($null -ne $totalCalls) {
        return [int]$totalCalls
    }

    throw "mock stats response is missing calls or data.totalCalls"
}

function New-GatewayHeaders {
    param(
        [string]$ApiKey = $ValidApiKey,
        [string]$AppToken = $ValidAppToken,
        [string]$Feature = "day5-routing-demo"
    )

    return @{
        "Content-Type"          = "application/json"
        "Authorization"         = ("Bearer " + $ApiKey)
        "X-GateLM-App-Token"   = $AppToken
        "X-GateLM-End-User-Id" = "user_demo_001"
        "X-GateLM-Feature-Id"  = $Feature
    }
}

function Invoke-GatewayChat {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$Model = "auto",
        [string]$Feature = "day5-routing-demo",
        [string]$ApiKey = $ValidApiKey,
        [string]$AppToken = $ValidAppToken
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
    return Invoke-SmokeHttp -Method POST -Uri $uri -Headers (New-GatewayHeaders -ApiKey $ApiKey -AppToken $AppToken -Feature $Feature) -RequestBody $payload
}

function Get-ErrorCode {
    param([string]$Body)

    if ([string]::IsNullOrWhiteSpace($Body)) {
        return $null
    }

    try {
        $json = Convert-JsonBody -Body $Body
        $errorObject = Get-SafeProperty -Object $json -Name "error"
        $code = Get-SafeProperty -Object $errorObject -Name "code"
        if ($null -ne $code) {
            return [string]$code
        }
    }
    catch {
        return $null
    }

    return $null
}

function Assert-RoutingMetadata {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$ExpectedRequestedModel,
        [Parameter(Mandatory = $true)][string]$ExpectedRoutingReason,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutionMode
    )

    Assert-Equal -Name "chat HTTP" -Expected 200 -Actual $Response.StatusCode
    Assert-NotEmpty -Name "X-GateLM-Request-Id" -Value (Get-HeaderValue -Response $Response -Name "X-GateLM-Request-Id")

    $json = Convert-JsonBody -Body $Response.Body
    $gateLm = Get-SafeProperty -Object $json -Name "gate_lm"
    if ($null -eq $gateLm) {
        throw "response is missing gate_lm metadata"
    }

    Assert-Equal -Name "tenant context" -Expected $ExpectedTenantId -Actual ([string](Get-SafeProperty -Object $gateLm -Name "tenantId"))
    Assert-Equal -Name "project context" -Expected $ExpectedProjectId -Actual ([string](Get-SafeProperty -Object $gateLm -Name "projectId"))
    Assert-Equal -Name "application context" -Expected $ExpectedApplicationId -Actual ([string](Get-SafeProperty -Object $gateLm -Name "applicationId"))
    Assert-Equal -Name "requested model" -Expected $ExpectedRequestedModel -Actual ([string](Get-SafeProperty -Object $gateLm -Name "requestedModel"))
    Assert-Equal -Name "routing reason" -Expected $ExpectedRoutingReason -Actual ([string](Get-SafeProperty -Object $gateLm -Name "routingReason"))
    Assert-Equal -Name "execution mode" -Expected $ExpectedExecutionMode -Actual ([string](Get-SafeProperty -Object $gateLm -Name "executionMode"))
}

function Invoke-SmokeCase {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    Write-Host ""
    Write-Host "== $Name =="
    try {
        & $Action
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
$InvalidApiKey = Get-EnvOrDefault -Name "GATELM_INVALID_API_KEY" -DefaultValue "glm_api_invalid_redacted"
$InvalidAppToken = Get-EnvOrDefault -Name "GATELM_INVALID_APP_TOKEN" -DefaultValue "glm_app_token_invalid_redacted"
$ExpectedTenantId = Get-EnvOrDefault -Name "GATELM_DEMO_TENANT_ID" -DefaultValue "00000000-0000-4000-8000-000000000100"
$ExpectedProjectId = Get-EnvOrDefault -Name "GATELM_DEMO_PROJECT_ID" -DefaultValue "00000000-0000-4000-8000-000000000200"
$ExpectedApplicationId = Get-EnvOrDefault -Name "GATELM_DEMO_APPLICATION_ID" -DefaultValue "00000000-0000-4000-8000-000000000300"
$ExpectedPinnedModel = Get-EnvOrDefault -Name "GATEWAY_PINNED_TEST_MODEL" -DefaultValue "mock-smart"
$RunId = Get-Date -Format "yyyyMMddHHmmssfff"
$Failures = 0

Write-Host "GateLM Day5 C auth/context/routing smoke"
Write-Host "gateway:      $GatewayBaseUrl"
Write-Host "mockProvider: $MockProviderBaseUrl"
Write-Host "tenantId:     $ExpectedTenantId"
Write-Host "projectId:    $ExpectedProjectId"
Write-Host "appId:        $ExpectedApplicationId"
Write-Host "runId:        $RunId"

Invoke-SmokeCase -Name "valid auth context and short auto routing" -Action {
    $prompt = "Summarize day5 C routing smoke $RunId in one short sentence."
    $response = Invoke-GatewayChat -Prompt $prompt -Model "auto" -Feature "day5-routing-demo"
    Assert-RoutingMetadata `
        -Response $response `
        -ExpectedRequestedModel "auto" `
        -ExpectedRoutingReason "category_difficulty_matrix" `
        -ExpectedExecutionMode "mock"
}

Invoke-SmokeCase -Name "long auto routing uses category difficulty matrix" -Action {
    $longPrompt = "Summarize this day5 C long routing smoke $RunId. " + ("a" * 320)
    $response = Invoke-GatewayChat -Prompt $longPrompt -Model "auto" -Feature "day5-routing-demo"
    Assert-RoutingMetadata `
        -Response $response `
        -ExpectedRequestedModel "auto" `
        -ExpectedRoutingReason "category_difficulty_matrix" `
        -ExpectedExecutionMode "mock"
}

Invoke-SmokeCase -Name "explicit model is pinned" -Action {
    $prompt = "Use the explicitly requested model for day5 C pinned smoke $RunId."
    $response = Invoke-GatewayChat -Prompt $prompt -Model $ExpectedPinnedModel -Feature "day5-routing-demo"
    Assert-RoutingMetadata `
        -Response $response `
        -ExpectedRequestedModel $ExpectedPinnedModel `
        -ExpectedRoutingReason "pinned" `
        -ExpectedExecutionMode "mock"
}

Invoke-SmokeCase -Name "invalid API key stops before provider" -Action {
    Reset-MockStats
    $response = Invoke-GatewayChat `
        -Prompt "Invalid API key day5 C smoke $RunId." `
        -Model "auto" `
        -Feature "day5-auth-demo" `
        -ApiKey $InvalidApiKey `
        -AppToken $ValidAppToken
    Assert-Equal -Name "invalid API HTTP" -Expected 401 -Actual $response.StatusCode
    Assert-Equal -Name "invalid API error code" -Expected "invalid_api_key" -Actual (Get-ErrorCode -Body $response.Body)
    Assert-Equal -Name "invalid API cache status" -Expected "bypass" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Cache-Status")
    Assert-Equal -Name "provider calls after invalid API key" -Expected 0 -Actual (Get-MockCallCount -Stats (Get-MockStats))
}

Invoke-SmokeCase -Name "invalid app token stops before provider" -Action {
    Reset-MockStats
    $response = Invoke-GatewayChat `
        -Prompt "Invalid app token day5 C smoke $RunId." `
        -Model "auto" `
        -Feature "day5-auth-demo" `
        -ApiKey $ValidApiKey `
        -AppToken $InvalidAppToken
    Assert-Equal -Name "invalid app token HTTP" -Expected 403 -Actual $response.StatusCode
    Assert-Equal -Name "invalid app token error code" -Expected "invalid_app_token" -Actual (Get-ErrorCode -Body $response.Body)
    Assert-Equal -Name "invalid app token cache status" -Expected "bypass" -Actual (Get-HeaderValue -Response $response -Name "X-GateLM-Cache-Status")
    Assert-Equal -Name "provider calls after invalid app token" -Expected 0 -Actual (Get-MockCallCount -Stats (Get-MockStats))
}

Write-Host ""
if ($Failures -gt 0) {
    Write-Host "Day5 C auth/context/routing smoke failed: $Failures failure(s)"
    exit 1
}

Write-Host "Day5 C auth/context/routing smoke passed"

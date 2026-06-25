Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

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
        [string]$Body = $null
    )

    $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Uri)
    $request.Method = $Method
    $request.Accept = "application/json"
    $request.UserAgent = "GateLM-Day2-Auth-Smoke"

    foreach ($key in $Headers.Keys) {
        if ($key -eq "Content-Type") {
            $request.ContentType = [string]$Headers[$key]
            continue
        }
        $request.Headers[$key] = [string]$Headers[$key]
    }

    if ($null -ne $Body) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
        $request.ContentLength = $bytes.Length
        $stream = $request.GetRequestStream()
        try {
            $stream.Write($bytes, 0, $bytes.Length)
        }
        finally {
            $stream.Dispose()
        }
    }

    $response = $null
    try {
        $response = $request.GetResponse()
    }
    catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) {
            throw
        }
    }

    try {
        $responseStream = $response.GetResponseStream()
        $text = ""
        if ($null -ne $responseStream) {
            $reader = [System.IO.StreamReader]::new($responseStream)
            try {
                $text = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }
        }

        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Body       = $text
            Headers    = $response.Headers
        }
    }
    finally {
        $response.Dispose()
    }
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

function Reset-MockCalls {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/reset"
    $response = Invoke-SmokeHttp -Method POST -Uri $uri -Headers @{ "Content-Type" = "application/json" } -Body "{}"
    if ($response.StatusCode -ne 200) {
        throw "mock provider reset failed with HTTP $($response.StatusCode)"
    }
}

function Get-MockCallCount {
    $uri = Join-Url $MockProviderBaseUrl "/__mock/stats"
    $response = Invoke-SmokeHttp -Method GET -Uri $uri
    if ($response.StatusCode -ne 200) {
        throw "mock provider stats failed with HTTP $($response.StatusCode)"
    }

    $json = $response.Body | ConvertFrom-Json
    if ($null -eq $json.calls) {
        throw "mock provider stats response is missing calls"
    }

    return [int]$json.calls
}

function Invoke-GatewayChat {
    param(
        [Parameter(Mandatory = $true)][string]$ApiKey,
        [Parameter(Mandatory = $true)][string]$AppToken
    )

    $headers = @{
        "Content-Type"          = "application/json"
        "Authorization"         = ("Bearer " + $ApiKey)
        "X-GateLM-App-Token"   = $AppToken
        "X-GateLM-End-User-Id" = "user_demo_001"
        "X-GateLM-Feature-Id"  = "day2-auth-smoke"
    }

    $payload = @'
{
  "model": "mock-balanced",
  "messages": [
    {
      "role": "user",
      "content": "Write a short refund response."
    }
  ],
  "stream": false
}
'@

    $uri = Join-Url $GatewayBaseUrl "/v1/chat/completions"
    return Invoke-SmokeHttp -Method POST -Uri $uri -Headers $headers -Body $payload
}

function Invoke-AuthSmokeCase {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ApiKey,
        [Parameter(Mandatory = $true)][string]$AppToken,
        [Parameter(Mandatory = $true)][int]$ExpectedStatus,
        [Parameter(Mandatory = $true)][string]$ExpectedCode,
        [bool]$Enabled = $true
    )

    Write-Host ""
    Write-Host "== $Name =="

    if (-not $Enabled) {
        Write-Host "result: SKIPPED - mismatch token missing"
        return $true
    }

    Reset-MockCalls
    $beforeCalls = Get-MockCallCount
    $response = Invoke-GatewayChat -ApiKey $ApiKey -AppToken $AppToken
    $afterCalls = Get-MockCallCount
    $actualCode = Get-ErrorCode -Body $response.Body

    $passed = $true
    if ($response.StatusCode -ne $ExpectedStatus) {
        $passed = $false
    }
    if ($actualCode -ne $ExpectedCode) {
        $passed = $false
    }
    if ($beforeCalls -ne 0 -or $afterCalls -ne 0) {
        $passed = $false
    }

    Write-Host "expectedStatus: $ExpectedStatus"
    Write-Host "actualStatus:   $($response.StatusCode)"
    Write-Host "expectedCode:   $ExpectedCode"
    Write-Host "actualCode:     $actualCode"
    Write-Host "mockCalls:      before=$beforeCalls after=$afterCalls"

    if ($passed) {
        Write-Host "result: PASS"
        return $true
    }

    Write-Host "result: FAIL"
    return $false
}

$GatewayBaseUrl = Get-EnvOrDefault -Name "GATEWAY_BASE_URL" -DefaultValue "http://localhost:8080"
$MockProviderBaseUrl = Get-EnvOrDefault -Name "MOCK_PROVIDER_BASE_URL" -DefaultValue "http://localhost:8090"
$ValidApiKey = Get-EnvOrDefault -Name "GATELM_API_KEY" -DefaultValue "glm_api_test_redacted"
$ValidAppToken = Get-EnvOrDefault -Name "GATELM_APP_TOKEN" -DefaultValue "glm_app_token_test_redacted"
$InvalidApiKey = Get-EnvOrDefault -Name "GATELM_INVALID_API_KEY" -DefaultValue "glm_api_invalid_redacted"
$InvalidAppToken = Get-EnvOrDefault -Name "GATELM_INVALID_APP_TOKEN" -DefaultValue "glm_app_token_invalid_redacted"
$ScopeMismatchAppToken = [Environment]::GetEnvironmentVariable("GATELM_SCOPE_MISMATCH_APP_TOKEN")
$ScopeMismatchEnabled = -not [string]::IsNullOrWhiteSpace($ScopeMismatchAppToken)
if (-not $ScopeMismatchEnabled) {
    $ScopeMismatchAppToken = "glm_app_scope_mismatch_missing_redacted"
}

Write-Host "GateLM Day2 auth smoke"
Write-Host "gateway:       $GatewayBaseUrl"
Write-Host "mockProvider:  $MockProviderBaseUrl"

$failures = 0

$ok = Invoke-AuthSmokeCase `
    -Name "invalid API Key" `
    -ApiKey $InvalidApiKey `
    -AppToken $ValidAppToken `
    -ExpectedStatus 401 `
    -ExpectedCode "invalid_api_key"
if (-not $ok) { $failures++ }

$ok = Invoke-AuthSmokeCase `
    -Name "invalid App Token" `
    -ApiKey $ValidApiKey `
    -AppToken $InvalidAppToken `
    -ExpectedStatus 403 `
    -ExpectedCode "invalid_app_token"
if (-not $ok) { $failures++ }

$ok = Invoke-AuthSmokeCase `
    -Name "scope mismatch" `
    -ApiKey $ValidApiKey `
    -AppToken $ScopeMismatchAppToken `
    -ExpectedStatus 403 `
    -ExpectedCode "scope_mismatch" `
    -Enabled $ScopeMismatchEnabled
if (-not $ok) { $failures++ }

Write-Host ""
if ($failures -gt 0) {
    Write-Host "Day2 auth smoke failed: $failures failure(s)"
    exit 1
}

Write-Host "Day2 auth smoke passed"

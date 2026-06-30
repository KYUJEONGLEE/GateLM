param(
  [string]$GatewayBaseUrl = $(if ($env:GATEWAY_BASE_URL) { $env:GATEWAY_BASE_URL } else { "http://localhost:8080" }),
  [string]$ApiKey = $(if ($env:GATELM_DEMO_API_KEY) { $env:GATELM_DEMO_API_KEY } else { "glm_api_test_redacted" }),
  [string]$AppToken = $(if ($env:GATELM_DEMO_APP_TOKEN) { $env:GATELM_DEMO_APP_TOKEN } else { "glm_app_token_test_redacted" }),
  [string]$EndUserId = $(if ($env:GATELM_DEMO_END_USER_ID) { $env:GATELM_DEMO_END_USER_ID } else { "user_v2_demo_evidence" }),
  [switch]$RunK6
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$reportDir = Join-Path $repoRoot "reports/demo"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "v2_demo_$timestamp"
$safePrompt = "Write a short safe customer support reply for GateLM demo $runId."
$redactionPrompt = "Write a support reply to synthetic.user.$runId@example.test without exposing the address."
$blockedPrompt = "This synthetic request contains api_key=test_secret_token_redacted_for_demo_only_$runId"
$streamingPrompt = "Write a short safe streaming response for GateLM demo $runId."

function New-RequestId([string]$Scenario) {
  $safeScenario = $Scenario -replace "[^A-Za-z0-9_]", "_"
  return "request_demo_${runId}_${safeScenario}"
}

function Invoke-GatewayChat {
  param(
    [string]$Scenario,
    [string]$Prompt,
    [bool]$Stream = $false
  )

  $requestId = New-RequestId $Scenario
  $headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $ApiKey"
    "X-GateLM-App-Token" = $AppToken
    "X-GateLM-End-User-Id" = $EndUserId
    "X-GateLM-Feature-Id" = $Scenario
    "X-GateLM-Request-Id" = $requestId
  }
  $body = @{
    model = "auto"
    messages = @(
      @{
        role = "user"
        content = $Prompt
      }
    )
    temperature = 0.2
    max_tokens = 128
    stream = $Stream
  } | ConvertTo-Json -Depth 8

  try {
    $response = Invoke-WebRequest -Method Post -Uri "$GatewayBaseUrl/v1/chat/completions" -Headers $headers -Body $body -UseBasicParsing -SkipHttpErrorCheck
    $statusCode = [int]$response.StatusCode
  } catch {
    $response = $null
    $statusCode = 0
  }

  return [ordered]@{
    scenario = $Scenario
    requestId = $requestId
    httpStatus = $statusCode
    cacheStatus = HeaderValue $response "X-GateLM-Cache-Status"
    maskingAction = HeaderValue $response "X-GateLM-Masking-Action"
    routedProvider = HeaderValue $response "X-GateLM-Routed-Provider"
    routedModel = HeaderValue $response "X-GateLM-Routed-Model"
    contentType = HeaderValue $response "Content-Type"
    requestDetailUrl = "$GatewayBaseUrl/api/llm-requests/$requestId"
  }
}

function HeaderValue($Response, [string]$Name) {
  if (-not $Response -or -not $Response.Headers) {
    return $null
  }
  if ($Response.Headers -is [System.Collections.IDictionary]) {
    $value = $Response.Headers[$Name]
  } else {
    try {
      $value = $Response.Headers.GetValues($Name)
    } catch {
      $value = $null
    }
  }
  if ($value -is [array]) {
    return $value -join ","
  }
  if ($null -eq $value) {
    return $null
  }
  return [string]$value
}

$health = Invoke-WebRequest -Uri "$GatewayBaseUrl/healthz" -UseBasicParsing
if ($health.StatusCode -ne 200) {
  throw "Gateway health check failed: HTTP $($health.StatusCode)"
}

$evidence = @()
$evidence += Invoke-GatewayChat -Scenario "safe_request" -Prompt $safePrompt
$evidence += Invoke-GatewayChat -Scenario "exact_cache_seed" -Prompt $safePrompt
$evidence += Invoke-GatewayChat -Scenario "exact_cache_hit" -Prompt $safePrompt
$evidence += Invoke-GatewayChat -Scenario "redaction" -Prompt $redactionPrompt
$evidence += Invoke-GatewayChat -Scenario "safety_block" -Prompt $blockedPrompt
$evidence += Invoke-GatewayChat -Scenario "streaming_thin_slice" -Prompt $streamingPrompt -Stream $true

$k6Result = $null
if ($RunK6) {
  $k6 = Get-Command k6 -ErrorAction SilentlyContinue
  if ($k6) {
    & k6 run (Join-Path $repoRoot "scripts/perf/k6-gateway-baseline.js")
    $k6Result = @{
      attempted = $true
      exitCode = $LASTEXITCODE
    }
  } else {
    $k6Result = @{
      attempted = $false
      reason = "k6_not_found"
    }
  }
}

$report = [ordered]@{
  runId = $runId
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  gatewayBaseUrl = $GatewayBaseUrl
  evidence = $evidence
  dashboardUrl = "$GatewayBaseUrl/api/dashboard/overview"
  k6 = $k6Result
  securityNote = "No raw prompt, raw response, Authorization header, Provider Key, API Key, App Token, or actual secret is stored in this report."
}

$reportPath = Join-Path $reportDir "v2-demo-evidence-$timestamp.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding utf8

Write-Host "v2 demo evidence report written:"
Write-Host $reportPath
Write-Host "Request IDs:"
$evidence | ForEach-Object { Write-Host "  $($_.scenario): $($_.requestId) HTTP $($_.httpStatus)" }

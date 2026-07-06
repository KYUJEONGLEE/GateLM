param(
    [string]$ControlPlaneBaseUrl = $(if ($env:CONTROL_PLANE_BASE_URL) { $env:CONTROL_PLANE_BASE_URL } else { "http://localhost:3001" }),
    [string]$GatewayBaseUrl = $(if ($env:GATEWAY_BASE_URL) { $env:GATEWAY_BASE_URL } else { "http://localhost:8080" }),
    [string]$ApplicationId = $(if ($env:GATELM_DEMO_APPLICATION_ID) { $env:GATELM_DEMO_APPLICATION_ID } else { "00000000-0000-4000-8000-000000000300" }),
    [string]$TenantId = $(if ($env:GATELM_DEMO_TENANT_ID) { $env:GATELM_DEMO_TENANT_ID } else { "00000000-0000-4000-8000-000000000100" }),
    [string]$ProjectId = $(if ($env:GATELM_DEMO_PROJECT_ID) { $env:GATELM_DEMO_PROJECT_ID } else { "00000000-0000-4000-8000-000000000200" }),
    [string]$ApiKey = $(if ($env:GATELM_DEMO_API_KEY) { $env:GATELM_DEMO_API_KEY } else { "glm_api_test_redacted" }),
    [string]$AppToken = $(if ($env:GATELM_DEMO_APP_TOKEN) { $env:GATELM_DEMO_APP_TOKEN } else { "glm_app_token_test_redacted" }),
    [string]$AnthropicApiKey = $(if ($env:ANTHROPIC_API_KEY) { $env:ANTHROPIC_API_KEY } elseif ($env:CLAUDE_PROVIDER_CREDENTIAL) { $env:CLAUDE_PROVIDER_CREDENTIAL } else { "" }),
    [ValidateSet("short", "paragraph")]
    [string]$PromptMode = "paragraph",
    [int]$MaxTokens = 1024,
    [string]$Prompt = "",
    [switch]$StreamUnsupportedCheck,
    [switch]$HideRawText,
    [switch]$SkipControlPlaneCheck,
    [switch]$SkipRequestDetailCheck,
    [switch]$DescribeOnly
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Join-Url {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Get-EnvelopeData {
    param($Payload)

    if ($null -eq $Payload) {
        return $null
    }

    $data = $Payload.PSObject.Properties["data"]
    if ($null -ne $data) {
        return $data.Value
    }

    return $Payload
}

function Invoke-JsonGet {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try {
        return Invoke-RestMethod -Method GET -Uri $Uri -TimeoutSec 10
    }
    catch {
        throw "GET $Uri failed. $($_.Exception.Message)"
    }
}

function Test-Health {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$BaseUrl
    )

    $uri = Join-Url $BaseUrl "/healthz"
    try {
        Invoke-WebRequest -Method GET -Uri $uri -UseBasicParsing -TimeoutSec 5 | Out-Null
        Write-Host "  OK  $Name healthz: $uri"
    }
    catch {
        throw "$Name did not respond at $uri. Start the service first. $($_.Exception.Message)"
    }
}

function Get-ClaudeProviderSummary {
    param(
        [Parameter(Mandatory = $true)][string]$ControlPlaneBaseUrl,
        [Parameter(Mandatory = $true)][string]$ApplicationId
    )

    $snapshotUrl = Join-Url $ControlPlaneBaseUrl "/admin/v1/applications/$([uri]::EscapeDataString($ApplicationId))/runtime-snapshot/active"
    $snapshot = Get-EnvelopeData (Invoke-JsonGet -Uri $snapshotUrl)
    $catalogId = [string]$snapshot.providerCatalogRef.catalogId
    if ([string]::IsNullOrWhiteSpace($catalogId)) {
        throw "active RuntimeSnapshot providerCatalogRef.catalogId is empty."
    }

    $catalogUrl = Join-Url $ControlPlaneBaseUrl "/admin/v1/provider-catalogs/$([uri]::EscapeDataString($catalogId))"
    $catalog = Get-EnvelopeData (Invoke-JsonGet -Uri $catalogUrl)
    $providers = @($catalog.providers | Where-Object { $null -ne $_ })
    $claudeProviders = @(
        $providers | Where-Object {
            $_.enabled -eq $true -and
            $_.adapterType -eq "anthropic" -and
            $_.adapterConfig.requestFormat -eq "anthropic_messages" -and
            @($_.models | Where-Object { [string]$_.modelName -like "claude-*" }).Count -gt 0
        }
    )

    if ($claudeProviders.Count -eq 0) {
        throw "active Provider Catalog has no enabled Claude anthropic_messages provider. Publish a Claude Provider Connection first."
    }

    $provider = $claudeProviders[0]
    $models = @($provider.models | Where-Object { [string]$_.modelName -like "claude-*" } | ForEach-Object { [string]$_.modelName })

    return [ordered]@{
        providerName = [string]$provider.providerName
        adapterType = [string]$provider.adapterType
        requestFormat = [string]$provider.adapterConfig.requestFormat
        baseUrl = [string]$provider.baseUrl
        credentialRefId = [string]$provider.credentialRef.credentialRefId
        models = $models
    }
}

function Invoke-ClaudeSmoke {
    param([switch]$Stream)

    $scriptPath = Join-Path $PSScriptRoot "claude-gateway-smoke.mjs"
    $args = @(
        $scriptPath,
        "--control-plane-base-url", $ControlPlaneBaseUrl,
        "--gateway-base-url", $GatewayBaseUrl,
        "--application-id", $ApplicationId,
        "--tenant-id", $TenantId,
        "--project-id", $ProjectId,
        "--api-key", $ApiKey,
        "--app-token", $AppToken,
        "--prompt-mode", $PromptMode,
        "--max-tokens", ([string]$MaxTokens)
    )

    if (-not [string]::IsNullOrWhiteSpace($Prompt)) {
        $args += @("--prompt", $Prompt)
    }
    if ($HideRawText) {
        $args += "--hide-raw-text"
    }
    if ($SkipControlPlaneCheck) {
        $args += "--skip-control-plane-check"
    }
    if ($SkipRequestDetailCheck) {
        $args += "--skip-request-detail-check"
    }
    if ($Stream) {
        $args += "--stream"
    }

    & node @args
    if ($LASTEXITCODE -ne 0) {
        throw "Claude smoke failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $repoRoot

Write-Host ""
Write-Host "GateLM Claude terminal smoke"
Write-Host "============================"
Write-Host "This script verifies Claude Gateway non-stream behavior without the Web UI."
Write-Host "The underlying Node smoke uses Korean prompts and does not print raw secrets."
Write-Host ""

if ($DescribeOnly) {
    Write-Host "Describe-only mode. No HTTP requests will be sent."
    Write-Host "Steps:"
    Write-Host "1. Check Control Plane / Gateway /healthz"
    Write-Host "2. Check active RuntimeSnapshot and Claude Provider Catalog"
    Write-Host "3. Check ANTHROPIC_API_KEY or CLAUDE_PROVIDER_CREDENTIAL env"
    Write-Host "4. Call Gateway /v1/chat/completions in non-stream mode"
    Write-Host "5. With -StreamUnsupportedCheck, confirm current Claude streaming_not_supported behavior"
    exit 0
}

Write-Host "[1/5] Check service health"
Test-Health -Name "Control Plane" -BaseUrl $ControlPlaneBaseUrl
Test-Health -Name "Gateway" -BaseUrl $GatewayBaseUrl

Write-Host ""
Write-Host "[2/5] Check active RuntimeSnapshot / Claude Provider Catalog"
$claude = Get-ClaudeProviderSummary -ControlPlaneBaseUrl $ControlPlaneBaseUrl -ApplicationId $ApplicationId
Write-Host "  providerName:  $($claude.providerName)"
Write-Host "  adapterType:    $($claude.adapterType)"
Write-Host "  requestFormat:  $($claude.requestFormat)"
Write-Host "  baseUrl:        $($claude.baseUrl)"
Write-Host "  models:         $($claude.models -join ', ')"

if (-not [string]::IsNullOrWhiteSpace($claude.credentialRefId)) {
    $suggestedMap = "$($claude.credentialRefId)=CLAUDE_PROVIDER_CREDENTIAL"
    if ([string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP)) {
        $env:CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = $suggestedMap
        Write-Host "  env-map hint:   CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP=$suggestedMap"
    }
    elseif ($env:CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP -notlike "*$($claude.credentialRefId)=*") {
        Write-Host "  warning: Current CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP does not include the Claude credentialRef."
        Write-Host "           Include this mapping when starting Gateway:"
        Write-Host "           $suggestedMap"
    }
}

Write-Host ""
Write-Host "[3/5] Check Claude credential env"
if (-not [string]::IsNullOrWhiteSpace($AnthropicApiKey)) {
    $env:CLAUDE_PROVIDER_CREDENTIAL = $AnthropicApiKey
    Write-Host "  OK  CLAUDE_PROVIDER_CREDENTIAL was set for this process. The value is not printed."
}
elseif ([string]::IsNullOrWhiteSpace($env:CLAUDE_PROVIDER_CREDENTIAL)) {
    Write-Host "  warning: ANTHROPIC_API_KEY or CLAUDE_PROVIDER_CREDENTIAL env is missing."
    Write-Host "           You can continue if Gateway is already running with the correct env."
}

Write-Host "  note: If Gateway is already running, restart it after changing credential env-map values."

Write-Host ""
Write-Host "[4/5] Call Claude non-stream Gateway path"
Invoke-ClaudeSmoke

if ($StreamUnsupportedCheck) {
    Write-Host ""
    Write-Host "[5/5] Check current Claude streaming scope"
    Write-Host "  PR #181 supports Claude non-stream. streaming_not_supported is expected here."
    Invoke-ClaudeSmoke -Stream
}
else {
    Write-Host ""
    Write-Host "[5/5] Skip streaming check"
    Write-Host "  Use -StreamUnsupportedCheck to confirm current streaming_not_supported behavior."
}

Write-Host ""
Write-Host "PASS: Claude terminal smoke completed"

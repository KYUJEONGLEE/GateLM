[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$composeFiles = @('-f', 'docker-compose.yml', '-f', 'scripts/dev/docker-compose.tenant-chat-execution.yml')
$secretDirectory = Join-Path $root '.secrets\tenant-chat'

function Write-Phase([string]$Name) {
  Write-Host "[tenant-chat-smoke] $Name"
}

function New-LocalSecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
  } finally {
    $generator.Dispose()
  }
}

function New-ProviderCredentialEncryptionKey {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
  } finally {
    $generator.Dispose()
  }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & docker compose @composeFiles @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed during: $($Arguments -join ' ')" }
}

Push-Location $root
try {
  Write-Phase 'setup: tools, gitignored secrets, and private network contract'
  foreach ($command in @('node', 'docker')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "$command is required."
    }
  }
  if (-not (Test-Path -LiteralPath $secretDirectory)) {
    & node scripts/dev/generate-tenant-chat-local-secrets.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Tenant Chat secret generation failed.' }
  }
  if (-not $env:CONTROL_PLANE_AUTH_STATE_SECRET) { $env:CONTROL_PLANE_AUTH_STATE_SECRET = New-LocalSecret }
  if (-not $env:TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN) { $env:TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN = New-LocalSecret }
  if (-not $env:TENANT_CHAT_ACCESS_JWT_SECRET) { $env:TENANT_CHAT_ACCESS_JWT_SECRET = New-LocalSecret }
  if (-not $env:TENANT_CHAT_INTENT_SECRET) { $env:TENANT_CHAT_INTENT_SECRET = New-LocalSecret }
  if (-not $env:TENANT_CHAT_WEB_SERVICE_TOKEN) { $env:TENANT_CHAT_WEB_SERVICE_TOKEN = New-LocalSecret }
  if (-not $env:GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY) {
    $env:GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY = New-ProviderCredentialEncryptionKey
  }
  $config = (& docker compose @composeFiles config) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Compose contract validation failed.' }
  if ($config -match 'published:\s*["'']?8081' -or $config -match '8081:8081') {
    throw 'The private Gateway listener must not be published to the host.'
  }

  Write-Phase 'postgres/redis/mock-provider: start dependencies'
  Invoke-Compose up --detach postgres redis mock-provider

  if (-not $SkipBuild) {
    Write-Phase 'images: build Control Plane, Gateway, and Chat API'
    Invoke-Compose build control-plane-api gateway-core chat-api
  }

  Write-Phase 'postgres: deploy migrations and idempotent demo seed'
  Invoke-Compose run --rm control-plane-api node node_modules/prisma/build/index.js migrate deploy
  Invoke-Compose run --rm control-plane-api node node_modules/ts-node/dist/bin.js --transpile-only prisma/seed.ts

  Write-Phase 'control-plane: start, publish mock Tenant Chat snapshot, verify provider metadata'
  Invoke-Compose up --detach control-plane-api
  Invoke-Compose exec -T control-plane-api node dist/src/tenant-chat-runtime-smoke.js

  Write-Phase 'gateway/chat-api: start private listener and fail-closed readiness'
  Invoke-Compose up --detach gateway-core chat-api

  Write-Phase 'execution: run synthetic application-context bridge smoke'
  $smokeOutput = & docker compose @composeFiles exec -T chat-api node dist/execution/smoke.js
  if ($LASTEXITCODE -ne 0) { throw 'Chat API execution bridge smoke failed.' }
  $smoke = $smokeOutput | Select-Object -Last 1 | ConvertFrom-Json
  if ($smoke.status -ne 'ok' -or $smoke.surface -ne 'tenant_chat') {
    throw 'Chat API execution bridge returned an invalid safe result.'
  }

  Write-Phase 'dashboard: wait for outbox projector and verify tenant_chat readback'
  $readbackSucceeded = $false
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    & docker compose @composeFiles exec -T control-plane-api `
      node dist/src/tenant-chat-runtime-smoke.js "--readback=$($smoke.requestId)"
    if ($LASTEXITCODE -eq 0) {
      $readbackSucceeded = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $readbackSucceeded) { throw 'Tenant Chat Dashboard readback did not converge.' }
  Write-Host '[tenant-chat-smoke] complete: synthetic bridge and projected readback passed'
} finally {
  Pop-Location
}

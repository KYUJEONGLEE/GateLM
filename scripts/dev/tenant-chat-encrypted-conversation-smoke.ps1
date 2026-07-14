[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$composeFiles = @('-f', 'docker-compose.yml', '-f', 'scripts/dev/docker-compose.tenant-chat-execution.yml')
$secretDirectory = Join-Path $root '.secrets\tenant-chat'
$cleanDatabase = ('gatelm_tc_{0}_{1}' -f $PID, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).ToLowerInvariant()
$cleanDatabaseCreated = $false

function Write-Phase([string]$Name) {
  Write-Host "[tenant-chat-content-smoke] $Name"
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

function New-SmokeMarker {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return 'tc-' + [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  } finally {
    $generator.Dispose()
  }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & docker compose @composeFiles @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed during: $($Arguments -join ' ')" }
}

function Test-RedisPlaintext([string]$Marker) {
  $keys = @(& docker compose @composeFiles exec -T redis redis-cli --raw --scan)
  if ($LASTEXITCODE -ne 0) { throw 'Redis key scan failed.' }
  foreach ($key in $keys) {
    if (-not $key) { continue }
    $type = (& docker compose @composeFiles exec -T redis redis-cli --raw TYPE $key | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Redis type scan failed.' }
    $values = switch ($type) {
      'string' { & docker compose @composeFiles exec -T redis redis-cli --raw GET $key }
      'hash' { & docker compose @composeFiles exec -T redis redis-cli --raw HGETALL $key }
      'list' { & docker compose @composeFiles exec -T redis redis-cli --raw LRANGE $key 0 -1 }
      'set' { & docker compose @composeFiles exec -T redis redis-cli --raw SMEMBERS $key }
      'zset' { & docker compose @composeFiles exec -T redis redis-cli --raw ZRANGE $key 0 -1 }
      default { @() }
    }
    if ($LASTEXITCODE -ne 0) { throw 'Redis value scan failed.' }
    if (($values -join "`n").Contains($Marker)) { return $true }
  }
  return $false
}

Push-Location $root
try {
  Write-Phase 'setup: tools, gitignored secrets, and private listener contract'
  foreach ($command in @('node', 'docker')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
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
  $env:MOCK_PROVIDER_DEFAULT_LATENCY_MS = '1500'
  $config = (& docker compose @composeFiles config) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Compose contract validation failed.' }
  if ($config -match 'published:\s*["'']?8081' -or $config -match '8081:8081') {
    throw 'The private Gateway listener must not be published to the host.'
  }

  Write-Phase 'dependencies: start PostgreSQL, Redis, and Mock Provider'
  Invoke-Compose up --detach postgres redis
  Invoke-Compose up --detach --force-recreate mock-provider

  if (-not $SkipBuild) {
    Write-Phase 'images: build Control Plane, Gateway, and Chat API'
    Invoke-Compose build control-plane-api gateway-core chat-api
  }

  Write-Phase 'migration: clean database deploy'
  Invoke-Compose exec -T postgres psql -U gatelm -d postgres --set=ON_ERROR_STOP=1 -c "CREATE DATABASE $cleanDatabase"
  $cleanDatabaseCreated = $true
  & docker compose @composeFiles run --rm -e "DATABASE_URL=postgresql://gatelm:gatelm@postgres:5432/${cleanDatabase}?schema=public" control-plane-api node node_modules/prisma/build/index.js migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Clean database migration deploy failed.' }

  Write-Phase 'migration: existing database upgrade and idempotent seed'
  Invoke-Compose run --rm control-plane-api node node_modules/prisma/build/index.js migrate deploy
  Invoke-Compose run --rm control-plane-api node node_modules/ts-node/dist/bin.js --transpile-only prisma/seed.ts

  Write-Phase 'runtime: publish snapshot and start private execution services'
  Invoke-Compose up --detach control-plane-api
  Invoke-Compose exec -T control-plane-api node dist/src/tenant-chat-runtime-smoke.js
  Invoke-Compose up --detach gateway-core chat-api

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    & docker compose @composeFiles exec -T chat-api node -e "fetch('http://127.0.0.1:3003/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Chat API readiness did not converge.' }

  Write-Phase 'content API: idempotency, IDOR, encryption, SSE, cancellation, delete, and retention'
  $marker = New-SmokeMarker
  $contentOutput = & docker compose @composeFiles exec -T -e "TENANT_CHAT_SMOKE_MARKER=$marker" chat-api node dist/content/smoke.js
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted conversation API smoke failed.' }
  $contentResult = $contentOutput | Select-Object -Last 1 | ConvertFrom-Json
  if ($contentResult.status -ne 'ok' -or -not $contentResult.encryption -or -not $contentResult.sse) {
    throw 'Encrypted conversation API smoke returned an invalid safe result.'
  }

  Write-Phase 'forbidden data: scan database result, Redis values, and container logs'
  if ($contentResult.databasePlaintext -ne $false) { throw 'Database plaintext scan failed.' }
  if (Test-RedisPlaintext $marker) { throw 'Redis retained the smoke content marker in plaintext.' }
  $metrics = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/metrics' -TimeoutSec 10).Content
  if ($metrics.Contains($marker)) { throw 'A metric retained the smoke content marker in plaintext.' }
  $logs = (& docker compose @composeFiles logs --no-color control-plane-api gateway-core chat-api mock-provider) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Container log read failed.' }
  if ($logs.Contains($marker)) { throw 'A container log retained the smoke content marker in plaintext.' }

  Write-Phase 'usage accounting: bridge execution and projected Dashboard readback'
  $bridgeOutput = & docker compose @composeFiles exec -T chat-api node dist/execution/smoke.js
  if ($LASTEXITCODE -ne 0) { throw 'Chat API execution bridge smoke failed.' }
  $bridge = $bridgeOutput | Select-Object -Last 1 | ConvertFrom-Json
  $readbackSucceeded = $false
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    & docker compose @composeFiles exec -T control-plane-api node dist/src/tenant-chat-runtime-smoke.js "--readback=$($bridge.requestId)"
    if ($LASTEXITCODE -eq 0) { $readbackSucceeded = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $readbackSucceeded) { throw 'Tenant Chat Dashboard readback did not converge.' }
  Write-Host '[tenant-chat-content-smoke] complete: all safe checks passed'
} finally {
  if ($cleanDatabaseCreated) {
    & docker compose @composeFiles exec -T postgres psql -U gatelm -d postgres --set=ON_ERROR_STOP=1 -c "DROP DATABASE $cleanDatabase WITH (FORCE)"
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Clean migration database cleanup failed.' }
  }
  Pop-Location
}

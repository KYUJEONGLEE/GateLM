[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$ComposeArguments
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$composeFiles = @('-f', 'docker-compose.yml', '-f', 'scripts/dev/docker-compose.tenant-chat-execution.yml')
$cacheKeySetId = 'tenant-chat-local-cache-1'

if ($ComposeArguments.Count -eq 0) {
  throw 'Pass Docker Compose arguments, for example: up -d postgres redis control-plane-api gateway-core chat-api chat-web'
}

Push-Location $root
try {
  foreach ($command in @('node', 'docker', 'git')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
  }

  $secretResolution = (& node scripts/dev/generate-tenant-chat-local-secrets.mjs --resolve-target | Select-Object -Last 1) | ConvertFrom-Json
  $secretDirectory = [string]$secretResolution.directory
  if ([string]::IsNullOrWhiteSpace($secretDirectory)) {
    throw 'Tenant Chat shared secret directory resolution failed.'
  }
  if (-not (Test-Path -LiteralPath $secretDirectory)) {
    & node scripts/dev/generate-tenant-chat-local-secrets.mjs "--cache-key-set-id=$cacheKeySetId"
    if ($LASTEXITCODE -ne 0) { throw 'Tenant Chat shared secret generation failed.' }
  }

  & node scripts/dev/validate-tenant-chat-cache-keyset.mjs `
    "--expected-id=$cacheKeySetId" `
    "--keysets-file=$(Join-Path $secretDirectory 'cache-keysets.json')"
  if ($LASTEXITCODE -ne 0) { throw 'Tenant Chat cache key-set validation failed.' }

  $env:GATELM_TENANT_CHAT_LOCAL_SECRET_DIR = $secretDirectory.Replace('\', '/')
  $env:TENANT_CHAT_CACHE_KEY_SET_ID = $cacheKeySetId
  Write-Host "Tenant Chat shared local secrets: $secretDirectory"
  & docker compose @composeFiles @ComposeArguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed during: $($ComposeArguments -join ' ')"
  }
} finally {
  Pop-Location
}

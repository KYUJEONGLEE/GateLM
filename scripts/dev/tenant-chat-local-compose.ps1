[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$ComposeArguments
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$composeFiles = @('-f', 'docker-compose.yml', '-f', 'scripts/dev/docker-compose.tenant-chat-execution.yml')
$e5BundleDirectory = '.tmp/gateway-e5-runtime-bundle'

if ($ComposeArguments.Count -eq 0) {
  throw 'Pass Docker Compose arguments, for example: up -d postgres redis control-plane-api gateway-core chat-api chat-web'
}

Push-Location $root
try {
  foreach ($command in @('node', 'docker', 'git')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
  }

  $composeCommand = $ComposeArguments | Where-Object { $_ -in @('build', 'up') } | Select-Object -First 1
  if ($composeCommand) {
    & (Join-Path $PSScriptRoot 'prepare-gateway-e5-shadow-bundle.ps1') `
      -OutputDirectory $e5BundleDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Gateway E5 runtime bundle preparation failed.' }
  }

  $secretResolution = (& node scripts/dev/generate-tenant-chat-local-secrets.mjs --resolve-target | Select-Object -Last 1) | ConvertFrom-Json
  $secretDirectory = [string]$secretResolution.directory
  if ([string]::IsNullOrWhiteSpace($secretDirectory)) {
    throw 'Tenant Chat shared secret directory resolution failed.'
  }
  if (-not (Test-Path -LiteralPath $secretDirectory)) {
    & node scripts/dev/generate-tenant-chat-local-secrets.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Tenant Chat shared secret generation failed.' }
  }

  $env:GATELM_TENANT_CHAT_LOCAL_SECRET_DIR = $secretDirectory.Replace('\', '/')
  Write-Host "Tenant Chat shared local secrets: $secretDirectory"
  & docker compose @composeFiles @ComposeArguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed during: $($ComposeArguments -join ' ')"
  }
} finally {
  Pop-Location
}

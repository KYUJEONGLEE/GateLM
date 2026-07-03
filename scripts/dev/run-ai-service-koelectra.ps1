param(
  [string]$BindHost = $(if ($env:AI_SERVICE_HOST) { $env:AI_SERVICE_HOST } else { "127.0.0.1" }),
  [int]$Port = $(if ($env:AI_SERVICE_PORT) { [int]$env:AI_SERVICE_PORT } else { 8001 }),
  [string]$PrimaryModelPath = "",
  [string]$KoelectraModelPath = "",
  [switch]$AllowNetwork,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$aiServiceDir = Join-Path $repoRoot "apps\ai-service"
$pythonExe = Join-Path $aiServiceDir ".venv\Scripts\python.exe"

if ($PrimaryModelPath -eq "") {
  if ($env:AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID) {
    $PrimaryModelPath = $env:AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID
  } else {
    $PrimaryModelPath = Join-Path $aiServiceDir ".cache\huggingface\models\openai--privacy-filter"
  }
}

if ($KoelectraModelPath -eq "") {
  $KoelectraModelPath = Join-Path $aiServiceDir ".cache\huggingface\models\amoeba04--koelectra-small-v3-privacy-ner"
}

$requiredKoelectraModelFiles = @(
  "config.json",
  "model.safetensors",
  "vocab.txt",
  "tokenizer_config.json"
)

$requiredOpenAiModelFiles = @(
  "config.json",
  "model.safetensors",
  "tokenizer.json",
  "tokenizer_config.json"
)

function Assert-FileExists([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label was not found: $Path"
  }
}

function Assert-ModelDirectory([string]$Path, [string]$Label, [string[]]$RequiredFiles) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Label model directory was not found: $Path"
  }
  foreach ($fileName in $RequiredFiles) {
    Assert-FileExists (Join-Path $Path $fileName) "$Label model file"
  }
}

function Test-PortAvailable([int]$LocalPort) {
  $connection = Get-NetTCPConnection -LocalPort $LocalPort -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $connection) {
    $processId = $connection.OwningProcess
    throw "Port $LocalPort is already in use by process $processId. Stop that process or pass a different -Port."
  }
}

Assert-FileExists $pythonExe "AI service virtualenv Python"
Assert-ModelDirectory $PrimaryModelPath "openai/privacy-filter" $requiredOpenAiModelFiles
Assert-ModelDirectory $KoelectraModelPath "KoELECTRA" $requiredKoelectraModelFiles

if (-not $DryRun) {
  Test-PortAvailable $Port
}

$env:AI_SERVICE_HOST = $BindHost
$env:AI_SERVICE_PORT = [string]$Port
$env:AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID = (Resolve-Path -LiteralPath $PrimaryModelPath).Path
$env:AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS = (Resolve-Path -LiteralPath $KoelectraModelPath).Path
$env:PYTHONIOENCODING = "utf-8"

if ($AllowNetwork) {
  Remove-Item Env:\TRANSFORMERS_OFFLINE -ErrorAction SilentlyContinue
} else {
  $env:TRANSFORMERS_OFFLINE = "1"
}

Write-Host ""
Write-Host "GateLM AI Service KoELECTRA Sidecar"
Write-Host "==================================="
Write-Host "Primary detector:    $env:AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID"
Write-Host "Additional detector: $env:AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS"
Write-Host "Offline mode:        $(if ($AllowNetwork) { "disabled" } else { "enabled" })"
Write-Host "URL:                 http://${BindHost}:$Port"
Write-Host ""

if ($DryRun) {
  Write-Host "Dry run complete. The sidecar was not started."
  exit 0
}

Push-Location $aiServiceDir
try {
  & $pythonExe -m app.main
  exit $LASTEXITCODE
} finally {
  Pop-Location
}

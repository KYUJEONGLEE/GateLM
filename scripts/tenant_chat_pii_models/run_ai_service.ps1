param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8001
)

$ErrorActionPreference = "Stop"
$bundleRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (Test-Path (Join-Path $bundleRoot "ai-service")) {
  $aiService = Join-Path $bundleRoot "ai-service"
  $models = Join-Path $bundleRoot "models"
} else {
  $aiService = Join-Path $bundleRoot "apps\ai-service"
  $models = Join-Path $aiService ".cache\onnx"
}
$python = Join-Path $bundleRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "Create the bundle virtualenv first: python -m venv .venv"
}

$env:PYTHONPATH = $aiService
$env:AI_SERVICE_HOST = $BindHost
$env:AI_SERVICE_PORT = [string]$Port
$env:AI_SERVICE_ACCESS_LOG_ENABLED = "false"
$env:AI_SERVICE_TRANSFORMERS_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:HF_HUB_OFFLINE = "1"
$env:AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME = "onnx"
$env:AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID = Join-Path $models "openai--privacy-filter"
$env:AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS = Join-Path $models "amoeba04--koelectra-small-v3-privacy-ner-quantized"

Push-Location $aiService
try {
  & $python -m app.main
  exit $LASTEXITCODE
} finally {
  Pop-Location
}

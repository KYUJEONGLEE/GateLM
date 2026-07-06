$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "gemini-gateway-smoke.mjs"
& node $scriptPath @args
exit $LASTEXITCODE

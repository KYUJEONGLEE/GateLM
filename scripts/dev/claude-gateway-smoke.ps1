$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "claude-gateway-smoke.mjs"
& node $scriptPath @args
exit $LASTEXITCODE

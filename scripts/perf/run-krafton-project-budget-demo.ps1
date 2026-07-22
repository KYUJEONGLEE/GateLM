[CmdletBinding()]
param(
    [ValidateRange(1, 200)]
    [int]$AskLakeRps = 100,

    [ValidateRange(1, 200)]
    [int]$GateLmRps = 50,

    [ValidateRange(1, 200)]
    [int]$SketchCatchRps = 30,

    [ValidatePattern('^[1-9][0-9]*(ms|s|m|h)$')]
    [string]$Duration = '5m',

    [switch]$ExpectAskLakeRateLimit,

    [string]$SecretFilePath = (Join-Path $env:LOCALAPPDATA 'GateLM\krafton-demo-keys.psd1')
)

$ErrorActionPreference = 'Stop'
$productionBaseUrl = 'https://gatelm.co.kr'
$productionAck = 'krafton_three_project_budget_demo'
$k6Image = 'grafana/k6:2.0.0@sha256:a33a0cfdc4d2483d6b7a3a22e726a499ff2831a671a49239104cd34a9937523c'
$scriptPath = Join-Path $PSScriptRoot 'k6-krafton-project-budget-demo.js'
$totalRps = $AskLakeRps + $GateLmRps + $SketchCatchRps
$script:localSecretValues = @{}

if (Test-Path -LiteralPath $SecretFilePath -PathType Leaf) {
    $script:localSecretValues = Import-PowerShellDataFile -LiteralPath $SecretFilePath
}

if ($totalRps -lt 150 -or $totalRps -gt 200) {
    throw "Combined RPS must be between 150 and 200. Current total: $totalRps"
}

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][Security.SecureString]$Value)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Read-SecretEnvironmentValue {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Prompt
    )

    $existing = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        return $existing
    }

    if (
        $script:localSecretValues.ContainsKey($Name) -and
        -not [string]::IsNullOrWhiteSpace([string]$script:localSecretValues[$Name])
    ) {
        return [string]$script:localSecretValues[$Name]
    }

    $secureValue = Read-Host -Prompt $Prompt -AsSecureString
    $plainValue = ConvertFrom-SecureValue -Value $secureValue
    if ([string]::IsNullOrWhiteSpace($plainValue)) {
        throw "$Name is required."
    }
    return $plainValue
}

$managedNames = @(
    'GATELM_ASK_LAKE_API_KEY',
    'GATELM_GATE_API_KEY',
    'GATELM_SKETCH_CATCH_API_KEY',
    'GATELM_GATEWAY_BASE_URL',
    'GATELM_DEMO_DURATION',
    'GATELM_ASK_LAKE_RPS',
    'GATELM_GATE_RPS',
    'GATELM_SKETCH_CATCH_RPS',
    'GATELM_ASK_LAKE_MODEL',
    'GATELM_GATE_MODEL',
    'GATELM_SKETCH_CATCH_MODEL',
    'GATELM_EXPECT_ASK_LAKE_RATE_LIMIT',
    'GATELM_PRODUCTION_DEMO_ACK'
)

$previousValues = @{}
foreach ($name in $managedNames) {
    $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    $env:GATELM_ASK_LAKE_API_KEY = Read-SecretEnvironmentValue `
        -Name 'GATELM_ASK_LAKE_API_KEY' `
        -Prompt 'Ask Lake Gateway API Key'
    $env:GATELM_GATE_API_KEY = Read-SecretEnvironmentValue `
        -Name 'GATELM_GATE_API_KEY' `
        -Prompt 'GateLM Gateway API Key'
    $env:GATELM_SKETCH_CATCH_API_KEY = Read-SecretEnvironmentValue `
        -Name 'GATELM_SKETCH_CATCH_API_KEY' `
        -Prompt 'Sketch Catch Gateway API Key'

    $env:GATELM_GATEWAY_BASE_URL = $productionBaseUrl
    $env:GATELM_DEMO_DURATION = $Duration
    $env:GATELM_ASK_LAKE_RPS = [string]$AskLakeRps
    $env:GATELM_GATE_RPS = [string]$GateLmRps
    $env:GATELM_SKETCH_CATCH_RPS = [string]$SketchCatchRps
    $env:GATELM_ASK_LAKE_MODEL = 'mock-balanced'
    $env:GATELM_GATE_MODEL = 'mock-balanced'
    $env:GATELM_SKETCH_CATCH_MODEL = 'mock-balanced'
    $env:GATELM_EXPECT_ASK_LAKE_RATE_LIMIT = $ExpectAskLakeRateLimit.IsPresent.ToString().ToLowerInvariant()
    $env:GATELM_PRODUCTION_DEMO_ACK = $productionAck

    Write-Host "Target: $productionBaseUrl"
    Write-Host "Load: $totalRps RPS for $Duration (Ask Lake $AskLakeRps / GateLM $GateLmRps / Sketch Catch $SketchCatchRps)"
    Write-Host 'The three API keys will not be printed or passed as command-line values.'

    $k6 = Get-Command k6 -ErrorAction SilentlyContinue
    if ($null -ne $k6) {
        & $k6.Source run $scriptPath
        if ($LASTEXITCODE -ne 0) {
            throw "k6 exited with code $LASTEXITCODE."
        }
        return
    }

    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($null -eq $docker) {
        throw 'Neither k6 nor Docker is available.'
    }

    $mountPath = $PSScriptRoot.Replace('\', '/')
    $dockerArguments = @(
        'run', '--rm',
        '--read-only',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true',
        '--volume', "${mountPath}:/scripts:ro"
    )
    foreach ($name in $managedNames) {
        $dockerArguments += @('--env', $name)
    }
    $dockerArguments += @($k6Image, 'run', '/scripts/k6-krafton-project-budget-demo.js')

    & $docker.Source @dockerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Dockerized k6 exited with code $LASTEXITCODE."
    }
}
finally {
    foreach ($name in $managedNames) {
        [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process')
    }
}

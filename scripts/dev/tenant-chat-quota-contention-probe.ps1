param(
    [ValidateRange(1, 100000)]
    [int]$Operations = 1000,

    [ValidateRange(1, 10)]
    [int]$Repetitions = 3,

    [ValidatePattern('^\d+(,\d+)*$')]
    [string]$Concurrencies = '1,4,8,16,32',

    [ValidatePattern('^[ABC](,[ABC])*$')]
    [string]$Scenarios = 'A,B,C',

    [switch]$Smoke,

    [switch]$DescribeOnly
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gatewayRoot = Join-Path $repoRoot 'apps/gateway-core'
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')
$outputRoot = Join-Path $repoRoot "reports/perf/tenant-chat-quota/$timestamp"
$probeDatabaseName = 'gatelm_quota_probe'

$worktreeLines = @(& git worktree list --porcelain)
$primaryWorktreeLine = $worktreeLines | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1
$primaryRepoRoot = if ($null -eq $primaryWorktreeLine) { $repoRoot } else { $primaryWorktreeLine.Substring('worktree '.Length) }
$repoEnvFile = Join-Path $primaryRepoRoot '.env'
$composeArguments = @('--project-name', 'gatelm-quota-probe')
if (Test-Path -LiteralPath $repoEnvFile) {
    $composeArguments += @('--env-file', $repoEnvFile)
}

function Get-LocalEnvValue([string]$key, [string]$fallback) {
    $processValue = [Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
        return $processValue
    }
    if (Test-Path -LiteralPath $repoEnvFile) {
        $assignment = Get-Content -LiteralPath $repoEnvFile |
            Where-Object { $_ -match "^$([Regex]::Escape($key))=(.*)$" } |
            Select-Object -Last 1
        if ($null -ne $assignment) {
            $value = $assignment.Substring($assignment.IndexOf('=') + 1).Trim()
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return $value
            }
        }
    }
    return $fallback
}

$postgresUser = Get-LocalEnvValue 'POSTGRES_USER' 'gatelm'
$postgresPassword = Get-LocalEnvValue 'POSTGRES_PASSWORD' 'gatelm'
$postgresPort = Get-LocalEnvValue 'GATELM_QUOTA_PROBE_POSTGRES_PORT' '55432'
$env:POSTGRES_PORT = $postgresPort

if ($Smoke -and ($Operations -gt 50 -or $Repetitions -ne 1)) {
    throw '-Smoke is limited to at most 50 operations and exactly one repetition.'
}

function Resolve-ProbeDatabaseUrl {
    $rawUrl = $env:TEST_DATABASE_URL
    if ([string]::IsNullOrWhiteSpace($rawUrl)) {
        $encodedUser = [Uri]::EscapeDataString($postgresUser)
        $encodedPassword = [Uri]::EscapeDataString($postgresPassword)
        return "postgresql://$encodedUser`:$encodedPassword@localhost:$postgresPort/$probeDatabaseName`?schema=public"
    }

    try {
        $uri = [Uri]$rawUrl
    }
    catch {
        throw 'TEST_DATABASE_URL must be a valid PostgreSQL URL.'
    }
    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
        throw 'TEST_DATABASE_URL must use the postgres or postgresql scheme.'
    }
    if ($uri.Host -notin @('localhost', '127.0.0.1', '::1')) {
        throw 'Quota contention probe refuses non-local TEST_DATABASE_URL hosts.'
    }
    if ($uri.Port -ne [int]$postgresPort) {
        throw "Quota contention probe requires the dedicated local PostgreSQL port $postgresPort."
    }
    if ($uri.AbsolutePath.Trim('/') -ne $probeDatabaseName) {
        throw "Quota contention probe requires the dedicated local database '$probeDatabaseName'."
    }
    return $rawUrl
}

function Assert-DockerComposeAvailable {
    & docker compose @composeArguments version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose is required to run the quota contention probe.'
    }
}

function Assert-NoCompetingGateLMServices {
    $runningServices = @(& docker ps --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to inspect running Docker services.'
    }
    $competing = @($runningServices | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and
        $_ -like 'gatelm-*' -and
        $_ -notlike 'gatelm-quota-probe-*'
    })
    if ($competing.Count -gt 0) {
        if ($Smoke) {
            Write-Warning "Smoke probe is running while other GateLM services are active; its timings are not performance evidence: $($competing -join ', ')"
            return
        }
        throw "Stop other GateLM Compose services before measuring PostgreSQL contention: $($competing -join ', ')"
    }
}

function Initialize-ProbeDatabase([string]$databaseUrl) {
    & docker compose @composeArguments up -d postgres
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to start the local PostgreSQL Compose service.'
    }

    $postgresContainerId = (@(& docker compose @composeArguments ps -q postgres) -join '').Trim()
    if ([string]::IsNullOrWhiteSpace($postgresContainerId)) {
        throw 'Could not resolve the quota probe PostgreSQL container.'
    }
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $health = (@(& docker inspect --format '{{.State.Health.Status}}' $postgresContainerId 2>$null) -join '').Trim()
        if ($health -eq 'healthy') {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        throw 'Local PostgreSQL did not become healthy within 30 seconds.'
    }

    $databaseExistsOutput = @(& docker compose @composeArguments exec -T postgres psql -U $postgresUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$probeDatabaseName'")
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to inspect the local quota probe database.'
    }
    $databaseExists = ($databaseExistsOutput -join '').Trim()
    if ($databaseExists -ne '1') {
        & docker compose @composeArguments exec -T postgres createdb -U $postgresUser $probeDatabaseName
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to create the local quota probe database.'
        }
    }

    $previousDatabaseUrl = $env:DATABASE_URL
    try {
        $env:DATABASE_URL = $databaseUrl
        $schemaPath = Join-Path $repoRoot 'apps/control-plane-api/prisma/schema.prisma'
        & corepack pnpm --dir $primaryRepoRoot --filter '@gatelm/control-plane-api' exec prisma migrate deploy --schema $schemaPath
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to apply existing migrations to the local quota probe database.'
        }
    }
    finally {
        $env:DATABASE_URL = $previousDatabaseUrl
    }
}

function Invoke-QuotaProbe([int]$operationCount, [string]$targetDirectory) {
    New-Item -ItemType Directory -Force $targetDirectory | Out-Null
    $env:GATELM_QUOTA_CONTENTION_PROBE = '1'
    $env:GATELM_QUOTA_PROBE_OUTPUT_DIR = $targetDirectory
    $env:GATELM_QUOTA_PROBE_OPERATIONS = $operationCount.ToString()
    $env:GATELM_QUOTA_PROBE_REPETITIONS = $Repetitions.ToString()
    $env:GATELM_QUOTA_PROBE_CONCURRENCIES = $Concurrencies
    $env:GATELM_QUOTA_PROBE_SCENARIOS = $Scenarios
    $env:GATELM_QUOTA_PROBE_COMMIT = (& git rev-parse HEAD).Trim()
    $env:GOCACHE = Join-Path $repoRoot '.tmp/gocache'
    New-Item -ItemType Directory -Force $env:GOCACHE | Out-Null

    $postgresContainerId = (& docker compose @composeArguments ps -q postgres).Trim()
    if ([string]::IsNullOrWhiteSpace($postgresContainerId)) {
        throw 'Could not resolve the local PostgreSQL container for CPU sampling.'
    }
    $statsPath = Join-Path $targetDirectory 'postgres-resource.csv'
    Set-Content -LiteralPath $statsPath -Value 'timestamp_utc,cpu_percent,memory_usage'
    $statsJob = Start-Job -ScriptBlock {
        param($containerId, $path)
        while ($true) {
            $sample = (& docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' $containerId 2>$null)
            if (-not [string]::IsNullOrWhiteSpace($sample)) {
                $now = [DateTimeOffset]::UtcNow.ToString('o')
                Add-Content -LiteralPath $path -Value "$now,$sample"
            }
            Start-Sleep -Seconds 1
        }
    } -ArgumentList $postgresContainerId, $statsPath

    Push-Location $gatewayRoot
    try {
        & go test ./internal/adapters/tenantchat/usage/postgres `
            -run '^TestTenantChatQuotaContentionProbeIntegration$' `
            -count=1 -timeout 50m -v | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw 'Tenant Chat quota contention probe failed before producing a valid result.'
        }
    }
    finally {
        Pop-Location
        Stop-Job -Job $statsJob -ErrorAction SilentlyContinue
        Receive-Job -Job $statsJob -ErrorAction SilentlyContinue | Out-Null
        Remove-Job -Job $statsJob -Force -ErrorAction SilentlyContinue
    }

    $summaryPath = Join-Path $targetDirectory 'summary.json'
    if (-not (Test-Path -LiteralPath $summaryPath)) {
        throw "Quota contention probe did not write $summaryPath."
    }
    return Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
}

$probeDatabaseUrl = Resolve-ProbeDatabaseUrl

Write-Host ''
Write-Host 'Tenant Chat Token Quota Contention Probe'
Write-Host '========================================'
Write-Host "Repository: $repoRoot"
Write-Host "Operations/run: $Operations"
Write-Host "Repetitions: $Repetitions"
Write-Host "Concurrencies: $Concurrencies"
Write-Host "Scenarios: $Scenarios"
Write-Host "Smoke mode: $($Smoke.IsPresent)"
Write-Host "Output: $outputRoot"
Write-Host "Database: local dedicated gatelm_quota_probe on port $postgresPort (credentials hidden)"
Write-Host ''

if ($DescribeOnly) {
    Write-Host 'DescribeOnly: no services, database, migrations, or tests were changed.'
    exit 0
}

Push-Location $repoRoot
try {
    Assert-DockerComposeAvailable
    Assert-NoCompetingGateLMServices
    Initialize-ProbeDatabase $probeDatabaseUrl
    $env:TEST_DATABASE_URL = $probeDatabaseUrl

    $summary = Invoke-QuotaProbe $Operations $outputRoot
    Write-Host ''
    Write-Host "Decision: $($summary.decision)"
    Write-Host "Summary: $(Join-Path $outputRoot 'summary.md')"

    if ($summary.decision -eq 'AMBIGUOUS_RERUN_5000' -and $Operations -eq 1000) {
        $rerunOutput = Join-Path $outputRoot 'rerun-5000'
        Write-Host ''
        Write-Host 'Ambiguous 20-30% signal detected. Running the single 5,000-operation confirmation pass.'
        $rerunSummary = Invoke-QuotaProbe 5000 $rerunOutput
        Write-Host "Rerun decision: $($rerunSummary.decision)"
        Write-Host "Rerun summary: $(Join-Path $rerunOutput 'summary.md')"
    }
}
finally {
    Pop-Location
}

param(
    [switch]$SkipDockerUp,
    [switch]$HardResetDay5Logs
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Wait-Postgres {
    for ($i = 0; $i -lt 30; $i++) {
        & docker compose exec -T postgres pg_isready -U gatelm -d gatelm *> $null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "postgres did not become ready"
}

function Wait-Redis {
    for ($i = 0; $i -lt 30; $i++) {
        $result = & docker compose exec -T redis redis-cli ping 2>$null
        if ($LASTEXITCODE -eq 0 -and ([string]$result).Trim() -eq "PONG") {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "redis did not become ready"
}

function Wait-MockProvider {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)

    $healthUrl = $BaseUrl.TrimEnd("/") + "/healthz"
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $response = Invoke-RestMethod -Method Get -Uri $healthUrl
            if ($response.status -eq "ok") {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "mock provider did not become ready at $healthUrl"
}

function Invoke-SqlFiles {
    param([Parameter(Mandatory = $true)][string[]]$SqlFiles)

    Get-Content -LiteralPath $SqlFiles |
        docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1

    if ($LASTEXITCODE -ne 0) {
        throw "migration/seed failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$mockProviderBaseUrl = $env:MOCK_PROVIDER_BASE_URL
if ([string]::IsNullOrWhiteSpace($mockProviderBaseUrl)) {
    $mockProviderBaseUrl = "http://localhost:8090"
}

Push-Location $repoRoot
try {
    Write-Host "GateLM Day5 demo reset"
    Write-Host "repo:         $repoRoot"
    Write-Host "mockProvider: $mockProviderBaseUrl"

    if (-not $SkipDockerUp) {
        Write-Host ""
        Write-Host "== start docker services =="
        Invoke-Docker -Arguments @("compose", "up", "-d", "postgres", "redis", "mock-provider")
    }

    Write-Host ""
    Write-Host "== wait services =="
    Wait-Postgres
    Wait-Redis
    Wait-MockProvider -BaseUrl $mockProviderBaseUrl
    Write-Host "services ready"

    Write-Host ""
    Write-Host "== apply migrations and seed =="
    $sqlFiles = @(
        "db/migrations/001_create_identity_tables.sql",
        "db/migrations/002_create_project_tables.sql",
        "db/migrations/003_create_gateway_credentials.sql",
        "db/migrations/004_create_provider_and_models.sql",
        "db/migrations/005_harden_config_store_constraints.sql",
        "db/migrations/006_create_p0_invocation_logs_fallback.sql",
        "db/migrations/016_add_p0_invocation_log_ttft.sql",
        "db/migrations/017_add_p0_dashboard_rollup_indexes.sql",
        "db/seeds/001_seed_p0_demo_data.sql"
    )
    Invoke-SqlFiles -SqlFiles $sqlFiles

    if ($HardResetDay5Logs) {
        Write-Host ""
        Write-Host "== delete day5-* logs =="
        Invoke-Docker -Arguments @(
            "compose", "exec", "-T", "postgres",
            "psql", "-U", "gatelm", "-d", "gatelm", "-v", "ON_ERROR_STOP=1",
            "-c", "delete from p0_llm_invocation_logs where feature_id like 'day5-%';"
        )
    }

    Write-Host ""
    Write-Host "== reset redis exact cache =="
    Invoke-Docker -Arguments @("compose", "exec", "-T", "redis", "redis-cli", "FLUSHDB")

    Write-Host ""
    Write-Host "== reset mock provider stats =="
    $resetUrl = $mockProviderBaseUrl.TrimEnd("/") + "/__mock/reset"
    Invoke-RestMethod -Method Post -Uri $resetUrl -Body "{}" -ContentType "application/json" | Out-Null

    Write-Host ""
    Write-Host "Day5 demo reset completed"
}
finally {
    Pop-Location
}

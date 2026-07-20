param(
    [string]$ControlPlaneBaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_BASE_URL)) { "http://localhost:3001" } else { $env:CONTROL_PLANE_BASE_URL }),
    [string]$GatewayBaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:GATEWAY_BASE_URL)) { "http://localhost:8080" } else { $env:GATEWAY_BASE_URL }),
    [string]$MockProviderBaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:MOCK_PROVIDER_BASE_URL)) { "http://localhost:8090" } else { $env:MOCK_PROVIDER_BASE_URL }),
    [switch]$SkipDockerUp,
    [switch]$SkipPrismaMigrate,
    [switch]$SkipGatewaySqlMigrations,
    [switch]$CheckApps,
    [switch]$RequireActiveSnapshot,
    [switch]$DescribeOnly
)

# v2.0.1 P0 bootstrap gate.
# This script prepares/checks dependencies and migration prerequisites only.
# It does not print raw credentials and skipped gates are not counted as E2E success.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Convert-ToSafeArray {
    param($Value)

    if ($null -eq $Value) {
        return ,@()
    }

    return ,@($Value | Where-Object { $null -ne $_ })
}

function Join-Url {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Import-RepoDotEnv {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
            continue
        }

        $separator = $trimmed.IndexOf("=")
        if ($separator -le 0) {
            continue
        }

        $key = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key, "Process"))) {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

function Set-DefaultEnv {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name, "Process"))) {
        [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
    }
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "required command not found: $Name"
    }
    return $command.Source
}

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Wait-Postgres {
    for ($i = 0; $i -lt 45; $i++) {
        & docker compose exec -T postgres pg_isready -U gatelm -d gatelm *> $null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "postgres did not become ready"
}

function Wait-Redis {
    for ($i = 0; $i -lt 45; $i++) {
        $result = & docker compose exec -T redis redis-cli ping 2>$null
        if ($LASTEXITCODE -eq 0 -and ([string]$result).Trim() -eq "PONG") {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "redis did not become ready"
}

function Invoke-StatusCode {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Uri -TimeoutSec 5
        return [int]$response.StatusCode
    }
    catch {
        $errorResponse = $null
        $exception = $_.Exception
        if ($null -ne $exception) {
            $responseProperty = $exception.PSObject.Properties["Response"]
            if ($null -ne $responseProperty) {
                $errorResponse = $responseProperty.Value
            }
        }
        if ($null -ne $errorResponse) {
            return [int]$errorResponse.StatusCode
        }
        throw
    }
}

function Wait-HttpOk {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Uri
    )

    for ($i = 0; $i -lt 45; $i++) {
        try {
            $statusCode = Invoke-StatusCode -Uri $Uri
            if ($statusCode -eq 200) {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "$Name did not become ready at $Uri"
}

function Invoke-PostgresQuery {
    param([Parameter(Mandatory = $true)][string]$Sql)

    $Sql | docker compose exec -T postgres psql -U gatelm -d gatelm -t -A -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) {
        throw "postgres query failed"
    }
}

function Invoke-GatewaySqlFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    Get-Content -LiteralPath $Path |
        docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1

    if ($LASTEXITCODE -ne 0) {
        throw "gateway SQL migration failed: $Path"
    }
}

function Invoke-PrismaMigrateDeploy {
    Push-Location (Join-Path $repoRoot "apps/control-plane-api")
    try {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $output = & corepack pnpm exec prisma migrate deploy 2>&1
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }

        $lines = Convert-ToSafeArray -Value ($output | ForEach-Object { [string]$_ })
        foreach ($line in $lines) {
            Write-Host $line
        }

        if ($exitCode -ne 0) {
            $joinedOutput = $lines -join "`n"
            if ($joinedOutput -match "P3005") {
                throw "prisma migrate deploy failed because the database schema is not empty but not baselined for Prisma migrations. Use a fresh DB/reset/baseline before claiming live bootstrap evidence. Do not treat -SkipPrismaMigrate as E2E success unless required Prisma tables already exist."
            }
            throw "prisma migrate deploy failed with exit code $exitCode"
        }
    }
    finally {
        Pop-Location
    }
}

function Assert-RequiredTables {
    $requiredTables = @(
        "tenants",
        "projects",
        "applications",
        "provider_connections",
        "gateway_api_keys",
        "app_tokens",
        "runtime_configs",
        "runtime_snapshots",
        "active_runtime_snapshots",
        "p0_llm_invocation_logs",
        "gateway_rate_limit_counters",
        "budget_quotas",
        "budget_ledger_entries",
        "gateway_rate_limit_scope_counters"
    )

    $quoted = ($requiredTables | ForEach-Object { "'$_'" }) -join ", "
    $sql = @"
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ($quoted)
order by table_name;
"@
    $queryResult = Invoke-PostgresQuery -Sql $sql | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $existing = Convert-ToSafeArray -Value $queryResult
    $filteredMissing = $requiredTables | Where-Object { $existing -notcontains $_ }
    $missing = Convert-ToSafeArray -Value $filteredMissing
    if ($missing.Count -gt 0) {
        throw "missing required P0 tables: $($missing -join ', ')"
    }
}

function Assert-ActiveSnapshotPointer {
    $sql = @"
select count(*)::text
from active_runtime_snapshots ars
join runtime_snapshots rs
  on rs.id = ars."runtimeSnapshotId"
 and rs."tenantId" = ars."tenantId"
 and rs."projectId" = ars."projectId"
 and rs."applicationId" = ars."applicationId";
"@
    $count = [int]((Invoke-PostgresQuery -Sql $sql | Select-Object -First 1).Trim())
    if ($count -lt 1) {
        throw "no persisted active RuntimeSnapshot pointer found"
    }
}

function Write-Gate {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Status
    )

    Write-Host ("{0,-32} {1}" -f $Name, $Status)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path

Push-Location $repoRoot
try {
    Import-RepoDotEnv -Path (Join-Path $repoRoot ".env")
    Set-DefaultEnv -Name "DATABASE_URL" -Value "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public"
    Set-DefaultEnv -Name "REDIS_URL" -Value "redis://localhost:6379"
    Set-DefaultEnv -Name "CONTROL_PLANE_ADMIN_AUTH_MODE" -Value "demo_admin_placeholder"

    Write-Host ""
    Write-Host "GateLM v2.0.1 P0 bootstrap check"
    Write-Host "=================================="
    Write-Host "repo:          $repoRoot"
    Write-Host "controlPlane:  $ControlPlaneBaseUrl"
    Write-Host "gateway:       $GatewayBaseUrl"
    Write-Host "mockProvider:  $MockProviderBaseUrl"
    Write-Host "checkApps:     $CheckApps"
    Write-Host "requireActive: $RequireActiveSnapshot"
    Write-Host ""

    if ($DescribeOnly) {
        Write-Host "DescribeOnly mode. No Docker, DB, migration, HTTP, or app readiness command will run."
        Write-Host ""
        Write-Host "P0 bootstrap gates:"
        Write-Gate -Name "tooling" -Status "requires docker + corepack"
        Write-Gate -Name "dependencies" -Status "postgres + redis + mock-provider"
        Write-Gate -Name "prisma migrations" -Status "control-plane schema"
        Write-Gate -Name "gateway SQL migrations" -Status "logs + rate-limit + budget ledger tables"
        Write-Gate -Name "required tables" -Status "Prisma + Gateway SQL tables"
        Write-Gate -Name "active snapshot pointer" -Status "required only with -RequireActiveSnapshot"
        Write-Gate -Name "app readiness" -Status "required only with -CheckApps"
        Write-Host ""
        Write-Host "Skipped gates are not counted as E2E success."
        exit 0
    }

    Assert-Command -Name "docker" | Out-Null
    Assert-Command -Name "corepack" | Out-Null
    Write-Gate -Name "tooling" -Status "ok"

    if (-not $SkipDockerUp) {
        Invoke-Docker -Arguments @("compose", "up", "-d", "postgres", "redis", "mock-provider")
    }
    else {
        Write-Gate -Name "docker compose up" -Status "skipped"
    }

    Wait-Postgres
    Wait-Redis
    Wait-HttpOk -Name "mock-provider" -Uri (Join-Url $MockProviderBaseUrl "/healthz")
    Write-Gate -Name "dependencies" -Status "ok"

    if (-not $SkipPrismaMigrate) {
        Invoke-PrismaMigrateDeploy
        Write-Gate -Name "prisma migrations" -Status "executed"
    }
    else {
        Write-Gate -Name "prisma migrations" -Status "skipped"
    }

    if (-not $SkipGatewaySqlMigrations) {
        $gatewaySqlFiles = @(
            "db/migrations/006_create_p0_invocation_logs_fallback.sql",
            "db/migrations/007_create_gateway_rate_limit_counters.sql",
            "db/migrations/008_alter_gateway_rate_limit_counters_cascade.sql",
            "db/migrations/009_alter_p0_invocation_logs_api_key_fk.sql",
            "db/migrations/010_create_budget_ledger.sql",
            "db/migrations/011_create_gateway_rate_limit_scope_counters.sql",
            "db/migrations/016_add_p0_invocation_log_ttft.sql",
            "db/migrations/017_add_p0_dashboard_rollup_indexes.sql",
            "db/migrations/018_prepare_p0_monthly_partitioning.sql"
        )
        foreach ($file in $gatewaySqlFiles) {
            Invoke-GatewaySqlFile -Path $file
        }
        Write-Gate -Name "gateway SQL migrations" -Status "executed"
    }
    else {
        Write-Gate -Name "gateway SQL migrations" -Status "skipped"
    }

    Assert-RequiredTables
    Write-Gate -Name "required tables" -Status "ok"

    if ($RequireActiveSnapshot) {
        Assert-ActiveSnapshotPointer
        Write-Gate -Name "active snapshot pointer" -Status "ok"
    }
    else {
        Write-Gate -Name "active snapshot pointer" -Status "skipped (use -RequireActiveSnapshot after product bootstrap/publish)"
    }

    if ($CheckApps) {
        Wait-HttpOk -Name "control-plane healthz" -Uri (Join-Url $ControlPlaneBaseUrl "/healthz")
        Wait-HttpOk -Name "control-plane readyz" -Uri (Join-Url $ControlPlaneBaseUrl "/readyz")
        Wait-HttpOk -Name "gateway healthz" -Uri (Join-Url $GatewayBaseUrl "/healthz")
        Wait-HttpOk -Name "gateway readyz" -Uri (Join-Url $GatewayBaseUrl "/readyz")
        Write-Gate -Name "app readiness" -Status "ok"
    }
    else {
        Write-Gate -Name "app readiness" -Status "skipped (use -CheckApps when Control Plane and Gateway are running)"
    }

    Write-Host ""
    Write-Host "P0 bootstrap gates completed. Skipped gates are not counted as E2E success."
}
finally {
    Pop-Location
}

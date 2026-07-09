param(
    [string]$BaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_DEV_BASE_URL)) { "http://127.0.0.1:3000" } else { $env:GATELM_WEB_DEV_BASE_URL }),
    [int]$ReadyTimeoutSeconds = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_DEV_READY_TIMEOUT_SECONDS)) { 120 } else { [int]$env:GATELM_WEB_DEV_READY_TIMEOUT_SECONDS })
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Convert-ToSafeArray {
    param([AllowNull()]$InputObject)

    if ($null -eq $InputObject) {
        return ,@()
    }

    return ,@($InputObject | Where-Object { $null -ne $_ })
}

function Resolve-PnpmRunner {
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if ($null -ne $corepack) {
        return [pscustomobject]@{
            FilePath = $corepack.Source
            Arguments = @("pnpm", "--filter", "@gatelm/web", "dev")
            CommandText = "corepack pnpm --filter @gatelm/web dev"
        }
    }

    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($null -ne $pnpm) {
        return [pscustomobject]@{
            FilePath = $pnpm.Source
            Arguments = @("--filter", "@gatelm/web", "dev")
            CommandText = "pnpm --filter @gatelm/web dev"
        }
    }

    throw "required command not found: corepack or pnpm"
}

function Read-LogLines {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return ,@()
    }

    return Convert-ToSafeArray (Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)
}

function Wait-ForLogLine {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $lines = Read-LogLines -Path $Path
        if ($lines | Where-Object { $_ -match $Pattern } | Select-Object -First 1) {
            return
        }

        if ($Process.HasExited) {
            throw "apps/web dev server exited with code $($Process.ExitCode)."
        }

        Start-Sleep -Milliseconds 500
    }

    throw "apps/web dev server did not become ready after ${TimeoutSeconds}s."
}

function Write-NewLogLines {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ref]$Cursor,
        [Parameter(Mandatory = $true)][string]$Prefix
    )

    $lines = Read-LogLines -Path $Path
    for ($index = [int]$Cursor.Value; $index -lt $lines.Count; $index++) {
        if ($Prefix) {
            Write-Host "$Prefix$($lines[$index])"
        }
        else {
            Write-Host $lines[$index]
        }
    }
    $Cursor.Value = $lines.Count
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $children = Convert-ToSafeArray (Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$runId = "web_dev_prewarm_" + (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) "$runId.out.log"
$stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) "$runId.err.log"
$stdoutCursor = 0
$stderrCursor = 0
$process = $null

Push-Location $repoRoot
try {
    $runner = Resolve-PnpmRunner
    Write-Host "GateLM apps/web dev with route prewarm"
    Write-Host "command: $($runner.CommandText)"
    Write-Host "baseUrl: $($BaseUrl.TrimEnd("/"))"

    $process = Start-Process `
        -FilePath $runner.FilePath `
        -ArgumentList $runner.Arguments `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    Wait-ForLogLine -Path $stdoutPath -Pattern "Ready in" -TimeoutSeconds $ReadyTimeoutSeconds -Process $process
    Write-NewLogLines -Path $stdoutPath -Cursor ([ref]$stdoutCursor) -Prefix ""
    Write-NewLogLines -Path $stderrPath -Cursor ([ref]$stderrCursor) -Prefix "stderr: "

    try {
        & (Join-Path $PSScriptRoot "web-route-prewarm.ps1") -BaseUrl $BaseUrl
    }
    catch {
        Write-Warning "Route prewarm failed; keeping apps/web dev server running. $($_.Exception.Message)"
    }

    while (-not $process.HasExited) {
        Write-NewLogLines -Path $stdoutPath -Cursor ([ref]$stdoutCursor) -Prefix ""
        Write-NewLogLines -Path $stderrPath -Cursor ([ref]$stderrCursor) -Prefix "stderr: "
        Start-Sleep -Milliseconds 500
    }

    Write-NewLogLines -Path $stdoutPath -Cursor ([ref]$stdoutCursor) -Prefix ""
    Write-NewLogLines -Path $stderrPath -Cursor ([ref]$stderrCursor) -Prefix "stderr: "
    exit $process.ExitCode
}
finally {
    Pop-Location

    if ($null -ne $process -and -not $process.HasExited) {
        Stop-ProcessTree -ProcessId $process.Id
    }

    Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
}

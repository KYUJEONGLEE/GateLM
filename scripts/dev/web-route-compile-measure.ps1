param(
    [string]$BaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_BASE_URL)) { "http://127.0.0.1:3000" } else { $env:GATELM_WEB_ROUTE_COMPILE_BASE_URL }),
    [string]$TenantId = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_TENANT_ID)) { "00000000-0000-4000-8000-000000000100" } else { $env:GATELM_WEB_ROUTE_COMPILE_TENANT_ID }),
    [string]$ProjectId = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_PROJECT_ID)) { "00000000-0000-4000-8000-000000000200" } else { $env:GATELM_WEB_ROUTE_COMPILE_PROJECT_ID }),
    [string]$ApplicationId = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_APPLICATION_ID)) { "00000000-0000-4000-8000-000000000300" } else { $env:GATELM_WEB_ROUTE_COMPILE_APPLICATION_ID }),
    [string]$ReportDir = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_REPORT_DIR)) { "reports/web-route-compile" } else { $env:GATELM_WEB_ROUTE_COMPILE_REPORT_DIR }),
    [string]$ConsoleProbeCookieName = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_CONSOLE_PROBE_COOKIE_NAME)) { "gatelm_session" } else { $env:GATELM_WEB_ROUTE_COMPILE_CONSOLE_PROBE_COOKIE_NAME }),
    [int]$ReadyTimeoutSeconds = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_READY_TIMEOUT_SECONDS)) { 120 } else { [int]$env:GATELM_WEB_ROUTE_COMPILE_READY_TIMEOUT_SECONDS }),
    [int]$RouteTimeoutSeconds = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_COMPILE_ROUTE_TIMEOUT_SECONDS)) { 180 } else { [int]$env:GATELM_WEB_ROUTE_COMPILE_ROUTE_TIMEOUT_SECONDS }),
    [switch]$DisableConsoleProbeCookie,
    [switch]$KeepRawLogs
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Get-TimestampId {
    return (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "required command not found: $Name"
    }

    return $command.Source
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

function Resolve-CurlRunner {
    $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $curl) {
        return $curl.Source
    }

    $curl = Get-Command curl -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $curl) {
        return $curl.Source
    }

    throw "required command not found: curl or curl.exe"
}

function Join-UrlPath {
    param(
        [Parameter(Mandatory = $true)][string]$RootUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($RootUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Test-HttpEndpointAcceptsConnection {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2 | Out-Null
        return $true
    }
    catch {
        $response = Get-ErrorResponse -ErrorRecord $_
        return ($null -ne $response)
    }
}

function Get-ErrorResponse {
    param([Parameter(Mandatory = $true)]$ErrorRecord)

    $exception = $ErrorRecord.Exception
    if ($null -eq $exception) {
        return $null
    }

    $responseProperty = $exception.PSObject.Properties["Response"]
    if ($null -eq $responseProperty) {
        return $null
    }

    return $responseProperty.Value
}

function Read-LogLines {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    return @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)
}

function Wait-ForLogLine {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $lines = Read-LogLines -Path $Path
        if ($lines | Where-Object { $_ -match $Pattern } | Select-Object -First 1) {
            return
        }

        if ($Process.HasExited) {
            throw "$FailureMessage Process exited with code $($Process.ExitCode)."
        }

        Start-Sleep -Milliseconds 500
    }

    throw "$FailureMessage Timed out after ${TimeoutSeconds}s."
}

function New-RouteRequestRow {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Probe,
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$TransportError,
        [Parameter(Mandatory = $true)][datetime]$StartedAt
    )

    return [pscustomobject]@{
        Label = $Label
        Uri = $Uri
        Probe = $Probe
        StatusCode = $StatusCode
        TransportError = $TransportError
        StartedAt = $StartedAt.ToString("o")
        FinishedAt = (Get-Date).ToString("o")
    }
}

function Invoke-RouteRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][bool]$UseConsoleProbeCookie,
        [Parameter(Mandatory = $true)][string]$ConsoleProbeCookieName
    )

    $startedAt = Get-Date
    if ($UseConsoleProbeCookie) {
        $curl = Resolve-CurlRunner
        $nullDevice = if ([System.IO.Path]::DirectorySeparatorChar -eq "\") { "NUL" } else { "/dev/null" }
        $cookie = "$ConsoleProbeCookieName=route_compile_probe"
        $curlArgs = @(
            "-sS",
            "-o",
            $nullDevice,
            "-w",
            "%{http_code}",
            "--max-time",
            [string]$TimeoutSeconds,
            "--cookie",
            $cookie,
            $Uri
        )

        $statusText = (& $curl @curlArgs) -join ""
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            return New-RouteRequestRow `
                -Label $Label `
                -Uri $Uri `
                -Probe "console-cookie" `
                -StatusCode 0 `
                -TransportError "curl_exit_$exitCode" `
                -StartedAt $startedAt
        }

        $statusCode = 0
        if (-not [int]::TryParse($statusText.Trim(), [ref]$statusCode)) {
            $statusCode = 0
        }

        return New-RouteRequestRow `
            -Label $Label `
            -Uri $Uri `
            -Probe "console-cookie" `
            -StatusCode $statusCode `
            -TransportError "" `
            -StartedAt $startedAt
    }

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec $TimeoutSeconds
        return New-RouteRequestRow `
            -Label $Label `
            -Uri $Uri `
            -Probe "none" `
            -StatusCode ([int]$response.StatusCode) `
            -TransportError "" `
            -StartedAt $startedAt
    }
    catch {
        $response = Get-ErrorResponse -ErrorRecord $_
        if ($null -ne $response) {
            return New-RouteRequestRow `
                -Label $Label `
                -Uri $Uri `
                -Probe "none" `
                -StatusCode ([int]$response.StatusCode) `
                -TransportError "" `
                -StartedAt $startedAt
        }

        return New-RouteRequestRow `
            -Label $Label `
            -Uri $Uri `
            -Probe "none" `
            -StatusCode 0 `
            -TransportError "request_failed" `
            -StartedAt $startedAt
    }
}

function Get-InterestingLogLines {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Lines)

    return @(
        $Lines |
            Where-Object {
                ($_ -match "Compiled\s+.+\s+in\s+[0-9.]+(ms|s)\s+\([0-9]+\s+modules\)") -or
                ($_ -match "GET\s+/\S*\s+[0-9]{3}\s+in\s+[0-9]+ms")
            } |
            ForEach-Object { $_.Trim() }
    )
}

function ConvertTo-CompileRows {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Lines)

    $rows = @()
    foreach ($line in $Lines) {
        if ($line -match "Compiled\s+(?<route>/\S*)\s+in\s+(?<duration>[0-9.]+(?:ms|s))\s+\((?<modules>[0-9]+)\s+modules\)") {
            $rows += [pscustomobject]@{
                Route = $Matches.route
                Duration = $Matches.duration
                Modules = [int]$Matches.modules
                RawLine = $line
            }
        }
    }

    return $rows
}

function ConvertTo-GetRows {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Lines)

    $rows = @()
    foreach ($line in $Lines) {
        if ($line -match "GET\s+(?<path>/\S*)\s+(?<status>[0-9]{3})\s+in\s+(?<durationMs>[0-9]+)ms") {
            $rows += [pscustomobject]@{
                Path = $Matches.path
                Status = [int]$Matches.status
                DurationMs = [int]$Matches.durationMs
                RawLine = $line
            }
        }
    }

    return $rows
}

function ConvertTo-MarkdownCell {
    param([AllowNull()][object]$Value)

    if ($null -eq $Value) {
        return ""
    }

    return ([string]$Value).Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
}

function Format-DisplayPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RootPath
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd("\", "/")
    $prefix = $fullRoot + [System.IO.Path]::DirectorySeparatorChar

    if ($fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath.Substring($prefix.Length)
    }

    return $fullPath
}

function Add-MarkdownTable {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [Parameter(Mandatory = $true)][string[]]$Headers,
        [Parameter(Mandatory = $true)][object[]]$Rows,
        [Parameter(Mandatory = $true)][string[]]$Properties
    )

    if ($null -eq $Lines) {
        throw "Lines is required."
    }

    $Lines.Add("| " + (($Headers | ForEach-Object { ConvertTo-MarkdownCell $_ }) -join " | ") + " |")
    $Lines.Add("| " + (($Headers | ForEach-Object { "---" }) -join " | ") + " |")
    foreach ($row in $Rows) {
        $cells = foreach ($property in $Properties) {
            ConvertTo-MarkdownCell $row.$property
        }
        $Lines.Add("| " + ($cells -join " | ") + " |")
    }
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$runId = "web_route_compile_" + (Get-TimestampId)
$stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) "$runId.out.log"
$stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) "$runId.err.log"
$process = $null
$BaseUrl = $BaseUrl.TrimEnd("/")
$consoleProbeMode = if ($DisableConsoleProbeCookie) { "disabled" } else { "enabled for protected console routes; value intentionally omitted" }

$routes = @(
    [pscustomobject]@{
        Label = "home"
        Path = "/"
        RoutePattern = "/"
        UseConsoleProbeCookie = $false
    },
    [pscustomobject]@{
        Label = "dashboard"
        Path = "/tenants/$TenantId/dashboard"
        RoutePattern = "/tenants/[tenantId]/dashboard"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    },
    [pscustomobject]@{
        Label = "request logs"
        Path = "/tenants/$TenantId/request-logs"
        RoutePattern = "/tenants/[tenantId]/request-logs"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    },
    [pscustomobject]@{
        Label = "analytics"
        Path = "/tenants/$TenantId/analytics"
        RoutePattern = "/tenants/[tenantId]/analytics"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    },
    [pscustomobject]@{
        Label = "alerts"
        Path = "/tenants/$TenantId/alerts"
        RoutePattern = "/tenants/[tenantId]/alerts"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    },
    [pscustomobject]@{
        Label = "projects"
        Path = "/tenants/$TenantId/projects"
        RoutePattern = "/tenants/[tenantId]/projects"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    },
    [pscustomobject]@{
        Label = "provider connections"
        Path = "/tenants/$TenantId/provider-connections"
        RoutePattern = "/tenants/[tenantId]/provider-connections"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    },
    [pscustomobject]@{
        Label = "project policies"
        Path = "/tenants/$TenantId/projects/$ProjectId/policies"
        RoutePattern = "/tenants/[tenantId]/projects/[projectId]/policies"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    },
    [pscustomobject]@{
        Label = "application policies"
        Path = "/tenants/$TenantId/projects/$ProjectId/applications/$ApplicationId/policies"
        RoutePattern = "/tenants/[tenantId]/projects/[projectId]/applications/[applicationId]/policies"
        UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie)
    }
)

Push-Location $repoRoot
try {
    $runner = Resolve-PnpmRunner
    $reportRoot = if ([System.IO.Path]::IsPathRooted($ReportDir)) {
        $ReportDir
    }
    else {
        Join-Path $repoRoot $ReportDir
    }
    New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null

    if (Test-HttpEndpointAcceptsConnection -Uri $BaseUrl) {
        throw "$BaseUrl is already responding. Stop the existing apps/web server before measuring a cold-start route compile."
    }

    Write-Host ""
    Write-Host "GateLM apps/web route compile measurement"
    Write-Host "========================================="
    Write-Host "runId:      $runId"
    Write-Host "baseUrl:    $BaseUrl"
    Write-Host "command:    $($runner.CommandText)"
    Write-Host "reportDir:  $ReportDir"
    Write-Host "probe:      $consoleProbeMode"
    Write-Host ""

    $process = Start-Process `
        -FilePath $runner.FilePath `
        -ArgumentList $runner.Arguments `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    Wait-ForLogLine `
        -Path $stdoutPath `
        -Pattern "Ready in" `
        -TimeoutSeconds $ReadyTimeoutSeconds `
        -Process $process `
        -FailureMessage "apps/web dev server did not become ready."

    $requestRows = @()
    foreach ($route in $routes) {
        $uri = Join-UrlPath -RootUrl $BaseUrl -Path $route.Path
        Write-Host ("requesting: {0} {1}" -f $route.Label, $route.Path)
        $requestRows += Invoke-RouteRequest `
            -Label $route.Label `
            -Uri $uri `
            -TimeoutSeconds $RouteTimeoutSeconds `
            -UseConsoleProbeCookie ([bool]$route.UseConsoleProbeCookie) `
            -ConsoleProbeCookieName $ConsoleProbeCookieName

        $routePattern = [regex]::Escape("Compiled $($route.RoutePattern)")
        $requestPattern = [regex]::Escape("GET $($route.Path)") -replace "\\\?", "\?"
        Wait-ForLogLine `
            -Path $stdoutPath `
            -Pattern "($routePattern|$requestPattern)" `
            -TimeoutSeconds $RouteTimeoutSeconds `
            -Process $process `
            -FailureMessage "No route evidence appeared for $($route.Label)."
    }

    Start-Sleep -Seconds 1
    $stdoutLines = Read-LogLines -Path $stdoutPath
    $interestingLines = Get-InterestingLogLines -Lines $stdoutLines
    $compileRows = @(ConvertTo-CompileRows -Lines $interestingLines)
    $getRows = @(ConvertTo-GetRows -Lines $interestingLines)

    if ($interestingLines.Count -eq 0) {
        throw "No compile or request evidence was captured from the dev server log."
    }

    $generatedAt = (Get-Date).ToString("o")
    $reportLines = [System.Collections.Generic.List[string]]::new()
    $reportLines.Add("# apps/web Route Compile Measurement")
    $reportLines.Add("")
    $reportLines.Add("| Item | Value |")
    $reportLines.Add("|---|---|")
    $reportLines.Add("| Generated at | $(ConvertTo-MarkdownCell $generatedAt) |")
    $reportLines.Add("| Run ID | $(ConvertTo-MarkdownCell $runId) |")
    $reportLines.Add("| Base URL | $(ConvertTo-MarkdownCell $BaseUrl) |")
    $reportLines.Add("| Command | $(ConvertTo-MarkdownCell $runner.CommandText) |")
    $reportLines.Add("| Baseline doc | docs/testing/web-route-compile-baseline.md |")
    $reportLines.Add("| Console route probe | $(ConvertTo-MarkdownCell $consoleProbeMode) |")
    $reportLines.Add("")
    $reportLines.Add("## Requested Routes")
    $reportLines.Add("")
    Add-MarkdownTable `
        -Lines $reportLines `
        -Headers @("Label", "URI", "Probe", "StatusCode", "TransportError", "StartedAt", "FinishedAt") `
        -Rows $requestRows `
        -Properties @("Label", "Uri", "Probe", "StatusCode", "TransportError", "StartedAt", "FinishedAt")
    $reportLines.Add("")
    $reportLines.Add("## Compile Lines")
    $reportLines.Add("")
    if ($compileRows.Count -gt 0) {
        Add-MarkdownTable `
            -Lines $reportLines `
            -Headers @("Route", "Duration", "Modules", "RawLine") `
            -Rows $compileRows `
            -Properties @("Route", "Duration", "Modules", "RawLine")
    }
    else {
        $reportLines.Add("No route compile lines were parsed.")
    }
    $reportLines.Add("")
    $reportLines.Add("## GET Lines")
    $reportLines.Add("")
    if ($getRows.Count -gt 0) {
        Add-MarkdownTable `
            -Lines $reportLines `
            -Headers @("Path", "Status", "DurationMs", "RawLine") `
            -Rows $getRows `
            -Properties @("Path", "Status", "DurationMs", "RawLine")
    }
    else {
        $reportLines.Add("No GET lines were parsed.")
    }
    $reportLines.Add("")
    $reportLines.Add("## Filtered Evidence")
    $reportLines.Add("")
    $reportLines.Add('```text')
    foreach ($line in $interestingLines) {
        $reportLines.Add($line)
    }
    $reportLines.Add('```')
    $reportLines.Add("")
    $reportLines.Add("## Comparison Guidance")
    $reportLines.Add("")
    $reportLines.Add("- Treat duration as a noisy signal, not a hard assertion.")
    $reportLines.Add("- Compare same-route module counts and whether initial route compile scope shrinks.")
    $reportLines.Add("- Redirect status is acceptable if the route compile line was captured.")
    $reportLines.Add("- The report intentionally excludes raw prompts, raw responses, API keys, app tokens, provider keys, Authorization headers, provider raw error bodies, and secret plaintext.")

    $reportPath = Join-Path $reportRoot "$runId.md"
    $latestPath = Join-Path $reportRoot "latest.md"
    Set-Content -LiteralPath $reportPath -Value $reportLines -Encoding UTF8
    Set-Content -LiteralPath $latestPath -Value $reportLines -Encoding UTF8

    Write-Host ""
    Write-Host "captured compile lines: $($compileRows.Count)"
    Write-Host "captured GET lines:     $($getRows.Count)"
    Write-Host "report:                 $(Format-DisplayPath -Path $reportPath -RootPath $repoRoot)"
    Write-Host "latest:                 $(Format-DisplayPath -Path $latestPath -RootPath $repoRoot)"

    if ($KeepRawLogs) {
        Write-Host "raw stdout:             $stdoutPath"
        Write-Host "raw stderr:             $stderrPath"
    }
}
finally {
    Pop-Location

    if ($null -ne $process -and -not $process.HasExited) {
        Stop-ProcessTree -ProcessId $process.Id
    }

    if (-not $KeepRawLogs) {
        Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

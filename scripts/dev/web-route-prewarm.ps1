param(
    [string]$BaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_PREWARM_BASE_URL)) { "http://127.0.0.1:3000" } else { $env:GATELM_WEB_ROUTE_PREWARM_BASE_URL }),
    [string]$TenantId = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_PREWARM_TENANT_ID)) { "00000000-0000-4000-8000-000000000100" } else { $env:GATELM_WEB_ROUTE_PREWARM_TENANT_ID }),
    [string]$ProjectId = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_PREWARM_PROJECT_ID)) { "00000000-0000-4000-8000-000000000200" } else { $env:GATELM_WEB_ROUTE_PREWARM_PROJECT_ID }),
    [string]$ApplicationId = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_PREWARM_APPLICATION_ID)) { "00000000-0000-4000-8000-000000000300" } else { $env:GATELM_WEB_ROUTE_PREWARM_APPLICATION_ID }),
    [string]$ConsoleProbeCookieName = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_PREWARM_CONSOLE_PROBE_COOKIE_NAME)) { "gatelm_session" } else { $env:GATELM_WEB_ROUTE_PREWARM_CONSOLE_PROBE_COOKIE_NAME }),
    [int]$ReadyTimeoutSeconds = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_PREWARM_READY_TIMEOUT_SECONDS)) { 60 } else { [int]$env:GATELM_WEB_ROUTE_PREWARM_READY_TIMEOUT_SECONDS }),
    [int]$RouteTimeoutSeconds = $(if ([string]::IsNullOrWhiteSpace($env:GATELM_WEB_ROUTE_PREWARM_ROUTE_TIMEOUT_SECONDS)) { 90 } else { [int]$env:GATELM_WEB_ROUTE_PREWARM_ROUTE_TIMEOUT_SECONDS }),
    [switch]$DisableConsoleProbeCookie
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Join-UrlPath {
    param(
        [Parameter(Mandatory = $true)][string]$RootUrl,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return ($RootUrl.TrimEnd("/") + "/" + $Path.TrimStart("/"))
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

function Wait-ForEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2 | Out-Null
            return
        }
        catch {
            $response = Get-ErrorResponse -ErrorRecord $_
            if ($null -ne $response) {
                return
            }
        }

        Start-Sleep -Milliseconds 500
    }

    throw "Timed out waiting for $Uri after ${TimeoutSeconds}s."
}

function Invoke-PrewarmRoute {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][bool]$UseConsoleProbeCookie,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][string]$CookieName
    )

    $headers = @{}
    if ($UseConsoleProbeCookie) {
        $headers["Cookie"] = "$CookieName=route_compile_probe"
    }

    $statusCode = 0
    $transport = ""
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Uri $Uri `
            -Headers $headers `
            -MaximumRedirection 0 `
            -TimeoutSec $TimeoutSeconds
        $statusCode = [int]$response.StatusCode
    }
    catch {
        $response = Get-ErrorResponse -ErrorRecord $_
        if ($null -ne $response) {
            $statusCode = [int]$response.StatusCode
        }
        else {
            $transport = "request_failed"
        }
    }
    finally {
        $timer.Stop()
    }

    return [pscustomobject]@{
        Label = $Label
        Path = ([Uri]$Uri).PathAndQuery
        StatusCode = $statusCode
        DurationMs = [int]$timer.ElapsedMilliseconds
        Transport = $transport
    }
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$routes = @(
    [pscustomobject]@{ Label = "home"; Path = "/"; UseConsoleProbeCookie = $false },
    [pscustomobject]@{ Label = "dashboard"; Path = "/tenants/$TenantId/dashboard"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) },
    [pscustomobject]@{ Label = "request-logs"; Path = "/tenants/$TenantId/request-logs"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) },
    [pscustomobject]@{ Label = "analytics"; Path = "/tenants/$TenantId/analytics"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) },
    [pscustomobject]@{ Label = "alerts"; Path = "/tenants/$TenantId/alerts"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) },
    [pscustomobject]@{ Label = "projects"; Path = "/tenants/$TenantId/projects"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) },
    [pscustomobject]@{ Label = "provider-connections"; Path = "/tenants/$TenantId/provider-connections"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) },
    [pscustomobject]@{ Label = "project-policies"; Path = "/tenants/$TenantId/projects/$ProjectId/policies"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) },
    [pscustomobject]@{ Label = "application-policies"; Path = "/tenants/$TenantId/projects/$ProjectId/applications/$ApplicationId/policies"; UseConsoleProbeCookie = (-not $DisableConsoleProbeCookie) }
)

Wait-ForEndpoint -Uri $BaseUrl -TimeoutSeconds $ReadyTimeoutSeconds

Write-Host "GateLM apps/web route prewarm"
Write-Host "baseUrl: $BaseUrl"
Write-Host "probe:   $(if ($DisableConsoleProbeCookie) { "disabled" } else { "enabled for protected console routes; value intentionally omitted" })"

$rows = foreach ($route in $routes) {
    Invoke-PrewarmRoute `
        -Label $route.Label `
        -Uri (Join-UrlPath -RootUrl $BaseUrl -Path $route.Path) `
        -UseConsoleProbeCookie ([bool]$route.UseConsoleProbeCookie) `
        -TimeoutSeconds $RouteTimeoutSeconds `
        -CookieName $ConsoleProbeCookieName
}

$rows | Format-Table -AutoSize Label, StatusCode, DurationMs, Transport, Path

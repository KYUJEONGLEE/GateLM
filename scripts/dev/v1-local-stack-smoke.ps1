$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "../..")
$bashScript = Join-Path $repoRoot "scripts/dev/v1-local-stack-smoke.sh"

$bashCandidates = @(
  "C:\Program Files\Git\usr\bin\bash.exe",
  "C:\Program Files\Git\bin\bash.exe"
)

$bashPath = $null
foreach ($candidate in $bashCandidates) {
  if (Test-Path $candidate) {
    $bashPath = $candidate
    break
  }
}

if (-not $bashPath) {
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if ($bash) {
    $bashPath = $bash.Source
  }
}

if (-not $bashPath) {
  Write-Host "bash를 찾을 수 없습니다."
  Write-Host "이 smoke의 canonical 실행 파일은 scripts/dev/v1-local-stack-smoke.sh 입니다."
  Write-Host "Windows에서는 WSL2 또는 Git Bash에서 아래 명령으로 실행해주세요:"
  Write-Host "  bash scripts/dev/v1-local-stack-smoke.sh"
  exit 1
}

$versionOutput = & $bashPath --version 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "bash 명령은 발견했지만 실행할 수 없습니다: $bashPath"
  Write-Host "WSL2 배포판을 설치하거나 Git Bash를 설치한 뒤 아래 명령으로 실행해주세요:"
  Write-Host "  bash scripts/dev/v1-local-stack-smoke.sh"
  Write-Host $versionOutput
  exit 1
}

$gitUsrBin = Split-Path -Parent $bashPath
$gitBin = Split-Path -Parent (Split-Path -Parent $gitUsrBin)
$gitBin = Join-Path $gitBin "bin"
$env:PATH = "$gitUsrBin;$gitBin;$env:PATH"

& $bashPath $bashScript @args
exit $LASTEXITCODE

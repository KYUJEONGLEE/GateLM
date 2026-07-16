param(
    [string]$EncoderArtifactRoot = ".tmp/difficulty-semantic-encoder-artifacts",
    [string]$TokenizerNativeArchive = ".tmp/gateway-e5-shadow-downloads/libtokenizers.linux-amd64.tar.gz",
    [string]$OnnxRuntimePackage = ".tmp/gateway-e5-shadow-downloads/Microsoft.ML.OnnxRuntime.1.22.1.nupkg",
    [string]$OutputDirectory = ".tmp/gateway-e5-shadow-bundle",
    [switch]$DownloadMissingNativePackages
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$temporaryRoot = Join-Path $repoRoot ".tmp"
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
if (-not $outputPath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must stay under the repository .tmp directory"
}

function Resolve-RepoPath([string]$Path) {
    return (Resolve-Path (Join-Path $repoRoot $Path)).Path
}

function Resolve-RepoInputPath([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Path))
}

function Assert-File([string]$Path, [long]$Size, [string]$Sha256) {
    $item = Get-Item -LiteralPath $Path
    if (-not $item.PSIsContainer -and $item.Length -eq $Size) {
        $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -eq $Sha256) {
            return
        }
    }
    throw "Pinned artifact verification failed"
}

function Ensure-PinnedDownload(
    [string]$Path,
    [string]$Uri,
    [long]$Size,
    [string]$Sha256
) {
    if (Test-Path -LiteralPath $Path) {
        Assert-File $Path $Size $Sha256
        return
    }
    if (-not $DownloadMissingNativePackages) {
        throw "Pinned native package is missing; rerun with -DownloadMissingNativePackages"
    }
    if (-not $Path.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Downloaded native packages must stay under the repository .tmp directory"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $partialPath = "$Path.partial"
    if (Test-Path -LiteralPath $partialPath) {
        Remove-Item -LiteralPath $partialPath -Force
    }
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $partialPath
        Assert-File $partialPath $Size $Sha256
        Move-Item -LiteralPath $partialPath -Destination $Path
    } finally {
        if (Test-Path -LiteralPath $partialPath) {
            Remove-Item -LiteralPath $partialPath -Force
        }
    }
}

$manifestPath = Join-Path $repoRoot "scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json"
$lockPath = Join-Path $repoRoot "scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json"
$checksumsPath = Join-Path $repoRoot "scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-image.linux-amd64.v2.sha256"
Assert-File $manifestPath 4915 "94c4cdf6cc6caf9d9a640f56b88219a94956750152d14ac4ef21b52140766380"
Assert-File $lockPath 1364 "90395b13aa6c5a5ba33241e7cf627c0353a17141434c7ced3a42421cb8a2fd73"

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne "gatelm.difficulty-e5-encoder-manifest.v2" -or
    $manifest.executionShape.batchSize -ne 1 -or
    $manifest.bundleSha256 -ne "0f828d6a93f5600dff529e4194736fe79d43c04fa4ec9257374f1e092126f76e") {
    throw "Pinned encoder manifest identity mismatch"
}
$sourceRoot = Resolve-RepoPath $EncoderArtifactRoot
$sourceModel = Join-Path $sourceRoot $manifest.artifactDirectory
$tokenizerArchivePath = Resolve-RepoInputPath $TokenizerNativeArchive
$onnxPackagePath = Resolve-RepoInputPath $OnnxRuntimePackage
Ensure-PinnedDownload `
    $tokenizerArchivePath `
    "https://github.com/daulet/tokenizers/releases/download/v1.23.0/libtokenizers.linux-amd64.tar.gz" `
    14300699 `
    "c31e13e0840ca01f8064490a73ae2198979ae3ea48f606171616e2901fe6d3b0"
Ensure-PinnedDownload `
    $onnxPackagePath `
    "https://www.nuget.org/api/v2/package/Microsoft.ML.OnnxRuntime/1.22.1" `
    121484102 `
    "2ee0ed327f6cf2b860182bc4f2feb905c44a596cd120a05c510da6e4044a3e58"

if (Test-Path -LiteralPath $outputPath) {
    $resolvedOutput = (Resolve-Path -LiteralPath $outputPath).Path
    if (-not $resolvedOutput.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace output outside the repository .tmp directory"
    }
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}
New-Item -ItemType Directory -Path $outputPath | Out-Null
$destinationModel = Join-Path $outputPath $manifest.artifactDirectory

foreach ($artifact in $manifest.runtimeArtifacts) {
    $source = Join-Path $sourceModel $artifact.relativePath
    Assert-File $source ([long]$artifact.sizeBytes) $artifact.sha256
    $destination = Join-Path $destinationModel $artifact.relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

$nativeDirectory = Join-Path $outputPath "native"
New-Item -ItemType Directory -Path $nativeDirectory | Out-Null
tar -xzf $tokenizerArchivePath -C $nativeDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Tokenizer native archive extraction failed"
}
$tokenizerLibrary = Join-Path $nativeDirectory "libtokenizers.a"
Assert-File $tokenizerLibrary 50013964 "0b968ecbb84eb12a02c9cd51fd80d2b57a6f3fec0f78090d1fe8f347e6cc6845"

$onnxExtract = Join-Path $outputPath ".onnxruntime-package"
[System.IO.Compression.ZipFile]::ExtractToDirectory($onnxPackagePath, $onnxExtract)
$onnxLibrary = Join-Path $onnxExtract "runtimes/linux-x64/native/libonnxruntime.so"
Assert-File $onnxLibrary 21087472 "3907398e408dae083deb3439e8f643d9e26180ed614b29cc7d5ec342ce5ce06f"
Copy-Item -LiteralPath $onnxLibrary -Destination (Join-Path $nativeDirectory "libonnxruntime.so")
Remove-Item -LiteralPath $onnxExtract -Recurse -Force

Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $outputPath "difficulty-e5-encoder-manifest.v2.json")
Copy-Item -LiteralPath $lockPath -Destination (Join-Path $outputPath "difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json")
Copy-Item -LiteralPath $checksumsPath -Destination (Join-Path $outputPath "difficulty-e5-gateway-image.linux-amd64.v2.sha256")

Write-Host "Prepared verified Gateway E5 runtime bundle: $outputPath"

param(
    [string]$Python = "",
    [string]$ArtifactRoot = ".tmp/difficulty-semantic-encoder-artifacts",
    [string]$BundleDirectory = ".tmp/gateway-e5-shadow-bundle",
    [string]$ImageTag = "gatelm/gateway-core:e5-shadow-verify",
    [switch]$SkipImageBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$temporaryRoot = Join-Path $repoRoot ".tmp"
$toolRoot = Join-Path $repoRoot "scripts/routing_difficulty_model"
$bundlePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $BundleDirectory))
$artifactPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ArtifactRoot))
if (-not $Python) {
    $venvPython = Join-Path $repoRoot ".tmp/difficulty-semantic-encoder-venv/Scripts/python.exe"
    $Python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }
}

& (Join-Path $PSScriptRoot "prepare-gateway-e5-shadow-bundle.ps1") `
    -EncoderArtifactRoot $ArtifactRoot `
    -OutputDirectory $BundleDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Gateway E5 shadow bundle preparation failed"
}

$parityDirectory = Join-Path $temporaryRoot ("gateway-e5-parity-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $parityDirectory | Out-Null
$expectedPath = Join-Path $parityDirectory "expected-pooled.f32"
$expectedTokensPath = Join-Path $parityDirectory "expected-tokens.bin"
$pythonReferencePath = Join-Path $parityDirectory "python_reference.py"
$relativeExpectedPath = $expectedPath.Substring($repoRoot.Length).TrimStart("\").Replace("\", "/")
$pythonProgram = @'
from pathlib import Path
import sys
import struct
import numpy as np
import onnxruntime
import tokenizers
from gatelm_difficulty_model.encoder_runtime import install_network_guard, load_runtime

if tokenizers.__version__ != "0.21.2" or onnxruntime.__version__ != "1.22.1":
    raise RuntimeError("canonical Python dependency version mismatch")
install_network_guard()
runtime, _ = load_runtime(artifact_root=Path(sys.argv[1]))
instructions = [
    "explain one bounded workflow step.",
    "\ud558\ub098\uc758 \uc81c\ud55c\ub41c \uc791\uc5c5 \ub2e8\uacc4\ub97c \uc124\uba85\ud558\uc138\uc694.",
    ("bounded " * 160) + "finish",
]
pooled = np.asarray(
    [runtime.encode_pooled_one(instruction) for instruction in instructions],
    dtype="<f4",
)
if pooled.shape != (3, 384) or not np.all(np.isfinite(pooled)):
    raise RuntimeError("canonical Python pooled output is invalid")
pooled.tofile(sys.argv[2])
with Path(sys.argv[3]).open("wb") as token_output:
    for instruction in instructions:
        tokenized = runtime.tokenize([instruction])
        input_ids = np.asarray(tokenized["input_ids"][0], dtype="<u4")
        attention_mask = np.asarray(tokenized["attention_mask"][0], dtype="<u4")
        token_output.write(struct.pack("<I", input_ids.shape[0]))
        token_output.write(input_ids.tobytes())
        token_output.write(attention_mask.tobytes())
'@
[System.IO.File]::WriteAllText($pythonReferencePath, $pythonProgram, [System.Text.UTF8Encoding]::new($false))

$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = if ($previousPythonPath) { "$toolRoot$([IO.Path]::PathSeparator)$previousPythonPath" } else { $toolRoot }
    & $Python $pythonReferencePath $artifactPath $expectedPath $expectedTokensPath
    if ($LASTEXITCODE -ne 0) {
        throw "canonical Python E5 parity reference failed"
    }

    & docker run --rm --platform linux/amd64 `
        -v "${repoRoot}:/src" `
        -v "${bundlePath}:/bundle:ro" `
        -w /src/apps/gateway-core `
        -e GATELM_E5_INTEGRATION_BUNDLE_ROOT=/bundle `
        -e "GATELM_E5_INTEGRATION_EXPECTED_POOLED=/src/$relativeExpectedPath" `
        -e "GATELM_E5_INTEGRATION_EXPECTED_TOKENS=/src/$($expectedTokensPath.Substring($repoRoot.Length).TrimStart('\').Replace('\', '/'))" `
        golang:1.24-bookworm `
        bash -c "CGO_ENABLED=1 CGO_LDFLAGS='-L/bundle/native' go test -tags=difficulty_e5_onnx ./internal/adapters/routing/e5onnx -run TestNativeEncoderMatchesCanonicalPythonPooledOutput -count=1"
    if ($LASTEXITCODE -ne 0) {
        throw "Gateway native/Python E5 parity failed"
    }

    if (-not $SkipImageBuild) {
        & docker build --platform linux/amd64 `
            --build-context "difficulty_e5=$bundlePath" `
            -f infra/docker/gateway-core-e5-shadow.Dockerfile `
            -t $ImageTag `
            .
        if ($LASTEXITCODE -ne 0) {
            throw "Gateway E5 shadow image build failed"
        }

        & docker run --rm --platform linux/amd64 `
            --entrypoint /bin/sh `
            $ImageTag `
            -c "test ! -e /opt/gatelm/difficulty-e5/native/libtokenizers.a"
        if ($LASTEXITCODE -ne 0) {
            throw "Gateway E5 shadow runtime image retained the build-only tokenizer archive"
        }

        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $smokeOutput = & docker run --rm --platform linux/amd64 `
                -e DATABASE_URL=invalid `
                -e GATEWAY_LOG_DATABASE_URL=invalid `
                $ImageTag 2>&1
            $smokeExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $safeSmoke = $smokeOutput -join "`n"
        if ($smokeExitCode -ne 1 -or
            -not $safeSmoke.Contains("difficulty E5 shadow initialized; product routing unchanged") -or
            -not $safeSmoke.Contains("postgres pool configuration failed")) {
            throw "Gateway E5 shadow container startup smoke failed"
        }
    }

    Write-Host "Gateway E5 shadow verification passed"
} finally {
    $env:PYTHONPATH = $previousPythonPath
    if (Test-Path -LiteralPath $parityDirectory) {
        $resolvedParity = (Resolve-Path -LiteralPath $parityDirectory).Path
        if (-not $resolvedParity.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove parity data outside the repository .tmp directory"
        }
        Remove-Item -LiteralPath $resolvedParity -Recurse -Force
    }
}

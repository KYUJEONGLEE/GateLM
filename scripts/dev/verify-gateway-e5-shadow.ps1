param(
    [string]$Python = "",
    [string]$ArtifactRoot = ".tmp/difficulty-semantic-encoder-artifacts",
    [string]$BundleDirectory = ".tmp/gateway-e5-runtime-bundle",
    [string]$ImageTag = "gatelm/gateway-core:e5-runtime-verify",
    [string]$EvidenceOutput = "",
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

# The checked-in 106D model matches the current deterministic boundary. The
# historical 500-record replay belongs to the retired 118D bundle and must not
# be reused as quality evidence for this model. Its frozen 1,000-record test is
# documented separately and is never reopened by this runtime verifier.
$runtimeModelCompatible = $true
$legacyHoldoutReplayEligible = $false
$runtimeAdmitted = $runtimeModelCompatible

& (Join-Path $PSScriptRoot "prepare-gateway-e5-shadow-bundle.ps1") `
    -EncoderArtifactRoot $ArtifactRoot `
    -OutputDirectory $BundleDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Gateway E5 runtime bundle preparation failed"
}

$parityDirectory = Join-Path $temporaryRoot ("gateway-e5-parity-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $parityDirectory | Out-Null
$expectedPath = Join-Path $parityDirectory "expected-pooled.f32"
$expectedTokensPath = Join-Path $parityDirectory "expected-tokens.bin"
$holdoutReferencePath = Join-Path $parityDirectory "holdout-reference.json"
$holdoutAggregatePath = Join-Path $parityDirectory "holdout-aggregate.json"
$pythonReferencePath = Join-Path $parityDirectory "python_reference.py"
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

    if ($legacyHoldoutReplayEligible) {
        & $Python -m gatelm_difficulty_model.gateway_holdout_reference reference `
            --dataset (Join-Path $repoRoot "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl") `
            --manifest (Join-Path $repoRoot "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json") `
            --artifact (Join-Path $repoRoot "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json") `
            --artifact-root $artifactPath `
            --encoder-manifest (Join-Path $repoRoot "scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json") `
            --output $holdoutReferencePath
        if ($LASTEXITCODE -ne 0) {
            throw "canonical Python Gateway holdout reference failed"
        }
    } else {
        Write-Host "Gateway model replay skipped: checked-in artifact decision boundary is historical"
    }

    $previousGoCache = $env:GOCACHE
    try {
        $env:GOCACHE = Join-Path $repoRoot ".cache/go-build"
        Push-Location $repoRoot
        try {
            & go test ./apps/gateway-core/internal/adapters/routing/e5onnx `
                -run "TestVerifyBundle|TestNativeEncoderIsUnavailableOutsideLinuxShadowProfile" `
                -count=1
            if ($LASTEXITCODE -ne 0) { throw "Gateway E5 bundle failure-isolation tests failed" }
            & go test ./apps/gateway-core/cmd/gateway `
                -run "TestInitializeDifficultyE5(Runtime|Shadow)" `
                -count=1
            if ($LASTEXITCODE -ne 0) { throw "Gateway E5 initialization isolation tests failed" }
            & go test ./apps/gateway-core/internal/domain/routing `
                -run "TestSimpleRouter.*(Runtime|Shadow)|TestDifficultySemantic(Runtime|Shadow)|TestDifficultySemanticModelRejectsUnavailableShadowInputsSafely|TestGeneratedDifficultySemanticModel(MatchesCurrentDecisionBoundary|RejectsHistoricalBaselineE2EWaiver)" `
                -count=1
            if ($LASTEXITCODE -ne 0) { throw "Gateway E5 request isolation tests failed" }
        } finally {
            Pop-Location
        }
    } finally {
        $env:GOCACHE = $previousGoCache
    }

    & docker run --rm --platform linux/amd64 `
        -v "$(Join-Path $repoRoot 'apps/gateway-core'):/src/apps/gateway-core:ro" `
        -v "${bundlePath}:/bundle:ro" `
        -v "${expectedPath}:/evidence/expected-pooled.f32:ro" `
        -v "${expectedTokensPath}:/evidence/expected-tokens.bin:ro" `
        -w /src/apps/gateway-core `
        -e GATELM_E5_INTEGRATION_BUNDLE_ROOT=/bundle `
        -e GATELM_E5_INTEGRATION_EXPECTED_POOLED=/evidence/expected-pooled.f32 `
        -e GATELM_E5_INTEGRATION_EXPECTED_TOKENS=/evidence/expected-tokens.bin `
        golang:1.24-bookworm `
        bash -c "CGO_ENABLED=1 CGO_LDFLAGS='-L/bundle/native' go test -tags=difficulty_e5_onnx ./internal/adapters/routing/e5onnx -run TestNativeEncoderMatchesCanonicalPythonPooledOutput -count=1"
    if ($LASTEXITCODE -ne 0) {
        throw "Gateway native/Python E5 parity failed"
    }

    & docker run --rm --platform linux/amd64 `
        -v "$(Join-Path $repoRoot 'apps/gateway-core'):/src/apps/gateway-core:ro" `
        -v "${bundlePath}:/bundle:ro" `
        -w /src/apps/gateway-core `
        -e GATELM_E5_INTEGRATION_BUNDLE_ROOT=/bundle `
        golang:1.24-bookworm `
        bash -c "CGO_ENABLED=1 CGO_LDFLAGS='-L/bundle/native' go test -tags=difficulty_e5_onnx ./cmd/gateway -run '^TestNativeRequestRuntimeE2E$' -count=1"
    if ($LASTEXITCODE -ne 0) {
        throw "Gateway native request-runtime E2E failed"
    }

    if ($legacyHoldoutReplayEligible) {
        $holdoutRunReports = @()
        $commit = (& git -C $repoRoot rev-parse HEAD).Trim()
        for ($run = 1; $run -le 3; $run++) {
            $runReport = Join-Path $parityDirectory "holdout-run-$run.json"
            $holdoutRunReports += $runReport
            & docker run --rm --platform linux/amd64 `
                -v "$(Join-Path $repoRoot 'apps/gateway-core'):/src/apps/gateway-core:ro" `
                -v "${bundlePath}:/bundle:ro" `
                -v "${parityDirectory}:/evidence" `
                -v "$(Join-Path $repoRoot 'docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl'):/data/dataset.jsonl:ro" `
                -v "$(Join-Path $repoRoot 'docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json'):/data/manifest.json:ro" `
                -w /src/apps/gateway-core `
                -e GATELM_E5_INTEGRATION_BUNDLE_ROOT=/bundle `
                -e GATELM_E5_HOLDOUT_REFERENCE=/evidence/holdout-reference.json `
                -e GATELM_E5_HOLDOUT_DATASET=/data/dataset.jsonl `
                -e GATELM_E5_HOLDOUT_MANIFEST=/data/manifest.json `
                -e "GATELM_E5_HOLDOUT_REPORT=/evidence/holdout-run-$run.json" `
                -e "GATELM_EVIDENCE_COMMIT=$commit" `
                -e "GATELM_EVIDENCE_RUN=$run" `
                golang:1.24-bookworm `
                bash -c "CGO_ENABLED=1 CGO_LDFLAGS='-L/bundle/native' go test -tags=difficulty_e5_onnx ./internal/adapters/routing/e5onnx -run '^TestNativeGatewayHoldoutReplay$' -count=1"
            if ($LASTEXITCODE -ne 0) {
                throw "Gateway native holdout replay run $run failed"
            }
        }

        $aggregateArguments = @(
            "-m", "gatelm_difficulty_model.gateway_holdout_reference", "aggregate"
        )
        foreach ($runReport in $holdoutRunReports) {
            $aggregateArguments += @("--report", $runReport)
        }
        $aggregateArguments += @("--output", $holdoutAggregatePath)
        & $Python @aggregateArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Gateway holdout replay aggregation failed"
        }

        if ($EvidenceOutput) {
            $evidencePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $EvidenceOutput))
            if (-not $evidencePath.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "EvidenceOutput must stay inside the repository"
            }
            New-Item -ItemType Directory -Path (Split-Path -Parent $evidencePath) -Force | Out-Null
            Copy-Item -LiteralPath $holdoutAggregatePath -Destination $evidencePath -Force
            Write-Host "Gateway holdout aggregate evidence: $evidencePath"
        }
    } elseif ($EvidenceOutput) {
        throw "Legacy 500-record holdout evidence is not valid for the selected 106D model"
    }

    if (-not $SkipImageBuild) {
        & docker build --platform linux/amd64 `
            --build-context "difficulty_e5=$bundlePath" `
            -f infra/docker/gateway-core-e5-runtime.Dockerfile `
            -t $ImageTag `
            .
        if ($LASTEXITCODE -ne 0) {
            throw "Gateway E5 runtime image build failed"
        }

        & docker run --rm --platform linux/amd64 `
            --user 1000:1000 `
            --entrypoint /bin/sh `
            $ImageTag `
            -c "test ! -e /opt/gatelm/difficulty-e5/native/libtokenizers.a"
        if ($LASTEXITCODE -ne 0) {
            throw "Gateway E5 runtime image retained the build-only tokenizer archive"
        }

        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $smokeOutput = & docker run --rm --platform linux/amd64 `
                --user 1000:1000 `
                -e DATABASE_URL=invalid `
                -e GATEWAY_LOG_DATABASE_URL=invalid `
                -e GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED=true `
                $ImageTag 2>&1
            $smokeExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $safeSmoke = $smokeOutput -join "`n"
        $expectedRuntimeStatus = if ($runtimeAdmitted) {
            "difficulty E5 hot-path runtime initialized"
        } else {
            "difficulty E5 hot-path runtime unavailable"
        }
        if ($smokeExitCode -ne 1 -or
            -not $safeSmoke.Contains($expectedRuntimeStatus) -or
            -not $safeSmoke.Contains("postgres pool configuration failed")) {
            throw "Gateway E5 runtime container startup smoke failed"
        }
    }

    if ($runtimeAdmitted) {
        Write-Host "Gateway E5 106D hot-path verification passed; frozen 1,000-record test was not reopened"
    } else {
        Write-Host "Gateway E5 optional image verification passed with runtime disabled"
    }
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

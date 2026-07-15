import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const goCache = path.join(rootDir, ".cache", "go-build");
const encoderManifestPath = path.join(
  rootDir,
  "scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json",
);
const runtimeLockPath = path.join(
  rootDir,
  "scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json",
);
const imageChecksumsPath = path.join(
  rootDir,
  "scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-image.linux-amd64.v2.sha256",
);

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

const encoderManifestPayload = readFileSync(encoderManifestPath);
const encoderManifest = JSON.parse(encoderManifestPayload);
if (
  encoderManifest.schemaVersion !== "gatelm.difficulty-e5-encoder-manifest.v2" ||
  encoderManifest.executionShape?.policyVersion !==
    "difficulty-e5-single-request-execution.2026-07-15.v1" ||
  encoderManifest.executionShape?.unit !== "single_request" ||
  encoderManifest.executionShape?.batchSize !== 1 ||
  encoderManifest.executionShape?.paddingScope !== "within_request_only"
) {
  throw new Error("Gateway E5 encoder manifest does not pin runtime-equivalent single requests");
}
const runtimeLock = JSON.parse(readFileSync(runtimeLockPath, "utf8"));
const expectedLock = {
  schemaVersion: "gatelm.difficulty-e5-gateway-runtime-lock.v2",
  runtimeVersion: "difficulty-e5-gateway-runtime.linux-amd64.single-request.2026-07-15.v2",
  platform: "linux-amd64",
  encoderManifestSha256: sha256(encoderManifestPayload),
  encoderBundleVersion: "difficulty-e5-encoder-pca64-single-request.2026-07-15.v2",
  encoderBundleSha256: "0f828d6a93f5600dff529e4194736fe79d43c04fa4ec9257374f1e092126f76e",
  tokenizerBindingModule: "github.com/daulet/tokenizers",
  tokenizerBindingVersion: "v1.23.0",
  tokenizerCoreVersion: "0.22.0",
  tokenizerNativeArchiveSha256:
    "c31e13e0840ca01f8064490a73ae2198979ae3ea48f606171616e2901fe6d3b0",
  tokenizerNativeArchiveSizeBytes: 14300699,
  tokenizerNativeLibrarySha256:
    "0b968ecbb84eb12a02c9cd51fd80d2b57a6f3fec0f78090d1fe8f347e6cc6845",
  tokenizerNativeLibrarySizeBytes: 50013964,
  onnxRuntimeBindingModule: "github.com/yalue/onnxruntime_go",
  onnxRuntimeBindingVersion: "v1.22.0",
  onnxRuntimeVersion: "1.22.1",
  onnxRuntimePackageSha256:
    "2ee0ed327f6cf2b860182bc4f2feb905c44a596cd120a05c510da6e4044a3e58",
  onnxRuntimePackageSizeBytes: 121484102,
  onnxRuntime: {
    relativePath: "native/libonnxruntime.so",
    sha256: "3907398e408dae083deb3439e8f643d9e26180ed614b29cc7d5ec342ce5ce06f",
    sizeBytes: 21087472,
  },
};
if (JSON.stringify(runtimeLock) !== JSON.stringify(expectedLock)) {
  throw new Error("Gateway E5 runtime lock drifted from the pinned Linux amd64 material");
}

const imageChecksums = readFileSync(imageChecksumsPath, "utf8");
for (const requiredDigest of [
  expectedLock.encoderManifestSha256,
  sha256(readFileSync(runtimeLockPath)),
  expectedLock.tokenizerNativeLibrarySha256,
  expectedLock.onnxRuntime.sha256,
]) {
  if (!imageChecksums.includes(requiredDigest)) {
    throw new Error(`Gateway E5 image checksum list omitted ${requiredDigest}`);
  }
}

const defaultDockerfile = readFileSync(
  path.join(rootDir, "infra/docker/gateway-core.Dockerfile"),
  "utf8",
);
const e5Dockerfile = readFileSync(
  path.join(rootDir, "infra/docker/gateway-core-e5-shadow.Dockerfile"),
  "utf8",
);
const prepareScript = readFileSync(
  path.join(rootDir, "scripts/dev/prepare-gateway-e5-shadow-bundle.ps1"),
  "utf8",
);
const verifyNativeScript = readFileSync(
  path.join(rootDir, "scripts/dev/verify-gateway-e5-shadow.ps1"),
  "utf8",
);
const holdoutReference = readFileSync(
  path.join(
    rootDir,
    "scripts/routing_difficulty_model/gatelm_difficulty_model/gateway_holdout_reference.py",
  ),
  "utf8",
);
const holdoutIntegration = readFileSync(
  path.join(
    rootDir,
    "apps/gateway-core/internal/adapters/routing/e5onnx/runtime_native_holdout_integration_test.go",
  ),
  "utf8",
);
const baselineWaiverIntegration = readFileSync(
  path.join(
    rootDir,
    "apps/gateway-core/cmd/gateway/difficulty_e5_baseline_waiver_integration_test.go",
  ),
  "utf8",
);
if (!defaultDockerfile.includes("CGO_ENABLED=0") || defaultDockerfile.includes("difficulty_e5_onnx")) {
  throw new Error("default Gateway image must remain CGO-free and E5-inactive");
}
for (const requiredText of [
  "COPY --from=difficulty_e5",
  "sha256sum --check",
  "-tags=difficulty_e5_onnx",
  "GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=true",
  "GATEWAY_DIFFICULTY_E5_SHADOW_BASELINE_WAIVER=difficulty-shadow-baseline-e2e-v3.2026-07-15.v1",
]) {
  if (!e5Dockerfile.includes(requiredText)) {
    throw new Error(`optional Gateway E5 image omitted ${requiredText}`);
  }
}
for (const requiredText of [
  "TestBaselineWaiverNativeRequestShadowE2E",
  "DifficultySemanticShadowBaselineE2EWaiverV3",
  "DifficultySemanticShadowReady",
  "authoritative route changed",
]) {
  if (!baselineWaiverIntegration.includes(requiredText)) {
    throw new Error(`Gateway baseline waiver native integration omitted ${requiredText}`);
  }
}
for (const requiredText of [
  "gatelm_difficulty_model.gateway_holdout_reference reference",
  "TestNativeGatewayHoldoutReplay",
  "holdout-run-$run.json",
  "EvidenceOutput",
  ":/src/apps/gateway-core:ro",
  "GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES=tenant_smoke/application_smoke",
  "difficulty-shadow-baseline-e2e-v3.2026-07-15.v1",
  "difficulty E5 shadow initialized; product routing unchanged",
  "TestBaselineWaiverNativeRequestShadowE2E",
]) {
  if (!verifyNativeScript.includes(requiredText)) {
    throw new Error(`Gateway E5 native verifier omitted ${requiredText}`);
  }
}
for (const requiredText of [
  "difficulty_training_2026_07_15_owner_approved_500_v2",
  "offlineSingleRequestClassification",
  "EXECUTION_SHAPE_POLICY_VERSION",
  "gatewaySingleClassification",
  "maxAbsoluteScoreDeltaAcrossRuns",
]) {
  if (!holdoutReference.includes(requiredText)) {
    throw new Error(`Gateway Holdout Python reference omitted ${requiredText}`);
  }
}
for (const requiredText of [
  "gatelm.difficulty-gateway-holdout-replay-run.v2",
  "OfflineAggregateReproduced",
  "routeShadowDisabled",
  "nativeTimeoutRecovery",
]) {
  if (!holdoutIntegration.includes(requiredText)) {
    throw new Error(`Gateway Holdout native integration omitted ${requiredText}`);
  }
}
for (const requiredText of [
  "DownloadMissingNativePackages",
  "https://github.com/daulet/tokenizers/releases/download/v1.23.0/libtokenizers.linux-amd64.tar.gz",
  "https://www.nuget.org/api/v2/package/Microsoft.ML.OnnxRuntime/1.22.1",
  expectedLock.tokenizerNativeArchiveSha256,
  expectedLock.onnxRuntimePackageSha256,
]) {
  if (!prepareScript.includes(requiredText)) {
    throw new Error(`Gateway E5 bundle preparation omitted ${requiredText}`);
  }
}

const commands = [
  {
    name: "selected 118D generated bundle drift",
    args: [
      "run",
      "./apps/gateway-core/cmd/difficulty-model-codegen",
      "-profile",
      "gateway-shadow-118d",
      "-artifact",
      "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json",
      "-output",
      "apps/gateway-core/internal/domain/routing/difficulty_model_118d_generated.go",
      "-check",
    ],
  },
  {
    name: "selected 118D codegen and inference tests",
    args: [
      "test",
      "./apps/gateway-core/internal/tools/difficultymodel",
      "./apps/gateway-core/cmd/difficulty-model-codegen",
      "./apps/gateway-core/internal/domain/routing",
      "./apps/gateway-core/internal/adapters/routing/e5onnx",
      "./apps/gateway-core/internal/config",
      "./apps/gateway-core/cmd/gateway",
    ],
  },
];

for (const command of commands) {
  console.log(`\n==> ${command.name}`);
  const result = spawnSync("go", command.args, {
    cwd: rootDir,
    env: { ...process.env, GOCACHE: goCache },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`${command.name}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nGateway shadow 118D bundle and optional E5 runtime verification passed.");

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.join(
  root,
  "scripts/routing_difficulty_model/artifacts/lightgbm-four-way-owner-approved-500",
);
const expected = new Map([
  ["rule_42_plus_e5_small_pca_64", {
    encoderMode: "e5_small",
    semanticMode: "pca_64",
    semanticDimension: 64,
    ruleDimension: 42,
    totalDimension: 106,
    featureOrder: ["rule_vector_v1", "e5_small_pca_64"],
  }],
  ["rule_42_plus_semantic_heads_12", {
    encoderMode: "e5_small",
    semanticMode: "semantic_heads_12",
    semanticDimension: 12,
    ruleDimension: 42,
    totalDimension: 54,
    featureOrder: ["rule_vector_v1", "semantic_heads_12"],
  }],
  ["e5_base_raw_768", {
    encoderMode: "e5_base",
    semanticMode: "raw_768",
    semanticDimension: 768,
    ruleDimension: 0,
    totalDimension: 768,
    featureOrder: ["raw_embedding_768"],
  }],
  ["rule_42_plus_e5_base_raw_768", {
    encoderMode: "e5_base",
    semanticMode: "raw_768",
    semanticDimension: 768,
    ruleDimension: 42,
    totalDimension: 810,
    featureOrder: ["rule_vector_v1", "raw_embedding_768"],
  }],
]);
const runtimeArtifactSources = new Map([
  [
    "difficulty-e5-encoder-manifest.v2.json",
    path.join(root, "scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json"),
  ],
  [
    "difficulty-e5-pca-64.v2.npz",
    path.join(root, "scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.v2.npz"),
  ],
  [
    "difficulty-semantic-heads.owner-approved-500.v2.json",
    path.join(
      root,
      "scripts/routing_difficulty_model/artifacts/candidates/difficulty-semantic-heads.owner-approved-500.v2.json",
    ),
  ],
]);

function readJson(name) {
  return JSON.parse(readFileSync(path.join(artifactDirectory, name), "utf8"));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function same(actual, expectedValue) {
  return JSON.stringify(actual) === JSON.stringify(expectedValue);
}

function validFileIdentity(filePath, identity) {
  return (
    existsSync(filePath) &&
    identity?.sizeBytes === readFileSync(filePath).byteLength &&
    identity?.sha256 === sha256(filePath)
  );
}

const failures = [];
const report = readJson("four-way-evaluation.v1.json");
const runtimeLock = readJson("runtime-bundles.v1.json");
const encoderLock = readJson("e5-base-runtime-lock.v1.json");
if (
  report.schemaVersion !== "gatelm.routing-difficulty-lightgbm-four-way.v1" ||
  report.promotionState !== "offline_shadow_only" ||
  report.containsPromptOrEmbeddingMaterial !== false ||
  !same(report.candidateOrder, [...expected.keys()])
) {
  failures.push("four-way report identity or candidate order is invalid");
}
if (report.candidates?.length !== expected.size) {
  failures.push("four-way report must contain exactly four candidates");
}
for (const candidate of report.candidates ?? []) {
  const shape = expected.get(candidate.candidate);
  if (candidate.dimension !== shape?.totalDimension) {
    failures.push(`${candidate.candidate}: expected exact dimension ${shape?.totalDimension}`);
    continue;
  }
  const modelPath = path.join(artifactDirectory, candidate.model.relativePath);
  if (!validFileIdentity(modelPath, candidate.model)) {
    failures.push(`${candidate.candidate}: model artifact identity mismatch`);
  }
}
if (
  encoderLock.schemaVersion !== "gatelm.routing-difficulty-e5-base-runtime-lock.v1" ||
  encoderLock.encoder?.modelId !== "intfloat/multilingual-e5-base" ||
  encoderLock.encoder?.sourceRevision !== "d13f1b27baf31030b7fd040960d60d909913633f" ||
  encoderLock.encoder?.outputDimension !== 768 ||
  encoderLock.encoder?.runtimeArtifacts?.length !== 8
) {
  failures.push("E5-base runtime lock identity is invalid");
}
const smallManifestPath = runtimeArtifactSources.get(
  runtimeLock.smallEncoderManifest?.relativePath,
);
if (
  !smallManifestPath ||
  !validFileIdentity(smallManifestPath, runtimeLock.smallEncoderManifest)
) {
  failures.push("E5-small runtime manifest identity is invalid");
}
if (
  runtimeLock.schemaVersion !== "gatelm.routing-difficulty-lightgbm-runtime-bundles.v1" ||
  runtimeLock.promotionState !== "offline_shadow_only" ||
  runtimeLock.profiles?.length !== expected.size
) {
  failures.push("runtime bundle lock identity is invalid");
}
if (!same(runtimeLock.profiles?.map((entry) => entry.candidate), [...expected.keys()])) {
  failures.push("runtime bundle candidate order drifted");
}
for (const entry of runtimeLock.profiles ?? []) {
  const shape = expected.get(entry.candidate);
  if (!shape) {
    failures.push(`${entry.candidate}: unexpected runtime candidate`);
    continue;
  }
  for (const identity of [entry.profile, entry.model]) {
    const filePath = path.join(artifactDirectory, identity.relativePath);
    if (!validFileIdentity(filePath, identity)) {
      failures.push(`${entry.candidate}: runtime artifact identity mismatch`);
    }
  }
  for (const identity of entry.requiredArtifacts ?? []) {
    const source = runtimeArtifactSources.get(identity.relativePath);
    if (!source || !validFileIdentity(source, identity)) {
      failures.push(`${entry.candidate}: required artifact identity mismatch`);
    }
  }
  const profile = readJson(entry.profile.relativePath);
  const expectedEncoderDimension = shape.encoderMode === "e5_small" ? 384 : 768;
  if (
    entry.encoderMode !== shape.encoderMode ||
    profile.encoderMode !== shape.encoderMode ||
    profile.encoder?.outputDimension !== expectedEncoderDimension ||
    profile.featureShape?.semanticMode !== shape.semanticMode ||
    profile.featureShape?.semanticDimension !== shape.semanticDimension ||
    profile.featureShape?.totalDimension !== shape.totalDimension ||
    profile.featureShape?.ruleDimension !== shape.ruleDimension ||
    !same(profile.featureShape?.featureOrder, shape.featureOrder) ||
    profile.model?.numFeatures !== shape.totalDimension ||
    profile.model?.contentHash !== `sha256:${profile.model?.sha256 ?? ""}` ||
    profile.promotionState !== "offline_shadow_only"
  ) {
    failures.push(`${entry.candidate}: runtime profile feature pipeline is invalid`);
  }
  if (
    shape.encoderMode === "e5_small" &&
    (
      profile.encoder?.bundleSha256 !==
        "0f828d6a93f5600dff529e4194736fe79d43c04fa4ec9257374f1e092126f76e" ||
      profile.featureShape?.projection?.sha256 !==
        "fc2ae71057650884e88ace7a9a6ca1465219527558ab534746374d3632690eb9"
    )
  ) {
    failures.push(`${entry.candidate}: E5-small/PCA identity drifted`);
  }
  if (
    entry.candidate === "rule_42_plus_semantic_heads_12" &&
    (
      profile.featureShape?.semanticHeads?.contentHash !==
        "sha256:531bb72d1d22f134a11da76649cfde9102af5c116cf46765e03b8f2550d27386" ||
      profile.featureShape?.semanticHeads?.classOrder?.length !== 4 ||
      profile.featureShape.semanticHeads.classOrder.some(
        (head) => head.classes?.length !== 3,
      )
    )
  ) {
    failures.push(`${entry.candidate}: semantic-head identity/order drifted`);
  }
}
const serialized = JSON.stringify({ report, runtimeLock }).toLowerCase();
for (const forbidden of [
  "instructiontext",
  "redactedprompt",
  "embeddingvalues",
  "rulevectorvalues",
  "scoresbysample",
]) {
  if (serialized.includes(forbidden)) {
    failures.push(`forbidden per-sample material marker found: ${forbidden}`);
  }
}
if (failures.length) {
  console.error("LightGBM four-way artifact verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("LightGBM four-way artifact verification passed.");

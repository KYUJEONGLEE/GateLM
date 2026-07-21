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
  ["rule_42_plus_e5_small_pca_64", 106],
  ["rule_42_plus_semantic_heads_12", 54],
  ["e5_base_raw_768", 768],
  ["rule_42_plus_e5_base_raw_768", 810],
]);

function readJson(name) {
  return JSON.parse(readFileSync(path.join(artifactDirectory, name), "utf8"));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const failures = [];
const report = readJson("four-way-evaluation.v1.json");
const runtimeLock = readJson("runtime-bundles.v1.json");
const encoderLock = readJson("e5-base-runtime-lock.v1.json");
if (
  report.schemaVersion !== "gatelm.routing-difficulty-lightgbm-four-way.v1" ||
  report.promotionState !== "offline_shadow_only" ||
  report.containsPromptOrEmbeddingMaterial !== false ||
  JSON.stringify(report.candidateOrder) !== JSON.stringify([...expected.keys()])
) {
  failures.push("four-way report identity or candidate order is invalid");
}
if (report.candidates?.length !== expected.size) {
  failures.push("four-way report must contain exactly four candidates");
}
for (const candidate of report.candidates ?? []) {
  const dimension = expected.get(candidate.candidate);
  if (candidate.dimension !== dimension) {
    failures.push(`${candidate.candidate}: expected exact dimension ${dimension}`);
    continue;
  }
  const modelPath = path.join(artifactDirectory, candidate.model.relativePath);
  if (
    !existsSync(modelPath) ||
    candidate.model.sizeBytes !== readFileSync(modelPath).byteLength ||
    candidate.model.sha256 !== sha256(modelPath)
  ) {
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
if (
  runtimeLock.schemaVersion !== "gatelm.routing-difficulty-lightgbm-runtime-bundles.v1" ||
  runtimeLock.promotionState !== "offline_shadow_only" ||
  runtimeLock.profiles?.length !== 2
) {
  failures.push("runtime bundle lock identity is invalid");
}
for (const entry of runtimeLock.profiles ?? []) {
  const expectedDimension = expected.get(entry.candidate);
  if (![768, 810].includes(expectedDimension)) {
    failures.push(`${entry.candidate}: is not an E5-base runtime candidate`);
    continue;
  }
  for (const identity of [entry.profile, entry.model]) {
    const filePath = path.join(artifactDirectory, identity.relativePath);
    if (
      !existsSync(filePath) ||
      identity.sizeBytes !== readFileSync(filePath).byteLength ||
      identity.sha256 !== sha256(filePath)
    ) {
      failures.push(`${entry.candidate}: runtime artifact identity mismatch`);
    }
  }
  const profile = readJson(entry.profile.relativePath);
  if (
    profile.encoder?.outputDimension !== 768 ||
    profile.featureShape?.totalDimension !== expectedDimension ||
    profile.featureShape?.ruleDimension !== expectedDimension - 768 ||
    profile.model?.numFeatures !== expectedDimension
  ) {
    failures.push(`${entry.candidate}: runtime profile feature shape is invalid`);
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

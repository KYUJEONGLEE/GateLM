import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATASET_PATH,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_PATH,
  RECORD_SCHEMA_PATH,
  DATASET_DIMENSIONS,
  verifyPersistedArtifacts,
} from "./enterprise-synthetic-8000-lib.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (relativePath) => readFileSync(path.join(rootDir, ...relativePath.split("/")), "utf8");

const datasetText = read(DATASET_PATH);
const manifest = JSON.parse(read(MANIFEST_PATH));
const recordSchema = JSON.parse(read(RECORD_SCHEMA_PATH));
const manifestSchema = JSON.parse(read(MANIFEST_SCHEMA_PATH));
const failures = verifyPersistedArtifacts(datasetText, manifest);

if (recordSchema.$id !== "https://gatelm.local/docs/routing/datasets/difficulty/schemas/difficulty-dataset-record.schema.json") {
  failures.push("record schema: version-independent $id is required");
}
if (manifestSchema.$id !== "https://gatelm.local/docs/routing/datasets/difficulty/schemas/difficulty-dataset-manifest.schema.json") {
  failures.push("manifest schema: version-independent $id is required");
}
if (recordSchema.properties?.redacted_prompt?.description?.includes("Customer raw prompt") !== true) {
  failures.push("record schema: redacted_prompt safety description is missing");
}
if (recordSchema.properties?.label?.enum?.join(",") !== "simple,complex") {
  failures.push("record schema: label enum must be simple,complex");
}
if (recordSchema.properties?.language?.enum?.join(",") !== "ko,en,mixed") {
  failures.push("record schema: language enum must be ko,en,mixed");
}
if (recordSchema.properties?.task_type?.enum?.length !== DATASET_DIMENSIONS.tasks.length) {
  failures.push("record schema: task_type enum does not match generator dimensions");
}
if (recordSchema.properties?.service_domain?.enum?.length !== DATASET_DIMENSIONS.domains.length) {
  failures.push("record schema: service_domain enum does not match generator dimensions");
}

if (failures.length > 0) {
  console.error("routing difficulty enterprise synthetic dataset verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("routing difficulty enterprise synthetic dataset verification passed.");
console.log(`records=${manifest.counts.records}, groups=${manifest.counts.groups}`);
console.log(`labels=${JSON.stringify(manifest.distributions.label)}`);
console.log(`languages=${JSON.stringify(manifest.distributions.language)}`);
console.log(`splits=${JSON.stringify(manifest.distributions.split)}`);

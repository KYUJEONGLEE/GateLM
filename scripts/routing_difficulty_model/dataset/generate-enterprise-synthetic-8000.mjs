import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATASET_PATH,
  MANIFEST_PATH,
  buildArtifacts,
} from "./enterprise-synthetic-8000-lib.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function absolutePath(relativePath) {
  return path.join(rootDir, ...relativePath.split("/"));
}

function checkFile(relativePath, expectedText) {
  const actualText = readFileSync(absolutePath(relativePath), "utf8");
  if (actualText !== expectedText) {
    throw new Error(`${relativePath}: generated artifact is stale; rerun without --check`);
  }
}

const artifacts = buildArtifacts();
if (process.argv.includes("--check")) {
  checkFile(DATASET_PATH, artifacts.datasetText);
  checkFile(MANIFEST_PATH, artifacts.manifestText);
  console.log("routing difficulty enterprise synthetic 8,000 dataset is deterministic and current.");
  process.exit(0);
}

for (const relativePath of [DATASET_PATH, MANIFEST_PATH]) {
  mkdirSync(path.dirname(absolutePath(relativePath)), { recursive: true });
}
writeFileSync(absolutePath(DATASET_PATH), artifacts.datasetText, "utf8");
writeFileSync(absolutePath(MANIFEST_PATH), artifacts.manifestText, "utf8");

console.log(`wrote ${artifacts.records.length} records to ${DATASET_PATH}`);
console.log(`wrote manifest to ${MANIFEST_PATH}`);

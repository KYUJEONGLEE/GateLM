import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUNDLE_MANIFEST_PATH,
  BUNDLE_PATH,
  DATASET_PATH,
  MANIFEST_PATH,
  buildArtifacts,
} from "./public-prompts-7000-lib.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const check = process.argv.includes("--check");
const artifacts = buildArtifacts({ rootDir });
const outputs = [
  [DATASET_PATH, artifacts.datasetText],
  [MANIFEST_PATH, artifacts.manifestText],
  [BUNDLE_PATH, artifacts.bundleText],
  [BUNDLE_MANIFEST_PATH, artifacts.bundleManifestText],
];

for (const [relativePath, expected] of outputs) {
  const absolutePath = path.join(rootDir, ...relativePath.split("/"));
  if (check) {
    if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== expected) {
      console.error(`${relativePath} is missing or stale`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(absolutePath, expected, "utf8");
    console.log(`wrote ${relativePath}`);
  }
}

if (!process.exitCode) {
  console.log(`public records=${artifacts.records.length}`);
  console.log(`bundle records=${artifacts.bundleRecords.length}`);
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUNDLE_MANIFEST_PATH,
  BUNDLE_PATH,
  DATASET_PATH,
  MANIFEST_PATH,
  verifyPersistedArtifacts,
} from "./public-prompts-7000-lib.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (relativePath) => readFileSync(path.join(rootDir, ...relativePath.split("/")), "utf8");
const datasetText = read(DATASET_PATH);
const bundleText = read(BUNDLE_PATH);
const manifest = JSON.parse(read(MANIFEST_PATH));
const bundleManifest = JSON.parse(read(BUNDLE_MANIFEST_PATH));
const failures = verifyPersistedArtifacts(datasetText, manifest, bundleText, bundleManifest);

if (failures.length) {
  console.error("routing difficulty public dataset verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("routing difficulty public dataset verification passed.");
console.log(`public_records=${manifest.counts.records}`);
console.log(`source_datasets=${JSON.stringify(manifest.distributions.source_dataset)}`);
console.log(`languages=${JSON.stringify(manifest.distributions.language)}`);
console.log(`labels=${JSON.stringify(manifest.distributions.label)}`);
console.log(`bundle_records=${bundleManifest.counts.records}`);

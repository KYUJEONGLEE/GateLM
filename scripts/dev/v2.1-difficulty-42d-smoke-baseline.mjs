import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "../..");
const datasetFile = "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl";
const splitManifestFile = "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json";
const smokeManifestFile = "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json";
const labelSmokeFile = "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.fixture.jsonl";
const labelManifestFile = "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.manifest.json";
const robustnessSlices = ["negation", "payload_contamination"];
const semanticLabelTargetClasses = {
  taskBucket: ["count_1", "count_2", "count_3_plus"],
  constraintBucket: ["count_0_to_1", "count_2", "count_3_plus"],
  scopeBucket: ["count_1", "count_2_to_3", "count_4_plus"],
  dependencyBucket: ["depth_0_to_1", "depth_2", "depth_3_plus"],
};

export function currentContractContext() {
  return {
    baselineFeatureContract: "difficulty-feature-vector.v1",
    baselineDimension: 42,
    semanticFeatureContractEvaluated: false,
    semanticProposalStatus: "proposed_not_active",
    semanticHeadCount: 4,
    semanticHeadProbabilityDimension: 12,
    semanticCandidateShapes: ["42", "42 + P", "54 + P"],
    emptySemanticInputPolicy: "fail_closed_until_versioned_representation_is_approved",
    currentSemanticLabelContract: "gatelm.difficulty-label-record.v2",
    semanticInputStatuses: ["eligible", "empty_instruction"],
    emptySemanticBucketTarget: "not_applicable",
  };
}

export function toolingSmokeEligibility() {
  return {
    evidenceClass: "training_tooling_smoke",
    partitionSemantics: "tooling_smoke_only",
    modelQualityComparisonEligible: false,
    semanticCandidateComparisonEligible: false,
    promotionGateApplicable: false,
    productionEvidenceEligible: false,
  };
}

export function assert42DArtifactContract(artifact) {
  if (artifact.featureVersion !== "difficulty-feature-vector.v1") {
    throw new Error("42D tooling baseline requires difficulty-feature-vector.v1");
  }
  if (!Array.isArray(artifact.weights) || artifact.weights.length !== 42) {
    throw new Error("42D tooling baseline requires exactly 42 model weights");
  }
}

export function assertLabelRecordContract(records, manifest) {
  if (
    manifest.schemaVersion !== "gatelm.difficulty-label-dataset-manifest.v2" ||
    manifest.recordSchemaVersion !== "gatelm.difficulty-label-record.v2"
  ) {
    throw new Error("42D tooling baseline requires the current v2 label manifest and record contract");
  }
  const versions = new Set(records.map((record) => record.schemaVersion));
  if (versions.size !== 1) throw new Error("label contract smoke must use exactly one record schema version");
  const [recordSchemaVersion] = versions;
  if (recordSchemaVersion !== manifest.recordSchemaVersion) {
    throw new Error("label contract smoke record schema does not match its manifest");
  }
  return recordSchemaVersion;
}

export function summarizeSemanticLabelEligibility(records, manifest) {
  const eligibleFamilies = new Set();
  const emptyFamilies = new Set();
  let eligibleRecords = 0;
  let emptyRecords = 0;
  for (const record of records) {
    if (record.semanticInputStatus === "eligible") {
      eligibleRecords += 1;
      eligibleFamilies.add(record.promptFamily);
      for (const [field, classes] of Object.entries(semanticLabelTargetClasses)) {
        if (!classes.includes(record[field])) {
          throw new Error(`eligible v2 label record has invalid ${field}`);
        }
      }
    } else if (record.semanticInputStatus === "empty_instruction") {
      emptyRecords += 1;
      emptyFamilies.add(record.promptFamily);
      for (const field of Object.keys(semanticLabelTargetClasses)) {
        if (record[field] !== "not_applicable") {
          throw new Error(`empty-instruction v2 label record must use not_applicable ${field}`);
        }
      }
    } else {
      throw new Error("v2 label record has an unsupported semanticInputStatus");
    }
    if (
      record.expectedInstructionPayloadBoundary?.kind === "payload_only" &&
      record.semanticInputStatus !== "empty_instruction"
    ) {
      throw new Error("payload-only v2 label record must use empty_instruction");
    }
  }
  const summary = {
    semanticHeadEligibleRecords: eligibleRecords,
    semanticHeadEligibleFamilies: eligibleFamilies.size,
    emptyInstructionRecords: emptyRecords,
    emptyInstructionFamilies: emptyFamilies.size,
  };
  for (const [field, value] of Object.entries(summary)) {
    if (manifest.counts?.[field] !== value) {
      throw new Error(`label contract smoke ${field} does not match its manifest`);
    }
  }
  return summary;
}

export function parseJSONL(text, source = "JSONL") {
  return text
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${source} line ${index + 1}: ${error.message}`);
      }
    });
}

export function legacyFamilyId(sampleId) {
  const match = /^difficulty_(general|code|translation|summarization|reasoning)_(?:simple|complex)_.+_(f\d{2})_v\d{2}$/u.exec(
    sampleId,
  );
  if (!match) throw new Error(`unsupported legacy difficulty sampleId ${sampleId}`);
  return `${match[1]}/${match[2]}`;
}

export function selectSplitRecords(records, manifest, split) {
  const assignments = new Map();
  for (const item of manifest.families ?? []) {
    if (assignments.has(item.familyId)) throw new Error(`duplicate family assignment ${item.familyId}`);
    assignments.set(item.familyId, item.split);
  }
  if (assignments.size === 0) throw new Error("split manifest has no family assignments");
  const selected = [];
  for (const record of records) {
    const familyId = legacyFamilyId(record.sampleId);
    const assignedSplit = assignments.get(familyId);
    if (!assignedSplit) throw new Error(`missing split assignment for ${familyId}`);
    if (assignedSplit === split) selected.push(record);
  }
  if (selected.length === 0) throw new Error(`split ${split} has no records`);
  return selected;
}

export function projectLabelRecords(records) {
  return records.map((record) => ({
    schemaVersion: "gatelm.difficulty-evaluation-record.v1",
    datasetVersion: record.datasetVersion,
    sampleId: record.sampleId,
    redactedPrompt: record.redactedPrompt,
    expectedCategory: record.expectedCategory,
    expectedDifficulty: record.expectedDifficulty,
    labelSource: record.labelSource,
    consentType: record.consentType,
    source: record.source,
    language: record.language,
    redactionVersion: record.redactionVersion,
    createdAt: record.createdAt,
    labelConfidence: record.labelConfidence,
    reviewerNote: record.reviewerNote,
  }));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function accuracy(samples, predictionField) {
  const correct = samples.filter((sample) => sample[predictionField] === sample.expectedDifficulty).length;
  const complex = samples.filter((sample) => sample.expectedDifficulty === "complex");
  const complexToSimple = complex.filter((sample) => sample[predictionField] === "simple").length;
  return {
    total: samples.length,
    correct,
    incorrect: samples.length - correct,
    accuracy: ratio(correct, samples.length),
    complexExpectedSamples: complex.length,
    complexToSimpleCount: complexToSimple,
    complexToSimpleRate: ratio(complexToSimple, complex.length),
  };
}

function classifierStats(samples, predictionField) {
  const byExpectedCategory = {};
  for (const category of [...new Set(samples.map((sample) => sample.expectedCategory))].sort()) {
    byExpectedCategory[category] = accuracy(
      samples.filter((sample) => sample.expectedCategory === category),
      predictionField,
    );
  }
  return { overall: accuracy(samples, predictionField), byExpectedCategory };
}

export function aggregateSliceResults(evaluation, labelRecords) {
  const samplesById = new Map(evaluation.samples.map((sample) => [sample.sampleId, sample]));
  return Object.fromEntries(
    robustnessSlices.map((slice) => {
      const sliceRecords = labelRecords.filter((record) => record.evaluationSlices?.includes(slice));
      if (sliceRecords.length === 0) throw new Error(`required evaluation slice ${slice} has no records`);
      const samples = sliceRecords.map((record) => {
        const sample = samplesById.get(record.sampleId);
        if (!sample) throw new Error(`evaluation result is missing slice sample ${record.sampleId}`);
        return sample;
      });
      return [
        slice,
        {
          sampleIds: samples.map((sample) => sample.sampleId).sort(),
          rule: accuracy(samples, "actualDifficulty"),
          candidate42d: accuracy(samples, "shadowDifficulty"),
        },
      ];
    }),
  );
}

function latency(rule, candidate) {
  return {
    rule,
    candidate42d: candidate,
    deltaAvgMicros: round(candidate.avgMicros - rule.avgMicros, 4),
    deltaP95Micros: round(candidate.p95Micros - rule.p95Micros, 4),
    avgRatio: rule.avgMicros > 0 ? round(candidate.avgMicros / rule.avgMicros, 4) : 0,
    p95Ratio: rule.p95Micros > 0 ? round(candidate.p95Micros / rule.p95Micros, 4) : 0,
  };
}

function comparison(evaluation) {
  if (!evaluation.shadow) throw new Error("shadow candidate report is missing");
  const rule = classifierStats(evaluation.samples, "actualDifficulty");
  const candidate42d = classifierStats(evaluation.samples, "shadowDifficulty");
  return {
    rule,
    candidate42d,
    accuracyDelta: round(candidate42d.overall.accuracy - rule.overall.accuracy, 4),
    complexToSimpleCountDelta:
      candidate42d.overall.complexToSimpleCount - rule.overall.complexToSimpleCount,
    runtimeComparison: evaluation.shadow.runtimeComparison,
    calibration: { rule: evaluation.calibration, candidate42d: evaluation.shadow.calibration },
    segments: evaluation.shadow.segments,
    latency: {
      category: evaluation.classificationLatency.category,
      difficulty: latency(evaluation.classificationLatency.difficulty, evaluation.shadow.difficultyLatency),
      total: latency(evaluation.classificationLatency.total, evaluation.shadow.totalLatency),
    },
  };
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    outputDir: ".tmp/difficulty-42d-smoke-baseline",
    python: process.env.GATELM_DIFFICULTY_PYTHON || "python",
    go: process.env.GATELM_GO_EXECUTABLE || "go",
    latencyIterations: 100,
    latencyWarmupIterations: 10,
    latencyBatchSize: 32,
    difficultyLatencyBatchSize: 4096,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    const value = argv[index + 1];
    switch (key) {
      case "--repo-root":
        options.repoRoot = path.resolve(value);
        break;
      case "--output-dir":
        options.outputDir = value;
        break;
      case "--python":
        options.python = value;
        break;
      case "--go":
        options.go = value;
        break;
      case "--latency-iterations":
        options.latencyIterations = integer(value, 1, key);
        break;
      case "--latency-warmup-iterations":
        options.latencyWarmupIterations = integer(value, 0, key);
        break;
      case "--latency-batch-size":
        options.latencyBatchSize = integer(value, 1, key);
        break;
      case "--difficulty-latency-batch-size":
        options.difficultyLatencyBatchSize = integer(value, 1, key);
        break;
      default:
        throw new Error(`unsupported argument ${key}`);
    }
    index += 1;
  }
  return options;
}

function integer(value, minimum, key) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${key} must be >= ${minimum}`);
  return parsed;
}

function run(command, args, cwd, env) {
  const completed = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true });
  if (completed.error) throw completed.error;
  if (completed.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${completed.status}\n${completed.stdout ?? ""}${completed.stderr ?? ""}`,
    );
  }
  return (completed.stdout ?? "").trim();
}

function baseEnvironment(repoRoot) {
  return { ...process.env, GOCACHE: path.resolve(repoRoot, ".gocache"), GOTELEMETRY: "off" };
}

function pythonEnvironment(repoRoot, goExecutable) {
  const env = baseEnvironment(repoRoot);
  const paths = [path.resolve(repoRoot, "scripts/routing_difficulty_model")];
  const numeric = process.env.GATELM_DIFFICULTY_NUMERIC_PATH;
  if (numeric) {
    const resolved = path.resolve(repoRoot, numeric);
    paths.unshift(resolved);
    env.PATH = [path.join(resolved, "numpy.libs"), path.join(resolved, "scipy.libs"), env.PATH].join(
      path.delimiter,
    );
  }
  if (env.PYTHONPATH) paths.push(env.PYTHONPATH);
  env.PYTHONPATH = paths.join(path.delimiter);
  env.GATELM_GO_EXECUTABLE = goExecutable;
  return env;
}

function readJSON(repoRoot, file) {
  return JSON.parse(readFileSync(path.resolve(repoRoot, file), "utf8"));
}

function writeJSONL(file, records) {
  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function train(repoRoot, outputDir, options) {
  const artifact = path.join(outputDir, "difficulty-model-42d-smoke-candidate.json");
  const report = path.join(outputDir, "difficulty-training-smoke-report.json");
  run(
    options.python,
    [
      "-m",
      "gatelm_difficulty_model.cli",
      "--dataset",
      path.resolve(repoRoot, datasetFile),
      "--split-manifest",
      path.resolve(repoRoot, splitManifestFile),
      "--artifact-version",
      "difficulty-logistic-v1-42d-tooling-smoke-baseline",
      "--artifact-output",
      artifact,
      "--report-output",
      report,
    ],
    repoRoot,
    pythonEnvironment(repoRoot, options.go),
  );
  return { artifact, report };
}

function evaluate(repoRoot, dataset, artifact, output, options) {
  run(
    options.go,
    [
      "run",
      "./apps/gateway-core/cmd/routing-eval",
      "-evaluation-scope",
      "difficulty",
      "-dataset",
      dataset,
      "-difficulty-shadow-model-artifact",
      artifact,
      "-latency-iterations",
      String(options.latencyIterations),
      "-latency-warmup-iterations",
      String(options.latencyWarmupIterations),
      "-latency-batch-size",
      String(options.latencyBatchSize),
      "-difficulty-latency-batch-size",
      String(options.difficultyLatencyBatchSize),
      "-output",
      output,
    ],
    repoRoot,
    baseEnvironment(repoRoot),
  );
  return JSON.parse(readFileSync(output, "utf8"));
}

function markdown(report) {
  const value = report.holdout.comparison;
  const lines = [
    "# GateLM 42D Difficulty Tooling-Smoke Baseline",
    "",
    `- Commit: \`${report.provenance.commit}\``,
    `- Dataset: \`${report.provenance.dataset.version}\` (` + "`trainingEligible=false`" + ")",
    `- Artifact: \`${report.provenance.artifact.contentHash}\``,
    "- Status: synthetic tooling smoke only; not model-quality, semantic-candidate, promotion, or production evidence",
    `- Semantic candidate comparison eligible: \`${report.eligibility.semanticCandidateComparisonEligible}\``,
    `- Promotion gate applicable: \`${report.eligibility.promotionGateApplicable}\``,
    `- Contract scope: exact ${report.contractContext.baselineDimension}D \`${report.contractContext.baselineFeatureContract}\` only; semantic proposal not evaluated`,
    `- Slice label contract: \`${report.labelContractSmoke.recordSchemaVersion}\`; annotation-only semantic targets not evaluated`,
    `- Slice semantic eligibility: ${report.labelContractSmoke.semanticEligibility.semanticHeadEligibleRecords} eligible / ${report.labelContractSmoke.semanticEligibility.emptyInstructionRecords} empty-instruction records`,
    "",
    "| Metric | Rule | 42D hybrid | Delta |",
    "|---|---:|---:|---:|",
    `| Holdout accuracy | ${value.rule.overall.accuracy} | ${value.candidate42d.overall.accuracy} | ${value.accuracyDelta} |`,
    `| complex → simple | ${value.rule.overall.complexToSimpleCount} | ${value.candidate42d.overall.complexToSimpleCount} | ${value.complexToSimpleCountDelta} |`,
    `| Total avg latency (µs) | ${value.latency.total.rule.avgMicros} | ${value.latency.total.candidate42d.avgMicros} | ${value.latency.total.deltaAvgMicros} |`,
    `| Total p95 latency (µs) | ${value.latency.total.rule.p95Micros} | ${value.latency.total.candidate42d.p95Micros} | ${value.latency.total.deltaP95Micros} |`,
    "",
    "## Expected-category breakdown",
    "",
    "| Category | Rule accuracy | 42D accuracy | Rule complex→simple | 42D complex→simple |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const category of Object.keys(value.rule.byExpectedCategory).sort()) {
    const rule = value.rule.byExpectedCategory[category];
    const candidate = value.candidate42d.byExpectedCategory[category];
    lines.push(
      `| ${category} | ${rule.accuracy} | ${candidate.accuracy} | ${rule.complexToSimpleCount}/${rule.complexExpectedSamples} | ${candidate.complexToSimpleCount}/${candidate.complexExpectedSamples} |`,
    );
  }
  lines.push(
    "",
    `Tooling-smoke directional diagnostic: **${value.runtimeComparison.safetyGatePassed ? "PASS" : "FAIL"}** (promotion gate: N/A)`,
    "",
    "## Robustness contract-smoke slices",
    "",
    "| Slice | N | Rule accuracy | 42D accuracy |",
    "|---|---:|---:|---:|",
  );
  for (const [slice, stats] of Object.entries(report.labelContractSmoke.slices)) {
    lines.push(`| ${slice} | ${stats.rule.total} | ${stats.rule.accuracy} | ${stats.candidate42d.accuracy} |`);
  }
  lines.push(
    "",
    "Slice records are pending synthetic contract-smoke cases and are too small for quality claims.",
    "",
  );
  return lines.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repoRoot = options.repoRoot;
  const outputDir = path.resolve(repoRoot, options.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const datasetText = readFileSync(path.resolve(repoRoot, datasetFile), "utf8");
  const datasetHash = createHash("sha256").update(datasetText, "utf8").digest("hex");
  const records = parseJSONL(datasetText, datasetFile);
  const splitManifest = readJSON(repoRoot, splitManifestFile);
  const smokeManifest = readJSON(repoRoot, smokeManifestFile);
  if (datasetHash !== splitManifest.datasetSha256 || datasetHash !== smokeManifest.datasetSha256) {
    throw new Error("difficulty tooling-smoke dataset hash does not match its manifests");
  }
  if (
    smokeManifest.schemaVersion !== "gatelm.difficulty-label-dataset-manifest.v2" ||
    smokeManifest.trainingEligible !== false ||
    smokeManifest.datasetPurpose !== "training_tooling_smoke"
  ) {
    throw new Error("500-record smoke must remain non-training-eligible training_tooling_smoke data");
  }
  if (records.length !== smokeManifest.counts.records || records.length !== splitManifest.totals.samples) {
    throw new Error("500-record smoke count does not match its manifests");
  }

  const holdoutRecords = selectSplitRecords(records, splitManifest, "holdout");
  const holdoutFamilies = new Set(holdoutRecords.map((record) => legacyFamilyId(record.sampleId)));
  if (
    holdoutRecords.length !== splitManifest.splitCounts.holdout.samples ||
    holdoutFamilies.size !== splitManifest.splitCounts.holdout.families
  ) {
    throw new Error("holdout sample or family count does not match the family split manifest");
  }
  const holdoutProjection = path.join(outputDir, "difficulty-holdout-projection.jsonl");
  writeJSONL(holdoutProjection, holdoutRecords);

  const labelText = readFileSync(path.resolve(repoRoot, labelSmokeFile), "utf8");
  const labelHash = createHash("sha256").update(labelText, "utf8").digest("hex");
  const labelRecords = parseJSONL(labelText, labelSmokeFile);
  const labelManifest = readJSON(repoRoot, labelManifestFile);
  if (
    labelHash !== labelManifest.datasetSha256 ||
    labelManifest.trainingEligible !== false ||
    labelManifest.datasetPurpose !== "label_contract_smoke" ||
    labelRecords.length !== labelManifest.counts.records
  ) {
    throw new Error("label contract smoke hash, purpose, eligibility, or count does not match its manifest");
  }
  if (labelManifest.families.some((family) => family.reviewStatus !== "pending" || family.humanReviewed !== false)) {
    throw new Error("label contract smoke must remain pending and not human-reviewed");
  }
  const labelRecordSchemaVersion = assertLabelRecordContract(labelRecords, labelManifest);
  const semanticEligibility = summarizeSemanticLabelEligibility(labelRecords, labelManifest);
  const labelProjection = path.join(outputDir, "difficulty-label-contract-smoke-projection.jsonl");
  writeJSONL(labelProjection, projectLabelRecords(labelRecords));

  const trained = train(repoRoot, outputDir, options);
  const holdoutEvaluationFile = path.join(outputDir, "difficulty-holdout-evaluation.json");
  const labelEvaluationFile = path.join(outputDir, "difficulty-label-contract-smoke-evaluation.json");
  const holdoutEvaluation = evaluate(
    repoRoot,
    holdoutProjection,
    trained.artifact,
    holdoutEvaluationFile,
    options,
  );
  const labelEvaluation = evaluate(
    repoRoot,
    labelProjection,
    trained.artifact,
    labelEvaluationFile,
    options,
  );

  const artifact = JSON.parse(readFileSync(trained.artifact, "utf8"));
  assert42DArtifactContract(artifact);
  const trainingReport = JSON.parse(readFileSync(trained.report, "utf8"));
  const env = baseEnvironment(repoRoot);
  const command = (name, args) => run(name, args, repoRoot, env);
  const cpu = os.cpus();
  const report = {
    schemaVersion: "gatelm.difficulty-42d-tooling-smoke-baseline.v2",
    contractContext: currentContractContext(),
    eligibility: toolingSmokeEligibility(),
    provenance: {
      measuredAt: new Date().toISOString(),
      commit: command("git", ["rev-parse", "HEAD"]),
      branch: command("git", ["branch", "--show-current"]),
      originDev: command("git", ["rev-parse", "origin/dev"]),
      dirtyWorktree: command("git", ["status", "--porcelain"]) !== "",
      dataset: {
        version: smokeManifest.datasetVersion,
        sha256: datasetHash,
        purpose: smokeManifest.datasetPurpose,
        trainingEligible: false,
        labelCoverageStatus: smokeManifest.labelCoverageStatus,
        approvedHumanReviewedFamilies: smokeManifest.counts.approvedHumanReviewedFamilies,
      },
      splitPolicyVersion: splitManifest.splitPolicyVersion,
      familyRuleVersion: splitManifest.familyRuleVersion,
      splitCounts: trainingReport.splitCounts,
      modelPathSplitCounts: trainingReport.modelPathSplitCounts,
      artifact: {
        artifactVersion: artifact.artifactVersion,
        modelVersion: artifact.modelVersion,
        featureVersion: artifact.featureVersion,
        calibrationVersion: artifact.calibrationVersion,
        calibratorType: artifact.calibrator.type,
        thresholdPolicyVersion: artifact.thresholdPolicyVersion,
        threshold: artifact.threshold,
        contentHash: artifact.contentHash,
      },
      environment: {
        node: process.version,
        go: command(options.go, ["version"]),
        platform: process.platform,
        osRelease: os.release(),
        architecture: process.arch,
        cpuModel: cpu[0]?.model ?? "unknown",
        cpuCount: cpu.length,
        latencyIterations: options.latencyIterations,
        latencyWarmupIterations: options.latencyWarmupIterations,
        latencyBatchSize: options.latencyBatchSize,
        difficultyLatencyBatchSize: options.difficultyLatencyBatchSize,
      },
      productRuntimeChanged: false,
    },
    holdout: {
      split: "holdout",
      partitionSemantics: "tooling_smoke_only",
      families: holdoutFamilies.size,
      samples: holdoutRecords.length,
      comparison: comparison(holdoutEvaluation),
    },
    labelContractSmoke: {
      datasetVersion: labelManifest.datasetVersion,
      recordSchemaVersion: labelRecordSchemaVersion,
      sha256: labelHash,
      trainingEligible: false,
      reviewStatus: "pending",
      semanticEligibility,
      samples: labelRecords.length,
      slices: aggregateSliceResults(labelEvaluation, labelRecords),
    },
    limitations: [
      "The 500-record dataset and split are synthetic training-tooling smoke only.",
      "There are zero approved human-reviewed families, so this is not promotion or production evidence.",
      "This report does not evaluate the proposed semantic feature contract and cannot rank semantic candidates.",
      "The current semantic proposal uses four heads / 12 probabilities and candidate shapes 42, 42 + P, and 54 + P.",
      "Empty semantic input remains fail-closed until a versioned representation is approved; this 42D v1 sentinel path does not define that semantic representation.",
      `The robustness slice fixture uses ${labelRecordSchemaVersion}; its annotation-only semantic targets are not evaluated here.`,
      "Negation and payload-contamination use a very small pending label-contract smoke fixture.",
      "The measurement was made from the recorded dirty worktree and commit provenance.",
    ],
  };

  const jsonFile = path.join(outputDir, "difficulty-42d-smoke-baseline.json");
  const markdownFile = path.join(outputDir, "difficulty-42d-smoke-baseline.md");
  writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownFile, markdown(report), "utf8");
  process.stdout.write(`wrote ${jsonFile}\nwrote ${markdownFile}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

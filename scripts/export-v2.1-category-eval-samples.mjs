import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultInputPath = "docs/v2.1.0/fixtures/category-evaluation-capture.fixture.jsonl";
const defaultDatasetVersion = "category_eval_capture_2026_07_02_v1";
const schemaVersion = "gatelm.category-evaluation-record.v1";

const allowedCategories = new Set(["general", "code", "translation", "support_refund", "unknown"]);
const allowedLabelSources = new Set(["human_review", "synthetic_fixture", "llm_judge_candidate"]);
const allowedConsentTypes = new Set(["synthetic", "operator_opt_in", "customer_opt_in"]);
const allowedSources = new Set(["synthetic_fixture", "gateway_redacted_sample", "manual_seed"]);
const allowedLanguages = new Set(["en", "ko", "mixed", "unknown"]);
const forbiddenKeyPattern =
  /(rawPrompt|rawResponse|rawDetectedValue|rawPromptFragment|apiKey|appToken|providerKey|authorizationHeader|providerRawErrorBody|actualSecret|authorization|providerKey|api_key|app_token)/i;
const secretShapePattern =
  /(sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{12,}|-----BEGIN\s+(RSA|OPENSSH|EC|PRIVATE)\s+KEY-----)/i;
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

function toAbsolute(relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(rootDir, relativeOrAbsolutePath);
}

function parseArgs(argv) {
  const options = {
    input: defaultInputPath,
    output: "",
    datasetVersion: defaultDatasetVersion,
    dryRun: false,
    stdout: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[index];
    };

    switch (arg) {
      case "--input":
        options.input = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--dataset-version":
        options.datasetVersion = next();
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--stdout":
        options.stdout = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function readJsonl(filePath, failures) {
  const absolutePath = toAbsolute(filePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${filePath}: file is missing`);
    return [];
  }

  const text = readFileSync(absolutePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      try {
        return { record: JSON.parse(line), lineNumber };
      } catch (error) {
        failures.push(`${filePath}: line ${lineNumber}: invalid JSON (${error.message})`);
        return { record: undefined, lineNumber };
      }
    });
}

function pushFailure(failures, inputPath, lineNumber, message) {
  failures.push(`${inputPath}: line ${lineNumber}: ${message}`);
}

function assertNoForbiddenData(value, failures, inputPath, lineNumber, jsonPath = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenData(item, failures, inputPath, lineNumber, `${jsonPath}[${index}]`));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeyPattern.test(key)) {
        pushFailure(failures, inputPath, lineNumber, `forbidden sensitive key at ${jsonPath}.${key}`);
      }
      assertNoForbiddenData(child, failures, inputPath, lineNumber, `${jsonPath}.${key}`);
    }
    return;
  }

  if (typeof value === "string" && secretShapePattern.test(value)) {
    pushFailure(failures, inputPath, lineNumber, `forbidden secret-shaped string at ${jsonPath}`);
  }
}

function validateCaptureRecord(record, lineNumber, failures, inputPath) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    pushFailure(failures, inputPath, lineNumber, "expected JSON object");
    return;
  }

  assertNoForbiddenData(record, failures, inputPath, lineNumber);

  for (const field of ["redactedPrompt", "expectedCategory", "labelSource", "consentType", "source", "redactionVersion"]) {
    if (typeof record[field] !== "string" || record[field].trim() === "") {
      pushFailure(failures, inputPath, lineNumber, `${field} is required`);
    }
  }

  if (typeof record.redactedPrompt === "string" && record.redactedPrompt.length > 65536) {
    pushFailure(failures, inputPath, lineNumber, "redactedPrompt exceeds 65536 characters");
  }

  if (record.expectedCategory && !allowedCategories.has(record.expectedCategory)) {
    pushFailure(failures, inputPath, lineNumber, `expectedCategory is not allowed: ${record.expectedCategory}`);
  }

  if (record.labelSource && !allowedLabelSources.has(record.labelSource)) {
    pushFailure(failures, inputPath, lineNumber, `labelSource is not allowed: ${record.labelSource}`);
  }

  if (record.consentType && !allowedConsentTypes.has(record.consentType)) {
    pushFailure(failures, inputPath, lineNumber, `consentType is not allowed: ${record.consentType}`);
  }

  if (record.source && !allowedSources.has(record.source)) {
    pushFailure(failures, inputPath, lineNumber, `source is not allowed: ${record.source}`);
  }

  if (record.language !== undefined && !allowedLanguages.has(record.language)) {
    pushFailure(failures, inputPath, lineNumber, `language is not allowed: ${record.language}`);
  }

  if (record.createdAt !== undefined && (!isoDateTimePattern.test(record.createdAt) || Number.isNaN(Date.parse(record.createdAt)))) {
    pushFailure(failures, inputPath, lineNumber, "createdAt must be ISO-8601 date-time");
  }

  if (record.labelConfidence !== undefined) {
    if (typeof record.labelConfidence !== "number" || record.labelConfidence < 0 || record.labelConfidence > 1) {
      pushFailure(failures, inputPath, lineNumber, "labelConfidence must be a number between 0 and 1");
    }
  }

  if (record.reviewerNote !== undefined && (typeof record.reviewerNote !== "string" || record.reviewerNote.length > 240)) {
    pushFailure(failures, inputPath, lineNumber, "reviewerNote must be a string up to 240 characters");
  }

  if (record.source === "synthetic_fixture") {
    if (record.consentType !== "synthetic") {
      pushFailure(failures, inputPath, lineNumber, "synthetic_fixture must use consentType=synthetic");
    }
    if (record.labelSource !== "synthetic_fixture") {
      pushFailure(failures, inputPath, lineNumber, "synthetic_fixture must use labelSource=synthetic_fixture");
    }
  }

  if (record.source === "gateway_redacted_sample") {
    if (!["operator_opt_in", "customer_opt_in"].includes(record.consentType)) {
      pushFailure(failures, inputPath, lineNumber, "gateway_redacted_sample requires operator_opt_in or customer_opt_in");
    }
    if (record.labelSource === "synthetic_fixture") {
      pushFailure(failures, inputPath, lineNumber, "gateway_redacted_sample must not use labelSource=synthetic_fixture");
    }
  }
}

function safeSampleId(value, fallback) {
  const candidate = String(value ?? "").trim();
  const safe = candidate.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 160);
  return safe || fallback;
}

function buildEvaluationRecord(record, index, options) {
  const source = record.source;
  const fallbackSampleId = `capture_${source}_${String(index + 1).padStart(3, "0")}`;
  const output = {
    schemaVersion,
    datasetVersion: options.datasetVersion,
    sampleId: safeSampleId(record.sampleId ?? record.captureId, fallbackSampleId),
    redactedPrompt: record.redactedPrompt.trim(),
    expectedCategory: record.expectedCategory,
    labelSource: record.labelSource,
    consentType: record.consentType,
    source,
    language: record.language ?? "unknown",
    redactionVersion: record.redactionVersion,
    createdAt: record.createdAt ?? new Date().toISOString(),
  };

  if (record.labelConfidence !== undefined) {
    output.labelConfidence = record.labelConfidence;
  }
  if (record.reviewerNote !== undefined) {
    output.reviewerNote = record.reviewerNote;
  }

  return output;
}

export function exportCategoryEvaluationSamples(options = {}) {
  const failures = [];
  const input = options.input ?? defaultInputPath;
  const parsedLines = readJsonl(input, failures);
  const records = [];

  parsedLines.forEach(({ record, lineNumber }, index) => {
    if (record === undefined) {
      return;
    }
    validateCaptureRecord(record, lineNumber, failures, input);
    records.push({ record, index });
  });

  if (records.length === 0) {
    failures.push(`${input}: expected at least one capture record`);
  }

  if (failures.length > 0) {
    return { failures, records: [] };
  }

  const datasetRecords = records.map(({ record, index }) =>
    buildEvaluationRecord(record, index, {
      datasetVersion: options.datasetVersion ?? defaultDatasetVersion,
    }),
  );

  return { failures, records: datasetRecords };
}

export function verifyCategoryEvaluationCaptureExport(options = {}) {
  return exportCategoryEvaluationSamples({
    input: options.input ?? defaultInputPath,
    datasetVersion: options.datasetVersion ?? "category_eval_capture_smoke_2026_07_02_v1",
  }).failures;
}

function writeJsonl(outputPath, records) {
  const absolutePath = toAbsolute(outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const payload = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  writeFileSync(absolutePath, payload, "utf8");
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const result = exportCategoryEvaluationSamples(options);
  if (result.failures.length > 0) {
    console.error("v2.1 category evaluation sample export failed:");
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  if (options.stdout) {
    process.stdout.write(result.records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  }

  if (!options.dryRun && options.output) {
    writeJsonl(options.output, result.records);
  }

  const message = `v2.1 category evaluation sample export passed. records=${result.records.length}`;
  if (options.stdout) {
    console.error(message);
  } else {
    console.log(message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

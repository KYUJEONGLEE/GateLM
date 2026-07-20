import { createGunzip } from "node:zlib";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cacheDir = path.join(rootDir, ".tmp", "routing-public-sources");
mkdirSync(cacheDir, { recursive: true });

const SOURCES = {
  aya: {
    repo: "CohereLabs/aya_dataset",
    revision: "f9ea04583f02a8f86404ff6c58bf75fe637df8a2",
    url: "https://huggingface.co/datasets/CohereLabs/aya_dataset/resolve/f9ea04583f02a8f86404ff6c58bf75fe637df8a2/data/train-00000-of-00001.parquet?download=true",
  },
  dolly: {
    repo: "databricks/databricks-dolly-15k",
    revision: "bdd27f4d94b9c1f951818a7da7fd7aeea5dbff1a",
    url: "https://huggingface.co/datasets/databricks/databricks-dolly-15k/resolve/bdd27f4d94b9c1f951818a7da7fd7aeea5dbff1a/databricks-dolly-15k.jsonl?download=true",
  },
  kullmDolly: {
    repo: "nlpai-lab/kullm-v2",
    revision: "cddcb73c259269928e974e0ce141f123eb068030",
    config: "default",
    split: "train",
    offset: 52002,
    rowsToFetch: 15011,
  },
  hrm8k: {
    repo: "HAERAE-HUB/HRM8K",
    revision: "c360cabf8d733a82455565358b3dc965aab9ba8d",
    config: "KSM",
    split: "test",
  },
  haeraeBench2: {
    repo: "HAERAE-HUB/HAE_RAE_BENCH_2.0",
    revision: "87bf691006fbd6c3440238802fd8cb4e9bdbcffe",
    configs: [
      "date_understanding",
      "context_definition_alignment",
      "proverb_unscrambling",
      "2_digit_multiply",
      "3_digit_subtract",
    ],
    split: "test",
  },
  k2Eval: {
    repo: "HAERAE-HUB/K2-Eval",
    revision: "14bbbc9ee6eef17368508735700465eedc9ec4c5",
    config: "generation",
    split: "test",
  },
  oasst1: {
    repo: "OpenAssistant/oasst1",
    revision: "fdf72ae0827c1cda404aff25b6603abec9e3399b",
    url: "https://huggingface.co/datasets/OpenAssistant/oasst1/resolve/fdf72ae0827c1cda404aff25b6603abec9e3399b/2023-04-12_oasst_prompts.messages.jsonl.gz?download=true",
  },
  klue: {
    repo: "klue/klue",
    revision: "349481ec73fff722f88e0453ca05c77a447d967c",
    config: "mrc",
    split: "train",
  },
  kite: {
    repo: "junkim100/KITE",
    revision: "b02c5cf191a1fd2691b7154875fef46e2aeedc95",
    configs: ["culturally_aware_all", "translated_and_filtered"],
    split: "test",
  },
};

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { "user-agent": "GateLM-routing-dataset-acquisition/1.0" } });
  if ((response.status === 429 || response.status >= 500) && attempt < 8) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 750 * 2 ** attempt;
    await pause(Math.min(delay, 30000));
    return fetchJson(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function assertRevision({ repo, revision }) {
  const metadata = await fetchJson(`https://huggingface.co/api/datasets/${repo}`);
  if (metadata.private || metadata.gated) {
    throw new Error(`${repo}: anonymous public access required (private=${metadata.private}, gated=${metadata.gated})`);
  }
  if (metadata.sha !== revision) {
    throw new Error(`${repo}: expected revision ${revision}, got ${metadata.sha}; review license/source changes first`);
  }
}

function rowsUrl({ repo, config, split, offset, length }) {
  const params = new URLSearchParams({
    dataset: repo,
    config,
    split,
    offset: String(offset),
    length: String(length),
  });
  return `https://datasets-server.huggingface.co/rows?${params}`;
}

async function fetchRows(source, limit = Number.POSITIVE_INFINITY) {
  const first = await fetchJson(rowsUrl({ ...source, offset: 0, length: 100 }));
  const total = Math.min(first.num_rows_total, limit);
  const rows = first.rows.slice(0, total);
  const offsets = [];
  for (let offset = 100; offset < total; offset += 100) offsets.push(offset);
  for (let cursor = 0; cursor < offsets.length; cursor += 3) {
    const pageOffsets = offsets.slice(cursor, cursor + 3);
    const pages = await Promise.all(
      pageOffsets.map((offset) => fetchJson(rowsUrl({ ...source, offset, length: Math.min(100, total - offset) }))),
    );
    for (const page of pages) rows.push(...page.rows);
    if (cursor + 3 < offsets.length) await pause(150);
  }
  return rows.slice(0, total);
}

async function fetchRowsRange(source, offset, length) {
  const rows = [];
  const offsets = [];
  for (let cursor = offset; cursor < offset + length; cursor += 100) offsets.push(cursor);
  for (let cursor = 0; cursor < offsets.length; cursor += 3) {
    const pageOffsets = offsets.slice(cursor, cursor + 3);
    const pages = await Promise.all(
      pageOffsets.map((pageOffset) =>
        fetchJson(rowsUrl({
          ...source,
          offset: pageOffset,
          length: Math.min(100, offset + length - pageOffset),
        })),
      ),
    );
    for (const page of pages) rows.push(...page.rows);
    if (cursor + 3 < offsets.length) await pause(150);
  }
  return rows.slice(0, length);
}

async function download(url, outputPath) {
  if (existsSync(outputPath)) return;
  const response = await fetch(url, { headers: { "user-agent": "GateLM-routing-dataset-acquisition/1.0" } });
  if (!response.ok || !response.body) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  await pipeline(response.body, createWriteStream(outputPath));
}

async function acquireOasst1() {
  const archivePath = path.join(cacheDir, "oasst1-prompts.jsonl.gz");
  const outputPath = path.join(cacheDir, "oasst1-prompts-only.jsonl");
  await download(SOURCES.oasst1.url, archivePath);
  if (!existsSync(outputPath)) await pipeline(createReadStream(archivePath), createGunzip(), createWriteStream(outputPath));
  return outputPath;
}

async function acquireAya() {
  const sourcePath = path.join(cacheDir, "aya-train.parquet");
  await download(SOURCES.aya.url, sourcePath);
  return sourcePath;
}

async function acquireDolly() {
  const sourcePath = path.join(cacheDir, "dolly-15k.jsonl");
  const outputPath = path.join(cacheDir, "dolly-prompts.jsonl");
  await download(SOURCES.dolly.url, sourcePath);
  const rows = readFileSync(sourcePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, rowIdx) => {
      const row = JSON.parse(line);
      return {
        row_idx: rowIdx,
        instruction: row.instruction,
        context: row.context,
        category: row.category,
      };
    });
  writeJsonl("dolly-prompts.jsonl", rows);
  return { outputPath, rows: rows.length };
}

function writeJsonl(fileName, rows) {
  const outputPath = path.join(cacheDir, fileName);
  writeFileSync(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return outputPath;
}

function countJsonlRows(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim()).length;
}

async function acquireCachedJsonl(fileName, loadRows, mapRow) {
  const outputPath = path.join(cacheDir, fileName);
  if (existsSync(outputPath)) return { outputPath, rows: countJsonlRows(outputPath) };
  const rows = await loadRows();
  writeJsonl(fileName, rows.map(mapRow));
  return { outputPath, rows: rows.length };
}

async function main() {
  const inspectRowsArgument = process.argv.find((argument) => argument.startsWith("--inspect-rows="));
  if (inspectRowsArgument) {
    const [repo, config = "default", split = "train", rawLength = "5", rawOffset = "0"] = inspectRowsArgument
      .slice("--inspect-rows=".length)
      .split(":");
    const page = await fetchJson(rowsUrl({ repo, config, split, offset: Number(rawOffset), length: Number(rawLength) }));
    const rows = page.rows;
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const inspectFileArgument = process.argv.find((argument) => argument.startsWith("--inspect-file="));
  if (inspectFileArgument) {
    const spec = inspectFileArgument.slice("--inspect-file=".length);
    const separator = spec.indexOf(":");
    if (separator < 1) throw new Error("--inspect-file expects repository:path");
    const repo = spec.slice(0, separator);
    const filePath = spec.slice(separator + 1);
    const response = await fetch(`https://huggingface.co/datasets/${repo}/resolve/main/${filePath}`, {
      headers: { "user-agent": "GateLM-routing-dataset-acquisition/1.0" },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${repo}/${filePath}`);
    console.log(await response.text());
    return;
  }

  const inspectRepoArgument = process.argv.find((argument) => argument.startsWith("--inspect-repo="));
  if (inspectRepoArgument) {
    const repo = inspectRepoArgument.slice("--inspect-repo=".length);
    const metadata = await fetchJson(`https://huggingface.co/api/datasets/${repo}`);
    console.log(JSON.stringify({
      id: metadata.id,
      sha: metadata.sha,
      private: metadata.private,
      gated: metadata.gated,
      disabled: metadata.disabled,
      downloads: metadata.downloads,
      tags: metadata.tags,
      cardData: metadata.cardData,
      siblings: metadata.siblings?.map(({ rfilename }) => rfilename),
    }, null, 2));
    return;
  }

  await Promise.all(Object.values(SOURCES).map(assertRevision));

  const [oasstPath, ayaPath, dolly] = await Promise.all([acquireOasst1(), acquireAya(), acquireDolly()]);
  const klueCachePath = path.join(cacheDir, "klue-mrc-prompts.jsonl");
  const klueRows = existsSync(klueCachePath)
    ? null
    : await fetchRows(SOURCES.klue);

  const kluePath = klueRows === null
    ? klueCachePath
    : writeJsonl(
        "klue-mrc-prompts.jsonl",
        klueRows.map(({ row_idx, row }) => ({
          row_idx,
          guid: row.guid,
          question: row.question,
          context: row.context,
          title: row.title,
          source: row.source,
          question_type: row.question_type,
          is_impossible: row.is_impossible,
        })),
      );
  const kite = await acquireCachedJsonl(
    "kite-prompts.jsonl",
    async () => (await Promise.all(
      SOURCES.kite.configs.map(async (config) =>
        (await fetchRows({ ...SOURCES.kite, config })).map((item) => ({ config, ...item })),
      ),
    )).flat(),
    ({ config, row_idx, row }) => ({ config, row_idx, instruction: row.instruction }),
  );
  const kullmDolly = await acquireCachedJsonl(
    "kullm-v2-dolly-prompts.jsonl",
    () => fetchRowsRange(SOURCES.kullmDolly, SOURCES.kullmDolly.offset, SOURCES.kullmDolly.rowsToFetch),
    ({ row_idx, row }) => ({ row_idx, instruction: row.instruction, input: row.input }),
  );
  const hrm8k = await acquireCachedJsonl(
    "hrm8k-ksm-prompts.jsonl",
    () => fetchRows(SOURCES.hrm8k),
    ({ row_idx, row }) => ({ row_idx, question: row.question, category: row.category, difficulty: row.difficulty }),
  );
  const haeraeBench2 = await acquireCachedJsonl(
    "haerae-bench-2-prompts.jsonl",
    async () => (await Promise.all(
      SOURCES.haeraeBench2.configs.map(async (config) =>
        (await fetchRows({ ...SOURCES.haeraeBench2, config })).map((item) => ({ config, ...item })),
      ),
    )).flat(),
    ({ config, row_idx, row }) => ({ config, row_idx, question: row.question }),
  );
  const k2Eval = await acquireCachedJsonl(
    "k2-eval-prompts.jsonl",
    () => fetchRows(SOURCES.k2Eval),
    ({ row_idx, row }) => ({ row_idx, instruction: row.instruction, subject: row.subject, ability: row.ability }),
  );

  const summary = {
    acquired_at: "2026-07-21T00:00:00Z",
    sources: SOURCES,
    cache_files: {
      aya_source: path.relative(rootDir, ayaPath).replaceAll("\\", "/"),
      aya_prompts: ".tmp/routing-public-sources/aya-prompts.jsonl",
      dolly: path.relative(rootDir, dolly.outputPath).replaceAll("\\", "/"),
      kullm_dolly: path.relative(rootDir, kullmDolly.outputPath).replaceAll("\\", "/"),
      hrm8k: path.relative(rootDir, hrm8k.outputPath).replaceAll("\\", "/"),
      haerae_bench_2: path.relative(rootDir, haeraeBench2.outputPath).replaceAll("\\", "/"),
      k2_eval: path.relative(rootDir, k2Eval.outputPath).replaceAll("\\", "/"),
      oasst1: path.relative(rootDir, oasstPath).replaceAll("\\", "/"),
      klue: path.relative(rootDir, kluePath).replaceAll("\\", "/"),
      kite: path.relative(rootDir, kite.outputPath).replaceAll("\\", "/"),
    },
    cached_rows: {
      aya: "run extract-aya-cache.py after acquisition",
      dolly: dolly.rows,
      kullm_dolly: kullmDolly.rows,
      hrm8k: hrm8k.rows,
      haerae_bench_2: haeraeBench2.rows,
      k2_eval: k2Eval.rows,
      klue: klueRows?.length ?? 17554,
      kite: kite.rows,
    },
  };
  writeFileSync(path.join(cacheDir, "acquisition-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();

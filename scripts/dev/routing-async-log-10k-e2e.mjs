#!/usr/bin/env node

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const DEFAULTS = {
  gatewayBaseUrl: "http://localhost:8080",
  tenantId: "00000000-0000-4000-8000-000000000100",
  projectId: "00000000-0000-4000-8000-000000000200",
  apiKey: "glm_api_test_redacted",
  appToken: "glm_app_token_test_redacted",
  count: 10_000,
  concurrency: 64,
  reportDir: path.resolve(repoRoot, "..", "docs"),
  dockerPostgresContainer: "gatelm-postgres-1",
  postgresUser: "gatelm",
  postgresDatabase: "gatelm",
  flushWaitMs: 8_000,
  logPollTimeoutMs: 90_000,
  logPollIntervalMs: 1_000,
};

const CATEGORY_CONFIG = {
  code: {
    expectedTier: "high_quality",
    expectedReason: "category_code_high_quality",
    primary: [
      "Go handler에서 timeout이 날 때 retry 로직을 어떻게 고쳐야 할지",
      "PowerShell 스크립트가 특정 입력에서 깨질 때 원인을 추적하는 방법",
      "Redis key builder와 request log writer 사이의 race 조건을 점검하는 방법",
      "NestJS controller와 service 책임 경계를 다시 나누는 방법",
    ],
    distractors: [
      "결제 화면이라는 단어는 테스트 fixture 이름일 뿐 실제 환불 요청은 아니다",
      "영어 문구가 포함되어도 번역 요청이 아니라 코드 리뷰 맥락이다",
      "회의록 요약이 아니라 실패 로그 분석이 목적이다",
    ],
  },
  reasoning: {
    expectedTier: "high_quality",
    expectedReason: "category_reasoning_high_quality",
    primary: [
      "A안은 빠르고 B안은 안전할 때 어떤 선택이 덜 위험한지",
      "단기 비용과 장기 유지보수 중 무엇을 우선해야 하는지",
      "두 정책 변경안의 부작용을 비교해서 최종 추천안을 고르는 방법",
      "장애 복구 순서를 단계적으로 판단하고 근거를 정리하는 방법",
    ],
    distractors: [
      "코드라는 단어가 나오지만 구현 요청이 아니라 의사결정 요청이다",
      "요약도 필요하지만 핵심은 선택지 비교와 판단이다",
      "환불 사례가 예시로만 나오고 고객 응대 문구 작성은 아니다",
    ],
  },
  translation: {
    expectedTier: "balanced",
    expectedReason: "category_translation_balanced",
    primary: [
      "한국어 공지문을 해외 협력사가 오해하지 않게 자연스러운 영어 표현으로 바꾸는 일",
      "짧은 영문 릴리즈 노트를 제품 톤에 맞게 현지화하는 일",
      "직역처럼 보이지 않게 고객 안내 문장을 영어 톤으로 다듬는 일",
      "글로벌 릴리즈 문구를 외국 사용자가 이해하기 쉽게 바꾸는 일",
    ],
    distractors: [
      "번역 버튼 위치를 묻는 UI 질문이 아니라 실제 문장 변환 요청이다",
      "코드명과 요금제명이 있어도 개발 분석 요청은 아니다",
      "결제라는 단어는 안내문 내용에 포함된 소재일 뿐이다",
    ],
  },
  summarization: {
    expectedTier: "balanced",
    expectedReason: "category_summarization_balanced",
    primary: [
      "긴 회의록에서 중요한 결정만 남겨 한 화면 분량으로 정리하는 일",
      "장문의 장애 회고 문서를 바쁜 사람이 읽을 수 있게 핵심만 압축하는 일",
      "발표 전에 볼 수 있는 짧은 메모로 전체 맥락을 살려 정리하는 일",
      "여러 팀 의견을 결론 중심으로 줄이고 요지만 뽑는 일",
    ],
    distractors: [
      "코드 로그가 포함되어도 분석이나 수정 요청은 아니다",
      "JSON 필드로 나누는 구조화 요청이 아니라 요약 요청이다",
      "환불 문의가 예시로 있어도 고객 응대 작성은 아니다",
    ],
  },
  extraction_json: {
    expectedTier: "balanced",
    expectedReason: "category_extraction_json_balanced",
    primary: [
      "문장에서 필요한 정보를 찾아 필드와 값으로 나눠 JSON에 넣기 쉬운 형태로 만드는 일",
      "고객 요청을 key/value 형태로 분리해 시스템 입력값처럼 정리하는 일",
      "긴 안내문에서 입력 칸에 들어갈 값을 따로 뽑아 구조화하는 일",
      "계약 문구에서 속성/값을 분리해 기계가 읽기 쉬운 객체로 만드는 일",
    ],
    distractors: [
      "요약이라는 단어가 있어도 최종 목적은 필드 추출이다",
      "영문 텍스트가 있어도 번역보다 구조화가 우선이다",
      "결제 정보 예시가 있어도 환불 응대 요청은 아니다",
    ],
  },
  support_refund: {
    expectedTier: "low_cost",
    expectedReason: "category_support_refund_low_cost",
    primary: [
      "고객이 결제 금액이 이상하다고 해서 차분한 첫 응대 문구를 만드는 일",
      "구독을 멈추고 환불 가능 여부를 묻는 고객에게 안내하는 일",
      "구매 후 취소와 영수증 재발급을 문의한 고객에게 답변하는 일",
      "프로모션 환급이 안 됐다는 결제 관련 불만에 응대하는 일",
    ],
    distractors: [
      "정책 판단이 아니라 고객지원 답변 작성이다",
      "영어로 바꾸는 요청이 아니라 한국어 응대 문구가 목적이다",
      "로그라는 단어가 있어도 개발 로그 분석 요청은 아니다",
    ],
  },
  general: {
    expectedTier: "low_cost",
    expectedReason: "short_prompt_low_cost",
    primary: [
      "GateLM 사용 방법을 처음 보는 사람에게 짧게 안내하는 일",
      "관리 콘솔 메뉴 위치를 간단히 설명하는 일",
      "프로젝트 설정 화면에서 자주 묻는 질문을 쉬운 말로 답하는 일",
      "오늘 해야 할 확인 항목을 짧은 체크리스트로 만드는 일",
    ],
    distractors: [
      "번역이나 환불이라는 단어가 메뉴 이름으로만 등장한다",
      "코드 수정이나 복잡한 판단을 요구하지 않는다",
      "구조화된 JSON 결과를 요구하지 않는다",
    ],
  },
};

const ROUTING_REASON_TO_CATEGORY = {
  category_code_high_quality: "code",
  category_reasoning_high_quality: "reasoning",
  category_translation_balanced: "translation",
  category_summarization_balanced: "summarization",
  category_extraction_json_balanced: "extraction_json",
  category_support_refund_low_cost: "support_refund",
  short_prompt_low_cost: "general",
  default_balanced: "general",
  provider_health_fallback: "provider_health_fallback",
  pinned: "pinned",
};

const ROUTING_REASON_TO_TIER = {
  category_code_high_quality: "high_quality",
  category_reasoning_high_quality: "high_quality",
  category_translation_balanced: "balanced",
  category_summarization_balanced: "balanced",
  category_extraction_json_balanced: "balanced",
  category_support_refund_low_cost: "low_cost",
  short_prompt_low_cost: "low_cost",
  default_balanced: "balanced",
};

const options = parseArgs(process.argv.slice(2));

try {
  await main(options);
} catch (error) {
  console.error("");
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function main(opts) {
  if (opts.help) {
    printUsage();
    return;
  }

  validateOptions(opts);
  await assertHealth(opts.gatewayBaseUrl);

  const runId = `routing_async_10k_${timestampForId()}`;
  const requestPrefix = `request_${runId}_`;
  const startedAt = new Date();
  const metricBefore = await readAsyncLogMetrics(opts.gatewayBaseUrl);
  const samples = generateBlindSamples(opts.count, runId);

  console.log("");
  console.log("GateLM routing async log 10k E2E");
  console.log("=================================");
  console.log(`gateway:      ${opts.gatewayBaseUrl}`);
  console.log(`samples:      ${samples.length}`);
  console.log(`concurrency:  ${opts.concurrency}`);
  console.log(`requestPrefix:${requestPrefix}`);
  console.log("");

  const results = await runPool(samples, opts.concurrency, (sample) =>
    invokeGateway(opts, sample, requestPrefix),
  );
  const completedAt = new Date();
  await sleep(opts.flushWaitMs);
  const logSummary = await pollLogSummary(opts, requestPrefix, samples.length);
  const metricAfter = await readAsyncLogMetrics(opts.gatewayBaseUrl);
  const metricDelta = diffMetrics(metricBefore, metricAfter);

  const report = buildReport({
    opts,
    runId,
    requestPrefix,
    startedAt,
    completedAt,
    samples,
    results,
    logSummary,
    metricBefore,
    metricAfter,
    metricDelta,
  });

  await writeReports(opts.reportDir, report);
  printSummary(report);
}

function parseArgs(args) {
  const opts = {
    help: false,
    gatewayBaseUrl: envOrDefault("GATEWAY_BASE_URL", DEFAULTS.gatewayBaseUrl),
    tenantId: envOrDefault("GATELM_E2E_TENANT_ID", DEFAULTS.tenantId),
    projectId: envOrDefault("GATELM_E2E_PROJECT_ID", DEFAULTS.projectId),
    apiKey: envOrDefault("GATELM_DEMO_API_KEY", DEFAULTS.apiKey),
    appToken: envOrDefault("GATELM_DEMO_APP_TOKEN", DEFAULTS.appToken),
    count: positiveIntEnv("ROUTING_ASYNC_10K_COUNT", DEFAULTS.count),
    concurrency: positiveIntEnv("ROUTING_ASYNC_10K_CONCURRENCY", DEFAULTS.concurrency),
    reportDir: envOrDefault("ROUTING_ASYNC_10K_REPORT_DIR", DEFAULTS.reportDir),
    dockerPostgresContainer: envOrDefault(
      "ROUTING_ASYNC_10K_POSTGRES_CONTAINER",
      DEFAULTS.dockerPostgresContainer,
    ),
    postgresUser: envOrDefault("ROUTING_ASYNC_10K_POSTGRES_USER", DEFAULTS.postgresUser),
    postgresDatabase: envOrDefault(
      "ROUTING_ASYNC_10K_POSTGRES_DATABASE",
      DEFAULTS.postgresDatabase,
    ),
    flushWaitMs: positiveIntEnv("ROUTING_ASYNC_10K_FLUSH_WAIT_MS", DEFAULTS.flushWaitMs),
    logPollTimeoutMs: positiveIntEnv(
      "ROUTING_ASYNC_10K_LOG_POLL_TIMEOUT_MS",
      DEFAULTS.logPollTimeoutMs,
    ),
    logPollIntervalMs: positiveIntEnv(
      "ROUTING_ASYNC_10K_LOG_POLL_INTERVAL_MS",
      DEFAULTS.logPollIntervalMs,
    ),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    const value = () => {
      index += 1;
      if (index >= args.length || args[index].startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      return args[index];
    };

    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--gateway-base-url":
        opts.gatewayBaseUrl = value();
        break;
      case "--tenant-id":
        opts.tenantId = value();
        break;
      case "--project-id":
        opts.projectId = value();
        break;
      case "--api-key":
        opts.apiKey = value();
        break;
      case "--app-token":
        opts.appToken = value();
        break;
      case "--count":
        opts.count = positiveIntValue(value(), "--count");
        break;
      case "--concurrency":
        opts.concurrency = positiveIntValue(value(), "--concurrency");
        break;
      case "--report-dir":
        opts.reportDir = value();
        break;
      case "--docker-postgres-container":
        opts.dockerPostgresContainer = value();
        break;
      case "--flush-wait-ms":
        opts.flushWaitMs = positiveIntValue(value(), "--flush-wait-ms");
        break;
      case "--log-poll-timeout-ms":
        opts.logPollTimeoutMs = positiveIntValue(value(), "--log-poll-timeout-ms");
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  opts.gatewayBaseUrl = trimTrailingSlash(opts.gatewayBaseUrl);
  opts.reportDir = path.resolve(repoRoot, opts.reportDir);
  return opts;
}

function validateOptions(opts) {
  assertNonEmpty(opts.gatewayBaseUrl, "gateway base URL is required");
  assertNonEmpty(opts.tenantId, "tenant id is required");
  assertNonEmpty(opts.projectId, "project id is required");
  assertNonEmpty(opts.apiKey, "api key is required");
  assertNonEmpty(opts.appToken, "app token is required");
  assertNonEmpty(opts.dockerPostgresContainer, "docker postgres container is required");
  if (opts.count < 1) {
    throw new Error("count must be positive");
  }
  if (opts.concurrency < 1) {
    throw new Error("concurrency must be positive");
  }
}

async function assertHealth(gatewayBaseUrl) {
  const response = await fetch(joinUrl(gatewayBaseUrl, "/healthz"));
  if (!response.ok) {
    throw new Error(`/healthz failed with HTTP ${response.status}`);
  }
}

function generateBlindSamples(count, runId) {
  const categories = Object.keys(CATEGORY_CONFIG);
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    const category = categories[i % categories.length];
    const config = CATEGORY_CONFIG[category];
    const primary = config.primary[(Math.floor(i / categories.length) + i) % config.primary.length];
    const distractorA = config.distractors[(i * 3) % config.distractors.length];
    const otherCategory = categories[(i * 5 + 2) % categories.length];
    const other = CATEGORY_CONFIG[otherCategory].distractors[(i * 7) % CATEGORY_CONFIG[otherCategory].distractors.length];
    const style = [
      "운영자가 바로 이해할 수 있게 답해주세요.",
      "불필요한 장식 없이 핵심 판단만 포함해주세요.",
      "고객 데이터나 비밀값은 쓰지 않는 synthetic 상황입니다.",
      "마지막에 짧은 실행 순서도 포함해주세요.",
    ][i % 4];
    const prompt = [
      `주요 요청: ${primary}.`,
      `헷갈릴 수 있는 조건: ${distractorA}.`,
      `추가 배경: ${other}.`,
      `${style}`,
      `blind case ${runId}-${String(i + 1).padStart(5, "0")}.`,
    ].join(" ");
    samples.push({
      index: i,
      sampleId: `blind_${String(i + 1).padStart(5, "0")}`,
      expectedCategory: category,
      expectedTier: config.expectedTier,
      expectedReason: config.expectedReason,
      prompt,
      promptHash: sha256(prompt),
    });
  }
  return samples;
}

async function invokeGateway(opts, sample, requestPrefix) {
  const requestId = `${requestPrefix}${sample.sampleId}`;
  const body = {
    model: "auto",
    messages: [{ role: "user", content: sample.prompt }],
    temperature: 0.1,
    max_tokens: 96,
    stream: false,
  };
  const started = performance.now();
  let response;
  let bodyText = "";
  let parsed = null;
  let errorMessage = "";
  try {
    response = await fetch(joinUrl(opts.gatewayBaseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json; charset=utf-8",
        "x-gatelm-app-token": opts.appToken,
        "x-gatelm-request-id": requestId,
        "x-gatelm-end-user-id": "routing-async-log-e2e-user",
        "x-gatelm-feature-id": "routing-async-log-10k-e2e",
      },
      body: JSON.stringify(body),
    });
    bodyText = await response.text();
    if (bodyText.trim() !== "") {
      parsed = JSON.parse(bodyText);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const completed = performance.now();
  const gateLM = parsed?.gate_lm ?? {};
  const routingReason = String(gateLM.routingReason ?? "");
  const actualCategory = ROUTING_REASON_TO_CATEGORY[routingReason] ?? "unknown";
  const actualTier = ROUTING_REASON_TO_TIER[routingReason] ?? tierFromModel(String(gateLM.selectedModel ?? ""));
  return {
    sampleId: sample.sampleId,
    requestId,
    expectedCategory: sample.expectedCategory,
    actualCategory,
    expectedTier: sample.expectedTier,
    actualTier,
    expectedReason: sample.expectedReason,
    routingReason,
    httpStatus: response?.status ?? 0,
    ok: Boolean(response?.ok),
    durationMs: round(completed - started, 3),
    gatewayLatencyMs: Number.isFinite(Number(gateLM.latencyMs)) ? Number(gateLM.latencyMs) : null,
    selectedProvider: String(gateLM.selectedProvider ?? ""),
    selectedModel: String(gateLM.selectedModel ?? ""),
    cacheStatus: String(gateLM.cacheStatus ?? response?.headers.get("x-gatelm-cache-status") ?? ""),
    maskingAction: String(gateLM.maskingAction ?? response?.headers.get("x-gatelm-masking-action") ?? ""),
    promptHash: sample.promptHash,
    safeErrorCode: safeErrorCode(bodyText),
    errorMessage: errorMessage === "" ? "" : sanitizeError(errorMessage),
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  let completed = 0;
  const started = Date.now();
  async function runWorker(workerId) {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], workerId);
      completed += 1;
      if (completed % 1_000 === 0 || completed === items.length) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`progress: ${completed}/${items.length} elapsed=${elapsed}s`);
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) {
    workers.push(runWorker(i + 1));
  }
  await Promise.all(workers);
  return results;
}

async function pollLogSummary(opts, requestPrefix, expectedCount) {
  const startedAt = Date.now();
  let lastSummary = null;
  for (;;) {
    lastSummary = await readLogSummary(opts, requestPrefix);
    if (lastSummary.total >= expectedCount) {
      return {
        ...lastSummary,
        pollElapsedMs: Date.now() - startedAt,
        reachedExpectedCount: true,
      };
    }
    if (Date.now() - startedAt > opts.logPollTimeoutMs) {
      return {
        ...lastSummary,
        pollElapsedMs: Date.now() - startedAt,
        reachedExpectedCount: false,
      };
    }
    await sleep(opts.logPollIntervalMs);
  }
}

async function readLogSummary(opts, requestPrefix) {
  const escapedPrefix = requestPrefix.replaceAll("'", "''");
  const sql = `
with matched as (
  select *
  from p0_llm_invocation_logs
  where request_id like '${escapedPrefix}%'
),
status_counts as (
  select coalesce(json_object_agg(status, count), '{}'::json) as value
  from (select status, count(*)::int as count from matched group by status) s
),
model_counts as (
  select coalesce(json_object_agg(selected_model, count), '{}'::json) as value
  from (select coalesce(nullif(selected_model, ''), 'unknown') as selected_model, count(*)::int as count from matched group by 1) s
),
reason_counts as (
  select coalesce(json_object_agg(routing_reason, count), '{}'::json) as value
  from (select coalesce(nullif(routing_reason, ''), 'unknown') as routing_reason, count(*)::int as count from matched group by 1) s
)
select json_build_object(
  'total', (select count(*)::int from matched),
  'success', (select count(*)::int from matched where status = 'success'),
  'http200', (select count(*)::int from matched where http_status = 200),
  'selectedModelPresent', (select count(*)::int from matched where coalesce(selected_model, '') <> ''),
  'routingReasonPresent', (select count(*)::int from matched where coalesce(routing_reason, '') <> ''),
  'loggingWritten', (select count(*)::int from matched where metadata #>> '{domainOutcomes,logging,requestLogWritten}' = 'true'),
  'loggingOutcomeWritten', (select count(*)::int from matched where metadata #>> '{domainOutcomes,logging,outcome}' = 'written'),
  'avgLatencyMs', coalesce((select avg(latency_ms)::float from matched), 0),
  'p95LatencyMs', coalesce((select percentile_cont(0.95) within group (order by latency_ms)::float from matched), 0),
  'minCreatedAt', (select min(created_at) from matched),
  'maxCreatedAt', (select max(created_at) from matched),
  'statusCounts', (select value from status_counts),
  'selectedModelCounts', (select value from model_counts),
  'routingReasonCounts', (select value from reason_counts)
)::text;
`;
  const { stdout } = await execFileAsync("docker", [
    "exec",
    opts.dockerPostgresContainer,
    "psql",
    "-U",
    opts.postgresUser,
    "-d",
    opts.postgresDatabase,
    "-tA",
    "-c",
    sql,
  ]);
  return JSON.parse(stdout.trim());
}

async function readAsyncLogMetrics(gatewayBaseUrl) {
  const text = await fetchText(joinUrl(gatewayBaseUrl, "/metrics"));
  return {
    enqueueSuccess: sumMetric(text, "gatelm_async_log_enqueue_total", {
      operation: "terminal",
      status: "success",
    }),
    enqueueQueueFull: sumMetric(text, "gatelm_async_log_enqueue_total", {
      operation: "terminal",
      status: "queue_full",
    }),
    droppedQueueFull: sumMetric(text, "gatelm_async_log_dropped_total", {
      operation: "terminal",
      status: "queue_full",
    }),
    persistSuccess: sumMetric(text, "gatelm_async_log_persist_total", {
      operation: "terminal",
      status: "success",
    }),
    persistError: sumMetric(text, "gatelm_async_log_persist_total", {
      operation: "terminal",
      status: "error",
    }),
    queueDepth: latestGauge(text, "gatelm_async_log_queue_depth", {
      operation: "terminal",
    }),
    logWritesSuccess: sumMetric(text, "gatelm_log_writes_total", {
      status: "success",
    }),
  };
}

function buildReport(input) {
  const { opts, runId, requestPrefix, startedAt, completedAt, samples, results, logSummary, metricBefore, metricAfter, metricDelta } = input;
  const successfulResponses = results.filter((result) => result.ok);
  const categoryCorrect = results.filter((result) => result.expectedCategory === result.actualCategory).length;
  const tierCorrect = results.filter((result) => result.expectedTier === result.actualTier).length;
  const durations = results.map((result) => result.durationMs).filter((value) => Number.isFinite(value));
  const gatewayDurations = results
    .map((result) => result.gatewayLatencyMs)
    .filter((value) => Number.isFinite(value));
  const failures = results.filter(
    (result) =>
      !result.ok ||
      result.expectedCategory !== result.actualCategory ||
      result.expectedTier !== result.actualTier,
  );
  const assertions = [
    {
      name: "all_http_requests_succeeded",
      pass: successfulResponses.length === samples.length,
      expected: samples.length,
      actual: successfulResponses.length,
    },
    {
      name: "all_logs_persisted",
      pass: Number(logSummary.total) === samples.length,
      expected: samples.length,
      actual: Number(logSummary.total),
    },
    {
      name: "async_logging_not_dropped",
      pass: Number(metricDelta.droppedQueueFull) === 0 && Number(metricDelta.enqueueQueueFull) === 0,
      expected: 0,
      actual: {
        droppedQueueFull: metricDelta.droppedQueueFull,
        enqueueQueueFull: metricDelta.enqueueQueueFull,
      },
    },
    {
      name: "logged_rows_have_written_outcome",
      pass:
        Number(logSummary.loggingWritten) === samples.length &&
        Number(logSummary.loggingOutcomeWritten) === samples.length,
      expected: samples.length,
      actual: {
        requestLogWritten: Number(logSummary.loggingWritten),
        outcomeWritten: Number(logSummary.loggingOutcomeWritten),
      },
    },
  ];
  return {
    schemaVersion: "gatelm.routing-async-log-10k-e2e.v1",
    generatedAt: new Date().toISOString(),
    runId,
    requestPrefix,
    scope: {
      tenantId: opts.tenantId,
      projectId: opts.projectId,
      providerMode: "mock",
    },
    input: {
      sampleCount: samples.length,
      concurrency: opts.concurrency,
      flushWaitMs: opts.flushWaitMs,
      logPollTimeoutMs: opts.logPollTimeoutMs,
    },
    timing: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      wallClockMs: completedAt.getTime() - startedAt.getTime(),
      avgClientRequestMs: average(durations),
      p50ClientRequestMs: percentile(durations, 50),
      p95ClientRequestMs: percentile(durations, 95),
      maxClientRequestMs: Math.max(...durations),
      avgGatewayLatencyMs: average(gatewayDurations),
      p95GatewayLatencyMs: percentile(gatewayDurations, 95),
    },
    routing: {
      categoryAccuracy: round(categoryCorrect / samples.length, 6),
      categoryCorrect,
      categoryIncorrect: samples.length - categoryCorrect,
      tierAccuracy: round(tierCorrect / samples.length, 6),
      tierCorrect,
      tierIncorrect: samples.length - tierCorrect,
      expectedCategoryDistribution: distribution(samples, "expectedCategory"),
      actualCategoryDistribution: distribution(results, "actualCategory"),
      expectedTierDistribution: distribution(samples, "expectedTier"),
      actualTierDistribution: distribution(results, "actualTier"),
      routingReasonDistribution: distribution(results, "routingReason"),
      selectedModelDistribution: distribution(results, "selectedModel"),
      firstFailures: failures.slice(0, 30).map((failure) => ({
        sampleId: failure.sampleId,
        requestId: failure.requestId,
        expectedCategory: failure.expectedCategory,
        actualCategory: failure.actualCategory,
        expectedTier: failure.expectedTier,
        actualTier: failure.actualTier,
        routingReason: failure.routingReason,
        selectedModel: failure.selectedModel,
        httpStatus: failure.httpStatus,
        safeErrorCode: failure.safeErrorCode,
        promptHash: failure.promptHash,
      })),
    },
    asyncLogging: {
      logSummary,
      metricBefore,
      metricAfter,
      metricDelta,
    },
    assertions,
    securityNote:
      "Report does not store Authorization header, API key, app token, provider key, raw response body, or provider raw error. Prompts are synthetic; report stores prompt hashes and failed sample metadata only.",
  };
}

async function writeReports(reportDir, report) {
  await fs.mkdir(reportDir, { recursive: true });
  const baseName = `routing_async_log_10k_e2e_${report.runId}`;
  const jsonPath = path.join(reportDir, `${baseName}.json`);
  const mdPath = path.join(reportDir, `${baseName}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, markdownReport(report, jsonPath), "utf8");
  const latestJson = path.join(reportDir, "routing_async_log_10k_e2e_latest.json");
  const latestMd = path.join(reportDir, "routing_async_log_10k_e2e_latest.md");
  await fs.writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(latestMd, markdownReport(report, latestJson), "utf8");
  report.reportPaths = { jsonPath, mdPath, latestJson, latestMd };
}

function markdownReport(report, jsonPath) {
  const assertionRows = report.assertions
    .map((item) => `| ${item.name} | ${item.pass ? "PASS" : "FAIL"} | ${JSON.stringify(item.actual)} |`)
    .join("\n");
  const categoryRows = Object.entries(report.routing.actualCategoryDistribution)
    .map(([category, count]) => `| ${category} | ${count} |`)
    .join("\n");
  const reasonRows = Object.entries(report.routing.routingReasonDistribution)
    .map(([reason, count]) => `| ${reason || "unknown"} | ${count} |`)
    .join("\n");
  return `# GateLM Routing Async Log 10,000 E2E Report

작성일: ${report.generatedAt}

## 조건

| 항목 | 값 |
|---|---:|
| 샘플 수 | ${report.input.sampleCount} |
| 동시성 | ${report.input.concurrency} |
| Provider | ${report.scope.providerMode} |
| requestId prefix | \`${report.requestPrefix}\` |

## 핵심 결과

| 항목 | 결과 |
|---|---:|
| HTTP 성공 수 | ${report.assertions.find((item) => item.name === "all_http_requests_succeeded").actual} |
| DB 로그 저장 수 | ${report.asyncLogging.logSummary.total} |
| 라우팅 Category 정확도 | ${(report.routing.categoryAccuracy * 100).toFixed(2)}% |
| 라우팅 Tier 정확도 | ${(report.routing.tierAccuracy * 100).toFixed(2)}% |
| 평균 요청 처리 시간(client) | ${report.timing.avgClientRequestMs}ms |
| P95 요청 처리 시간(client) | ${report.timing.p95ClientRequestMs}ms |
| 평균 Gateway latency | ${report.timing.avgGatewayLatencyMs}ms |
| P95 Gateway latency | ${report.timing.p95GatewayLatencyMs}ms |
| async queue full 증가 | ${report.asyncLogging.metricDelta.enqueueQueueFull} |
| async dropped 증가 | ${report.asyncLogging.metricDelta.droppedQueueFull} |
| async persist success 증가 | ${report.asyncLogging.metricDelta.persistSuccess} |

## 검증 판정

| 검증 | 판정 | 실제값 |
|---|---|---|
${assertionRows}

## 실제 Category 분포

| Category | 요청 수 |
|---|---:|
${categoryRows}

## Routing Reason 분포

| Routing Reason | 요청 수 |
|---|---:|
${reasonRows}

## 로그 검증

| 항목 | 값 |
|---|---:|
| DB log total | ${report.asyncLogging.logSummary.total} |
| DB success | ${report.asyncLogging.logSummary.success} |
| DB http 200 | ${report.asyncLogging.logSummary.http200} |
| selectedModel present | ${report.asyncLogging.logSummary.selectedModelPresent} |
| routingReason present | ${report.asyncLogging.logSummary.routingReasonPresent} |
| requestLogWritten=true | ${report.asyncLogging.logSummary.loggingWritten} |
| logging.outcome=written | ${report.asyncLogging.logSummary.loggingOutcomeWritten} |
| log poll elapsed | ${report.asyncLogging.logSummary.pollElapsedMs}ms |

## 원본 JSON

\`${jsonPath}\`

## 주의

이 테스트셋은 synthetic blind prompt다. 실제 운영 정확도는 별도 사람이 라벨링한 업무형 prompt로 다시 검증해야 한다.
`;
}

function printSummary(report) {
  console.log("");
  console.log("RESULT");
  console.log("======");
  console.log(`category accuracy: ${(report.routing.categoryAccuracy * 100).toFixed(2)}%`);
  console.log(`tier accuracy:     ${(report.routing.tierAccuracy * 100).toFixed(2)}%`);
  console.log(`db logs:           ${report.asyncLogging.logSummary.total}/${report.input.sampleCount}`);
  console.log(`avg client ms:     ${report.timing.avgClientRequestMs}`);
  console.log(`p95 client ms:     ${report.timing.p95ClientRequestMs}`);
  console.log(`async dropped:     ${report.asyncLogging.metricDelta.droppedQueueFull}`);
  console.log(`report md:         ${report.reportPaths.mdPath}`);
  console.log(`report json:       ${report.reportPaths.jsonPath}`);
  const failed = report.assertions.filter((item) => !item.pass);
  if (failed.length > 0) {
    throw new Error(`assertions failed: ${failed.map((item) => item.name).join(", ")}`);
  }
}

function diffMetrics(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff = {};
  for (const key of keys) {
    diff[key] = round(Number(after[key] ?? 0) - Number(before[key] ?? 0), 6);
  }
  return diff;
}

function sumMetric(metricsText, metricName, labels) {
  let total = 0;
  for (const rawLine of metricsText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const parsed = parseMetricLine(line);
    if (!parsed || parsed.name !== metricName) {
      continue;
    }
    if (labelsMatch(parsed.labels, labels)) {
      total += parsed.value;
    }
  }
  return total;
}

function latestGauge(metricsText, metricName, labels) {
  let value = 0;
  for (const rawLine of metricsText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const parsed = parseMetricLine(line);
    if (!parsed || parsed.name !== metricName) {
      continue;
    }
    if (labelsMatch(parsed.labels, labels)) {
      value = parsed.value;
    }
  }
  return value;
}

function parseMetricLine(line) {
  const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);
  if (!match) {
    return null;
  }
  return {
    name: match[1],
    labels: parseLabels(match[2] ?? ""),
    value: Number(match[3]),
  };
}

function parseLabels(raw) {
  const labels = {};
  for (const part of raw.split(",")) {
    if (part.trim() === "") {
      continue;
    }
    const index = part.indexOf("=");
    if (index < 0) {
      continue;
    }
    labels[part.slice(0, index).trim()] = part.slice(index + 1).trim().replace(/^"|"$/g, "");
  }
  return labels;
}

function labelsMatch(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

function tierFromModel(model) {
  if (model.includes("smart") || model.includes("high")) {
    return "high_quality";
  }
  if (model.includes("fast") || model.includes("low")) {
    return "low_cost";
  }
  if (model.trim() !== "") {
    return "balanced";
  }
  return "unknown";
}

function distribution(items, key) {
  const counts = {};
  for (const item of items) {
    const value = String(item[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 3);
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round(sorted[index], 3);
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function safeErrorCode(bodyText) {
  if (!bodyText || bodyText.trim() === "") {
    return "";
  }
  try {
    const json = JSON.parse(bodyText);
    return String(json?.error?.code ?? json?.code ?? "");
  } catch {
    return "non_json_response";
  }
}

function sanitizeError(value) {
  return String(value).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 240);
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function timestampForId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function envOrDefault(key, fallback) {
  const value = process.env[key];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function positiveIntEnv(key, fallback) {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    return fallback;
  }
  return positiveIntValue(value, key);
}

function positiveIntValue(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function assertNonEmpty(value, message) {
  if (!value || String(value).trim() === "") {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage() {
  console.log(`Usage:
  node scripts/dev/routing-async-log-10k-e2e.mjs [options]

Options:
  --gateway-base-url <url>       Gateway base URL. Default: ${DEFAULTS.gatewayBaseUrl}
  --count <n>                    Number of synthetic blind samples. Default: ${DEFAULTS.count}
  --concurrency <n>              Parallel request count. Default: ${DEFAULTS.concurrency}
  --report-dir <path>            Report directory. Default: ../docs
  --flush-wait-ms <n>            Wait before log polling. Default: ${DEFAULTS.flushWaitMs}
  --log-poll-timeout-ms <n>      Max wait for async logs. Default: ${DEFAULTS.logPollTimeoutMs}
`);
}

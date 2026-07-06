#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportDir = path.resolve(repoRoot, "..", "docs");
const reportJsonPath = path.join(reportDir, "보고서3.json");
const reportMdPath = path.join(reportDir, "보고서3.md");
const gatewayPort = process.env.GATEWAY_LONG_PROMPT_100_PORT || "18082";
const gatewayBaseUrl = process.env.GATEWAY_BASE_URL || `http://localhost:${gatewayPort}`;
const mockProviderBaseUrl = process.env.MOCK_PROVIDER_BASE_URL || "http://localhost:8090";
const apiKey = process.env.GATELM_DEMO_API_KEY || "glm_api_test_redacted";
const appToken = process.env.GATELM_DEMO_APP_TOKEN || "glm_app_token_test_redacted";
const concurrency = Number(process.env.GATEWAY_LONG_PROMPT_100_CONCURRENCY || "1");
const requestTimeoutMs = Number(process.env.GATEWAY_LONG_PROMPT_100_TIMEOUT_MS || "20000");
const logPollTimeoutMs = Number(process.env.GATEWAY_LONG_PROMPT_100_LOG_POLL_TIMEOUT_MS || "90000");
const logPollIntervalMs = 1000;

const reasonToCategory = {
  category_code_high_quality: "code",
  category_reasoning_high_quality: "reasoning",
  category_translation_balanced: "translation",
  category_summarization_balanced: "summarization",
  category_extraction_json_balanced: "extraction_json",
  category_support_refund_low_cost: "support_refund",
  short_prompt_low_cost: "general",
  default_balanced: "general",
};
const modelToTier = { "mock-fast": "low_cost", "mock-balanced": "balanced", "mock-smart": "high_quality" };
const categoryMeta = {
  code: { tier: "high_quality", model: "mock-smart" },
  reasoning: { tier: "high_quality", model: "mock-smart" },
  translation: { tier: "balanced", model: "mock-balanced" },
  summarization: { tier: "balanced", model: "mock-balanced" },
  extraction_json: { tier: "balanced", model: "mock-balanced" },
  support_refund: { tier: "low_cost", model: "mock-fast" },
  general: { tier: "balanced", model: "mock-balanced" },
};

try {
  await main();
} catch (err) {
  console.error(`FAIL: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exitCode = 1;
}

async function main() {
  const runId = `long_prompt_100_${ts()}`;
  const prefix = `request_${runId}_`;
  await fs.mkdir(reportDir, { recursive: true });
  await fs.mkdir(path.join(repoRoot, ".tmp", "gateway-routing-long-100"), { recursive: true });
  const samples = buildSamples(runId);

  console.log("GateLM long prompt routing evidence");
  console.log(`runId=${runId}`);
  console.log(`samples=${samples.length}`);
  console.log(`concurrency=${concurrency}`);
  await bootstrap();
  await resetRedis();
  const gateway = await startGateway();
  const startedAt = new Date();
  let results = [];
  try {
    results = await pool(samples, concurrency, (sample) => invoke(sample, prefix));
  } finally {
    await stopGateway(gateway);
  }
  await sleep(2500);
  const logs = await pollLogs(prefix, samples.length);
  const completedAt = new Date();
  const report = buildReport({ runId, prefix, samples, results, logs, startedAt, completedAt });
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdPath, markdown(report), "utf8");
  printSummary(report);
}

async function bootstrap() {
  await execFileAsync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "dev", "v2-p0-bootstrap-check.ps1")], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public", REDIS_URL: "redis://localhost:6379" },
    maxBuffer: 30 * 1024 * 1024,
  });
}

async function resetRedis() {
  await execFileAsync("docker", ["compose", "exec", "-T", "redis", "redis-cli", "FLUSHDB"], { cwd: repoRoot });
}

async function startGateway() {
  const go = await resolveGo();
  const logDir = path.join(repoRoot, ".tmp", "gateway-routing-long-100");
  const out = await fs.open(path.join(logDir, "gateway.out.log"), "w");
  const err = await fs.open(path.join(logDir, "gateway.err.log"), "w");
  const envs = {
    ...process.env,
    DATABASE_URL: "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public",
    REDIS_URL: "redis://localhost:6379",
    GATEWAY_PORT: gatewayPort,
    GATEWAY_RUNTIME_SNAPSHOT_MODE: "demo",
    GATEWAY_CONTROL_PLANE_BASE_URL: "",
    GATEWAY_AUTH_SOURCE: "demo",
    MOCK_PROVIDER_BASE_URL: mockProviderBaseUrl,
    GATEWAY_DEFAULT_PROVIDER: "mock",
    GATEWAY_DEFAULT_MODEL: "mock-balanced",
    GATEWAY_LOW_COST_MODEL: "mock-fast",
    GATEWAY_HIGH_QUALITY_MODEL: "mock-smart",
    GATEWAY_RATE_LIMIT_LIMIT: "200000",
    GATEWAY_ASYNC_LOG_ENABLED: "true",
    GATEWAY_ASYNC_LOG_QUEUE_SIZE: "8192",
    GATEWAY_ASYNC_LOG_WORKER_COUNT: "4",
    GATEWAY_PROMPT_CAPTURE_ENABLED: "true",
    GATEWAY_RESPONSE_CAPTURE_ENABLED: "true",
    SEMANTIC_CACHE_ENABLED: "false",
    GATEWAY_ROUTING_RULE_STRESS_TOTAL: "0",
  };
  const child = spawn(go, ["run", "./apps/gateway-core/cmd/gateway"], { cwd: repoRoot, env: envs, stdio: ["ignore", out.fd, err.fd], windowsHide: true });
  child.once("exit", () => { out.close().catch(() => {}); err.close().catch(() => {}); });
  await waitHealth(child, path.join(logDir, "gateway.err.log"));
  return child;
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      return;
    } catch {
      // Fall through to the normal signal path if taskkill is unavailable.
    }
  }
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(7000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })]);
}
async function waitHealth(child, errPath) {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    if (child.exitCode !== null) throw new Error(`gateway exited early: ${(await fs.readFile(errPath, "utf8").catch(() => "")).slice(-2000)}`);
    try {
      const res = await fetch(`${gatewayBaseUrl}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("gateway healthz timeout");
}

async function resolveGo() {
  const bundled = path.resolve(repoRoot, "..", ".tools", "go1.24.13", "go", "bin", "go.exe");
  try { await fs.access(bundled); return bundled; } catch { return "go"; }
}

function buildSamples(runId) {
  const categories = ["code", "reasoning", "translation", "summarization", "extraction_json", "support_refund", "general"];
  return Array.from({ length: 100 }, (_, i) => {
    const category = categories[i % categories.length];
    const prompt = makeLongPrompt(category, i);
    const meta = categoryMeta[category];
    return {
      sampleId: `long_${String(i + 1).padStart(3, "0")}`,
      runId,
      expectedCategory: category,
      expectedTier: meta.tier,
      expectedModel: meta.model,
      containsSensitiveSynthetic: i % 5 === 0,
      prompt,
      promptBytes: Buffer.byteLength(prompt, "utf8"),
      promptRunes: [...prompt].length,
      expectedPurposePositionBytes: Buffer.byteLength(prompt.slice(0, prompt.indexOf("마지막 요청")), "utf8"),
      promptHash: `sha256:${crypto.createHash("sha256").update(prompt).digest("hex")}`,
    };
  });
}

function makeLongPrompt(category, index) {
  const sensitive = index % 5 === 0 ? ` 참고용 연락처는 test-user-${index}@example.invalid, 010-1234-${String(index).padStart(4, "0")}이며 실제 개인정보가 아닌 synthetic 값이다.` : "";
  const backgroundParts = [
    `다음 내용은 여러 팀이 남긴 회의 메모와 운영 이슈를 한꺼번에 붙여둔 것이다. 초반부에는 내가 원하는 최종 작업을 일부러 쓰지 않는다.${sensitive}`,
    `GateLM 운영팀은 비용 절감, 장애 대응, 로그 일관성, 정책 배포 안정성, 고객사별 사용량 분리, 요청 상세 화면의 설명 가능성을 동시에 고려하고 있다. 최근에는 라우팅, 캐시, 안전성 검사, provider fallback, 비동기 로깅이 서로 어떤 순서로 이어져야 하는지 논의했다.`,
    `문서에는 서로 다른 의견이 섞여 있다. 어떤 사람은 모든 요청을 저렴한 모델로 보내자고 했고, 다른 사람은 품질 하락을 우려했다. 또 어떤 사람은 캐시를 먼저 봐야 한다고 했지만, 다른 사람은 모델 선택 후 cache key가 안정된다고 주장했다.`,
    `아래에는 실제 사용자 요청처럼 배경 설명이 길게 이어진다. 초반 문단만 보면 단순한 운영 상담처럼 보일 수 있고, 중간에는 정책, 대시보드, 장애, 예산, 팀 협업 이야기가 섞인다. 이 때문에 라우팅은 앞부분의 단서만 보고 성급하게 판단하면 틀릴 수 있다.`,
    `현재 시스템은 raw prompt를 저장하지 않는 방향을 기본으로 하고, 필요할 때도 opt-in과 redaction을 전제로 한다. provider key, authorization header, app token, raw response 같은 값은 문서나 fixture에 남기면 안 된다. 이 문단은 보안 규칙 설명일 뿐 최종 요청은 아니다.`,
    `고객사는 주로 비용을 줄이고 싶어하지만, 개발자는 디버깅 가능한 로그와 재현 가능한 테스트를 원한다. 관리자는 정책을 화면에서 바꾸고 배포하고 롤백할 수 있어야 하며, Gateway는 publish된 RuntimeSnapshot만 신뢰해야 한다.`,
    `이제부터 나오는 마지막 요청만 실제 의도다. 앞의 배경은 혼선을 주기 위한 컨텍스트이며, 라우팅은 이 뒷부분까지 읽고 적절한 카테고리와 모델 tier를 골라야 한다.`,
  ];
  const middle = repeatNoise(index);
  return `${backgroundParts.join("\n\n")}\n\n${middle}\n\n${purposeFor(category, index)}`;
}

function repeatNoise(index) {
  const blocks = [
    "운영자는 대시보드의 수치가 신뢰 가능한지 확인하고 싶어한다. 로그에는 requestId, runtimeSnapshot, routing outcome, cache outcome, budget outcome, provider outcome이 일관되게 남아야 한다.",
    "개발자는 이 요청이 어느 provider/model을 탔는지, cache hit인지 miss인지, fallback이 있었는지, rate limit 또는 budget guard가 개입했는지 알고 싶어한다.",
    "발표자는 데모 중에 안전한 샘플만 사용하고, 실제 secret이나 고객 데이터를 보여주지 않으려 한다. 테스트 데이터는 synthetic이어야 하며 재현 가능해야 한다.",
    "고객사는 사내 프록시를 쓰거나 SDK endpoint를 Gateway로 바꿀 수 있지만, 웹에서 직접 쓰는 외부 챗봇까지 모두 통제할 수는 없다.",
  ];
  const count = 5 + (index % 4);
  return Array.from({ length: count }, (_, i) => blocks[(index + i) % blocks.length]).join("\n");
}

function purposeFor(category, index) {
  switch (category) {
    case "code":
      return `마지막 요청: 위 내용을 참고해서 Go Gateway의 라우팅 stage에서 생길 수 있는 race condition과 nil pointer 가능성을 찾고, 수정해야 할 코드 흐름을 제안해줘. 가능하면 함수 단위로 설명해줘. case=${index}`;
    case "reasoning":
      return `마지막 요청: 지금 선택지는 A안 저비용 우선, B안 품질 우선, C안 카테고리별 혼합 라우팅이다. 세 선택지를 비용, 지연시간, 정확도, 운영 위험 기준으로 비교하고 결론을 내려줘. case=${index}`;
    case "translation":
      return `마지막 요청: 아래 운영 공지를 해외 고객사에게 보낼 수 있게 자연스러운 영어 비즈니스 문장으로 번역해줘. 의미는 유지하되 너무 직역하지 말아줘. case=${index}`;
    case "summarization":
      return `마지막 요청: 위 회의 내용을 결정사항, 남은 이슈, 다음 액션 아이템으로 나누어 짧게 요약해줘. 중복 문장은 합쳐줘. case=${index}`;
    case "extraction_json":
      return `마지막 요청: 위 내용에서 tenantId, projectId, applicationId, providerName, selectedModel, cacheStatus, routingReason 후보를 찾아 JSON 객체로만 추출해줘. 값이 없으면 null로 둬. case=${index}`;
    case "support_refund":
      return `마지막 요청: 구독 취소와 환불 가능 여부를 묻는 고객에게 보낼 답변을 작성해줘. 과도한 약속은 하지 말고, 확인 절차와 예상 소요 시간을 안내해줘. case=${index}`;
    default:
      return `마지막 요청: GateLM Gateway가 무엇이고 왜 필요한지 처음 보는 비개발자에게 쉽게 설명해줘. 비유를 하나만 사용하고 너무 길게 쓰지 말아줘. case=${index}`;
  }
}
async function invoke(sample, prefix) {
  const requestId = `${prefix}${sample.sampleId}`;
  const started = performance.now();
  let httpStatus = 0;
  let parsed = null;
  let error = "";
  try {
    const res = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${apiKey}`,
        "x-gatelm-app-token": appToken,
        "x-gatelm-end-user-id": "long-prompt-routing-user",
        "x-gatelm-feature-id": "long-prompt-routing-evidence",
        "x-gatelm-request-id": requestId,
      },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: sample.prompt }], temperature: 0, max_tokens: 80, stream: false }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    httpStatus = res.status;
    const body = await res.text();
    parsed = safeJSON(body);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const gateLM = parsed?.gateLM ?? parsed?.gatelm ?? {};
  return {
    sampleId: sample.sampleId,
    requestId,
    httpStatus,
    clientDurationMs: round(performance.now() - started, 6),
    selectedModel: String(gateLM.selectedModel ?? parsed?.model ?? ""),
    routingReason: String(gateLM.routingReason ?? ""),
    cacheStatus: String(gateLM.cacheStatus ?? ""),
    error,
  };
}

async function pool(items, n, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
      if ((i + 1) % 10 === 0 || i === items.length - 1) console.log(`  progress ${i + 1}/${items.length}`);
    }
  }));
  return results;
}

async function pollLogs(prefix, expected) {
  const start = Date.now();
  let latest = [];
  while (Date.now() - start < logPollTimeoutMs) {
    latest = await queryLogs(prefix);
    if (latest.length >= expected) return latest;
    await sleep(logPollIntervalMs);
  }
  return latest;
}

async function queryLogs(prefix) {
  const escapedPrefix = prefix.replace(/'/g, "''");
  const sql = `select coalesce(json_agg(row_to_json(t) order by "requestId"), '[]'::json) from (select request_id as "requestId", status, http_status as "httpStatus", provider, model, selected_model as "selectedModel", routing_reason as "routingReason", cache_status as "cacheStatus", cache_type as "cacheType", masking_action as "maskingAction", masking_detected_types as "maskingDetectedTypes", redacted_prompt_preview as "redactedPromptPreview", latency_ms as "latencyMs", provider_latency_ms as "providerLatencyMs", metadata from p0_llm_invocation_logs where request_id like '${escapedPrefix}%' order by request_id) t;`;
  const { stdout } = await execFileAsync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "gatelm", "-d", "gatelm", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { cwd: repoRoot, maxBuffer: 80 * 1024 * 1024 });
  return JSON.parse(stdout.trim() || "[]");
}

function buildReport({ runId, prefix, samples, results, logs, startedAt, completedAt }) {
  const resultById = new Map(results.map((x) => [x.sampleId, x]));
  const logByRequestId = new Map(logs.map((x) => [x.requestId, x]));
  const enriched = samples.map((sample) => enrich(sample, resultById.get(sample.sampleId), logByRequestId.get(`${prefix}${sample.sampleId}`)));
  return {
    schemaVersion: "gatelm.long-prompt-routing-evidence.v1",
    generatedAt: completedAt.toISOString(),
    runId,
    requestPrefix: prefix,
    input: {
      count: samples.length,
      concurrency,
      provider: "mock",
      semanticCacheEnabled: false,
      note: "Long, ambiguous prompts with purpose stated near the end. Mock provider is used to avoid OpenAI cost.",
    },
    timing: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      wallClockMs: completedAt - startedAt,
      client: timing(enriched),
    },
    routing: routing(enriched),
    stageTimings: stageStats(enriched),
    logs: { expected: samples.length, actual: logs.length, coverage: ratio(logs.length, samples.length), httpStatusCounts: dist(enriched, (x) => String(x.httpStatus || 0)) },
    promptShape: promptShape(enriched),
    samples: enriched.map(publicSample),
  };
}

function enrich(sample, result, log) {
  const metadata = parseMetadata(log?.metadata);
  const selectedModel = first(log?.selectedModel, result?.selectedModel, log?.model);
  const routingReason = first(log?.routingReason, result?.routingReason);
  const actualCategory = first(metadata.promptCategory, reasonToCategory[routingReason], "unknown");
  const actualTier = first(modelToTier[selectedModel], tierFromReason(routingReason), "unknown");
  const stageTimings = normalizeStageTimings(metadata.stageTimings);
  return {
    ...sample,
    requestId: result?.requestId || log?.requestId || "",
    httpStatus: Number(result?.httpStatus || log?.httpStatus || 0),
    clientDurationMs: Number(result?.clientDurationMs || 0),
    logWritten: Boolean(log),
    status: log?.status || "",
    selectedModel,
    routingReason,
    actualCategory,
    actualTier,
    categoryCorrect: actualCategory === sample.expectedCategory,
    tierCorrect: actualTier === sample.expectedTier,
    modelCorrect: selectedModel === sample.expectedModel,
    cacheStatus: first(log?.cacheStatus, result?.cacheStatus),
    cacheType: log?.cacheType || "",
    maskingAction: log?.maskingAction || "",
    latencyMs: Number(log?.latencyMs || 0),
    providerLatencyMs: Number(log?.providerLatencyMs || 0),
    gatewayWithoutProviderMs: Math.max(0, Number(log?.latencyMs || 0) - Number(log?.providerLatencyMs || 0)),
    stageTimings,
  };
}

function routing(items) {
  const total = items.length;
  return {
    total,
    categoryAccuracy: ratio(items.filter((x) => x.categoryCorrect).length, total),
    tierAccuracy: ratio(items.filter((x) => x.tierCorrect).length, total),
    modelAccuracy: ratio(items.filter((x) => x.modelCorrect).length, total),
    expectedCategoryDistribution: dist(items, (x) => x.expectedCategory),
    actualCategoryDistribution: dist(items, (x) => x.actualCategory),
    expectedTierDistribution: dist(items, (x) => x.expectedTier),
    actualTierDistribution: dist(items, (x) => x.actualTier),
    routingReasonDistribution: dist(items, (x) => x.routingReason || "unknown"),
    perCategory: Object.fromEntries(Object.keys(categoryMeta).map((category) => {
      const xs = items.filter((x) => x.expectedCategory === category);
      return [category, { total: xs.length, categoryAccuracy: ratio(xs.filter((x) => x.categoryCorrect).length, xs.length), tierAccuracy: ratio(xs.filter((x) => x.tierCorrect).length, xs.length), actualDistribution: dist(xs, (x) => x.actualCategory) }];
    })),
    failures: items.filter((x) => !x.categoryCorrect || !x.tierCorrect).map((x) => ({ sampleId: x.sampleId, expectedCategory: x.expectedCategory, actualCategory: x.actualCategory, expectedTier: x.expectedTier, actualTier: x.actualTier, selectedModel: x.selectedModel, routingReason: x.routingReason, promptBytes: x.promptBytes, expectedPurposePositionBytes: x.expectedPurposePositionBytes, requestId: x.requestId })),
  };
}

function timing(items) {
  return {
    avgClientMs: avg(items.map((x) => x.clientDurationMs)),
    p50ClientMs: pctile(items.map((x) => x.clientDurationMs), 50),
    p95ClientMs: pctile(items.map((x) => x.clientDurationMs), 95),
    maxClientMs: max(items.map((x) => x.clientDurationMs)),
    avgGatewayLatencyMs: avg(items.map((x) => x.latencyMs)),
    p50GatewayLatencyMs: pctile(items.map((x) => x.latencyMs), 50),
    p95GatewayLatencyMs: pctile(items.map((x) => x.latencyMs), 95),
    avgProviderLatencyMs: avg(items.map((x) => x.providerLatencyMs).filter((x) => x > 0)),
    p95ProviderLatencyMs: pctile(items.map((x) => x.providerLatencyMs).filter((x) => x > 0), 95),
    avgGatewayWithoutProviderMs: avg(items.map((x) => x.gatewayWithoutProviderMs)),
    p95GatewayWithoutProviderMs: pctile(items.map((x) => x.gatewayWithoutProviderMs), 95),
  };
}

function stageStats(items) {
  const byStage = {};
  for (const item of items) {
    for (const [stage, value] of Object.entries(item.stageTimings || {})) {
      (byStage[stage] ??= []).push(Number(value.durationMs || 0));
    }
  }
  return Object.fromEntries(Object.entries(byStage).sort(([a], [b]) => a.localeCompare(b)).map(([stage, values]) => [stage, {
    requests: values.length,
    avgMs: round(avg(values), 6),
    p50Ms: round(pctile(values, 50), 6),
    p95Ms: round(pctile(values, 95), 6),
    maxMs: round(max(values), 6),
    avgMicros: round(avg(values) * 1000, 3),
    p95Micros: round(pctile(values, 95) * 1000, 3),
  }]));
}

function promptShape(items) {
  return {
    avgPromptBytes: round(avg(items.map((x) => x.promptBytes)), 3),
    p50PromptBytes: round(pctile(items.map((x) => x.promptBytes), 50), 3),
    p95PromptBytes: round(pctile(items.map((x) => x.promptBytes), 95), 3),
    maxPromptBytes: max(items.map((x) => x.promptBytes)),
    avgPurposePositionBytes: round(avg(items.map((x) => x.expectedPurposePositionBytes)), 3),
    over2048PurposeCount: items.filter((x) => x.expectedPurposePositionBytes > 2048).length,
    syntheticSensitiveCount: items.filter((x) => x.containsSensitiveSynthetic).length,
  };
}

function markdown(r) {
  const stageRows = Object.entries(r.stageTimings).map(([stage, v]) => `| \`${stage}\` | ${v.requests} | ${fmt(v.avgMs)}ms | ${fmt(v.p50Ms)}ms | ${fmt(v.p95Ms)}ms | ${fmt(v.maxMs)}ms | ${fmt(v.avgMicros)}μs | ${fmt(v.p95Micros)}μs |`).join("\n");
  const categoryRows = Object.entries(r.routing.perCategory).map(([category, v]) => `| ${category} | ${v.total} | ${percent(v.categoryAccuracy)} | ${percent(v.tierAccuracy)} | ${JSON.stringify(v.actualDistribution)} |`).join("\n");
  const failureRows = r.routing.failures.slice(0, 30).map((x) => `| ${x.sampleId} | ${x.expectedCategory} | ${x.actualCategory} | ${x.expectedTier} | ${x.actualTier} | ${x.promptBytes} | ${x.expectedPurposePositionBytes} | ${x.routingReason} |`).join("\n") || "| - | - | - | - | - | - | - | - |";
  return `# GateLM 긴 프롬프트 100건 라우팅/지연시간 테스트 보고서 3

작성 시각: ${r.generatedAt}  
원본 JSON: \`${reportJsonPath}\`  
runId: \`${r.runId}\`

## 1. 테스트 목적

실제 서비스에서 사용자가 항상 첫 문장에 목적을 명확히 쓰지는 않는다는 가정으로 테스트했다. 그래서 100개의 프롬프트를 모두 길고 복잡하게 만들고, 최종 목적은 뒤쪽의 \`마지막 요청\` 부분에 배치했다.

이번 테스트는 OpenAI 비용을 피하기 위해 mock provider를 사용했다. 따라서 실제 LLM 응답 생성 시간은 측정 대상이 아니고, Gateway 내부 단계별 처리 시간과 라우팅 판단 정확도를 확인하는 목적이다.

## 2. 테스트 조건

| 항목 | 값 |
|---|---:|
| 요청 수 | ${r.input.count} |
| 동시성 | ${concurrency} |
| Provider | mock provider |
| Semantic cache model/embedding | 꺼짐 |
| PII masking | 현재 Gateway의 로컬 정규식 기반 엔진 |
| Exact cache | Redis lookup |
| 긴 프롬프트 평균 크기 | ${fmt(r.promptShape.avgPromptBytes)} bytes |
| 긴 프롬프트 P95 크기 | ${fmt(r.promptShape.p95PromptBytes)} bytes |
| 목적 시작 위치 평균 | ${fmt(r.promptShape.avgPurposePositionBytes)} bytes |
| 목적이 2048 bytes 뒤에 있는 샘플 | ${r.promptShape.over2048PurposeCount}개 |
| synthetic 민감정보 포함 샘플 | ${r.promptShape.syntheticSensitiveCount}개 |
| DB log 저장 | ${r.logs.actual} / ${r.logs.expected} |

## 3. 라우팅 정확도

| 항목 | 결과 |
|---|---:|
| Category 정확도 | ${percent(r.routing.categoryAccuracy)} |
| Tier 정확도 | ${percent(r.routing.tierAccuracy)} |
| Model 정확도 | ${percent(r.routing.modelAccuracy)} |
| 실패 수 | ${r.routing.failures.length} / ${r.routing.total} |

## 4. 카테고리별 정확도

| expected category | 샘플 수 | category 정확도 | tier 정확도 | 실제 분류 분포 |
|---|---:|---:|---:|---|
${categoryRows}

## 5. 주요 지연시간

| 구분 | 평균 | P50 | P95 | Max |
|---|---:|---:|---:|---:|
| client 왕복 | ${fmt(r.timing.client.avgClientMs)}ms | ${fmt(r.timing.client.p50ClientMs)}ms | ${fmt(r.timing.client.p95ClientMs)}ms | ${fmt(r.timing.client.maxClientMs)}ms |
| DB latency_ms | ${fmt(r.timing.client.avgGatewayLatencyMs)}ms | ${fmt(r.timing.client.p50GatewayLatencyMs)}ms | ${fmt(r.timing.client.p95GatewayLatencyMs)}ms | - |
| provider 대기 | ${fmt(r.timing.client.avgProviderLatencyMs)}ms | - | ${fmt(r.timing.client.p95ProviderLatencyMs)}ms | - |
| provider 제외 Gateway 내부 | ${fmt(r.timing.client.avgGatewayWithoutProviderMs)}ms | - | ${fmt(r.timing.client.p95GatewayWithoutProviderMs)}ms | - |

## 6. Stage별 시간

stage timing은 Gateway가 request log metadata에 남긴 \`stageTimings\` 기준이다. ms와 μs를 같이 표기했다.

| stage | 요청 수 | 평균 | P50 | P95 | Max | 평균 μs | P95 μs |
|---|---:|---:|---:|---:|---:|---:|---:|
${stageRows}

## 7. 오분류 샘플

프롬프트 원문은 보고서에 저장하지 않고, sampleId와 목적 위치만 남겼다. 전체 상세는 JSON의 실패 목록을 보면 된다.

| sampleId | expected | actual | expected tier | actual tier | prompt bytes | 목적 시작 bytes | routing reason |
|---|---|---|---|---|---:|---:|---|
${failureRows}

## 8. 해석

- 이번 테스트는 이전보다 더 실제적인 긴 프롬프트 형태다.
- 목적이 뒤쪽에 있어도 현재 라우팅이 끝까지 읽는 것은 아니다. 현재 category scan은 앞쪽 제한이 있기 때문에, 목적이 늦게 나오면 general/low_cost로 떨어질 수 있다.
- 그래서 이 테스트의 정확도는 “긴 프롬프트에서 현재 룰 기반 라우팅이 얼마나 버티는지”를 보는 값이다.
- Semantic cache embedding이나 모델 기반 PII 검사는 이번 테스트에서 켜지지 않았다.
- 실제 출시 환경에서 embedding/model 기반 검사를 켜면 별도 stage를 추가해 다시 측정해야 한다.
`;
}

function publicSample(x) {
  return {
    sampleId: x.sampleId,
    requestId: x.requestId,
    expectedCategory: x.expectedCategory,
    actualCategory: x.actualCategory,
    expectedTier: x.expectedTier,
    actualTier: x.actualTier,
    selectedModel: x.selectedModel,
    routingReason: x.routingReason,
    categoryCorrect: x.categoryCorrect,
    tierCorrect: x.tierCorrect,
    promptBytes: x.promptBytes,
    promptRunes: x.promptRunes,
    expectedPurposePositionBytes: x.expectedPurposePositionBytes,
    containsSensitiveSynthetic: x.containsSensitiveSynthetic,
    httpStatus: x.httpStatus,
    clientDurationMs: x.clientDurationMs,
    latencyMs: x.latencyMs,
    providerLatencyMs: x.providerLatencyMs,
    gatewayWithoutProviderMs: x.gatewayWithoutProviderMs,
    cacheStatus: x.cacheStatus,
    cacheType: x.cacheType,
    maskingAction: x.maskingAction,
    stageTimings: x.stageTimings,
    promptHash: x.promptHash,
  };
}

function normalizeStageTimings(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([stage, timing]) => [stage, { durationMs: Number(timing?.durationMs || 0), count: Number(timing?.count || 0) }]));
}
function parseMetadata(v) { if (!v) return {}; if (typeof v === "string") return safeJSON(v) || {}; return v; }
function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function first(...values) { for (const value of values) if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim(); return ""; }
function tierFromReason(reason) { if (reason === "category_code_high_quality" || reason === "category_reasoning_high_quality") return "high_quality"; if (reason === "category_support_refund_low_cost" || reason === "short_prompt_low_cost") return "low_cost"; return reason ? "balanced" : "unknown"; }
function dist(items, pick) { const m = {}; for (const item of items) { const key = String(pick(item) ?? "unknown"); m[key] = (m[key] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b))); }
function avg(values) { const a = values.filter(Number.isFinite); return a.length ? a.reduce((sum, v) => sum + v, 0) / a.length : 0; }
function max(values) { const a = values.filter(Number.isFinite); return a.length ? Math.max(...a) : 0; }
function pctile(values, p) { const a = values.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return 0; return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))]; }
function ratio(a, b) { return b ? round(a / b, 6) : 0; }
function round(v, digits = 3) { return Number(Number(v || 0).toFixed(digits)); }
function percent(v) { return `${(Number(v || 0) * 100).toFixed(2)}%`; }
function fmt(v) { return Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: 6 }); }
function ts() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function printSummary(r) {
  console.log("\nRESULT");
  console.log(`category accuracy: ${percent(r.routing.categoryAccuracy)}`);
  console.log(`tier accuracy: ${percent(r.routing.tierAccuracy)}`);
  console.log(`logs: ${r.logs.actual}/${r.logs.expected}`);
  console.log(`client avg/p95: ${fmt(r.timing.client.avgClientMs)}ms / ${fmt(r.timing.client.p95ClientMs)}ms`);
  console.log(`gateway without provider avg/p95: ${fmt(r.timing.client.avgGatewayWithoutProviderMs)}ms / ${fmt(r.timing.client.p95GatewayWithoutProviderMs)}ms`);
  const route = r.stageTimings.decide_model_route || {};
  console.log(`routing avg/p95: ${fmt(route.avgMs)}ms / ${fmt(route.p95Ms)}ms`);
  console.log(`report: ${reportMdPath}`);
}
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
const reportJsonPath = path.join(reportDir, "보고서4.json");
const reportMdPath = path.join(reportDir, "보고서4.md");
const gatewayPort = process.env.GATEWAY_OPENAI_STREAM_20_PORT || "18081";
const gatewayBaseUrl = process.env.GATEWAY_BASE_URL || `http://localhost:${gatewayPort}`;
const mockProviderBaseUrl = process.env.MOCK_PROVIDER_BASE_URL || "http://localhost:8090";
const apiKey = process.env.GATELM_DEMO_API_KEY || "glm_api_test_redacted";
const appToken = process.env.GATELM_DEMO_APP_TOKEN || "glm_app_token_test_redacted";
const requestTimeoutMs = positiveInt(process.env.GATEWAY_OPENAI_STREAM_20_TIMEOUT_MS, 60000);
const logPollTimeoutMs = positiveInt(process.env.GATEWAY_OPENAI_STREAM_20_LOG_POLL_TIMEOUT_MS, 90000);
const logPollIntervalMs = 1000;
const maxTokens = positiveInt(process.env.GATEWAY_OPENAI_STREAM_20_MAX_TOKENS, 32);
const openAIProviderId = process.env.GATEWAY_OPENAI_PROVIDER_ID || "provider_openai_main";
const openAIModelName = process.env.GATEWAY_OPENAI_STREAM_20_MODEL || "gpt-4o-mini";
const openAIModelRef = process.env.GATEWAY_OPENAI_STREAM_20_MODEL_REF || `${openAIProviderId}:${openAIModelName}`;

try {
  await main();
} catch (err) {
  console.error(`FAIL: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exitCode = 1;
}

async function main() {
  await loadDotenvOpenAIKey();
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_API_KEY.trim()) {
    throw new Error("OPENAI_API_KEY is required. Put it in the current env or C:/jungle7/llmops/.env.");
  }

  const runId = `openai_stream_20_${ts()}`;
  const prefix = `request_${runId}_`;
  await fs.mkdir(reportDir, { recursive: true });
  await fs.mkdir(path.join(repoRoot, ".tmp", "gateway-openai-stream-20"), { recursive: true });
  const samples = buildSamples(runId);

  console.log("GateLM OpenAI streaming 20 evidence");
  console.log(`runId=${runId}`);
  console.log(`samples=${samples.length}`);
  console.log(`gateway=${gatewayBaseUrl}`);
  console.log(`providerModel=${openAIModelName}`);
  console.log(`modelRef=${openAIModelRef}`);

  await bootstrap();
  await resetRedis();
  const gateway = await startGateway();
  const startedAt = new Date();
  let results = [];
  try {
    for (const sample of samples) {
      results.push(await invokeStreaming(sample, prefix));
      console.log(`  progress ${results.length}/${samples.length}`);
    }
  } finally {
    await stopGateway(gateway);
  }
  await sleep(3500);
  const logs = await pollLogs(prefix, samples.length);
  const completedAt = new Date();
  const report = buildReport({ runId, prefix, samples, results, logs, startedAt, completedAt });
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdPath, markdown(report), "utf8");
  printSummary(report);
}

async function loadDotenvOpenAIKey() {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) return;
  const envPath = path.join(repoRoot, ".env");
  let raw = "";
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/);
    if (match) {
      process.env.OPENAI_API_KEY = match[1].trim().replace(/^['"]|['"]$/g, "");
      return;
    }
  }
}

async function bootstrap() {
  await execFileAsync("docker", ["compose", "up", "-d", "postgres", "redis", "mock-provider"], { cwd: repoRoot, maxBuffer: 30 * 1024 * 1024 });
  await execFileAsync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "dev", "v2-p0-bootstrap-check.ps1")], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseURL(), REDIS_URL: "redis://localhost:6379" },
    maxBuffer: 30 * 1024 * 1024,
  });
}

async function resetRedis() {
  await execFileAsync("docker", ["compose", "exec", "-T", "redis", "redis-cli", "FLUSHDB"], { cwd: repoRoot });
}

async function startGateway() {
  const go = await resolveGo();
  const logDir = path.join(repoRoot, ".tmp", "gateway-openai-stream-20");
  const out = await fs.open(path.join(logDir, "gateway.out.log"), "w");
  const err = await fs.open(path.join(logDir, "gateway.err.log"), "w");
  const envs = {
    ...process.env,
    DATABASE_URL: databaseURL(),
    REDIS_URL: "redis://localhost:6379",
    GATEWAY_PORT: gatewayPort,
    GATEWAY_RUNTIME_SNAPSHOT_MODE: "demo",
    GATEWAY_CONTROL_PLANE_BASE_URL: "",
    GATEWAY_AUTH_SOURCE: "demo",
    MOCK_PROVIDER_BASE_URL: mockProviderBaseUrl,
    GATEWAY_OPENAI_PROVIDER_ID: openAIProviderId,
    GATEWAY_OPENAI_EXTRA_MODELS: openAIModelName,
    GATEWAY_RATE_LIMIT_LIMIT: "200000",
    GATEWAY_ASYNC_LOG_ENABLED: "true",
    GATEWAY_ASYNC_LOG_QUEUE_SIZE: "8192",
    GATEWAY_ASYNC_LOG_WORKER_COUNT: "4",
    GATEWAY_PROMPT_CAPTURE_ENABLED: "false",
    GATEWAY_RESPONSE_CAPTURE_ENABLED: "false",
    SEMANTIC_CACHE_ENABLED: "false",
    GATEWAY_PROVIDER_TIMEOUT_MS: "60000",
  };
  const child = spawn(go, ["run", "./apps/gateway-core/cmd/gateway"], { cwd: repoRoot, env: envs, stdio: ["ignore", out.fd, err.fd], windowsHide: true });
  child.once("exit", () => { out.close().catch(() => {}); err.close().catch(() => {}); });
  await waitHealth(child, path.join(logDir, "gateway.err.log"));
  return child;
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    try {
      await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      return;
    } catch {
      // Fall through to the normal signal path if taskkill is unavailable.
    }
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(7000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
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
  const categories = ["general", "code", "translation", "summarization", "reasoning"];
  return Array.from({ length: 20 }, (_, i) => {
    const category = categories[i % categories.length];
    const prompt = makeLongPrompt(category, i, runId);
    return {
      sampleId: `openai_${String(i + 1).padStart(2, "0")}`,
      expectedCategory: category,
      prompt,
      promptBytes: Buffer.byteLength(prompt, "utf8"),
      promptHash: `sha256:${crypto.createHash("sha256").update(prompt).digest("hex")}`,
    };
  });
}

function makeLongPrompt(category, index, runId) {
  const background = [
    `테스트 식별자 ${runId}-${index}. 아래 내용은 실제 고객 데이터가 아니라 라우팅 검증용 synthetic 문장이다.`,
    "초반에는 의도와 직접 관련 없는 배경을 길게 둔다. Gateway 운영자는 비용, 캐시, 로그, 정책 배포, 런타임 스냅샷, provider fallback을 동시에 고려하고 있다.",
    "중간에는 일부러 여러 카테고리 신호를 섞는다. 코드, SQL, 환불, 영어 문장, JSON, 회의록, 비교 분석이라는 단어가 모두 등장하지만 이것들은 최종 요청이 아니다.",
    "라우팅은 앞부분 단어 하나만 보고 결정하면 안 되고, 사용자가 실제로 요구한 작업을 찾아야 한다. 이번 테스트는 OpenAI 실제 provider 왕복과 스트리밍 첫 토큰 시간을 측정한다.",
    "다시 말하지만 이 문단은 배경이다. request log, cache hit, budget guard, API key 인증, App Token 검증 같은 단어가 나오더라도 최종 분류 근거로 과도하게 쓰이면 안 된다.",
  ].join("\n");
  return `${background}\n\n${purposeFor(category, index)}\n\n답변은 한 문단으로 짧게 작성해줘.`;
}

function purposeFor(category, index) {
  switch (category) {
    case "code":
      return `마지막 요청: Go Gateway에서 라우팅 stage 시간이 기록되지 않는 버그가 있다고 가정하고, 원인 후보와 수정할 코드 위치를 짧게 설명해줘. case=${index}`;
    case "reasoning":
      return `마지막 요청: 저비용 모델 우선 라우팅과 고품질 모델 우선 라우팅을 비용, 지연시간, 실패 위험 기준으로 비교해서 어떤 전략이 나은지 판단해줘. case=${index}`;
    case "translation":
      return `마지막 요청: 다음 공지 문장을 자연스러운 영어 비즈니스 문장으로 번역해줘. '정책 변경은 오늘 오후 6시에 배포되며 기존 요청은 영향을 받지 않습니다.' case=${index}`;
    case "summarization":
      return `마지막 요청: 위 배경을 운영 회의 공유용으로 핵심 3줄만 요약해줘. case=${index}`;
    default:
      return `마지막 요청: GateLM Gateway가 무엇을 하는 서비스인지 처음 보는 사람에게 쉽게 설명해줘. case=${index}`;
  }
}

async function invokeStreaming(sample, prefix) {
  const requestId = `${prefix}${sample.sampleId}`;
  const started = performance.now();
  let firstByteMs = 0;
  let firstTokenMs = 0;
  let completedMs = 0;
  let httpStatus = 0;
  let routingReason = "";
  let executionMode = "";
  let cacheStatus = "";
  let tokenChunkCount = 0;
  let error = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${apiKey}`,
        "x-gatelm-app-token": appToken,
        "x-gatelm-end-user-id": "openai-stream-routing-user",
        "x-gatelm-feature-id": "openai-stream-routing-evidence",
        "x-gatelm-request-id": requestId,
      },
      body: JSON.stringify({ model: openAIModelRef, messages: [{ role: "user", content: sample.prompt }], temperature: 0, max_tokens: maxTokens, stream: true }),
      signal: controller.signal,
    });
    firstByteMs = performance.now() - started;
    httpStatus = response.status;
    cacheStatus = response.headers.get("x-gatelm-cache-status") || "";
    if (!response.body) throw new Error("stream response has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const now = performance.now();
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSEBuffer(buffer);
      buffer = parsed.remainder;
      for (const data of parsed.events) {
        if (data === "[DONE]") continue;
        const chunk = safeJSON(data);
        const content = chunk?.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          tokenChunkCount++;
          if (!firstTokenMs) firstTokenMs = now - started;
        }
        const gateLM = chunk?.gate_lm;
        if (gateLM) {
          routingReason = routingReason || String(gateLM.routingReason || "");
          executionMode = executionMode || String(gateLM.executionMode || "");
        }
      }
    }
    completedMs = performance.now() - started;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    completedMs = performance.now() - started;
  } finally {
    clearTimeout(timer);
  }
  return {
    sampleId: sample.sampleId,
    requestId,
    httpStatus,
    firstByteMs: round(firstByteMs, 6),
    firstTokenMs: round(firstTokenMs, 6),
    completedMs: round(completedMs, 6),
    routingReason,
    executionMode,
    cacheStatus,
    tokenChunkCount,
    error,
  };
}

function parseSSEBuffer(buffer) {
  const events = [];
  let idx;
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const raw = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const dataLines = raw.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => {
        const value = line.slice(5);
        return value.startsWith(" ") ? value.slice(1) : value;
      });
    if (dataLines.length > 0) events.push(dataLines.join("\n"));
  }
  return { events, remainder: buffer };
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
  const sql = `select coalesce(json_agg(row_to_json(t) order by "requestId"), '[]'::json) from (select request_id as "requestId", status, http_status as "httpStatus", provider as "providerAttemptProviderId", model as "providerAttemptModelId", routing_reason as "routingReason", cache_status as "cacheStatus", cache_type as "cacheType", masking_action as "maskingAction", latency_ms as "latencyMs", provider_latency_ms as "providerAttemptLatencyMs", metadata from p0_llm_invocation_logs where request_id like '${escapedPrefix}%' order by request_id) t;`;
  const { stdout } = await execFileAsync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "gatelm", "-d", "gatelm", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { cwd: repoRoot, maxBuffer: 80 * 1024 * 1024 });
  return JSON.parse(stdout.trim() || "[]");
}

function buildReport({ runId, prefix, samples, results, logs, startedAt, completedAt }) {
  const resultById = new Map(results.map((x) => [x.sampleId, x]));
  const logByRequestId = new Map(logs.map((x) => [x.requestId, x]));
  const enriched = samples.map((sample) => enrich(sample, resultById.get(sample.sampleId), logByRequestId.get(`${prefix}${sample.sampleId}`)));
  return {
    schemaVersion: "gatelm.openai-stream-20-evidence.v2",
    generatedAt: completedAt.toISOString(),
    runId,
    requestPrefix: prefix,
    input: { count: samples.length, provider: "openai-compatible", modelRef: openAIModelRef, stream: true, maxTokens, semanticCacheEnabled: false },
    timing: { startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), wallClockMs: completedAt - startedAt, client: timing(enriched) },
    routing: routing(enriched),
    providerAttempts: {
      providerIdDistribution: dist(enriched, (x) => x.providerAttemptProviderId || "unavailable"),
      modelIdDistribution: dist(enriched, (x) => x.providerAttemptModelId || "unavailable"),
    },
    stageTimings: stageStats(enriched),
    logs: { expected: samples.length, actual: logs.length, coverage: ratio(logs.length, samples.length), httpStatusCounts: dist(enriched, (x) => String(x.httpStatus || 0)) },
    samples: enriched.map(publicSample),
  };
}

function enrich(sample, result, log) {
  const metadata = parseMetadata(log?.metadata);
  const routingReason = first(log?.routingReason, result?.routingReason);
  const actualCategory = first(metadata.promptCategory, "general");
  const actualDifficulty = first(metadata.promptDifficulty, "simple");
  const executionMode = first(result?.executionMode, "not_reported");
  const providerAttemptProviderId = first(metadata.providerAttempt?.providerId, log?.providerAttemptProviderId);
  const providerAttemptModelId = first(metadata.providerAttempt?.modelId, log?.providerAttemptModelId);
  const stageTimings = normalizeStageTimings(metadata.stageTimings);
  return {
    ...sample,
    requestId: result?.requestId || log?.requestId || "",
    httpStatus: Number(result?.httpStatus || log?.httpStatus || 0),
    logWritten: Boolean(log),
    status: log?.status || "",
    routingReason,
    executionMode,
    actualCategory,
    actualDifficulty,
    providerAttemptProviderId,
    providerAttemptModelId,
    categoryCorrect: actualCategory === sample.expectedCategory,
    cacheStatus: first(log?.cacheStatus, result?.cacheStatus),
    cacheType: log?.cacheType || "",
    maskingAction: log?.maskingAction || "",
    latencyMs: Number(log?.latencyMs || 0),
    providerLatencyMs: Number(log?.providerAttemptLatencyMs || 0),
    gatewayWithoutProviderMs: Math.max(0, Number(log?.latencyMs || 0) - Number(log?.providerAttemptLatencyMs || 0)),
    firstByteMs: Number(result?.firstByteMs || 0),
    firstTokenMs: Number(result?.firstTokenMs || 0),
    completedMs: Number(result?.completedMs || 0),
    tokenChunkCount: Number(result?.tokenChunkCount || 0),
    error: result?.error || "",
    stageTimings,
  };
}

function routing(items) {
  const total = items.length;
  const categoryCorrect = items.filter((x) => x.categoryCorrect).length;
  return {
    total,
    categoryAccuracy: ratio(categoryCorrect, total),
    expectedCategoryDistribution: dist(items, (x) => x.expectedCategory),
    actualCategoryDistribution: dist(items, (x) => x.actualCategory),
    difficultyDistribution: dist(items, (x) => x.actualDifficulty),
    routingReasonDistribution: dist(items, (x) => x.routingReason || "unknown"),
    executionModeDistribution: dist(items, (x) => x.executionMode || "not_reported"),
    failures: items.filter((x) => !x.categoryCorrect).map((x) => ({ sampleId: x.sampleId, expectedCategory: x.expectedCategory, actualCategory: x.actualCategory, actualDifficulty: x.actualDifficulty, routingReason: x.routingReason, executionMode: x.executionMode, requestId: x.requestId })),
  };
}

function timing(items) {
  return {
    avgCompletedMs: avg(items.map((x) => x.completedMs)),
    p50CompletedMs: pctile(items.map((x) => x.completedMs), 50),
    p95CompletedMs: pctile(items.map((x) => x.completedMs), 95),
    avgFirstByteMs: avg(items.map((x) => x.firstByteMs).filter((x) => x > 0)),
    p95FirstByteMs: pctile(items.map((x) => x.firstByteMs).filter((x) => x > 0), 95),
    avgFirstTokenMs: avg(items.map((x) => x.firstTokenMs).filter((x) => x > 0)),
    p50FirstTokenMs: pctile(items.map((x) => x.firstTokenMs).filter((x) => x > 0), 50),
    p95FirstTokenMs: pctile(items.map((x) => x.firstTokenMs).filter((x) => x > 0), 95),
    avgGatewayLatencyMs: avg(items.map((x) => x.latencyMs)),
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
  return Object.fromEntries(Object.entries(byStage).sort(([a], [b]) => a.localeCompare(b)).map(([stage, values]) => [stage, { requests: values.length, avgMs: round(avg(values), 6), p50Ms: round(pctile(values, 50), 6), p95Ms: round(pctile(values, 95), 6), maxMs: round(max(values), 6), avgMicros: round(avg(values) * 1000, 3), p95Micros: round(pctile(values, 95) * 1000, 3) }]));
}

function markdown(r) {
  const stageRows = Object.entries(r.stageTimings).map(([stage, v]) => `| \`${stage}\` | ${v.requests} | ${fmt(v.avgMs)}ms | ${fmt(v.p50Ms)}ms | ${fmt(v.p95Ms)}ms | ${fmt(v.maxMs)}ms | ${fmt(v.avgMicros)}μs | ${fmt(v.p95Micros)}μs |`).join("\n") || "| - | - | - | - | - | - | - | - |";
  const failRows = r.routing.failures.map((x) => `| ${x.sampleId} | ${x.expectedCategory} | ${x.actualCategory} | ${x.actualDifficulty} | ${x.routingReason} | ${x.executionMode} |`).join("\n") || "| - | - | - | - | - | - |";
  const sampleRows = r.samples.map((x) => `| ${x.sampleId} | ${x.httpStatus} | ${x.expectedCategory} | ${x.actualCategory} | ${x.actualDifficulty} | ${x.routingReason} | ${x.executionMode} | ${x.providerAttemptModelId || "-"} | ${fmt(x.firstTokenMs)}ms | ${fmt(x.completedMs)}ms | ${x.cacheStatus || "-"} |`).join("\n");
  return `# 보고서4 - OpenAI 실제 스트리밍 20건 라우팅/지연시간 측정

작성 시각: ${r.generatedAt}  
원본 JSON: \`${reportJsonPath}\`  
runId: \`${r.runId}\`

## 1. 목적

앞 1024 bytes + 뒤 1024 bytes를 같은 가중치로 보고, \`마지막 요청\`, \`요약해줘\`, \`번역해줘\` 같은 명시적 요청 표현에만 보너스를 주도록 category 분류 룰을 보완했다. 그 뒤 실제 OpenAI-compatible provider 경로로 20개 요청을 보내 category 정확도, Gateway 단계별 시간, 스트리밍 첫 토큰 도착 시간을 측정했다.

## 2. 테스트 조건

| 항목 | 값 |
|---|---:|
| 요청 수 | ${r.input.count} |
| Provider | OpenAI-compatible |
| 명시적 modelRef | \`${r.input.modelRef}\` |
| Gateway 요청 | \`stream=true\` |
| max_tokens | ${r.input.maxTokens} |
| Semantic Cache | 꺼짐 |
| Exact Cache | 켜짐, 모든 prompt는 고유값이라 hit 기대 없음 |
| 로그 저장 | DB \`p0_llm_invocation_logs\` 기준 |
| DB 로그 수집 | ${r.logs.actual} / ${r.logs.expected} |

\`routingReason\`, \`difficulty\`, \`executionMode\`는 routing 관찰값이다. 실제 provider/model은 별도 \`providerAttempts\` 실행 관찰값으로만 기록한다.

## 3. Category 분류 정확도

| 항목 | 결과 |
|---|---:|
| Category 정확도 | ${percent(r.routing.categoryAccuracy)} |
| 실패 수 | ${r.routing.failures.length} / ${r.routing.total} |

## 4. 스트리밍/지연시간 요약

| 항목 | 평균 | P50 | P95 |
|---|---:|---:|---:|
| 클라이언트 전체 완료 시간 | ${fmt(r.timing.client.avgCompletedMs)}ms | ${fmt(r.timing.client.p50CompletedMs)}ms | ${fmt(r.timing.client.p95CompletedMs)}ms |
| 첫 byte 도착 | ${fmt(r.timing.client.avgFirstByteMs)}ms | - | ${fmt(r.timing.client.p95FirstByteMs)}ms |
| 첫 content token 도착 | ${fmt(r.timing.client.avgFirstTokenMs)}ms | ${fmt(r.timing.client.p50FirstTokenMs)}ms | ${fmt(r.timing.client.p95FirstTokenMs)}ms |
| DB latency_ms | ${fmt(r.timing.client.avgGatewayLatencyMs)}ms | - | ${fmt(r.timing.client.p95GatewayLatencyMs)}ms |
| Provider latency | ${fmt(r.timing.client.avgProviderLatencyMs)}ms | - | ${fmt(r.timing.client.p95ProviderLatencyMs)}ms |
| Provider 제외 Gateway 내부 | ${fmt(r.timing.client.avgGatewayWithoutProviderMs)}ms | - | ${fmt(r.timing.client.p95GatewayWithoutProviderMs)}ms |

## 5. Gateway stage timing

| stage | 요청 수 | 평균 | P50 | P95 | Max | 평균 μs | P95 μs |
|---|---:|---:|---:|---:|---:|---:|---:|
${stageRows}

## 6. 요청별 요약

| sampleId | HTTP | expected | actual | difficulty | routingReason | executionMode | providerAttempt model | first token | complete | cache |
|---|---:|---|---|---|---|---|---|---:|---:|---|
${sampleRows}

## 7. 오분류 목록

| sampleId | expected | actual | difficulty | routingReason | executionMode |
|---|---|---|---|---|---|
${failRows}

## 8. 해석

- 이번 테스트는 mock provider가 아니라 실제 OpenAI-compatible provider를 통과했다.
- 스트리밍 첫 토큰 시간은 클라이언트가 Gateway SSE 응답에서 첫 \`delta.content\`를 받은 시점이다.
- \`stageTimings\`는 Gateway가 DB log metadata에 남긴 내부 단계별 시간이다.
- Semantic Cache embedding/model 호출은 꺼져 있으므로, 이 보고서는 category 분류와 OpenAI provider 왕복 중심의 측정이다.
- prompt/response 원문은 보고서에 저장하지 않고 sampleId와 hash 중심으로만 남겼다.
`;
}

function publicSample(x) {
  return { sampleId: x.sampleId, requestId: x.requestId, expectedCategory: x.expectedCategory, actualCategory: x.actualCategory, actualDifficulty: x.actualDifficulty, routingReason: x.routingReason, executionMode: x.executionMode, categoryCorrect: x.categoryCorrect, providerAttemptProviderId: x.providerAttemptProviderId, providerAttemptModelId: x.providerAttemptModelId, promptBytes: x.promptBytes, promptHash: x.promptHash, httpStatus: x.httpStatus, firstByteMs: x.firstByteMs, firstTokenMs: x.firstTokenMs, completedMs: x.completedMs, tokenChunkCount: x.tokenChunkCount, latencyMs: x.latencyMs, providerLatencyMs: x.providerLatencyMs, gatewayWithoutProviderMs: x.gatewayWithoutProviderMs, cacheStatus: x.cacheStatus, cacheType: x.cacheType, maskingAction: x.maskingAction, stageTimings: x.stageTimings, error: x.error };
}

function parseMetadata(v) { if (!v) return {}; if (typeof v === "string") return safeJSON(v) || {}; return v; }
function normalizeStageTimings(value) { if (!value || typeof value !== "object") return {}; return Object.fromEntries(Object.entries(value).map(([stage, timing]) => [stage, { durationMs: Number(timing?.durationMs || 0), count: Number(timing?.count || 0) }])); }
function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function first(...values) { for (const value of values) if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim(); return ""; }
function dist(items, pick) { const m = {}; for (const item of items) { const key = String(pick(item) ?? "unknown"); m[key] = (m[key] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b))); }
function avg(values) { const a = values.filter(Number.isFinite); return a.length ? a.reduce((sum, v) => sum + v, 0) / a.length : 0; }
function max(values) { const a = values.filter(Number.isFinite); return a.length ? Math.max(...a) : 0; }
function pctile(values, p) { const a = values.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return 0; return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))]; }
function ratio(a, b) { return b ? round(a / b, 6) : 0; }
function round(v, digits = 3) { return Number(Number(v || 0).toFixed(digits)); }
function percent(v) { return `${(Number(v || 0) * 100).toFixed(2)}%`; }
function fmt(v) { return Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: 6 }); }
function positiveInt(value, fallback) { const n = Number(value || fallback); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback; }
function ts() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function databaseURL() { return process.env.DATABASE_URL || "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public"; }
function printSummary(r) {
  console.log("\nRESULT");
  console.log(`category accuracy: ${percent(r.routing.categoryAccuracy)}`);
  console.log(`logs: ${r.logs.actual}/${r.logs.expected}`);
  console.log(`first token avg/p95: ${fmt(r.timing.client.avgFirstTokenMs)}ms / ${fmt(r.timing.client.p95FirstTokenMs)}ms`);
  const route = r.stageTimings.decide_model_route || {};
  console.log(`routing avg/p95: ${fmt(route.avgMs)}ms / ${fmt(route.p95Ms)}ms`);
  console.log(`report: ${reportMdPath}`);
}

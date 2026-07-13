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
const reportDirDefault = path.resolve(repoRoot, "..", "docs");
const segments = [
  { key: "current_rules", labelKo: "현재 룰", count: 300, stressRuleTotal: 0 },
  { key: "stress_2000_rules", labelKo: "룰 2000개", count: 300, stressRuleTotal: 2000 },
  { key: "stress_5000_rules", labelKo: "룰 5000개", count: 400, stressRuleTotal: 5000 },
];
const categories = {
  code: { prompts: ["Go handler에서 request log writer가 느려지는 지점을 찾아서 리팩토링 방향을 설명해줘.", "SQL 쿼리 성능이 느린데 인덱스와 pagination 로직을 어떻게 고치면 좋을지 봐줘."] },
  reasoning: { prompts: ["비용 절감과 응답 품질 중 무엇을 우선해야 하는지 조건별로 비교해서 결론을 내려줘.", "A안과 B안의 위험도를 비교하고 최종 추천안을 근거와 함께 정리해줘."] },
  translation: { prompts: ["다음 공지문을 해외 고객이 이해하기 쉬운 영어 표현으로 번역해줘.", "이 한국어 릴리즈 노트를 자연스러운 영문 안내문으로 바꿔줘."] },
  summarization: { prompts: ["긴 회의록에서 결정사항과 후속 작업만 요약해줘.", "여러 팀원의 의견을 읽고 공통 쟁점만 짧게 정리해줘."] },
  general: { prompts: ["GateLM 사용 방법을 처음 보는 사람에게 쉽게 설명해줘.", "관리 콘솔 메뉴 위치를 간단히 안내해줘."] },
};
const opts = parseArgs(process.argv.slice(2));

try { await main(opts); } catch (err) { console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; }

async function main(options) {
  const runId = `stage_timing_1k_${ts()}`;
  const prefix = `request_${runId}_`;
  const samples = buildSamples(runId);
  await fs.mkdir(options.reportDir, { recursive: true });
  await fs.mkdir(path.join(repoRoot, ".tmp", "gateway-stage-timing-1k"), { recursive: true });
  console.log("GateLM stage timing 1k evidence");
  console.log(`runId=${runId}`);
  console.log(`reportDir=${options.reportDir}`);
  if (!options.skipBootstrap) await bootstrap();
  await resetRedis();
  const startedAt = new Date();
  const results = [];
  for (const segment of segments) {
    const subset = samples.filter((s) => s.segment === segment.key);
    console.log(`\n[${segment.labelKo}] start, samples=${subset.length}, stressRuleTotal=${segment.stressRuleTotal || "current"}`);
    const gateway = await startGateway(options, segment);
    try {
      results.push(...await pool(subset, options.concurrency, (sample) => invoke(options, sample, prefix)));
    } finally {
      await stopGateway(gateway);
    }
  }
  await sleep(options.flushWaitMs);
  const logs = await pollLogs(options, prefix, samples.length);
  const report = buildReport({ options, runId, prefix, startedAt, completedAt: new Date(), samples, results, logs });
  await writeReport(options.reportDir, report);
  printSummary(report);
}

function parseArgs(args) {
  const o = { gatewayBaseUrl: env("GATEWAY_BASE_URL", "http://localhost:8080"), mockProviderBaseUrl: env("MOCK_PROVIDER_BASE_URL", "http://localhost:8090"), apiKey: env("GATELM_DEMO_API_KEY", "glm_api_test_redacted"), appToken: env("GATELM_DEMO_APP_TOKEN", "glm_app_token_test_redacted"), reportDir: env("GATEWAY_STAGE_TIMING_1K_REPORT_DIR", reportDirDefault), reportName: env("GATEWAY_STAGE_TIMING_1K_REPORT_NAME", "보고서"), concurrency: intEnv("GATEWAY_STAGE_TIMING_1K_CONCURRENCY", 12), flushWaitMs: intEnv("GATEWAY_STAGE_TIMING_1K_FLUSH_WAIT_MS", 3000), logPollTimeoutMs: intEnv("GATEWAY_STAGE_TIMING_1K_LOG_POLL_TIMEOUT_MS", 90000), logPollIntervalMs: intEnv("GATEWAY_STAGE_TIMING_1K_LOG_POLL_INTERVAL_MS", 1000), requestTimeoutMs: intEnv("GATEWAY_STAGE_TIMING_1K_REQUEST_TIMEOUT_MS", 15000), skipBootstrap: false };
  for (let i = 0; i < args.length; i++) { const a = args[i]; const v = () => args[++i]; if (a === "--skip-bootstrap") o.skipBootstrap = true; else if (a === "--concurrency") o.concurrency = Number(v()); else if (a === "--report-dir") o.reportDir = v(); else if (a === "--report-name") o.reportName = v(); else if (a === "--help") { usage(); process.exit(0); } else throw new Error(`unknown arg ${a}`); }
  return o;
}

async function bootstrap() { await execFileAsync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "dev", "v2-p0-bootstrap-check.ps1")], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public", REDIS_URL: "redis://localhost:6379" }, maxBuffer: 20 * 1024 * 1024 }); }
async function resetRedis() { await execFileAsync("docker", ["compose", "exec", "-T", "redis", "redis-cli", "FLUSHDB"], { cwd: repoRoot }); }

async function startGateway(options, segment) {
  const go = await resolveGo();
  const logDir = path.join(repoRoot, ".tmp", "gateway-stage-timing-1k");
  const out = await fs.open(path.join(logDir, `${segment.key}.out.log`), "w");
  const err = await fs.open(path.join(logDir, `${segment.key}.err.log`), "w");
  const envs = { ...process.env, DATABASE_URL: "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public", REDIS_URL: "redis://localhost:6379", GATEWAY_PORT: "8080", DEPLOYMENT_MODE: "demo", NODE_ENV: "development", RAW_RESPONSE_CAPTURE_ENABLED: "true", GATEWAY_RUNTIME_SNAPSHOT_MODE: "demo", GATEWAY_CONTROL_PLANE_BASE_URL: "", GATEWAY_AUTH_SOURCE: "demo", MOCK_PROVIDER_BASE_URL: options.mockProviderBaseUrl, GATEWAY_RATE_LIMIT_LIMIT: "200000", GATEWAY_ASYNC_LOG_ENABLED: "true", GATEWAY_ASYNC_LOG_QUEUE_SIZE: "8192", GATEWAY_ASYNC_LOG_WORKER_COUNT: "4", GATEWAY_PROMPT_CAPTURE_ENABLED: "true", GATEWAY_RESPONSE_CAPTURE_ENABLED: "true", GATEWAY_ROUTING_RULE_STRESS_TOTAL: String(segment.stressRuleTotal || 0) };
  const child = spawn(go, ["run", "./apps/gateway-core/cmd/gateway"], { cwd: repoRoot, env: envs, stdio: ["ignore", out.fd, err.fd], windowsHide: true });
  child.once("exit", () => { out.close().catch(() => {}); err.close().catch(() => {}); });
  await waitHealth(options.gatewayBaseUrl, child, path.join(logDir, `${segment.key}.err.log`));
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
  await Promise.race([new Promise((r) => child.once("exit", r)), sleep(7000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })]);
}

async function waitHealth(baseUrl, child, errPath) {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    if (child.exitCode !== null) throw new Error(`gateway exited early: ${(await fs.readFile(errPath, "utf8").catch(() => "")).slice(-1000)}`);
    try { const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1000) }); if (res.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("gateway healthz timeout");
}

async function resolveGo() {
  const bundled = path.resolve(repoRoot, "..", ".tools", "go1.24.13", "go", "bin", "go.exe");
  try { await fs.access(bundled); return bundled; } catch { return "go"; }
}

function buildSamples(runId) {
  const keys = Object.keys(categories);
  const samples = [];
  const cacheSeeds = [];
  for (let i = 0; i < 1000; i++) {
    const segment = segmentForIndex(i);
    let category = keys[i % keys.length];
    let cfg = categories[category];
    let prompt = `${cfg.prompts[Math.floor(i / keys.length) % cfg.prompts.length]} 답변은 짧고 명확하게 작성해줘. case=${i}`;
    let sensitive = i % 5 === 0;
    if (sensitive) prompt += ` 테스트용 연락처 test-user-${i}@example.invalid, 010-0000-${String(i % 10000).padStart(4, "0")}가 포함되어 있어.`;
    let sample = { sampleId: `sample_${String(i + 1).padStart(4, "0")}`, index: i, runId, segment: segment.key, segmentLabelKo: segment.labelKo, stressRuleTotal: segment.stressRuleTotal, expectedCategory: category, sensitive, duplicateOf: "", prompt, promptHash: hash(prompt) };
    if (!sensitive && i % 37 === 0) cacheSeeds.push(sample);
    if (i % 40 === 39 && cacheSeeds.length > 0) {
      const original = cacheSeeds[(i + cacheSeeds.length) % cacheSeeds.length];
      sample = { ...sample, expectedCategory: original.expectedCategory, sensitive: original.sensitive, duplicateOf: original.sampleId, prompt: original.prompt, promptHash: original.promptHash };
    }
    samples.push(sample);
  }
  return samples;
}

function segmentForIndex(index) { let start = 0; for (const s of segments) { if (index >= start && index < start + s.count) return s; start += s.count; } return segments.at(-1); }

async function invoke(options, sample, prefix) {
  const requestId = `${prefix}${sample.sampleId}`;
  const start = performance.now();
  let httpStatus = 0, body = "", parsed = null, error = "";
  try {
    const res = await fetch(`${options.gatewayBaseUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${options.apiKey}`, "x-gatelm-app-token": options.appToken, "x-gatelm-end-user-id": "stage-timing-evidence-user", "x-gatelm-feature-id": `stage_timing_${sample.segment}`, "x-gatelm-request-id": requestId }, body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: sample.prompt }], temperature: 0, max_tokens: 80, stream: false }), signal: AbortSignal.timeout(options.requestTimeoutMs) });
    httpStatus = res.status; body = await res.text(); parsed = json(body);
  } catch (err) { error = safe(err instanceof Error ? err.message : String(err)); }
  const gateLM = parsed?.gate_lm ?? {};
  return { sampleId: sample.sampleId, requestId, segment: sample.segment, httpStatus, durationMs: round(performance.now() - start), routingReason: String(gateLM.routingReason ?? ""), executionMode: String(gateLM.executionMode ?? ""), cacheStatus: String(gateLM.cacheStatus ?? ""), error };
}

async function pool(items, concurrency, worker) {
  const out = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (cursor < items.length) { const i = cursor++; out[i] = await worker(items[i]); if ((i + 1) % 50 === 0 || i === items.length - 1) console.log(`  progress ${i + 1}/${items.length}`); } }));
  return out;
}

async function pollLogs(options, prefix, expected) {
  const start = Date.now(); let latest = [];
  while (Date.now() - start < options.logPollTimeoutMs) {
    latest = await queryLogs(prefix);
    if (latest.length >= expected) return latest;
    await sleep(options.logPollIntervalMs);
  }
  return latest;
}

async function queryLogs(prefix) {
  const sql = `select coalesce(json_agg(row_to_json(t) order by "requestId"), '[]'::json) from (select request_id as "requestId", status, http_status as "httpStatus", provider as "providerAttemptProviderId", model as "providerAttemptModelId", routing_reason as "routingReason", cache_status as "cacheStatus", cache_type as "cacheType", masking_action as "maskingAction", masking_detected_types as "maskingDetectedTypes", redacted_prompt_preview as "redactedPromptPreview", latency_ms as "latencyMs", provider_latency_ms as "providerAttemptLatencyMs", metadata from p0_llm_invocation_logs where request_id like '${prefix.replace(/'/g, "''")}%' order by request_id) t;`;
  const { stdout } = await execFileAsync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "gatelm", "-d", "gatelm", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { cwd: repoRoot, maxBuffer: 60 * 1024 * 1024 });
  return JSON.parse(stdout.trim() || "[]");
}

function buildReport({ options, runId, prefix, startedAt, completedAt, samples, results, logs }) {
  const resultById = new Map(results.map((r) => [r.sampleId, r]));
  const logByRequestId = new Map(logs.map((l) => [l.requestId, l]));
  const enriched = samples.map((s) => enrich(s, resultById.get(s.sampleId), logByRequestId.get(`${prefix}${s.sampleId}`)));
  return { schemaVersion: "gatelm.gateway-stage-timing-1k-evidence.v2", generatedAt: completedAt.toISOString(), runId, requestPrefix: prefix, input: { count: samples.length, concurrency: options.concurrency, provider: "mock", sensitiveTargetCount: 200, ruleStressSegments: segments, reportDir: options.reportDir, reportName: options.reportName }, timing: { startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), wallClockMs: completedAt - startedAt, client: timing(enriched) }, routing: routing(enriched), providerAttempts: { providerIdDistribution: dist(enriched, (x) => x.providerAttemptProviderId || "unavailable"), modelIdDistribution: dist(enriched, (x) => x.providerAttemptModelId || "unavailable") }, stageTimings: stageStats(enriched), segments: segmentStats(enriched), captures: captures(enriched), logs: { expected: samples.length, actual: logs.length, coverage: ratio(logs.length, samples.length), httpStatusCounts: dist(enriched, (x) => String(x.httpStatus || 0)) }, samples: enriched.map(publicSample), securityNote: "raw API key/App token/Provider key/Authorization header는 저장하지 않는다. prompt 샘플은 Gateway가 저장한 masking 이후 promptCapture만 표시한다." };
}

function enrich(s, r, l) {
  const m = meta(l?.metadata);
  const routingReason = first(l?.routingReason, r?.routingReason);
  const actualCategory = first(m.promptCategory, "general");
  const actualDifficulty = first(m.promptDifficulty, "simple");
  const executionMode = first(r?.executionMode, "not_reported");
  const providerAttemptProviderId = first(m.providerAttempt?.providerId, l?.providerAttemptProviderId);
  const providerAttemptModelId = first(m.providerAttempt?.modelId, l?.providerAttemptModelId);
  return { ...s, requestId: r?.requestId ?? "", httpStatus: r?.httpStatus ?? l?.httpStatus ?? 0, clientDurationMs: Number(r?.durationMs ?? 0), gatewayLatencyMs: num(l?.latencyMs), providerLatencyMs: num(l?.providerAttemptLatencyMs), gatewayWithoutProviderMs: Math.max(0, num(l?.latencyMs) - num(l?.providerAttemptLatencyMs)), logWritten: Boolean(l), status: l?.status ?? "", routingReason, executionMode, actualCategory, actualDifficulty, providerAttemptProviderId, providerAttemptModelId, categoryCorrect: actualCategory === s.expectedCategory, cacheStatus: first(l?.cacheStatus, r?.cacheStatus), cacheType: l?.cacheType ?? "", maskingAction: l?.maskingAction ?? "", redactedPromptPreview: safe(l?.redactedPromptPreview ?? ""), promptCapture: safe(m.promptCapture?.capturedPrompt ?? ""), responseCapture: safe(m.responseCapture?.capturedResponse ?? ""), stageTimings: normalizeStageTimings(m.stageTimings) };
}

function routing(items) {
  const total = items.length, c = items.filter((x) => x.categoryCorrect).length;
  return { total, categoryAccuracy: ratio(c, total), categoryCorrect: c, categoryIncorrect: total - c, expectedCategoryDistribution: dist(items, (x) => x.expectedCategory), actualCategoryDistribution: dist(items, (x) => x.actualCategory), difficultyDistribution: dist(items, (x) => x.actualDifficulty), routingReasonDistribution: dist(items, (x) => x.routingReason || "unknown"), executionModeDistribution: dist(items, (x) => x.executionMode || "not_reported"), firstFailures: items.filter((x) => !x.categoryCorrect).slice(0, 20).map((x) => ({ sampleId: x.sampleId, requestId: x.requestId, segment: x.segment, expectedCategory: x.expectedCategory, actualCategory: x.actualCategory, actualDifficulty: x.actualDifficulty, routingReason: x.routingReason, executionMode: x.executionMode, promptHash: x.promptHash })) };
}

function timing(items) {
  const client = items.map((x) => x.clientDurationMs).filter(Boolean), gw = items.map((x) => x.gatewayLatencyMs).filter(Boolean), noProvider = items.map((x) => x.gatewayWithoutProviderMs), provider = items.map((x) => x.providerLatencyMs).filter(Boolean);
  return { avgClientMs: avg(client), p50ClientMs: pct(client, 50), p95ClientMs: pct(client, 95), maxClientMs: max(client), avgGatewayLatencyMs: avg(gw), p95GatewayLatencyMs: pct(gw, 95), avgGatewayWithoutProviderMs: avg(noProvider), p95GatewayWithoutProviderMs: pct(noProvider, 95), avgProviderLatencyMs: avg(provider), p95ProviderLatencyMs: pct(provider, 95) };
}

function segmentStats(items) { return segments.map((s) => { const xs = items.filter((x) => x.segment === s.key); return { segment: s.key, labelKo: s.labelKo, stressRuleTotal: s.stressRuleTotal, count: xs.length, categoryAccuracy: ratio(xs.filter((x) => x.categoryCorrect).length, xs.length), avgGatewayWithoutProviderMs: avg(xs.map((x) => x.gatewayWithoutProviderMs)), p95GatewayWithoutProviderMs: pct(xs.map((x) => x.gatewayWithoutProviderMs), 95), stageTimings: stageStats(xs) }; }); }
function stageStats(items) { const by = {}; for (const x of items) for (const [stage, v] of Object.entries(x.stageTimings || {})) (by[stage] ??= []).push(Number(v.durationMs || 0)); return Object.fromEntries(Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([stage, values]) => [stage, { requests: values.length, avgDurationMs: avg(values), p50DurationMs: pct(values, 50), p95DurationMs: pct(values, 95), maxDurationMs: max(values) }])); }
function captures(items) { const masked = items.filter((x) => x.maskingAction && x.maskingAction !== "none"), hits = items.filter((x) => x.cacheStatus === "hit"), pc = items.filter((x) => x.promptCapture), rc = items.filter((x) => x.responseCapture); return { sensitiveInputCount: items.filter((x) => x.sensitive).length, maskedOrBlockedCount: masked.length, promptCaptureCount: pc.length, responseCaptureCount: rc.length, exactCacheHitCount: hits.filter((x) => x.cacheType === "exact").length, maskingActionDistribution: dist(items, (x) => x.maskingAction || "none"), cacheStatusDistribution: dist(items, (x) => x.cacheStatus || "unknown"), promptResponseSamples: pc.filter((x) => x.responseCapture).slice(0, 5).map(sampleView), cacheHitSamples: hits.slice(0, 5).map(sampleView), maskingSamples: masked.slice(0, 5).map(sampleView) }; }
function sampleView(x) { return { sampleId: x.sampleId, requestId: x.requestId, segment: x.segment, cacheStatus: x.cacheStatus, cacheType: x.cacheType, maskingAction: x.maskingAction, redactedPromptPreview: x.redactedPromptPreview, capturedPrompt: x.promptCapture, capturedResponse: x.responseCapture }; }
function publicSample(x) { return { sampleId: x.sampleId, requestId: x.requestId, segment: x.segment, stressRuleTotal: x.stressRuleTotal, expectedCategory: x.expectedCategory, actualCategory: x.actualCategory, actualDifficulty: x.actualDifficulty, routingReason: x.routingReason, executionMode: x.executionMode, categoryCorrect: x.categoryCorrect, providerAttemptProviderId: x.providerAttemptProviderId, providerAttemptModelId: x.providerAttemptModelId, sensitive: x.sensitive, duplicateOf: x.duplicateOf, promptHash: x.promptHash, clientDurationMs: x.clientDurationMs, gatewayLatencyMs: x.gatewayLatencyMs, providerLatencyMs: x.providerLatencyMs, gatewayWithoutProviderMs: x.gatewayWithoutProviderMs, cacheStatus: x.cacheStatus, cacheType: x.cacheType, maskingAction: x.maskingAction, stageTimings: x.stageTimings }; }

async function writeReport(dir, report) { const reportName = report.input.reportName || "보고서"; const jsonPath = path.join(dir, `${reportName}.json`), mdPath = path.join(dir, `${reportName}.md`); await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"); await fs.writeFile(mdPath, md(report, jsonPath), "utf8"); }
function md(r, jsonPath) {
  const segmentRows = r.segments.map((s) => `| ${s.labelKo} | ${s.count} | ${s.stressRuleTotal || "current"} | ${percent(s.categoryAccuracy)} | ${s.avgGatewayWithoutProviderMs}ms | ${s.p95GatewayWithoutProviderMs}ms |`).join("\n");
  const stageRows = Object.entries(r.stageTimings).map(([k, v]) => `| \`${k}\` | ${v.requests} | ${v.avgDurationMs} | ${v.p95DurationMs} | ${v.maxDurationMs} |`).join("\n") || "| - | - | - | - | - |";
  const capRows = r.captures.promptResponseSamples.map((x) => `| \`${x.requestId}\` | ${x.cacheStatus || "-"}/${x.cacheType || "-"} | ${x.maskingAction || "-"} | ${cell(x.capturedPrompt, 120)} | ${cell(x.capturedResponse, 80)} |`).join("\n") || "| - | - | - | - | - |";
  const hitRows = r.captures.cacheHitSamples.map((x) => `| \`${x.requestId}\` | ${x.cacheStatus}/${x.cacheType} | ${cell(x.capturedPrompt || x.redactedPromptPreview, 100)} |`).join("\n") || "| - | - | - |";
  const maskRows = r.captures.maskingSamples.map((x) => `| \`${x.requestId}\` | ${x.maskingAction} | ${cell(x.capturedPrompt || x.redactedPromptPreview, 120)} |`).join("\n") || "| - | - | - |";
  return `# GateLM 단계별 시간 관측 1천건 테스트 보고서

작성 시각: ${r.generatedAt}

## 테스트 조건

| 항목 | 값 |
|---|---:|
| 전체 요청 수 | ${r.input.count} |
| Provider | ${r.input.provider} |
| 동시성 | ${r.input.concurrency} |
| 민감정보 포함 요청 | ${r.captures.sensitiveInputCount} |
| DB 로그 수집률 | ${percent(r.logs.coverage)} |
| requestId prefix | \`${r.requestPrefix}\` |

\`routingReason\`, \`difficulty\`, \`executionMode\`는 routing 관찰값이다. 실제 provider/model은 별도 \`providerAttempts\` 실행 관찰값으로만 기록한다.

## 핵심 결과

| 항목 | 결과 |
|---|---:|
| Category 정확도 | ${percent(r.routing.categoryAccuracy)} |
| 평균 client 왕복 시간 | ${r.timing.client.avgClientMs}ms |
| P95 client 왕복 시간 | ${r.timing.client.p95ClientMs}ms |
| 평균 gateway 내부 시간(provider 제외) | ${r.timing.client.avgGatewayWithoutProviderMs}ms |
| P95 gateway 내부 시간(provider 제외) | ${r.timing.client.p95GatewayWithoutProviderMs}ms |
| 평균 provider 대기 시간 | ${r.timing.client.avgProviderLatencyMs}ms |
| P95 provider 대기 시간 | ${r.timing.client.p95ProviderLatencyMs}ms |
| Exact cache hit | ${r.captures.exactCacheHitCount} |
| Prompt capture 저장 | ${r.captures.promptCaptureCount} |
| Response capture 저장 | ${r.captures.responseCaptureCount} |

## 룰 개수 구간별 결과

| 구간 | 요청 수 | stress rule total | category 정확도 | 평균 gateway 내부 시간(provider 제외) | P95 gateway 내부 시간(provider 제외) |
|---|---:|---:|---:|---:|---:|
${segmentRows}

## 단계별 평균 시간

| stage | 관측 요청 수 | 평균 durationMs | P95 durationMs | max durationMs |
|---|---:|---:|---:|---:|
${stageRows}

## 저장된 요청/응답 샘플

아래 prompt는 raw prompt가 아니라 Gateway가 저장한 \`promptCapture.capturedPrompt\` 값입니다. 즉 request-side masking 이후의 log-safe prompt입니다.

| requestId | cache | masking | stored prompt | stored provider response |
|---|---|---|---|---|
${capRows}

## Cache hit 샘플

| requestId | cache | stored prompt |
|---|---|---|
${hitRows}

## Masking 샘플

| requestId | masking | stored prompt 또는 redacted preview |
|---|---|---|
${maskRows}

## 해석

- OpenAI가 아니라 mock provider를 사용했으므로 1천건을 비용 없이 반복 요청했다.
- stage timing은 request log metadata의 \`stageTimings\`를 기준으로 평균을 냈다.
- \`provider_response_wait\`는 mock provider 왕복 시간이 포함된 구간이다.
- \`gateway 내부 시간(provider 제외)\`은 DB log의 \`latencyMs - providerLatencyMs\`로 계산했다.
- 2000/5000 룰 구간은 \`GATEWAY_ROUTING_RULE_STRESS_TOTAL\`로 synthetic never-match rule을 추가해 실제 Gateway 라우팅 단계에 부하를 준 값이다.
- 민감정보 포함 요청은 synthetic email/phone만 사용했고, 보고서에는 raw credential/API key/App token/provider key를 저장하지 않았다.

## JSON 원본

\`${jsonPath}\`
`;
}

function printSummary(r) { console.log("\nRESULT"); console.log(`category accuracy: ${percent(r.routing.categoryAccuracy)}`); console.log(`log coverage: ${percent(r.logs.coverage)} (${r.logs.actual}/${r.logs.expected})`); console.log(`avg gateway no provider: ${r.timing.client.avgGatewayWithoutProviderMs}ms`); console.log(`p95 gateway no provider: ${r.timing.client.p95GatewayWithoutProviderMs}ms`); console.log(`prompt captures: ${r.captures.promptCaptureCount}`); console.log(`response captures: ${r.captures.responseCaptureCount}`); console.log(`exact cache hits: ${r.captures.exactCacheHitCount}`); console.log(`report: ${path.join(r.input.reportDir, `${r.input.reportName || "보고서"}.md`)}`); }
function normalizeStageTimings(v) { if (!v || typeof v !== "object") return {}; return Object.fromEntries(Object.entries(v).map(([k, t]) => [k, { durationMs: round(Number(t?.durationMs || 0), 6), count: Number(t?.count || 0) }])); }
function meta(v) { if (!v) return {}; if (typeof v === "string") return json(v) || {}; return v; }
function dist(items, pick) { const m = {}; for (const x of items) { const k = String(pick(x) ?? "unknown"); m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b))); }
function avg(v) { const a = v.filter(Number.isFinite); return a.length ? round(a.reduce((s, x) => s + x, 0) / a.length) : 0; }
function pct(v, p) { const a = v.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return 0; return round(a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))]); }
function max(v) { const a = v.filter(Number.isFinite); return a.length ? round(Math.max(...a)) : 0; }
function ratio(a, b) { return b ? round(a / b, 6) : 0; }
function percent(v) { return `${(Number(v || 0) * 100).toFixed(2)}%`; }
function round(v, d = 3) { return Number(Number(v || 0).toFixed(d)); }
function first(...v) { for (const x of v) if (x !== undefined && x !== null && String(x).trim() !== "") return String(x).trim(); return ""; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function json(s) { try { return JSON.parse(s); } catch { return null; } }
function hash(s) { return `sha256:${crypto.createHash("sha256").update(s).digest("hex")}`; }
function safe(s) { return String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_UNMASKED_IN_REPORT]").replace(/010-\d{4}-\d{4}/g, "[PHONE_UNMASKED_IN_REPORT]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1[REDACTED]"); }
function cell(s, n) { const v = safe(s).replace(/\r?\n/g, " ").replace(/\|/g, "\\|"); return v.length > n ? `${v.slice(0, n)}...` : v; }
function env(k, f) { return process.env[k]?.trim() || f; }
function intEnv(k, f) { const n = Number.parseInt(process.env[k] || "", 10); return Number.isFinite(n) && n > 0 ? n : f; }
function ts() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function usage() { console.log("node scripts/dev/gateway-stage-timing-1k-evidence.mjs [--concurrency n] [--report-dir path] [--report-name name] [--skip-bootstrap]"); }

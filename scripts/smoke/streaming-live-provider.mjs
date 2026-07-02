#!/usr/bin/env node

const VALID_MODES = new Set(["mock", "live"]);

const HELP = `GateLM Gateway streaming 확인

사용법:
  node scripts/smoke/streaming-live-provider.mjs

필수 환경변수:
  GATELM_GATEWAY_URL              예: http://localhost:8080
  GATELM_DEMO_API_KEY 또는 GATELM_API_KEY
  GATELM_DEMO_APP_TOKEN 또는 GATELM_APP_TOKEN

선택 환경변수:
  GATELM_STREAM_SMOKE_MODE        mock 또는 live, 기본값 mock
  GATELM_STREAM_MODEL             기본값 auto
  GATELM_STREAM_PROMPT            기본 한국어 프롬프트 사용
  GATELM_STREAM_TIMEOUT_MS        기본값 30000

모드 설명:
  mock: 로컬 mock RuntimeSnapshot으로 Gateway가 실행 중일 때 비용 없이 SSE relay를 확인하는 안내를 출력합니다.
  live: 실제 Provider relay 확인용 안내를 출력합니다. Provider 비용이 발생할 수 있습니다.

주의:
  GATELM_STREAM_SMOKE_MODE는 출력과 주의 문구만 바꿉니다.
  실제 Provider 선택과 비용 발생 여부는 Gateway 서버의 RuntimeSnapshot과 provider 설정이 결정합니다.
  이 스크립트는 수동 smoke 전용이며 CI에서 실행하지 않습니다.
  API Key, App Token, Authorization header, Provider Key는 출력하지 않습니다.

Windows PowerShell에서 한글이 깨지면 참고:
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const mode = normalizeMode(process.env.GATELM_STREAM_SMOKE_MODE || "mock");
const gatewayUrl = trimTrailingSlash(requiredEnv("GATELM_GATEWAY_URL"));
const apiKey = envFirst("GATELM_DEMO_API_KEY", "GATELM_API_KEY");
const appToken = envFirst("GATELM_DEMO_APP_TOKEN", "GATELM_APP_TOKEN");
const model = process.env.GATELM_STREAM_MODEL?.trim() || "auto";
const prompt =
  process.env.GATELM_STREAM_PROMPT?.trim() || defaultPrompt(mode);
const timeoutMs = positiveInt(process.env.GATELM_STREAM_TIMEOUT_MS, 30_000);
const requestId = `manual_stream_${Date.now()}`;

if (!apiKey || !appToken) {
  console.error(
    "필수 인증 환경변수가 없습니다. GATELM_DEMO_API_KEY/GATELM_API_KEY와 GATELM_DEMO_APP_TOKEN/GATELM_APP_TOKEN을 설정해주세요.",
  );
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const startedAt = Date.now();
let firstChunkAt = null;
let chunkCount = 0;
let done = false;

try {
  console.log("GateLM Gateway streaming 확인");
  console.log(`모드: ${mode === "mock" ? "mock (비용 없는 로컬 검증용)" : "live (실제 Provider 검증용)"}`);
  console.log("주의: 실제 Provider 선택은 Gateway 서버 RuntimeSnapshot이 결정합니다.");
  if (mode === "mock") {
    console.log("mock 모드는 서버가 mock provider를 사용하도록 구성되어 있어야 비용 없이 확인됩니다.");
  } else {
    console.log("live 모드는 서버 구성에 따라 실제 Provider 비용이 발생할 수 있습니다.");
  }
  console.log(`대상: ${gatewayUrl}/v1/chat/completions`);
  console.log(`모델: ${model}`);
  console.log(`요청 ID: ${requestId}`);
  console.log("요청 전송 중...\n");

  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-GateLM-App-Token": appToken,
      "X-GateLM-Request-Id": requestId,
      "X-GateLM-End-User-Id": "manual_stream_smoke_user",
      "X-GateLM-Feature-Id": "manual_streaming_smoke",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 256,
      stream: true,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    const safeBody = await response.text();
    console.error(`요청 실패: HTTP ${response.status}`);
    console.error(safeBody);
    process.exit(1);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    console.error(`응답이 event-stream이 아닙니다: ${contentType}`);
    console.error(await response.text());
    process.exit(1);
  }

  console.log("스트리밍 수신 시작\n");
  await readSSE(response.body, handleData);

  const durationMs = Date.now() - startedAt;
  console.log("\n\n요약");
  console.log(`- chunk 수: ${chunkCount}`);
  console.log(`- 첫 chunk까지 걸린 시간: ${firstChunkAt === null ? "수신 없음" : `${firstChunkAt - startedAt}ms`}`);
  console.log(`- 전체 소요 시간: ${durationMs}ms`);
  console.log(`- 완료 여부: ${done ? "DONE 수신" : "DONE 미수신"}`);
} catch (error) {
  if (error?.name === "AbortError") {
    console.error(`요청 시간이 초과되었습니다: ${timeoutMs}ms`);
  } else {
    console.error(`스트리밍 확인 중 오류가 발생했습니다: ${error?.message || error}`);
  }
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

function handleData(data) {
  if (data === "[DONE]") {
    done = true;
    console.log("\n[DONE]");
    return;
  }

  chunkCount += 1;
  if (firstChunkAt === null) {
    firstChunkAt = Date.now();
    console.log(`첫 번째 chunk 수신: ${firstChunkAt - startedAt}ms\n`);
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    console.log(`[chunk ${chunkCount}] JSON 파싱 실패`);
    return;
  }

  const pieces = [];
  for (const choice of parsed.choices || []) {
    const content = choice?.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      pieces.push(content);
    }
  }

  if (pieces.length > 0) {
    process.stdout.write(pieces.join(""));
  }

  if (parsed.usage) {
    console.log(`\n[usage] total_tokens=${parsed.usage.total_tokens ?? "unknown"}`);
  }
}

async function readSSE(body, onData) {
  if (!body) {
    throw new Error("응답 body가 없습니다.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = drainEvents(buffer, onData);
  }

  buffer += decoder.decode();
  drainEvents(`${buffer}\n\n`, onData);
}

function drainEvents(buffer, onData) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events = normalized.split("\n\n");
  const remainder = events.pop() || "";
  for (const event of events) {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length > 0) {
      onData(dataLines.join("\n").trim());
    }
  }
  return remainder;
}

function normalizeMode(value) {
  const mode = value.trim().toLowerCase();
  if (!VALID_MODES.has(mode)) {
    console.error(`GATELM_STREAM_SMOKE_MODE는 mock 또는 live만 사용할 수 있습니다: ${value}`);
    process.exit(1);
  }
  return mode;
}

function defaultPrompt(mode) {
  if (mode === "mock") {
    return "GateLM의 로컬 mock Provider 스트리밍 응답이 어떻게 동작하는지 한국어로 짧게 설명해줘.";
  }
  return "GateLM의 실제 Provider 스트리밍 응답이 어떻게 동작하는지 한국어로 짧게 설명해줘.";
}

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`필수 환경변수가 없습니다: ${name}`);
    process.exit(1);
  }
  return value;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

#!/usr/bin/env node

const DEFAULT_CONTROL_PLANE_BASE_URL = "http://localhost:3001";
const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8080";
const DEFAULT_APPLICATION_ID = "00000000-0000-4000-8000-000000000300";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000100";
const DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000000200";
const DEFAULT_API_KEY = "glm_api_test_redacted";
const DEFAULT_APP_TOKEN = "glm_app_token_test_redacted";

const PROMPTS = {
  short:
    "다음 문장만 그대로 답해줘: Gemini Gateway 연결 확인 완료.",
  paragraph:
    "한국어로 크래프톤 정글에 대해 한 문단 이상으로 자세히 설명해줘. 교육 목표, 몰입형 학습 방식, 협업과 프로젝트 경험, 문제 해결을 통한 성장 포인트를 포함해 자연스럽게 작성해줘. 실시간 스트리밍 확인을 위해 너무 짧게 끝내지 말고 2~3개 문단 정도로 이어서 작성해줘.",
};

const options = parseArgs(process.argv.slice(2));

try {
  await main(options);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function main(opts) {
  if (opts.help) {
    printUsage();
    return;
  }

  validateOptions(opts);

  const requestId = `request_gemini_gateway_smoke_${timestampForRequestId()}`;
  const prompt =
    opts.prompt.trim() ||
    `${PROMPTS[opts.promptMode]} 검증 ID는 답변에 포함하지 마. 검증 ID: ${requestId}`;

  console.log("");
  console.log("GateLM Gemini Gateway smoke");
  console.log("===========================");
  console.log(`controlPlane: ${opts.controlPlaneBaseUrl}`);
  console.log(`gateway:      ${opts.gatewayBaseUrl}`);
  console.log(`application:  ${opts.applicationId}`);
  console.log(`requestId:    ${requestId}`);
  console.log(`stream:       ${opts.stream}`);
  console.log(`liveStream:   ${opts.liveStream}`);
  console.log(`promptMode:   ${opts.promptMode}`);
  console.log(`maxTokens:    ${opts.maxTokens}`);
  console.log("");

  if (!opts.skipControlPlaneCheck) {
    await assertGeminiControlPlaneConfig(opts);
    console.log("");
  }

  writeRawBlock("INPUT PROMPT", prompt, opts);

  const requestBody = {
    model: "auto",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: opts.maxTokens,
    stream: opts.stream,
  };

  const response = await fetch(joinUrl(opts.gatewayBaseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      "content-type": "application/json",
      "x-gatelm-app-token": opts.appToken,
      "x-gatelm-request-id": requestId,
      "x-gatelm-end-user-id": "user_gemini_gateway_smoke",
      "x-gatelm-feature-id": "gemini-gateway-smoke",
    },
    body: JSON.stringify(requestBody),
  });

  const routedProviderHeader = response.headers.get("x-gatelm-routed-provider") ?? "";
  const routedModelHeader = response.headers.get("x-gatelm-routed-model") ?? "";
  const cacheStatusHeader = response.headers.get("x-gatelm-cache-status") ?? "";
  const maskingActionHeader = response.headers.get("x-gatelm-masking-action") ?? "";
  const contentType = response.headers.get("content-type") ?? "";

  console.log(`HTTP status:     ${response.status}`);
  console.log(`Content-Type:    ${contentType}`);
  console.log(`Routed-Provider: ${routedProviderHeader}`);
  console.log(`Routed-Model:    ${routedModelHeader}`);
  console.log(`Cache-Status:    ${cacheStatusHeader}`);
  console.log(`Masking-Action:  ${maskingActionHeader}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.log("");
    console.log("GATEWAY SAFE ERROR");
    console.log(safeGatewayErrorSummary(errorText));
    throw new Error("Gateway chat completion failed");
  }

  assert(routedModelHeader.includes("gemini-"), `Gateway routed model is not Gemini: ${routedModelHeader}`);

  if (opts.stream) {
    await handleStreamingResponse(response, contentType, opts);
  } else {
    await handleJsonResponse(response, opts);
  }

  if (!opts.skipRequestDetailCheck) {
    await assertRequestDetail(opts, requestId);
  }

  console.log("");
  console.log("PASS: Gateway Gemini smoke succeeded");
}

async function assertGeminiControlPlaneConfig(opts) {
  const snapshotUrl = joinUrl(
    opts.controlPlaneBaseUrl,
    `/admin/v1/applications/${encodeURIComponent(opts.applicationId)}/runtime-snapshot/active`,
  );
  const snapshot = envelopeData(await fetchJson(snapshotUrl));
  const catalogId = String(snapshot?.providerCatalogRef?.catalogId ?? "").trim();
  assert(catalogId !== "", "active RuntimeSnapshot providerCatalogRef.catalogId is empty");

  const catalogUrl = joinUrl(
    opts.controlPlaneBaseUrl,
    `/admin/v1/provider-catalogs/${encodeURIComponent(catalogId)}`,
  );
  const catalog = envelopeData(await fetchJson(catalogUrl));
  const providers = toArray(catalog?.providers);
  const geminiProviders = providers.filter((provider) => {
    const models = toArray(provider?.models);
    return (
      provider?.enabled === true &&
      provider?.adapterType === "openai_compatible" &&
      String(provider?.baseUrl ?? "").includes("generativelanguage.googleapis.com") &&
      models.some((model) => String(model?.modelName ?? "").startsWith("gemini-"))
    );
  });

  assert(
    geminiProviders.length > 0,
    "active Provider Catalog does not contain an enabled Gemini OpenAI-compatible provider",
  );

  const provider = geminiProviders[0];
  const modelNames = toArray(provider.models)
    .map((model) => String(model?.modelName ?? ""))
    .filter((modelName) => modelName.startsWith("gemini-"));

  console.log(`controlPlane.providerName: ${provider.providerName}`);
  console.log(`controlPlane.adapterType:   ${provider.adapterType}`);
  console.log(`controlPlane.baseUrl:       ${provider.baseUrl}`);
  console.log(`controlPlane.models:        ${modelNames.join(", ")}`);
}

async function handleJsonResponse(response, opts) {
  const responseJson = await response.json();
  assert(responseJson != null, "Gateway response JSON is empty");

  const choices = toArray(responseJson.choices);
  const choice = choices[0];
  const message = choice?.message;
  const messageRole = message?.role ?? "";
  const messageContent = message?.content;
  const assistantText = assistantContentToText(messageContent);
  const finishReason = choice?.finish_reason ?? "";

  writeRawBlock("RAW ASSISTANT RESPONSE", assistantText, opts);

  assert(String(responseJson.model ?? "").includes("gemini-"), `response model is not Gemini: ${responseJson.model}`);
  assert(responseJson.gate_lm != null, "gate_lm metadata is missing");
  assert(responseJson.gate_lm.providerCalled === true, "Gateway did not call provider");
  assert(
    String(responseJson.gate_lm.selectedModel ?? "").includes("gemini-"),
    `gate_lm.selectedModel is not Gemini: ${responseJson.gate_lm.selectedModel}`,
  );
  assert(responseJson.gate_lm.domainOutcomes?.provider?.outcome === "success", "gate_lm provider outcome is not success");
  assert(responseJson.gate_lm.domainOutcomes?.fallback?.outcome !== "success", "fallback was used");

  console.log(`response.model:              ${responseJson.model}`);
  console.log(`gate_lm.selectedProvider:    ${responseJson.gate_lm.selectedProvider}`);
  console.log(`gate_lm.selectedModel:       ${responseJson.gate_lm.selectedModel}`);
  console.log(`gate_lm.provider.outcome:    ${responseJson.gate_lm.domainOutcomes?.provider?.outcome ?? ""}`);
  console.log(`gate_lm.fallback.outcome:    ${responseJson.gate_lm.domainOutcomes?.fallback?.outcome ?? ""}`);
  console.log(`response.choicesCount:       ${choices.length}`);
  console.log(`response.messageRole:        ${messageRole}`);
  console.log(`response.finishReason:       ${finishReason}`);
  console.log(`assistantContentChars:       ${assistantText.length}`);

  if (assistantText.trim() === "") {
    const contentType = messageContent == null ? "null" : typeof messageContent;
    const contentJson = messageContent == null ? "null" : JSON.stringify(messageContent);
    console.log(`debug.messageContentType:    ${contentType}`);
    console.log(`debug.messageContentJson:    ${contentJson}`);
  }

  assert(choices.length > 0, "Gateway response choices are empty");
  assert(assistantText.trim() !== "", "assistant content is empty");
}

async function handleStreamingResponse(response, contentType, opts) {
  assert(contentType.includes("text/event-stream"), "stream response is not text/event-stream");
  assert(response.body != null, "stream response body is empty");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventCount = 0;
  let chunkCount = 0;
  let finishReason = "";
  let finalText = "";
  let liveStreamStarted = false;
  const streamEventSamples = [];

  const handleData = (data) => {
    const payload = data.trim();
    if (payload === "" || payload === "[DONE]") {
      return;
    }

    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }

    eventCount += 1;
    const choices = toArray(chunk.choices);
    const choice = choices[0];
    const deltaObject = choice?.delta;
    const deltaText = assistantContentToText(deltaObject?.content);
    const chunkFinishReason = choice?.finish_reason ?? "";

    if (streamEventSamples.length < 5) {
      const deltaProps = deltaObject && typeof deltaObject === "object" ? Object.keys(deltaObject).join(",") : "";
      const hasExtraContent =
        deltaObject && typeof deltaObject === "object" && Object.hasOwn(deltaObject, "extra_content");
      let sample = `choices=${choices.length}; deltaProps=${deltaProps}; contentChars=${deltaText.length}; finishReason=${chunkFinishReason}; hasExtraContent=${hasExtraContent}`;
      if (deltaText !== "") {
        sample = `${sample}; content=${deltaText}`;
      }
      streamEventSamples.push(sample);
    }

    if (String(chunkFinishReason).trim() !== "") {
      finishReason = String(chunkFinishReason);
    }

    if (deltaText !== "") {
      chunkCount += 1;
      if (opts.liveStream && !opts.hideRawText) {
        if (!liveStreamStarted) {
          console.log("");
          console.log("================ LIVE STREAMED RESPONSE ================");
          liveStreamStarted = true;
        }
        process.stdout.write(deltaText);
      }
      finalText += deltaText;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith("data:")) {
        handleData(line.slice("data:".length));
      }
    }
  }

  const remaining = `${buffer}${decoder.decode()}`.trim();
  if (remaining.startsWith("data:")) {
    handleData(remaining.slice("data:".length));
  }

  if (opts.liveStream && !opts.hideRawText) {
    if (!liveStreamStarted) {
      console.log("");
      console.log("================ LIVE STREAMED RESPONSE ================");
      console.log("(empty)");
    } else {
      console.log("");
    }
    console.log("=======================================================");
  } else {
    writeRawBlock("RAW STREAMED RESPONSE", finalText, opts);
  }

  console.log(`streamEvents: ${eventCount}`);
  console.log(`streamChunks: ${chunkCount}`);
  console.log(`streamContentChars: ${finalText.length}`);
  console.log(`streamFinishReason: ${finishReason}`);
  if (opts.showStreamEvents || chunkCount === 0) {
    streamEventSamples.forEach((sample, index) => {
      console.log(`debug.streamEvent[${index}]: ${sample}`);
    });
  }

  assert(chunkCount > 0, "stream returned no content chunks");
}

async function assertRequestDetail(opts, requestId) {
  const detailUrl = `${joinUrl(opts.gatewayBaseUrl, `/api/llm-requests/${encodeURIComponent(requestId)}`)}?tenantId=${encodeURIComponent(opts.tenantId)}&projectId=${encodeURIComponent(opts.projectId)}`;
  let detail = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(detailUrl);
      if (response.ok) {
        detail = await response.json();
        break;
      }
    } catch {
      // Retry below.
    }
    await sleep(500);
  }

  assert(detail != null, "Request Detail was not found. Check Gateway SQL migrations and DATABASE_URL alignment.");
  const detailData = envelopeData(detail);
  assert(detailData?.requestId === requestId, "Request Detail requestId mismatch");
  assert(detailData?.domainOutcomes?.provider?.outcome === "success", "Request Detail provider outcome is not success");
  assert(detailData?.domainOutcomes?.fallback?.outcome !== "success", "Request Detail fallback was used");
  if (opts.stream) {
    assert(detailData?.domainOutcomes?.streaming?.outcome === "completed", "Request Detail streaming outcome is not completed");
  }

  console.log(`detail.terminalStatus:       ${detailData?.terminalStatus ?? ""}`);
  console.log(`detail.provider.outcome:     ${detailData?.domainOutcomes?.provider?.outcome ?? ""}`);
  console.log(`detail.fallback.outcome:     ${detailData?.domainOutcomes?.fallback?.outcome ?? ""}`);
  console.log(`detail.streaming.outcome:    ${detailData?.domainOutcomes?.streaming?.outcome ?? ""}`);
}

function parseArgs(argv) {
  const opts = {
    controlPlaneBaseUrl: envOrDefault("CONTROL_PLANE_BASE_URL", DEFAULT_CONTROL_PLANE_BASE_URL),
    gatewayBaseUrl: envOrDefault("GATEWAY_BASE_URL", DEFAULT_GATEWAY_BASE_URL),
    applicationId: envOrDefault("GATELM_DEMO_APPLICATION_ID", DEFAULT_APPLICATION_ID),
    tenantId: envOrDefault("GATELM_DEMO_TENANT_ID", DEFAULT_TENANT_ID),
    projectId: envOrDefault("GATELM_DEMO_PROJECT_ID", DEFAULT_PROJECT_ID),
    apiKey: envOrDefault("GATELM_DEMO_API_KEY", DEFAULT_API_KEY),
    appToken: envOrDefault("GATELM_DEMO_APP_TOKEN", DEFAULT_APP_TOKEN),
    prompt: "",
    promptMode: envOrDefault("GEMINI_GATEWAY_SMOKE_PROMPT_MODE", "short"),
    maxTokens: parseInteger(envOrDefault("GEMINI_GATEWAY_SMOKE_MAX_TOKENS", "1024"), "GEMINI_GATEWAY_SMOKE_MAX_TOKENS"),
    stream: false,
    liveStream: false,
    showStreamEvents: false,
    skipControlPlaneCheck: false,
    skipRequestDetailCheck: false,
    hideRawText: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--") {
      continue;
    }
    const [name, inlineValue] = splitInlineValue(current);
    const value = () => inlineValue ?? argv[++index];

    switch (name) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--control-plane-base-url":
        opts.controlPlaneBaseUrl = requireValue(name, value());
        break;
      case "--gateway-base-url":
        opts.gatewayBaseUrl = requireValue(name, value());
        break;
      case "--application-id":
        opts.applicationId = requireValue(name, value());
        break;
      case "--tenant-id":
        opts.tenantId = requireValue(name, value());
        break;
      case "--project-id":
        opts.projectId = requireValue(name, value());
        break;
      case "--api-key":
        opts.apiKey = requireValue(name, value());
        break;
      case "--app-token":
        opts.appToken = requireValue(name, value());
        break;
      case "--prompt":
      case "-Prompt":
        opts.prompt = requireValue(name, value());
        break;
      case "--prompt-mode":
      case "-PromptMode":
        opts.promptMode = requireValue(name, value());
        break;
      case "--max-tokens":
      case "-MaxTokens":
        opts.maxTokens = parseInteger(requireValue(name, value()), name);
        break;
      case "--stream":
      case "-Stream":
        opts.stream = true;
        break;
      case "--live":
      case "--live-stream":
      case "-LiveStream":
        opts.liveStream = true;
        opts.stream = true;
        break;
      case "--show-stream-events":
      case "-ShowStreamEvents":
        opts.showStreamEvents = true;
        break;
      case "--skip-control-plane-check":
      case "-SkipControlPlaneCheck":
        opts.skipControlPlaneCheck = true;
        break;
      case "--skip-request-detail-check":
      case "-SkipRequestDetailCheck":
        opts.skipRequestDetailCheck = true;
        break;
      case "--hide-raw-text":
      case "-HideRawText":
        opts.hideRawText = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return opts;
}

function validateOptions(opts) {
  if (!Object.hasOwn(PROMPTS, opts.promptMode)) {
    throw new Error(`prompt mode must be one of: ${Object.keys(PROMPTS).join(", ")}`);
  }
  if (!Number.isInteger(opts.maxTokens) || opts.maxTokens <= 0) {
    throw new Error("max tokens must be a positive integer");
  }
}

function printUsage() {
  console.log(`Usage:
  node scripts/dev/gemini-gateway-smoke.mjs [options]
  pnpm run v2:gemini:smoke -- [options]

Options:
  --stream                       Use Gateway streaming chat completions
  --live, --live-stream          Print streamed delta content as it arrives
  --prompt-mode short|paragraph  Select the built-in prompt (default: short)
  --max-tokens <number>          Set max_tokens (default: 1024)
  --show-stream-events           Print sanitized stream event summaries
  --hide-raw-text                Hide prompt and assistant text in terminal output

Environment:
  CONTROL_PLANE_BASE_URL, GATEWAY_BASE_URL
  GATELM_DEMO_APPLICATION_ID, GATELM_DEMO_TENANT_ID, GATELM_DEMO_PROJECT_ID
  GATELM_DEMO_API_KEY, GATELM_DEMO_APP_TOKEN
  GEMINI_GATEWAY_SMOKE_PROMPT_MODE, GEMINI_GATEWAY_SMOKE_MAX_TOKENS`);
}

function splitInlineValue(arg) {
  const equalIndex = arg.indexOf("=");
  if (equalIndex < 0 || !arg.startsWith("-")) {
    return [arg, undefined];
  }
  return [arg.slice(0, equalIndex), arg.slice(equalIndex + 1)];
}

function requireValue(name, value) {
  if (value == null || String(value).trim() === "") {
    throw new Error(`${name} requires a value`);
  }
  return String(value);
}

function parseInteger(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function envOrDefault(name, fallback) {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : value;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  return response.json();
}

function envelopeData(payload) {
  if (payload && typeof payload === "object" && Object.hasOwn(payload, "data")) {
    return payload.data;
  }
  return payload;
}

function toArray(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value.filter((item) => item != null) : [value];
}

function assistantContentToText(content) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(assistantContentToText).join("");
  }
  if (typeof content === "object") {
    if (Object.hasOwn(content, "text")) {
      return assistantContentToText(content.text);
    }
    if (Object.hasOwn(content, "content")) {
      return assistantContentToText(content.content);
    }
  }
  return String(content);
}

function writeRawBlock(title, text, opts) {
  if (opts.hideRawText) {
    return;
  }
  console.log("");
  console.log(`================ ${title} ================`);
  if (text === "") {
    console.log("(empty)");
  } else {
    console.log(text);
  }
  console.log("=".repeat(34 + title.length));
}

function safeGatewayErrorSummary(errorText) {
  try {
    const payload = JSON.parse(errorText);
    const error = payload?.error ?? payload;
    return JSON.stringify(
      {
        message: error?.message ?? "Gateway request failed.",
        type: error?.type ?? null,
        code: error?.code ?? null,
        request_id: error?.request_id ?? null,
      },
      null,
      2,
    );
  } catch {
    return "Gateway returned a non-JSON error body; body omitted.";
  }
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function timestampForRequestId() {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  console.error("");
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

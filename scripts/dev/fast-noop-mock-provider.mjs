#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";
import process from "node:process";

const options = parseArgs(process.argv.slice(2));
const statsHashSecret = Buffer.from(
  process.env.FAST_NOOP_MOCK_STATS_HASH_SECRET ||
    "fast_noop_mock_stats_hash_secret_for_local_evidence_only",
  "utf8",
);

const state = {
  calls: 0,
  config: {
    mode: "off",
    failModels: [],
  },
  data: {
    totalCalls: 0,
    callsByModel: {},
    lastCalls: [],
  },
};

const models = ["mock-fast", "mock-balanced", "mock-smart"];

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch {
    sendJSON(res, 500, { error: { code: "fast_noop_mock_internal_error" } });
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;
server.maxRequestsPerSocket = 0;

server.listen(options.port, options.host, () => {
  console.log(
    `fast-noop-mock-provider listening on http://${options.host}:${options.port}`,
  );
});

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJSON(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    sendJSON(res, 200, {
      object: "list",
      data: models.map((id) => ({ id, object: "model", owned_by: "mock" })),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/__mock/stats") {
    sendJSON(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/__mock/reset") {
    resetState();
    sendJSON(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/__mock/config") {
    const payload = await readJSON(req);
    if (!configureFailure(payload)) {
      sendJSON(res, 400, { error: { code: "invalid_mock_config" } });
      return;
    }
    sendJSON(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const payload = await readJSON(req);
    const model = normalizeModel(payload.model);
    if (shouldFailModel(model)) {
      if (state.config.mode === "timeout") {
        await sleep(options.timeoutDelayMs);
        sendJSON(res, 504, {
          error: { code: "provider_timeout", message: "Synthetic provider timeout." },
        });
        return;
      }
      sendJSON(res, 500, {
        error: { code: "provider_error", message: "Synthetic provider error." },
      });
      return;
    }

    if (options.defaultLatencyMs > 0) {
      await sleep(options.defaultLatencyMs);
    }
    recordCall(req.headers["x-gatelm-request-id"], model, payload.messages);

    if (payload.stream === true) {
      sendStream(res, model);
      return;
    }

    sendJSON(res, 200, {
      id: "fast_noop_mock_chatcmpl_local",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Fast no-op mock response.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    return;
  }

  sendJSON(res, 404, { error: { code: "not_found" } });
}

function parseArgs(args) {
  const parsed = {
    host: process.env.FAST_NOOP_MOCK_HOST || "127.0.0.1",
    port: Number(process.env.FAST_NOOP_MOCK_PORT || 8091),
    defaultLatencyMs: Number(
      process.env.FAST_NOOP_MOCK_DEFAULT_LATENCY_MS ||
        process.env.MOCK_PROVIDER_DEFAULT_LATENCY_MS ||
        0,
    ),
    timeoutDelayMs: Number(process.env.FAST_NOOP_MOCK_TIMEOUT_DELAY_MS || 60_000),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (index >= args.length) {
        throw new Error(`missing value for ${arg}`);
      }
      return args[index];
    };

    if (arg === "--host") {
      parsed.host = next();
    } else if (arg === "--port") {
      parsed.port = Number(next());
    } else if (arg === "--timeout-delay-ms") {
      parsed.timeoutDelayMs = Number(next());
    } else if (arg === "--default-latency-ms") {
      parsed.defaultLatencyMs = Number(next());
    } else if (arg === "--help") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535) {
    throw new Error(`invalid --port ${parsed.port}`);
  }
  if (!Number.isFinite(parsed.timeoutDelayMs) || parsed.timeoutDelayMs < 0) {
    throw new Error(`invalid --timeout-delay-ms ${parsed.timeoutDelayMs}`);
  }
  if (!Number.isFinite(parsed.defaultLatencyMs) || parsed.defaultLatencyMs < 0) {
    throw new Error(`invalid --default-latency-ms ${parsed.defaultLatencyMs}`);
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/dev/fast-noop-mock-provider.mjs [--host 127.0.0.1] [--port 8091] [--default-latency-ms 0]

Local fast/no-op OpenAI-compatible mock provider for Gateway logging evidence.

Endpoints:
  GET  /healthz
  GET  /v1/models
  POST /v1/chat/completions
  GET  /__mock/stats
  POST /__mock/reset
  POST /__mock/config
`);
}

async function readJSON(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendStream(res, model) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const created = Math.floor(Date.now() / 1000);
  const chunks = [
    {
      id: "fast_noop_mock_stream_local",
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "fast_noop_mock_stream_local",
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content: "Fast no-op mock response." },
          finish_reason: null,
        },
      ],
    },
    {
      id: "fast_noop_mock_stream_local",
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];

  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}

function normalizeModel(value) {
  const model = String(value || "mock-balanced").trim();
  return model || "mock-balanced";
}

function configureFailure(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const mode = String(payload.mode || "off").trim().toLowerCase();
  if (!["off", "error", "timeout"].includes(mode)) {
    return false;
  }

  const failModels = Array.isArray(payload.failModels)
    ? payload.failModels.map((model) => String(model).trim()).filter(Boolean)
    : [];

  state.config = { mode, failModels };
  return true;
}

function shouldFailModel(model) {
  if (state.config.mode === "off") {
    return false;
  }
  return state.config.failModels.length === 0 || state.config.failModels.includes(model);
}

function resetState() {
  state.calls = 0;
  state.data.totalCalls = 0;
  state.data.callsByModel = {};
  state.data.lastCalls = [];
}

function recordCall(requestId, model, messages) {
  state.calls += 1;
  state.data.totalCalls = state.calls;
  state.data.callsByModel[model] = (state.data.callsByModel[model] || 0) + 1;
  state.data.lastCalls.push({
    requestId: String(requestId || ""),
    model,
    promptHash: promptHash(messages),
    createdAt: new Date().toISOString(),
  });
  state.data.lastCalls = state.data.lastCalls.slice(-20);
}

function promptHash(messages) {
  const text = Array.isArray(messages)
    ? messages
        .map((message) =>
          message && typeof message === "object" ? String(message.content || "") : "",
        )
        .join("\n")
    : "";
  return (
    "hmac-sha256:" +
    crypto.createHmac("sha256", statsHashSecret).update(text).digest("hex")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import process from "node:process";
import { pathToFileURL } from "node:url";

const PROFILE_SCHEMA = "gatelm.prod-clone.mock-latency-profiles.v1";
const MAX_BODY_BYTES = 1_048_576;
const MAX_LATENCY_MS = 60_000;

export function loadLatencyProfile(profilePath, profileName, controlLatencyMs) {
  const document = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  if (document?.schemaVersion !== PROFILE_SCHEMA) {
    throw new Error(`unsupported latency profile schema: ${document?.schemaVersion}`);
  }
  const rawProfile = document.profiles?.[profileName];
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new Error(`unknown latency profile: ${profileName}`);
  }
  if (!["fixed", "cyclic"].includes(rawProfile.kind)) {
    throw new Error(`invalid latency profile kind: ${rawProfile.kind}`);
  }
  if (rawProfile.workload !== "nonstream") {
    throw new Error(
      "the production-clone shaper currently supports non-streaming profiles only",
    );
  }
  const source = validateSource(rawProfile.source);
  if (
    !Array.isArray(rawProfile.valuesMs) ||
    rawProfile.valuesMs.length === 0 ||
    rawProfile.valuesMs.length > 10_000
  ) {
    throw new Error(
      "latency profile valuesMs must contain between 1 and 10000 values",
    );
  }

  const valuesMs = rawProfile.valuesMs.map((value) => {
    if (!Number.isInteger(value) || value < 0 || value > MAX_LATENCY_MS) {
      throw new Error(
        `latency profile value must be an integer between 0 and ${MAX_LATENCY_MS}`,
      );
    }
    return value;
  });
  if (rawProfile.kind === "fixed" && valuesMs.length !== 1) {
    throw new Error("a fixed latency profile must contain exactly one value");
  }

  const summary = summarizeLatencies(valuesMs);
  validateSummary(rawProfile.summary, summary);
  if (profileName === "control_100ms" && valuesMs[0] !== controlLatencyMs) {
    throw new Error(
      `control profile value ${valuesMs[0]}ms does not match configured control latency ${controlLatencyMs}ms`,
    );
  }

  return Object.freeze({
    name: profileName,
    kind: rawProfile.kind,
    workload: rawProfile.workload,
    description: String(rawProfile.description || ""),
    sourceType: source.type,
    sourceApplicationSha: source.applicationSha,
    sourceSampleCount: source.sampleCount,
    valuesMs: Object.freeze(valuesMs),
    summary: Object.freeze(summary),
  });
}

function validateSource(rawSource) {
  if (!rawSource || typeof rawSource !== "object") {
    throw new Error("latency profile source metadata is required");
  }
  const type = String(rawSource.type || "");
  if (!["synthetic", "production_clone_observation"].includes(type)) {
    throw new Error(`unsupported latency profile source type: ${type}`);
  }
  const sampleCount = Number(rawSource.sampleCount);
  if (!Number.isInteger(sampleCount) || sampleCount < 0) {
    throw new Error("latency profile source sampleCount must be a non-negative integer");
  }
  if (type === "synthetic") {
    return { type, applicationSha: null, sampleCount };
  }
  const applicationSha = String(rawSource.applicationSha || "");
  if (!/^[a-f0-9]{40}$/.test(applicationSha)) {
    throw new Error(
      "latency profile source applicationSha must be a full lowercase Git SHA",
    );
  }
  if (sampleCount === 0) {
    throw new Error("an observed latency profile must include source samples");
  }
  return { type, applicationSha, sampleCount };
}

export function createLatencyScheduler(profile) {
  let cursor = 0;
  let assignedCalls = 0;

  return Object.freeze({
    next() {
      const latencyMs = profile.valuesMs[cursor];
      cursor = (cursor + 1) % profile.valuesMs.length;
      assignedCalls += 1;
      return latencyMs;
    },
    reset() {
      cursor = 0;
      assignedCalls = 0;
    },
    snapshot() {
      return {
        profile: profile.name,
        kind: profile.kind,
        workload: profile.workload,
        sourceType: profile.sourceType,
        sourceApplicationSha: profile.sourceApplicationSha,
        sourceSampleCount: profile.sourceSampleCount,
        sampleCount: profile.valuesMs.length,
        assignedCalls,
        cursor,
        summary: profile.summary,
      };
    },
  });
}

export function summarizeLatencies(valuesMs) {
  const sorted = [...valuesMs].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    averageMs: Number((sum / sorted.length).toFixed(2)),
    minMs: sorted[0],
    p50Ms: nearestRank(sorted, 0.5),
    p90Ms: nearestRank(sorted, 0.9),
    p95Ms: nearestRank(sorted, 0.95),
    p99Ms: nearestRank(sorted, 0.99),
    maxMs: sorted[sorted.length - 1],
  };
}

function nearestRank(sorted, percentile) {
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

function validateSummary(declared, actual) {
  if (!declared || typeof declared !== "object") {
    throw new Error("latency profile summary is required");
  }
  for (const [name, value] of Object.entries(actual)) {
    if (declared[name] !== value) {
      throw new Error(
        `latency profile summary mismatch for ${name}: expected ${value}, received ${declared[name]}`,
      );
    }
  }
}

async function startServer() {
  const options = runtimeOptions();
  const profile = loadLatencyProfile(
    options.profilePath,
    options.profileName,
    options.controlLatencyMs,
  );
  const scheduler = createLatencyScheduler(profile);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url || "/",
        `http://${request.headers.host || "localhost"}`,
      );

      if (request.method === "GET" && url.pathname === "/__mock/profile") {
        sendJSON(response, 200, { status: "ok", data: scheduler.snapshot() });
        return;
      }

      const body = await readBody(request);
      if (request.method === "POST" && url.pathname === "/__mock/reset") {
        scheduler.reset();
      }
      const latencyMs =
        request.method === "POST" && url.pathname === "/v1/chat/completions"
          ? scheduler.next()
          : 0;
      if (latencyMs > 0) {
        await sleep(latencyMs);
      }
      await proxyRequest(request, response, body, options.upstreamBaseUrl);
    } catch (error) {
      if (!response.headersSent) {
        const status = error?.code === "request_body_too_large" ? 413 : 502;
        sendJSON(response, status, {
          error: { code: status === 413 ? "request_body_too_large" : "latency_shaper_error" },
        });
      } else {
        response.destroy();
      }
    }
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 90_000;
  server.maxRequestsPerSocket = 0;
  server.listen(options.port, options.host, () => {
    const summary = profile.summary;
    console.log(
      `prod-clone mock latency shaper listening on http://${options.host}:${options.port}; profile=${profile.name}; sample_count=${summary.count}; p50_ms=${summary.p50Ms}; p95_ms=${summary.p95Ms}; max_ms=${summary.maxMs}`,
    );
  });
}

function runtimeOptions() {
  const host = process.env.PROD_CLONE_MOCK_SHAPER_HOST || "127.0.0.1";
  const port = integerEnv("PROD_CLONE_MOCK_SHAPER_PORT", 8090, 1, 65_535);
  const profileName = requiredEnv("PROD_CLONE_MOCK_SHAPER_PROFILE");
  const profilePath = requiredEnv("PROD_CLONE_MOCK_SHAPER_PROFILE_FILE");
  const controlLatencyMs = integerEnv(
    "PROD_CLONE_MOCK_SHAPER_CONTROL_LATENCY_MS",
    100,
    0,
    MAX_LATENCY_MS,
  );
  const upstreamBaseUrl = new URL(
    process.env.PROD_CLONE_MOCK_SHAPER_UPSTREAM_BASE_URL ||
      "http://mock-provider-upstream:8091",
  );
  if (
    upstreamBaseUrl.protocol !== "http:" ||
    upstreamBaseUrl.username ||
    upstreamBaseUrl.password ||
    upstreamBaseUrl.pathname !== "/" ||
    upstreamBaseUrl.search ||
    upstreamBaseUrl.hash
  ) {
    throw new Error(
      "Mock shaper upstream must be a plain HTTP origin without credentials or a path",
    );
  }
  return {
    host,
    port,
    profileName,
    profilePath,
    controlLatencyMs,
    upstreamBaseUrl,
  };
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function integerEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body too large");
      error.code = "request_body_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
}

function proxyRequest(request, response, body, upstreamBaseUrl) {
  return new Promise((resolve, reject) => {
    const headers = copyHeaders(request.headers, body.length);
    const upstreamRequest = http.request(
      {
        protocol: upstreamBaseUrl.protocol,
        hostname: upstreamBaseUrl.hostname,
        port: upstreamBaseUrl.port,
        method: request.method,
        path: request.url,
        headers,
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode || 502,
          copyResponseHeaders(upstreamResponse.headers),
        );
        upstreamResponse.pipe(response);
        upstreamResponse.on("end", resolve);
        upstreamResponse.on("error", reject);
      },
    );
    upstreamRequest.on("error", reject);
    if (body.length > 0) {
      upstreamRequest.write(body);
    }
    upstreamRequest.end();
  });
}

function copyHeaders(source, bodyLength) {
  const headers = {};
  for (const [name, value] of Object.entries(source)) {
    if (!isHopByHopHeader(name) && name.toLowerCase() !== "host") {
      headers[name] = value;
    }
  }
  if (bodyLength > 0) {
    headers["content-length"] = String(bodyLength);
  } else {
    delete headers["content-length"];
  }
  return headers;
}

function copyResponseHeaders(source) {
  const headers = {};
  for (const [name, value] of Object.entries(source)) {
    if (!isHopByHopHeader(name) && value !== undefined) {
      headers[name] = value;
    }
  }
  return headers;
}

function isHopByHopHeader(name) {
  return [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ].includes(name.toLowerCase());
}

function sendJSON(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMainModule() {
  return Boolean(
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
  );
}

if (isMainModule()) {
  startServer().catch((error) => {
    console.error(`prod-clone mock latency shaper failed: ${error.message}`);
    process.exit(1);
  });
}

#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("DEMO_WEBUI_HOST", "127.0.0.1")
PORT = int(os.environ.get("DEMO_WEBUI_PORT", "5174"))
GATEWAY_BASE_URL = os.environ.get("GATEWAY_BASE_URL", "http://localhost:8080").rstrip("/")
MOCK_PROVIDER_BASE_URL = os.environ.get("MOCK_PROVIDER_BASE_URL", "http://localhost:8090").rstrip("/")
PROJECT_ID = os.environ.get("GATELM_DEMO_PROJECT_ID", "00000000-0000-4000-8000-000000000200")


INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GateLM Day5 Demo</title>
  <style>
    :root {
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-2: #f1f4f8;
      --text: #172033;
      --muted: #657086;
      --border: #d8dee9;
      --accent: #246bfe;
      --accent-soft: #e7efff;
      --ok: #10845f;
      --warn: #a56300;
      --bad: #bd2c2c;
      --shadow: 0 14px 36px rgba(23, 32, 51, 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }

    button, input {
      font: inherit;
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 284px minmax(0, 1fr);
    }

    aside {
      background: #101828;
      color: #eef3ff;
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 22px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 750;
      font-size: 18px;
      letter-spacing: 0;
    }

    .mark {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #eaf1ff;
      color: #101828;
      display: grid;
      place-items: center;
      font-weight: 850;
    }

    .side-note {
      color: #aab6cc;
      font-size: 13px;
      line-height: 1.45;
    }

    .config {
      display: grid;
      gap: 12px;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: #aab6cc;
    }

    input {
      width: 100%;
      min-width: 0;
      color: #f7f8fb;
      background: #172033;
      border: 1px solid #344054;
      border-radius: 8px;
      padding: 9px 10px;
      font-size: 13px;
    }

    .primary {
      border: 0;
      border-radius: 8px;
      padding: 11px 14px;
      background: var(--accent);
      color: white;
      font-weight: 700;
      cursor: pointer;
    }

    .secondary {
      border: 1px solid #344054;
      border-radius: 8px;
      padding: 10px 13px;
      background: #1d2939;
      color: #eef3ff;
      font-weight: 650;
      cursor: pointer;
    }

    main {
      padding: 22px;
      display: grid;
      gap: 18px;
      align-content: start;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.15;
      letter-spacing: 0;
    }

    .sub {
      margin-top: 6px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }

    .status {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 28px;
      padding: 5px 9px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
    }

    .dot.ok { background: var(--ok); }
    .dot.bad { background: var(--bad); }
    .dot.warn { background: var(--warn); }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
      gap: 18px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .panel-head {
      padding: 15px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }

    .panel-title {
      font-size: 14px;
      font-weight: 760;
    }

    .panel-body {
      padding: 14px 16px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      color: var(--muted);
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    td {
      padding: 12px 8px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      vertical-align: top;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .case-name {
      font-weight: 700;
    }

    .muted {
      color: var(--muted);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: var(--panel-2);
      color: var(--muted);
    }

    .badge.ok {
      background: #e8f7f1;
      color: var(--ok);
    }

    .badge.bad {
      background: #fdecec;
      color: var(--bad);
    }

    .badge.warn {
      background: #fff4df;
      color: var(--warn);
    }

    .request-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #344054;
      word-break: break-all;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .metric {
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }

    .metric .label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .metric .value {
      margin-top: 7px;
      font-size: 24px;
      font-weight: 780;
      letter-spacing: 0;
    }

    .detail {
      display: grid;
      gap: 12px;
    }

    .summary-table td:first-child {
      color: var(--muted);
      font-weight: 650;
      width: 190px;
    }

    .summary-table td:last-child {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      word-break: break-word;
    }

    .detail-table td:first-child {
      color: var(--muted);
      font-weight: 650;
      width: 150px;
      white-space: nowrap;
    }

    .detail-table td:last-child {
      word-break: break-word;
    }

    .error-line {
      color: var(--bad);
      font-size: 13px;
      font-weight: 650;
    }

    .kv {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr);
      gap: 10px;
      font-size: 13px;
      align-items: start;
    }

    .kv .key {
      color: var(--muted);
      font-weight: 650;
    }

    pre {
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0b1220;
      color: #dbe7ff;
      overflow: auto;
      max-height: 260px;
      font-size: 12px;
      line-height: 1.45;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .tiny-button {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 7px;
      padding: 6px 8px;
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
    }

    @media (max-width: 980px) {
      .shell {
        grid-template-columns: 1fr;
      }

      aside {
        position: static;
      }

      .grid, .cards {
        grid-template-columns: 1fr;
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .status {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand"><div class="mark">G</div><div>GateLM Day5</div></div>
      <div class="side-note">Disposable local demo UI. It calls only the existing Gateway APIs through this dev server proxy.</div>
      <div class="config">
        <label>API Key
          <input id="apiKey" value="glm_api_test_redacted" autocomplete="off">
        </label>
        <label>App Token
          <input id="appToken" value="glm_app_token_test_redacted" autocomplete="off">
        </label>
        <label>End User ID
          <input id="endUserId" value="user_demo_001" autocomplete="off">
        </label>
        <label>Project ID
          <input id="projectId" value="__PROJECT_ID__" autocomplete="off" maxlength="36">
        </label>
      </div>
      <button class="primary" id="runAll">Run Day5 Flow</button>
      <button class="secondary" id="refreshDashboard">Refresh Dashboard</button>
      <div class="side-note">Remove this by deleting <code>scripts/dev/p0-day5-demo-webui.py</code>.</div>
    </aside>
    <main>
      <div class="topbar">
        <div>
          <h1>Gateway demo trace</h1>
          <div class="sub">Run the P0 sequence, then inspect request logs, detail, routing, cache, masking, and dashboard totals.</div>
        </div>
        <div class="status">
          <span class="chip"><span id="gatewayDot" class="dot"></span>Gateway <span id="gatewayState">unknown</span></span>
          <span class="chip"><span id="mockDot" class="dot"></span>Mock <span id="mockState">unknown</span></span>
        </div>
      </div>

      <section class="cards">
        <div class="metric"><div class="label">Total Requests</div><div id="totalRequests" class="value">-</div></div>
        <div class="metric"><div class="label">Successful</div><div id="successfulRequests" class="value">-</div></div>
        <div class="metric"><div class="label">Blocked</div><div id="blockedRequests" class="value">-</div></div>
        <div class="metric"><div class="label">Cache Hits</div><div id="cacheHitRequests" class="value">-</div></div>
      </section>

      <div class="grid">
        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Day5 scenarios</div>
            <div id="runState" class="muted">Ready</div>
          </div>
          <div class="panel-body">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Status</th>
                  <th>Cache</th>
                  <th>Request ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="caseRows"></tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Request detail</div>
            <div class="actions">
              <button class="tiny-button" id="clearDetail">Clear</button>
            </div>
          </div>
          <div class="panel-body detail" id="detailPanel">
            <div class="muted">Select a completed scenario.</div>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">Run summary</div>
          <div class="muted" id="rangeText"></div>
        </div>
        <div class="panel-body" id="summaryPanel">
          <div class="muted">Run the Day5 flow to see request IDs and dashboard totals.</div>
        </div>
      </section>
    </main>
  </div>

  <script>
    const state = {
      runId: String(Date.now()),
      fromIso: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      toIso: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      cases: [
        { key: "safe", label: "Safe request", feature: "day5-safe-demo", expectedStatus: 200, prompt: () => `Summarize this week campaign performance for day5 web demo ${state.runId}.` },
        { key: "cache", label: "Cache repeat", feature: "day5-cache-demo", expectedStatus: 200, prompt: () => `Summarize this week campaign performance for day5 web demo ${state.runId}.` },
        { key: "routing", label: "Auto routing", feature: "day5-routing-demo", expectedStatus: 200, prompt: () => `Give one short campaign insight for day5 web routing ${state.runId}.` },
        { key: "redaction", label: "Redaction", feature: "day5-redaction-demo", expectedStatus: 200, prompt: () => `Draft a follow-up note for customer-${state.runId}@example.test and call 010-0000-1234.` },
        { key: "block", label: "Block", feature: "day5-block-demo", expectedStatus: 403, prompt: () => `This message contains a synthetic credential marker: api_key=test_secret_token_redacted_for_demo_only_${state.runId}` }
      ],
      results: {}
    };

    const el = (id) => document.getElementById(id);

    function config() {
      const values = {
        apiKey: el("apiKey").value.trim(),
        appToken: el("appToken").value.trim(),
        endUserId: el("endUserId").value.trim(),
        projectId: el("projectId").value.trim()
      };
      if (!isUuid(values.projectId)) {
        throw new Error(`Project ID must be a UUID. Current value: ${values.projectId || "(empty)"}`);
      }
      return values;
    }

    function isUuid(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    }

    function showError(value) {
      el("summaryPanel").innerHTML = `<div class="error-line">${escapeHtml(value)}</div>`;
    }

    function renderSummary(totals = null) {
      const rows = [
        ["Run ID", state.runId],
        ["Safe request", state.results.safe?.requestId || "-"],
        ["Cache hit request", state.results.cache?.requestId || "-"],
        ["Routing request", state.results.routing?.requestId || "-"],
        ["Redaction request", state.results.redaction?.requestId || "-"],
        ["Blocked request", state.results.block?.requestId || "-"]
      ];
      const dashboardRows = totals ? [
        ["Total requests", totals.totalRequests ?? "-"],
        ["Successful requests", totals.successfulRequests ?? "-"],
        ["Blocked requests", totals.blockedRequests ?? "-"],
        ["Cache hit requests", totals.cacheHitRequests ?? "-"],
        ["Total tokens", totals.totalTokens ?? "-"],
        ["Total cost", totals.totalCostUsd ?? "-"],
        ["Average latency ms", totals.averageResponseTimeMs ?? "-"]
      ] : [];

      el("summaryPanel").innerHTML = `
        <table class="summary-table">
          <tbody>
            ${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join("")}
          </tbody>
        </table>
        ${dashboardRows.length ? `
          <table class="summary-table" style="margin-top:14px">
            <tbody>
              ${dashboardRows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join("")}
            </tbody>
          </table>
        ` : ""}
      `;
    }

    function setServiceState(kind, ok, text) {
      const dot = el(kind + "Dot");
      const label = el(kind + "State");
      dot.className = "dot " + (ok ? "ok" : "bad");
      label.textContent = text;
    }

    function badge(text, kind) {
      const cls = kind ? `badge ${kind}` : "badge";
      return `<span class="${cls}">${escapeHtml(text)}</span>`;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function valueOrDash(value) {
      return value === null || value === undefined || value === "" ? "-" : value;
    }

    function plainCell(value) {
      return escapeHtml(valueOrDash(value));
    }

    function joinOrNone(values) {
      return Array.isArray(values) && values.length ? values.join(", ") : "none";
    }

    function renderDetailTable(rows) {
      return `<table class="detail-table"><tbody>${
        rows.map(([key, valueHtml]) => `<tr><td>${escapeHtml(key)}</td><td>${valueHtml}</td></tr>`).join("")
      }</tbody></table>`;
    }

    function renderCases() {
      el("caseRows").innerHTML = state.cases.map((item) => {
        const result = state.results[item.key];
        const statusText = result ? String(result.httpStatus) + " / " + result.logStatus : "pending";
        const statusKind = result ? (result.ok ? "ok" : "bad") : "";
        const cacheText = result ? result.cacheStatus : "-";
        const requestId = result ? result.requestId : "";
        return `<tr>
          <td><div class="case-name">${escapeHtml(item.label)}</div><div class="muted">${escapeHtml(item.feature)}</div></td>
          <td>${badge(statusText, statusKind)}</td>
          <td>${badge(cacheText, cacheText === "hit" ? "ok" : cacheText === "bypass" ? "warn" : "")}</td>
          <td><div class="request-id">${escapeHtml(requestId || "-")}</div></td>
          <td>${requestId ? `<button class="tiny-button" data-detail="${escapeHtml(requestId)}">Detail</button>` : ""}</td>
        </tr>`;
      }).join("");

      document.querySelectorAll("[data-detail]").forEach((button) => {
        button.addEventListener("click", () => loadDetail(button.dataset.detail));
      });
    }

    async function httpJson(path, options = {}) {
      const response = await fetch(path, options);
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { raw: text };
        }
      }
      return { response, body, text };
    }

    async function checkHealth() {
      try {
        const gateway = await httpJson("/gateway/healthz");
        setServiceState("gateway", gateway.response.ok, gateway.response.ok ? "ready" : "error");
      } catch {
        setServiceState("gateway", false, "down");
      }

      try {
        const mock = await httpJson("/mock/healthz");
        setServiceState("mock", mock.response.ok, mock.response.ok ? "ready" : "error");
      } catch {
        setServiceState("mock", false, "down");
      }
    }

    async function resetMockStats() {
      await httpJson("/mock/__mock/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
    }

    async function callGateway(item) {
      const cfg = config();
      const body = {
        model: "auto",
        messages: [{ role: "user", content: item.prompt() }],
        temperature: 0.2,
        max_tokens: 128,
        stream: false
      };
      return httpJson("/gateway/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cfg.apiKey}`,
          "X-GateLM-App-Token": cfg.appToken,
          "X-GateLM-End-User-Id": cfg.endUserId,
          "X-GateLM-Feature-Id": item.feature
        },
        body: JSON.stringify(body)
      });
    }

    function requestIdFrom(result) {
      return result.response.headers.get("X-GateLM-Request-Id") ||
        result.body?.gate_lm?.requestId ||
        result.body?.error?.request_id ||
        "";
    }

    async function projectLogs(requestId) {
      const cfg = config();
      const params = new URLSearchParams({
        from: state.fromIso,
        to: state.toIso,
        limit: "20",
        requestId
      });
      const result = await httpJson(`/gateway/api/projects/${encodeURIComponent(cfg.projectId)}/logs?${params.toString()}`);
      if (!result.response.ok) {
        throw new Error(`logs HTTP ${result.response.status}`);
      }
      return result.body.data?.[0] || null;
    }

    async function requestDetail(requestId) {
      const result = await httpJson(`/gateway/api/llm-requests/${encodeURIComponent(requestId)}`);
      if (!result.response.ok) {
        throw new Error(`detail HTTP ${result.response.status}`);
      }
      return result.body.data;
    }

    async function dashboard() {
      const cfg = config();
      const params = new URLSearchParams({
        projectId: cfg.projectId,
        from: state.fromIso,
        to: state.toIso
      });
      const result = await httpJson(`/gateway/api/dashboard/overview?${params.toString()}`);
      if (!result.response.ok) {
        throw new Error(`dashboard HTTP ${result.response.status}`);
      }
      return result.body.data.totals;
    }

    async function runAll() {
      el("runAll").disabled = true;
      el("runState").textContent = "Running...";
      state.runId = String(Date.now());
      state.fromIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      state.toIso = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      state.results = {};
      renderCases();
      renderSummary();
      el("rangeText").textContent = `${state.fromIso} -> ${state.toIso}`;

      try {
        await resetMockStats();
        for (const item of state.cases) {
          const gatewayResult = await callGateway(item);
          const requestId = requestIdFrom(gatewayResult);
          if (!requestId) {
            throw new Error(`${item.label} missing requestId`);
          }
          const detail = await waitForDetail(requestId);
          const log = await projectLogs(requestId);
          const cacheStatus = detail.cache?.cacheStatus || log?.cacheStatus || gatewayResult.response.headers.get("X-GateLM-Cache-Status") || "";
          const logStatus = detail.status || log?.status || "";
          const ok = gatewayResult.response.status === item.expectedStatus;
          state.results[item.key] = {
            ok,
            httpStatus: gatewayResult.response.status,
            logStatus,
            cacheStatus,
            requestId,
            detail
          };
          renderCases();
        }
        const totals = await refreshDashboard();
        renderSummary(totals);
        el("runState").textContent = "Completed";
      } catch (error) {
        showError(String(error.message || error));
        el("runState").textContent = "Failed";
      } finally {
        el("runAll").disabled = false;
      }
    }

    async function waitForDetail(requestId) {
      let lastError = null;
      for (let i = 0; i < 10; i++) {
        try {
          return await requestDetail(requestId);
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      throw lastError || new Error("detail unavailable");
    }

    async function refreshDashboard() {
      const totals = await dashboard();
      el("totalRequests").textContent = totals.totalRequests ?? "-";
      el("successfulRequests").textContent = totals.successfulRequests ?? "-";
      el("blockedRequests").textContent = totals.blockedRequests ?? "-";
      el("cacheHitRequests").textContent = totals.cacheHitRequests ?? "-";
      return totals;
    }

    async function loadDetail(requestId) {
      const detail = await requestDetail(requestId);
      const statusKind = detail.status === "blocked" ? "bad" : detail.status === "error" ? "bad" : "ok";
      const rows = [
        ["Request ID", `<span class="request-id">${escapeHtml(detail.requestId)}</span>`],
        ["Status", `${badge(detail.status, statusKind)} ${badge(String(detail.httpStatus))}`],
        ["Provider", plainCell(detail.provider)],
        ["Requested model", plainCell(detail.requestedModel)],
        ["Selected model", plainCell(detail.selectedModel)],
        ["Cache", `${plainCell(detail.cache?.cacheStatus)} / ${plainCell(detail.cache?.cacheType)}`],
        ["Cache hit source", plainCell(detail.cache?.cacheHitRequestId)],
        ["Routing reason", plainCell(detail.routing?.routingReason)],
        ["Routing rule", plainCell(detail.routing?.routingRuleId)],
        ["Usage", `${plainCell(detail.usage?.promptTokens)} prompt / ${plainCell(detail.usage?.completionTokens)} completion / ${plainCell(detail.usage?.totalTokens)} total`],
        ["Cost", `${plainCell(detail.cost?.costUsd)} ${plainCell(detail.cost?.currency)}`],
        ["Latency", `${plainCell(detail.latency?.latencyMs)} ms / provider ${plainCell(detail.latency?.providerLatencyMs)} ms`],
        ["Masking action", plainCell(detail.masking?.maskingAction)],
        ["Detected types", plainCell(joinOrNone(detail.masking?.maskingDetectedTypes))],
        ["Redacted preview", plainCell(detail.masking?.redactedPromptPreview)],
        ["Error", `${plainCell(detail.error?.errorCode)} / ${plainCell(detail.error?.errorStage)}`],
        ["Created at", plainCell(detail.createdAt)],
        ["Completed at", plainCell(detail.completedAt)]
      ];
      el("detailPanel").innerHTML = renderDetailTable(rows);
    }

    el("runAll").addEventListener("click", runAll);
    el("refreshDashboard").addEventListener("click", () => refreshDashboard().then((totals) => renderSummary(totals)).catch((error) => showError(String(error.message || error))));
    el("clearDetail").addEventListener("click", () => {
      el("detailPanel").innerHTML = '<div class="muted">Select a completed scenario.</div>';
    });

    renderCases();
    el("rangeText").textContent = `${state.fromIso} -> ${state.toIso}`;
    checkHealth();
  </script>
</body>
</html>
"""


def proxy_request(handler, base_url, prefix):
    target_path = handler.path[len(prefix):]
    if not target_path.startswith("/"):
        target_path = "/" + target_path
    target_url = base_url + target_path
    body = None
    if handler.command in {"POST", "PUT", "PATCH"}:
        length = int(handler.headers.get("Content-Length", "0"))
        body = handler.rfile.read(length) if length > 0 else b""

    headers = {}
    for key in ["Content-Type", "Authorization", "X-GateLM-App-Token", "X-GateLM-End-User-Id", "X-GateLM-Feature-Id"]:
        value = handler.headers.get(key)
        if value:
            headers[key] = value

    request = urllib.request.Request(target_url, data=body, method=handler.command, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = response.read()
            handler.send_response(response.status)
            copy_response_headers(handler, response)
            handler.send_header("Content-Length", str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
    except urllib.error.HTTPError as error:
        payload = error.read()
        handler.send_response(error.code)
        copy_response_headers(handler, error)
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
    except Exception as error:
        payload = json.dumps({"error": str(error)}).encode("utf-8")
        handler.send_response(502)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)


def copy_response_headers(handler, response):
    skip = {"transfer-encoding", "connection", "content-encoding", "content-length"}
    for key, value in response.headers.items():
        if key.lower() in skip:
            continue
        handler.send_header(key, value)


class DemoHandler(BaseHTTPRequestHandler):
    server_version = "GateLMDemoWebUI/0.1"

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            self.send_index()
            return
        if self.path.startswith("/gateway/"):
            proxy_request(self, GATEWAY_BASE_URL, "/gateway")
            return
        if self.path.startswith("/mock/"):
            proxy_request(self, MOCK_PROVIDER_BASE_URL, "/mock")
            return
        self.send_error(404)

    def do_POST(self):
        if self.path.startswith("/gateway/"):
            proxy_request(self, GATEWAY_BASE_URL, "/gateway")
            return
        if self.path.startswith("/mock/"):
            proxy_request(self, MOCK_PROVIDER_BASE_URL, "/mock")
            return
        self.send_error(404)

    def send_index(self):
        html = INDEX_HTML.replace("__PROJECT_ID__", PROJECT_ID)
        payload = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


def main():
    server = ThreadingHTTPServer((HOST, PORT), DemoHandler)
    print("GateLM Day5 demo Web UI")
    print(f"  URL: http://{HOST}:{PORT}")
    print(f"  Gateway: {GATEWAY_BASE_URL}")
    print(f"  Mock provider: {MOCK_PROVIDER_BASE_URL}")
    print("  Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

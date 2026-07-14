const gatewayBaseUrl = "http://gateway-core:8080";
const apiKey = requiredEnv("GATELM_DEMO_API_KEY");
const appToken = requiredEnv("GATELM_DEMO_APP_TOKEN");
const observabilityToken = requiredEnv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN");
const tenantId = requiredEnv("GATELM_DEMO_TENANT_ID");
const projectId = requiredEnv("GATELM_DEMO_PROJECT_ID");
const requestId = `request_perf_preflight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const chatResponse = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-GateLM-App-Token": appToken,
    "X-GateLM-End-User-Id": "perf_preflight",
    "X-GateLM-Feature-Id": "mock_routing_preflight",
    "X-GateLM-Request-Id": requestId,
  },
  body: JSON.stringify({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `GateLM isolated Mock performance preflight ${requestId}.`,
      },
    ],
    max_tokens: 16,
    stream: false,
  }),
});

if (chatResponse.status !== 200) {
  throw new Error(`Gateway preflight returned HTTP ${chatResponse.status}.`);
}

const chatBody = await safeJson(chatResponse);
const metadata = chatBody.gate_lm ?? {};
assertEqual(metadata.requestId, requestId, "response requestId");
assertMockModelRef(metadata.modelRef, "response modelRef");
assertEqual(metadata.providerCalled, true, "response providerCalled");

const detail = await waitForRequestDetail(requestId);
assertEqual(detail.terminalStatus, "success", "detail terminalStatus");
assertEqual(detail.providerCalled, true, "detail providerCalled");
assertMockModelRef(detail.routing?.modelRef, "detail modelRef");
assertEqual(detail.domainOutcomes?.provider?.outcome, "success", "provider outcome");
assertEqual(detail.domainOutcomes?.fallback?.outcome, "not_needed", "fallback outcome");

if (!detail.runtimeSnapshot?.runtimeSnapshotId) {
  throw new Error("Request Detail did not include RuntimeSnapshot provenance.");
}
assertRuntimeState(detail.runtimeSnapshot.runtimeState);

console.log(
  `PREFLIGHT_OK modelRef=${metadata.modelRef} ` +
    `runtimeState=${detail.runtimeSnapshot.runtimeState}`,
);

async function waitForRequestDetail(id) {
  const query = new URLSearchParams({ tenantId, projectId });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `${gatewayBaseUrl}/api/llm-requests/${encodeURIComponent(id)}?${query}`,
      {
        headers: {
          "X-GateLM-Observability-Token": observabilityToken,
        },
      },
    );
    if (response.status === 200) {
      const body = await safeJson(response);
      if (body.data) {
        return body.data;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Request Detail was not available within 15 seconds.");
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`Expected a JSON response for HTTP ${response.status}.`);
  }
}

function requiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}.`);
  }
}

function assertMockModelRef(value, label) {
  const catalogModel =
    typeof value === "string" ? value.split(":").at(-1) ?? "" : "";
  if (!catalogModel.startsWith("mock-")) {
    throw new Error(`${label} must use the mock-* catalog.`);
  }
}

function assertRuntimeState(value) {
  if (!["snapshot_active", "stale_snapshot_used"].includes(value)) {
    throw new Error(
      "runtime state must be snapshot_active or stale_snapshot_used.",
    );
  }
}

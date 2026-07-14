import { createServer } from "node:http";

const tenantId = "00000000-0000-4000-8000-000000000100";
const otherTenantId = "00000000-0000-4000-8000-000000000101";
const projectId = "00000000-0000-4000-8000-000000000200";
const originalKeyId = "00000000-0000-4000-8000-000000000400";
const issuedKeyId = "00000000-0000-4000-8000-000000000401";
const rotatedKeyId = "00000000-0000-4000-8000-000000000402";
const port = Number(process.env.API_KEY_E2E_CONTROL_PLANE_PORT ?? "3901");

let keys = [keyRecord(originalKeyId, "Production Gateway", "A1B2")];

createServer((request, response) => void handleRequest(request, response))
  .listen(port, "127.0.0.1");

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return json(response, 200, { status: "ok" });
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return json(response, 200, {
      data: {
        memberships: [{ role: "tenant_admin", status: "active", tenantId }],
        projectAdmins: [],
        tenant: { id: tenantId, name: "Acme" },
        user: { displayName: "Admin", id: "user-api-key-e2e", role: "tenant_admin" }
      }
    });
  }

  if (request.method === "GET" && url.pathname === `/admin/v1/tenants/${otherTenantId}/projects`) {
    return json(response, 403, { message: "Control Plane resource is outside admin scope." });
  }

  if (request.method === "GET" && url.pathname === `/admin/v1/tenants/${tenantId}/projects`) {
    return json(response, 200, { data: [projectRecord()] });
  }

  if (request.method === "GET" && url.pathname === `/admin/v1/projects/${projectId}/api-keys`) {
    return json(response, 200, { data: keys });
  }

  if (request.method === "POST" && url.pathname === `/admin/v1/projects/${projectId}/api-keys`) {
    const body = await readJson(request);
    const key = keyRecord(issuedKeyId, String(body.displayName), "C3D4");
    keys.unshift(key);
    return json(response, 201, { data: oneTimeKey(key, "one-time-issued-placeholder") });
  }

  if (request.method === "POST" && url.pathname === `/admin/v1/api-keys/${issuedKeyId}/rotate`) {
    keys = keys.map((key) => key.credentialId === issuedKeyId ? { ...key, status: "revoked" } : key);
    const replacement = keyRecord(rotatedKeyId, "Developer Integration", "E5F6");
    keys.unshift(replacement);
    return json(response, 200, { data: oneTimeKey(replacement, "one-time-rotated-placeholder") });
  }

  if (request.method === "POST" && url.pathname === `/admin/v1/api-keys/${rotatedKeyId}/revoke`) {
    keys = keys.map((key) => key.credentialId === rotatedKeyId ? { ...key, status: "revoked" } : key);
    return json(response, 200, {
      data: {
        credentialId: rotatedKeyId,
        revokedAt: "2026-07-13T03:00:00.000Z",
        status: "revoked"
      }
    });
  }

  return json(response, 404, { message: `${request.method} ${url.pathname} not mocked` });
}

function projectRecord() {
  return {
    createdAt: "2026-07-01T00:00:00.000Z",
    description: "Customer-facing chat",
    id: projectId,
    name: "Customer Chat",
    runtimeApplicationId: "00000000-0000-4000-8000-000000000300",
    status: "ACTIVE",
    tenantId,
    totalBudgetUsd: 100,
    updatedAt: "2026-07-13T00:00:00.000Z",
    warningThresholdPercent: 80
  };
}

function keyRecord(credentialId, displayName, last4) {
  return {
    createdAt: "2026-07-13T00:00:00.000Z",
    credentialId,
    credentialType: "api_key",
    displayName,
    expiresAt: null,
    last4,
    lastUsedAt: "2026-07-13T01:00:00.000Z",
    prefix: "gsk_live_",
    scopes: ["chat:completions", "models:read"],
    status: "active"
  };
}

function oneTimeKey(key, plaintext) {
  return {
    createdAt: key.createdAt,
    credentialId: key.credentialId,
    credentialType: "api_key",
    expiresAt: null,
    last4: key.last4,
    plaintext,
    plaintextShownOnce: true,
    prefix: key.prefix,
    scopes: key.scopes,
    status: key.status,
    warning: "Store this value now."
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import { expect, test } from "@playwright/test";

const tenantRouteId = "tenant_demo_acme";
const tenantId = "00000000-0000-4000-8000-000000000100";
const providerId = "22222222-2222-4222-8222-222222222222";
const controlPlanePort = Number(process.env.GATELM_CONTROL_PLANE_PORT ?? "3001");
const chatAppPath = `/tenants/${tenantRouteId}/chat-app`;
const legacyKnowledgeDocumentsPath =
  `/tenants/${tenantRouteId}/knowledge-documents`;

type MockProvider = {
  baseUrl: string;
  createdAt: string;
  credentialPreview: { last4: string | null; prefix: string | null };
  displayName: string;
  id: string;
  projectId: null;
  provider: string;
  providerConfig: Record<string, unknown>;
  resolver: string;
  status: "ACTIVE";
  tenantId: string;
  timeoutMs: number;
  updatedAt: string;
};

let providers: MockProvider[] = [];
let activeSnapshot: Record<string, unknown> | null = null;
let authRole: "employee" | "tenant_admin" = "tenant_admin";
let knowledgeBaseGlobalEnabled = true;
let knowledgeBaseTenantEnabled = false;
let knowledgeBaseSettingsRequestCount = 0;
let controlPlaneServer: Server;

test.describe.configure({ mode: "serial" });
test.use({ locale: "en-US" });
test.setTimeout(60_000);

test.beforeAll(async () => {
  controlPlaneServer = createServer((request, response) => {
    void handleControlPlaneRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    controlPlaneServer.once("error", reject);
    controlPlaneServer.listen(controlPlanePort, resolve);
  });
  test.info().annotations.push({
    description: `Tenant Chat mock Control Plane on ${controlPlanePort}`,
    type: "mock"
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    controlPlaneServer.close((error) => (error ? reject(error) : resolve()));
  });
});

test.beforeEach(async ({ context }) => {
  providers = [];
  activeSnapshot = null;
  authRole = "tenant_admin";
  knowledgeBaseGlobalEnabled = true;
  knowledgeBaseTenantEnabled = false;
  knowledgeBaseSettingsRequestCount = 0;
  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "gatelm_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: "tenant-chat-e2e-session"
    }
  ]);
});

test("registers a Provider, selects exact pricing, activates, and restores ready after reload", async ({
  page
}) => {
  await page.goto(chatAppPath);
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Chat App" })).toBeVisible();
  await expect(
    page.getByText("Register an active tenant-level provider to configure the Chat App.")
  ).toBeVisible();
  const providerSetupHref = await page
    .getByRole("link", { name: "Register or edit provider" })
    .getAttribute("href");
  expect(providerSetupHref).toBe(
    `/tenants/${tenantId}/provider-connections?intent=tenant-chat-setup&returnTo=%2Ftenants%2F${tenantId}%2Fchat-app`
  );
  await page.goto(providerSetupHref!);

  const dialog = page.getByRole("dialog", { name: "Register provider model key" });
  await expect(dialog).toBeVisible();
  await page.waitForLoadState("networkidle");
  await dialog.getByPlaceholder("Paste provider API key").fill("dummy-not-a-secret");
  const registerButton = dialog.getByRole("button", { name: "Register models" });
  await expect(registerButton).toBeEnabled();
  await registerButton.click();

  await expect(page).toHaveURL(
    new RegExp(`/tenants/${tenantId}/chat-app`),
    { timeout: 15_000 }
  );
  const generalSimpleModel = page.getByRole("combobox", {
    name: "General Simple Model"
  });
  await expect(generalSimpleModel).toHaveValue(`${providerId}:gpt-5.4-mini`);
  await page.getByRole("button", { name: "Publish Chat App policy" }).click();

  await expect(page.getByText("The Chat App policy is active.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Active runtime" })).toBeVisible();

  await page.reload();
  await expect(generalSimpleModel).toHaveValue(`${providerId}:gpt-5.4-mini`);
});

test("restores the Chat App on Escape and remains usable on a mobile viewport with long labels", async ({
  page
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(chatAppPath);
  await page.waitForLoadState("networkidle");
  const providerSetupHref = await page
    .getByRole("link", { name: "Register or edit provider" })
    .getAttribute("href");
  await page.goto(providerSetupHref!);
  await expect(page.getByRole("dialog", { name: "Register provider model key" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}/chat-app$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  providers = [
    createProvider({
      displayName:
        "서울 글로벌 고객지원팀에서 사용하는 매우 긴 한국어 OpenAI Provider 연결 이름",
      models: ["gpt-5.4-mini", "gpt-5.4"]
    })
  ];
  await page.reload();

  const providerSelect = page.getByRole("combobox", {
    name: "General Simple Provider"
  });
  const modelSelect = page.getByRole("combobox", {
    name: "General Simple Model"
  });
  await expect(providerSelect).toHaveValue(providerId);
  await modelSelect.selectOption(`${providerId}:gpt-5.4`);
  await expect(modelSelect).toHaveValue(`${providerId}:gpt-5.4`);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  ).toBe(true);
});

test("manages tenant Knowledge Base enablement inside the Chat App without blocking document preparation", async ({
  page
}) => {
  await page.goto(legacyKnowledgeDocumentsPath);
  await expect(page).toHaveURL(/\/chat-app\?section=knowledge$/);

  await page.goto(chatAppPath);
  await page.waitForLoadState("networkidle");

  const knowledgeTab = page.getByRole("tab", { name: "Knowledge Base" });
  await knowledgeTab.click();
  await expect(page).toHaveURL(/\/chat-app\?section=knowledge$/);
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Routing" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await page.goForward();
  await expect(knowledgeTab).toHaveAttribute("aria-selected", "true");
  await page.reload();

  await expect(knowledgeTab).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const toggle = page.getByRole("switch", {
    name: "Enable Knowledge Chat for this tenant"
  });
  await expect(toggle).not.toBeChecked();
  const uploadButton = page.locator("button").filter({ hasText: "Upload document" });
  await expect(uploadButton).toBeEnabled();
  await expect(
    page.getByText("You can still upload and prepare documents until they are Ready.")
  ).toBeVisible();

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText("Available to employees", { exact: true })).toBeVisible();

  knowledgeBaseGlobalEnabled = false;
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText("The platform-wide RAG switch is off.", { exact: false })
  ).toBeVisible();
  await expect(page.locator('[data-effective-enabled="false"]')).toBeVisible();

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(uploadButton).toBeEnabled();
});

test("rejects a general employee before loading Knowledge Base management", async ({
  page
}) => {
  authRole = "employee";
  await page.goto(`${chatAppPath}?section=knowledge`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Knowledge Base" })).toHaveCount(0);
  expect(knowledgeBaseSettingsRequestCount).toBe(0);
});

async function handleControlPlaneRequest(
  request: IncomingMessage,
  response: ServerResponse
) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${controlPlanePort}`);
  if (url.pathname === "/api/auth/me") {
    return json(response, 200, {
      data: {
        memberships: [{ role: authRole, status: "active", tenantId }],
        session: { kind: "full" },
        tenant: { id: tenantId, name: "Acme" },
        user: {
          email: "owner@example.com",
          id: "33333333-3333-4333-8333-333333333333",
          role: authRole
        }
      }
    });
  }
  if (url.pathname === "/admin/v1/provider-presets") {
    return json(response, 200, {
      data: [
        {
          adapterType: "openai_compatible",
          baseUrl: "https://api.openai.com/v1",
          credentialRequired: true,
          defaultResolver: "env",
          defaultTimeoutMs: 30_000,
          displayName: "OpenAI",
          modelsEndpointPath: "/models",
          providerConfig: {
            providerFamily: "openai",
            requestFormat: "openai_chat_completions"
          },
          providerKey: "openai"
        }
      ]
    });
  }
  if (
    url.pathname === `/admin/v1/tenants/${tenantId}/providers` &&
    request.method === "GET"
  ) {
    return json(response, 200, { data: providers });
  }
  if (
    url.pathname === `/admin/v1/tenants/${tenantId}/providers` &&
    request.method === "POST"
  ) {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const previousProvider =
      typeof body.previousProvider === "string" ? body.previousProvider : null;
    const current = providers.find(
      (provider) =>
        provider.provider === body.provider || provider.provider === previousProvider
    );
    const saved = createProvider({
      displayName:
        typeof body.displayName === "string" ? body.displayName : "OpenAI Main",
      models: readModels(body.providerConfig),
      provider: typeof body.provider === "string" ? body.provider : "openai-main"
    });
    saved.id = current?.id ?? providerId;
    providers = [saved];
    return json(response, current ? 200 : 201, { data: saved });
  }
  if (
    url.pathname.endsWith("/discover-models") &&
    request.method === "POST"
  ) {
    const provider = providers[0] ?? createProvider();
    return json(response, 200, {
      data: {
        adapterType: "openai_compatible",
        baseUrl: provider.baseUrl,
        credentialRequired: true,
        discoveredAt: "2026-07-14T00:00:00Z",
        modelCount: 2,
        models: [
          {
            createdAt: "2026-07-01T00:00:00Z",
            displayName: "GPT 5.4 mini",
            modelName: "gpt-5.4-mini",
            object: "model",
            ownedBy: "openai",
            provider: provider.provider,
            providerId: provider.id
          },
          {
            createdAt: "2026-07-01T00:00:00Z",
            displayName: "GPT 5.4",
            modelName: "gpt-5.4",
            object: "model",
            ownedBy: "openai",
            provider: provider.provider,
            providerId: provider.id
          }
        ],
        provider: provider.provider,
        providerId: provider.id
      }
    });
  }
  if (
    url.pathname === `/admin/v1/tenants/${tenantId}/tenant-chat/runtime` &&
    request.method === "GET"
  ) {
    return json(response, 200, { data: runtimeSetup() });
  }
  if (
    url.pathname === `/admin/v1/tenants/${tenantId}/tenant-chat/runtime` &&
    request.method === "PUT"
  ) {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const cachePolicy = body.cachePolicy as Record<string, unknown>;
    const manualModelRef = String(body.manualModelRef ?? "");
    activeSnapshot = {
      cacheEnabled: cachePolicy.enabled,
      cachePolicy: body.cachePolicy,
      digest: "sha256:tenant-chat-e2e",
      manualModelRef,
      modelKey: manualModelRef.split(":").slice(1).join(":"),
      policyVersion: 1,
      pricingStatus: "current",
      pricingVersion: 1,
      providerConnectionId: providerId,
      publishedAt: "2026-07-14T00:00:00Z",
      routes: body.routes,
      routingMode: body.routingMode,
      safetyPolicy: body.safetyPolicy,
      snapshotId: "tenant_chat_snapshot_e2e",
      version: 1
    };
    return json(response, 200, { data: runtimeSetup() });
  }
  if (
    url.pathname === `/admin/v1/tenants/${tenantId}/rag/knowledge-base` &&
    request.method === "GET"
  ) {
    knowledgeBaseSettingsRequestCount += 1;
    return json(response, 200, { data: knowledgeBaseSettings() });
  }
  if (
    url.pathname === `/admin/v1/tenants/${tenantId}/rag/knowledge-base` &&
    request.method === "PATCH"
  ) {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    if (typeof body.enabled !== "boolean" || Object.keys(body).length !== 1) {
      return json(response, 400, { message: "Invalid Knowledge Base request" });
    }
    knowledgeBaseTenantEnabled = body.enabled;
    return json(response, 200, { data: knowledgeBaseSettings() });
  }
  if (
    url.pathname === `/admin/v1/tenants/${tenantId}/rag/documents` &&
    request.method === "GET"
  ) {
    return json(response, 200, {
      data: [],
      pagination: { hasMore: false, limit: 50, nextCursor: null }
    });
  }

  return json(response, 404, { message: "Not found" });
}

function knowledgeBaseSettings() {
  return {
    effectiveEnabled: knowledgeBaseGlobalEnabled && knowledgeBaseTenantEnabled,
    globalEnabled: knowledgeBaseGlobalEnabled,
    tenantEnabled: knowledgeBaseTenantEnabled
  };
}

function runtimeSetup() {
  const candidates = providers.map((provider) => ({
    displayName: provider.displayName,
    models: readModels(provider.providerConfig).map((modelKey) => ({
      activationStatus: "available",
      modelKey,
      modelRef: `${provider.id}:${modelKey}`,
      pricing:
        modelKey === "gpt-5.4-mini"
          ? {
              cacheReadInputMicroUsdPerMillionTokens: 75_000,
              inputMicroUsdPerMillionTokens: 750_000,
              outputMicroUsdPerMillionTokens: 4_500_000
            }
          : null,
      pricingStatus: modelKey === "gpt-5.4-mini" ? "available" : "unavailable"
    })),
    providerConnectionId: provider.id,
    providerFamily: "openai",
    providerKey: provider.provider
  }));
  return {
    activeSnapshot,
    providers: candidates,
    readiness: activeSnapshot
      ? "ready"
      : candidates.length === 0
        ? "needs_provider"
        : candidates.some((provider) =>
              provider.models.some((model) => model.activationStatus === "available")
            )
          ? "needs_activation"
          : "needs_model"
  };
}

function createProvider(input?: {
  displayName?: string;
  models?: string[];
  provider?: string;
}): MockProvider {
  return {
    baseUrl: "https://api.openai.com/v1",
    createdAt: "2026-07-14T00:00:00Z",
    credentialPreview: { last4: "-key", prefix: "test" },
    displayName: input?.displayName ?? "OpenAI Main",
    id: providerId,
    projectId: null,
    provider: input?.provider ?? "openai-main",
    providerConfig: {
      adapterType: "openai_compatible",
      credentialRequired: true,
      failureMode: "fail_closed",
      models: input?.models ?? [],
      modelsEndpointPath: "/models",
      providerFamily: "openai",
      requestFormat: "openai_chat_completions"
    },
    resolver: "env",
    status: "ACTIVE",
    tenantId,
    timeoutMs: 30_000,
    updatedAt: "2026-07-14T00:00:00Z"
  };
}

function readModels(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const models = (value as Record<string, unknown>).models;
  return Array.isArray(models)
    ? models.filter((model): model is string => typeof model === "string")
    : [];
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

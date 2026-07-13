import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const policyPath = "/tenants/tenant_demo_acme/policies";
const projectsPath = "/tenants/tenant_demo_acme/projects";
const controlPlaneBaseUrl = (
  process.env.GATELM_CONTROL_PLANE_BASE_URL ??
  process.env.CONTROL_PLANE_BASE_URL ??
  "http://localhost:3001"
).replace(/\/+$/, "");
const policyTabs = [
  "Routing",
  "Budget",
  "Rate Limit",
  "Cache",
  "Safety",
  "Streaming"
] as const;
const projectPolicyTabs = [
  "General",
  "Routing",
  "Rate Limit",
  "Cache",
  "Safety"
] as const;
const e2eBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const selectableDetectorTypes = [
  "email",
  "phone_number",
  "person_name",
  "postal_address",
  "organization_name"
] as const;
const mandatoryDetectorTypes = [
  "resident_registration_number",
  "api_key",
  "authorization_header",
  "jwt",
  "private_key"
] as const;

type JsonRecord = Record<string, unknown>;

let fixtureRuntimeConfig: JsonRecord;

test.beforeAll(() => {
  fixtureRuntimeConfig = createRuntimeConfigFixture();
});

test.beforeEach(async ({ context, request }) => {
  const sessionCookie = await createConsoleSessionCookie(request);

  await context.addCookies([
    {
      name: "gatelm_session",
      url: e2eBaseUrl,
      value: sessionCookie
    }
  ]);
});

test("routing roles persist and manual mode keeps the projected ten cells", async ({ page }) => {
  test.setTimeout(60_000);

  const runtimeConfigPosts = await prepareRuntimeConfigPostRoute(page);
  await page.goto(policyPath);

  const routingPanel = page.getByRole("tabpanel", { exact: true, name: "Routing" });
  const roleModels = routingPanel.getByRole("group", {
    exact: true,
    name: "Routing role models"
  });

  await expect(roleModels).toBeVisible();
  await expect(routingPanel.getByLabel("Simple model", { exact: true })).toHaveValue(
    "mock-balanced"
  );
  await expect(routingPanel.getByLabel("Complex model", { exact: true })).toHaveValue(
    "mock-balanced"
  );
  await expect(
    routingPanel.getByLabel("Fallback model (optional)", { exact: true })
  ).toHaveValue("");

  const autoRoutingSwitch = routingPanel.getByRole("switch", {
    exact: true,
    name: "Auto routing"
  });
  await expect(async () => {
    if (await autoRoutingSwitch.isChecked()) {
      await autoRoutingSwitch.click();
    }
    await expect(autoRoutingSwitch).not.toBeChecked();
  }).toPass();
  await expect(roleModels).toBeVisible();

  await page.getByRole("button", { name: /^Save draft/ }).click();
  await expect.poll(() => runtimeConfigPosts.length).toBe(1);
  const savedValues = asRecord(runtimeConfigPosts[0]?.values);
  const savedRoutingPolicy = asRecord(savedValues.routingPolicy);
  expect(savedRoutingPolicy.mode).toBe("manual");
  expect(savedRoutingPolicy.defaultModel).toBeUndefined();
  expect(savedRoutingPolicy.highQualityModel).toBeUndefined();

  await expect(async () => {
    if (!(await autoRoutingSwitch.isChecked())) {
      await autoRoutingSwitch.click();
    }
    await expect(autoRoutingSwitch).toBeChecked();
  }).toPass();
  await expect(roleModels).toBeVisible();
  await expect(routingPanel.getByLabel("Simple model", { exact: true })).toHaveValue(
    "mock-balanced"
  );
});

test("policy editor exposes category tabs and category panels", async ({ page }) => {
  await prepareRuntimeConfigPostRoute(page);
  await page.goto(policyPath);

  for (const tabName of policyTabs) {
    await expect(page.getByRole("tab", { exact: true, name: tabName })).toBeVisible();
  }
  await expect(page.getByRole("tab")).toHaveText([...policyTabs]);

  await expect(page.getByRole("tabpanel", { exact: true, name: "Routing" })).toBeVisible();
  await expect(
    page.getByRole("group", { exact: true, name: "Routing role models" })
  ).toBeVisible();

  await page.getByRole("tab", { exact: true, name: "Safety" }).click();
  await expect(page.getByRole("tabpanel", { exact: true, name: "Safety" })).toBeVisible();
  await expect(page.locator("#policy-panel-routing")).toHaveCount(0);
  await expect(page.getByText("Mandatory sensitive data protection: always active")).toBeVisible();
});

test("lazy policy tab panel mounts only for active tab and shows loading fallback", async ({ page }) => {
  await prepareRuntimeConfigPostRoute(page);
  await delayRuntimePolicyLazyChunk(page, "safety-panel");
  await page.goto(policyPath);
  await expect(
    page.getByRole("group", { exact: true, name: "Routing role models" })
  ).toBeVisible();
  await expect(page.locator("#policy-panel-routing")).toHaveCount(1);
  await expect(page.locator("#policy-panel-safety")).toHaveCount(0);

  await page.getByRole("tab", { exact: true, name: "Safety" }).click();
  const safetyPanel = page.getByRole("tabpanel", { exact: true, name: "Safety" });
  const loadingPanel = safetyPanel
    .locator(".policy-panel-loading.console-panel.policy-editor-panel")
    .first();

  await expect(safetyPanel).toBeVisible();
  await expect(safetyPanel).toHaveClass(/policy-tab-panel/);
  await expect(page.locator("#policy-panel-routing")).toHaveCount(0);
  await expect(loadingPanel).toBeVisible();
  await expect(loadingPanel).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Mandatory sensitive data protection: always active")).toBeVisible();
});

test("policy detail modal lazy-loads only after click and shows modal fallback", async ({
  page
}) => {
  await prepareRuntimeConfigPostRoute(page);
  const detailChunk = await delayRuntimePolicyLazyChunk(page, "runtime-policy-detail-modal");
  const detailChunkRequests: string[] = [];

  page.on("request", (request) => {
    const url = request.url();

    if (url.includes("runtime-policy-detail-modal")) {
      detailChunkRequests.push(url);
    }
  });

  await page.goto(policyPath);
  await expect(
    page.getByRole("group", { exact: true, name: "Routing role models" })
  ).toBeVisible();
  expect(detailChunkRequests).toHaveLength(0);

  await page.getByRole("button", { exact: true, name: "Details" }).click();
  const modal = page.getByRole("dialog", { exact: true, name: "Policy details" });

  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute("aria-busy", "true");
  await expect(modal.locator(".policy-panel-loading").first()).toBeVisible();
  await expect.poll(() => detailChunkRequests.length).toBeGreaterThan(0);
  await expect(modal).not.toHaveAttribute("aria-busy", "true");
  await expect(modal.getByText("lookup key")).toBeVisible();
  expect(detailChunk.delayedCount).toBeGreaterThan(0);
});

test("project policy editor opens with project general tab before routing", async ({ page }) => {
  await prepareRuntimeConfigPostRoute(page);
  await page.goto(projectsPath);
  const editProjectLink = page.getByTestId("project-card").first().getByRole("link", {
    exact: true,
    name: "Edit project"
  });

  await Promise.all([
    page.waitForURL(/\/tenants\/[^/]+\/projects\/[^/]+\/policies$/),
    editProjectLink.click()
  ]);

  for (const tabName of projectPolicyTabs) {
    await expect(page.getByRole("tab", { exact: true, name: tabName })).toBeVisible();
  }
  await expect(page.getByRole("tab")).toHaveText([...projectPolicyTabs]);
  await expect(page.getByRole("tab", { exact: true, name: "General" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  const generalPanel = page.getByRole("tabpanel", { exact: true, name: "General" });
  await expect(generalPanel).toBeVisible();
  await expect(generalPanel.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(generalPanel.getByRole("heading", { exact: true, name: "Budget policy" })).toBeVisible();
  await expect(generalPanel.getByRole("heading", { exact: true, name: "Project admins" })).toBeVisible();
  await expect(generalPanel.getByRole("heading", { exact: true, name: "Project teams" })).toBeVisible();
  await expect(generalPanel.getByRole("heading", { exact: true, name: "Gateway API Key" })).toBeVisible();
  await expect(page.getByRole("tab", { exact: true, name: "Budget" })).toHaveCount(0);

  const generalHeadings = await generalPanel.locator("h3").evaluateAll((headings) =>
    headings.map((heading) => heading.textContent?.trim() ?? "")
  );
  expect(generalHeadings.indexOf("Budget policy")).toBeLessThan(
    generalHeadings.indexOf("Project admins")
  );

  await page.getByRole("tab", { exact: true, name: "Routing" }).click();
  await expect(page.getByRole("tabpanel", { exact: true, name: "Routing" })).toBeVisible();
  await expect(page.locator("#policy-panel-general")).toHaveCount(0);
});

test("safety detectors expose five editable categories and gray locked mandatory protection", async ({
  page
}) => {
  await prepareRuntimeConfigPostRoute(page);
  await page.goto(policyPath);
  await page.getByRole("tab", { exact: true, name: "Safety" }).click();

  const safetyPanel = page.getByRole("tabpanel", { exact: true, name: "Safety" });
  const detectorRows = safetyPanel.locator(".policy-detector-row");

  await expect(detectorRows).toHaveCount(
    selectableDetectorTypes.length + mandatoryDetectorTypes.length
  );

  for (const detectorType of selectableDetectorTypes) {
    const detectorRow = detectorRows.filter({ hasText: detectorType });

    await expect(detectorRow).toBeVisible();
    await expect(detectorRow.locator("[data-slot='switch']")).toBeEnabled();
    await expect(detectorRow.getByLabel("Mode")).toBeEnabled();
    await expect(detectorRow.getByLabel("Mode")).toHaveValue("redact");
  }

  for (const detectorType of mandatoryDetectorTypes) {
    const detectorRow = detectorRows.filter({ hasText: detectorType });
    const switchControl = detectorRow.locator("[data-slot='switch']");
    const colors = await switchControl.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--text-muted)";
      document.body.appendChild(probe);
      const mutedColor = getComputedStyle(probe).color;
      probe.remove();

      return {
        backgroundColor: getComputedStyle(element).backgroundColor,
        mutedColor
      };
    });

    await expect(detectorRow).toBeVisible();
    await expect(switchControl).toBeDisabled();
    await expect(detectorRow.getByLabel("Mode")).toBeDisabled();
    await expect(detectorRow.getByLabel("Mode")).toHaveValue("block");
    expect(colors.backgroundColor).toBe(colors.mutedColor);
  }
});

test("policy draft values survive tab changes and submit current payload", async ({ page }) => {
  const runtimeConfigPosts = await prepareRuntimeConfigPostRoute(page);
  await page.goto(policyPath);

  await page.getByRole("tab", { exact: true, name: "Budget" }).click();
  const warningThreshold = page.getByLabel("Warning threshold", { exact: true });
  await warningThreshold.fill("73");

  await page.getByRole("tab", { exact: true, name: "Safety" }).click();
  await expect(page.getByText("Mandatory sensitive data protection: always active")).toBeVisible();

  await page.getByRole("tab", { exact: true, name: "Budget" }).click();
  await expect(warningThreshold).toHaveValue("73");

  await page.getByRole("button", { exact: true, name: "Save draft" }).click();
  await expect.poll(() => runtimeConfigPosts.length).toBe(1);
  expect(runtimeConfigPosts[0]?.action).toBe("save-draft");
  expect(asRecord(runtimeConfigPosts[0]?.values).budgetWarningThresholdPercent).toBe(73);

  await page.getByRole("button", { exact: true, name: "Publish active config" }).click();
  await expect.poll(() => runtimeConfigPosts.length).toBe(2);
  expect(runtimeConfigPosts[1]?.action).toBe("publish");
  expect(asRecord(runtimeConfigPosts[1]?.values).budgetWarningThresholdPercent).toBe(73);
});

test("legacy draft responses without safety policy keep default detector set", async ({
  page
}) => {
  const runtimeConfigPosts = await prepareRuntimeConfigPostRoute(page, (payload) => {
    const runtimeConfig = createRuntimeConfigResponse(payload) as JsonRecord;
    delete runtimeConfig.safetyPolicy;

    return runtimeConfig;
  });
  await page.goto(policyPath);

  await page.getByRole("button", { exact: true, name: "Save draft" }).click();
  await expect.poll(() => runtimeConfigPosts.length).toBe(1);
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.getByRole("tab", { exact: true, name: "Safety" }).click();

  const safetyPanel = page.getByRole("tabpanel", { exact: true, name: "Safety" });
  const detectorRows = safetyPanel.locator(".policy-detector-row");

  await expect(detectorRows).toHaveCount(
    selectableDetectorTypes.length + mandatoryDetectorTypes.length
  );

  for (const detectorType of [...selectableDetectorTypes, ...mandatoryDetectorTypes]) {
    await expect(detectorRows.filter({ hasText: detectorType })).toBeVisible();
  }
});

test("policy tabs scroll inside the control on narrow screens", async ({ page }) => {
  await prepareRuntimeConfigPostRoute(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(policyPath);

  for (const tabName of policyTabs) {
    await expect(page.getByRole("tab", { exact: true, name: tabName })).toBeVisible();
  }

  const layout = await page.locator(".policy-section-tabs").evaluate((tabList) => ({
    contentClientWidth: document.querySelector(".console-content")?.clientWidth ?? 0,
    contentScrollWidth: document.querySelector(".console-content")?.scrollWidth ?? 0,
    tabClientWidth: tabList.clientWidth,
    tabScrollWidth: tabList.scrollWidth
  }));

  expect(layout.contentScrollWidth).toBeLessThanOrEqual(layout.contentClientWidth);
  expect(layout.tabScrollWidth).toBeGreaterThan(layout.tabClientWidth);
});

async function createConsoleSessionCookie(request: APIRequestContext) {
  const email = `policy-e2e-${randomUUID()}@example.invalid`;
  const password = "correct-horse-battery-staple";
  const signupResponse = await request.post(`${controlPlaneBaseUrl}/api/auth/signup`, {
    data: {
      email,
      name: "Policy E2E",
      password
    }
  });

  expect(signupResponse.ok()).toBeTruthy();

  const organizationResponse = await request.post(
    `${controlPlaneBaseUrl}/api/auth/organizations`,
    {
      data: {
        organizationName: `Policy E2E ${randomUUID().slice(0, 8)}`
      }
    }
  );

  expect(organizationResponse.ok()).toBeTruthy();

  const organizationPayload = asRecord(await organizationResponse.json());
  const tenant = asRecord(asRecord(organizationPayload.data).tenant);
  const tenantId = getString(tenant, "id", "");
  expect(tenantId).not.toBe("");

  const projectResponse = await request.post(
    `${controlPlaneBaseUrl}/admin/v1/tenants/${encodeURIComponent(tenantId)}/projects`,
    {
      data: {
        description: "Project used by runtime policy editor E2E.",
        name: `Policy E2E Project ${randomUUID().slice(0, 8)}`,
        status: "ACTIVE",
        totalBudgetUsd: 100
      }
    }
  );

  expect(projectResponse.ok()).toBeTruthy();

  const sessionCookie = getSetCookieValue(organizationResponse.headersArray(), "gatelm_session");
  if (!sessionCookie) {
    throw new Error("Control plane did not issue a gatelm_session cookie.");
  }

  return sessionCookie;
}

function getSetCookieValue(headers: { name: string; value: string }[], cookieName: string) {
  for (const header of headers) {
    if (header.name.toLowerCase() !== "set-cookie") {
      continue;
    }

    const [nameValue] = header.value.split(";");
    const separatorIndex = nameValue.indexOf("=");
    const name = separatorIndex >= 0 ? nameValue.slice(0, separatorIndex) : "";
    const value = separatorIndex >= 0 ? nameValue.slice(separatorIndex + 1) : "";

    if (name === cookieName) {
      return value;
    }
  }

  return null;
}

async function prepareRuntimeConfigPostRoute(
  page: Page,
  createResponse: (payload: JsonRecord) => JsonRecord = createRuntimeConfigResponse
) {
  const runtimeConfigPosts: JsonRecord[] = [];

  await page.route("**/api/control-plane/application-providers", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        providerConnections: [],
        status: 200
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.route("**/api/control-plane/runtime-config", async (route) => {
    const payload = asRecord(JSON.parse(route.request().postData() ?? "{}"));
    runtimeConfigPosts.push(payload);

    await route.fulfill({
      body: JSON.stringify({
        runtimeConfig: createResponse(payload),
        status: 200
      }),
      contentType: "application/json",
      status: 200
    });
  });

  return runtimeConfigPosts;
}

async function delayRuntimePolicyLazyChunk(page: Page, fileFragment: string) {
  const tracker = { delayedCount: 0 };

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const shouldDelay =
      tracker.delayedCount === 0 &&
      url.includes("/_next/static/") &&
      url.includes(".js") &&
      url.includes(fileFragment);

    if (shouldDelay) {
      tracker.delayedCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    await route.fallback();
  });

  return tracker;
}

function createRuntimeConfigResponse(payload: JsonRecord) {
  const values = asRecord(payload.values);
  const submittedRoutingPolicy = asRecord(values.routingPolicy);
  const now = new Date("2026-07-06T00:00:00.000Z").toISOString();
  const action = getString(payload, "action", "save-draft");

  return {
    ...fixtureRuntimeConfig,
    applicationId: getString(payload, "applicationId", getString(fixtureRuntimeConfig, "applicationId", "")),
    budgetPolicy: {
      enabled: getBoolean(values, "budgetEnabled", false),
      enforcementMode: getString(values, "budgetEnforcementMode", "disabled"),
      warningThresholdPercent: getNumber(values, "budgetWarningThresholdPercent", 80)
    },
    cachePolicy: {
      enabled: getBoolean(values, "cacheEnabled", false),
      ttlSeconds: getNumber(values, "cacheTtlSeconds", 3600),
      type: "exact"
    },
    configVersion:
      action === "publish"
        ? "runtime_config_playwright_published"
        : getString(values, "configVersion", "draft_playwright"),
    effectiveAt: now,
    generatedAt: now,
    models: getArray(values, "models"),
    pricingRules: getArray(values, "pricingRules"),
    promptCapturePolicy: {
      enabled: getBoolean(values, "promptCaptureEnabled", false),
      maxChars: getNumber(values, "promptCaptureMaxChars", 8000),
      mode: getBoolean(values, "promptCaptureEnabled", false) ? "log_safe_full" : "disabled"
    },
    publishState: action === "publish" ? "published" : "draft",
    publishedAt: action === "publish" ? now : "",
    rateLimit: {
      algorithm: "fixed_window",
      enabled: getBoolean(values, "rateLimitEnabled", false),
      limit: getNumber(values, "rateLimitLimit", 1000),
      scope: "application",
      windowSeconds: 60
    },
    responseCapturePolicy: {
      enabled: getBoolean(values, "responseCaptureEnabled", false),
      maxChars: getNumber(values, "responseCaptureMaxChars", 8000),
      mode: getBoolean(values, "responseCaptureEnabled", false) ? "raw_full" : "disabled"
    },
    routingPolicy: {
      bootstrapState: getString(submittedRoutingPolicy, "bootstrapState", "mock_bootstrap"),
      mode: getString(submittedRoutingPolicy, "mode", "auto"),
      routes: submittedRoutingPolicy.routes ?? createRoutingRoutes(),
      routingPolicyHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      schemaVersion: "gatelm.routing-policy.v2"
    },
    safetyPolicy: {
      detectors: getArray(values, "detectors"),
      mode: "rule_based",
      securityPolicyHash: "sha256:playwright-security-policy"
    }
  };
}

function createRuntimeConfigFixture(): JsonRecord {
  const now = "2026-07-13T00:00:00.000Z";

  return {
    applicationId: "app_customer_demo",
    budgetPolicy: {
      enabled: false,
      enforcementMode: "disabled",
      warningThresholdPercent: 80
    },
    cachePolicy: { enabled: true, ttlSeconds: 300, type: "exact" },
    configHash: "sha256:playwright-config",
    configVersion: "runtime_config_playwright",
    effectiveAt: now,
    generatedAt: now,
    models: [
      {
        contextWindowTokens: 8192,
        displayName: "Mock Balanced",
        model: "mock-balanced",
        provider: "mock",
        status: "active",
        supportsJsonMode: false,
        supportsStreaming: false
      }
    ],
    pricingRules: [],
    providers: [
      {
        baseUrl: "http://mock-provider:4010",
        credentialPreview: null,
        displayName: "Mock Provider",
        failureMode: "fail_closed",
        models: ["mock-balanced"],
        provider: "mock",
        providerId: "00000000-0000-4000-8000-000000000001",
        resolver: "none",
        secretRef: null,
        status: "active",
        timeoutMs: 30000
      }
    ],
    publishState: "draft",
    publishedAt: "",
    rateLimit: {
      algorithm: "fixed_window",
      enabled: true,
      limit: 60,
      scope: "application",
      windowSeconds: 60
    },
    routingPolicy: createRoutingPolicyResponse("auto"),
    safetyPolicy: { detectors: [], mode: "rule_based", securityPolicyHash: "" },
    schemaVersion: "gatelm.active-runtime-config.v2",
    tenantId: "tenant_demo_acme"
  };
}

function createRoutingPolicyResponse(mode: "auto" | "manual") {
  return {
    bootstrapState: "mock_bootstrap",
    mode,
    routes: createRoutingRoutes(),
    routingPolicyHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    schemaVersion: "gatelm.routing-policy.v2"
  };
}

function createRoutingRoutes() {
  return Object.fromEntries(
    ["general", "code", "translation", "summarization", "reasoning"].map(
      (category) => [
        category,
        {
          complex: { modelRefs: ["mock-balanced"] },
          simple: { modelRefs: ["mock-balanced"] }
        }
      ]
    )
  );
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function getArray(record: JsonRecord, key: string) {
  const value = record[key];

  return Array.isArray(value) ? value : [];
}

function getBoolean(record: JsonRecord, key: string, fallback: boolean) {
  return typeof record[key] === "boolean" ? record[key] : fallback;
}

function getNumber(record: JsonRecord, key: string, fallback: number) {
  return typeof record[key] === "number" ? record[key] : fallback;
}

function getString(record: JsonRecord, key: string, fallback: string) {
  return typeof record[key] === "string" ? record[key] : fallback;
}

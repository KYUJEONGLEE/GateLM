import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const policyPath = "/tenants/tenant_demo_acme/policies";
const policyTabs = [
  "Routing",
  "Budget",
  "Rate Limit",
  "Cache",
  "Safety",
  "Streaming",
  "Provider/Model"
] as const;
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

test.beforeAll(async () => {
  const fixtureUrl = new URL(
    "../../../docs/v1.0.0/fixtures/runtime-config.fixture.json",
    import.meta.url
  );
  const fixture = asRecord(JSON.parse(await readFile(fixtureUrl, "utf8")));
  fixtureRuntimeConfig = asRecord(fixture.runtimeConfig);
});

test("policy editor exposes category tabs and category panels", async ({ page }) => {
  await prepareRuntimeConfigPostRoute(page);
  await page.goto(policyPath);

  for (const tabName of policyTabs) {
    await expect(page.getByRole("tab", { exact: true, name: tabName })).toBeVisible();
  }
  await expect(page.getByRole("tab")).toHaveText([...policyTabs]);

  await expect(page.getByRole("tabpanel", { exact: true, name: "Routing" })).toBeVisible();
  await expect(page.getByText("Default route")).toBeVisible();

  await page.getByRole("tab", { exact: true, name: "Safety" }).click();
  await expect(page.getByRole("tabpanel", { exact: true, name: "Safety" })).toBeVisible();
  await expect(
    page.getByRole("tabpanel", { exact: true, includeHidden: true, name: "Routing" })
  ).toBeHidden();
  await expect(page.getByText("Mandatory sensitive data protection: always active")).toBeVisible();
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

async function prepareRuntimeConfigPostRoute(
  page: Page,
  createResponse: (payload: JsonRecord) => JsonRecord = createRuntimeConfigResponse
) {
  const runtimeConfigPosts: JsonRecord[] = [];

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

function createRuntimeConfigResponse(payload: JsonRecord) {
  const values = asRecord(payload.values);
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
      defaultModel: getString(values, "routingDefaultModel", ""),
      defaultProvider: getString(values, "routingDefaultProvider", ""),
      fallbackModel: getString(values, "routingFallbackModel", ""),
      fallbackProvider: getString(values, "routingFallbackProvider", ""),
      lowCostModel: getString(values, "routingLowCostModel", ""),
      lowCostProvider: getString(values, "routingLowCostProvider", ""),
      routingPolicyHash: "sha256:playwright-routing-policy",
      shortPromptMaxChars: getNumber(values, "routingShortPromptMaxChars", 2000)
    },
    safetyPolicy: {
      detectors: getArray(values, "detectors"),
      mode: "rule_based",
      securityPolicyHash: "sha256:playwright-security-policy"
    }
  };
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

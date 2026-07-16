import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator
} from "@playwright/test";

const tenantManagementPath = "/tenants/tenant_demo_acme/tenants";
const testBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const controlPlaneBaseUrl = (
  process.env.GATELM_CONTROL_PLANE_BASE_URL ??
  process.env.CONTROL_PLANE_BASE_URL ??
  "http://localhost:3001"
).replace(/\/+$/, "");

test.beforeEach(async ({ context, request }) => {
  const sessionCookie = await createConsoleSessionCookie(request);

  await context.addCookies([
    {
      name: "gatelm_session",
      url: testBaseUrl,
      value: sessionCookie
    }
  ]);
});

test("company policy opens routing with Claude as the company default", async ({ page }) => {
  await page.goto(tenantManagementPath);

  await expect(
    page.getByRole("heading", { exact: true, name: "Tenant" })
  ).toBeVisible();

  const tabs = page.getByRole("tablist", { exact: true, name: "Company policy sections" });
  await expect(tabs.getByRole("tab")).toHaveText(["Routing policy", "Budget policy"]);
  await expect(tabs.getByRole("tab", { exact: true, name: "Routing policy" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  const routingPanel = page.getByRole("tabpanel", { exact: true, name: "Routing policy" });
  const routingForm = routingPanel.locator(".tenant-routing-panel");
  const routingSwitch = routingPanel.getByRole("switch", {
    exact: true,
    name: "Auto routing"
  });
  await expect(routingSwitch).toHaveAttribute("aria-checked", "true");
  await expectSwitchThumbInsideTrack(routingSwitch);
  await expect(routingForm).toHaveAttribute("data-policy-state", "company_default");
  await expect(routingPanel.getByText("Company default model", { exact: true })).toBeVisible();
  await expect(
    routingPanel.getByText(
      "The organization-wide baseline for workloads without an explicit override. All current routes inherit this model.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(routingPanel.getByRole("columnheader")).toHaveText([
    "Category",
    "Simple",
    "Complex"
  ]);
  await expect(routingPanel.getByRole("rowheader")).toHaveText([
    "General",
    "Code",
    "Translation",
    "Summarization",
    "Reasoning"
  ]);

  const modelRefInputs = routingPanel.locator(".tenant-routing-table").getByRole("combobox");
  await expect(modelRefInputs).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    await expect(modelRefInputs.nth(index)).toHaveValue("anthropic:claude-sonnet");
  }
  await expect(routingPanel.locator(".tenant-routing-provider-icon-large")).toHaveCount(12);

  for (const retiredLabel of [
    "Default model",
    "High-quality model",
    "Auto routing OFF default model"
  ]) {
    await expect(routingPanel.getByText(retiredLabel, { exact: true })).toHaveCount(0);
  }
});

test("company default and fallback models are independently selectable", async ({ page }) => {
  await page.goto(tenantManagementPath);

  const companyDefault = page.getByRole("combobox", {
    exact: true,
    name: "Company default model"
  });
  const fallbackModel = page.getByRole("combobox", {
    exact: true,
    name: "Fallback model"
  });
  const routeModels = page.locator(".tenant-routing-table").getByRole("combobox");

  await expect(companyDefault).toHaveValue("anthropic:claude-sonnet");
  await expect(fallbackModel).toHaveValue("anthropic:claude-haiku");
  await companyDefault.selectOption("openai:gpt-4o");
  for (let index = 0; index < 10; index += 1) {
    await expect(routeModels.nth(index)).toHaveValue("openai:gpt-4o");
  }
  await fallbackModel.selectOption("openai:gpt-4o-mini");
  await expect(fallbackModel).toHaveValue("openai:gpt-4o-mini");
  await expect(page.getByRole("button", { name: /move|remove|add fallback/i })).toHaveCount(0);
});

test("general chat can be overridden to the registered GPT 4o-mini model", async ({ page }) => {
  await page.goto(tenantManagementPath);

  const routingPanel = page.getByRole("tabpanel", { exact: true, name: "Routing policy" });
  const routingForm = routingPanel.locator(".tenant-routing-panel");
  await routingPanel
    .getByRole("combobox", { exact: true, name: "General Simple model" })
    .selectOption("openai:gpt-4o-mini");
  await routingPanel
    .getByRole("combobox", { exact: true, name: "General Complex model" })
    .selectOption("openai:gpt-4o-mini");

  await expect(routingForm).toHaveAttribute("data-policy-state", "category_override");
  await expect(
    routingPanel.getByText(
      "Explicit workload routes are active. Requests without an override continue to inherit the company default.",
      { exact: true }
    )
  ).toBeVisible();
});

test("manual mode hides model configuration while preserving the matrix", async ({
  page
}) => {
  await page.goto(tenantManagementPath);

  const routingSwitch = page.getByRole("switch", { exact: true, name: "Auto routing" });
  const generalSimplePrimary = page.getByRole("combobox", {
    exact: true,
    name: "General Simple model"
  });
  await generalSimplePrimary.selectOption("google:gemini-flash");

  await routingSwitch.click();
  await expect(routingSwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".tenant-routing-model-card")).toHaveCount(0);
  await expect(page.getByText("Manual model selection", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Workload routing policy" })).toHaveCount(
    0
  );
  await expect(page.getByRole("combobox", { name: "Fallback model" })).toBeVisible();
  await expect(page.getByText("Default model", { exact: true })).toHaveCount(0);

  await routingSwitch.click();
  await expect(generalSimplePrimary).toHaveValue("google:gemini-flash");
  await routingSwitch.click();

  const saveButton = page.getByRole("button", { exact: true, name: "Save changes" });
  await saveButton.click();
  await expect(page.getByRole("button", { exact: true, name: "Saved" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Routing settings saved.");

  await page.getByRole("tab", { exact: true, name: "Budget policy" }).click();
  await expect(page.locator(".tenant-routing-panel")).toHaveCount(0);
  await page.getByRole("tab", { exact: true, name: "Routing policy" }).click();

  await expect(routingSwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".tenant-routing-model-card")).toHaveCount(0);
  await routingSwitch.click();
  await expect(generalSimplePrimary).toHaveValue("google:gemini-flash");
});

test("reset restores the Claude company default without reusing a manual model", async ({ page }) => {
  await page.goto(tenantManagementPath);

  await page
    .getByRole("combobox", { exact: true, name: "General Simple model" })
    .selectOption("openai:gpt-4o-mini");
  await page.getByRole("combobox", { exact: true, name: "Fallback model" }).selectOption(
    "google:gemini-flash"
  );
  await page.getByRole("switch", { exact: true, name: "Auto routing" }).click();
  await page.getByRole("button", { exact: true, name: "Reset" }).click();

  const routingPanel = page.getByRole("tabpanel", { exact: true, name: "Routing policy" });
  const routingForm = routingPanel.locator(".tenant-routing-panel");
  await expect(routingPanel.getByRole("switch", { exact: true, name: "Auto routing" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(routingForm).toHaveAttribute("data-policy-state", "company_default");

  const modelRefInputs = routingPanel.locator(".tenant-routing-table").getByRole("combobox");
  await expect(modelRefInputs).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    await expect(modelRefInputs.nth(index)).toHaveValue("anthropic:claude-sonnet");
  }
  await expect(routingPanel.getByRole("combobox", { name: "Fallback model" })).toHaveValue(
    "anthropic:claude-haiku"
  );
});

test("routing matrix stacks without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(tenantManagementPath);

  const routingPanel = page.locator(".tenant-routing-panel");
  await expect(routingPanel).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Save changes" })).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "Workload routing policy" })
  ).toBeVisible();
  await expectNoHorizontalOverflow(routingPanel);
});

async function expectNoHorizontalOverflow(locator: Locator) {
  const width = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));

  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth + 1);
}

async function expectSwitchThumbInsideTrack(switchControl: Locator) {
  const geometry = await switchControl.evaluate((element) => {
    const thumb = element.querySelector('[data-slot="switch-thumb"]');

    if (!(thumb instanceof HTMLElement)) {
      throw new Error("Switch thumb not found");
    }

    const trackBounds = element.getBoundingClientRect();
    const thumbBounds = thumb.getBoundingClientRect();

    return {
      checked: element.getAttribute("aria-checked") === "true",
      left: thumbBounds.left - trackBounds.left,
      right: trackBounds.right - thumbBounds.right
    };
  });

  expect(geometry.left).toBeGreaterThanOrEqual(2);
  expect(geometry.right).toBeGreaterThanOrEqual(2);
  expect(geometry.checked ? geometry.right : geometry.left).toBeLessThanOrEqual(4);
}

async function createConsoleSessionCookie(request: APIRequestContext) {
  const signupResponse = await request.post(`${controlPlaneBaseUrl}/api/auth/signup`, {
    data: {
      email: `tenant-routing-e2e-${randomUUID()}@example.invalid`,
      name: "Tenant Routing E2E",
      password: "correct-horse-battery-staple"
    }
  });

  expect(signupResponse.ok()).toBeTruthy();

  const organizationResponse = await request.post(
    `${controlPlaneBaseUrl}/api/auth/organizations`,
    {
      data: {
        organizationName: `Tenant Routing E2E ${randomUUID().slice(0, 8)}`
      }
    }
  );

  expect(organizationResponse.ok()).toBeTruthy();

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
    const name = separatorIndex >= 0 ? nameValue.slice(0, separatorIndex).trim() : "";
    const value = separatorIndex >= 0 ? nameValue.slice(separatorIndex + 1).trim() : "";

    if (name === cookieName) {
      return value;
    }
  }

  return null;
}

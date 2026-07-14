import { expect, test } from "@playwright/test";

const tenantId = "00000000-0000-4000-8000-000000000100";
const otherTenantId = "00000000-0000-4000-8000-000000000101";
const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3015";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "gatelm_session", url: webBaseUrl, value: "api-key-e2e-session" },
    { name: "gatelm_locale", url: webBaseUrl, value: "en" }
  ]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: webBaseUrl
  });
});

test("lists project keys and completes issue, copy, reissue, and revoke", async ({ page }) => {
  await page.goto(`/tenants/${tenantId}/api-keys`);

  await expect(page.getByRole("heading", { exact: true, name: "API Management" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "API Management" })).toBeVisible();
  const originalRow = page.getByRole("row").filter({ hasText: "Production Gateway" });
  await expect(originalRow).toContainText("Customer Chat");
  await expect(originalRow).toContainText("gsk_live_••••A1B2");

  await page.getByRole("button", { exact: true, name: "Issue new Key" }).click();
  const issueDialog = page.getByRole("dialog");
  await issueDialog.getByLabel("Key name").fill("Developer Integration");
  await issueDialog.getByRole("button", { exact: true, name: "Issue new Key" }).click();

  const secretDialog = page.getByRole("dialog");
  await expect(secretDialog.getByRole("heading", { name: "Store the new API Key" })).toBeVisible();
  await secretDialog.getByRole("button", { name: "Copy API Key" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("one-time-issued-placeholder");
  await secretDialog.getByRole("button", { name: "Stored safely" }).click();

  const issuedRow = page.getByRole("row").filter({ hasText: "Developer Integration" });
  await expect(issuedRow).toContainText("Customer Chat");
  await issuedRow.getByRole("button", { name: "Reissue" }).click();
  await page.getByRole("dialog").getByRole("button", { exact: true, name: "Reissue" }).click();
  await expect(page.getByRole("dialog").getByText("one-time-rotated-placeholder")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Stored safely" }).click();

  const replacementRow = page.getByRole("row").filter({ hasText: "Developer Integration" }).first();
  await replacementRow.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("dialog").getByRole("button", { exact: true, name: "Revoke" }).click();
  await expect(replacementRow).toContainText("revoked");
});

test("does not expose another tenant's API Keys", async ({ page }) => {
  await page.goto(`/tenants/${otherTenantId}/api-keys`);

  await expect(page.getByRole("alert")).toContainText("outside admin scope");
  await expect(page.getByText("Production Gateway")).toHaveCount(0);
  await expect(page.getByText("gsk_live_••••A1B2")).toHaveCount(0);
});

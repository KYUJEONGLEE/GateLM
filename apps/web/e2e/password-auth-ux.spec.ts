import { expect, test, type Page } from "@playwright/test";

async function prepareAnonymousLanding(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { message: "Not authenticated" } }),
      contentType: "application/json",
      status: 401
    });
  });
  await page.goto("/");
}

test("password fields expose visibility controls and valid signup checks", async ({ page }) => {
  await prepareAnonymousLanding(page);
  const topbar = page.getByRole("navigation", {
    exact: true,
    name: "GateLM landing navigation"
  });

  await topbar.locator(".landing-top-actions .landing-auth-button").first().click();
  const dialog = page.getByRole("dialog");
  const loginPassword = dialog.locator('input[name="password"]');
  await loginPassword.fill("Legacy password");
  await expect(loginPassword).toHaveAttribute("type", "password");
  await dialog.locator(".password-visibility-toggle").click();
  await expect(loginPassword).toHaveAttribute("type", "text");

  await dialog.getByRole("tab").nth(1).click();
  const signupPassword = dialog.locator('input[name="password"]');
  const signupConfirmation = dialog.locator('input[name="passwordConfirmation"]');
  await expect(signupPassword).toHaveAttribute("minlength", "8");
  await expect(signupPassword).toHaveAttribute("maxlength", "15");

  await signupPassword.fill("Valid1!Pass");
  await expect(dialog.locator(".password-input-valid-icon")).toHaveCount(1);
  await signupConfirmation.fill("Valid1!Pass");
  await expect(dialog.locator(".password-input-valid-icon")).toHaveCount(2);
});

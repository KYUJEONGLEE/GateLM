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

test("password reset stays public and warns after an invalid new password loses focus", async ({
  page
}) => {
  await page.goto("/auth/reset-password#token=diagnostic-reset-token-with-32-characters");

  const newPassword = page.locator("#reset-new-password");
  await expect(newPassword).toBeVisible();
  await newPassword.fill("weakpass");
  await expect(page.locator(".password-validation-message-error")).toHaveCount(0);

  await page.locator("#reset-password-confirmation").focus();
  await expect(page.locator(".password-validation-message-error")).toContainText(
    /비밀번호 규칙을 충족하지 않습니다|Password requirements are not met/
  );

  await newPassword.fill("Valid1!Pass");
  await expect(page.locator(".password-validation-message-success")).toContainText(
    /비밀번호 규칙을 충족했습니다|Password requirements met/
  );
});

import { expect, type Page, test } from "@playwright/test";

const dashboardPath = "/tenants/tenant_demo_acme/dashboard";

async function prepareDashboardRoute(page: Page) {
  await page.route(`**${dashboardPath}`, async (route) => {
    await route.fulfill({
      body: "<main>Dashboard</main>",
      contentType: "text/html",
      status: 200
    });
  });
}

async function prepareAnonymousSessionRoute(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          message: "Not authenticated"
        }
      }),
      contentType: "application/json",
      status: 401
    });
  });
}

async function prepareFullSessionRoute(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: {
          session: {
            kind: "full"
          }
        }
      }),
      contentType: "application/json",
      status: 200
    });
  });
}

test("successful login goes directly to the tenant dashboard", async ({ page }) => {
  await prepareDashboardRoute(page);
  await prepareAnonymousSessionRoute(page);
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: {
          session: {
            kind: "full"
          }
        }
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.goto("/");
  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  await expect(topbar.locator(".landing-top-actions .landing-auth-button")).toHaveCount(2);
  await topbar.locator(".landing-top-actions .landing-auth-button").first().click();

  const loginDialog = page.getByRole("dialog");
  await loginDialog.locator('input[name="email"]').fill("admin@example.com");
  await loginDialog.locator('input[name="password"]').fill("local-test-password");
  await loginDialog.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(new RegExp(`${dashboardPath}$`));
});

test("restored full session goes directly to the tenant dashboard", async ({ page }) => {
  await prepareDashboardRoute(page);
  await prepareFullSessionRoute(page);

  await page.goto("/");

  await expect(page).toHaveURL(new RegExp(`${dashboardPath}$`));
});

test("console brand link keeps authenticated users on the landing page", async ({ page }) => {
  await prepareFullSessionRoute(page);

  await page.goto(dashboardPath);
  await page.locator(".console-sidebar .console-brand").click();

  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  await expect(topbar).toBeVisible();
  await expect(topbar.locator(".landing-top-actions .landing-auth-button")).toHaveCount(2);
  await expect(topbar.getByRole("link", { name: /Open Dashboard|대시보드 열기/ })).toHaveAttribute(
    "href",
    dashboardPath
  );
  await expect(page).toHaveURL(/\/$/);
});

test("anonymous landing topbar exposes gateway request and login actions without logout", async ({
  page
}) => {
  await prepareAnonymousSessionRoute(page);

  await page.goto("/");

  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  const brandCluster = topbar.locator(".landing-brand-cluster");
  await expect(brandCluster.getByRole("link", { exact: true, name: "GateLM home" })).toBeVisible();

  const gatewayRequestLink = brandCluster.getByRole("link", {
    name: /Gateway (request|요청)/
  });
  await expect(gatewayRequestLink).toBeVisible();
  await expect(gatewayRequestLink).toHaveAttribute("href", "/application");

  await expect(topbar.locator(".landing-top-actions .landing-auth-button")).toHaveCount(2);
  await expect(topbar.getByRole("button", { name: /Logout|로그아웃/ })).toBeHidden();
});

test("authenticated landing topbar shows dashboard and logout actions before logout", async ({
  page
}) => {
  await prepareFullSessionRoute(page);
  let completeLogout: (() => void) | undefined;
  const logoutCompleted = new Promise<void>((resolve) => {
    completeLogout = resolve;
  });
  let logoutRequestCount = 0;

  await page.route("**/api/auth/logout", async (route) => {
    logoutRequestCount += 1;
    await logoutCompleted;
    await route.fulfill({
      body: "",
      status: 204
    });
  });

  await page.goto("/?view=landing");

  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  const authButtons = topbar.locator(".landing-top-actions .landing-auth-button");
  const dashboardLink = topbar.getByRole("link", { name: /Open Dashboard|대시보드 열기/ });
  const logoutButton = topbar.getByRole("button", { name: /Logout|로그아웃/ });

  await expect(authButtons).toHaveCount(2);
  await expect(dashboardLink).toHaveAttribute("href", dashboardPath);

  const logoutRequest = page.waitForRequest(
    (request) => request.url().includes("/api/auth/logout") && request.method() === "POST"
  );
  const logoutResponse = page.waitForResponse(
    (response) => response.url().includes("/api/auth/logout") && response.request().method() === "POST"
  );
  await logoutButton.click();
  await logoutRequest;

  await expect(logoutButton).toBeHidden();
  await expect(dashboardLink).toBeHidden();
  await expect(authButtons).toHaveCount(2);
  await expect.poll(() => logoutRequestCount).toBe(1);

  completeLogout?.();
  await logoutResponse;
});

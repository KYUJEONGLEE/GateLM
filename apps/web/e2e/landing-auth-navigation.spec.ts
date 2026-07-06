import { expect, type Page, test } from "@playwright/test";

const dashboardPath = "/tenants/tenant_demo_acme/dashboard";
const signupProjectsPath = "/tenants/tenant_signup_acme/projects";

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

test("email signup opens the tenant Projects management page", async ({ page }) => {
  await prepareAnonymousSessionRoute(page);
  await page.route("**/api/auth/signup", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: {
          session: {
            kind: "onboarding"
          },
          user: {
            email: "owner@example.com",
            name: "Owner User"
          },
          verificationRequired: false
        }
      }),
      contentType: "application/json",
      status: 201
    });
  });
  await page.route("**/api/auth/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: {
          membership: {
            role: "tenant_admin",
            status: "active",
            tenantId: "tenant_signup_acme"
          },
          session: {
            kind: "full"
          },
          tenant: {
            id: "tenant_signup_acme",
            name: "Acme AI Operations",
            status: "active"
          },
          user: {
            email: "owner@example.com",
            name: "Owner User"
          }
        }
      }),
      contentType: "application/json",
      status: 201
    });
  });

  await page.goto("/");

  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  await topbar.locator(".landing-top-actions .landing-auth-button").nth(1).click();

  const signupDialog = page.getByRole("dialog");
  await signupDialog.locator('input[name="name"]').fill("Owner User");
  await signupDialog.locator('input[name="email"]').fill("owner@example.com");
  await signupDialog.locator('input[name="password"]').fill("correct-horse-battery-staple");
  await signupDialog.locator('button[type="submit"]').click();

  await expect(signupDialog.locator(".landing-signup-steps li")).toHaveCount(4);
  await expect(signupDialog.locator('input[name="verificationCode"]')).toBeHidden();

  await signupDialog.locator('input[name="tenant"]').fill("Acme AI Operations");
  await Promise.all([
    page.waitForURL(new RegExp(`${signupProjectsPath}$`), { waitUntil: "commit" }),
    signupDialog.locator('button[type="submit"]').click()
  ]);
  await expect(page.locator(".management-line-content")).toBeVisible();
  const createProjectLink = page.locator(`a[href="/tenants/tenant_signup_acme/onboarding"]`);
  await expect(createProjectLink).toBeVisible();

  await createProjectLink.click();
  await expect(page).toHaveURL(/\/tenants\/tenant_signup_acme\/onboarding$/);
  await expect(page.getByRole("textbox", { name: "Tenant" })).toHaveCount(0);
  const budgetFieldShell = page.locator(".onboarding-field").filter({
    has: page.getByRole("textbox", { name: "Project budget" })
  });
  await expect(budgetFieldShell.locator(".onboarding-field-unit")).toHaveText("$");
});

test("create project hides tenant input and shows project budget currency", async ({ page }) => {
  await page.goto("/tenants/tenant_demo_acme/onboarding");

  await expect(page.getByRole("textbox", { name: "Tenant" })).toHaveCount(0);
  const budgetField = page.getByRole("textbox", { name: "Project budget" });
  await expect(budgetField).toHaveValue("100");
  const budgetFieldShell = page.locator(".onboarding-field").filter({ has: budgetField });
  await expect(budgetFieldShell.locator(".onboarding-field-unit")).toHaveText("$");
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
  const brandCluster = topbar.locator(".landing-brand-cluster");
  await expect(topbar).toBeVisible();
  await expect(topbar.locator(".landing-top-actions .landing-auth-button")).toHaveCount(1);
  await expect(brandCluster.locator(".landing-auth-button")).toHaveCount(2);
  await expect(brandCluster.locator(".landing-auth-button").nth(0)).toHaveAttribute("href", "/application");
  await expect(brandCluster.locator(".landing-auth-button").nth(1)).toHaveAttribute("href", dashboardPath);
  await expect(brandCluster.getByRole("link", { name: /Open Dashboard|대시보드로 이동/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("console settings exposes logout below theme and signs out", async ({ page }) => {
  let hasSession = true;
  let logoutRequestCount = 0;

  await page.route("**/api/auth/me", async (route) => {
    if (!hasSession) {
      await route.fulfill({
        body: JSON.stringify({
          error: {
            message: "Not authenticated"
          }
        }),
        contentType: "application/json",
        status: 401
      });
      return;
    }

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
  await page.route("**/api/auth/logout", async (route) => {
    logoutRequestCount += 1;
    hasSession = false;
    await route.fulfill({
      body: "",
      status: 204
    });
  });

  await page.goto(dashboardPath);

  await page.locator(".console-sidebar-settings-button").click();
  const settingsPopover = page.locator(".console-sidebar-settings-popover");
  const settingsRows = settingsPopover.locator(".console-sidebar-settings-row");

  await expect(settingsRows).toHaveCount(3);
  await expect(settingsRows.nth(0)).toContainText("Console language");
  await expect(settingsRows.nth(1)).toContainText("Theme");
  await expect(settingsRows.nth(2)).toHaveText("Logout");
  const logoutButton = settingsRows.nth(2).getByRole("button", { name: "Logout" });
  await expect(logoutButton).toBeVisible();

  const logoutRequest = page.waitForRequest(
    (request) => request.url().includes("/api/auth/logout") && request.method() === "POST"
  );
  await Promise.all([
    page.waitForURL(/\/(\?view=landing)?$/),
    logoutRequest,
    logoutButton.click()
  ]);

  await expect.poll(() => logoutRequestCount).toBe(1);
  await expect(page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" })).toBeVisible();
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
  await expect(brandCluster.getByRole("link", { name: /Open Dashboard|대시보드로 이동/ })).toBeHidden();

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
  const brandCluster = topbar.locator(".landing-brand-cluster");
  const authButtons = topbar.locator(".landing-top-actions .landing-auth-button");
  const brandClusterButtons = brandCluster.locator(".landing-auth-button");
  const dashboardLink = brandCluster.getByRole("link", { name: /Open Dashboard|대시보드로 이동/ });
  const logoutButton = topbar.getByRole("button", { name: /Logout|로그아웃/ });

  await expect(authButtons).toHaveCount(1);
  await expect(brandClusterButtons).toHaveCount(2);
  await expect(brandClusterButtons.nth(0)).toHaveAttribute("href", "/application");
  await expect(brandClusterButtons.nth(1)).toHaveAttribute("href", dashboardPath);
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
  await expect(brandCluster.locator(".landing-auth-button")).toHaveCount(1);
  await expect(authButtons).toHaveCount(2);
  await expect.poll(() => logoutRequestCount).toBe(1);

  completeLogout?.();
  await logoutResponse;
});

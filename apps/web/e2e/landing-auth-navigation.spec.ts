import { expect, type Page, test } from "@playwright/test";

const dashboardPath = "/tenants/tenant_demo_acme/dashboard";
const signupProjectsPath = "/tenants/tenant_signup_acme/projects";
const landingTestBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

async function prepareInitialAuthenticatedLanding(page: Page) {
  await page.context().addCookies([
    {
      name: "gatelm_session",
      url: landingTestBaseUrl,
      value: "playwright-session"
    },
    {
      name: "gatelm_locale",
      url: landingTestBaseUrl,
      value: "en"
    }
  ]);
}

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
  const loginPassword = loginDialog.locator('input[name="password"]');
  await loginPassword.fill("local-test-password");
  await expect(loginPassword).toHaveAttribute("type", "password");
  await loginDialog.locator(".password-visibility-toggle").click();
  await expect(loginPassword).toHaveAttribute("type", "text");
  await loginDialog.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(new RegExp(`${dashboardPath}$`));
});

test("login account recovery submits the signup email without exposing account existence", async ({ page }) => {
  await prepareAnonymousSessionRoute(page);
  let requestedEmail = "";
  await page.route("**/api/auth/password-reset/request", async (route) => {
    const payload = route.request().postDataJSON() as { email?: string };
    requestedEmail = payload.email ?? "";
    await route.fulfill({
      body: JSON.stringify({ data: { accepted: true } }),
      contentType: "application/json",
      status: 202
    });
  });

  await page.goto("/");
  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  await topbar.locator(".landing-top-actions .landing-auth-button").first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".landing-auth-help").first()).toBeVisible();
  await dialog.locator(".landing-auth-text-button").first().click();
  await dialog.locator('input[name="email"]').fill("owner@example.com");
  await dialog.locator('button[type="submit"]').click();

  expect(requestedEmail).toBe("owner@example.com");
  await expect(dialog.locator(".landing-auth-message-success")).toBeVisible();
});

test("email signup opens the tenant Projects management page", async ({ page }) => {
  await prepareAnonymousSessionRoute(page);
  await page.route("**/api/auth/signup", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: {
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
  const signupPassword = signupDialog.locator('input[name="password"]');
  const signupConfirmation = signupDialog.locator('input[name="passwordConfirmation"]');
  await expect(signupPassword).toHaveAttribute("minlength", "8");
  await expect(signupPassword).toHaveAttribute("maxlength", "15");
  await signupPassword.fill("Valid1!Pass");
  await signupConfirmation.fill("Valid1!Pass");
  await expect(signupDialog.locator(".password-input-valid-icon")).toHaveCount(2);
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

test("authenticated landing renders dashboard action before session restore completes", async ({
  page
}) => {
  await prepareInitialAuthenticatedLanding(page);
  let releaseSessionRestore: () => void = () => undefined;
  const sessionRestoreRelease = new Promise<void>((resolve) => {
    releaseSessionRestore = resolve;
  });
  const sessionRestoreStarted = new Promise<void>((resolve) => {
    void page.route("**/api/auth/me", async (route) => {
      resolve();
      await sessionRestoreRelease;
      await route.fulfill({
        body: JSON.stringify({
          data: {
            memberships: [
              {
                role: "tenant_admin",
                status: "active",
                tenantId: "tenant_demo_acme"
              }
            ],
            session: {
              kind: "full"
            },
            user: {
              email: "owner@example.com",
              id: "user_demo_owner"
            }
          }
        }),
        contentType: "application/json",
        status: 200
      });
    });
  });

  await page.goto("/?view=landing");
  await sessionRestoreStarted;

  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  const brandCluster = topbar.locator(".landing-brand-cluster");
  const dashboardLink = brandCluster.getByRole("link", { name: "Open Dashboard" });

  await expect(brandCluster.locator(".landing-auth-button")).toHaveCount(2);
  await expect(dashboardLink).toBeVisible();
  await expect(dashboardLink).toHaveAttribute("href", dashboardPath);

  releaseSessionRestore();
  await expect(dashboardLink).toBeVisible();
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

test("console settings hides logout below theme", async ({ page }) => {
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

  await page.goto(dashboardPath);

  await page.locator(".console-sidebar-settings-button").click();
  const settingsPopover = page.locator(".console-sidebar-settings-popover");
  const settingsRows = settingsPopover.locator(".console-sidebar-settings-row");

  await expect(settingsRows).toHaveCount(2);
  await expect(settingsRows.nth(0)).toContainText("Console language");
  await expect(settingsRows.nth(1)).toContainText("Theme");
  await expect(settingsPopover.getByRole("button", { name: "Logout" })).toHaveCount(0);
});

test("anonymous landing topbar hides gateway request and exposes login actions without logout", async ({
  page
}) => {
  await prepareAnonymousSessionRoute(page);

  await page.goto("/");

  const topbar = page.getByRole("navigation", { exact: true, name: "GateLM landing navigation" });
  const brandCluster = topbar.locator(".landing-brand-cluster");
  await expect(brandCluster.getByRole("link", { exact: true, name: "GateLM home" })).toBeVisible();

  await expect(brandCluster.locator(".landing-gateway-request-button")).toHaveCount(0);
  await expect(brandCluster.getByRole("link", { name: /Open Dashboard|대시보드로 이동/ })).toBeHidden();

  await expect(topbar.locator(".landing-top-actions .landing-auth-button")).toHaveCount(2);
  await expect(topbar.getByRole("button", { name: /Logout|로그아웃/ })).toBeHidden();
});

test("anonymous landing summary actions open login instead of navigating", async ({ page }) => {
  await prepareAnonymousSessionRoute(page);

  await page.goto("/");

  const summaryActions = page.locator(".landing-summary-actions");
  const dashboardButton = summaryActions.getByRole("button", {
    name: /Open Dashboard|대시보드로 이동/
  });
  const chatButton = summaryActions.getByRole("button", {
    name: /Employee Chat|직원 Chat 확인/
  });

  await expect(dashboardButton).toBeVisible();
  await expect(chatButton).toBeVisible();
  await expect(summaryActions.getByRole("link")).toHaveCount(0);

  await dashboardButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.locator(".landing-auth-close").click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await chatButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
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
  await expect(brandCluster.locator(".landing-auth-button")).toHaveCount(0);
  await expect(authButtons).toHaveCount(2);
  await expect.poll(() => logoutRequestCount).toBe(1);

  completeLogout?.();
  await logoutResponse;
});

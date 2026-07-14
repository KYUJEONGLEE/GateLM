import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type BrowserContext, test } from "@playwright/test";

const e2eBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const controlPlaneBaseUrl = (
  process.env.GATELM_CONTROL_PLANE_BASE_URL ??
  process.env.CONTROL_PLANE_BASE_URL ??
  "http://localhost:3001"
).replace(/\/+$/, "");
const e2eCookieUrls = Array.from(
  new Set([
    e2eBaseUrl,
    `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
    `http://localhost:${process.env.PORT ?? "3000"}`
  ])
);

test("create project can select existing teams and create a team inline before attaching all selected teams", async ({
  context,
  page,
  request
}) => {
  test.setTimeout(90_000);

  const issuedPlaintext = "gatelm_test_onboarding_team_demo";
  let apiKeyAction = "";
  let draftProjectValues: Record<string, unknown> = {};
  let draftTenantId = "tenant_demo_acme";
  let draftTeamIds: string[] = [];
  let savedProviderValues: Record<string, unknown> = {};
  let firstAttachedTeamId = "";
  let projectCreateCallCount = 0;
  let projectUpdateCallCount = 0;
  let updatedProjectValues: Record<string, unknown> = {};

  await page.route("**/api/control-plane/projects", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      tenantId?: string;
      values?: Record<string, unknown>;
    };

    if (body.action === "update") {
      projectUpdateCallCount += 1;
      updatedProjectValues = body.values ?? {};

      await route.fulfill({
        body: JSON.stringify({
          project: {
            createdAt: "2026-07-06T00:00:00.000Z",
            description: body.values?.description ?? "",
            id: "project_onboarding_team_demo",
            name: body.values?.name,
            runtimeApplicationId: "app_onboarding_team_demo",
            status: body.values?.status ?? "ACTIVE",
            tenantId: String(body.tenantId ?? draftTenantId),
            totalBudgetUsd: body.values?.totalBudgetUsd,
            updatedAt: "2026-07-06T00:10:00.000Z"
          },
          policyError:
            projectUpdateCallCount === 1
              ? "Runtime Policy bootstrap publish failed."
              : undefined,
          status: 200
        }),
        contentType: "application/json",
        status: 200
      });
      return;
    }

    if (body.action !== "create") {
      await route.fulfill({
        body: JSON.stringify({ error: "Unexpected project action" }),
        contentType: "application/json",
        status: 400
      });
      return;
    }

    projectCreateCallCount += 1;

    await route.fulfill({
      body: JSON.stringify({
        project: {
          createdAt: "2026-07-06T00:00:00.000Z",
          description: "",
          id: "project_onboarding_team_demo",
          name: body.values?.name,
          runtimeApplicationId: "app_onboarding_team_demo",
          status: body.values?.status ?? "DRAFT",
          tenantId: String(body.tenantId ?? savedProviderValues.tenantId ?? draftTenantId),
          totalBudgetUsd: body.values?.totalBudgetUsd,
          updatedAt: "2026-07-06T00:00:00.000Z"
        },
        status: 201
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.route("**/api/control-plane/teams", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      values?: Record<string, unknown>;
    };

    if (body.action === "create") {
      await route.fulfill({
        body: JSON.stringify({
          status: 201,
          team: {
            createdAt: "2026-07-06T00:00:00.000Z",
            description: body.values?.description,
            id: "team_field_ops",
            name: body.values?.name,
            projectCount: 0,
            status: "ACTIVE",
            tenantId: "tenant_demo_acme",
            updatedAt: "2026-07-06T00:00:00.000Z"
          }
        }),
        contentType: "application/json",
        status: 200
      });
      return;
    }

    if (body.action === "attach") {
      await route.fulfill({
        body: JSON.stringify({ error: "Team attach should happen inside onboarding API key issue." }),
        contentType: "application/json",
        status: 400
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ error: "Unexpected team action" }),
      contentType: "application/json",
      status: 400
    });
  });

  await page.route("**/api/control-plane/provider-connections", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      tenantId?: string;
      values?: Record<string, unknown>;
    };

    if (body.action === "discover-models") {
      await route.fulfill({
        body: JSON.stringify({
          discovery: {
            adapterType: "openai_compatible",
            baseUrl: "https://api.openai.com/v1",
            credentialRequired: true,
            discoveredAt: "2026-07-07T04:21:48.000Z",
            modelCount: 5,
            models: [
              {
                createdAt: null,
                displayName: "chat-latest",
                modelName: "chat-latest",
                object: "model",
                ownedBy: "openai",
                provider: "openai",
                providerId: "provider_onboarding_openai"
              },
              {
                createdAt: null,
                displayName: "gpt-4o",
                modelName: "gpt-4o",
                object: "model",
                ownedBy: "openai",
                provider: "openai",
                providerId: "provider_onboarding_openai"
              },
              {
                createdAt: null,
                displayName: "gpt-4o-mini",
                modelName: "gpt-4o-mini",
                object: "model",
                ownedBy: "openai",
                provider: "openai",
                providerId: "provider_onboarding_openai"
              },
              {
                createdAt: null,
                displayName: "gpt-4.1",
                modelName: "gpt-4.1",
                object: "model",
                ownedBy: "openai",
                provider: "openai",
                providerId: "provider_onboarding_openai"
              },
              {
                createdAt: null,
                displayName: "text-embedding-3-small",
                modelName: "text-embedding-3-small",
                object: "model",
                ownedBy: "openai",
                provider: "openai",
                providerId: "provider_onboarding_openai"
              }
            ],
            provider: "openai",
            providerId: "provider_onboarding_openai"
          },
          status: 200
        }),
        contentType: "application/json",
        status: 200
      });
      return;
    }

    if (body.action !== "upsert") {
      await route.fulfill({
        body: JSON.stringify({ error: "Unexpected provider action" }),
        contentType: "application/json",
        status: 400
      });
      return;
    }

    savedProviderValues = body.values ?? {};

    await route.fulfill({
      body: JSON.stringify({
        provider: {
          baseUrl: savedProviderValues.baseUrl,
          createdAt: "2026-07-06T00:00:00.000Z",
          credentialPreview: {
            last4: "demo",
            prefix: "test"
          },
          displayName: savedProviderValues.displayName,
          id: "provider_onboarding_openai",
          projectId: null,
          provider: "openai",
          providerConfig: {
            adapterType: savedProviderValues.adapterType,
            credentialRequired: savedProviderValues.credentialRequired,
            models: String(savedProviderValues.models ?? "")
              .split(",")
              .map((model) => model.trim())
              .filter(Boolean),
            requestFormat: savedProviderValues.requestFormat
          },
          resolver: savedProviderValues.resolver,
          status: savedProviderValues.status,
          tenantId: String(body.tenantId ?? draftTenantId),
          timeoutMs: savedProviderValues.timeoutMs,
          updatedAt: "2026-07-06T00:00:00.000Z"
        },
        status: 201
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.route("**/api/control-plane/api-keys", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      values?: Record<string, unknown> & {
        project?: Record<string, unknown>;
        teamIds?: string[];
      };
    };
    apiKeyAction = body.action ?? "";
    draftProjectValues = body.values?.project ?? {};
    draftTenantId = String(body.values?.tenantId ?? draftTenantId);
    draftTeamIds = body.values?.teamIds ?? [];

    if (body.action !== "issueForOnboardingDraftProject") {
      await route.fulfill({
        body: JSON.stringify({ error: "Unexpected API Key action" }),
        contentType: "application/json",
        status: 400
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        apiKey: {
          createdAt: "2026-07-06T00:00:00.000Z",
          credentialId: "cred_onboarding_team_demo",
          credentialType: "api_key",
          expiresAt: null,
          last4: "team",
          plaintext: issuedPlaintext,
          plaintextShownOnce: true,
          prefix: "gatelm",
          scopes: ["gateway:invoke"],
          status: "active",
          warning: "Store this value now."
        },
        project: {
          createdAt: "2026-07-06T00:00:00.000Z",
          description: body.values?.project?.description ?? "",
          id: "project_onboarding_team_demo",
          name: body.values?.project?.name,
          runtimeApplicationId: "app_onboarding_team_demo",
          status: "DRAFT",
          tenantId: draftTenantId,
          totalBudgetUsd: body.values?.project?.totalBudgetUsd,
          updatedAt: "2026-07-06T00:00:00.000Z",
          warningThresholdPercent: body.values?.project?.warningThresholdPercent
        },
        status: 201
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepareAuthenticatedConsole(context, request);
  await page.goto("/tenants/tenant_demo_acme/onboarding");

  await page.getByRole("textbox", { name: "Project name" }).fill("Team enabled project");
  const teamGroup = page.getByRole("group", { name: "Team" });
  const teamToggle = teamGroup.getByRole("button", { name: "Select teams" });
  await teamToggle.click();

  const firstTeamOption = teamGroup.getByRole("option").first();
  await expect(firstTeamOption).toBeVisible();
  firstAttachedTeamId = (await firstTeamOption.getAttribute("data-team-id")) ?? "";
  const firstTeamName = (await firstTeamOption.locator("strong").textContent())?.trim() ?? "";
  await firstTeamOption.click();

  await expect(teamGroup.getByRole("listbox", { name: "Team options" })).toBeHidden();
  const selectedTeamTag = teamGroup.getByRole("button", {
    name: new RegExp(`Remove ${escapeRegExp(firstTeamName)}`)
  });
  await expect(selectedTeamTag).toBeVisible();
  await selectedTeamTag.click();
  await expect(
    teamGroup.getByRole("button", { name: new RegExp(`Remove ${escapeRegExp(firstTeamName)}`) })
  ).toHaveCount(0);

  await teamToggle.click();
  await firstTeamOption.click();

  await page.getByRole("button", { name: "Create team" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create team" });
  await createDialog.getByRole("textbox", { name: "Name" }).fill("Field Ops");
  await createDialog.getByRole("textbox", { name: "Description" }).fill("Incident response");
  await createDialog.getByRole("button", { name: "Create team" }).click();

  await expect(teamGroup.getByRole("button", { name: "Remove Field Ops" })).toBeVisible();

  await expect(page.getByLabel("Model")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Previous|이전/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  expect(projectCreateCallCount).toBe(0);
  await expect(page.locator(".onboarding-step").nth(1)).toHaveAttribute("data-active", "true");
  const providerPreviousButton = page.getByRole("button", { name: /Previous|이전/ });
  await expect(providerPreviousButton).toBeEnabled();
  await providerPreviousButton.click();
  await expect(page.locator(".onboarding-step").nth(0)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await expect(page.locator(".onboarding-step").nth(1)).toHaveAttribute("data-active", "true");
  await expect(providerPreviousButton).toBeEnabled();
  await expect(
    page.getByRole("heading", {
      name: /Register Provider model key \(optional\)|Provider 모델 Key 등록 \(선택\)/
    })
  ).toBeVisible();
  await page.getByRole("button", { name: "Choose OpenAI" }).click();
  await page.getByLabel("Provider API Key").fill("test-key-not-a-secret");
  await page.getByRole("button", { name: "Add selected model key" }).click();
  await expect(page.getByText("Provider saved.")).toBeVisible();

  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await expect(page.locator(".onboarding-step").nth(2)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("heading", { name: /Integration guide|연동 가이드/ })).toBeVisible();
  await expect(page.getByText(["App", "Token"].join(" "))).toHaveCount(0);
  await expect(page.getByText(issuedPlaintext)).toHaveCount(0);
  const integrationPreviousButton = page.getByRole("button", { name: /Previous|이전/ });
  await expect(integrationPreviousButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "Copy document" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run test" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy placeholder" })).toHaveCount(0);
  await expect(page.getByText("Required values")).toHaveCount(0);

  const saveToProjectsButton = page.getByRole("button", {
    name: /Create project|프로젝트 생성/
  });
  await expect(saveToProjectsButton).toBeDisabled();
  await page.getByRole("button", { name: "Create API Key" }).click();
  await expect(page.getByText(issuedPlaintext)).toBeVisible();
  await expect(saveToProjectsButton).toBeEnabled();

  await integrationPreviousButton.click();
  await expect(page.locator(".onboarding-step").nth(1)).toHaveAttribute("data-active", "true");
  await expect(page.getByText(issuedPlaintext)).toHaveCount(0);
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await expect(page.locator(".onboarding-step").nth(2)).toHaveAttribute("data-active", "true");
  await expect(page.getByText(issuedPlaintext)).toHaveCount(0);
  await expect(page.locator(".one-time-secret")).toHaveAttribute("data-hidden", "true");
  await expect(page.getByText(/Plaintext hidden|원문은 숨겨졌습니다/)).toBeVisible();
  await expect(saveToProjectsButton).toBeEnabled();

  const latestRequestLink = page.getByRole("link", { name: "Review latest request" });
  const projectPolicyLink = page.getByRole("link", { name: "Project Policy settings" });

  await expect(latestRequestLink).toHaveAttribute(
    "href",
    `/tenants/${draftTenantId}/request-logs?latest=project&projectId=project_onboarding_team_demo&applicationId=app_onboarding_team_demo`
  );
  await expect(projectPolicyLink).toHaveAttribute(
    "href",
    `/tenants/${draftTenantId}/projects/project_onboarding_team_demo/policies`
  );
  expect(projectCreateCallCount).toBe(0);
  expect(apiKeyAction).toBe("issueForOnboardingDraftProject");
  expect(draftProjectValues).toMatchObject({
    name: "Team enabled project",
    status: "DRAFT",
    warningThresholdPercent: 80
  });
  expect(draftProjectValues).not.toHaveProperty("selectedModelKey");
  expect(draftProjectValues).not.toHaveProperty("budgetLimitPercent");
  expect(draftTeamIds).toEqual(expect.arrayContaining(["team_field_ops", firstAttachedTeamId]));
  expect(new Set(draftTeamIds).size).toBe(draftTeamIds.length);
  await page.locator("form.onboarding-form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  await expect.poll(() => updatedProjectValues.status).toBe("ACTIVE");
  await expect.poll(() => projectUpdateCallCount).toBe(1);
  await expect(
    page.getByText(
      "Project saved / policy setup incomplete. Runtime Policy bootstrap publish failed."
    )
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry policy setup" })).toBeVisible();
  expect(projectCreateCallCount).toBe(0);
  await page.locator("form.onboarding-form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  await expect.poll(() => projectUpdateCallCount).toBe(2);
  expect(updatedProjectValues).toMatchObject({
    selectedModelKey: expect.any(String),
    status: "ACTIVE",
    warningThresholdPercent: 80
  });
  expect(updatedProjectValues.projectId).toBe("project_onboarding_team_demo");
  expect(projectCreateCallCount).toBe(0);
});

test("create project shows the Control Plane project conflict message", async ({
  context,
  page,
  request
}) => {
  await page.route("**/api/control-plane/api-keys", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: "Project budgets exceed the tenant budget.",
        status: 409
      }),
      contentType: "application/json",
      status: 409
    });
  });

  await prepareAuthenticatedConsole(context, request);
  await page.goto("/tenants/tenant_demo_acme/onboarding");
  await page.getByRole("textbox", { name: "Project name" }).fill("Budget conflict project");
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await page.getByRole("button", { name: "Create API Key" }).click();

  await expect(page.getByText("Project budgets exceed the tenant budget.")).toBeVisible();
  await expect(page.locator(".onboarding-step").nth(2)).toHaveAttribute("data-active", "true");
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function prepareAuthenticatedConsole(
  context: BrowserContext,
  request: APIRequestContext
) {
  const sessionCookie = await createConsoleSessionCookie(request);

  await context.addCookies(
    e2eCookieUrls.flatMap((url) => [
      {
        name: "gatelm_session",
        url,
        value: sessionCookie
      },
      {
        name: "gatelm_locale",
        url,
        value: "en"
      }
    ])
  );
}

async function createConsoleSessionCookie(request: APIRequestContext) {
  const email = `onboarding-e2e-${randomUUID()}@example.invalid`;
  const signupResponse = await request.post(`${controlPlaneBaseUrl}/api/auth/signup`, {
    data: {
      email,
      name: "Onboarding E2E",
      password: "correct-horse-battery-staple"
    }
  });

  expect(signupResponse.ok()).toBeTruthy();

  const organizationResponse = await request.post(
    `${controlPlaneBaseUrl}/api/auth/organizations`,
    {
      data: {
        organizationName: `Onboarding E2E ${randomUUID().slice(0, 8)}`
      }
    }
  );

  expect(organizationResponse.ok()).toBeTruthy();

  const organizationPayload = (await organizationResponse.json()) as {
    data?: {
      tenant?: {
        id?: string;
      };
    };
  };
  const tenantId = organizationPayload.data?.tenant?.id ?? "";
  expect(tenantId).not.toBe("");

  const teamResponse = await request.post(
    `${controlPlaneBaseUrl}/admin/v1/tenants/${encodeURIComponent(tenantId)}/teams`,
    {
      data: {
        description: "Existing team used by onboarding E2E.",
        name: `Onboarding E2E Team ${randomUUID().slice(0, 8)}`
      }
    }
  );

  expect(teamResponse.ok()).toBeTruthy();

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

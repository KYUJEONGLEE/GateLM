import { expect, test } from "@playwright/test";

test("create project can select existing teams and create a team inline before attaching all selected teams", async ({
  context,
  page
}) => {
  const attachedTeamIds: string[] = [];
  const issuedPlaintext = "gatelm_test_onboarding_team_demo";
  let createdProjectValues: Record<string, unknown> = {};
  let savedProviderValues: Record<string, unknown> = {};
  let firstAttachedTeamId = "";
  let selectedProviderModel = "";
  let updatedProjectValues: Record<string, unknown> = {};

  await page.route("**/api/control-plane/projects", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      values?: Record<string, unknown>;
    };

    if (body.action === "update") {
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
            tenantId: "tenant_demo_acme",
            totalBudgetUsd: body.values?.totalBudgetUsd,
            updatedAt: "2026-07-06T00:10:00.000Z"
          },
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

    createdProjectValues = body.values ?? {};

    await route.fulfill({
      body: JSON.stringify({
        project: {
          createdAt: "2026-07-06T00:00:00.000Z",
          description: "",
          id: "project_onboarding_team_demo",
          name: body.values?.name,
          runtimeApplicationId: "app_onboarding_team_demo",
          status: body.values?.status ?? "DRAFT",
          tenantId: "tenant_demo_acme",
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
      attachedTeamIds.push(String(body.values?.teamId));
      await route.fulfill({
        body: JSON.stringify({
          projectTeam: {
            assignedAt: "2026-07-06T00:00:00.000Z",
            id: `project_team_${body.values?.teamId}`,
            projectId: body.values?.projectId,
            teamDescription: "",
            teamId: body.values?.teamId,
            teamName: body.values?.teamId,
            teamStatus: "ACTIVE",
            tenantId: "tenant_demo_acme"
          },
          status: 201
        }),
        contentType: "application/json",
        status: 200
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
          provider: savedProviderValues.provider,
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
          tenantId: "tenant_demo_acme",
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
        status: 201
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tenants/tenant_demo_acme/onboarding");

  await page.getByRole("textbox", { name: "Project name" }).fill("Team enabled project");
  await page.getByRole("textbox", { name: "Warning threshold" }).fill("75");
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
  await expect(page.locator(".onboarding-step").nth(0)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("textbox", { name: "API Key name" })).toBeVisible();
  await expect(page.getByLabel("Publish state")).toBeVisible();
  await expect(page.locator(".onboarding-field > span").filter({ hasText: /^Cache$/ })).toBeVisible();
  await expect(page.getByLabel("Safety mode")).toBeVisible();
  const projectPreviousButton = page.getByRole("button", { name: /Previous|이전/ });
  await expect(projectPreviousButton).toBeEnabled();
  await projectPreviousButton.click();
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
  await expect(page.getByLabel("Model")).toHaveCount(0);
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await expect(page.getByRole("textbox", { name: "API Key name" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save and continue|저장 후 다음/ })).toBeDisabled();
  await page.getByRole("button", { name: "Create API Key" }).click();
  await expect(page.getByText(issuedPlaintext)).toBeVisible();
  const projectDoneButton = page.getByRole("button", {
    name: /Save and continue|저장 후 다음/
  });
  await expect(projectDoneButton).toBeEnabled();
  await projectDoneButton.click();
  await expect(page.locator(".onboarding-step").nth(1)).toHaveAttribute("data-active", "true");
  const providerPreviousButton = page.getByRole("button", { name: /Previous|이전/ });
  await expect(providerPreviousButton).toBeEnabled();
  await providerPreviousButton.click();
  await expect(page.locator(".onboarding-step").nth(0)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("textbox", { name: "API Key name" })).toBeVisible();
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await expect(page.locator(".onboarding-step").nth(1)).toHaveAttribute("data-active", "true");
  await expect(providerPreviousButton).toBeEnabled();
  await expect(
    page.getByRole("heading", {
      name: /Register Provider model key \(optional\)|Provider 모델 Key 등록 \(선택\)/
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose OpenAI" })).toBeVisible();

  await page.getByRole("button", { name: "Choose OpenAI" }).click();
  const providerApiKeyInput = page.locator('input[type="password"]');
  await expect(providerApiKeyInput).toBeVisible();
  await expect(page.getByText(/Provider key saved|Provider key가 저장되어 있습니다/)).toHaveCount(0);
  await expect(page.getByText(/provided_.*C_MA/)).toHaveCount(0);
  const projectDefaultHeading = page.getByRole("heading", {
    name: /Project default 모델 선택|Project default model/
  });
  const addModelKeyButton = page.getByRole("button", {
    name: /Add selected model key|선택한 모델 Key 추가/
  });
  await expect(projectDefaultHeading).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Provider selectable models|Provider 모델 선택/ })).toHaveCount(0);
  const addModelKeyBox = await addModelKeyButton.boundingBox();
  const apiKeyBox = await providerApiKeyInput.boundingBox();
  expect(apiKeyBox?.y).toBeLessThan(addModelKeyBox?.y ?? 0);
  await addModelKeyButton.click();
  await expect(page.getByText(/Choose a provider and enter the provider API key|Provider를 선택/)).toBeVisible();
  await providerApiKeyInput.fill("synthetic_onboarding_credential");
  await addModelKeyButton.click();
  await expect(page.getByText(/Provider saved|Provider가 저장되었습니다/)).toBeVisible();
  const providerModelPanel = page.getByRole("group", {
    name: /Provider selectable models|Provider 모델 선택/
  });
  await expect(providerModelPanel).toBeVisible();
  await expect(providerModelPanel.getByRole("checkbox", { name: "gpt-4o", exact: true })).toBeVisible();
  await expect(providerModelPanel.getByRole("checkbox", { name: "gpt-4o-mini", exact: true })).toBeVisible();
  await expect(providerModelPanel.getByText("text-embedding-3-small")).toHaveCount(0);
  await providerModelPanel.getByRole("checkbox", { name: "gpt-4o", exact: true }).check();
  await providerModelPanel.getByRole("button", { name: /Save selected models|선택 모델 저장/ }).click();
  await expect(page.getByText(/Selected provider models saved|선택 모델을 저장했습니다/)).toBeVisible();

  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await expect(page.locator(".onboarding-step").nth(1)).toHaveAttribute("data-active", "true");
  await expect(projectDefaultHeading).toBeVisible();
  const projectDefaultModelSelect = page.getByLabel(/Model|모델 선택/);
  await expect(projectDefaultModelSelect).toBeVisible();
  selectedProviderModel = await projectDefaultModelSelect.inputValue();
  const providerDefaultPreviousButton = page.getByRole("button", { name: /Previous|이전/ });
  await expect(providerDefaultPreviousButton).toBeEnabled();
  await providerDefaultPreviousButton.click();
  await expect(page.locator(".onboarding-step").nth(1)).toHaveAttribute("data-active", "true");
  await expect(
    page.getByRole("heading", {
      name: /Register Provider model key \(optional\)|Provider 모델 Key 등록 \(선택\)/
    })
  ).toBeVisible();
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await expect(projectDefaultHeading).toBeVisible();
  await expect(projectDefaultModelSelect).toBeVisible();
  selectedProviderModel = await projectDefaultModelSelect.inputValue();

  const completeProjectButton = page.getByRole("button", {
    name: /Create Project|Project 생성/
  });
  await expect(completeProjectButton).toBeEnabled();
  await completeProjectButton.click();
  await expect(page.locator(".onboarding-step").nth(2)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("heading", { name: /Integration guide|연동 가이드/ })).toBeVisible();
  await expect(page.getByText(["App", "Token"].join(" "))).toHaveCount(0);
  await expect(page.getByText(issuedPlaintext)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Previous|이전/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy document" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run test" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy placeholder" })).toHaveCount(0);
  await expect(page.getByText("Required values")).toHaveCount(0);

  const latestRequestLink = page.getByRole("link", { name: "Review latest request" });
  const projectPolicyLink = page.getByRole("link", { name: "Project Policy settings" });

  await expect(latestRequestLink).toHaveAttribute(
    "href",
    "/tenants/tenant_demo_acme/request-logs?latest=project&projectId=project_onboarding_team_demo&applicationId=app_onboarding_team_demo"
  );
  await expect(projectPolicyLink).toHaveAttribute(
    "href",
    "/tenants/tenant_demo_acme/projects/project_onboarding_team_demo/policies"
  );
  expect(createdProjectValues).toMatchObject({
    name: "Team enabled project",
    status: "DRAFT",
    warningThresholdPercent: 75
  });
  expect(createdProjectValues).not.toHaveProperty("selectedModelKey");
  expect(createdProjectValues).not.toHaveProperty("budgetLimitPercent");
  expect(updatedProjectValues).toMatchObject({
    selectedModelKey: expect.any(String),
    status: "ACTIVE",
    warningThresholdPercent: 75
  });
  expect(savedProviderValues).toMatchObject({
    provider: "openai"
  });
  expect(
    String(savedProviderValues.models)
      .split(",")
      .map((model) => model.trim())
  ).toContain(selectedProviderModel.split("::").pop());
  await expect.poll(() => attachedTeamIds.length).toBe(2);
  expect(attachedTeamIds).toContain("team_field_ops");
  expect(attachedTeamIds).toContain(firstAttachedTeamId);
  expect(new Set(attachedTeamIds).size).toBe(attachedTeamIds.length);
});

test("create project shows the Control Plane project conflict message", async ({ page }) => {
  await page.route("**/api/control-plane/projects", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: "Project budgets exceed the tenant budget.",
        status: 409
      }),
      contentType: "application/json",
      status: 409
    });
  });

  await page.goto("/tenants/tenant_demo_acme/onboarding");
  await page.getByRole("textbox", { name: "Project name" }).fill("Budget conflict project");
  await page.getByRole("button", { name: /Save and continue|저장 후 다음/ }).click();
  await page.getByRole("button", { name: "Create API Key" }).click();

  await expect(page.getByText("Project budgets exceed the tenant budget.")).toBeVisible();
  await expect(page.locator(".onboarding-step").nth(0)).toHaveAttribute("data-active", "true");
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

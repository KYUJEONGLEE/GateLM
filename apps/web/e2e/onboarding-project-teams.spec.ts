import { expect, test } from "@playwright/test";

test("create project can select existing teams and create a team inline before attaching all selected teams", async ({
  context,
  page
}) => {
  const attachedTeamIds: string[] = [];
  const issuedPlaintext = "gatelm_test_onboarding_team_demo";
  let createdProjectValues: Record<string, unknown> = {};
  let firstAttachedTeamId = "";

  await page.route("**/api/control-plane/projects", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      values?: Record<string, unknown>;
    };

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
          runtimeApplicationId: "application_onboarding_team_demo",
          status: "ACTIVE",
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

  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Create API Key" }).click();

  await expect(page.getByText(issuedPlaintext)).toBeVisible();
  const copyApiKeyButton = page.getByRole("button", { name: "Copy API Key" });
  await expect(copyApiKeyButton).toBeVisible();
  await copyApiKeyButton.click();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(issuedPlaintext);
  await expect(copyApiKeyButton).toHaveAttribute("data-copied", "true");
  expect(createdProjectValues).toMatchObject({
    name: "Team enabled project"
  });
  expect(createdProjectValues).not.toHaveProperty("budgetLimitPercent");
  expect(createdProjectValues).not.toHaveProperty("providerConnectionIds");
  expect(createdProjectValues).not.toHaveProperty("selectedModelKey");
  expect(createdProjectValues).not.toHaveProperty("warningThresholdPercent");
  await expect.poll(() => attachedTeamIds.length).toBe(2);
  expect(attachedTeamIds).toContain("team_field_ops");
  expect(attachedTeamIds).toContain(firstAttachedTeamId);
  expect(new Set(attachedTeamIds).size).toBe(attachedTeamIds.length);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

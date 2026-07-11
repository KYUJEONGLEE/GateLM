import { expect, test } from "@playwright/test";

const tenantId = "tenant_demo_acme";
const projectsPath = `/tenants/${tenantId}/projects`;

test("project cards expose usage sorting and open from the full card", async ({ page }) => {
  await page.goto(projectsPath);

  const createProjectLink = page.getByRole("link", { exact: true, name: "Create Project" });

  await expect(createProjectLink).toHaveCount(1);
  await expect(createProjectLink).toHaveAttribute(
    "href",
    `/tenants/${tenantId}/onboarding`
  );

  const budgetSort = page.getByRole("button", { exact: true, name: "Budget used" });
  const tokenSort = page.getByRole("button", { exact: true, name: "Token usage" });

  await expect(budgetSort).toHaveAttribute("aria-pressed", "true");
  await tokenSort.click();
  await expect(tokenSort).toHaveAttribute("aria-pressed", "true");

  const projectCard = page.getByTestId("project-card").first();
  const policyPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+/policies$`);

  await expect(projectCard).toHaveAttribute("href", policyPattern);
  await expect(projectCard).toHaveAttribute("aria-label", /Manage project$/);

  await projectCard.getByRole("heading").click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}/[^/]+/policies$`));
  await expect(page.getByRole("tab", { exact: true, name: "General" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

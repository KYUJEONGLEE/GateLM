import { expect, test } from "@playwright/test";

const tenantId = "tenant_demo_acme";
const projectsPath = `/tenants/${tenantId}/projects`;

test("project cards expose the original usage presentation and open from the full card", async ({ page }) => {
  await page.goto(projectsPath);

  const createProjectLink = page.getByRole("link", { exact: true, name: "Create Project" });

  await expect(createProjectLink).toHaveCount(1);
  await expect(createProjectLink).toHaveAttribute(
    "href",
    `/tenants/${tenantId}/onboarding`
  );

  const usageSort = page.getByRole("button", { exact: true, name: "Usage" });
  const budgetSort = page.getByRole("button", { exact: true, name: "Budget" });

  await expect(usageSort).toHaveAttribute("aria-pressed", "true");
  await budgetSort.click();
  await expect(budgetSort).toHaveAttribute("aria-pressed", "true");

  const projectCard = page.getByTestId("project-card").first();
  const policyPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+/policies$`);

  await expect(projectCard).toHaveAttribute("href", policyPattern);
  await expect(projectCard).toHaveAttribute("aria-label", /Edit project$/);

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

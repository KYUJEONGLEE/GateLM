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
  const latestSort = page.getByRole("button", { exact: true, name: "Latest" });

  await expect(usageSort).toHaveAttribute("aria-pressed", "true");
  await latestSort.click();
  await expect(latestSort).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { exact: true, name: "Budget" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Limit risk" })).toHaveCount(0);

  const projectCard = page.getByTestId("project-card").first();
  const policyPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+/policies$`);

  await expect(projectCard).toHaveAttribute("href", policyPattern);
  await expect(projectCard).toHaveAttribute("aria-label", /Project settings$/);

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

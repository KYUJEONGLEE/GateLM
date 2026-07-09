import { expect, test } from "@playwright/test";

const tenantId = "tenant_demo_acme";
const projectsPath = `/tenants/${tenantId}/projects`;

test("project cards expose sorting and action links", async ({ page }) => {
  await page.goto(projectsPath);

  const usageSort = page.getByRole("button", { exact: true, name: "Usage" });
  const budgetSort = page.getByRole("button", { exact: true, name: "Budget" });

  await expect(usageSort).toHaveAttribute("aria-pressed", "true");
  await budgetSort.click();
  await expect(budgetSort).toHaveAttribute("aria-pressed", "true");

  const projectCard = page.getByTestId("project-card").first();
  const editProjectLink = projectCard.getByRole("link", { exact: true, name: "Edit project" });
  const policyPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+/policies$`);

  await expect(projectCard.getByRole("link", { exact: true, name: "Edit" })).toHaveCount(0);
  await expect(projectCard.getByRole("link", { exact: true, name: "Edit policy" })).toHaveCount(0);
  await expect(editProjectLink).toHaveAttribute("href", policyPattern);
  await expect(projectCard).not.toHaveAttribute("role", "link");
  await expect(projectCard).not.toHaveAttribute("tabindex", "0");

  const editProjectHref = await editProjectLink.getAttribute("href");

  expect(editProjectHref).toBeTruthy();
  expect(editProjectHref).not.toContain("/applications/");

  await projectCard.getByRole("heading").click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}$`));

  await editProjectLink.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}/[^/]+/policies$`));
  await expect(page.getByRole("tab", { exact: true, name: "General" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

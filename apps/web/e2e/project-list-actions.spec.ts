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
  const editLink = projectCard.getByRole("link", { exact: true, name: "Edit" });
  const policyLink = projectCard.getByRole("link", { exact: true, name: "Edit policy" });
  const projectDetailPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+$`);
  const policyPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+/policies$`);

  await expect(editLink).toHaveAttribute("href", projectDetailPattern);
  await expect(policyLink).toHaveAttribute("href", policyPattern);
  await expect(projectCard).not.toHaveAttribute("role", "link");
  await expect(projectCard).not.toHaveAttribute("tabindex", "0");

  const editHref = await editLink.getAttribute("href");
  const policyHref = await policyLink.getAttribute("href");

  expect(editHref).toBeTruthy();
  expect(policyHref).toBeTruthy();
  expect(policyHref).not.toContain("/applications/");

  await projectCard.getByRole("heading").click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}$`));

  await editLink.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(editHref ?? "")}$`));

  await page.goto(projectsPath);
  const currentPolicyLink = page.getByTestId("project-card").first().getByRole("link", {
    exact: true,
    name: "Edit policy"
  });
  const currentPolicyHref = await currentPolicyLink.getAttribute("href");

  expect(currentPolicyHref).toBeTruthy();

  await currentPolicyLink.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}/[^/]+/policies$`));
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

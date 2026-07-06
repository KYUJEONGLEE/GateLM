import { expect, test } from "@playwright/test";

const tenantId = "tenant_demo_acme";
const projectsPath = `/tenants/${tenantId}/projects`;

test("project list rows expose edit and policy edit links", async ({ page }) => {
  await page.goto(projectsPath);

  const row = page.locator("tbody tr").first();
  const editLink = row.getByRole("link", { exact: true, name: "Edit" });
  const policyLink = row.getByRole("link", { exact: true, name: "Edit policy" });
  const projectDetailPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+$`);
  const policyPattern = new RegExp(
    `^${escapeRegExp(projectsPath)}/[^/]+/applications/[^/]+/policies$`
  );

  await expect(editLink).toHaveAttribute("href", projectDetailPattern);
  await expect(policyLink).toHaveAttribute("href", policyPattern);
  await expect(row).not.toHaveAttribute("role", "link");
  await expect(row).not.toHaveAttribute("tabindex", "0");

  const editHref = await editLink.getAttribute("href");
  const policyHref = await policyLink.getAttribute("href");

  expect(editHref).toBeTruthy();
  expect(policyHref).toBeTruthy();

  await row.locator("td").first().click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}$`));

  await editLink.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(editHref ?? "")}$`));

  await page.goto(projectsPath);
  await page.locator("tbody tr").first().getByRole("link", {
    exact: true,
    name: "Edit policy"
  }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(policyHref ?? "")}$`));
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

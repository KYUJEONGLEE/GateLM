import { expect, test } from "@playwright/test";
import { getConsoleNavigationState } from "./console-navigation";

test("tenant management route activates the tenant management nav item", () => {
  expect(getConsoleNavigationState("/tenants/tenant_demo_acme/tenants")).toEqual({
    activeManagementItem: "tenant",
    activeSection: "management"
  });
});

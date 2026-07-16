import { expect, test } from "@playwright/test";
import { getConsoleNavigationState } from "./console-navigation";

test("legacy company policy route activates the Chat App nav item", () => {
  expect(getConsoleNavigationState("/tenants/tenant_demo_acme/tenants")).toEqual({
    activeManagementItem: "chat-app",
    activeSection: "management"
  });
});

test("API management route activates the API Key management nav item", () => {
  expect(getConsoleNavigationState("/tenants/tenant_demo_acme/api-keys")).toEqual({
    activeManagementItem: "api-keys",
    activeSection: "management"
  });
});

test("Chat App and legacy Tenant Chat routes activate one management item", () => {
  expect(getConsoleNavigationState("/tenants/tenant_demo_acme/chat-app")).toEqual({
    activeManagementItem: "chat-app",
    activeSection: "management"
  });
  expect(getConsoleNavigationState("/tenants/tenant_demo_acme/tenant-chat")).toEqual({
    activeManagementItem: "chat-app",
    activeSection: "management"
  });
});

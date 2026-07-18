import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getConsoleNavigationState } from "./console-navigation";

const shellSource = readFileSync(new URL("./console-shell.tsx", import.meta.url), "utf8");
const apiKeyManagementSource = readFileSync(
  new URL("../../features/api-keys/components/api-key-management.tsx", import.meta.url),
  "utf8"
);

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

test("sidebar omits inactive alerts and consistently names API Key management", () => {
  expect(shellSource).not.toContain('item: "alerts"');
  expect(shellSource).toContain('en: "API Key Management"');
  expect(shellSource).toContain('ko: "API Key 관리"');
  expect(apiKeyManagementSource).toContain('title: "API Key Management"');
  expect(apiKeyManagementSource).toContain('title: "API Key 관리"');
});

test("user menu trigger keeps a stable id across server and client renders", () => {
  expect(shellSource).toContain(
    'const userMenuTriggerId = "gatelm-console-user-menu-trigger";'
  );
  expect(shellSource).toMatch(/<DropdownMenuTrigger[\s\S]*?id=\{userMenuTriggerId\}/);
});

test("profile avatars use a person silhouette when no image is available", () => {
  expect(shellSource.match(/console-user-avatar-placeholder/g)).toHaveLength(2);
  expect(shellSource).toContain("<UserRound");
  expect(shellSource).not.toContain("getUserInitials");
});

test("profile role localizes Tenant Admin for the Korean console", () => {
  expect(shellSource).toContain('tenantAdmin: "Tenant Admin"');
  expect(shellSource).toContain('tenantAdmin: "관리자"');
  expect(shellSource).toContain('displayUser.role === "Tenant Admin" ? text.tenantAdmin');
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
  expect(getConsoleNavigationState("/tenants/tenant_demo_acme/knowledge-documents")).toEqual({
    activeManagementItem: "chat-app",
    activeSection: "management"
  });
});

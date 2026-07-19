import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getConsoleNavigationState } from "./console-navigation";

const shellSource = readFileSync(new URL("./console-shell.tsx", import.meta.url), "utf8");
const rootLayoutSource = readFileSync(
  new URL("../../app/layout.tsx", import.meta.url),
  "utf8"
);
const tenantLayoutSource = readFileSync(
  new URL("../../app/(console)/tenants/[tenantId]/layout.tsx", import.meta.url),
  "utf8"
);
const tenantsClientSource = readFileSync(
  new URL("../../lib/control-plane/tenants-client.ts", import.meta.url),
  "utf8"
);
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

test("profile shows the resolved organization name without exposing a tenant id fallback", () => {
  expect(tenantLayoutSource).toContain("getControlPlaneTenantName(effectiveTenantId)");
  expect(tenantLayoutSource).toContain("if (currentUser && !currentUser.tenantName)");
  expect(tenantLayoutSource).toContain("{ ...currentUser, tenantName }");
  expect(shellSource).toContain("<dd>{displayUser.tenantName ?? text.organization}</dd>");
  expect(shellSource).not.toContain("<dd>{displayUser.tenantName ?? tenantLabel}</dd>");
});

test("profile tenant name fallback caches successful reads and tolerates malformed list records", () => {
  expect(tenantsClientSource).toContain("const tenantNameCache = new Map");
  expect(tenantsClientSource).toContain("const tenantNameLoads = new Map");
  expect(tenantsClientSource).toContain("if (name) {");
  expect(tenantsClientSource).toContain("cacheTenantName(tenantId, name)");
  expect(tenantsClientSource).toContain("TENANT_NAME_CACHE_MAX_ENTRIES");
  expect(tenantsClientSource).toContain(".filter((tenant): tenant is { id: string; name: string }");
  expect(tenantsClientSource).not.toContain("data.some((tenant) => tenant === null)");
});

test("profile menu hides only the settings heading and keeps its controls", () => {
  expect(shellSource).toContain('className="console-user-settings"');
  expect(shellSource).toContain("<LanguageSwitcher");
  expect(shellSource).toContain('data-active={theme === "light"}');
  expect(shellSource).toContain('data-active={theme === "dark"}');
  expect(shellSource).toContain('data-active={displayMode === "default"}');
  expect(shellSource).toContain('data-active={displayMode === "expanded"}');
  expect(shellSource).not.toMatch(/<header>[\s\S]*?<strong>\{text\.settings\}<\/strong>[\s\S]*?<\/header>/);
});

test("profile menu persists default and expanded display modes without a hydration flash", () => {
  expect(shellSource).toContain(
    'const displayModeStorageKey = "gatelm_console_display_mode";'
  );
  expect(shellSource).toContain("readStoredDisplayMode() ?? readDocumentDisplayMode()");
  expect(shellSource).toContain("writeStoredDisplayMode(nextDisplayMode)");
  expect(shellSource).toContain('displayMode === "expanded" ? "true" : "false"');
  expect(rootLayoutSource).toContain(
    'window.localStorage.getItem("gatelm_console_display_mode")'
  );
  expect(rootLayoutSource).toContain(
    'displayMode === "expanded" ? "true" : "false"'
  );
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

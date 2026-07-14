import { expect, test } from "@playwright/test";

import {
  getTenantChatProviderCreatedHref,
  getTenantChatProviderSetupContext
} from "./tenant-chat-setup-return";

test("accepts only the exact same-tenant Tenant Chat return path", () => {
  const context = getTenantChatProviderSetupContext({
    intent: "tenant-chat-setup",
    returnTo: "/tenants/tenant_demo_acme/tenant-chat",
    tenantId: "tenant_demo_acme"
  });

  expect(context).toEqual({
    intent: "tenant-chat-setup",
    returnTo: "/tenants/tenant_demo_acme/tenant-chat"
  });
  expect(
    getTenantChatProviderCreatedHref(
      context!,
      "22222222-2222-4222-8222-222222222222"
    )
  ).toBe(
    "/tenants/tenant_demo_acme/tenant-chat?onboarding=provider-created&providerConnectionId=22222222-2222-4222-8222-222222222222"
  );
});

test("ignores external and cross-tenant return paths", () => {
  expect(
    getTenantChatProviderSetupContext({
      intent: "tenant-chat-setup",
      returnTo: "https://example.com/steal",
      tenantId: "tenant_demo_acme"
    })
  ).toBeNull();
  expect(
    getTenantChatProviderSetupContext({
      intent: "tenant-chat-setup",
      returnTo: "/tenants/other/tenant-chat",
      tenantId: "tenant_demo_acme"
    })
  ).toBeNull();
});

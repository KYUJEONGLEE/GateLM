import { expect, test } from "@playwright/test";
import type { ApiKeyListItem } from "@/lib/control-plane/api-keys-types";
import {
  attachProjectToApiKeys,
  compareApiKeyCreatedAtDescending,
  containsApiKey,
  containsProject,
  excludeRevokedApiKeys,
  getApiKeyPreviewPrefix
} from "@/lib/control-plane/api-keys-management-model";

test("excludes revoked API Keys from management lists", () => {
  const active = apiKey("key-active");
  const revoked = {
    ...apiKey("key-revoked"),
    status: "revoked" as const
  };
  const apiKeys = [revoked, active];

  expect(excludeRevokedApiKeys(apiKeys)).toEqual([active]);
  expect(apiKeys).toHaveLength(2);
});

test("sorts API Keys by newest creation date first", () => {
  expect(
    compareApiKeyCreatedAtDescending(
      { createdAt: "2026-07-14T12:00:00.000Z" },
      { createdAt: "2026-07-13T12:00:00.000Z" }
    )
  ).toBeLessThan(0);
});

test("places invalid API Key creation dates after valid dates", () => {
  expect(
    compareApiKeyCreatedAtDescending(
      { createdAt: "invalid-left" },
      { createdAt: "2026-07-13T12:00:00.000Z" }
    )
  ).toBeGreaterThan(0);
  expect(
    compareApiKeyCreatedAtDescending(
      { createdAt: "2026-07-13T12:00:00.000Z" },
      { createdAt: "invalid-right" }
    )
  ).toBeLessThan(0);
  expect(
    compareApiKeyCreatedAtDescending(
      { createdAt: "invalid-left" },
      { createdAt: "invalid-right" }
    )
  ).toBe(0);
});

test("uses only the dynamic API Key family in compact previews", () => {
  expect(getApiKeyPreviewPrefix("gsk_live_")).toBe("gsk");
  expect(getApiKeyPreviewPrefix("custom_production_")).toBe("custom");
  expect(getApiKeyPreviewPrefix("opaque")).toBe("opaque");
});

test("attaches the applied project without exposing secret material", () => {
  const result = attachProjectToApiKeys(
    { id: "project-a", name: "Customer Chat" },
    [apiKey("key-a")]
  );

  expect(result).toEqual([
    expect.objectContaining({
      credentialId: "key-a",
      prefix: "gsk_live_",
      projectId: "project-a",
      projectName: "Customer Chat"
    })
  ]);
  expect(JSON.stringify(result)).not.toContain("plaintext");
  expect(JSON.stringify(result)).not.toContain("secretHash");
});

test("checks that a mutation target belongs to the selected project list", () => {
  expect(containsProject([{ id: "project-a", name: "A" }], "project-a")).toBe(true);
  expect(containsProject([{ id: "project-a", name: "A" }], "other-tenant-project")).toBe(false);
  expect(containsApiKey([apiKey("key-a")], "key-a")).toBe(true);
  expect(containsApiKey([apiKey("key-a")], "other-tenant-key")).toBe(false);
});

function apiKey(credentialId: string): ApiKeyListItem {
  return {
    createdAt: "2026-07-13T00:00:00.000Z",
    credentialId,
    credentialType: "api_key",
    displayName: "Production",
    expiresAt: null,
    last4: "A1B2",
    lastUsedAt: null,
    prefix: "gsk_live_",
    projectId: "",
    projectName: "",
    scopes: ["chat:completions"],
    status: "active"
  };
}

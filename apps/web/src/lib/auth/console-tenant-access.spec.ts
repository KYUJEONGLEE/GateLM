import { expect, test } from "@playwright/test";
import { hasConsoleTenantAccess } from "./console-tenant-access";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";

test("tenant admin can access only the matching tenant", () => {
  const auth = {
    isAuthenticated: true,
    memberships: [{ role: "tenant_admin", status: "active", tenantId: tenantA }],
    projectAdmins: []
  };

  expect(hasConsoleTenantAccess(auth, tenantA)).toBe(true);
  expect(hasConsoleTenantAccess(auth, tenantB)).toBe(false);
});

test("project admin can access only the tenant containing an assigned project", () => {
  const auth = {
    isAuthenticated: true,
    memberships: [],
    projectAdmins: [{ projectId: "project-a", tenantId: tenantA }]
  };

  expect(hasConsoleTenantAccess(auth, tenantA)).toBe(true);
  expect(hasConsoleTenantAccess(auth, tenantB)).toBe(false);
});

test("inactive membership and unauthenticated sessions fail closed", () => {
  expect(hasConsoleTenantAccess({
    isAuthenticated: true,
    memberships: [{ role: "tenant_admin", status: "inactive", tenantId: tenantA }],
    projectAdmins: []
  }, tenantA)).toBe(false);

  expect(hasConsoleTenantAccess({
    isAuthenticated: false,
    memberships: [{ role: "tenant_admin", status: "active", tenantId: tenantA }],
    projectAdmins: []
  }, tenantA)).toBe(false);
});

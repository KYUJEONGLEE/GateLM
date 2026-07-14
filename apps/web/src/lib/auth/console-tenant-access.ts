export type ConsoleTenantAccessAuth = {
  isAuthenticated: boolean;
  memberships: Array<{
    role: string;
    status: string;
    tenantId: string;
  }>;
  projectAdmins: Array<{
    projectId: string;
    tenantId: string;
  }>;
};

export function hasConsoleTenantAccess(
  auth: ConsoleTenantAccessAuth,
  tenantId: string
): boolean {
  const normalizedTenantId = tenantId.trim();

  if (!auth.isAuthenticated || !normalizedTenantId) {
    return false;
  }

  const tenantAdmin = auth.memberships.some((membership) => {
    return membership.tenantId === normalizedTenantId
      && membership.status === "active"
      && membership.role === "tenant_admin";
  });

  if (tenantAdmin) {
    return true;
  }

  return auth.projectAdmins.some((projectAdmin) => {
    return projectAdmin.tenantId === normalizedTenantId && Boolean(projectAdmin.projectId);
  });
}

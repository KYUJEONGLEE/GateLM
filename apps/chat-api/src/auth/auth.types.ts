export type TenantEntitlement = {
  actorAuthzVersion: number;
  actorKind: 'tenant_admin' | 'employee';
  employeeId: string | null;
  membershipId: string;
  status: 'active';
  tenantAuthzVersion: number;
  tenantId: string;
  tenantName: string;
  userId: string;
};

export type IdentityResult = {
  tenants: TenantEntitlement[];
  user: {
    actorAuthzVersion: number;
    email: string;
    id: string;
    name: string | null;
  };
};

export type IssuedSession = {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken?: string;
  refreshExpiresAt: string;
  session: PublicSession;
};

export type PublicSession = {
  accessExpiresAt: string;
  csrfRequired: true;
  refreshExpiresAt: string;
  selectedTenant: null | {
    actorKind: 'tenant_admin' | 'employee';
    employeeId: string | null;
    id: string;
    name: string;
  };
  sessionId: string;
  sessionVersion: number;
  state: 'authenticated' | 'tenant_selection_required';
  tenants: Array<{
    actorKind: 'tenant_admin' | 'employee';
    employeeId: string | null;
    id: string;
    name: string;
  }>;
  user: { email: string; id: string; name: string | null };
};

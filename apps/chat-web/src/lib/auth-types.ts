export type ChatSession = {
  accessExpiresAt: string;
  csrfRequired: true;
  refreshExpiresAt: string;
  selectedTenant: TenantOption | null;
  sessionId: string;
  sessionVersion: number;
  state: 'authenticated' | 'tenant_selection_required';
  tenants: TenantOption[];
  user: { email: string; id: string; name: string | null };
};

export type TenantOption = {
  actorKind: 'tenant_admin' | 'employee';
  employeeId: string | null;
  id: string;
  name: string;
};

export type IssuedSession = {
  accessExpiresAt: string;
  accessToken: string;
  refreshExpiresAt: string;
  refreshToken?: string;
  session: ChatSession;
};

export type InvitationSummary = {
  accountState: 'existing' | 'new' | 'reclaimable';
  email: string;
  employeeName: string | null;
  expiresAt: string;
  tenantId: string;
  tenantName: string;
};

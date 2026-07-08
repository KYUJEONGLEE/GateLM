import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { getControlPlaneBaseUrl, getControlPlaneTenantId } from '@/lib/control-plane/control-plane-config';
import type { ProjectRecord } from '@/lib/control-plane/projects-types';

type AuthMembership = {
  role: string;
  status: string;
  tenantId: string;
};

type AuthProjectAdmin = {
  projectId: string;
  projectName: string | null;
  tenantId: string;
};

export type CurrentConsoleUser = {
  avatarUrl?: string;
  displayName: string;
  email?: string;
  id: string;
  role: string;
  tenantName?: string;
};

export type CurrentConsoleAuth = {
  currentUser: CurrentConsoleUser | null;
  isAuthenticated: boolean;
  memberships: AuthMembership[];
  projectAdmins: AuthProjectAdmin[];
  userId: string | null;
};

const authCookieNames = ['gatelm_session', 'gatelm_onboarding'];

export const getCurrentConsoleAuth = cache(async (): Promise<CurrentConsoleAuth> => {
  return getCurrentConsoleAuthForCookieHeader(await getConsoleAuthCookieHeader());
});

export async function getCurrentConsoleAuthForCookieHeader(cookieHeader?: string | null): Promise<CurrentConsoleAuth> {
  if (!cookieHeader) {
    return emptyConsoleAuth();
  }

  const response = await fetch(new URL('/api/auth/me', getControlPlaneBaseUrl()), {
    cache: 'no-store',
    headers: {
      cookie: cookieHeader
    }
  }).catch(() => undefined);

  if (!response?.ok) {
    return emptyConsoleAuth();
  }

  const payload = (await response.json().catch(() => ({}))) as unknown;
  return parseConsoleAuth(payload);
}

export function isTenantAdminForTenant(auth: CurrentConsoleAuth, routeTenantId: string) {
  const tenantId = toControlPlaneTenantId(routeTenantId);
  return auth.memberships.some((membership) => {
    return membership.tenantId === tenantId && membership.status === 'active' && membership.role === 'tenant_admin';
  });
}

export function resolveConsoleTenantIdForAuth(auth: CurrentConsoleAuth, routeTenantId: string) {
  if (isUuid(routeTenantId)) {
    return routeTenantId;
  }

  const tenantAdminMembership = auth.memberships.find((membership) => {
    return membership.tenantId && membership.status === 'active' && membership.role === 'tenant_admin';
  });
  if (tenantAdminMembership?.tenantId) {
    return tenantAdminMembership.tenantId;
  }

  return auth.projectAdmins[0]?.tenantId ?? getControlPlaneTenantId();
}
export function getProjectAdminProjectIdsForTenant(auth: CurrentConsoleAuth, routeTenantId: string) {
  const tenantId = toControlPlaneTenantId(routeTenantId);
  return Array.from(new Set(auth.projectAdmins
    .filter((projectAdmin) => projectAdmin.tenantId === tenantId)
    .map((projectAdmin) => projectAdmin.projectId)
    .filter(Boolean)));
}

export function isProjectScopedForTenant(auth: CurrentConsoleAuth, routeTenantId: string) {
  return auth.isAuthenticated && !isTenantAdminForTenant(auth, routeTenantId) && getProjectAdminProjectIdsForTenant(auth, routeTenantId).length > 0;
}

export function getVisibleProjectsForConsoleAuth(projects: ProjectRecord[], auth: CurrentConsoleAuth, routeTenantId: string) {
  if (!isProjectScopedForTenant(auth, routeTenantId)) {
    return projects;
  }

  const allowedProjectIds = new Set(getProjectAdminProjectIdsForTenant(auth, routeTenantId));
  return projects.filter((project) => allowedProjectIds.has(project.id));
}

export function resolveProjectIdForConsoleAuth(input: {
  auth: CurrentConsoleAuth;
  projects: ProjectRecord[];
  requestedProjectId?: string;
  routeTenantId: string;
}): string | null | undefined {
  const requestedProjectId = input.requestedProjectId?.trim();

  if (!isProjectScopedForTenant(input.auth, input.routeTenantId)) {
    return requestedProjectId || undefined;
  }

  const visibleProjects = getVisibleProjectsForConsoleAuth(input.projects, input.auth, input.routeTenantId);
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

  if (requestedProjectId) {
    return visibleProjectIds.has(requestedProjectId) ? requestedProjectId : null;
  }

  return visibleProjects[0]?.id ?? null;
}

async function getConsoleAuthCookieHeader() {
  const cookieStore = await cookies();
  const pairs = authCookieNames
    .map((name) => {
      const value = cookieStore.get(name)?.value;
      return value ? name + '=' + encodeURIComponent(value) : null;
    })
    .filter((pair): pair is string => Boolean(pair));

  return pairs.length > 0 ? pairs.join('; ') : null;
}

function parseConsoleAuth(payload: unknown): CurrentConsoleAuth {
  const root = getRecord(payload);
  const data = getRecord(root?.data);
  const user = getRecord(data?.user);
  const memberships = Array.isArray(data?.memberships)
    ? data.memberships.map(toMembership).filter((membership): membership is AuthMembership => Boolean(membership))
    : [];
  const tenant = getRecord(data?.tenant);
  const userRole = normalizeAuthRole(readString(user, 'role'));
  const tenantId = readString(tenant, 'id') ?? getControlPlaneTenantId();
  if (memberships.length === 0 && userRole === 'tenant_admin') {
    memberships.push({
      role: 'tenant_admin',
      status: 'active',
      tenantId
    });
  }
  const projectAdmins = Array.isArray(data?.projectAdmins)
    ? data.projectAdmins.map(toProjectAdmin).filter((projectAdmin): projectAdmin is AuthProjectAdmin => Boolean(projectAdmin))
    : [];
  const currentUser = toCurrentConsoleUser({
    data,
    user
  });

  return {
    currentUser,
    isAuthenticated: Boolean(user),
    memberships,
    projectAdmins,
    userId: readString(user, 'id') ?? null
  };
}

function toMembership(value: unknown): AuthMembership | null {
  const record = getRecord(value);
  const role = normalizeAuthRole(readString(record, 'role'));
  const status = readString(record, 'status') ?? 'active';
  const tenantId = readString(record, 'tenantId');

  if (!role || !tenantId) {
    return null;
  }

  return { role, status, tenantId };
}

function toProjectAdmin(value: unknown): AuthProjectAdmin | null {
  const record = getRecord(value);
  const projectId = readString(record, 'projectId');
  const tenantId = readString(record, 'tenantId');

  if (!projectId || !tenantId) {
    return null;
  }

  return {
    projectId,
    projectName: readString(record, 'projectName'),
    tenantId
  };
}

function normalizeAuthRole(role: string | null) {
  const normalizedRole = role?.trim().toLowerCase();

  if (normalizedRole === 'super_admin') {
    return 'tenant_admin';
  }

  return normalizedRole ?? null;
}

function emptyConsoleAuth(): CurrentConsoleAuth {
  return {
    currentUser: null,
    isAuthenticated: false,
    memberships: [],
    projectAdmins: [],
    userId: null
  };
}

function toCurrentConsoleUser(input: {
  data: Record<string, unknown> | null;
  user: Record<string, unknown> | null;
}): CurrentConsoleUser | null {
  if (!input.user) {
    return null;
  }

  const email = readString(input.user, 'email');
  const membership = getPrimaryMembership(input.data);
  const tenant = getRecord(input.data?.tenant);
  const tenantName = readString(tenant, 'name');
  const displayName =
    readString(input.user, 'displayName') ??
    readString(input.user, 'name') ??
    getDisplayNameFromEmail(email) ??
    'Admin';

  return {
    avatarUrl: readString(input.user, 'avatarUrl') ?? readString(input.user, 'picture') ?? undefined,
    displayName,
    email: email ?? undefined,
    id: readString(input.user, 'id') ?? readString(input.user, 'userId') ?? 'current-admin',
    role: formatRoleLabel(readString(membership, 'role') ?? readString(input.user, 'role')),
    tenantName: tenantName ?? undefined
  };
}

function getPrimaryMembership(data: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!data) {
    return null;
  }

  const membership = getRecord(data.membership);
  if (membership) {
    return membership;
  }

  if (!Array.isArray(data.memberships)) {
    return null;
  }

  return data.memberships.map(getRecord).find((item): item is Record<string, unknown> => Boolean(item)) ?? null;
}

function getDisplayNameFromEmail(email: string | null) {
  if (!email) {
    return null;
  }

  const localPart = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!localPart) {
    return null;
  }

  return localPart
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatRoleLabel(role: string | null) {
  if (!role) {
    return 'Tenant Admin';
  }

  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === 'tenant_admin' || normalizedRole === 'super_admin') {
    return 'Tenant Admin';
  }

  return normalizedRole
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Tenant Admin';
}

function toControlPlaneTenantId(routeTenantId: string) {
  return isUuid(routeTenantId) ? routeTenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

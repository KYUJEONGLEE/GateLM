import "server-only";

import { cookies } from "next/headers";

export type ControlPlaneRequestOptions = {
  cookieHeader?: string | null;
};

export async function buildControlPlaneHeaders(
  options?: ControlPlaneRequestOptions,
  init?: Record<string, string>
): Promise<Record<string, string> | undefined> {
  const headers = { ...(init ?? {}) };
  const cookieHeader = options?.cookieHeader ?? await getServerCookieHeader();

  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function getServerCookieHeader() {
  let cookieStore: Awaited<ReturnType<typeof cookies>>;

  try {
    cookieStore = await cookies();
  } catch {
    return null;
  }

  const pairs = ["gatelm_session", "gatelm_onboarding"]
    .map((name) => {
      const value = cookieStore.get(name)?.value;
      return value ? `${name}=${encodeURIComponent(value)}` : null;
    })
    .filter((pair): pair is string => Boolean(pair));

  return pairs.length > 0 ? pairs.join("; ") : null;
}

import { NextRequest, NextResponse } from "next/server";
import { getControlPlaneBaseUrl } from "@/lib/control-plane/control-plane-config";

type AuthProxyContext = {
  params: Promise<{
    path?: string[];
  }>;
};

export async function GET(request: NextRequest, context: AuthProxyContext) {
  return proxyAuthRequest(request, context);
}

export async function POST(request: NextRequest, context: AuthProxyContext) {
  return proxyAuthRequest(request, context);
}

async function proxyAuthRequest(request: NextRequest, context: AuthProxyContext) {
  const targetUrl = await buildTargetUrl(request, context);
  const upstreamResponse = await fetch(targetUrl, {
    body: request.method === "GET" ? undefined : await request.text(),
    headers: buildForwardHeaders(request),
    method: request.method,
    redirect: "manual"
  });

  return toNextResponse(upstreamResponse);
}

async function buildTargetUrl(request: NextRequest, context: AuthProxyContext) {
  const { path = [] } = await context.params;
  const targetUrl = new URL(
    `/api/auth/${path.map(encodeURIComponent).join("/")}`,
    getControlPlaneBaseUrl()
  );
  targetUrl.search = request.nextUrl.search;

  return targetUrl;
}

function buildForwardHeaders(request: NextRequest) {
  const headers = new Headers();
  copyRequestHeader(request, headers, "accept");
  copyRequestHeader(request, headers, "content-type");
  copyRequestHeader(request, headers, "cookie");

  const host = request.headers.get("host");
  if (host) {
    headers.set("x-forwarded-host", host);
  }

  return headers;
}

function copyRequestHeader(request: NextRequest, headers: Headers, name: string) {
  const value = request.headers.get(name);
  if (value) {
    headers.set(name, value);
  }
}

async function toNextResponse(upstreamResponse: Response) {
  const location = upstreamResponse.headers.get("location");

  if (location && isRedirectStatus(upstreamResponse.status)) {
    const response = NextResponse.redirect(location, {
      status: upstreamResponse.status
    });
    copySetCookieHeaders(upstreamResponse.headers, response.headers);

    return response;
  }

  const response = new NextResponse(await upstreamResponse.arrayBuffer(), {
    headers: copyResponseHeaders(upstreamResponse.headers),
    status: upstreamResponse.status
  });
  copySetCookieHeaders(upstreamResponse.headers, response.headers);

  return response;
}

function copyResponseHeaders(source: Headers) {
  const headers = new Headers();
  for (const name of ["cache-control", "content-type"]) {
    const value = source.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function copySetCookieHeaders(source: Headers, target: Headers) {
  const getSetCookie = (
    source as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(source)
      : splitSetCookieHeader(source.get("set-cookie"));

  for (const cookie of cookies) {
    target.append("set-cookie", cookie);
  }
}

function splitSetCookieHeader(header: string | null) {
  if (!header) {
    return [];
  }

  const cookies: string[] = [];
  let start = 0;
  let insideExpires = false;

  for (let index = 0; index < header.length; index += 1) {
    const lowerSlice = header.slice(index, index + 8).toLowerCase();
    if (lowerSlice === "expires=") {
      insideExpires = true;
    }

    const char = header[index];
    if (insideExpires && char === ";") {
      insideExpires = false;
    }
    if (!insideExpires && char === ",") {
      cookies.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }

  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

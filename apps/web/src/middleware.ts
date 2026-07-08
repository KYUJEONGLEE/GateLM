import { NextResponse, type NextRequest } from "next/server";

const sessionCookieNames = ["gatelm_session", "gatelm_onboarding"] as const;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (hasConsoleSessionCookie(request)) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/";
  redirectUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(redirectUrl);
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.[^/]+$/.test(pathname)
  );
}

function hasConsoleSessionCookie(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") ?? "";

  return sessionCookieNames.some(
    (name) => request.cookies.has(name) || new RegExp(`(?:^|;\\s*)${name}=`).test(cookieHeader)
  );
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};

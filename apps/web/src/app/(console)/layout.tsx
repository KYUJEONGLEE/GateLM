import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentConsoleAuth } from "@/lib/auth/current-console-auth";

export default async function ConsoleRouteLayout({
  children
}: {
  children: ReactNode;
}) {
  const auth = await getCurrentConsoleAuth();
  const hasConsoleAccess = auth.memberships.length > 0 || auth.projectAdmins.length > 0;

  if (!auth.isAuthenticated || !hasConsoleAccess) {
    redirect("/");
  }

  return children;
}

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ManagementPageProps = {
  children: ReactNode;
  className?: string;
  headerActions?: ReactNode;
  headerEyebrow?: ReactNode;
  title: ReactNode;
};

export function ManagementPage({
  children,
  className,
  headerActions,
  headerEyebrow,
  title
}: ManagementPageProps) {
  return (
    <main className={cn("console-content management-line-content management-page", className)}>
      <header className="management-page-header">
        <div className="management-page-heading">
          {headerEyebrow}
          <h2>{title}</h2>
        </div>
        {headerActions ? (
          <div className="management-page-header-actions">{headerActions}</div>
        ) : null}
      </header>
      {children}
    </main>
  );
}
